/**
 * Supabase table access over REST (PostgREST) with the secret key, used on the server only
 * (agent/executor). For local development without Supabase there is MemoryDb with the same interface.
 */
import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
/** Simple filter: column → value (eq), or a raw PostgREST string (for example "lte.2026-01-01"). */
export type Filter = Record<string, string | number | boolean>;

export interface Db {
  readonly kind: string;
  insert<T extends Row>(table: string, row: Row): Promise<T>;
  update(table: string, filter: Filter, patch: Row): Promise<void>;
  select<T extends Row>(table: string, filter?: Filter, opts?: { order?: string; limit?: number }): Promise<T[]>;
  remove(table: string, filter: Filter): Promise<void>;
}

const OPS = /^(eq|neq|lt|lte|gt|gte|like|ilike|is|in)\./;

function qs(filter: Filter = {}, opts: { order?: string; limit?: number } = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    p.set(k, typeof v === "string" && OPS.test(v) ? v : `eq.${v}`);
  }
  if (opts.order) p.set("order", opts.order);
  if (opts.limit) p.set("limit", String(opts.limit));
  return p.toString();
}

export class SupabaseDb implements Db {
  readonly kind = "supabase";
  constructor(
    private url: string,
    private key: string,
  ) {}

  private h(extra: Record<string, string> = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json", ...extra };
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T> {
    const r = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.h({ prefer: "return=representation" }),
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`supabase insert ${table} ${r.status}: ${await r.text()}`);
    return ((await r.json()) as T[])[0]!;
  }

  async update(table: string, filter: Filter, patch: Row) {
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs(filter)}`, {
      method: "PATCH",
      headers: this.h({ prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`supabase update ${table} ${r.status}: ${await r.text()}`);
  }

  async select<T extends Row>(table: string, filter?: Filter, opts?: { order?: string; limit?: number }) {
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs(filter, opts)}`, { headers: this.h() });
    if (!r.ok) throw new Error(`supabase select ${table} ${r.status}: ${await r.text()}`);
    return (await r.json()) as T[];
  }

  async remove(table: string, filter: Filter) {
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs(filter)}`, { method: "DELETE", headers: this.h() });
    if (!r.ok) throw new Error(`supabase delete ${table} ${r.status}: ${await r.text()}`);
  }
}

/** In-memory implementation for local development and tests. Supports eq, lte and gte filters only. */
export class MemoryDb implements Db {
  readonly kind = "memory";
  private t = new Map<string, Row[]>();

  private rows(table: string) {
    if (!this.t.has(table)) this.t.set(table, []);
    return this.t.get(table)!;
  }

  private match(row: Row, filter: Filter = {}) {
    return Object.entries(filter).every(([k, v]) => {
      const cell = row[k];
      if (typeof v === "string" && OPS.test(v)) {
        const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
        if (op === "lte") return String(cell) <= val;
        if (op === "gte") return String(cell) >= val;
        if (op === "eq") return String(cell) === val;
        if (op === "ilike") return String(cell).toLowerCase() === val.toLowerCase();
        return true;
      }
      return String(cell) === String(v);
    });
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T> {
    const now = new Date().toISOString();
    const full = { id: randomUUID(), created_at: now, ...row };
    this.rows(table).push(full);
    return full as unknown as T;
  }

  async update(table: string, filter: Filter, patch: Row) {
    for (const r of this.rows(table)) if (this.match(r, filter)) Object.assign(r, patch);
  }

  async select<T extends Row>(table: string, filter?: Filter, opts?: { order?: string; limit?: number }) {
    let out = this.rows(table).filter((r) => this.match(r, filter));
    if (opts?.order) {
      const [col, dir] = opts.order.split(".");
      out = [...out].sort((a, b) => (String(a[col!]) < String(b[col!]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
    }
    return out.slice(0, opts?.limit ?? out.length) as T[];
  }

  async remove(table: string, filter: Filter) {
    this.t.set(table, this.rows(table).filter((r) => !this.match(r, filter)));
  }
}

/** Supabase when DB=supabase (the default when credentials exist), otherwise in-memory. */
export function makeDb(): Db {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const mode = process.env.DB ?? process.env.LEDGER_STORE ?? (url && key ? "supabase" : "memory");
  if (mode === "supabase") {
    if (!url || !key) throw new Error("DB=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY");
    return new SupabaseDb(url, key);
  }
  return new MemoryDb();
}
