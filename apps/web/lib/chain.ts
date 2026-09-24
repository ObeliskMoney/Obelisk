import { encodeAbiParameters, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";

export { CHAIN } from "./network";

export const factoryAbi = parseAbi([
  "function createVault(bytes32 policyHash, address agent) returns (address)",
  "function vaultsOf(address owner) view returns (address[])",
]);

export const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function policyHash() view returns (bytes32)",
  "function spentOnDay(uint64 day) view returns (uint256)",
  "function agentAllowed(address agent) view returns (bool)",
  "function programVKey() view returns (bytes32)",
  "function setPolicy(bytes32 policyHash, bytes32 programVKey)",
  "function setAgent(address agent, bool allowed)",
  "function withdraw(address token, address to, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** Vaults made before policy v3 still load with a v2 policy (no pool or price floor). */
export interface Policy {
  version: 2 | 3;
  token: Address;
  maxPerTx: string;
  maxPerDay: string;
  allowedTargets: Address[];
  allowedRecipients: Address[];
  allowedSelectors: Hex[];
  denyUnlimitedApprove: boolean;
  allowedTokensOut: Address[];
  /** Uniswap fee tiers a swap may use, which pins the pool (v3). */
  allowedFees?: number[];
  /** Price floor per `allowedTokensOut[i]`: least amountOut per unit of amountIn, times 1e18 (v3). */
  minOutPerIn?: string[];
}

/** `minOutPerIn` is scaled by 1e18; the token has 6 decimals and WETH 18, so 1e18 * 1e18 / 1e6 = 1e30 per whole token. */
const FLOOR_PER_PRICE = 10n ** 30n;

/** Highest ETH price the agent may pay (token smallest units per ETH, 6 decimals) → policy price floor, rounded up. */
export function priceCapToMinOutPerIn(capUnits: bigint): bigint {
  const n = FLOOR_PER_PRICE * 10n ** 6n;
  return (n + capUnits - 1n) / capUnits;
}

/** Policy price floor → highest ETH price the agent may pay, in token smallest units (6 decimals). */
export function minOutPerInToPriceCap(minOutPerIn: bigint): bigint {
  return (FLOOR_PER_PRICE * 10n ** 6n) / minOutPerIn;
}

/** Same as buildPolicy in packages/shared/src/vaults.ts. */
export function buildPolicy(
  cfg: { usdc: Address; router: Address; weth: Address; swapFee?: number },
  p: { maxPerTx: bigint; maxPerDay: bigint; recipients: Address[]; minOutPerIn: bigint },
): Policy {
  if (p.minOutPerIn <= 0n) throw new Error("the price limit must be above zero");
  const selectors: Hex[] = ["0x095ea7b3", "0x04e45aaf"];
  if (p.recipients.length) selectors.push("0xa9059cbb");
  return {
    version: 3,
    token: cfg.usdc,
    maxPerTx: p.maxPerTx.toString(),
    maxPerDay: p.maxPerDay.toString(),
    allowedTargets: [cfg.router],
    allowedRecipients: p.recipients.map((r) => getAddress(r)),
    allowedSelectors: selectors,
    denyUnlimitedApprove: true,
    allowedTokensOut: [cfg.weth],
    allowedFees: [cfg.swapFee ?? 500],
    minOutPerIn: [p.minOutPerIn.toString()],
  };
}

/** docs/spec.md §2, same as packages/shared/src/hash.ts. A v2 policy hashes without the last two fields. */
export function policyHash(p: Policy): Hex {
  const types = [
    { type: "uint8" },
    { type: "address" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "address[]" },
    { type: "address[]" },
    { type: "bytes4[]" },
    { type: "bool" },
    { type: "address[]" },
  ] as const;
  const values = [
    p.version,
    p.token,
    BigInt(p.maxPerTx),
    BigInt(p.maxPerDay),
    p.allowedTargets,
    p.allowedRecipients,
    p.allowedSelectors,
    p.denyUnlimitedApprove,
    p.allowedTokensOut,
  ] as const;
  if (p.version === 2) return keccak256(encodeAbiParameters(types, values));
  return keccak256(
    encodeAbiParameters(
      [...types, { type: "uint24[]" }, { type: "uint256[]" }],
      [...values, p.allowedFees ?? [], (p.minOutPerIn ?? []).map((x) => BigInt(x))],
    ),
  );
}

export interface AgentConfig {
  chainId: number;
  factory: Address;
  /** Earlier factories whose vaults are still listed (they must move to the current program first). */
  legacyFactories?: Address[];
  programVKey?: Hex;
  registry: Address;
  usdc: Address;
  weth: Address;
  router: Address;
  tokenSymbol?: string;
  swapFee?: number;
  mockAssets?: boolean;
  teeSimulated?: boolean;
  agent: Address;
  attestation: string;
  verifierKind: string;
  codeMeasurement: Hex;
}
