"use client";

/**
 * Animation primitives adapted from Hirael "Creative Studio" (MIT, (c) 2026 Mohammad Shehadeh,
 * https://github.com/MohammadShehadeh/hirael). Ported from Tailwind to Obelisk's CSS.
 * All animations turn off under prefers-reduced-motion.
 */
import * as React from "react";
import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";

export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface Segment {
  text: string;
  className?: string;
}

/** Words rise one by one when first seen. */
export function WordsPullUp({
  segments,
  className,
  startDelay = 0,
  stagger = 0.07,
}: {
  segments: Segment[];
  className?: string;
  startDelay?: number;
  stagger?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const show = reduce || inView;
  const words: Segment[] = [];
  for (const seg of segments) {
    for (const part of seg.text.split(" ")) if (part) words.push({ text: part, className: seg.className });
  }
  return (
    <span ref={ref} className={`pull ${className ?? ""}`}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          className={`pull-word ${w.className ?? ""}`}
          initial={reduce ? false : { y: "0.5em", opacity: 0 }}
          animate={show ? { y: 0, opacity: 1 } : undefined}
          transition={{ duration: 0.7, delay: startDelay + i * stagger, ease: EASE_OUT_EXPO }}
        >
          {w.text}
        </motion.span>
      ))}
    </span>
  );
}

function Letter({ char, at, progress }: { char: string; at: number; progress: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const opacity = useTransform(progress, [at - 0.1, at + 0.05], [0.22, 1]);
  return (
    <motion.span aria-hidden className="reveal-char" style={reduce ? undefined : { opacity }}>
      {char}
    </motion.span>
  );
}

/** A paragraph that "lights up" letter by letter as you scroll. */
export function ScrollRevealText({ text, className }: { text: string; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.35"] });
  const words = text.split(" ");
  let cursor = 0;
  return (
    <p ref={ref} aria-label={text} className={className}>
      {words.map((word, wi) => {
        const start = cursor;
        cursor += word.length + 1;
        return (
          <React.Fragment key={wi}>
            <span className="reveal-word">
              {Array.from(word).map((ch, ci) => (
                <Letter key={ci} char={ch} at={(start + ci) / text.length} progress={scrollYProgress} />
              ))}
            </span>
            {wi < words.length - 1 ? " " : null}
          </React.Fragment>
        );
      })}
    </p>
  );
}

/** Appears (fade + slight rise and scale) when entering the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "article";
}) {
  const ref = React.useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const show = reduce || inView;
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      initial={reduce ? false : { y: 16, opacity: 0, scale: 0.98 }}
      animate={show ? { y: 0, opacity: 1, scale: 1 } : undefined}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Comp>
  );
}

/** Subtle grain (SVG noise) over images or gradients, like film. */
export function Grain({ opacity = 0.5 }: { opacity?: number }) {
  return <div aria-hidden className="grain" style={{ opacity }} />;
}
