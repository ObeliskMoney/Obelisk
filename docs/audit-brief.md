# Obelisk audit brief

A handoff document for a security reviewer (human or AI). It describes what to review, what the system must guarantee, and what is already known.

## Authorization and rules of engagement

- The reviewer is engaged by the Obelisk team to review Obelisk's own code before and during its beta. The goal is to find bugs that could lose user funds and to fix them.
- Work on the source code in this repository and on a **local** chain only: `forge test`, `anvil`, or an anvil fork of Robinhood Chain (`anvil --fork-url <rpc>`). Proofs of concept are Foundry tests.
- Do not send transactions to the live mainnet contracts, and do not interact with vaults owned by other users. Reading public chain state is fine.
- Report each finding privately to the team (format below). Do not publish findings before a fix ships.

## System in one paragraph

Obelisk is a vault for AI agents on Robinhood Chain mainnet (Arbitrum Orbit, chainId 4663). A user deploys an `ObeliskVault` through `ObeliskVaultFactory` and commits a spending policy as `policyHash`. An AI agent may move funds only by calling `ObeliskVault.execute` with (1) an EIP-712 signature from an agent key that the vault owner allowed and that is active in `AgentRegistry`, and (2) an SP1 Groth16 proof that the intent satisfies the policy. The SP1 program (Rust, `zk/`) checks the intent against the policy and commits `PolicyOutput{policyHash, intentHash, spentBefore, spentAfter, day}`. The vault verifies the proof, checks every public value against its own state, updates the daily spend and then performs the call. The owner can always withdraw directly.

## Scope

| Component | Path | Size |
|---|---|---|
| Vault | `contracts/src/ObeliskVault.sol` | 164 lines |
| Factory | `contracts/src/ObeliskVaultFactory.sol` | 43 lines |
| Agent registry | `contracts/src/AgentRegistry.sol` | 47 lines |
| Interfaces | `contracts/src/interfaces/*.sol` | 56 lines |
| Policy logic (runs inside the proof) | `zk/lib/src/lib.rs` | 366 lines |
| SP1 program entry point | `zk/program/src/main.rs` | 16 lines |

Also relevant, lower priority: the agent to prover to executor flow in `agent/` and `executor/` (how intents, `spentBefore` and `day` are built), and `packages/shared` (TypeScript copies of the hashes).

Out of scope: OpenZeppelin and forge-std under `contracts/lib/`, Succinct's `SP1VerifierGroth16`, Uniswap, the USDG token, the website.

- Solidity 0.8.28, `evm_version = cancun`, optimizer 200 runs, OpenZeppelin v5.
- Commit: see `git rev-parse HEAD` at the time of review. Repository: github.com/ObeliskMoney/Obelisk.
- Specs: `docs/spec.md` (hashes, policy rules, check order), `docs/threat-model.md`, `docs/self-audit.md` (earlier self-review and its 16 findings).

## Live deployment (read-only reference)

From `contracts/deployments/robinhood.json`:

| Contract | Address |
|---|---|
| ObeliskVaultFactory (policy v3) | `0x4530A51f8efB1A3Fc3d57e14db1965A1038Bb15c` |
| Earlier factory (policy v2, legacy) | `0xadDe5A5cF722Ef1e6a55fB15d84Fd4A9a71a2429` |
| AgentRegistry | `0xd79210b37c548584f87d66B07C8296db75678FE8` |
| SP1VerifierGroth16 | `0x735A8EbC91e7ccC02A7275e13F4e02eab93cB5CA` |
| Reference vault | `0xc5a5f0af3D829Cd7198648008f617f1a4F281f02` |
| USDG (policy token) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH (allowed swap output) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` |

`programVKey = 0x002c72fab9e46ad169621189cf082ed7a585af657aa44c4ef657d3d0621c53bd` (policy v3; the v2 program was `0x005837e0791c16ed77947585ad983c678684500b27c6ff2ea54b700637f929bb`). Allowed selectors in the reference policy: `approve` (`0x095ea7b3`) and `exactInputSingle` (`0x04e45aaf`).

## Trust model

| Actor | Trusted for |
|---|---|
| Vault owner | Everything about their own vault: policy, programVKey, allowed agents, withdrawals. |
| AgentRegistry owner (Obelisk team) | Registering agent keys after checking their TEE attestation offchain; revoking keys. |
| Agent key | Nothing beyond the policy. Assume it is fully compromised (for example through prompt injection). |
| Prover / executor / relayer | Nothing. Anyone may submit `execute`; the inputs they choose must not matter. |
| SP1 verifier + program | Soundness of the proof system is assumed; the correctness of our program is in scope. |

## Properties that must hold

1. Without a valid signature from an allowed, active agent **and** a valid proof for this vault's `policyHash` and `programVKey`, `execute` reverts.
2. The total `policy.token` the agent spends in one UTC day never exceeds `maxPerDay`, and no single intent spends more than `maxPerTx`.
3. The agent can never send funds to an address that is not in `allowedRecipients`, can never make a swap whose output leaves the vault, and can never swap into a token outside `allowedTokensOut`.
4. The agent cannot move any asset other than `policy.token` (for example the WETH received from swaps, or native ETH).
5. A signed intent and its proof can be used at most once, only on the vault and chain they were made for, and only before `deadline`.
6. The owner can always withdraw every asset, even while an agent is misbehaving, and can stop an agent with `setAgent(agent, false)`.
7. Nothing an agent or a relayer does can lock the vault or change its owner, policy or allowed agents.

## Questions worth checking first

These are prompts for the review, not confirmed issues.

- **Spend accounting.** `approve` counts as 0 spend and is capped at `maxPerDay` per call. Can repeated approvals plus swaps, or allowance left from earlier days, let the router or anyone else pull more than `maxPerDay` in a day?
- **Router semantics.** SwapRouter02 `exactInputSingle` has special cases (for example `amountIn` equal to `CONTRACT_BALANCE`, payer selection). Does the spend the program computes always equal what actually leaves the vault?
- **Calldata decoding.** The program requires exact calldata lengths and uses `abi_decode_validate`. Is there any calldata that the Rust decoder and the EVM target interpret differently (dirty high bits, alternative encodings)?
- **Day and spent binding.** `day`, `spentBefore` and `chain_id` are prover inputs; the vault checks `day == block.timestamp / 1 days` and `spentBefore == spentOnDay[day]`. Any gap around midnight UTC, long deadlines or two intents proven against the same `spentBefore`?
- **Nonces.** A single global nonce space per vault, chosen by the signer. Any griefing or replay path, including across vaults made by the factory?
- **Owner-settable programVKey.** `setPolicy` lets the owner set any `programVKey`. Is there any path where someone other than the owner benefits from that?
- **Registry.** Revoked keys can never be reactivated. Is `agentAllowed && registry.isActive` enforced everywhere it needs to be?
- **Hash consistency.** `intentHash` and `policyHash` must match byte for byte across Solidity, Rust and TypeScript (`contracts/test/Vectors.t.sol`, `packages/shared/test/vectors.json`).
- **Price floor (policy v3, self-audit F-15).** The floor `minOutPerIn` is static and set by the owner, and `allowedFees` pins the pool. Is the 512-bit comparison exact at the boundary, and can any path (for example `amountIn = 0`, which SwapRouter02 treats as "use the router's balance") avoid it?
- **Legacy factories.** The agent and executor serve vaults from `legacyFactories` once their `programVKey` equals the current program. Any way to register or execute for a vault that is not from an Obelisk factory, or still on the old program?

## How to run

```bash
cd contracts && forge test -vv
```

```bash
cd contracts && forge coverage --report summary --no-match-coverage "(test|mocks|script)"
```

```bash
cd zk && cargo test -p obelisk-policy
```

A mainnet fork rehearsal of the full flow is in `scripts/fork-rehearsal.sh`.

## Finding format

For each finding:

- **Title** and **severity** (Critical, High, Medium, Low, Informational), with a one-line reason for the severity.
- **Location**: file and line.
- **Description**: what is wrong and which property above it breaks.
- **Proof of concept**: a Foundry test (or a Rust test for `zk/lib`) that fails before the fix. Local chain or fork only.
- **Recommendation**: the smallest fix.

Also list the properties you checked and found to hold, so the team knows what was covered.
