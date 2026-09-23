# Obelisk self-audit report

Date: 23 September 2026 · Scope: `contracts/src/` (ObeliskVault, ObeliskVaultFactory, AgentRegistry), `zk/lib` (policy program), the agent to executor flow.
This is a self-review, **not a professional audit**.

## Method

| Tool / technique | Result |
|---|---|
| Foundry unit tests | All passing |
| Foundry fuzz (1,000 runs per test) | 5 fuzz tests pass: tampered intents, fake day or spend, chain binding, `onlyOwner` |
| Foundry invariants (256 runs × 64 depth, about 16k calls) | 2 invariants hold: the attacker is never paid, and daily outflow equals `spentOnDay` and stays within the limit |
| Cross-language vectors | `intentHash`, `policyHash` and `publicValues` identical in Solidity, Rust and TypeScript |
| Rust unit tests for the policy program | 29 tests pass, including odd calldata, dirty padding, overflow and the policy v2 rules |
| Real proof test | A real Groth16 proof verified by `SP1VerifierGroth16` (`contracts/test/RealProof.t.sol`) |
| Mainnet fork rehearsal | Full flow on a Robinhood Chain fork with USDG, Uniswap v3 and real proofs (`scripts/fork-rehearsal.sh`) |
| Slither 0.11.5 | 2 informational findings (below) |
| Aderyn 0.6.8 | 1 High (false positive), 4 Low |
| Coverage | ObeliskVault 95% lines / 100% functions, AgentRegistry 100% |

## Findings

| ID | Source | Finding | Status |
|---|---|---|---|
| F-1 | Aderyn H-1 | "State changes after external call" in `execute` (calls to `registry.isActive` and `verifier.verifyProof`) | **False positive.** Both are `view` functions called with `STATICCALL` and cannot change state. `execute` is also `nonReentrant`, and vault state is updated before calling `intent.target`. |
| F-2 | Aderyn L-2 | `nonReentrant` is not the first modifier on `withdraw` | **Fixed.** The order is now `nonReentrant onlyOwner`. |
| F-3 | Aderyn L-1 | Centralization risk (owner) | **Accepted.** The owner is the owner of the funds. `Ownable2Step` prevents mistaken ownership transfers. |
| F-4 | Aderyn L-3 | PUSH0 opcode | **Accepted.** Robinhood Chain (Arbitrum Orbit, ArbOS ≥ 20) supports PUSH0, and deployments work. |
| F-5 | Aderyn L-4 | Interface pragma `^0.8.20` | **Accepted.** Interfaces are intentionally loose for integrators. Core contracts are pinned to `0.8.28`. |
| F-6 | Slither | `block.timestamp` used for deadlines and dates | **Accepted.** A sequencer shifting time by a few seconds does not affect a limit with one-day granularity. |
| F-7 | Slither | Cyclomatic complexity of `execute` is 12 | **Accepted.** Each branch is one explicit security check, and all are tested. |
| F-8 | Manual review | An approval could execute even when the following swap was refused (a dangling approval, at most `maxPerDay`) | **Fixed** in the agent. Every step is checked and proven first, and execution only happens if all pass. |
| F-9 | Manual review | The dstack simulator's example key is public, so anyone could derive the simulator's agent key | **Fixed** for our deployments. The simulator's `k256_key` was replaced with a random key (`deploy/dstack-sim-config.sh`). Losses are still bounded by the policy (T9). |
| F-10 | Manual review | The SP1 ELF build was not reproducible across machines, so `programVKey` differed | **Fixed.** The ELF is built in Docker and committed to `zk/elf/`. The prover uses that file. |
| F-11 | Manual review | Swap `tokenOut` was unrestricted and `amountOutMinimum` could be zero, so the agent could swap into junk or be sandwiched | **Partly fixed (policy v2).** `tokenOut` must be in `allowedTokensOut` and `amountOutMinimum > 0` (tests `swap_into_unlisted_token_rejected`, `swap_without_min_out_rejected`). The agent uses a QuoterV2 quote minus 2%. There is no oracle-based slippage bound inside the proof yet, so price losses are still bounded by `maxPerDay`. |
| F-12 | Manual review | With `MockVerifier`, anyone holding an active agent key can bypass the policy | **By design for development.** Testnet and mainnet use `SP1VerifierGroth16`; `deployments/*.json` records `verifierKind`. |
| F-13 | Manual review | Two intents proven at the same time use the same `spentBefore`, so the second reverts with `SpentMismatch` | **Accepted.** Safe (fails closed). It only affects liveness, and the agent processes intents sequentially. |
| F-14 | Manual review | A task that would be refused still waited for proofs of its other steps (for example an approval) before being refused | **Fixed** in the agent. Rules are checked for every step first (under a second); proofs are only generated when all steps pass. |

## Verified security properties

1. An intent without a valid proof is never executed (`test_RevertWhen_ProofInvalid`, invariant `AttackerNeverPaid`).
2. A proof is valid for one intent, one vault, one chain and one day only (`IntentMismatch`, `SignatureForOtherVault`, `HashIntentBindsChain`, `WrongDay`).
3. Total daily token outflow cannot exceed `maxPerDay` and always equals the onchain record (invariant `DailyOutflowWithinLimitAndRecorded`).
4. Intents cannot be replayed (`NonceReplayed`).
5. A revoked agent loses access immediately (`AgentRevoked`).

## Recommendations

- A professional audit of the contracts and the SP1 program.
- Onchain (or oracle-based) TDX quote verification instead of the registry owner.
- A timelock on `setPolicy` and limits on `withdraw` destinations.
- ~~`tokenOut` whitelist~~ (done in policy v2). An oracle-based slippage bound inside the proof.
- Monitoring: alerts for repeated refusals or reverts from the same agent.
- Move the registry owner key to a multisig.
