import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import type { Intent, Policy } from "./types.js";

/** docs/spec.md §2. */
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
        { type: "uint24[]" },
        { type: "uint256[]" },
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
        p.allowedFees,
        p.minOutPerIn.map((x) => BigInt(x)),
      ],
    ),
  );
}

/** docs/spec.md §1.1. */
export function intentHash(i: Intent, chainId: number, vault: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint64" },
      ],
      [BigInt(chainId), vault, i.target, i.value, keccak256(i.data), i.nonce, i.deadline],
    ),
  );
}

/** docs/spec.md §1.2, used with viem's `signTypedData`. */
export function intentTypedData(i: Intent, chainId: number, vault: Address) {
  return {
    domain: { name: "Obelisk", version: "1", chainId, verifyingContract: vault },
    types: {
      Intent: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Intent",
    message: i,
  } as const;
}

export const policyOutputAbi = [
  {
    type: "tuple",
    components: [
      { name: "policyHash", type: "bytes32" },
      { name: "intentHash", type: "bytes32" },
      { name: "spentBefore", type: "uint256" },
      { name: "spentAfter", type: "uint256" },
      { name: "day", type: "uint64" },
    ],
  },
] as const;
