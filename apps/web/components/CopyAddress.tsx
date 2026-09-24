"use client";

import { useState } from "react";

/** An address people are meant to copy exactly (for example the token contract), with a copy button. */
export function CopyAddress({ address, short = false }: { address: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  const shown = short ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return (
    <span className="copy-addr">
      <span className="mono" title={address}>
        {shown}
      </span>
      <button
        type="button"
        className="btn small ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={`Copy ${address}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
