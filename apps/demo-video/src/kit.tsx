import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

/** Same palette as the website (design-system/obelisk/MASTER.md). */
export const C = {
  bg: "#EFEFEF",
  paper: "#FFFFFF",
  soft: "#F5F5F5",
  ink: "#111827",
  muted: "#6B7280",
  line: "#D9D9D9",
  orange: "#F26522",
  navy: "#1A1D2E",
  green: "#15803D",
  red: "#B91C1C",
};
export const SANS = inter.fontFamily;
export const MONO = mono.fontFamily;

export const EXPLORER = "explorer.testnet.chain.robinhood.com";

/** Video version of the hero background: light gray + fluted glass at 31 degrees + a slowly moving orange blob. */
export function Backdrop({ tone = "light" }: { tone?: "light" | "navy" }) {
  const f = useCurrentFrame();
  const x = 72 + 6 * Math.sin(f / 90);
  const y = 30 + 8 * Math.cos(f / 110);
  if (tone === "navy") {
    return (
      <AbsoluteFill style={{ background: C.navy }}>
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${x}% ${y}%, rgba(242,101,34,0.55), rgba(242,101,34,0) 45%)`,
          }}
        />
        <Flutes opacity={0.07} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${x}% ${y}%, rgba(242,101,34,0.35), rgba(255,178,122,0.18) 22%, rgba(239,239,239,0) 48%)`,
        }}
      />
      <Flutes opacity={0.55} />
    </AbsoluteFill>
  );
}

function Flutes({ opacity }: { opacity: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage:
          "repeating-linear-gradient(121deg, rgba(255,255,255,0.9) 0px, rgba(255,255,255,0) 3px, rgba(255,255,255,0) 118px, rgba(0,0,0,0.05) 120px)",
        backgroundPosition: `${f * 0.4}px 0px`,
      }}
    />
  );
}

/** Numbered corner label, in the style of the website's section labels. */
export function Label({ n, children, dark }: { n: string; children: React.ReactNode; dark?: boolean }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 96,
        display: "flex",
        gap: 18,
        alignItems: "center",
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: dark ? "rgba(255,255,255,0.7)" : C.muted,
        opacity: o,
      }}
    >
      <span style={{ color: C.orange }}>{n}</span>
      <span style={{ width: 48, height: 1, background: dark ? "rgba(255,255,255,0.4)" : C.line }} />
      <span>{children}</span>
    </div>
  );
}

/** Words rise one by one. `accent` = indexes of words colored orange. */
export function Words({
  text,
  delay = 0,
  size = 96,
  color = C.ink,
  accent = [],
  weight = 600,
  stagger = 3,
  style,
}: {
  text: string;
  delay?: number;
  size?: number;
  color?: string;
  accent?: number[];
  weight?: number;
  stagger?: number;
  style?: React.CSSProperties;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: -size * 0.035,
        lineHeight: 1.05,
        color,
        display: "flex",
        flexWrap: "wrap",
        columnGap: size * 0.26,
        ...style,
      }}
    >
      {text.split(" ").map((w, i) => {
        const s = spring({ frame: f - delay - i * stagger, fps, config: { damping: 200, mass: 0.6 } });
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.08 }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - s) * 100}%)`,
                opacity: s,
                color: accent.includes(i) ? C.orange : undefined,
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Appears with a fade and a slight rise. */
export function Rise({
  delay = 0,
  children,
  style,
  y = 24,
}: {
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  y?: number;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>{children}</div>;
}

/** Text typed out character by character. */
export function Typed({ text, start, cps = 40, caret = true }: { text: string; start: number; cps?: number; caret?: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(0, Math.min(text.length, Math.floor(((f - start) / fps) * cps)));
  const blink = Math.floor(f / 15) % 2 === 0;
  return (
    <span>
      {text.slice(0, n)}
      {caret && n < text.length && f >= start ? <span style={{ opacity: blink ? 1 : 0, color: C.orange }}>|</span> : null}
    </span>
  );
}

/** Fade in at the start of a scene and out at the end. */
export function Scene({ dur, children }: { dur: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10, dur - 10, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.line}`,
        borderRadius: 3,
        boxShadow: "0 30px 60px -30px rgba(17,24,39,0.25)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** SVG icons (not emoji). */
export function Check({ size = 28, color = C.green }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="square">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}
export function Cross({ size = 28, color = C.red }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="square">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function Tag({ tone, children }: { tone: "ok" | "bad" | "warn"; children: React.ReactNode }) {
  const map = {
    ok: { bg: "rgba(21,128,61,0.1)", fg: C.green },
    bad: { bg: "rgba(185,28,28,0.1)", fg: C.red },
    warn: { bg: "rgba(242,101,34,0.12)", fg: "#C2410C" },
  }[tone];
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 20,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        padding: "8px 14px",
        borderRadius: 3,
        background: map.bg,
        color: map.fg,
      }}
    >
      {children}
    </span>
  );
}
