/**
 * Multi-user service on top of ObeliskAgent:
 * - auth: every command is signed by the vault owner's wallet (EIP-191 / ERC-1271)
 * - vault: policy JSON registration (hash checked against onchain)
 * - task: async queue (proofs can take a while), status stored in the `tasks` table
 * - job: scheduled work (DCA, recurring payments) run by the scheduler
 * - agent keys: keys the owner hands to an external AI agent; they can only submit tasks (docs/agents.md)
 */
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  authMessage,
  describeAgentActions,
  parseAgentActions,
  type AgentAction,
  obeliskVaultAbi,
  policyHash,
  verifyVault,
  type AuthAction,
  type Db,
  type Deployment,
  type Policy,
  type VaultRecord,
} from "@obelisk/shared";
import type { ObeliskAgent, TaskResult, VaultCtx } from "./agent.js";
import type { Turn } from "./llm.js";

const SIG_WINDOW_SECS = 300;
/** A real proof can take a while: cap the queue so one user cannot block everyone. */
const MAX_PENDING_PER_VAULT = Number(process.env.MAX_PENDING_PER_VAULT ?? 3);
const MAX_PENDING_TOTAL = Number(process.env.MAX_PENDING_TOTAL ?? 20);
const JOB_MIN_MINUTES = Number(process.env.JOB_MIN_MINUTES ?? 60);
const MAX_AGENT_KEYS_PER_VAULT = 10;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface TaskRow {
  id: string;
  vault: string;
  task: string;
  status: string;
  source: string;
  job_id: string | null;
  reply?: string | null;
  created_at?: string;
  agent_key?: string | null;
}

/** Conversation memory: the last few finished exchanges from the last half hour. */
const HISTORY_TURNS = 3;
const HISTORY_WINDOW_MS = 30 * 60_000;

interface AgentKeyRow {
  id: string;
  vault: string;
  address: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
}

/** Who signed a task: the owner's wallet, or one of the vault's agent keys. */
export type TaskSigner = { kind: "owner"; address: Address } | { kind: "agent-key"; address: Address };

interface JobRow {
  id: string;
  vault: string;
  task: string;
  interval_minutes: number;
  next_run_at: string;
  active: boolean;
}

export class ObeliskService {
  private usedSigs = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private pendingByVault = new Map<string, number>();

  constructor(
    private agent: ObeliskAgent,
    private db: Db,
    private client: PublicClient,
    private dep: Deployment,
  ) {}

  get queueDepth() {
    return this.pending;
  }

  // ---------------------------------------------------------------- auth

  /** Verify the vault owner's signature over the standard message; returns the onchain owner. */
  async authorize(action: AuthAction, vault: string, payload: string, ts: number, signature: Hex): Promise<Address> {
    if (!isAddress(vault, { strict: false })) throw new HttpError(400, "invalid vault address");
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > SIG_WINDOW_SECS) {
      throw new HttpError(401, "the signature expired, please try again");
    }
    if (this.usedSigs.has(signature)) throw new HttpError(401, "this signature was already used");
    const owner = await this.client.readContract({
      address: getAddress(vault),
      abi: obeliskVaultAbi,
      functionName: "owner",
    }).catch(() => {
      throw new HttpError(404, "vault not found onchain");
    });
    const message = authMessage({ vault, action, payload, ts });
    const ok = await this.client.verifyMessage({ address: owner, message, signature });
    if (!ok) throw new HttpError(401, "the signature is not from the vault owner");
    this.usedSigs.set(signature, now);
    for (const [k, t] of this.usedSigs) if (now - t > SIG_WINDOW_SECS * 2) this.usedSigs.delete(k);
    return owner;
  }

  /**
   * Tasks may be signed by the owner or by an active agent key of the vault. Every other action
   * (rules, schedules, agent keys) stays owner-only through `authorize`.
   */
  async authorizeTask(vault: string, payload: string, ts: number, signature: Hex): Promise<TaskSigner> {
    if (!isAddress(vault, { strict: false })) throw new HttpError(400, "invalid vault address");
    const message = authMessage({ vault, action: "task", payload, ts });
    const signer = await recoverMessageAddress({ message, signature }).catch(() => null);
    const key = signer ? await this.activeAgentKey(vault, signer) : null;
    if (!key) {
      const owner = await this.authorize("task", vault, payload, ts, signature).catch((e) => {
        if (e instanceof HttpError && e.status === 401 && e.message.includes("not from the vault owner")) {
          throw new HttpError(401, "the signature is not from the vault owner or an active agent key of this vault");
        }
        throw e;
      });
      return { kind: "owner", address: owner };
    }
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > SIG_WINDOW_SECS) {
      throw new HttpError(401, "the signature expired, sign the request again");
    }
    if (this.usedSigs.has(signature)) throw new HttpError(401, "this signature was already used");
    this.usedSigs.set(signature, now);
    return { kind: "agent-key", address: getAddress(key.address) };
  }

  private async activeAgentKey(vault: string, address: string): Promise<AgentKeyRow | null> {
    const rows = await this.db
      .select<AgentKeyRow & Record<string, unknown>>("agent_keys", { vault: vault.toLowerCase(), address: address.toLowerCase() })
      .catch(() => []);
    return rows.find((r) => !r.revoked_at) ?? null;
  }

  // ---------------------------------------------------------------- agent keys

  async listAgentKeys(vault: string): Promise<AgentKeyRow[]> {
    if (!isAddress(vault, { strict: false })) throw new HttpError(400, "invalid vault address");
    return this.db.select<AgentKeyRow & Record<string, unknown>>("agent_keys", { vault: vault.toLowerCase() }, { order: "created_at.desc" });
  }

  /** The owner allows a key (generated by the app, private key kept by the agent) to submit tasks. */
  async addAgentKey(input: { vault: string; address: string; label?: string; ts: number; signature: Hex }): Promise<AgentKeyRow> {
    if (!isAddress(input.address, { strict: false })) throw new HttpError(400, "invalid agent key address");
    const address = input.address.toLowerCase();
    const label = (input.label ?? "").trim().slice(0, 40);
    await this.authorize("agent-key:add", input.vault, `${address}|${label}`, input.ts, input.signature);
    const vault = input.vault.toLowerCase();
    await this.vaultCtx(vault); // the vault must be registered with current rules
    const keys = await this.listAgentKeys(vault);
    if (keys.some((k) => k.address === address)) throw new HttpError(409, "this key was already added to the vault");
    if (keys.filter((k) => !k.revoked_at).length >= MAX_AGENT_KEYS_PER_VAULT) {
      throw new HttpError(429, `a vault can have at most ${MAX_AGENT_KEYS_PER_VAULT} active agent keys`);
    }
    return this.db.insert<AgentKeyRow & Record<string, unknown>>("agent_keys", { vault, address, label });
  }

  async revokeAgentKey(input: { vault: string; address: string; ts: number; signature: Hex }): Promise<void> {
    if (!isAddress(input.address, { strict: false })) throw new HttpError(400, "invalid agent key address");
    const address = input.address.toLowerCase();
    await this.authorize("agent-key:revoke", input.vault, address, input.ts, input.signature);
    const vault = input.vault.toLowerCase();
    if (!(await this.activeAgentKey(vault, address))) throw new HttpError(404, "no active agent key with this address");
    await this.db.update("agent_keys", { vault, address }, { revoked_at: new Date().toISOString() });
  }

  // ---------------------------------------------------------------- vaults

  async registerVault(input: {
    vault: string;
    policy: Policy;
    labels?: Record<string, string>;
    name?: string;
    ts: number;
    signature: Hex;
  }): Promise<VaultRecord> {
    if (!input.policy || typeof input.policy !== "object" || !Array.isArray(input.policy.allowedTargets)) {
      throw new HttpError(400, "the vault rules are missing");
    }
    const payload = policyHash(input.policy);
    const owner = await this.authorize("vault:register", input.vault, payload, input.ts, input.signature);
    const vault = getAddress(input.vault);
    await verifyVault(this.client, this.dep, vault, input.policy).catch((e) => {
      throw new HttpError(400, (e as Error).message);
    });
    const labels: Record<string, string> = {};
    for (const [a, l] of Object.entries(input.labels ?? {})) {
      if (isAddress(a, { strict: false }) && typeof l === "string") labels[getAddress(a)] = l.slice(0, 40);
    }
    const row: VaultRecord = {
      address: vault.toLowerCase(),
      chain_id: this.dep.chainId,
      owner: owner.toLowerCase(),
      policy: input.policy,
      policy_hash: payload,
      labels,
      name: input.name?.slice(0, 60) ?? null,
    };
    await this.db.remove("vaults", { address: row.address });
    await this.db.insert("vaults", row as unknown as Record<string, unknown>);
    return row;
  }

  async vaultCtx(vault: string): Promise<VaultCtx> {
    const [row] = await this.db.select<VaultRecord & Record<string, unknown>>("vaults", {
      address: vault.toLowerCase(),
    });
    if (!row) throw new HttpError(404, "this vault is not registered with the agent yet, register it in the app first");
    // The owner can change the policy with setPolicy; make sure the stored one is still current.
    const onchain = await this.client.readContract({
      address: getAddress(vault),
      abi: obeliskVaultAbi,
      functionName: "policyHash",
    });
    if (onchain.toLowerCase() !== row.policy_hash.toLowerCase()) {
      throw new HttpError(409, "the vault rules changed onchain, register them again");
    }
    return { address: getAddress(vault), policy: row.policy, labels: row.labels ?? {} };
  }

  // ---------------------------------------------------------------- tasks

  /** Queue a task and return its id right away (proofs can take a while). */
  async enqueue(
    vault: string,
    task: string,
    source: "chat" | "job" | "agent",
    jobId?: string,
    extra: { actions?: AgentAction[]; agentKey?: string } = {},
  ): Promise<TaskRow> {
    const key = vault.toLowerCase();
    if ((this.pendingByVault.get(key) ?? 0) >= MAX_PENDING_PER_VAULT) {
      throw new HttpError(429, `this vault already has ${MAX_PENDING_PER_VAULT} tasks in progress, wait for them to finish`);
    }
    if (this.pending >= MAX_PENDING_TOTAL) throw new HttpError(503, "the agent queue is full, try again in a few minutes");
    const ctx = await this.vaultCtx(vault);
    const row = await this.db.insert<TaskRow & Record<string, unknown>>("tasks", {
      vault: ctx.address.toLowerCase(),
      task: task.slice(0, 1000),
      status: "queued",
      source,
      job_id: jobId ?? null,
      ...(extra.agentKey ? { agent_key: extra.agentKey.toLowerCase() } : {}),
    });
    this.pending++;
    this.pendingByVault.set(key, (this.pendingByVault.get(key) ?? 0) + 1);
    this.queue = this.queue
      .then(() => this.run(row.id, ctx, row.task, extra.actions, { source, agentKey: extra.agentKey }))
      .catch((e) => console.error("[task]", e))
      .finally(() => {
        this.pending--;
        this.pendingByVault.set(key, (this.pendingByVault.get(key) ?? 1) - 1);
      });
    return row;
  }

  /**
   * Earlier exchanges of the same conversation, oldest first: the owner's chat for owner requests, and each agent
   * key's own requests for that key. Scheduled jobs and structured calls have no conversation.
   */
  private async history(id: string, vault: string, who: { source: string; agentKey?: string }): Promise<Turn[]> {
    if (who.source === "job") return [];
    const filter: Record<string, string> = { vault: vault.toLowerCase(), source: who.source };
    if (who.agentKey) filter.agent_key = who.agentKey.toLowerCase();
    const rows = await this.db
      .select<TaskRow & Record<string, unknown>>("tasks", filter, { order: "created_at.desc", limit: 10 })
      .catch(() => []);
    const since = Date.now() - HISTORY_WINDOW_MS;
    return rows
      .filter((r) => r.id !== id && r.status === "done" && r.reply && Date.parse(r.created_at ?? "") >= since)
      .slice(0, HISTORY_TURNS)
      .reverse()
      .map((r) => ({ request: r.task.slice(0, 500), reply: r.reply!.slice(0, 600) }));
  }

  private async run(
    id: string,
    ctx: VaultCtx,
    task: string,
    actions?: AgentAction[],
    who: { source: string; agentKey?: string } = { source: "job" },
  ): Promise<TaskResult | undefined> {
    const set = (patch: Record<string, unknown>) =>
      this.db.update("tasks", { id }, { ...patch, updated_at: new Date().toISOString() });
    try {
      const r = await this.agent.runTask(ctx, task, {
        taskId: id,
        actions,
        history: actions ? [] : await this.history(id, ctx.address, who),
        onPhase: (status) => void set({ status }),
      });
      await set({ status: "done", reply: r.reply || null, result: r });
      return r;
    } catch (e) {
      await set({ status: "error", reply: (e as Error).message });
    }
  }

  /** Structured actions from an external agent (or the owner): validated, described, then queued. */
  async enqueueActions(vault: string, actionsJson: string, signer: TaskSigner): Promise<TaskRow> {
    let actions: AgentAction[];
    try {
      actions = parseAgentActions(actionsJson);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const text = describeAgentActions(actions, this.dep.tokenSymbol ?? "USDC");
    return this.enqueue(vault, text, signer.kind === "agent-key" ? "agent" : "chat", undefined, {
      actions,
      agentKey: signer.kind === "agent-key" ? signer.address : undefined,
    });
  }

  // ---------------------------------------------------------------- jobs

  async createJob(vault: string, task: string, intervalMinutes: number, firstRunAt?: Date) {
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < JOB_MIN_MINUTES) {
      throw new HttpError(400, `the minimum interval is ${JOB_MIN_MINUTES} minutes`);
    }
    const existing = await this.db.select("jobs", { vault: vault.toLowerCase(), active: true });
    if (existing.length >= 5) throw new HttpError(400, "at most 5 active schedules per vault");
    await this.vaultCtx(vault);
    return this.db.insert("jobs", {
      vault: vault.toLowerCase(),
      task: task.slice(0, 500),
      interval_minutes: intervalMinutes,
      next_run_at: (firstRunAt ?? new Date()).toISOString(),
      active: true,
    });
  }

  async deleteJob(vault: string, jobId: string) {
    await this.db.update("jobs", { id: jobId, vault: vault.toLowerCase() }, { active: false });
  }

  /** Run jobs that are due. Called periodically by the server. */
  async tick(): Promise<number> {
    const due = await this.db.select<JobRow & Record<string, unknown>>(
      "jobs",
      { active: true, next_run_at: `lte.${new Date().toISOString()}` },
      { order: "next_run_at.asc", limit: 20 },
    );
    for (const j of due) {
      const next = new Date(Date.now() + j.interval_minutes * 60_000).toISOString();
      await this.db.update("jobs", { id: j.id }, { next_run_at: next, last_run_at: new Date().toISOString() });
      try {
        await this.enqueue(j.vault, j.task, "job", j.id);
        await this.db.update("jobs", { id: j.id }, { last_status: "queued" });
      } catch (e) {
        await this.db.update("jobs", { id: j.id }, { last_status: `error: ${(e as Error).message}`.slice(0, 200) });
      }
    }
    return due.length;
  }
}
