import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap page prose">
      <h1>Page not found</h1>
      <p className="lede">This page does not exist, or the link is out of date.</p>
      <p>
        <Link href="/">Go to the home page</Link> or <Link href="/activity">see all activity</Link>.
      </p>
    </main>
  );
}
