"use client";

/**
 * One real transaction, from the request to execution, replayed at speed ("How it works" section).
 * Adapted from a 21st AI generation: framer-motion → motion (already used by the site), lucide → inline SVG,
 * Tailwind → site CSS. The data (task, tx hash) comes from the latest execution in the ledger.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type Phase = { type: "light" | "travel" | "pause"; index: number; ms: number };

const PHASES: Phase[] = [
  { type: "light", index: 0, ms: 700 },
  { type: "travel", index: 0, ms: 900 },
  { type: "light", index: 1, ms: 700 },
  { type: "travel", index: 1, ms: 900 },
  { type: "light", index: 2, ms: 1500 },
  { type: "travel", index: 2, ms: 900 },
  { type: "light", index: 3, ms: 700 },
  { type: "pause", index: -1, ms: 2200 },
];

const ICONS = [
  <path key="a" d="M4 5h16v11H9l-5 4V5Z" />,
  <path key="b" d="M15 7a4 4 0 1 1-3.9 5H4v3h3v3h3v-3h1.1A4 4 0 0 1 15 7Zm0 3v.5" />,
  <path key="c" d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10" />,
  <path key="d" d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3.5 9 2.5 2.5 4.5-5" />,
];

function Icon({ i }: { i: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      {ICONS[i]}
    </svg>
  );
}

function Connector({ active, settled, reduced }: { active: boolean; settled: boolean; reduced: boolean }) {
  return (
    <div className={`pp-conn${settled ? " on" : ""}`} aria-hidden>
      <div className="pp-line">
        {!reduced && (
          <motion.span
            className="pp-dot"
            initial={false}
            animate={{ "--p": active ? "100%" : "0%", opacity: active ? 1 : 0 }}
            transition={{ "--p": { duration: active ? 0.9 : 0, ease: "linear" }, opacity: { duration: 0.2 } }}
          />
        )}
      </div>
    </div>
  );
}

export function ProofPipeline({ task, txHash, txHref }: { task: string; txHash: string; txHref: string }) {
  const reduced = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lit, setLit] = useState([false, false, false, false]);
  const [traveling, setTraveling] = useState<number | null>(null);
  const [cycle, setCycle] = useState(0);

  // Only animate while visible, so it uses no CPU off screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) {
      setLit([true, true, true, true]);
      setTraveling(null);
      return;
    }
    if (!visible) return;
    let alive = true;
    let idx = 0;
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      if (!alive) return;
      const p = PHASES[idx]!;
      if (p.type === "light") {
        setTraveling(null);
        setLit((prev) => prev.map((v, i) => (i === p.index ? true : v)));
      } else setTraveling(p.type === "travel" ? p.index : null);
      t = setTimeout(() => {
        idx += 1;
        if (idx >= PHASES.length) {
          idx = 0;
          setLit([false, false, false, false]);
          setCycle((c) => c + 1);
        }
        run();
      }, p.ms);
    };
    run();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [reduced, visible]);

  const short = txHash.length > 14 ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}` : txHash;
  const stages = [
    {
      title: "You ask",
      body: <p className="pp-bubble mono">{task}</p>,
    },
    {
      title: "Agent signs",
      body: <p className="pp-text">Signed with the agent key. The key can sign, but it cannot spend on its own.</p>,
    },
    {
      title: "Zero-knowledge proof",
      body: (
        <>
          <div className="pp-bar">
            <motion.div
              key={cycle}
              initial={{ width: "0%" }}
              animate={{ width: lit[2] ? "100%" : "0%" }}
              transition={{ duration: lit[2] && !reduced ? 1.5 : 0, ease: "linear" }}
            />
          </div>
          <p className="pp-text">Proof that the swap follows your limits.</p>
        </>
      ),
    },
    {
      title: "Vault verifies",
      body: (
        <>
          <p className="pp-strong">Executed onchain</p>
          <a className="pp-tx mono" href={txHref} target="_blank" rel="noreferrer">
            {short}
          </a>
        </>
      ),
    },
  ];

  return (
    <div ref={ref} className="pp">
      <p className="pp-kicker">One real transaction, start to finish</p>
      <div className="pp-row">
        {stages.map((s, i) => (
          <Fragment key={s.title}>
            <div className={`pp-stage${lit[i] ? " on" : ""}`}>
              <div className="pp-top">
                <span className="mono pp-n">{["ASK", "SIGN", "PROVE", "EXECUTE"][i]}</span>
                <span className="pp-check" aria-hidden>
                  <AnimatePresence>
                    {lit[i] && (
                      <motion.svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.2"
                        initial={reduced ? false : { opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ duration: 0.25 }}
                      >
                        <path d="M4 12.5l5 5L20 6.5" />
                      </motion.svg>
                    )}
                  </AnimatePresence>
                </span>
              </div>
              <p className="pp-title">
                <Icon i={i} />
                {s.title}
              </p>
              {s.body}
            </div>
            {i < stages.length - 1 && <Connector active={traveling === i} settled={lit[i]! && lit[i + 1]!} reduced={reduced} />}
          </Fragment>
        ))}
      </div>
      <p className="pp-note">
        A real transaction from the <a href="/activity">activity log</a>, replayed at speed. The proof itself takes
        about 15 minutes.
      </p>
    </div>
  );
}
