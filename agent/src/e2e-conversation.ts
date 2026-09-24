/**
 * End-to-end check of conversation memory (after scripts/local-up.sh): the agent offers a follow-up, the owner
 * answers with a bare "gas" or "yes", and the agent carries out exactly what it offered, still inside the rules.
 * Uses a real language model (GROQ_API_KEY), so the replies vary; the checks look at the executed steps.
 *
 * Usage:  USER_PK=0x... OBELISK_CHAIN=local npx tsx src/e2e-conversation.ts
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authMessage,
  buildPolicy,
  erc20Abi,
  limitsFor,
  loadDeployment,
  loadEnv,
  mockERC20Abi,
  obeliskVaultFactoryAbi,
  policyHash,
  resolveChain,
  type AuthAction,
} from "@obelisk/shared";
import { ROOT } from "./boot.js";

loadEnv(ROOT);
const API = process.env.AGENT_API ?? "http://127.0.0.1:8080/api";
const chainName = process.env.OBELISK_CHAIN ?? "local";
const { chain, rpcUrl } = resolveChain(chainName);
const dep = loadDeployment(ROOT, chainName);
const user = privateKeyToAccount((process.env.USER_PK ??
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") as Hex); // anvil #2
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: user });
const alex = "0x00000000000000000000000000000000000F00D0" as const;
// Pause between requests: the free Groq tier allows about 8,000 tokens a minute.
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 25_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`${r.status} ${j.error}`);
  return j;
}

async function signed(vault: string, action: AuthAction, payload: string) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = await user.signMessage({ message: authMessage({ vault, action, payload, ts }) });
  return { vault, ts, signature };
}

/** Send one message, wait for the result, print it and return the executed step labels. */
async function say(vault: string, text: string): Promise<{ executed: string[]; refused: string[] }> {
  await sleep(PAUSE_MS);
  const { id } = await api("POST", "/tasks", { ...(await signed(vault, "task", text)), task: text });
  let t: Record<string, any> = {};
  for (let i = 0; i < 600; i++) {
    t = await api("GET", `/tasks/${id}`);
    if (t.status === "done" || t.status === "error") break;
    await sleep(1000);
  }
  const steps: { status: string; label: string }[] = t.result?.steps ?? [];
  console.log(`\nowner: ${text}\nagent: ${t.reply}`);
  for (const s of steps) console.log(`  - [${s.status}] ${s.label}`);
  return {
    executed: steps.filter((s) => s.status === "executed").map((s) => s.label),
    refused: steps.filter((s) => s.status === "rejected_policy").map((s) => s.label),
  };
}

function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

// A vault with small limits so offers are easy to trigger: 50 per transaction, 120 per day, payee Alex.
const policy = buildPolicy(dep, {
  maxPerTx: parseUnits("50", 6),
  maxPerDay: parseUnits("120", 6),
  recipients: [alex],
  minOutPerIn: 10n ** 8n * 10n ** 18n,
});
const cfg = await api("GET", "/config");
let hash = await wallet.writeContract({
  address: dep.factory,
  abi: obeliskVaultFactoryAbi,
  functionName: "createVault",
  args: [policyHash(policy), cfg.agent, limitsFor(policy)],
});
await pub.waitForTransactionReceipt({ hash });
const list = await pub.readContract({ address: dep.factory, abi: obeliskVaultFactoryAbi, functionName: "vaultsOf", args: [user.address] });
const vault = list[list.length - 1]!;
hash = await wallet.writeContract({ address: dep.usdc, abi: mockERC20Abi, functionName: "mint", args: [user.address, parseUnits("500", 6)] });
await pub.waitForTransactionReceipt({ hash });
hash = await wallet.writeContract({ address: dep.usdc, abi: erc20Abi, functionName: "transfer", args: [vault, parseUnits("300", 6)] });
await pub.waitForTransactionReceipt({ hash });
await api("POST", "/vaults", {
  ...(await signed(vault, "vault:register", policyHash(policy))),
  policy,
  labels: { [alex]: "Alex" },
  name: "Conversation test",
});
console.log(`vault ${vault}: 300 USDC, 50 per transaction, 120 per day, payee Alex`);

// 1. Over the per-transaction limit: refused, and the agent offers the largest amount that fits.
let r = await say(vault, "swap 80 usdc ke eth dong");
check("80 is refused and nothing runs", r.executed.length === 0);

// 2. A bare "gas" means: do what you just offered (swap 50).
r = await say(vault, "gas");
check('"gas" runs the offered swap of 50', r.executed.some((l) => /swap 50 /.test(l)));

// 3. Declining an offer does nothing.
await say(vault, "swap 60 usdc");
r = await say(vault, "gak jadi deh");
check('"gak jadi" runs nothing', r.executed.length === 0 && r.refused.length === 0);

// 4. A yes in English: 70 is left today, so the agent may offer 50 again; the vault still decides.
await say(vault, "please swap 90 usdc to eth");
r = await say(vault, "yes");
check('"yes" runs one swap within the rules', r.executed.filter((l) => /swap/.test(l)).length === 1);

// 5. The payee still has to be approved: memory cannot widen the rules.
r = await say(vault, "kirim 5 usdc ke Alex");
check("paying Alex runs", r.executed.some((l) => /send 5 /.test(l)));

console.log(failed ? `\n${failed} check(s) failed` : "\nall conversation checks passed");
process.exit(failed ? 1 : 0);
