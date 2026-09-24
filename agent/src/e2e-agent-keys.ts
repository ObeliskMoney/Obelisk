/**
 * End-to-end test of agent keys on the local stack (scripts/local-up.sh), from the point of view of an external
 * AI agent using @obeliskmoney/agent-sdk. Run:  cd agent && OBELISK_CHAIN=local node --import tsx src/e2e-agent-keys.ts
 */
import { readFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { authMessage, policyHash, type AuthAction, type Policy } from "@obelisk/shared";
import { Obelisk, ObeliskError } from "../../packages/agent-sdk/src/index.js";

const API = process.env.AGENT_URL ?? "http://127.0.0.1:8080/api";
const dep = JSON.parse(readFileSync(new URL("../../contracts/deployments/local.json", import.meta.url), "utf8"));
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"); // anvil #0, local only
const vault: `0x${string}` = dep.vault;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

async function signed(signer: typeof owner, action: AuthAction, payload: string) {
  const ts = Math.floor(Date.now() / 1000);
  return { vault, ts, signature: await signer.signMessage({ message: authMessage({ vault, action, payload, ts }) }) };
}
async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

// 1. The owner registers the vault's rules with the agent.
const policy = dep.policy as Policy;
const reg = await post("/vaults", { ...(await signed(owner, "vault:register", policyHash(policy))), policy, labels: {}, name: "e2e" });
check("owner registers the vault", reg.status === 200, reg.status === 200 ? undefined : reg.body);

// 2. The owner creates an agent key, the way the app does.
const agentPk = generatePrivateKey();
const agentAddr = privateKeyToAccount(agentPk).address.toLowerCase();
const add = await post("/agent-keys", { ...(await signed(owner, "agent-key:add", `${agentAddr}|e2e bot`)), address: agentAddr, label: "e2e bot" });
check("owner adds an agent key", add.status === 200, add.status === 200 ? undefined : add.body);

// 3. The external agent works through the SDK.
const bot = new Obelisk({ agentKey: agentPk, vault, apiUrl: API });
const st = await bot.status({ timeoutMs: 60_000 });
check("agent key: status", st.ok && st.reply.includes("Vault balance"), st.reply);

const sw = await bot.swap("5", { timeoutMs: 120_000 });
check("agent key: swap 5 inside the rules executes", sw.ok && sw.executed.length > 0, sw.executed.map((e) => e.label));

const big = await bot.swap(String(Number(BigInt(policy.maxPerTx) / 1_000_000n) + 1), { timeoutMs: 120_000 });
check("agent key: swap above maxPerTx is refused", !big.ok && big.refused.some((r) => r.code === "EXCEEDS_PER_TX"), big.refused);

const pay = await bot.pay("0x000000000000000000000000000000000000dEaD", "1", { timeoutMs: 120_000 });
check("agent key: pay to a stranger is refused", !pay.ok && pay.refused.length > 0, pay.refused.map((r) => r.code));

// The API allows 10 commands per minute per IP; wait for a fresh window so the checks below are not rate-limited.
await new Promise((r) => setTimeout(r, 61_000));

// 4. What an agent key must not be able to do.
const bad = await post("/tasks", { ...(await signed(owner, "task", "[]")), actions: "[]" });
check("empty actions are refused", bad.status === 400, bad.body.error);
const evil = privateKeyToAccount(agentPk);
const escalate = await post("/agent-keys", {
  ...(await signed(evil, "agent-key:add", `${evil.address.toLowerCase()}|x`)),
  address: generatePrivateKey().slice(0, 42),
  label: "x",
});
check("agent key cannot add keys (owner-only)", escalate.status === 401 || escalate.status === 400, escalate.body.error);
const s1 = await signed(evil, "task", JSON.stringify([{ type: "status" }]));
const first = await post("/tasks", { ...s1, actions: JSON.stringify([{ type: "status" }]) });
const replay = await post("/tasks", { ...s1, actions: JSON.stringify([{ type: "status" }]) });
check("a signed request cannot be replayed", first.status === 200 && replay.status === 401, replay.body.error);
const stranger = new Obelisk({ agentKey: generatePrivateKey(), vault, apiUrl: API });
const denied = await stranger.submit([{ type: "status" }]).then(() => null, (e: ObeliskError) => e);
check("an unknown key is refused", denied?.status === 401, denied?.message);

await new Promise((r) => setTimeout(r, 61_000));

// 5. The owner revokes the key; it stops working at once.
const rev = await post("/agent-keys/revoke", { ...(await signed(owner, "agent-key:revoke", agentAddr)), address: agentAddr });
check("owner revokes the key", rev.status === 200, rev.body);
const after = await bot.submit([{ type: "status" }]).then(() => null, (e: ObeliskError) => e);
check("a revoked key is refused", after?.status === 401, after?.message);

console.log(failures ? `\n${failures} check(s) failed` : "\nall agent-key checks passed");
process.exit(failures ? 1 : 0);
