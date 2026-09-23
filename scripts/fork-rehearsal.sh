#!/usr/bin/env bash
# Mainnet dress rehearsal: the whole Obelisk stack on a fork of Robinhood Chain mainnet (anvil).
# Real assets (USDG, WETH, Uniswap SwapRouter02 + QuoterV2), the real SP1 Groth16 verifier,
# real proofs (SP1_PROVER=cpu, about 15 minutes each). No real funds are used.
#
# Usage (on a machine that can reach a mainnet archive RPC):
#   GROQ_API_KEY=... scripts/fork-rehearsal.sh "swap 50 USDG to ETH"
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
TASK=${1:-"swap 50 USDG to ETH"}
MAINNET_RPC=${MAINNET_RPC:-https://rpc.mainnet.chain.robinhood.com}
PORT=${FORK_PORT:-8546}
RPC=http://127.0.0.1:$PORT

# Robinhood Chain mainnet (4663) addresses, checked onchain on 23 Sep 2026.
USDG=0x5fc5360d0400a0fd4f2af552add042d716f1d168
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
ROUTER=0xcaf681a66d020601342297493863e78c959e5cb2   # Uniswap SwapRouter02
QUOTER=0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7   # Uniswap QuoterV2
USDG_WHALE=0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca # USDG/WETH 0.01% pool, fork only

# Built-in anvil keys (public, fork only).
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
EXECUTOR_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
AGENT_PK=0x5de4111afa1a4b94908f86f5ac5b7a6b20a2bdd0e5cfbe6fd4ad5c2a19a9b8e6
AGENT=$(cast wallet address $AGENT_PK)

VKEY=$(zk/target/release/vkey)
echo "[fork] vkey $VKEY"

anvil --fork-url "$MAINNET_RPC" --port $PORT --chain-id 4663 --silent &
ANVIL=$!
trap 'kill $ANVIL $PROVER $EXEC 2>/dev/null || true' EXIT
PROVER=; EXEC=
for _ in $(seq 60); do cast block-number --rpc-url $RPC >/dev/null 2>&1 && break; sleep 1; done

(cd contracts && DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK SP1_VERIFIER_VERSION=v6.1.0 PROGRAM_VKEY=$VKEY \
  AGENT_ADDRESS=$AGENT CHAIN_NAME=robinhood-fork TOKEN=$USDG WETH=$WETH ROUTER=$ROUTER QUOTER=$QUOTER \
  TOKEN_SYMBOL=USDG SWAP_FEE=100 \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast -q)
DEP=contracts/deployments/robinhood-fork.json
VAULT=$(jq -r .vault $DEP); REGISTRY=$(jq -r .registry $DEP)
echo "[fork] vault $VAULT"

(cd contracts && DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK REGISTRY=$REGISTRY AGENT_ADDRESS=$AGENT \
  CODE_MEASUREMENT=$(cast keccak "obelisk-agent-dev") \
  forge script script/Deploy.s.sol:RegisterAgent --rpc-url $RPC --broadcast -q)

# Fund the vault with 200 USDG from the pool (only possible on a fork).
cast rpc anvil_impersonateAccount $USDG_WHALE --rpc-url $RPC >/dev/null
cast rpc anvil_setBalance $USDG_WHALE 0x8AC7230489E80000 --rpc-url $RPC >/dev/null
cast send $USDG "transfer(address,uint256)" $VAULT 200000000 --from $USDG_WHALE --unlocked --rpc-url $RPC -q
echo "[fork] vault USDG $(cast call $USDG 'balanceOf(address)(uint256)' $VAULT --rpc-url $RPC)"

export OBELISK_CHAIN=robinhood-fork ROBINHOOD_FORK_RPC_URL=$RPC DB=memory LEDGER_STORE=file PRICE_KEEPER=off
export PROVER_URL=http://127.0.0.1:9081 EXECUTOR_URL=http://127.0.0.1:9082
(cd executor && PROVER_PORT=9081 SP1_PROVER=${SP1_PROVER:-cpu} node --import tsx src/prover-server.ts) &
PROVER=$!
(cd executor && EXECUTOR_PORT=9082 EXECUTOR_PRIVATE_KEY=$EXECUTOR_PK node --import tsx src/server.ts) &
EXEC=$!
sleep 5

(cd agent && AGENT_DEV_PRIVATE_KEY=$AGENT_PK node --import tsx src/cli.ts "$TASK")

echo "[fork] vault USDG $(cast call $USDG 'balanceOf(address)(uint256)' $VAULT --rpc-url $RPC)"
echo "[fork] vault WETH $(cast call $WETH 'balanceOf(address)(uint256)' $VAULT --rpc-url $RPC)"
