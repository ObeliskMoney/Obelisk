/**
 * HTTP wrapper around the zk/target/release/obelisk-prover CLI, using async jobs
 * because a real Groth16 proof on a CPU can take tens of minutes.
 *
 *   POST /jobs        body: ProverInput (JSON)  → { id }
 *   GET  /jobs/:id    → { status: "queued" | "running" | "done" | "error", result?, position? }
 *   POST /check       rules check only (native, under a second, no queue)
 *   POST /prove       synchronous (mock / dev mode only)
 *
 * The mode is set by SP1_PROVER (mock | cpu | network). Proofs are processed one at a time.
 *
 * GPU offload (optional): with PROVER_GPU_SSH set to an SSH destination, proofs run on that machine's GPU
 * (its authorized key is forced to the prover, see docs/gpu-prover.md). If the GPU machine cannot be reached,
 * fails, or takes longer than PROVER_GPU_TIMEOUT_SECS, the proof falls back to the local prover, so a
 * stopped GPU rental only makes proofs slower. Rules checks always run locally.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "@obelisk/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv(ROOT);
const BIN = process.env.PROVER_BIN ?? join(ROOT, "zk", "target", "release", "obelisk-prover");
const MODE = process.env.SP1_PROVER ?? "mock";
const port = Number(process.env.PROVER_PORT ?? 8081);
const GPU_SSH = process.env.PROVER_GPU_SSH;
const GPU_TIMEOUT_MS = Number(process.env.PROVER_GPU_TIMEOUT_SECS ?? 600) * 1000;

interface Job {
  status: "queued" | "running" | "done" | "error";
  result?: unknown;
  created: number;
  startedAt?: number;
  finishedAt?: number;
}
const jobs = new Map<string, Job>();
const order: string[] = [];
let queue: Promise<unknown> = Promise.resolve();

function run(cmd: string, args: string[], input: string, timeoutMs?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, SP1_PROVER: MODE },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = timeoutMs ? setTimeout(() => p.kill("SIGKILL"), timeoutMs) : undefined;
    p.on("close", () => clearTimeout(timer));
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      // exit 0 = proof, 2 = policy violation. The result JSON is always the last stdout line
      // (gnark also writes logs to stdout).
      const last = out.trim().split("\n").pop() ?? "";
      if ((code === 0 || code === 2) && last.startsWith("{")) resolve(last);
      else reject(new Error(`prover exit ${code}: ${err.slice(-500) || out.slice(-500)}`));
    });
    p.stdin.end(input);
  });
}

async function prove(input: string, mode: "prove" | "check" = "prove"): Promise<string> {
  const local = () => run(BIN, ["--mode", mode, "--input", "-"], input);
  if (mode !== "prove" || !GPU_SSH) return local();
  try {
    const sshArgs = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", GPU_SSH, "prove"];
    return await run("ssh", sshArgs, input, GPU_TIMEOUT_MS);
  } catch (e) {
    console.log(`[prover] GPU unavailable, proving locally: ${(e as Error).message.slice(0, 200)}`);
    return local();
  }
}

function enqueue(input: string): string {
  const id = randomUUID();
  jobs.set(id, { status: "queued", created: Date.now() });
  order.push(id);
  queue = queue
    .then(async () => {
      const j = jobs.get(id)!;
      j.status = "running";
      j.startedAt = Date.now();
      try {
        j.result = JSON.parse(await prove(input));
        j.status = "done";
      } catch (e) {
        j.result = { ok: false, code: "PROVER_ERROR", reason: (e as Error).message };
        j.status = "error";
      }
      j.finishedAt = Date.now();
      const where = (j.result as { prover?: string } | undefined)?.prover === "cuda" ? "gpu" : MODE;
      console.log(`[prover] ${where} job ${id} ${j.status} ${((j.finishedAt - j.startedAt) / 1000).toFixed(1)}s`);
    })
    .catch(() => undefined);
  // keep at most the last 500 jobs
  while (order.length > 500) jobs.delete(order.shift()!);
  return id;
}

async function readBody(req: import("node:http").IncomingMessage) {
  let body = "";
  for await (const c of req) body += c;
  return body;
}

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/health") {
    const running = [...jobs.values()].filter((j) => j.status === "running" || j.status === "queued").length;
    const done = [...jobs.values()].filter((j) => j.status === "done" && j.startedAt && j.finishedAt);
    const avg = done.length ? done.reduce((s, j) => s + (j.finishedAt! - j.startedAt!), 0) / done.length / 1000 : null;
    return res.end(JSON.stringify({ ok: true, mode: MODE, gpu: !!GPU_SSH, pending: running, avgProofSecs: avg }));
  }
  if (req.method === "POST" && url === "/jobs") {
    return res.end(JSON.stringify({ id: enqueue(await readBody(req)) }));
  }
  const m = url.match(/^\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === "GET" && m) {
    const j = jobs.get(m[1]!);
    if (!j) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "job not found" }));
    }
    const position = j.status === "queued" ? order.filter((k) => jobs.get(k)?.status === "queued").indexOf(m[1]!) + 1 : 0;
    return res.end(JSON.stringify({ status: j.status, result: j.result, position }));
  }
  // Rules check only (native, under a second, no queue): the agent calls it before proving,
  // so a task that will be refused does not wait for proofs of its other steps first.
  if (req.method === "POST" && url === "/check") {
    try {
      res.end(await prove(await readBody(req), "check"));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, code: "PROVER_ERROR", reason: (e as Error).message }));
    }
    return;
  }
  if (req.method === "POST" && url === "/prove") {
    try {
      res.end(await prove(await readBody(req)));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, code: "PROVER_ERROR", reason: (e as Error).message }));
    }
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
}).listen(port, "127.0.0.1", () => console.log(`[prover] mode=${MODE} on :${port}`));
