import type { ProverInput } from "./types.js";

/**
 * Serializes ProverInput to the JSON that serde reads in zk/lib.
 * U256 → decimal string, u64 (`deadline`, `day`, `chainId`) → number.
 */
export function proverInputJson(input: ProverInput): string {
  const { intent } = input;
  return JSON.stringify({
    ...input,
    spentBefore: input.spentBefore.toString(),
    intent: {
      ...intent,
      value: intent.value.toString(),
      nonce: intent.nonce.toString(),
      deadline: Number(intent.deadline),
    },
  });
}
