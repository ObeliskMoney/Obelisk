/**
 * Multi-user service on top of ObeliskAgent:
 * - auth: every command is signed by the vault owner's wallet (EIP-191 / ERC-1271)
 * - vault: policy JSON registration (hash checked against onchain)
 * - task: async queue (proofs can take a while), status stored in the `tasks` table
 * - job: scheduled work (DCA, recurring payments) run by the scheduler
 */
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  authMessage,
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

const SIG_WINDOW_SECS = 300;
/** A real proof can take a while: cap the queue so one user cannot block everyone. */
const MAX_PENDING_PER_VAULT = Number(process.env.MAX_PENDING_PER_VAULT ?? 3);
const MAX_PENDING_TOTAL = Number(process.env.MAX_PENDING_TOTAL ?? 20);
const JOB_MIN_MINUTES = Number(process.env.JOB_MIN_MINUTES ?? 60);

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
}

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
  async enqueue(vault: string, task: string, source: "chat" | "job", jobId?: string): Promise<TaskRow> {
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
    });
    this.pending++;
    this.pendingByVault.set(key, (this.pendingByVault.get(key) ?? 0) + 1);
    this.queue = this.queue
      .then(() => this.run(row.id, ctx, row.task))
      .catch((e) => console.error("[task]", e))
      .finally(() => {
        this.pending--;
        this.pendingByVault.set(key, (this.pendingByVault.get(key) ?? 1) - 1);
      });
    return row;
  }

  private async run(id: string, ctx: VaultCtx, task: string): Promise<TaskResult | undefined> {
    const set = (patch: Record<string, unknown>) =>
      this.db.update("tasks", { id }, { ...patch, updated_at: new Date().toISOString() });
    try {
      const r = await this.agent.runTask(ctx, task, {
        taskId: id,
        onPhase: (status) => void set({ status }),
      });
      await set({ status: "done", reply: r.reply || null, result: r });
      return r;
    } catch (e) {
      await set({ status: "error", reply: (e as Error).message });
    }
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
