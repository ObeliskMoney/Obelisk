import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import type { Policy } from "./types.js";

/** Output of `forge script Deploy` (contracts/deployments/<chain>.json). */
export interface Deployment {
  chainId: number;
  vault: Address;
  registry: Address;
  factory: Address;
  verifier: Address;
  verifierKind: "mock" | "sp1-groth16";
  usdc: Address;
  weth: Address;
  router: Address;
  /** Uniswap QuoterV2 (real assets). Empty or zero for MockSwapRouter. */
  quoter?: Address;
  /** Symbol of the token limited by the policy, for example USDC (testnet) or USDG (mainnet). */
  tokenSymbol?: string;
  /** Uniswap pool fee tier for token/WETH. */
  swapFee?: number;
  /** true = mock token and router (dev/testnet). */
  mockAssets?: boolean;
  programVKey: `0x${string}`;
  policy: Policy;
  policyHash: `0x${string}`;
  startBlock: number;
}

export function loadDeployment(root: string, chain: string): Deployment {
  const f = join(root, "contracts", "deployments", `${chain}.json`);
  if (!existsSync(f)) throw new Error(`deployment ${f} not found; run the deploy first`);
  return JSON.parse(readFileSync(f, "utf8")) as Deployment;
}
