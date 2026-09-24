"use client";

import Link from "next/link";
import { IS_MAINNET } from "@/lib/network";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";
import { ActionLink } from "./ui";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/activity", label: "Activity" },
  { href: "/status", label: "Status" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className={`nav-wrap${path === "/" ? " over" : ""}`}>
      <nav className="nav-bar" aria-label="Main">
        <div className="nav-left">
          <Link href="/" className="nav-brand" aria-label="Obelisk home">
            <span className="nav-mark">
              <LogoMark size={20} ring={false} />
            </span>
            <span>Obelisk</span>
          </Link>
          <div className="nav-links">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="nav-right">
          <span className="nav-status">
            <span className="live-dot" aria-hidden /> {IS_MAINNET ? "Beta on Robinhood Chain" : "Testnet live on Robinhood Chain"}
          </span>
          <ActionLink href="/app" variant="dark">
            Open app
          </ActionLink>
          <button className="nav-menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              {open ? <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.6" /> : <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" />}
            </svg>
          </button>
        </div>
      </nav>
      {open && (
        <div className="nav-sheet">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <ActionLink href="/app">Create a vault</ActionLink>
        </div>
      )}
    </header>
  );
}
