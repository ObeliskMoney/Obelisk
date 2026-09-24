import Link from "next/link";
import { IS_MAINNET, REPO_URL, X_URL } from "@/lib/network";
import { LogoMark } from "./Logo";
import { FooterHeadline } from "./FooterHeadline";
import { ActionLink } from "./ui";

const COLS: { h: string; links: [string, string][] }[] = [
  { h: "Product", links: [["App", "/app"], ["Activity", "/activity"], ["Status", "/status"]] },
  { h: "Trust", links: [["Security", "/security"], ["Contracts", "/security#contracts"], ["Source code", REPO_URL]] },
  { h: "Help", links: [["How to use it", "/guide"], ["FAQ", "/#faq"]] },
  { h: "Follow", links: [["X (@Obeliskdotmoney)", X_URL], ["GitHub", "https://github.com/ObeliskMoney"]] },
];

export function SiteFooter() {
  return (
    <footer className="site-foot dark">
      <div className="ag-wrap">
        <div className="foot-cta">
          <div>
            <p className="sec">
              <span className="sec-num">
                <LogoMark size={14} ring={false} />
              </span>
              <span className="sec-txt">{IS_MAINNET ? "Start small" : "Start on testnet"}</span>
            </p>
            <FooterHeadline />
          </div>
          <div className="foot-cta-right">
            <ActionLink href="/app">Create a vault</ActionLink>
            <span className="muted small">{IS_MAINNET ? "Beta. Deposit only what you can afford to lose." : "Test funds only. Takes about two minutes."}</span>
          </div>
        </div>
        <div className="foot-grid">
          <div className="foot-brand">
            <span className="nav-brand">
              <span className="nav-mark light">
                <LogoMark size={20} ring={false} />
              </span>
              <span>Obelisk</span>
            </span>
            <p className="muted small">A vault for AI agents with spending limits enforced by the contract.</p>
            <p className="foot-status small">
              <span className="live-dot" aria-hidden /> {IS_MAINNET ? "Beta on Robinhood Chain" : "Testnet live on Robinhood Chain"}
            </p>
          </div>
          {COLS.map((c) => (
            <nav key={c.h} aria-label={c.h} className="foot-col">
              <p className="foot-h">{c.h}</p>
              {c.links.map(([label, href]) =>
                href.startsWith("http") ? (
                  <a key={label} href={href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  <Link key={label} href={href}>
                    {label}
                  </Link>
                ),
              )}
            </nav>
          ))}
        </div>
        <p className="foot-mark" aria-hidden>
          Obelisk
        </p>
        <div className="foot-base small">
          <span>&copy; 2026 Obelisk. Open source under the MIT license.</span>
          <span>{IS_MAINNET ? "Beta software without a third-party audit. Not financial advice." : "Testnet only. Not financial advice."}</span>
        </div>
      </div>
    </footer>
  );
}
