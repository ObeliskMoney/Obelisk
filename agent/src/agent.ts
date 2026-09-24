import { randomBytes } from "node:crypto";
import {
  getAddress,
  isAddress,
  maxUint256,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  approveData,
  erc20Abi,
  exactInputSingleData,
  intentTypedData,
  mockRouterAbi,
  quoterV2Abi,
  obeliskVaultAbi,
  proverInputJson,
  transferData,
  type Deployment,
  type Intent,
  type Policy,
  type ProverResult,
} from "@obelisk/shared";
import type { AgentAction } from "@obelisk/shared";
import { detectLanguage, type Action, type Plan, type Planner, type Replier, type ReplyFacts } from "./llm.js";

/** docs/agents.md: the public action names map onto the planner's tools. */
function toAction(a: AgentAction): Action {
  if (a.type === "status") return { tool: "vault_status" };
  if (a.type === "swap") return { tool: "swap_usdc_to_eth", amountUsdc: a.amount };
  return { tool: "transfer_usdc", to: a.to, amountUsdc: a.amount };
}
import type { AgentIdentity } from "./identity.js";

const USDC_DECIMALS = 6;
// A real CPU proof can take about 15 to 30 minutes per step; single-use nonces still prevent replay.
const DEADLINE_SECS = BigInt(process.env.INTENT_TTL_SECS ?? 3 * 3600);
// Swap slippage tolerance. A proof takes about 15 minutes, so the price can move before execution;
// if it moves more than this, the swap reverts and the funds stay in the vault.
const SLIPPAGE_BPS = BigInt(process.env.SWAP_SLIPPAGE_BPS ?? 200);

/** The vault being served: address, policy (hash already verified), payee labels. */
export interface VaultCtx {
  address: Address;
  policy: Policy;
  labels: Record<string, string>;
}

export interface AgentDeps {
  deployment: Deployment;
  client: PublicClient;
  identity: AgentIdentity;
  planner: Planner;
  /** Writes the final message from the results (optional; without it the planner's text and a fixed summary are used). */
  replier?: Replier;
  proverUrl: string;
  executorUrl: string;
}

export interface StepResult {
  label: string;
  status: "executed" | "rejected_policy" | "reverted" | "invalid_action" | "error";
  code?: string;
  reason?: string;
  txHash?: Hex;
  intentHash?: Hex;
  spentAfter?: string;
}

export interface TaskResult {
  task: string;
  vault: Address;
  model: string;
  reply: string;
  actions: Action[];
  steps: StepResult[];
}

interface Prepared {
  step: Step;
  proof: ProverResult;
  base: Record<string, unknown>;
  spentBefore: bigint;
  day: number;
}

interface Step {
  label: string;
  action: Action;
  target: Address;
  data: Hex;
  amount: bigint;
}

function usdc(amount: string): bigint {
  return amount.trim().toLowerCase() === "max" ? maxUint256 : parseUnits(amount.trim(), USDC_DECIMALS);
}

function randomNonce(): bigint {
  return BigInt(`0x${randomBytes(16).toString("hex")}`);
}

async function post<T>(url: string, body: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${url} ${res.status}: ${text.slice(0, 300)}`);
  }
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export class ObeliskAgent {
  constructor(private readonly d: AgentDeps) {}

  get address(): Address {
    return this.d.identity.account.address;
  }

  get symbol(): string {
    return this.d.deployment.tokenSymbol ?? "USDC";
  }

  /** Expected swap output token → WETH, minus the slippage tolerance. Policy v2 rejects minOut = 0. */
  private async minOut(amountIn: bigint): Promise<bigint> {
    const { usdc: token, weth, router, quoter, swapFee } = this.d.deployment;
    let out: bigint;
    if (quoter && BigInt(quoter) !== 0n) {
      const { result } = await this.d.client.simulateContract({
        address: quoter,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: token, tokenOut: weth, amountIn, fee: swapFee ?? 500, sqrtPriceLimitX96: 0n }],
      });
      out = result[0];
    } else {
      const [num, den] = await Promise.all([
        this.d.client.readContract({ address: router, abi: mockRouterAbi, functionName: "rateNum" }),
        this.d.client.readContract({ address: router, abi: mockRouterAbi, functionName: "rateDen" }),
      ]);
      out = (amountIn * num) / den;
    }
    const min = (out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    if (min === 0n) throw new Error("the swap amount is too small");
    return min;
  }

  /** Turn one LLM action into one or more onchain steps. */
  private async stepsFor(v: VaultCtx, a: Action): Promise<Step[]> {
    const { usdc: token, router, weth } = this.d.deployment;
    const vault = v.address;
    switch (a.tool) {
      case "vault_status":
        return [];
      case "swap_usdc_to_eth": {
        const amount = usdc(a.amountUsdc);
        const steps: Step[] = [];
        const allowance = await this.d.client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [vault, router],
        });
        if (allowance < amount) {
          // Approve once for the daily limit (policy: approve ≤ maxPerDay) so later swaps
          // need a single proof. The router can only pull from the vault when the vault calls it.
          const cap = BigInt(v.policy.maxPerDay);
          const approveAmt = cap > amount ? cap : amount;
          steps.push({
            label: `approve ${Number(approveAmt) / 1e6} ${this.symbol} for the exchange (daily allowance)`,
            action: a,
            target: token,
            data: approveData(router, approveAmt),
            amount: 0n,
          });
        }
        steps.push({
          label: `swap ${a.amountUsdc} ${this.symbol} to ETH`,
          action: a,
          target: router,
          data: exactInputSingleData({
            tokenIn: token,
            tokenOut: weth,
            fee: this.d.deployment.swapFee ?? 500,
            recipient: vault,
            amountIn: amount,
            amountOutMinimum: await this.minOut(amount),
          }),
          amount,
        });
        return steps;
      }
      case "transfer_usdc": {
        if (!isAddress(a.to, { strict: false })) throw new Error(`not a valid address: ${a.to}`);
        const amount = usdc(a.amountUsdc);
        return [
          {
            label: `send ${a.amountUsdc} ${this.symbol} to ${a.to}`,
            action: a,
            target: token,
            data: transferData(getAddress(a.to), amount),
            amount,
          },
        ];
      }
      case "approve_usdc": {
        if (!isAddress(a.spender, { strict: false })) throw new Error(`not a valid address: ${a.spender}`);
        return [
          {
            label: `approve ${a.amountUsdc} ${this.symbol} for ${a.spender}`,
            action: a,
            target: token,
            data: approveData(getAddress(a.spender), usdc(a.amountUsdc)),
            amount: 0n,
          },
        ];
      }
    }
  }

  /** Sign the intent and request a proof (or only a rules check). Does not touch the chain. */
  private async prove(v: VaultCtx, task: string, step: Step, mode: "prove" | "check" = "prove"): Promise<Prepared> {
    const { deployment: dep, client, identity } = this.d;
    const vault = v.address;
    const block = await client.getBlock();
    const day = Number(block.timestamp / 86400n);
    const spentBefore = await client.readContract({
      address: vault,
      abi: obeliskVaultAbi,
      functionName: "spentOnDay",
      args: [BigInt(day)],
    });

    const intent: Intent = {
      target: step.target,
      value: 0n,
      data: step.data,
      nonce: randomNonce(),
      deadline: block.timestamp + DEADLINE_SECS,
    };
    const signature = await identity.account.signTypedData(intentTypedData(intent, dep.chainId, vault));
    const input = proverInputJson({ chainId: dep.chainId, vault, policy: v.policy, intent, spentBefore, day });
    const proof = mode === "check" ? await post<ProverResult>(`${this.d.proverUrl}/check`, input) : await this.requestProof(input);
    const base = {
      vault,
      policy: v.policy,
      taskId: this.taskId,
      task,
      label: step.label,
      action: step.action.tool,
      amount: step.amount,
      intent,
      signature,
      agent: identity.account.address,
      attestationKind: identity.attestation.kind,
    };
    return { step, proof, base, spentBefore, day };
  }

  /**
   * Request a proof from the prover service (async job) and wait for it. A real proof can take
   * tens of minutes, so this avoids one long request that could be cut off halfway.
   */
  private async requestProof(input: string): Promise<ProverResult> {
    const { id } = await post<{ id: string }>(`${this.d.proverUrl}/jobs`, input);
    const deadline = Date.now() + 3 * 60 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`${this.d.proverUrl}/jobs/${id}`).then((x) => x.json() as Promise<{ status: string; result?: ProverResult }>);
      if (r.status === "done" || r.status === "error") return r.result!;
    }
    throw new Error("the proof did not finish within 3 hours");
  }

  /** Send a prove() result to the executor: execute, report a refusal, or (demo) force it onchain. */
  private async dispatch(p: Prepared, opts: { force?: boolean }): Promise<StepResult> {
    if (!p.proof.ok) {
      const r = await post<StepResult>(
        `${this.d.executorUrl}/${opts.force ? "force" : "report"}`,
        json({ ...p.base, code: p.proof.code, reason: p.proof.reason, spentBefore: p.spentBefore, day: p.day }),
      );
      return { ...r, label: p.step.label, code: p.proof.code, reason: p.proof.reason };
    }
    const r = await post<StepResult>(`${this.d.executorUrl}/execute`, json({ ...p.base, proverResult: p.proof }));
    return { ...r, label: p.step.label, intentHash: p.proof.intentHash };
  }

  private taskId?: string;

  /** Balances and today's limit usage, as display strings (read after the actions ran). */
  async vaultFacts(v: VaultCtx): Promise<ReplyFacts["vault"]> {
    const { client, deployment: dep } = this.d;
    const block = await client.getBlock();
    const day = block.timestamp / 86400n;
    const [usdcBal, wethBal, spent] = await Promise.all([
      client.readContract({ address: dep.usdc, abi: erc20Abi, functionName: "balanceOf", args: [v.address] }),
      client.readContract({ address: dep.weth, abi: erc20Abi, functionName: "balanceOf", args: [v.address] }),
      client.readContract({ address: v.address, abi: obeliskVaultAbi, functionName: "spentOnDay", args: [day] }),
    ]);
    const f = (x: bigint, d: number) => (Number(x) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 6 });
    const left = BigInt(v.policy.maxPerDay) - spent;
    return {
      balance: f(usdcBal, 6),
      eth: f(wethBal, 18),
      spentToday: f(spent, 6),
      dailyLimit: f(BigInt(v.policy.maxPerDay), 6),
      leftToday: f(left > 0n ? left : 0n, 6),
      perTxLimit: f(BigInt(v.policy.maxPerTx), 6),
    };
  }

  /** Vault summary for the `vault_status` tool (no onchain action). Fixed English, also used by external agents. */
  async status(v: VaultCtx): Promise<string> {
    const x = await this.vaultFacts(v);
    const s = this.symbol;
    return `Vault balance: ${x.balance} ${s} and ${x.eth} ETH. Spent today: ${x.spentToday} of ${x.dailyLimit} ${s} (${x.leftToday} left).`;
  }

  /**
   * The message the owner reads, written after the actions ran so it can say what actually happened. Only for
   * requests in natural language; structured calls from external agents keep the fixed summary.
   */
  private async finalReply(v: VaultCtx, task: string, plan: Plan, steps: StepResult[], fallback: string): Promise<string> {
    if (!this.d.replier || !plan.actions.length) return fallback;
    try {
      const facts: ReplyFacts = {
        request: task,
        language: detectLanguage(task),
        plannerNote: plan.reply,
        token: this.symbol,
        vault: await this.vaultFacts(v),
        steps: steps.map((s) => ({ what: s.label, result: s.status, code: s.code, reason: s.reason })),
      };
      return await this.d.replier(facts);
    } catch (e) {
      console.warn(`[agent] final reply fell back: ${(e as Error).message}`);
      return fallback;
    }
  }

  async runTask(
    v: VaultCtx,
    task: string,
    opts: { force?: boolean; taskId?: string; onPhase?: (p: string) => void; actions?: AgentAction[] } = {},
  ): Promise<TaskResult> {
    this.taskId = opts.taskId;
    opts.onPhase?.("planning");
    const recipients = Object.entries(v.labels).map(([address, label]) => ({ address, label }));
    for (const r of v.policy.allowedRecipients) {
      if (!recipients.some((x) => x.address.toLowerCase() === r.toLowerCase())) recipients.push({ address: r, label: "" });
    }
    // Structured actions from an external agent skip the language model entirely.
    const plan: Plan = opts.actions
      ? { actions: opts.actions.map(toAction), reply: "", model: "structured" }
      : await this.d.planner(task, { recipients, token: this.symbol });
    const steps: StepResult[] = [];
    let reply = plan.reply;
    for (const action of plan.actions) {
      if (action.tool === "vault_status") {
        reply = [reply, await this.status(v)].filter(Boolean).join("\n");
        continue;
      }
      let planned: Step[];
      try {
        planned = await this.stepsFor(v, action);
      } catch (e) {
        steps.push({ label: action.tool, status: "invalid_action", reason: (e as Error).message });
        continue;
      }
      // Check the rules for every step first (under a second). If one is refused, report it right away
      // without proving other steps (for example an approval) that would never execute anyway.
      let checked: Prepared[] = [];
      try {
        for (const s of planned) checked.push(await this.prove(v, task, s, "check"));
      } catch {
        checked = []; // older prover without /check: fall back to the normal proof path
      }
      const early = checked.filter((p) => !p.proof.ok && p.proof.code !== "PROVER_ERROR");
      if (early.length) {
        // Record a single refusal: the main step (for example the swap), not its supporting approval.
        const p = early[early.length - 1]!;
        try {
          steps.push(await this.dispatch(p, opts));
        } catch (e) {
          steps.push({ label: p.step.label, status: "error", reason: (e as Error).message });
        }
        continue;
      }
      opts.onPhase?.("proving");
      // Prove every step first (for example approve + swap). If the policy refuses any of them,
      // no step executes, so no approval is left dangling.
      let prepared: Prepared[];
      try {
        prepared = [];
        for (const s of planned) prepared.push(await this.prove(v, task, s));
      } catch (e) {
        steps.push({ label: action.tool, status: "error", reason: (e as Error).message });
        continue;
      }
      const rejected = prepared.filter((p) => !p.proof.ok);
      for (const p of rejected.length ? rejected : prepared) {
        try {
          const r = await this.dispatch(p, opts);
          steps.push(r);
          if (r.status !== "executed" && !rejected.length) break; // approval failed, so do not swap
        } catch (e) {
          steps.push({ label: p.step.label, status: "error", reason: (e as Error).message });
          break;
        }
      }
    }
    if (!opts.actions) reply = await this.finalReply(v, task, plan, steps, reply);
    return { task, vault: v.address, model: plan.model, reply, actions: plan.actions, steps };
  }
}
