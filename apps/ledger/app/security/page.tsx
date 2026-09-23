import type { Metadata } from "next";
import Link from "next/link";
import deployment from "@/lib/deployment.json";
import { EXPLORER, NETWORK_LABEL, TEE_SIMULATED, TOKEN } from "@/lib/network";

export const metadata: Metadata = {
  title: "Security",
  description: "How Obelisk keeps an AI agent inside your limits, the contracts it runs on, and what is not finished yet.",
};

const REPO = "https://github.com/ObeliskMoney/Obelisk";

const CONTRACTS: [string, string, string][] = [
  ["Vault factory", deployment.factory, "Creates vaults and records who owns them."],
  ["Agent registry", deployment.registry, "Lists agent keys that passed the attestation check."],
  ["Proof verifier", deployment.verifier, "Succinct SP1 Groth16 verifier. Checks every proof."],
  [`${TOKEN} token`, deployment.usdc, "The stablecoin your limits are counted in."],
  ["Exchange router", deployment.router, "The only contract the agent may swap through."],
];

export default function Security() {
  return (
    <main className="wrap page prose">
      <h1>How Obelisk is secured</h1>
      <p className="lede">
        The short version: your limits live in a contract, and the contract only moves money when it receives a
        zero-knowledge proof that the transaction follows them. The agent never gets a way around that check.
      </p>

      <h2>Three checks on every transaction</h2>
      <ol className="plain-list">
        <li>
          <b>Signed by a registered agent.</b> The agent signs each transaction with a key issued by dstack. The key is
          registered onchain only after its attestation is checked, and you can switch the agent off for your vault at any
          time.
        </li>
        <li>
          <b>Proven to follow your rules.</b> An SP1 program checks the transaction against your limits, allowed payees,
          the exchange and the swap output. If any rule fails, no proof can exist.
        </li>
        <li>
          <b>Verified by the vault contract.</b> The vault verifies the proof onchain, checks it belongs to this exact
          transaction, vault and day, and only then executes. Anything else reverts.
        </li>
      </ol>

      <h2>What this protects against</h2>
      <ul className="plain-list">
        <li>Prompt injection: an agent tricked into sending money elsewhere cannot produce a valid proof.</li>
        <li>Mistakes: amounts above your per-transaction or daily limit are refused.</li>
        <li>A leaked agent key: the key alone cannot move funds without a proof that the rules hold.</li>
        <li>Replays: every proof is tied to one transaction, one vault, one chain and one day.</li>
      </ul>

      <h2 id="contracts">Contracts on {NETWORK_LABEL}</h2>
      <div className="card">
        <dl>
          {CONTRACTS.map(([name, addr, what]) => (
            <div key={name} className="contract-row">
              <dt>{name}</dt>
              <dd>
                <a className="mono" href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                  {addr}
                </a>
                <span className="muted small">{what}</span>
              </dd>
            </div>
          ))}
          <div className="contract-row">
            <dt>Policy program</dt>
            <dd>
              <span className="mono">{deployment.programVKey}</span>
              <span className="muted small">Verification key of the SP1 program that checks the rules.</span>
            </dd>
          </div>
        </dl>
      </div>

      <h2>What is not finished yet</h2>
      <p>Obelisk is in beta. These are the known limits today, so you can decide how much to trust it with.</p>
      <ul className="plain-list">
        <li>
          <b>No third-party audit yet.</b> The contracts and the SP1 program have tests and a self-review, but no
          independent audit. Deposit only what you can afford to lose.
        </li>
        {TEE_SIMULATED && (
          <li>
            <b>The agent runs in dstack&apos;s simulator,</b> not in Intel TDX hardware. Someone with access to our
            server could read the agent key. Your limits still hold, because the key alone cannot pass the proof check.
          </li>
        )}
        <li>
          <b>Proofs are slow.</b> Each step takes about 15 minutes on our prover, and there is one queue for everyone.
        </li>
        <li>
          <b>Price protection is set by the agent.</b> Swaps must carry a minimum output, which the agent sets from a
          live Uniswap quote with 2% tolerance. The proof requires a minimum but does not check it against a price
          oracle, so a bad price can cost at most what your daily limit allows.
        </li>
        <li>
          <b>One operator key</b> registers agents. It cannot move vault funds. Moving it to a multisig is planned.
        </li>
      </ul>

      <h2>Check it yourself</h2>
      <p>
        Every action and every refusal is listed on the <Link href="/activity">activity page</Link>, and the code is
        open source on{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        . If you find a problem, please{" "}
        <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
          open an issue
        </a>
        .
      </p>
    </main>
  );
}
