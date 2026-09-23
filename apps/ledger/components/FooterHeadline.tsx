"use client";

import { WordsPullUp } from "./motion";

export function FooterHeadline() {
  return (
    <h2 className="foot-title">
      <WordsPullUp segments={[{ text: "Let the agent work." }, { text: "Keep the limits.", className: "accent-word" }]} />
    </h2>
  );
}
