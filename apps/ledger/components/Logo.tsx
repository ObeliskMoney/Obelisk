/**
 * Obelisk mark: two monument blades with flared feet in front of a thin ring.
 * Redrawn from the brand logo (public/brand/logo.jpg) so it stays sharp at every size.
 */
const LEFT = "M225 62 L207 86 L193 292 C188 334 146 356 68 364 L68 370 L217 370 L225 361 Z";
const RIGHT = "M235 62 L253 86 L267 292 C272 334 314 356 392 364 L392 370 L243 370 L235 361 Z";

export function LogoMark({ size = 28, ring = true, title = "Obelisk" }: { size?: number; ring?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="60 50 340 330" role="img" aria-label={title} className="logo-mark">
      {ring && <circle cx="230" cy="206" r="126" fill="none" stroke="currentColor" strokeWidth="4" />}
      <g fill="currentColor" stroke="var(--bg)" strokeWidth="10" paintOrder="stroke" strokeLinejoin="miter">
        <path d={LEFT} />
        <path d={RIGHT} />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark size={26} />
      <span>OBELISK</span>
    </span>
  );
}
