import type { Address, Hex } from "viem";

/** docs/spec.md §2. Amounts in the token's smallest unit, stored as decimal strings. */
export interface Policy {
  version: 2;
  token: Address;
  maxPerTx: string;
  maxPerDay: string;
  allowedTargets: Address[];
  allowedRecipients: Address[];
  allowedSelectors: Hex[];
  denyUnlimitedApprove: boolean;
  /** Tokens a swap may output (policy v2). */
  allowedTokensOut: Address[];
}

/** docs/spec.md §1. */
export interface Intent {
  target: Address;
  value: bigint;
  data: Hex;
  nonce: bigint;
  deadline: bigint;
}

/** Input for the obelisk-prover CLI (same as `ProverInput` in zk/lib). */
export interface ProverInput {
  chainId: number;
  vault: Address;
  policy: Policy;
  intent: Intent;
  spentBefore: bigint;
  day: number;
}

export type ProverResult =
  | {
      ok: true;
      policyHash: Hex;
      intentHash: Hex;
      spentBefore: string;
      spentAfter: string;
      day: number;
      publicValues: Hex;
      proof?: Hex;
      vkey?: Hex;
      prover?: string;
    }
  | { ok: false; code: string; reason: string };
