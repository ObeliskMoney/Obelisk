"use client";

import Image from "next/image";
import { Reveal, WordsPullUp } from "./motion";
import { SectionLabel } from "./ui";

const CARDS = [
  {
    n: "01",
    title: "Limits.",
    icon: (
      <path d="M4 18h16M7 18V9M12 18V5M17 18v-6" />
    ),
    items: [
      "A cap on every single transaction",
      "A daily cap that resets at 00:00 UTC",
      "Spending approvals capped at the daily limit",
      "No ETH can be sent out of the vault",
    ],
  },
  {
    n: "02",
    title: "Destinations.",
    icon: (
      <>
        <circle cx="9" cy="9" r="3" />
        <path d="M4 19c.8-3 2.7-4.5 5-4.5s4.2 1.5 5 4.5M15 11l2 2 4-4" />
      </>
    ),
    items: [
      "Pays only addresses you approved",
      "Swaps only through the approved exchange",
      "Swap output always returns to your vault",
      "No other contract can be called",
    ],
  },
  {
    n: "03",
    title: "Control.",
    icon: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="1.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    items: [
      "Only your wallet can give orders",
      "Withdraw everything at any time",
      "One click stops the agent and its schedules",
      "Every action and refusal is logged publicly",
    ],
  },
];

export function Rules() {
  return (
    <section id="rules" className="ag-sec" aria-labelledby="rules-title">
      <div className="ag-wrap">
        <SectionLabel n={3}>What every proof must show</SectionLabel>
        <h2 id="rules-title" className="ag-h2">
          <WordsPullUp segments={[{ text: "Rules the agent can't talk its way around." }]} />
          <WordsPullUp segments={[{ text: "Proven in zero knowledge, checked onchain." }]} className="muted-line" startDelay={0.25} />
        </h2>
        <div className="lx-cards">
          <Reveal className="lx-card lx-card-img">
            <Image src="/brand/banner.jpg" alt="" fill sizes="(max-width: 860px) 100vw, 25vw" className="lx-card-bg" />
            <p className="lx-card-caption">Your vault. Your rules.</p>
          </Reveal>
          {CARDS.map((c, i) => (
            <Reveal key={c.n} className="lx-card" delay={(i + 1) * 0.12}>
              <div className="lx-card-top">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  {c.icon}
                </svg>
                <span className="mono lx-card-n">{c.n}</span>
              </div>
              <h3>{c.title}</h3>
              <ul>
                {c.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
