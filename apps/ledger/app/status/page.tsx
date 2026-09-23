import type { Metadata } from "next";
import { CHAIN, EXPLORER, NETWORK_LABEL } from "@/lib/network";
import deployment from "@/lib/deployment.json";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const BASE = process.env.AGENT_API_URL ?? "http://127.0.0.1:8080/api";
const LOW_GAS_ETH = 0.002;

async function health() {
  try {
    const r = await fetch(`${BASE}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return (await r.json()) as Record<string, any>;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

type Level = "up" | "warn" | "down";

function Row({ name, level, state, detail }: { name: string; level: Level; state: string; detail: React.ReactNode }) {
  return (
    <li className="svc">
      <span className={`svc-dot ${level}`} aria-hidden />
      <div className="svc-main">
        <p className="svc-name">{name}</p>
        <p className="svc-detail">{detail}</p>
      </div>
      <span className={`svc-state ${level}`}>{state}</span>
    </li>
  );
}

export default async function Status() {
  const h = await health();
  const gas = h.executor?.balanceWei ? Number(BigInt(h.executor.balanceWei)) / 1e18 : 0;
  const mins = h.prover?.avgProofSecs ? Math.round(h.prover.avgProofSecs / 60) : null;

  const agent: Level = h.agent ? "up" : "down";
  const prover: Level = h.prover?.ok ? "up" : "down";
  const executor: Level = !h.executor?.ok ? "down" : gas <= LOW_GAS_ETH ? "warn" : "up";
  const levels = [agent, prover, executor];
  const overall: Level = levels.includes("down") ? "down" : levels.includes("warn") ? "warn" : "up";
  const checked = new Date().toUTCString().replace(" GMT", " UTC");

  return (
    <main className="wrap page">
      <h1>Service status</h1>
      <p className="lede">Checked live each time this page loads.</p>

      <div className={`status-banner ${overall}`}>
        <span className={`svc-dot ${overall}`} aria-hidden />
        <div>
          <p className="status-title">
            {overall === "up" ? "All systems working" : overall === "warn" ? "Working, needs attention" : "Something is down"}
          </p>
          <p className="status-sub">Last checked {checked}</p>
        </div>
      </div>

      <ul className="card svc-list">
        <Row
          name="Agent"
          level={agent}
          state={agent === "up" ? "Online" : "Offline"}
          detail={
            h.agent ? (
              <>
                <span className="mono addr">{h.agent}</span>
                <br />
                {h.attestation === "tdx"
                  ? h.teeSimulated
                    ? "Key from dstack, running in its simulator (no TDX hardware yet)."
                    : "Key from dstack inside an Intel TDX enclave."
                  : "Development key, no TEE."}{" "}
                {h.queue ? `${h.queue} task${h.queue === 1 ? "" : "s"} in queue.` : "Queue empty."}
              </>
            ) : (
              "The agent API did not answer."
            )
          }
        />
        <Row
          name="Prover"
          level={prover}
          state={prover === "up" ? (h.prover.pending ? "Proving" : "Idle") : "Offline"}
          detail={
            h.prover?.ok
              ? `SP1 zero-knowledge prover. ${h.prover.pending ?? 0} proof${h.prover.pending === 1 ? "" : "s"} in progress${
                  mins ? `, about ${mins} minutes per proof recently` : ""
                }.`
              : "The prover did not answer."
          }
        />
        <Row
          name="Executor"
          level={executor}
          state={executor === "down" ? "Offline" : executor === "warn" ? "Low on gas" : "Online"}
          detail={
            h.executor?.ok ? (
              <>
                Pays gas for vault transactions. Balance {gas.toFixed(5)} ETH.{" "}
                <a href={`${EXPLORER}/address/${h.executor.executor}`} target="_blank" rel="noreferrer">
                  View wallet
                </a>
              </>
            ) : (
              "The executor did not answer."
            )
          }
        />
        <Row
          name="Network"
          level="up"
          state={`Chain ${CHAIN.id}`}
          detail={
            <>
              {NETWORK_LABEL}. Contracts:{" "}
              <a href={`${EXPLORER}/address/${deployment.factory}`} target="_blank" rel="noreferrer">
                vault factory
              </a>
              ,{" "}
              <a href={`${EXPLORER}/address/${deployment.verifier}`} target="_blank" rel="noreferrer">
                proof verifier
              </a>
              .
            </>
          }
        />
      </ul>
    </main>
  );
}
