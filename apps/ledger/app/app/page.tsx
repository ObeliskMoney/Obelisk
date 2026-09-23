import type { Metadata } from "next";
import ObeliskApp from "./ObeliskApp";

export const metadata: Metadata = { title: "Your vault" };

export default function Page() {
  return (
    <main className="wrap page">
      <ObeliskApp />
    </main>
  );
}
