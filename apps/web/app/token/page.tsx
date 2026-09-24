import type { Metadata } from "next";
import Link from "next/link";
import { CopyAddress } from "@/components/CopyAddress";
import { EXPLORER, OBSK, X_URL } from "@/lib/network";

export const metadata: Metadata = {
  title: "$OBSK token",
  description: "The official Obelisk token contract on Robinhood Chain. Check the address before you trade.",
};

const ROWS: [string, React.ReactNode][] = [
  ["Ticker", <b key="t">${OBSK.ticker}</b>],
  ["Name", OBSK.name],
  ["Chain", "Robinhood Chain (mainnet)"],
  ["Contract", <CopyAddress key="c" address={OBSK.address} />],
  ["Total supply", `${OBSK.supply} ${OBSK.ticker}`],
  ["Decimals", String(OBSK.decimals)],
];

export default function Token() {
  return (
    <main className="wrap page prose">
      <h1>${OBSK.ticker}</h1>
      <p className="lede">
        This is the only official Obelisk token. Check the contract address below before you buy, sell or add it to a
        wallet. Anything with the same name or ticker at another address is not ours.
      </p>

      <div className="card">
        <dl>
          {ROWS.map(([k, v]) => (
            <div key={k} className="contract-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="small">
        <a href={`${EXPLORER}/token/${OBSK.address}`} target="_blank" rel="noreferrer">
          View ${OBSK.ticker} on the Robinhood Chain explorer
        </a>
      </p>

      <h2>Stay safe</h2>
      <ul className="plain-list">
        <li>
          We publish the contract address only on this page and on{" "}
          <a href={X_URL} target="_blank" rel="noreferrer">
            @Obeliskdotmoney
          </a>
          . Copies with the same name or ticker are not ours.
        </li>
        <li>We will never message you first, and never ask for your seed phrase, private keys or agent keys.</li>
        <li>There is no presale, airdrop or claim page. Anyone offering one is not Obelisk.</li>
      </ul>

      <h2>What ${OBSK.ticker} is not</h2>
      <ul className="plain-list">
        <li>
          You do not need ${OBSK.ticker} to use Obelisk. Vaults, agent keys, the SDK and the MCP server all work without
          it.
        </li>
        <li>
          It gives no share of Obelisk, no claim on its revenue and no control over any vault. Your vault&apos;s rules
          are set only by your wallet.
        </li>
        <li>
          Crypto tokens are volatile and can lose all their value. Nothing on this page is financial advice.
        </li>
      </ul>

      <p>
        Questions? Ask us on{" "}
        <a href={X_URL} target="_blank" rel="noreferrer">
          X
        </a>{" "}
        or read how Obelisk keeps your funds safe on the <Link href="/security">security page</Link>.
      </p>
    </main>
  );
}
