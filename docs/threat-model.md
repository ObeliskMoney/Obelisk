# Obelisk threat model

Protected asset: the funds in `ObeliskVault`. Main claim: **the agent may be wrong or
hijacked, but the maximum loss is bounded by the policy**, because the vault only
executes intents that carry a zero-knowledge proof of policy compliance.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Vault owner | setting the policy, allowing or revoking the agent, withdrawing | n/a (the owner owns the funds) |
| LLM / agent | nothing | anything; it can be prompt-injected |
| Agent key (TEE) | showing the intent came from the registered code | limiting transaction value |
| Prover (SP1) | nothing, since proofs are verified onchain | n/a |
| Executor | liveness (sending transactions, paying gas) | safety; it cannot change an intent without breaking the signature or proof |
| SP1 verifier | correct Groth16 verification | n/a (cryptographic assumption) |

## Threats and mitigations

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Prompt injection makes the agent build a transfer to an attacker | The SP1 program refuses (selector, recipient or target not allowed), so no proof exists; forced onchain it reverts on proof verification | `demo_prompt_injection_transfer_all_rejected`, e2e scenario 3 |
| T2 | A valid proof for intent A is reused for intent B | The vault re-checks `intentHash` in the public values | `test_RevertWhen_ProofForDifferentIntent`, fuzz `TamperedIntentRejected` |
| T3 | Replaying an intent or signature | Single-use nonce and deadline | `test_RevertWhen_NonceReplayed`, `test_RevertWhen_Expired` |
| T4 | Replay across vaults or chains | `chainId` and `vault` are part of `intentHash` and the EIP-712 domain | `test_RevertWhen_SignatureForOtherVault`, `testFuzz_HashIntentBindsChain` |
| T5 | Gaming the daily limit (understated `spentBefore`, another day) | `spentBefore == spentOnDay[today]`, `day == today`, `spentAfter >= spentBefore` | `test_RevertWhen_SpentBeforeUnderstated`, `ProofFromOtherDay`, invariant `DailyOutflowWithinLimitAndRecorded` |
| T6 | Odd calldata to fool the decoder | Calldata length must match the ABI exactly; address padding is validated | `trailing_bytes_rejected`, `dirty_address_padding_rejected` |
| T7 | Swap output sent to an attacker | `recipient == vault` in the program | `swap_output_to_attacker_rejected` |
| T8 | Unlimited approval, then drained through `transferFrom` | `denyUnlimitedApprove` caps approvals at `maxPerDay`; the spender must be allowed | `approve_unlimited_rejected`, `approve_to_attacker_rejected` |
| T9 | Leaked agent key | Losses stay at most `maxPerDay` per day; the owner can revoke the agent | `test_RevertWhen_AgentRevoked` |
| T10 | Intent calls the vault itself (`setPolicy` and so on) | `SelfCall` check in the vault and the program | `test_RevertWhen_SelfCall`, `self_call_rejected` |
| T11 | Reentrancy through the target | `nonReentrant`; state is updated before the call | n/a |
| T12 | Malicious executor | Cannot change the intent; at worst it withholds transactions (liveness) | n/a |
| T13 | Someone else instructs the agent on my vault | Every task, schedule and registration is signed by the vault owner (`owner()` onchain), within a 5 minute window, with single-use signatures | `e2e-user.ts` (foreign wallet gets 401) |
| T14 | A fake policy JSON is registered for someone else's vault | Registration needs the owner's signature, `policyHash(JSON) == vault.policyHash()`, and the vault must come from the factory | `verifyVault` |
| T15 | The registered agent is used on a vault that did not choose it | `agentAllowed[agent]` per vault, chosen by the owner | `test_RevertWhen_AgentNotAllowedByVault` |
| T16 | Task spam clogs the proof queue or drains the executor's gas | Rate limit per IP, at most 3 pending tasks per vault and 20 overall, schedules at least 60 minutes apart, the executor only pays gas for factory vaults | n/a |
| T17 | The daily approval (at most `maxPerDay`) to the router is abused | The router only pulls from its caller (the vault), and the vault only calls the router through proven intents; swaps still count as spend | `approve_up_to_daily_limit_ok` |
| T18 | Swap into a worthless token | `tokenOut ∈ allowedTokensOut` (policy v2) | `swap_into_unlisted_token_rejected` |
| T19 | Swap without price protection | `amountOutMinimum > 0` (policy v2); the agent sets it from a live quote | `swap_without_min_out_rejected` |

## Known limits

1. **Attestation is verified offchain.** The registry owner checks the TDX quote before `registerAgent`.
   Onchain quote verification is planned.
2. **The agent runs in the dstack simulator.** There is no hardware isolation: root on the server can read
   the agent key. The public example `k256_key` was replaced with a random key, but trust still rests on the
   server operator, and the quote is an example quote (its Intel signature is not valid). Losses are still
   bounded by the policy (T9). Production plan: Phala Cloud (real TDX) with DCAP verification.
3. **MockVerifier for development.** Deployments with `verifierKind: "mock"` accept empty proofs, so anyone
   holding a registered agent key could bypass the policy. Testnet and mainnet use `SP1VerifierGroth16`.
4. **One limited token.** Other assets in the vault (for example WETH from swaps) are not covered by the
   limits; since the allowed selectors only cover approving and swapping the limited token, the agent cannot move them.
5. **Swap slippage.** Since policy v2, `tokenOut` must be allowed and `amountOutMinimum > 0`. The value of
   `amountOutMinimum` itself is chosen by the agent (Uniswap QuoterV2 quote minus `SWAP_SLIPPAGE_BPS`,
   2% by default). A malicious agent could choose a very small minimum, so losses from a bad price are still
   only bounded by `maxPerDay`. An oracle-based slippage bound inside the proof is planned.
6. **Day rollover.** A proof for day D that lands after the day changes reverts with `WrongDay` (safe, but it fails).
7. **No third-party audit yet.** See [self-audit.md](self-audit.md).
