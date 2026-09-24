import type { Metadata } from "next";
import Link from "next/link";
import deployment from "@/lib/deployment.json";
import { EXPLORER, NETWORK_LABEL, REPO_URL as REPO, TEE_SIMULATED, TOKEN } from "@/lib/network";

export const metadata: Metadata = {
  title: "Security",
  description: "How Obelisk keeps an AI agent inside your limits, the contracts it runs on, and what is not finished yet.",
};

const CONTRACTS: [string, string, string][] = [
  ["Vault factory", deployment.factory, "Creates vaults and records who owns them."],
  ...(deployment.legacyFactories ?? []).map(
    (f): [string, string, string] => ["Earlier vault factory", f, "Made vaults before policy v3. Their owners move them to the current rules in the app."],
  ),
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
        The short version: your rules are checked by an open-source SP1 program, and your vault contract only lets the
        agent move money when it receives a zero-knowledge proof from that program that the transaction follows them.
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

      {deployment.vaultVersion === 4 && (
        <>
          <h2>Checked twice</h2>
          <p>
            Vaults made since vault v4 do not rely on the proof alone. The vault contract keeps its own copy of your
            limits and checks every call itself:
          </p>
          <ul className="plain-list">
            <li>
              <b>Which calls.</b> Only an approval for the exchange (up to your daily limit), a payment to one of your
              payees, or a swap of {TOKEN} whose output comes back to the vault.
            </li>
            <li>
              <b>How much leaves.</b> The vault measures its {TOKEN} balance before and after each action, and refuses
              anything above your per-transaction or daily limit, whatever the transaction claims.
            </li>
          </ul>
          <p>
            The proof still checks everything else, such as the pool and your price limit. Vaults made before v4 rely
            on the proof alone; the app offers to move them to a new vault.
          </p>
        </>
      )}

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
          <b>Proofs take time.</b> About a minute per step on our GPU prover, and up to about 15 minutes when it falls
          back to the CPU. There is one queue for everyone.
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
