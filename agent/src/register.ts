/**
 * Verify the agent's attestation offchain, then register its key in AgentRegistry.
 * (For now the registry owner verifies it; onchain quote verification is planned.)
 *
 * Usage:
 *   AGENT_URL=http://127.0.0.1:8080 EXPECTED_MEASUREMENT=0x... pnpm --filter @obelisk/agent register [--dry-run]
 *
 * Checks:
 *  1. The TDX v4 quote carries report_data = keccak256("obelisk-agent-v1", agentAddress), binding the key to this enclave.
 *  2. codeMeasurement (the dstack app compose hash) matches what the owner expects.
 *  3. The attestation is not "dev" mode.
 * The quote's signature against Intel's root (DCAP) is NOT checked here: the simulator returns an example quote.
 * On Phala Cloud, DCAP verification is done with dcap-qvl or Phala's verifier.
 */
import { createHash } from "node:crypto";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentRegistryAbi, loadDeployment, loadEnv, resolveChain } from "@obelisk/shared";
import { ROOT } from "./boot.js";
import { reportDataFor, type Attestation } from "./identity.js";

loadEnv(ROOT);
const dryRun = process.argv.includes("--dry-run");
const agentUrl = process.env.AGENT_URL ?? "http://127.0.0.1:8080";
const expected = process.env.EXPECTED_MEASUREMENT?.toLowerCase();

const { address, attestation } = (await (await fetch(`${agentUrl}/identity`)).json()) as {
  address: Hex;
  attestation: Attestation;
};

const fail = (m: string): never => {
  console.error(`✕ ${m}`);
  process.exit(1);
};
const ok = (m: string) => console.log(`✓ ${m}`);

if (attestation.kind !== "tdx" || !attestation.quote) fail(`attestation is not TDX (kind=${attestation.kind})`);
ok(`attestation TDX, quote ${(attestation.quote!.length - 2) / 2} byte`);

// TDX quote v4: 48-byte header + 584-byte TD report body; report_data = the last 64 bytes of the body.
const quote = attestation.quote!.replace(/^0x/, "");
const version = parseInt(quote.slice(2, 4) + quote.slice(0, 2), 16);
if (version !== 4 && version !== 5) fail(`unknown quote version ${version}`);
const reportData = `0x${quote.slice((48 + 520) * 2, (48 + 520 + 64) * 2)}`;
const want = reportDataFor(address).toLowerCase() + "0".repeat(64);
if (reportData.toLowerCase() !== want) fail(`report_data quote ${reportData} ≠ ${want}`);
ok(`report_data in the quote binds the agent address ${address}`);

const composeHash = `0x${createHash("sha256").update(attestation.appCompose ?? "").digest("hex")}`;
if (composeHash !== attestation.codeMeasurement.toLowerCase()) fail("codeMeasurement ≠ sha256(appCompose)");
ok("codeMeasurement = sha256(app_compose) reported by the enclave");
console.log("\n--- app_compose (audit its content before registering) ---");
console.log(JSON.stringify(JSON.parse(attestation.appCompose!), null, 2).slice(0, 1500));
console.log("---\n");

if (!expected) fail("set EXPECTED_MEASUREMENT (the sha256 of the app-compose you audited)");
if (attestation.codeMeasurement.toLowerCase() !== expected) {
  fail(`measurement ${attestation.codeMeasurement} does not match the expected ${expected}`);
}
ok(`measurement kode cocok: ${attestation.codeMeasurement}`);

const chainName = process.env.OBELISK_CHAIN ?? "local";
const { chain, rpcUrl } = resolveChain(chainName);
const dep = loadDeployment(ROOT, chainName);
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
if (await pub.readContract({ address: dep.registry, abi: agentRegistryAbi, functionName: "isActive", args: [address] })) {
  ok("agent is already registered and active");
  process.exit(0);
}
if (dryRun) {
  console.log(`(dry-run) would call registerAgent(${address}, ${attestation.codeMeasurement}) on ${dep.registry}`);
  process.exit(0);
}

const owner = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: owner });
const hash = await wallet.writeContract({
  address: dep.registry,
  abi: agentRegistryAbi,
  functionName: "registerAgent",
  args: [address, attestation.codeMeasurement],
});
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success") fail(`registerAgent revert: ${hash}`);
ok(`registered on ${chainName}: tx ${hash}`);
