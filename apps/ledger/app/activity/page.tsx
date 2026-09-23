import type { Metadata } from "next";
import Link from "next/link";
import {
  EXPLORER,
  STATUS_LABEL,
  countVaults,
  listExecutions,
  reasonFor,
  relTimeEn,
  short,
  stepTitle,
  type Execution,
} from "@/lib/data";
import { NETWORK_LABEL } from "@/lib/network";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const TONE: Record<Execution["status"], "ok" | "warn" | "bad" | "idle"> = {
  executed: "ok",
  rejected_policy: "warn",
  reverted: "bad",
  pending: "idle",
};

function StatusIcon({ status }: { status: Execution["status"] }) {
  return (
    <span className={`feed-ic ${TONE[status]}`} aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
        {status === "executed" ? (
          <path d="M4 12.5l5 5L20 6.5" />
        ) : status === "pending" ? (
          <path d="M12 7v5l3 2" />
        ) : (
          <path d="M6 6l12 12M18 6 6 18" />
        )}
      </svg>
    </span>
  );
}

function describe(r: Execution): string {
  if (r.status === "executed") return "Proof verified by the vault contract, then executed.";
  if (r.status === "reverted") return `${reasonFor(r.reject_code)} Pushed onchain with a forged proof and reverted.`;
  if (r.status === "rejected_policy") return `${reasonFor(r.reject_code)} No proof, nothing sent.`;
  return "Waiting for its proof.";
}

export default async function Activity({ searchParams }: { searchParams: Promise<{ vault?: string }> }) {
  const { vault } = await searchParams;
  let rows: Execution[] = [];
  let vaults = 0;
  let error: string | null = null;
  try {
    [rows, vaults] = await Promise.all([listExecutions(vault, 100, true), countVaults(true).catch(() => 0)]);
  } catch (e) {
    error = (e as Error).message;
  }
  const count = (s: Execution["status"]) => rows.filter((r) => r.status === s).length;

  return (
    <main className="wrap page">
      <h1>{vault ? `Vault ${short(vault)}` : "Every action, with its proof"}</h1>
      <p className="lede">
        What the agent did on {NETWORK_LABEL}, what the rules blocked, and what the contract rejected. Open any entry to
        see its checks and proof.
      </p>
      <div className="stats">
        {!vault && (
          <div className="stat">
            <b>{vaults}</b>
            <span>Vaults</span>
          </div>
        )}
        <div className="stat">
          <b>{count("executed")}</b>
          <span>Executed</span>
        </div>
        <div className="stat">
          <b>{count("rejected_policy")}</b>
          <span>Blocked by rules</span>
        </div>
        <div className="stat">
          <b>{count("reverted")}</b>
          <span>Rejected by contract</span>
        </div>
      </div>

      <div className="card">
        {error ? (
          <div className="empty">The log could not be loaded right now. Please try again in a moment.</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            No actions yet. <Link href="/app">Create a vault</Link> and give the agent its first task.
          </div>
        ) : (
          <ol className="feed">
            {rows.map((r) => (
              <li key={r.id}>
                <StatusIcon status={r.status} />
                <div className="feed-main">
                  <div className="feed-top">
                    <Link href={`/tx/${r.id}`} className="feed-title">
                      {stepTitle(r)}
                    </Link>
                    <span className={`badge b-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="feed-desc">{describe(r)}</p>
                  {r.task && <p className="feed-said">Asked: &ldquo;{r.task}&rdquo;</p>}
                </div>
                <div className="feed-meta mono">
                  <span>{relTimeEn(r.created_at)}</span>
                  {r.tx_hash ? (
                    <a href={`${EXPLORER}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">
                      {short(r.tx_hash, 4)}
                    </a>
                  ) : (
                    <Link href={`/tx/${r.id}`}>details</Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
