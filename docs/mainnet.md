# Obelisk on Robinhood Chain mainnet

Deployed on 23 September 2026. This document records the mainnet setup, how it was rehearsed, and what is still open.

## Obelisk contracts (chain 4663)

See [`contracts/deployments/robinhood.json`](../contracts/deployments/robinhood.json).

| Contract | Address |
|---|---|
| ObeliskVaultFactory | `0xadDe5A5cF722Ef1e6a55fB15d84Fd4A9a71a2429` |
| AgentRegistry | `0xd79210b37c548584f87d66B07C8296db75678FE8` |
| SP1 Groth16 verifier v6.1.0 | `0x735A8EbC91e7ccC02A7275e13F4e02eab93cB5CA` |
| Policy program verification key | `0x005837e0791c16ed77947585ad983c678684500b27c6ff2ea54b700637f929bb` |

## External addresses, checked onchain

| What | Address | Notes |
|---|---|---|
| USDG (Paxos Global Dollar) | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | 6 decimals, the main stablecoin on this chain |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | from `SwapRouter02.WETH9()`, same as L2 WETH in the Robinhood docs |
| Uniswap v3 SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | developers.uniswap.org |
| Uniswap v3 QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | used by the agent for `amountOutMinimum` |
| USDG/WETH 0.01% pool | `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca` | about 2,400 WETH and 12 million USDG when checked |
| USDC (Arbitrum bridge) | `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` | **Not used**: about 340 USDC in supply and no v3 pool with WETH |

That is why mainnet vaults limit **USDG**, not USDC.

## What changed for mainnet

1. **Policy v2** (partly closes F-11): `allowedTokensOut` and `amountOutMinimum > 0` are checked inside the proof.
2. **No mock assets:** `Deploy.s.sol` takes `TOKEN/WETH/ROUTER/QUOTER` and does not deploy mocks or mint.
   The test price keeper is off (`mockAssets: false`).
3. **Slippage:** the agent takes a QuoterV2 quote and uses a 98% minimum (`SWAP_SLIPPAGE_BPS=200`).
   Because a proof takes about 15 minutes, a swap can revert if the price moves more than 2%. Funds stay safe; the swap just fails.
4. **Fresh keys:** the mainnet deployer and executor keys were generated on the server and are not reused from testnet.
5. **Honest TEE status:** the API reports `teeSimulated`, and the website says plainly that the agent still runs in the simulator.
6. **Website:** every chain, token and explorer label comes from `apps/ledger/lib/deployment.json`.

## Fork rehearsal

`scripts/fork-rehearsal.sh` runs the whole stack on a mainnet fork (anvil): deployment with real assets,
agent registration, a vault funded with 200 USDG, then the task "swap 50 USDG to ETH" through the LLM, real Groth16
proofs, and a swap in the real Uniswap pool.

Result on 23 Sep 2026 (fork around block 70.46 million, Alchemy archive RPC):

- 2 real Groth16 proofs (946 s and 902 s), both verified by the contracts on the fork.
- `approve 300 USDG`, then `swap 50 USDG to ETH`, executed. Vault: 200 → 150 USDG, 0 → 0.018284 WETH
  (the QuoterV2 quote at the time was 0.018291 WETH, well within the 2% tolerance).
- Note: the public Robinhood RPC is not an archive node. After about 30 minutes of proving, the fork could no longer
  read old state, so the rehearsal and production use an archive RPC.

## First mainnet transactions

- Allowance: `0xe61c59b4967066e1450042823262aea36af3a247047754ebc6db1e5ca6c4c020`
- Swap 2 USDG to ETH: `0xa6deac6b099434d5e3a8d9de2b06cb8802de337421c4311bc88ae1316acc606d`
- A swap above the daily limit was refused without touching the chain (`EXCEEDS_PER_DAY`).

## Still open

| Item | Risk | Plan |
|---|---|---|
| Third-party audit | A contract bug could lose user funds | Beta with small limits until an audit is done |
| TEE is still the simulator | Root on the server can read the agent key; the policy still bounds losses to `maxPerDay` | Move to Phala Cloud (real TDX) |
| CPU prover, about 15 minutes per proof, one queue | Slow, and one queue for everyone | Succinct Prover Network or GPU as usage grows |
| Registry owner is one hot key | If the server is breached, a fake agent could be registered (still bound by each vault's policy and `agentAllowed`) | Move ownership to a multisig (Safe) |

## Release steps (as performed)

1. Fund the mainnet **deployer** and **executor** with ETH on Robinhood Chain.
2. On the server: `scripts/deploy-mainnet.sh` (simulation), then `scripts/deploy-mainnet.sh --broadcast`.
3. On the server: `scripts/switch-vps-to-mainnet.sh` (backs up `.env`, sets `OBELISK_CHAIN=robinhood`, the archive
   mainnet RPC and the mainnet executor key, restarts the services and prints `/api/health`).
4. Commit `contracts/deployments/robinhood.json` and copy it to `apps/ledger/lib/deployment.json`.
5. Vercel: point the `RPC_URL` env (used by `/api/rpc`) at the mainnet RPC, then deploy to production. Check `/status`.
6. Test with a small amount (for example 5 USDG) before announcing.
