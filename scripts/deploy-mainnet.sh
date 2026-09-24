#!/usr/bin/env bash
# Deploy Obelisk to Robinhood Chain mainnet (4663) with real assets. Runs on the server.
#
# Requirements:
#   - /opt/obelisk/.env.mainnet holds DEPLOYER_PRIVATE_KEY and EXECUTOR_PRIVATE_KEY (generated on the server, chmod 600)
#   - the deployer holds mainnet ETH (the deploy is about 5 million gas; at 0.05 gwei well under 0.001 ETH)
#   - zk/target/release/vkey is built from the committed zk/elf
#   - the agent API is running (its attestation is read during registration)
#
# Usage:  scripts/deploy-mainnet.sh            (simulation only, sends no transactions)
#         scripts/deploy-mainnet.sh --broadcast
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=/root/.foundry/bin:$PATH

# Archive RPC derived from the testnet URL in .env; falls back to the public RPC.
ALCHEMY=$(grep ^ROBINHOOD_TESTNET_RPC_URL /opt/obelisk/.env 2>/dev/null | cut -d= -f2- | sed s/robinhood-testnet/robinhood-mainnet/)
RPC=${ROBINHOOD_RPC_URL:-${ALCHEMY:-https://rpc.mainnet.chain.robinhood.com}}
set -a; . /opt/obelisk/.env.mainnet; set +a

# Robinhood Chain mainnet addresses, checked onchain on 23 Sep 2026 (see docs/mainnet.md).
USDG=0x5fc5360d0400a0fd4f2af552add042d716f1d168
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
ROUTER=0xcaf681a66d020601342297493863e78c959e5cb2
QUOTER=0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7
SWAP_FEE=100
# Policy v3 price floor for the demo vault: least WETH wei per USDG unit, times 1e18 (1e30 / max USDG per ETH).
MIN_OUT_PER_IN=${MIN_OUT_PER_IN:?set MIN_OUT_PER_IN, for example 187000000000000000000000000 for at most 5,348 USDG per ETH}

[ "$(cast chain-id --rpc-url "$RPC")" = 4663 ] || { echo "the RPC is not Robinhood mainnet"; exit 1; }
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
EXECUTOR=$(cast wallet address --private-key "$EXECUTOR_PRIVATE_KEY")
AGENT=$(curl -fsS http://127.0.0.1:8080/api/identity | jq -r .address)
VKEY=$(zk/target/release/vkey)
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
echo "deployer $DEPLOYER  balance $(cast from-wei "$BAL") ETH"
echo "executor $EXECUTOR  balance $(cast from-wei "$(cast balance "$EXECUTOR" --rpc-url "$RPC")") ETH"
echo "agent    $AGENT"
echo "vkey     $VKEY"
[ "$BAL" != 0 ] || { echo "the deployer has no ETH yet"; exit 1; }
[ -f contracts/deployments/robinhood.json ] && { echo "deployments/robinhood.json already exists; delete it by hand if you really want to redeploy"; exit 1; }

MODE=""
[ "${1:-}" = "--broadcast" ] && MODE="--broadcast --slow"
(cd contracts && SP1_VERIFIER_VERSION=v6.1.0 PROGRAM_VKEY=$VKEY AGENT_ADDRESS=$AGENT CHAIN_NAME=robinhood \
  TOKEN=$USDG WETH=$WETH ROUTER=$ROUTER QUOTER=$QUOTER TOKEN_SYMBOL=USDG SWAP_FEE=$SWAP_FEE MIN_OUT_PER_IN=$MIN_OUT_PER_IN \
  forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" $MODE)
# forge also writes deployments/robinhood.json during simulation; remove it so it is not mistaken for a real deploy.
[ -z "$MODE" ] && { rm -f contracts/deployments/robinhood.json; echo "simulation OK. Run with --broadcast for the real deployment."; exit 0; }

# Register the agent after its attestation is checked offchain (agent/src/register.ts).
MEASUREMENT=$(curl -fsS http://127.0.0.1:8080/api/identity | jq -r .attestation.codeMeasurement)
(cd agent && OBELISK_CHAIN=robinhood ROBINHOOD_RPC_URL=$RPC AGENT_URL=http://127.0.0.1:8080/api \
  EXPECTED_MEASUREMENT=$MEASUREMENT node --import tsx src/register.ts)

# Verify source on Blockscout (may fail; does not affect the deployment).
DEP=contracts/deployments/robinhood.json
for c in verifier:src/sp1/v6.1.0/SP1VerifierGroth16.sol:SP1Verifier registry:src/AgentRegistry.sol:AgentRegistry \
         factory:src/ObeliskVaultFactory.sol:ObeliskVaultFactory; do
  addr=$(jq -r ".${c%%:*}" $DEP)
  (cd contracts && forge verify-contract "$addr" "${c#*:}" --verifier blockscout \
    --verifier-url https://robinhoodchain.blockscout.com/api/ --rpc-url "$RPC" --guess-constructor-args) || true
done
echo "done: $DEP"
