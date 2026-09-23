import { decodeAbiParameters, formatUnits, type Hex } from "viem";
import deployment from "./deployment.json";
import { EXPLORER, TOKEN } from "./network";

export { deployment };

export type Status = "pending" | "executed" | "rejected_policy" | "reverted";

export interface Execution {
  id: string;
  created_at: string;
  chain_id: number;
  vault: string;
  agent: string | null;
  task: string | null;
  action: string | null;
  target: string | null;
  selector: string | null;
  calldata: string | null;
  amount: string | null;
  nonce: string | null;
  intent_hash: string | null;
  policy_hash: string | null;
  status: Status;
  reject_code: string | null;
  reject_reason: string | null;
  spent_before: string | null;
  spent_after: string | null;
  day: number | null;
  prover: string | null;
  public_values: string | null;
  proof: string | null;
  tx_hash: string | null;
  block_number: number | null;
  attestation: { kind?: string } | null;
}

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * `numeric` columns (nonce, amounts) are read as text: PostgREST sends them as JSON numbers,
 * and a 128-bit nonce would lose precision (and not be a string) if read as a number.
 */
const COLS =
  "*,nonce:nonce::text,amount:amount::text,spent_before:spent_before::text,spent_after:spent_after::text";

async function query<T>(path: string, fresh = false): Promise<T> {
  if (!URL || !KEY) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY is not set");
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 5 } }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Vault from an old deployment (MockVerifier); hidden so it does not mislead. */
// The old executor stored checksummed (mixed-case) addresses, so both forms are listed.
const RETIRED_VAULTS = ["0x33f0a089797a40c0e4f4a124404aa795ea76ce5a", "0x33F0a089797A40C0E4f4A124404aa795eA76CE5A"];
const notRetired = `vault=not.in.(${RETIRED_VAULTS.join(",")})`;

export function listExecutions(vault?: string, limit = 100, fresh = false) {
  const f = vault && /^0x[0-9a-fA-F]{40}$/.test(vault) ? `vault=eq.${vault.toLowerCase()}&` : `${notRetired}&`;
  return query<Execution[]>(
    `executions?select=${COLS}&${f}chain_id=eq.${deployment.chainId}&order=created_at.desc&limit=${limit}`,
    fresh,
  );
}

/** Counts per status, computed from the real data in Supabase (never hard-coded numbers). */
export async function executionCounts() {
  const rows = await query<{ status: Status }[]>(
    `executions?select=status&${notRetired}&chain_id=eq.${deployment.chainId}&limit=10000`,
  );
  const c = { executed: 0, rejected_policy: 0, reverted: 0, pending: 0 } as Record<Status, number>;
  for (const r of rows) c[r.status]++;
  return c;
}

export async function countVaults(fresh = false): Promise<number> {
  const rows = await query<{ address: string }[]>(`vaults?select=address&chain_id=eq.${deployment.chainId}`, fresh);
  return rows.length;
}

export async function getExecution(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query<Execution[]>(`executions?select=${COLS}&id=eq.${id}&limit=1`, true);
  return rows[0] ?? null;
}

export { EXPLORER };

export function usdc(v: string | null | undefined): string {
  if (v == null) return "n/a";
  const n = BigInt(v);
  if (n > 10n ** 30n) return "unlimited";
  return `${Number(formatUnits(n, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${TOKEN}`;
}

export function short(v: string | number | null | undefined, n = 6): string {
  if (v == null || v === "") return "n/a";
  const h = String(v);
  return h.length <= 2 * n + 2 ? h : `${h.slice(0, n + 2)}…${h.slice(-n)}`;
}

export const STATUS_LABEL: Record<Status, string> = {
  executed: "Executed",
  rejected_policy: "Blocked by rules",
  reverted: "Rejected by contract",
  pending: "Pending",
};

export const ACTION_LABEL: Record<string, string> = {
  swap_usdc_to_eth: `Swap ${TOKEN} to ETH`,
  transfer_usdc: `Send ${TOKEN}`,
  approve_usdc: `Approve ${TOKEN}`,
};

export { REASON, reasonFor } from "./reasons";

/** Title of one onchain step from an execution record, for example "Swap 2 USDG to ETH". */
export function stepTitle(r: Pick<Execution, "selector" | "amount" | "action">): string {
  if (r.selector === "0x095ea7b3") return "Allowance for the exchange";
  if (r.selector === "0xa9059cbb") return `Send ${usdc(r.amount)}`;
  if (r.selector === "0x04e45aaf") return `Swap ${usdc(r.amount)} to ETH`;
  return ACTION_LABEL[r.action ?? ""] ?? r.action ?? "Action";
}

export function decodePublicValues(pv: string | null) {
  if (!pv || pv === "0x") return null;
  try {
    const [o] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "policyHash", type: "bytes32" },
            { name: "intentHash", type: "bytes32" },
            { name: "spentBefore", type: "uint256" },
            { name: "spentAfter", type: "uint256" },
            { name: "day", type: "uint64" },
          ],
        },
      ],
      pv as Hex,
    );
    return o;
  } catch {
    return null;
  }
}

export function relTimeEn(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
