import { describe, expect, it } from "vitest";
import { decodeAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import vectors from "./vectors.json" with { type: "json" };
import examplePolicy from "../../../docs/policy.example.json" with { type: "json" };
import {
  exactInputSingleData,
  intentHash,
  intentTypedData,
  policyHash,
  policyOutputAbi,
  proverInputJson,
  type Intent,
  type Policy,
} from "../src/index.js";

const v = vectors.input;
const intent: Intent = {
  target: v.intent.target as Hex,
  value: BigInt(v.intent.value),
  data: v.intent.data as Hex,
  nonce: BigInt(v.intent.nonce),
  deadline: BigInt(v.intent.deadline),
};
const policy = examplePolicy as Policy;

describe("cross-language vectors (Rust ↔ TS)", () => {
  it("policyHash", () => {
    expect(policyHash(policy)).toBe(vectors.policyHash);
  });

  it("intentHash", () => {
    expect(intentHash(intent, v.chainId, v.vault as Hex)).toBe(vectors.intentHash);
  });

  it("exactInputSingle calldata", () => {
    const data = exactInputSingleData({
      tokenIn: policy.token,
      tokenOut: policy.allowedTokensOut[0]!,
      fee: 500,
      recipient: v.vault as Hex,
      amountIn: 50_000_000n,
      amountOutMinimum: 18_000_000_000_000_000n,
    });
    expect(data).toBe(v.intent.data);
  });

  it("publicValues decode", () => {
    const [o] = decodeAbiParameters(policyOutputAbi, vectors.publicValues as Hex);
    expect(o.spentAfter).toBe(150_000_000n);
    expect(o.intentHash).toBe(vectors.intentHash);
  });

  it("proverInputJson round-trips the shapes serde expects", () => {
    const json = JSON.parse(
      proverInputJson({ chainId: 1, vault: v.vault as Hex, policy, intent, spentBefore: 5n, day: 3 }),
    );
    expect(json.intent.deadline).toBe(v.intent.deadline);
    expect(json.intent.nonce).toBe("7");
    expect(json.spentBefore).toBe("5");
  });

  it("EIP-712 typed data can be signed", async () => {
    const acct = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const sig = await acct.signTypedData(intentTypedData(intent, v.chainId, v.vault as Hex));
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
