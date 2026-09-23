import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://obelisk-ledger.vercel.app"),
  title: { default: "Obelisk: AI agent vaults with spending limits enforced onchain", template: "%s | Obelisk" },
  description:
    "Give an AI agent a vault with a per-transaction limit, a daily limit and an approved payee list. Every transaction needs a zero-knowledge proof that it follows your rules, or the contract rejects it.",
  // Preview image from app/opengraph-image.tsx (1200x630).
  openGraph: { siteName: "Obelisk", type: "website", url: "/" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#EFEFEF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <div id="main">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
