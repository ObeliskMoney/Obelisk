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
  "function setAgent(address agent, bool allowed)",
  "function withdraw(address token, address to, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export interface Policy {
  version: 2;
  token: Address;
  maxPerTx: string;
  maxPerDay: string;
  allowedTargets: Address[];
  allowedRecipients: Address[];
  allowedSelectors: Hex[];
  denyUnlimitedApprove: boolean;
  allowedTokensOut: Address[];
}

/** Same as buildPolicy in packages/shared/src/vaults.ts. */
export function buildPolicy(
  cfg: { usdc: Address; router: Address; weth: Address },
  p: { maxPerTx: bigint; maxPerDay: bigint; recipients: Address[] },
): Policy {
  const selectors: Hex[] = ["0x095ea7b3", "0x04e45aaf"];
  if (p.recipients.length) selectors.push("0xa9059cbb");
  return {
    version: 2,
    token: cfg.usdc,
    maxPerTx: p.maxPerTx.toString(),
    maxPerDay: p.maxPerDay.toString(),
    allowedTargets: [cfg.router],
    allowedRecipients: p.recipients.map((r) => getAddress(r)),
    allowedSelectors: selectors,
    denyUnlimitedApprove: true,
    allowedTokensOut: [cfg.weth],
  };
}

/** docs/spec.md §2, same as packages/shared/src/hash.ts. */
export function policyHash(p: Policy): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address[]" },
        { type: "address[]" },
        { type: "bytes4[]" },
        { type: "bool" },
        { type: "address[]" },
      ],
      [
        p.version,
        p.token,
        BigInt(p.maxPerTx),
        BigInt(p.maxPerDay),
        p.allowedTargets,
        p.allowedRecipients,
        p.allowedSelectors,
        p.denyUnlimitedApprove,
        p.allowedTokensOut,
      ],
    ),
  );
}

export interface AgentConfig {
  chainId: number;
  factory: Address;
  registry: Address;
  usdc: Address;
  weth: Address;
  router: Address;
  tokenSymbol?: string;
  mockAssets?: boolean;
  teeSimulated?: boolean;
  agent: Address;
  attestation: string;
  verifierKind: string;
  codeMeasurement: Hex;
}
