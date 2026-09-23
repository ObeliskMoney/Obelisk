import { ImageResponse } from "next/og";
import { IS_MAINNET } from "@/lib/network";

/** Link preview image (X, Telegram, Discord, WhatsApp): 1200x630, in the website's hero style. */
export const alt = "Obelisk: your AI agent can't spend more than you allow";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 460"><rect width="460" height="460" rx="92" fill="#0B0C0E"/><circle cx="230" cy="206" r="126" fill="none" stroke="#F3F1EA" stroke-width="6"/><g fill="#F3F1EA" stroke="#0B0C0E" stroke-width="12" paint-order="stroke"><path d="M225 62 L207 86 L193 292 C188 334 146 356 68 364 L68 370 L217 370 L225 361 Z"/><path d="M235 62 L253 86 L267 292 C272 334 314 356 392 364 L392 370 L243 370 L235 361 Z"/></g></svg>`;

async function inter(weight: 500 | 600): Promise<ArrayBuffer> {
  // Without a user agent Google Fonts serves TTF (Satori cannot read WOFF2).
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`)).text();
  const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!url) throw new Error("Inter font not found");
  return (await fetch(url)).arrayBuffer();
}

export default async function Image() {
  const [medium, semibold] = await Promise.all([inter(500), inter(600)]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#EFEFEF",
          position: "relative",
          fontFamily: "Inter",
          color: "#111827",
        }}
      >
        {/* orange flow + fluted glass, echoing the hero shader */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 760,
            height: 760,
            borderRadius: 760,
            background: "radial-gradient(circle, rgba(242,101,34,0.85) 0%, rgba(255,160,100,0.45) 45%, rgba(239,239,239,0) 70%)",
          }}
        />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: -300,
              left: 520 + i * 110,
              width: 3,
              height: 1400,
              background: "rgba(255,255,255,0.5)",
              transform: "rotate(31deg)",
            }}
          />
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={`data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`} width={64} height={64} alt="" />
          <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Obelisk</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, fontWeight: 500, lineHeight: 1.04, letterSpacing: -2.6, maxWidth: 900 }}>
            Your AI agent can&apos;t spend more than you allow.
          </div>
          <div style={{ fontSize: 28, color: "#4B5563", maxWidth: 820, lineHeight: 1.35 }}>
            Every transaction needs a zero-knowledge proof that it follows your limits, or the vault contract rejects it.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24 }}>
            <div style={{ width: 12, height: 12, borderRadius: 12, background: "#F26522" }} />
            <span>{IS_MAINNET ? "Beta on Robinhood Chain" : "Live on Robinhood Chain testnet"}</span>
          </div>
          <div
            style={{
              display: "flex",
              background: "#111827",
              color: "#FFFFFF",
              fontSize: 24,
              fontWeight: 600,
              padding: "14px 22px",
              borderRadius: 3,
            }}
          >
            obelisk-ledger.vercel.app
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: medium, weight: 500, style: "normal" },
        { name: "Inter", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
