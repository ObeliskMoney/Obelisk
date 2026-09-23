import Link from "next/link";
import { notFound } from "next/navigation";
import {
  EXPLORER,
  STATUS_LABEL,
  decodePublicValues,
  deployment,
  getExecution,
  reasonFor,
  stepTitle,
  short,
  usdc,
  type Execution,
} from "@/lib/data";

export const revalidate = 5;

type Mark = "ok" | "no" | "skip";

function checks(r: Execution): { mark: Mark; text: string }[] {
  const kind = r.attestation?.kind;
  const agent = {
    mark: "ok" as Mark,
    text: `Signed by agent key ${short(r.agent)} (${kind === "tdx" ? "key issued by dstack" : "dev key, no TEE"})`,
  };
  const why = reasonFor(r.reject_code);
  if (r.status === "executed") {
    return [
      agent,
      { mark: "ok", text: "Agent key registered and active in the AgentRegistry, and allowed by this vault" },
      { mark: "ok", text: `Zero-knowledge proof valid for the policy program (${r.prover === "mock" ? "mock proof, dev only" : "Groth16"})` },
      { mark: "ok", text: "Public values match the intent, the vault's rules and today's spending onchain" },
      { mark: "ok", text: "Fresh nonce, deadline not passed, executed" },
    ];
  }
  if (r.status === "rejected_policy") {
    return [
      agent,
      { mark: "no", text: `The rules check refused to create a proof. ${why}` },
      { mark: "skip", text: "Without a proof there was nothing the vault would accept, so nothing was sent" },
    ];
  }
  if (r.status === "reverted") {
    return [
      agent,
      { mark: "no", text: `The rules check refused. ${why}` },
      { mark: "no", text: `Pushed onchain anyway with a forged proof, and the vault reverted it (${r.reject_code?.split("→").pop()?.trim()})` },
    ];
  }
  return [agent];
}

export default async function Tx({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getExecution(id);
  if (!r) notFound();
  const pv = decodePublicValues(r.public_values);

  return (
    <main className="wrap page">
      <Link href="/activity" className="back">All activity</Link>
      <div className="hero-status">
        <h1 style={{ margin: 0 }}>{stepTitle(r)}</h1>
        <span className={`badge b-${r.status}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      {r.task && <p className="lede">Asked: &ldquo;{r.task}&rdquo;</p>}

      <div className="section-title">Checks</div>
      <div className="card">
        <ul className="checks">
          {checks(r).map((c, i) => (
            <li key={i}>
              <span className={`ic ${c.mark}`} aria-label={c.mark}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
                  {c.mark === "ok" ? <path d="M4 12.5l5 5L20 6.5" /> : c.mark === "no" ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M6 12h12" />}
                </svg>
              </span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid2">
        <div>
          <div className="section-title">Intent</div>
          <div className="card">
            <dl>
              <dt>Target</dt><dd className="mono">{r.target}</dd>
              <dt>Function</dt><dd className="mono">{r.selector}</dd>
              <dt>Amount</dt><dd>{usdc(r.amount)}</dd>
              <dt>Nonce</dt><dd className="mono">{short(r.nonce, 8)}</dd>
              <dt>Intent hash</dt><dd className="mono">{r.intent_hash}</dd>
              <dt>Transaction</dt>
              <dd className="mono">
                {r.tx_hash ? <a href={`${EXPLORER}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">{short(r.tx_hash, 10)}</a> : "not sent onchain"}
                {r.block_number ? `, block ${r.block_number}` : ""}
              </dd>
            </dl>
          </div>
        </div>
        <div>
          <div className="section-title">Proof</div>
          <div className="card">
            <dl>
              <dt>Prover</dt><dd>{r.prover ?? "n/a"}</dd>
              <dt>Policy hash</dt><dd className="mono">{r.policy_hash}</dd>
              <dt>Program vkey (current)</dt><dd className="mono">{deployment.programVKey}</dd>
              <dt>Spent before</dt><dd>{usdc(pv ? pv.spentBefore.toString() : r.spent_before)}</dd>
              <dt>Spent after</dt><dd>{usdc(pv ? pv.spentAfter.toString() : r.spent_after)}</dd>
              <dt>Proof</dt><dd className="mono">{r.proof ? `${short(r.proof, 10)} (${Math.max(0, (r.proof.length - 2) / 2)} bytes)` : "n/a"}</dd>
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
