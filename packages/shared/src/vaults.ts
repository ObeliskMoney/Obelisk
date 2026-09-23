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

/** The policy every vault uses: fixed token, router and swap output; limits and payees chosen by the user. */
export function buildPolicy(
  dep: Pick<Deployment, "usdc" | "router" | "weth">,
  p: { maxPerTx: bigint; maxPerDay: bigint; recipients: Address[] },
): Policy {
  const selectors: `0x${string}`[] = [SELECTORS.approve, SELECTORS.exactInputSingle];
  if (p.recipients.length) selectors.push(SELECTORS.transfer);
  return {
    version: 2,
    token: dep.usdc,
    maxPerTx: p.maxPerTx.toString(),
    maxPerDay: p.maxPerDay.toString(),
    allowedTargets: [dep.router],
    allowedRecipients: p.recipients.map((r) => getAddress(r)),
    allowedSelectors: selectors,
    denyUnlimitedApprove: true,
    allowedTokensOut: [dep.weth],
  };
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
): Promise<{ owner: Address; policyHash: `0x${string}` }> {
  const [owner, onchainPolicy] = await Promise.all([
    client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: obeliskVaultAbi, functionName: "policyHash" }),
  ]);
  const vaults = await client.readContract({
    address: dep.factory,
    abi: obeliskVaultFactoryAbi,
    functionName: "vaultsOf",
    args: [owner],
  });
  if (!vaults.some((v) => v.toLowerCase() === vault.toLowerCase())) {
    throw new Error("this vault was not created by the Obelisk factory");
  }
  if (policy) {
    if (policyHash(policy).toLowerCase() !== onchainPolicy.toLowerCase()) {
      throw new Error("the rules do not match the policy hash stored in the vault");
    }
    if (policy.token.toLowerCase() !== dep.usdc.toLowerCase()) throw new Error(`the rules must limit ${dep.tokenSymbol ?? "USDC"}`);
    if (policy.allowedTargets.some((t) => t.toLowerCase() !== dep.router.toLowerCase())) {
      throw new Error("the rules may only allow the approved exchange");
    }
    if (policy.version !== 2 || policy.allowedTokensOut.some((t) => t.toLowerCase() !== dep.weth.toLowerCase())) {
      throw new Error("the rules may only allow swaps into ETH");
    }
  }
  return { owner, policyHash: onchainPolicy };
}
