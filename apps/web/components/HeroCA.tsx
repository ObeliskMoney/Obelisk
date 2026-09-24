"use client";

import Link from "next/link";
import { useState } from "react";
import { EXPLORER, OBSK } from "@/lib/network";

/** The official $OBSK contract in the hero: copy it, check it on the explorer, or open /token for details. */
export function HeroCA() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(OBSK.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="hero-ca">
      <div className="hero-ca-top">
        <span className="hero-ca-ticker">${OBSK.ticker}</span>
        <span className="hero-ca-label">
          Official contract<span className="hero-ca-chain"> · Robinhood Chain</span>
        </span>
        <Link className="hero-ca-more" href="/token">
          Details
        </Link>
      </div>
      <div className="hero-ca-row">
        <button type="button" className="hero-ca-addr" onClick={copy} title="Copy the contract address">
          <span className="full">{OBSK.address}</span>
          <span className="short">
            {OBSK.address.slice(0, 10)}…{OBSK.address.slice(-8)}
          </span>
        </button>
        <button type="button" className={`hero-ca-copy${copied ? " done" : ""}`} onClick={copy} aria-label="Copy the contract address">
          {copied ? (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
                <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
                <rect x="8" y="8" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              Copy
            </>
          )}
        </button>
        <a
          className="hero-ca-ext"
          href={`${EXPLORER}/token/${OBSK.address}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View the contract on the Robinhood Chain explorer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </a>
      </div>
    </div>
  );
}
