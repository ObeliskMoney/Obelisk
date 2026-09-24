#!/usr/bin/env bash
# Move Robinhood Chain mainnet to a new policy program (new programVKey). Runs on the server, in /opt/obelisk.
#
# What it does:
#   1. builds the prover and vkey tools from the committed zk/elf into zk/target-next, so the running prover
#      keeps its current binary until the new factory exists
#   2. deploys a new ObeliskVaultFactory for the new program, reusing the verifier and registry
#      (contracts/script/DeployFactory.s.sol); the old factory moves to `legacyFactories`
#   3. restarts the prover, executor and agent so they serve the new program
# Existing vaults keep working only after their owner moves them to the new program in the app (setPolicy).
#
# Usage:  scripts/upgrade-mainnet-program.sh              (build and simulate only, sends no transactions)
#         scripts/upgrade-mainnet-program.sh --broadcast  (deploys the factory and restarts the services)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=/root/.foundry/bin:$HOME/.cargo/bin:$HOME/.sp1/bin:$PATH

ALCHEMY=$(grep ^ROBINHOOD_TESTNET_RPC_URL /opt/obelisk/.env 2>/dev/null | cut -d= -f2- | sed s/robinhood-testnet/robinhood-mainnet/)
RPC=${ROBINHOOD_RPC_URL:-${ALCHEMY:-https://rpc.mainnet.chain.robinhood.com}}
set -a; . /opt/obelisk/.env.mainnet; set +a
DEP=contracts/deployments/robinhood.json

[ "$(cast chain-id --rpc-url "$RPC")" = 4663 ] || { echo "the RPC is not Robinhood mainnet"; exit 1; }
[ -z "$(git -c safe.directory="$PWD" status --porcelain --untracked-files=no)" ] || { echo "tracked files have local changes; deploy from a clean checkout"; exit 1; }

NEXT=$PWD/zk/target-next
(cd zk/script && CARGO_TARGET_DIR=$NEXT cargo build -q --release --bin obelisk-prover --bin vkey)
VKEY=$($NEXT/release/vkey)
OLD=$(jq -r .programVKey $DEP)
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
echo "current program $OLD"
echo "new program     $VKEY"
echo "deployer        $DEPLOYER  balance $(cast from-wei "$(cast balance "$DEPLOYER" --rpc-url "$RPC")") ETH"
[ "$VKEY" != "$OLD" ] || { echo "zk/elf is already the deployed program; nothing to do"; exit 1; }

MODE=""
[ "${1:-}" = "--broadcast" ] && MODE="--broadcast --slow"
(cd contracts && CHAIN_NAME=robinhood PROGRAM_VKEY=$VKEY \
  forge script script/DeployFactory.s.sol:DeployFactory --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" $MODE)
[ -z "$MODE" ] && { echo "simulation OK. Run with --broadcast to deploy the factory and switch the services."; exit 0; }

[ "$(jq -r .programVKey $DEP)" = "$VKEY" ] || { echo "the deployment file was not updated; stopping before the restart"; exit 1; }
FACTORY=$(jq -r .factory $DEP)
(cd contracts && forge verify-contract "$FACTORY" src/ObeliskVaultFactory.sol:ObeliskVaultFactory --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api/ --rpc-url "$RPC" --guess-constructor-args) || true

# The prover service runs zk/target/release/obelisk-prover per job; switch it to the new program only now.
install -m 755 $NEXT/release/obelisk-prover zk/target/release/obelisk-prover
install -m 755 $NEXT/release/vkey zk/target/release/vkey
systemctl restart obelisk-prover obelisk-executor obelisk-agent
sleep 5
curl -fsS http://127.0.0.1:8080/api/config | jq '{factory, legacyFactories, programVKey}'
echo "done. Copy $DEP to apps/web/lib/deployment.json, redeploy the website and commit both files."
