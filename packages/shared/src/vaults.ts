import { getAddress, type Address, type PublicClient } from "viem";
import { policyHash } from "./hash.js";
import { SELECTORS } from "./calldata.js";
import { obeliskVaultAbi, obeliskVaultFactoryAbi } from "./abi.js";
import type { Deployment } from "./deployment.js";
import type { Policy } from "./types.js";

/** A user vault recorded in the `vaults` table. */
export interface VaultRecord {
  address: string;
  chain_id: number;
  owner: string;
  policy: Policy;
  policy_hash: string;
  labels: Record<string, string>;
  name: string | null;
  created_at?: string;
}

/**
 * The policy every vault uses: fixed token, router, pool (fee tier) and swap output; limits, payees and the
 * price floor chosen by the user. `minOutPerIn` is the least WETH (wei) per token unit, times 1e18.
 */
export function buildPolicy(
  dep: Pick<Deployment, "usdc" | "router" | "weth" | "swapFee">,
  p: { maxPerTx: bigint; maxPerDay: bigint; recipients: Address[]; minOutPerIn: bigint },
): Policy {
  if (p.minOutPerIn <= 0n) throw new Error("the price floor must be above zero");
  const selectors: `0x${string}`[] = [SELECTORS.approve, SELECTORS.exactInputSingle];
  if (p.recipients.length) selectors.push(SELECTORS.transfer);
  return {
    version: 3,
    token: dep.usdc,
    maxPerTx: p.maxPerTx.toString(),
    maxPerDay: p.maxPerDay.toString(),
    allowedTargets: [dep.router],
    allowedRecipients: p.recipients.map((r) => getAddress(r)),
    allowedSelectors: selectors,
    denyUnlimitedApprove: true,
    allowedTokensOut: [dep.weth],
    allowedFees: [dep.swapFee ?? 500],
    minOutPerIn: [p.minOutPerIn.toString()],
  };
}

/** Onchain limits of a v4 vault (ObeliskVault `Limits`), derived from its policy. */
export interface Limits {
  token: Address;
  maxPerTx: bigint;
  maxPerDay: bigint;
  routers: readonly Address[];
  payees: readonly Address[];
}

/** The onchain limits that must accompany `policy` in createVault / setRules (vault v4). */
export function limitsFor(policy: Policy): Limits {
  return {
    token: policy.token,
    maxPerTx: BigInt(policy.maxPerTx),
    maxPerDay: BigInt(policy.maxPerDay),
    routers: policy.allowedTargets,
    payees: policy.allowedRecipients,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));

/** true when a vault's onchain limits are exactly the ones its policy implies. */
export function limitsMatch(onchain: Limits, policy: Policy): boolean {
  const want = limitsFor(policy);
  return (
    onchain.token.toLowerCase() === want.token.toLowerCase() &&
    onchain.maxPerTx === want.maxPerTx &&
    onchain.maxPerDay === want.maxPerDay &&
    sameSet(onchain.routers, want.routers) &&
    sameSet(onchain.payees, want.payees)
  );
}

/**
 * Make sure `vault` was created by the Obelisk factory and the policy JSON matches the onchain policyHash.
 * Used before storing a vault and before the executor pays gas for it.
 */
export async function verifyVault(
  client: PublicClient,
  dep: Deployment,
  vault: Address,
  policy?: Policy,
): Promise<{ owner: Address; policyHash: `0x${string}`; version: 3 | 4 }> {
  const [owner, onchainPolicy, onchainVKey] = await Promise.all([
    client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "policyHash" }),
    client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "programVKey" }),
  ]);
  const lists = await Promise.all(
    [dep.factory, ...(dep.legacyFactories ?? [])].map((factory) =>
      client.readContract({ address: factory, abi: obeliskVaultFactoryAbi, functionName: "vaultsOf", args: [owner] }),
    ),
  );
  const has = (l: readonly Address[]) => l.some((v) => v.toLowerCase() === vault.toLowerCase());
  if (!lists.some(has)) {
    throw new Error("this vault was not created by the Obelisk factory");
  }
  // Vaults from the current factory are v4 (onchain limits); earlier factories made v2/v3 vaults without them.
  const version = has(lists[0]!) && dep.vaultVersion === 4 ? 4 : 3;
  if (onchainVKey.toLowerCase() !== dep.programVKey.toLowerCase()) {
    throw new Error("this vault still uses the previous rules program; update its rules in the app first");
  }
  if (policy) {
    if (policyHash(policy).toLowerCase() !== onchainPolicy.toLowerCase()) {
      throw new Error("the rules do not match the policy hash stored in the vault");
    }
    if (policy.token.toLowerCase() !== dep.usdc.toLowerCase()) throw new Error(`the rules must limit ${dep.tokenSymbol ?? "USDC"}`);
    if (policy.allowedTargets.some((t) => t.toLowerCase() !== dep.router.toLowerCase())) {
      throw new Error("the rules may only allow the approved exchange");
    }
    if (policy.version !== 3 || policy.allowedTokensOut.some((t) => t.toLowerCase() !== dep.weth.toLowerCase())) {
      throw new Error("the rules may only allow swaps into ETH");
    }
    if (policy.allowedFees.some((f) => f !== (dep.swapFee ?? 500))) {
      throw new Error("the rules may only allow the approved pool");
    }
    if (policy.minOutPerIn.length !== policy.allowedTokensOut.length || policy.minOutPerIn.some((x) => BigInt(x) <= 0n)) {
      throw new Error("the rules need a price floor for every swap output");
    }
    if (version === 4) {
      const onchain = await client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "limits" });
      if (!limitsMatch(onchain, policy)) throw new Error("the vault's onchain limits do not match these rules");
    }
  }
  return { owner, policyHash: onchainPolicy, version };
}
