import { createPublicClient, http, type PublicClient } from "viem";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDeployment, loadEnv, makeDb, resolveChain } from "@obelisk/shared";
import { ObeliskAgent } from "./agent.js";
import { loadIdentity } from "./identity.js";
import { llmPlanner, llmReplier, type Planner } from "./llm.js";
import { ObeliskService } from "./service.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function boot(planner: Planner = llmPlanner) {
  loadEnv(ROOT);
  const chainName = process.env.OBELISK_CHAIN ?? "local";
  const { chain, rpcUrl } = resolveChain(chainName);
  const deployment = loadDeployment(ROOT, chainName);
  const client = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  const identity = await loadIdentity();
  const agent = new ObeliskAgent({
    deployment,
    client,
    identity,
    planner,
    replier: process.env.AGENT_REPLIES === "fixed" ? undefined : llmReplier,
    proverUrl: process.env.PROVER_URL ?? "http://127.0.0.1:8081",
    executorUrl: process.env.EXECUTOR_URL ?? "http://127.0.0.1:8082",
  });
  const db = makeDb();
  const service = new ObeliskService(agent, db, client, deployment);
  return { agent, service, db, client, identity, deployment, chainName };
}
