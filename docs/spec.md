# Obelisk spec

This document is the source of truth for the data formats shared by
`contracts/` (Solidity), `zk/` (Rust/SP1) and `packages/shared/` (TypeScript).
If any encoding below changes, all three must change together and the test
vectors in `packages/shared/test/vectors.json` must be regenerated.

## 1. Intent

One onchain action proposed by the agent and executed by the vault
(`vault.call{value: value}(target, data)`).

| Field      | Type      | Notes                                         |
|------------|-----------|-----------------------------------------------|
| `target`   | `address` | Contract to call (DEX router or token)        |
| `value`    | `uint256` | ETH sent. **Must be 0**                        |
| `data`     | `bytes`   | Calldata                                      |
| `nonce`    | `uint256` | Unique per vault; marked used after execution |
| `deadline` | `uint64`  | Unix timestamp; the vault rejects it if `block.timestamp > deadline` |

### 1.1 intentHash

Binds the intent to one vault and one chain, so a proof or signature cannot be
replayed on another vault or chain.

```
intentHash = keccak256(abi.encode(
    chainId      uint256,
    vault        address,
    target       address,
    value        uint256,
    keccak256(data) bytes32,
    nonce        uint256,
    deadline     uint64
))
```

### 1.2 Agent signature (EIP-712)

```
domain = { name: "Obelisk", version: "1", chainId, verifyingContract: vault }
Intent(address target,uint256 value,bytes data,uint256 nonce,uint64 deadline)
```

The signer must be allowed by the vault owner (`setAgent`) and active in `AgentRegistry`.

## 2. Policy

Stored offchain as JSON (see `docs/policy.example.json`); only its `policyHash`
is stored onchain.

| Field                  | Type        | Notes |
|------------------------|-------------|-------|
| `version`              | `uint8`     | `3` (v1 and v2 are no longer accepted by the program; v2 had no pool or price bound on swaps) |
| `token`                | `address`   | The limited token (USDG on mainnet). All limits are in its smallest unit |
| `maxPerTx`             | `uint256`   | Maximum spend per intent |
| `maxPerDay`            | `uint256`   | Maximum spend per UTC day (`block.timestamp / 86400`) |
| `allowedTargets`       | `address[]` | Contracts that may be called besides `token` itself |
| `allowedRecipients`    | `address[]` | Allowed `transfer` recipients (may be empty) |
| `allowedSelectors`     | `bytes4[]`  | Subset of the known selectors (§3) |
| `denyUnlimitedApprove` | `bool`      | If `true`, `approve` is capped at `≤ maxPerDay` |
| `allowedTokensOut`     | `address[]` | Tokens a swap may output (for example WETH) |
| `allowedFees`          | `uint24[]`  | Uniswap fee tiers a swap may use; this pins the pool (for example `[100]`) |
| `minOutPerIn`          | `uint256[]` | Price floor per `allowedTokensOut[i]`: the least `amountOut` per unit of `amountIn`, times `1e18`. Same length as `allowedTokensOut`, every entry above zero |

```
policyHash = keccak256(abi.encode(
    version uint8, token address, maxPerTx uint256, maxPerDay uint256,
    allowedTargets address[], allowedRecipients address[],
    allowedSelectors bytes4[], denyUnlimitedApprove bool,
    allowedTokensOut address[], allowedFees uint24[], minOutPerIn uint256[]
))
```

## 3. Policy rules (enforced inside the SP1 program)

The program refuses (panics, so no proof exists) unless **every** rule holds.

General:
- the policy is well formed: every `allowedFees` entry fits in `uint24`, and `minOutPerIn` has one non-zero entry per `allowedTokensOut`
- `value == 0`
- `len(data) >= 4` and `selector ∈ allowedSelectors`
- the length of `data` must match the selector's ABI **exactly** (odd calldata is refused)

Per selector (only these three are known):

| Selector | Function | Target rule | Argument rules | spend |
|---|---|---|---|---|
| `0x095ea7b3` | `approve(address spender,uint256 amount)` | `target == token` | `spender ∈ allowedTargets`; if `denyUnlimitedApprove` then `amount ≤ maxPerDay` | `0` |
| `0xa9059cbb` | `transfer(address to,uint256 amount)` | `target == token` | `to ∈ allowedRecipients` | `amount` |
| `0x04e45aaf` | `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))` (Uniswap SwapRouter02) | `target ∈ allowedTargets` | `tokenIn == token`, `recipient == vault`, `fee ∈ allowedFees`, `tokenOut == allowedTokensOut[k]`, `amountOutMinimum > 0`, `amountOutMinimum * 1e18 >= amountIn * minOutPerIn[k]` (computed in 512 bits) | `amountIn` |

Limits:
- `spend ≤ maxPerTx`
- `spentAfter = spentBefore + spend ≤ maxPerDay`

The human-readable violation messages compiled into the program are frozen: the
program's verification key (`programVKey`) is fixed in the deployed contracts, and
any change to the program binary would change it. User-facing text is produced
from the stable violation codes (for example `EXCEEDS_PER_DAY`) outside the program.

## 4. Public values (SP1 program output)

```
publicValues = abi.encode(PolicyOutput{
    policyHash  bytes32,
    intentHash  bytes32,
    spentBefore uint256,
    spentAfter  uint256,
    day         uint64
})
```

## 5. Order of checks in `ObeliskVault.execute`

1. `block.timestamp <= intent.deadline`
2. `!usedNonce[intent.nonce]`
3. the EIP-712 signer is allowed by the vault owner (`agentAllowed`) **and** active in `AgentRegistry`
4. `verifier.verifyProof(programVKey, publicValues, proof)` does not revert
5. `out.policyHash == policyHash`, `out.intentHash == intentHash(intent)`
6. `out.day == block.timestamp / 86400`, `out.spentBefore == spentOnDay[day]`
7. set `usedNonce`, `spentOnDay[day] = out.spentAfter`, then call the target
8. if the call fails, the whole transaction reverts

`spentBefore` must equal the value recorded onchain, so the daily limit cannot be
bypassed with a proof that uses a different number. `day` must be today, so an
"empty day" cannot be used to reset the counter.

## 6. Known limits (by design)

- The TEE attestation is verified offchain by the registry owner before `registerAgent`.
- Only one token is limited per policy; other assets in the vault are not covered by the limits,
  and the allowed selectors do not let the agent move them.
- ETH `value` is always 0.
- Transactions refused by the policy program never touch the chain; the activity log
  records them from the executor's report. Transactions that are *forced* onchain with a
  fake proof revert and are recorded with their transaction hash.
