import Image from "next/image";
import Link from "next/link";
import { EXPLORER, executionCounts, listExecutions, reasonFor, relTimeEn, short, stepTitle, type Execution } from "@/lib/data";
import { NETWORK_LABEL, TEE_SIMULATED, TOKEN } from "@/lib/network";
import { AttackReplay } from "@/components/AttackReplay";
import { Faq } from "@/components/Faq";
import { ProofPipeline } from "@/components/ProofPipeline";
import { Hero } from "@/components/Hero";
import { Rules } from "@/components/Rules";
import { ScrollRevealText } from "@/components/motion";
import { ActionLink, SectionLabel } from "@/components/ui";

export const revalidate = 60;


function outcome(r: Execution): { label: string; tone: "ok" | "warn" | "bad"; detail: string } {
  if (r.status === "executed") {
    const approve = r.selector === "0x095ea7b3";
    return {
      label: "Executed",
      tone: "ok",
      detail: approve
        ? "Lets the approved exchange use up to today's limit. Proof verified by the vault contract."
        : "Proof verified by the vault contract, then executed.",
    };
  }
  if (r.status === "reverted") {
    return {
      label: "Rejected by contract",
      tone: "bad",
      detail: `${reasonFor(r.reject_code)} It was then pushed onchain with a forged proof, and the contract reverted it.`,
    };
  }
  return { label: "Blocked by rules", tone: "warn", detail: `${reasonFor(r.reject_code)} No proof could be made, so nothing was sent.` };
}

async function loadActivity() {
  try {
    const [rows, counts] = await Promise.all([listExecutions(undefined, 40), executionCounts()]);
    const blocked = rows.filter((r) => r.status !== "executed").slice(0, 3);
    const done = rows.filter((r) => r.status === "executed").slice(0, 5 - blocked.length);
    const events = [...blocked, ...done].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const proofTx = rows.find((r) => r.status === "executed" && r.tx_hash)?.tx_hash ?? null;
    const swap = rows.find((r) => r.status === "executed" && r.tx_hash && r.selector === "0x04e45aaf") ?? null;
    return { events, counts, proofTx, swap, failed: false };
  } catch {
    return { events: [] as Execution[], counts: null, proofTx: null, swap: null, failed: true };
  }
}

export default async function Landing() {
  const { events, counts, proofTx, swap, failed } = await loadActivity();

  return (
    <main>
      <Hero proofTx={proofTx} />

      {/* ------------------------------------------------------------ 1. why */}
      <section className="ag-sec" aria-labelledby="why-title">
        <div className="ag-wrap">
          <SectionLabel n={1}>Why this exists</SectionLabel>
          <h2 id="why-title" className="ag-h2">
            An AI agent with a wallet
            <br className="br-lg" /> can be talked into anything.
          </h2>
          <div className="why-grid">
            <div className="why-img small">
              <Image src="/brand/logo.jpg" alt="The Obelisk mark" fill loading="eager" sizes="(max-width: 1024px) 45vw, 24vw" />
            </div>
            <div className="why-text">
              <ScrollRevealText
                className="why-p"
                text="One hidden sentence on a web page can tell an agent to send your money to a stranger, and it will try. Obelisk doesn't try to make the agent smarter. It makes the money unable to move unless the transaction provably follows rules you set."
              />
              <ActionLink href="#how">See how it works</ActionLink>
            </div>
            <div className="why-demo">
              <AttackReplay />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 2. how */}
      <section id="how" className="ag-sec alt" aria-labelledby="how-title">
        <div className="ag-wrap">
          <SectionLabel n={2}>How it works</SectionLabel>
          <h2 id="how-title" className="ag-h2">
            Three checks before any money moves.
          </h2>
          <ol className="steps">
            <li>
              <span className="step-n mono">01</span>
              <h3>You set the rules</h3>
              <p>
                Create a vault and choose a per-transaction limit, a daily limit and who can be paid. A fingerprint of
                those rules is stored in the vault contract.
              </p>
            </li>
            <li>
              <span className="step-n mono">02</span>
              <h3>Your agent proposes</h3>
              <p>
                You say what you want in plain words. The agent turns it into a transaction and signs it with its own
                key. It cannot sign anything your rules would not allow to run.
              </p>
            </li>
            <li>
              <span className="step-n mono">03</span>
              <h3>Math checks it</h3>
              <p>
                A zero-knowledge proof shows the transaction follows your rules. The vault contract verifies the proof,
                then executes. No valid proof, no transaction.
              </p>
            </li>
          </ol>

          {swap?.tx_hash && (
            <ProofPipeline
              task={swap.task ?? stepTitle(swap)}
              txHash={swap.tx_hash}
              txHref={`${EXPLORER}/tx/${swap.tx_hash}`}
            />
          )}

          <div className="asks-wrap">
            <p className="asks-title">Things you can ask it</p>
            <dl className="asks">
              <div>
                <dt className="mono">swap 50 {TOKEN} to ETH</dt>
                <dd>Swaps through the approved exchange. The ETH lands back in your vault.</dd>
              </div>
              <div>
                <dt className="mono">pay Alex 20 {TOKEN}</dt>
                <dd>Pays someone on your approved list, by the name you gave them.</dd>
              </div>
              <div>
                <dt className="mono">swap 10 {TOKEN} to ETH, every day</dt>
                <dd>Set it once under Scheduled tasks. The agent runs it on its own, and each run gets its own proof.</dd>
              </div>
              <div>
                <dt className="mono">what is my balance?</dt>
                <dd>Reads your balance and what is left of today&apos;s limit.</dd>
              </div>
            </dl>
          </div>
          <p className="aside">
            Under the hood: the rules are checked by an SP1 program, the proof is verified onchain by Succinct&apos;s
            Groth16 verifier, and the agent key comes from dstack
            {TEE_SIMULATED ? ", which still runs in its simulator rather than TDX hardware" : " inside a TDX enclave"}.{" "}
            <Link href="/security">How Obelisk is secured</Link>.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ 3. rules */}
      <Rules />

      {/* ------------------------------------------------------------ 4. record */}
      <section className="ag-sec alt" aria-labelledby="log-title">
        <div className="ag-wrap">
          <SectionLabel n={4}>On the record</SectionLabel>
          <div className="log-head">
            <h2 id="log-title" className="ag-h2">
              Every action and every refusal is public.
            </h2>
            <ActionLink href="/activity" variant="light">
              See all activity
            </ActionLink>
          </div>
          {events.length > 0 ? (
            <ol className="log">
              {events.map((r) => {
                const o = outcome(r);
                return (
                  <li key={r.id}>
                    <span className={`tag ${o.tone}`}>{o.label}</span>
                    <div className="log-main">
                      <p className="log-task">{stepTitle(r)}</p>
                      <p className="log-detail">{o.detail}</p>
                      {r.task && <p className="log-said">Asked: &ldquo;{r.task}&rdquo;</p>}
                    </div>
                    <div className="log-meta mono">
                      <span>{relTimeEn(r.created_at)}</span>
                      {r.tx_hash ? (
                        <a href={`${EXPLORER}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">
                          {short(r.tx_hash, 4)}
                        </a>
                      ) : (
                        <Link href={`/tx/${r.id}`}>details</Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="aside">
              {failed ? "The activity log could not be loaded right now." : `No transactions on ${NETWORK_LABEL} yet.`}
            </p>
          )}
          {counts && (
            <p className="aside mono small">
              {NETWORK_LABEL} so far: {counts.executed} executed, {counts.rejected_policy} blocked by rules,{" "}
              {counts.reverted} rejected by the contract.
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ 5. faq */}
      <section id="faq" className="ag-sec" aria-labelledby="faq-title">
        <div className="ag-wrap faq-grid">
          <div>
            <SectionLabel n={5}>FAQ</SectionLabel>
            <h2 id="faq-title" className="ag-h2">
              Questions, answered.
            </h2>
          </div>
          <Faq />
        </div>
      </section>
    </main>
  );
}
