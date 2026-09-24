/**
 * Public API of the Obelisk agent (behind Caddy/HTTPS). Every command that changes state
 * must be signed by the vault owner's wallet; see service.ts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { boot } from "./boot.js";
import { HttpError } from "./service.js";

const { service, db, identity, deployment, chainName } = await boot();
const port = Number(process.env.AGENT_PORT ?? 8080);
const host = process.env.AGENT_HOST ?? "127.0.0.1";
const origins = (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim());

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

// Simple per-IP rate limit: 60 requests per minute, 10 commands (POST) per minute.
const hits = new Map<string, { t: number; all: number; post: number }>();
function limited(req: IncomingMessage): boolean {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "?";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    hits.set(ip, { t: now, all: 1, post: req.method === "POST" ? 1 : 0 });
    return false;
  }
  h.all++;
  if (req.method === "POST" || req.method === "DELETE") h.post++;
  return h.all > 60 || h.post > 10;
}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 64_000) throw new HttpError(413, "request body too large");
  }
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function ping(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return (await r.json()) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const m = req.method ?? "GET";

  if (m === "GET" && path === "/health") {
    const [prover, executor] = await Promise.all([
      ping(`${process.env.PROVER_URL ?? "http://127.0.0.1:8081"}/health`),
      ping(`${process.env.EXECUTOR_URL ?? "http://127.0.0.1:8082"}/health`),
    ]);
    return {
      ok: prover.ok === true && executor.ok === true,
      chain: chainName,
      agent: identity.account.address,
      attestation: identity.attestation.kind,
      teeSimulated: identity.attestation.simulated ?? false,
      queue: service.queueDepth,
      prover,
      executor,
    };
  }
  if (m === "GET" && path === "/config") {
    return {
      chain: chainName,
      chainId: deployment.chainId,
      factory: deployment.factory,
      legacyFactories: deployment.legacyFactories ?? [],
      vaultVersion: deployment.vaultVersion ?? 3,
      registry: deployment.registry,
      usdc: deployment.usdc,
      weth: deployment.weth,
      router: deployment.router,
      tokenSymbol: deployment.tokenSymbol ?? "USDC",
      swapFee: deployment.swapFee ?? 500,
      mockAssets: deployment.mockAssets !== false,
      verifierKind: deployment.verifierKind,
      programVKey: deployment.programVKey,
      agent: identity.account.address,
      attestation: identity.attestation.kind,
      teeSimulated: identity.attestation.simulated ?? false,
      codeMeasurement: identity.attestation.codeMeasurement,
    };
  }
  if (m === "GET" && path === "/identity") {
    return { address: identity.account.address, attestation: identity.attestation };
  }
  if (m === "POST" && path === "/vaults") {
    const b = await body(req);
    return service.registerVault({
      vault: b.vault,
      policy: b.policy,
      labels: b.labels,
      name: b.name,
      ts: Number(b.ts),
      signature: b.signature,
    });
  }
  // A task is either free text (`task`) or structured actions (`actions`, a JSON string: docs/agents.md).
  // The owner's wallet or an active agent key of the vault signs exactly that string.
  if (m === "POST" && path === "/tasks") {
    const b = await body(req);
    if (typeof b.actions === "string") {
      const signer = await service.authorizeTask(b.vault, b.actions, Number(b.ts), b.signature);
      const row = await service.enqueueActions(b.vault, b.actions, signer);
      return { id: row.id, status: row.status, task: row.task, queue: service.queueDepth };
    }
    if (typeof b.task !== "string" || !b.task.trim()) throw new HttpError(400, "the task is empty");
    const signer = await service.authorizeTask(b.vault, b.task, Number(b.ts), b.signature);
    const row = await service.enqueue(b.vault, b.task, signer.kind === "agent-key" ? "agent" : "chat", undefined, {
      agentKey: signer.kind === "agent-key" ? signer.address : undefined,
    });
    return { id: row.id, status: row.status, queue: service.queueDepth };
  }
  if (m === "GET" && path === "/agent-keys") {
    return service.listAgentKeys(url.searchParams.get("vault") ?? "");
  }
  if (m === "POST" && path === "/agent-keys") {
    const b = await body(req);
    return service.addAgentKey({ vault: b.vault, address: b.address, label: b.label, ts: Number(b.ts), signature: b.signature });
  }
  if (m === "POST" && path === "/agent-keys/revoke") {
    const b = await body(req);
    await service.revokeAgentKey({ vault: b.vault, address: b.address, ts: Number(b.ts), signature: b.signature });
    return { ok: true };
  }
  if (m === "GET" && path === "/tasks") {
    const vault = url.searchParams.get("vault")?.toLowerCase();
    if (!vault) throw new HttpError(400, "vault parameter is required");
    return db.select("tasks", { vault }, { order: "created_at.desc", limit: 50 });
  }
  if (m === "GET" && path === "/vaults") {
    const owner = url.searchParams.get("owner")?.toLowerCase();
    if (!owner) throw new HttpError(400, "owner parameter is required");
    return db.select("vaults", { owner }, { order: "created_at.desc" });
  }
  const task = path.match(/^\/tasks\/([0-9a-f-]{36})$/);
  if (m === "GET" && task) {
    const [row] = await db.select("tasks", { id: task[1]! });
    if (!row) throw new HttpError(404, "task not found");
    return row;
  }
  if (m === "GET" && path === "/jobs") {
    const vault = url.searchParams.get("vault")?.toLowerCase();
    if (!vault) throw new HttpError(400, "vault parameter is required");
    return db.select("jobs", { vault, active: true }, { order: "created_at.desc" });
  }
  if (m === "POST" && path === "/jobs") {
    const b = await body(req);
    const minutes = Number(b.intervalMinutes);
    if (typeof b.task !== "string" || !b.task.trim()) throw new HttpError(400, "the task is empty");
    await service.authorize("job:create", b.vault, `${minutes}|${b.task}`, Number(b.ts), b.signature);
    return service.createJob(b.vault, b.task, minutes);
  }
  const job = path.match(/^\/jobs\/([0-9a-f-]{36})$/);
  if (m === "DELETE" && job) {
    const b = await body(req);
    await service.authorize("job:delete", b.vault, job[1]!, Number(b.ts), b.signature);
    await service.deleteJob(b.vault, job[1]!);
    return { ok: true };
  }
  throw new HttpError(404, "not found");
}

createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  res.setHeader("access-control-allow-origin", origins.includes("*") ? "*" : origins.includes(origin) ? origin : origins[0]!);
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("content-type", "application/json");
  if (req.method === "OPTIONS") return res.end();
  if (limited(req)) {
    res.statusCode = 429;
    return res.end(json({ error: "too many requests, please wait a moment" }));
  }
  try {
    res.end(json(await route(req, res)));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.statusCode = status;
    res.end(json({ error: (e as Error).message }));
  }
}).listen(port, host, () => {
  console.log(`[agent] ${identity.account.address} (${identity.attestation.kind}) on ${host}:${port}, chain ${chainName}`);
});

// Job scheduler: checks every 30 seconds.
setInterval(() => {
  service.tick().catch((e) => console.error("[jobs]", e));
}, 30_000);
