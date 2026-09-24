import { IS_MAINNET, TEE_SIMULATED, TOKEN } from "@/lib/network";

const ITEMS: { q: string; a: string }[] = [
  {
    q: "Can the AI steal my money?",
    a: "No. In the worst case it spends up to your daily limit, and only on swaps whose output returns to your vault or on payments to people you approved yourself.",
  },
  {
    q: "What is a zero-knowledge proof doing here?",
    a: "It is a small cryptographic receipt showing that a transaction follows your rules. The vault contract checks it without having to trust the agent or us. A transaction without a valid receipt is rejected.",
  },
  {
    q: "Is this real money?",
    a: IS_MAINNET
      ? `Yes. Obelisk runs on Robinhood Chain mainnet with ${TOKEN}, a dollar stablecoin. It is beta software and the contracts have not had a third-party audit yet, so only deposit what you can afford to lose.`
      : "Not yet. Obelisk runs on Robinhood Chain testnet. You mint test USDC in the app, and it has no value.",
  },
  {
    q: "Does the agent run in secure hardware?",
    a: TEE_SIMULATED
      ? "Not yet. The agent key is issued by dstack, but today it runs in dstack's simulator on our server, not inside Intel TDX hardware. Your limits do not depend on it: even with a leaked agent key, nothing moves without a proof that the transaction follows your rules."
      : "Yes. The agent runs in an Intel TDX enclave through dstack, and its key never leaves the enclave. The attestation is checked before the key is registered onchain.",
  },
  {
    q: "Why does an action take a while?",
    a: "Generating a proof currently takes about 15 minutes per step on our server. You can close the page while it works, and scheduled tasks run in the background.",
  },
  {
    q: "What happens if Obelisk goes offline?",
    a: "Your funds stay in your own vault contract. You can withdraw directly with your wallet at any time. The agent is only needed to act on your behalf.",
  },
  {
    q: "Who can see my commands?",
    a: "Commands and their results are public in the activity log. Do not put personal information in them.",
  },
];

export function Faq() {
  return (
    <div className="faq">
      {ITEMS.map((it, i) => (
        <details key={i} name="faq">
          <summary>
            <span>{it.q}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="faq-icon">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </summary>
          <p>{it.a}</p>
        </details>
      ))}
    </div>
  );
}
