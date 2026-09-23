import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** One row of the `executions` table (supabase/migrations/0001_ledger.sql). */
export interface ExecutionRow {
  chain_id: number;
  vault: string;
  task_id?: string;
  agent?: string;
  task?: string;
  action?: string;
  target?: string;
  selector?: string;
  calldata?: string;
  amount?: string;
  nonce?: string;
  intent_hash?: string;
  policy_hash?: string;
  status: "pending" | "executed" | "rejected_policy" | "reverted";
  reject_code?: string;
  reject_reason?: string;
  spent_before?: string;
  spent_after?: string;
  day?: number;
  prover?: string;
  public_values?: string;
  proof?: string;
  tx_hash?: string;
  block_number?: number;
  attestation?: unknown;
}

export interface Store {
  insert(row: ExecutionRow): Promise<void>;
  list(limit?: number): Promise<(ExecutionRow & { created_at: string })[]>;
  readonly kind: string;
}

class SupabaseStore implements Store {
  readonly kind = "supabase";
  constructor(
    private url: string,
    private key: string,
  ) {}

  private headers() {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json" };
  }

  async insert(row: ExecutionRow) {
    const res = await fetch(`${this.url}/rest/v1/executions`, {
      method: "POST",
      headers: { ...this.headers(), prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`supabase insert ${res.status}: ${await res.text()}`);
  }

  async list(limit = 100) {
    const res = await fetch(`${this.url}/rest/v1/executions?order=created_at.desc&limit=${limit}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`supabase list ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

class FileStore implements Store {
  readonly kind = "file";
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async insert(row: ExecutionRow) {
    appendFileSync(this.path, JSON.stringify({ ...row, created_at: new Date().toISOString() }) + "\n");
  }

  async list(limit = 100) {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .reverse()
      .slice(0, limit);
  }
}

/** Supabase when LEDGER_STORE=supabase (the default when credentials exist), otherwise a local JSONL file. */
export function makeStore(filePath: string): Store {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const mode = process.env.LEDGER_STORE ?? (url && key ? "supabase" : "file");
  if (mode === "supabase") {
    if (!url || !key) throw new Error("LEDGER_STORE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY");
    return new SupabaseStore(url, key);
  }
  return new FileStore(filePath);
}
