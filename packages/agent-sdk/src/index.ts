/**
 * @obeliskmoney/agent-sdk: give an AI agent an Obelisk vault to spend from.
 *
 * The agent holds an agent key that the vault owner created in the Obelisk app. The key can only submit
 * tasks: it cannot withdraw, change the rules or add keys. Every onchain action still needs a zero-knowledge
 * proof that it follows the vault's rules, so a tricked or leaked agent stays inside the owner's limits.
 *
 *   const obelisk = new Obelisk({ agentKey: process.env.OBELISK_AGENT_KEY, vault: process.env.OBELISK_VAULT });
 *   const r = await obelisk.swap("2");      // 2 USDG to ETH, back into the vault
 *   if (!r.ok) console.log(r.refused);      // e.g. [{ code: "EXCEEDS_PER_DAY", ... }]
 */
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getAddress, isAddress, type Address, type Hex } from "viem";

export const DEFAULT_API_URL = "https://www.obelisk.cash/api/agent";

export type AgentAction =
  | { type: "status" }
  | { type: "swap"; amount: string }
  | { type: "pay"; to: string; amount: string };

export interface ObeliskOptions {
  /** The agent key's private key (0x...), created in the Obelisk app under "Agent keys". */
  agentKey: string | undefined;
  /** The vault address the key belongs to. */
  vault: string | undefined;
  /** Obelisk agent API. Defaults to the public mainnet deployment. */
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface TaskStep {
  label: string;
  status: "executed" | "rejected_policy" | "reverted" | "invalid_action" | "error";
  code?: string;
  reason?: string;
  txHash?: Hex;
  spentAfter?: string;
}

export interface TaskRecord {
  id: string;
  vault: string;
  task: string;
  status: "queued" | "planning" | "proving" | "done" | "error" | string;
  source: string;
  reply: string | null;
  result: { reply?: string; steps?: TaskStep[] } | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaskOutcome {
  id: string;
  /** true when the task finished and no step was refused, reverted or failed. */
  ok: boolean;
  status: TaskRecord["status"];
  /** Text from the agent, for example the vault balance for a status request. */
  reply: string;
  executed: { label: string; txHash?: Hex }[];
  refused: { label: string; code?: string; reason?: string; status: TaskStep["status"] }[];
  task: TaskRecord;
}

export class ObeliskError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Identical to packages/shared/src/auth.ts in the Obelisk repository: the agent API checks this exact text. */
function authMessage(p: { vault: string; action: "task"; payload: string; ts: number }): string {
  return ["Obelisk agent command", `vault: ${p.vault.toLowerCase()}`, `action: ${p.action}`, `content: ${p.payload}`, `time: ${p.ts}`].join("\n");
}

const DONE = new Set(["done", "error"]);

export class Obelisk {
  readonly vault: Address;
  readonly apiUrl: string;
  private account: PrivateKeyAccount;
  private http: typeof fetch;

  constructor(opts: ObeliskOptions) {
    if (!opts.agentKey || !/^0x[0-9a-fA-F]{64}$/.test(opts.agentKey)) {
      throw new ObeliskError("agentKey must be the 0x-prefixed private key of an Obelisk agent key");
    }
    if (!opts.vault || !isAddress(opts.vault, { strict: false })) throw new ObeliskError("vault must be an address");
    this.account = privateKeyToAccount(opts.agentKey as Hex);
    this.vault = getAddress(opts.vault);
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.http = opts.fetch ?? fetch;
  }

  /** Address of the agent key (what the owner sees in the app). */
  get keyAddress(): Address {
    return this.account.address;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const r = await this.http(`${this.apiUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new ObeliskError(j.error ?? `Obelisk API returned HTTP ${r.status}`, r.status);
    return j as T;
  }

  private async signed(payload: string) {
    const ts = Math.floor(Date.now() / 1000);
    const signature = await this.account.signMessage({ message: authMessage({ vault: this.vault, action: "task", payload, ts }) });
    return { vault: this.vault, ts, signature };
  }

  /** Queue structured actions and return the task id right away. */
  async submit(actions: AgentAction[]): Promise<{ id: string; task: string }> {
    const json = JSON.stringify(actions);
    return this.call("POST", "/tasks", { ...(await this.signed(json)), actions: json });
  }

  /** Queue a free-text task for the Obelisk agent to interpret, for example "swap 2 USDG to ETH". */
  async submitText(text: string): Promise<{ id: string }> {
    return this.call("POST", "/tasks", { ...(await this.signed(text)), task: text });
  }

  getTask(id: string): Promise<TaskRecord> {
    return this.call("GET", `/tasks/${id}`);
  }

  /** Poll until the task is done. Proofs take about a minute each on a GPU, longer when the GPU is busy. */
  async wait(id: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<TaskOutcome> {
    const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
    for (;;) {
      const t = await this.getTask(id);
      if (DONE.has(t.status)) return outcome(t);
      if (Date.now() > deadline) throw new ObeliskError(`task ${id} is still ${t.status}; call wait() again later`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 4000));
    }
  }

  /** Submit and wait. */
  async run(actions: AgentAction[], opts?: { timeoutMs?: number }): Promise<TaskOutcome> {
    const { id } = await this.submit(actions);
    return this.wait(id, opts);
  }

  /** Swap `amount` of the vault's stablecoin (USDG on mainnet) to ETH; the ETH returns to the vault. */
  swap(amount: string | number, opts?: { timeoutMs?: number }) {
    return this.run([{ type: "swap", amount: String(amount) }], opts);
  }

  /** Pay `amount` to an address the owner approved as a payee. Any other address is refused by the proof. */
  pay(to: string, amount: string | number, opts?: { timeoutMs?: number }) {
    return this.run([{ type: "pay", to, amount: String(amount) }], opts);
  }

  /** Balances, what was spent today and what is left under the daily limit. */
  status(opts?: { timeoutMs?: number }) {
    return this.run([{ type: "status" }], opts);
  }
}

function outcome(t: TaskRecord): TaskOutcome {
  const steps = t.result?.steps ?? [];
  const executed = steps.filter((s) => s.status === "executed").map((s) => ({ label: s.label, txHash: s.txHash }));
  const refused = steps
    .filter((s) => s.status !== "executed")
    .map((s) => ({ label: s.label, code: s.code, reason: s.reason, status: s.status }));
  return {
    id: t.id,
    ok: t.status === "done" && refused.length === 0,
    status: t.status,
    reply: t.result?.reply || t.reply || "",
    executed,
    refused,
    task: t,
  };
}
