// Proxy to the agent API on the server (HTTPS). The browser never needs the server address and avoids CORS.
import type { NextRequest } from "next/server";

const BASE = process.env.AGENT_API_URL ?? "http://127.0.0.1:8080/api";

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `${BASE}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
    cache: "no-store",
  };
  if (req.method !== "GET") init.body = await req.text();
  // The first connection from a Vercel function to the server sometimes fails (cold start). Retry once.
  // Safe for POST: command signatures are single-use, so a duplicate is refused by the agent (401).
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      last = e;
      console.error(`[agent-proxy] ${req.method} ${path.join("/")} attempt ${attempt + 1}:`, (e as Error).cause ?? e);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return Response.json(
    { error: `The agent could not be reached. Please try again. (${(last as Error)?.message ?? "network error"})` },
    { status: 502 },
  );
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
export const dynamic = "force-dynamic";
