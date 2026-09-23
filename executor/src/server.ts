/**
 * Executor: takes intent + signature + proof from the agent, sends it to ObeliskVault
 * (paying gas), and records every outcome (executed, refused by the policy, or reverted) in the activity log.
 *
 * POST /execute  intent with a proof → send it to the vault
 * POST /report   refused by the policy program → record only
 * POST /force    demo: push a refused intent onchain with a fake proof → the vault reverts
 * GET  /ledger   list of executions (local development)
 */
import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  intentHash as hashIntent,
  policyHash,
  loadDeployment,
  loadEnv,
  mockSwapRouterAbi,
  mockVerifierAbi,
  obeliskVaultAbi,
  policyOutputAbi,
  resolveChain,
  verifyVault,
  type Intent,
  type Policy,
  type ProverResult,
} from "@obelisk/shared";
import { makeStore, type ExecutionRow } from "./store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv(ROOT);
const chainName = process.env.OBELISK_CHAIN ?? "local";
const { chain, rpcUrl } = resolveChain(chainName);
const dep = loadDeployment(ROOT, chainName);
const account = privateKeyToAccount((process.env.EXECUTOR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY) as Hex);
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
const store = makeStore(join(ROOT, "executor", "data", `${chainName}.jsonl`));
const port = Number(process.env.EXECUTOR_PORT ?? 8082);

// Combined ABI so custom errors from the verifier can be decoded too.
const abi = [...obeliskVaultAbi, ...mockVerifierAbi.filter((x) => x.type === "error")] as const;

const REASONS: Record<string, string> = {
  PolicyNotSet: "the vault has no rules set",
  Expired: "the transaction expired before it was sent",
  NonceUsed: "this transaction was already used (replay)",
  AgentNotActive: "the agent is not registered or was switched off",
  PolicyMismatch: "the proof was made for different rules",
  IntentMismatch: "the proof was made for a different transaction",
  WrongDay: "the proof was made for a different day",
  SpentMismatch: "today's spending record does not match",
  SpentDecreased: "today's spending record cannot go down",
  ValueNotAllowed: "sending ETH is not allowed",
  SelfCall: "the transaction tried to call the vault itself",
  InvalidProof: "the proof is not valid",
  WrongVerifierSelector: "the proof is not valid",
  InvalidProofSP1: "the proof is not valid",
};

function decodeRevert(e: unknown): { code: string; reason: string } {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const name = r.data?.errorName ?? r.signature ?? "Revert";
      return { code: name, reason: REASONS[name] ?? r.reason ?? name };
    }
    return { code: "RPC_ERROR", reason: e.shortMessage };
  }
  return { code: "ERROR", reason: String(e) };
}

interface Submission {
  vault: Hex;
  policy: Policy;
  taskId?: string;
  task: string;
  label: string;
  action: string;
  amount: string;
  intent: { target: Hex; value: string; data: Hex; nonce: string; deadline: string };
  signature: Hex;
  agent: Hex;
  attestationKind: string;
  proverResult?: Extract<ProverResult, { ok: true }>;
  code?: string;
  reason?: string;
  spentBefore?: string;
  day?: number;
}

function toIntent(i: Submission["intent"]): Intent {
  return { target: i.target, value: BigInt(i.value), data: i.data, nonce: BigInt(i.nonce), deadline: BigInt(i.deadline) };
}

function baseRow(s: Submission, intent: Intent): Omit<ExecutionRow, "status"> {
  return {
    chain_id: dep.chainId,
    vault: s.vault.toLowerCase(),
    task_id: s.taskId,
    agent: s.agent,
    task: s.task,
    action: s.action,
    target: intent.target,
    selector: intent.data.slice(0, 10),
    calldata: intent.data,
    amount: s.amount,
    nonce: intent.nonce.toString(),
    intent_hash: hashIntent(intent, dep.chainId, s.vault),
    policy_hash: policyHash(s.policy),
    attestation: { kind: s.attestationKind },
  };
}

/** Send execute(); if simulation fails and `forceSend` is set, send anyway with fixed gas so the revert is recorded onchain. */
async function send(vault: Hex, intent: Intent, sig: Hex, pv: Hex, proof: Hex, forceSend: boolean) {
  const args = [intent, sig, pv, proof] as const;
  let simErr: { code: string; reason: string } | undefined;
  try {
    await pub.simulateContract({ address: vault, abi, functionName: "execute", args, account });
  } catch (e) {
    simErr = decodeRevert(e);
    if (!forceSend) return { status: "reverted" as const, ...simErr };
  }
  const hash = await wallet.writeContract({
    address: vault,
    abi,
    functionName: "execute",
    args,
    ...(simErr ? { gas: 600_000n } : {}),
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return rc.status === "success"
    ? { status: "executed" as const, txHash: hash, blockNumber: Number(rc.blockNumber) }
    : { status: "reverted" as const, txHash: hash, blockNumber: Number(rc.blockNumber), ...(simErr ?? { code: "Revert", reason: "the transaction reverted" }) };
}

// The executor pays gas, so only for vaults created by the Obelisk factory (result cached).
const knownVaults = new Set<string>();
async function assertVault(vault: Hex) {
  if (knownVaults.has(vault.toLowerCase())) return;
  await verifyVault(pub, dep, vault);
  knownVaults.add(vault.toLowerCase());
}

async function handleExecute(s: Submission) {
  const intent = toIntent(s.intent);
  const p = s.proverResult!;
  // Also send reverting transactions onchain for normal executions, so there is always public evidence.
  await assertVault(s.vault);
  const r = await send(s.vault, intent, s.signature, p.publicValues, p.proof ?? "0x", true);
  await store.insert({
    ...baseRow(s, intent),
    status: r.status,
    reject_code: "code" in r ? r.code : undefined,
    reject_reason: "reason" in r ? r.reason : undefined,
    spent_before: p.spentBefore,
    spent_after: p.spentAfter,
    day: p.day,
    prover: p.prover,
    public_values: p.publicValues,
    proof: p.proof,
    tx_hash: "txHash" in r ? r.txHash : undefined,
    block_number: "blockNumber" in r ? r.blockNumber : undefined,
  });
  return { ...r, spentAfter: p.spentAfter };
}

async function handleReport(s: Submission) {
  const intent = toIntent(s.intent);
  await store.insert({
    ...baseRow(s, intent),
    status: "rejected_policy",
    reject_code: s.code,
    reject_reason: s.reason,
    spent_before: s.spentBefore,
    day: s.day,
  });
  return { status: "rejected_policy" as const, code: s.code, reason: s.reason };
}

/**
 * Simulates an attacker forcing a refused intent onchain. It can fabricate public values
 * that "look compliant", but it cannot produce a valid proof for them.
 */
async function handleForce(s: Submission) {
  const intent = toIntent(s.intent);
  const before = BigInt(s.spentBefore ?? 0);
  await assertVault(s.vault);
  const pv = encodeAbiParameters(policyOutputAbi, [
    {
      policyHash: policyHash(s.policy),
      intentHash: hashIntent(intent, dep.chainId, s.vault),
      spentBefore: before,
      spentAfter: before,
      day: BigInt(s.day ?? 0),
    },
  ]);
  const fakeProof = "0xdeadbeef" as Hex;
  const r = await send(s.vault, intent, s.signature, pv, fakeProof, true);
  await store.insert({
    ...baseRow(s, intent),
    status: r.status === "executed" ? "executed" : "reverted",
    reject_code: `${s.code}${"code" in r ? ` → ${r.code}` : ""}`,
    reject_reason: `${s.reason}; forced onchain: ${"reason" in r ? r.reason : "PASSED (bug!)"}`,
    spent_before: s.spentBefore,
    day: s.day,
    prover: "forged",
    public_values: pv,
    proof: fakeProof,
    tx_hash: "txHash" in r ? r.txHash : undefined,
    block_number: "blockNumber" in r ? r.blockNumber : undefined,
  });
  return r;
}

async function readBody(req: IncomingMessage): Promise<Submission> {
  let s = "";
  for await (const c of req) s += c;
  return JSON.parse(s);
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const routes: Record<string, (s: Submission) => Promise<unknown>> = {
  "/execute": handleExecute,
  "/report": handleReport,
  "/force": handleForce,
};

/**
 * Price keeper (testnet): the mock router uses the market ETH/USD rate from CoinGecko,
 * updated hourly, so demo swaps return realistic amounts.
 */
async function updateRate() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      signal: AbortSignal.timeout(10_000),
    });
    const usd = ((await r.json()) as { ethereum?: { usd?: number } }).ethereum?.usd;
    if (!usd || usd < 100 || usd > 1_000_000) throw new Error(`unexpected price: ${usd}`);
    const hash = await wallet.writeContract({
      address: dep.router,
      abi: mockSwapRouterAbi,
      functionName: "setRate",
      args: [10n ** 18n, BigInt(Math.round(usd * 1e6))],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`[keeper] 1 ETH = ${usd} USDC (${hash})`);
  } catch (e) {
    console.warn(`[keeper] rate update failed: ${(e as Error).message}`);
  }
}
// Only for MockSwapRouter; with real assets the price comes from the Uniswap pool.
if (process.env.PRICE_KEEPER !== "off" && dep.mockAssets !== false) {
  void updateRate();
  setInterval(updateRate, 60 * 60_000);
}

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  try {
    if (req.method === "GET" && req.url === "/health") {
      const bal = await pub.getBalance({ address: account.address });
      return res.end(json({ ok: true, chain: chainName, executor: account.address, balanceWei: bal, store: store.kind }));
    }
    if (req.method === "GET" && req.url?.startsWith("/ledger")) {
      return res.end(json(await store.list()));
    }
    const handler = req.method === "POST" ? routes[req.url ?? ""] : undefined;
    if (!handler) {
      res.statusCode = 404;
      return res.end(json({ error: "not found" }));
    }
    const out = await handler(await readBody(req));
    console.log(`[executor] ${req.url} → ${json(out).slice(0, 160)}`);
    res.end(json(out));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end(json({ status: "error", reason: (e as Error).message }));
  }
}).listen(port, "127.0.0.1", () => console.log(`[executor] ${account.address} on :${port}, chain ${chainName}, store ${store.kind}`));
