// Dev: run one task against the demo vault in deployments/<chain>.json (no wallet auth).
// Usage: pnpm --filter @obelisk/agent task "swap 50 USDC to ETH" [--force]
import { boot } from "./boot.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const task = args.filter((a) => a !== "--force").join(" ");
if (!task) {
  console.error('usage: pnpm task "swap 50 USDC to ETH" [--force]');
  process.exit(1);
}

const { agent, deployment } = await boot();
const r = await agent.runTask({ address: deployment.vault, policy: deployment.policy, labels: {} }, task, { force });
console.log(`model: ${r.model}`);
if (r.reply) console.log(`agent: ${r.reply}`);
for (const s of r.steps) {
  const tail = s.txHash ? ` tx=${s.txHash}` : "";
  console.log(`- [${s.status}] ${s.label}${s.reason ? `: ${s.reason}` : ""}${tail}`);
}
if (!r.steps.length && !r.reply) console.log("(no onchain action)");
