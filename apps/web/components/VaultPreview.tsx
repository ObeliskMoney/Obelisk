"use client";

/**
 * Product shot in the hero: a snapshot of a REAL vault on Robinhood Chain mainnet (23 Sep 2026),
 * with real, clickable transaction hashes. Adapted from a 21st AI generation (lucide → SVG, Tailwind → site CSS).
 * The 3D hover tilt is disabled under prefers-reduced-motion.
 */
import { useRef, useState } from "react";
import { EXPLORER, TOKEN } from "@/lib/network";

type Step = { ok: boolean; label: string; hash?: string; reason?: string };
type Task = { command: string; steps?: Step[]; reply?: string };

const TX_ALLOW = "0xe61c59b4967066e1450042823262aea36af3a247047754ebc6db1e5ca6c4c020";
const TX_SWAP = "0xa6deac6b099434d5e3a8d9de2b06cb8802de337421c4311bc88ae1316acc606d";

const TASKS: Task[] = [
  {
    command: `swap 2 ${TOKEN} to ETH`,
    steps: [
      { ok: true, label: "Allowance for the exchange", hash: TX_ALLOW },
      { ok: true, label: `Swap 2 ${TOKEN} to ETH`, hash: TX_SWAP },
    ],
  },
  {
    command: `swap 4 ${TOKEN} to ETH`,
    steps: [{ ok: false, label: `Swap 4 ${TOKEN} to ETH`, reason: "Above the daily limit. No proof, nothing sent." }],
  },
  { command: "what is my balance?", reply: `Vault balance: 3 ${TOKEN} and 0.000736 ETH. Spent today: 2 of 5 ${TOKEN}.` },
];

const short = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`;

function I({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const CHECK = "M4 12.5l5 5L20 6.5";
const WARN = "M12 3 2 20h20L12 3Zm0 6v5m0 3v.5";
const ARROW = "M5 12h14m-5-5 5 5-5 5";
const CHAT = "M4 5h16v11H9l-5 4V5Z";

export function VaultPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, on: false });

  const move = (e: React.MouseEvent) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setTilt({ x: dy * -3, y: dx * 3, on: true });
  };

  return (
    <div
      ref={ref}
      className="vp"
      onMouseMove={move}
      onMouseLeave={() => setTilt({ x: 0, y: 0, on: false })}
      style={{
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: tilt.on ? "transform .08s ease-out" : "transform .4s ease-out",
      }}
    >
      <div className="vp-head">
        <span className="vp-name">
          <span className="vp-logo" aria-hidden>
            <I d="M12 4v4m-6 4h12v8H6v-8Zm3 3v1m6-1v1M9 4h6" size={13} />
          </span>
          Main vault
        </span>
        <span className="vp-live mono">
          <span className="vp-live-dot" aria-hidden /> Agent active
        </span>
      </div>

      <div className="vp-stats">
        <div>
          <span className="vp-k mono">{TOKEN}</span>
          <b>3</b>
        </div>
        <div>
          <span className="vp-k mono">ETH</span>
          <b>0.000736</b>
        </div>
        <div>
          <span className="vp-k mono">Spent today</span>
          <b>2 / 5 {TOKEN}</b>
          <span className="vp-bar">
            <i style={{ width: "40%" }} />
          </span>
        </div>
      </div>

      {TASKS.map((t) => (
        <div key={t.command} className="vp-task">
          <p className="vp-cmd mono">
            <I d={ARROW} size={13} />
            {t.command}
          </p>
          {t.steps?.map((s) => (
            <div key={s.label} className={`vp-step${s.ok ? " ok" : " warn"}`}>
              <I d={s.ok ? CHECK : WARN} size={14} />
              <div className="vp-step-main">
                <span className="vp-state mono">{s.ok ? "Executed" : "Blocked by rules"}</span>
                <span className="vp-label">{s.label}</span>
                {s.reason && <span className="vp-reason">{s.reason}</span>}
              </div>
              {s.hash && (
                <a className="vp-hash mono" href={`${EXPLORER}/tx/${s.hash}`} target="_blank" rel="noreferrer">
                  {short(s.hash)}
                </a>
              )}
            </div>
          ))}
          {t.reply && (
            <p className="vp-reply">
              <I d={CHAT} size={13} />
              {t.reply}
            </p>
          )}
        </div>
      ))}

      <div className="vp-foot">
        <span>A real vault on Robinhood Chain</span>
        <span>Snapshot, 23 Sep 2026</span>
      </div>
    </div>
  );
}
