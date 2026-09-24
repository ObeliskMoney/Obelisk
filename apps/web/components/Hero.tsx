"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT_EXPO } from "./motion";
import { HeroShader } from "./HeroShader";
import { VaultPreview } from "./VaultPreview";
import { ActionLink } from "./ui";
import { HeroCA } from "./HeroCA";
import { EXPLORER } from "@/lib/network";

/** `proofTx` = the latest verified transaction from the ledger; the chip is hidden if there is none. */
export function Hero({ proofTx }: { proofTx?: string | null }) {
  const reduce = useReducedMotion();
  const fade = (delay: number) => ({
    initial: reduce ? false : { y: 24, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { duration: 0.9, delay, ease: EASE_OUT_EXPO },
  });
  return (
    <section className="ag-hero" aria-labelledby="hero-title">
      {/* Background: our own WebGL shader; the CSS layers below are the fallback without WebGL */}
      <div className="ag-flow" aria-hidden>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="ag-flutes" aria-hidden />
      <HeroShader />
      <div className="grain" aria-hidden style={{ opacity: 0.35 }} />

      <div className="ag-hero-body">
        <div className="ag-hero-grid">
        <div className="ag-hero-copy">
        <motion.p className="ag-kicker" {...fade(0.1)}>
          Spending limits for AI agents
        </motion.p>
        <motion.h1 id="hero-title" className="ag-h1" {...fade(0.2)}>
          Your AI agent can&apos;t spend
          <br className="br-lg" /> more than you allow.
        </motion.h1>
        <motion.p className="ag-lead" {...fade(0.3)}>
          Set the limits and the people it can pay. Every transaction needs a zero-knowledge proof that it follows them,
          or the vault contract rejects it.
        </motion.p>
        <motion.div className="ag-cta" {...fade(0.4)}>
          <ActionLink href="/app">Create a vault</ActionLink>
          {proofTx && (
          <a className="fact-chip" href={`${EXPLORER}/tx/${proofTx}`} target="_blank" rel="noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 2 20 6v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6Z" fill="var(--accent)" />
              <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="2" />
            </svg>
            <span>Proofs verified onchain</span>
            <span className="fact-tag">See a real tx</span>
          </a>
          )}
        </motion.div>
        <motion.div {...fade(0.45)}>
          <HeroCA />
        </motion.div>
        </div>
        <motion.div className="ag-hero-product" {...fade(0.5)}>
          <VaultPreview />
        </motion.div>
        </div>
      </div>
    </section>
  );
}
