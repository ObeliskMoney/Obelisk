"use client";
/**
 * Wallet extension discovery through EIP-6963 (multi injected provider discovery).
 * Each extension (MetaMask, OKX, Rabby, Coinbase, Phantom, ...) announces itself,
 * so users can choose even when several wallets are installed. No library.
 * Older browsers or wallets that only inject `window.ethereum` still show up as "Browser wallet".
 */
import { useEffect, useState } from "react";

export type Eth = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, f: (...a: any[]) => void) => void;
  removeListener?: (e: string, f: (...a: any[]) => void) => void;
};

export interface WalletOption {
  /** The wallet's reverse-DNS id, for example io.metamask or com.okex.wallet. */
  rdns: string;
  name: string;
  /** Icon data URI provided by the wallet itself. */
  icon?: string;
  provider: Eth;
}

const LAST = "obelisk:wallet";

export function rememberWallet(rdns: string | null) {
  try {
    if (rdns) localStorage.setItem(LAST, rdns);
    else localStorage.removeItem(LAST);
  } catch {}
}

export function lastWallet(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export function useWallets(): WalletOption[] {
  const [list, setList] = useState<WalletOption[]>([]);
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const push = () => setList([...found.values()]);
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as { info?: { rdns?: string; name?: string; icon?: string }; provider?: Eth };
      if (!d?.provider || !d.info?.rdns) return;
      found.set(d.info.rdns, { rdns: d.info.rdns, name: d.info.name ?? d.info.rdns, icon: d.info.icon, provider: d.provider });
      push();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Older wallets without EIP-6963: show window.ethereum if nothing announced itself.
    const t = setTimeout(() => {
      const legacy = (window as any).ethereum as Eth | undefined;
      if (!found.size && legacy) {
        found.set("injected", { rdns: "injected", name: "Browser wallet", provider: legacy });
        push();
      }
    }, 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, []);
  return list;
}
