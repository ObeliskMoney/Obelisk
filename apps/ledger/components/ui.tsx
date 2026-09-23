import Link from "next/link";

/**
 * Buttons and labels from Hirael "Agency Landing" patterns (MIT, (c) 2026 Mohammad Shehadeh),
 * changed to 3px corners instead of pills (Obelisk design rule).
 */
function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Text that "rolls" upward on hover. */
function Roll({ children }: { children: string }) {
  return (
    <span className="roll">
      <span className="roll-inner">
        <span>{children}</span>
        <span aria-hidden>{children}</span>
      </span>
    </span>
  );
}

export function ActionLink({
  href,
  children,
  variant = "orange",
  external = false,
}: {
  href: string;
  children: string;
  variant?: "orange" | "dark" | "light";
  external?: boolean;
}) {
  const cls = `act act-${variant}`;
  const inner = (
    <>
      <Roll>{children}</Roll>
      <span className="act-box">
        <Arrow />
      </span>
    </>
  );
  return external ? (
    <a href={href} className={cls} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export function SectionLabel({ n, children }: { n: number; children: string }) {
  return (
    <p className="sec">
      <span className="sec-num">{n}</span>
      <span className="sec-txt">{children}</span>
    </p>
  );
}
