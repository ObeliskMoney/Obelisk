#!/usr/bin/env bash
# Move Robinhood Chain mainnet to v4 vaults (onchain limits). Runs on the server, in /opt/obelisk.
#
# The SP1 program does not change (same programVKey), only the vault contract. So this:
#   1. deploys a new ObeliskVaultFactory for the same program, reusing the verifier and registry
#      (contracts/script/DeployFactory.s.sol with SAME_PROGRAM=true); the old factory moves to `legacyFactories`
#      and `vaultVersion` becomes 4
#   2. restarts the executor and agent so new vaults come from the v4 factory (the prover is untouched)
# Earlier vaults keep working. Their owners move to a v4 vault in the app (new vault, same rules, move the funds).
#
# Usage:  scripts/upgrade-mainnet-vault-v4.sh              (simulate only, sends no transactions)
#         scripts/upgrade-mainnet-vault-v4.sh --broadcast  (deploys the factory and restarts the services)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH=/root/.foundry/bin:$PATH

ALCHEMY=$(grep ^ROBINHOOD_TESTNET_RPC_URL /opt/obelisk/.env 2>/dev/null | cut -d= -f2- | sed s/robinhood-testnet/robinhood-mainnet/)
RPC=${ROBINHOOD_RPC_URL:-${ALCHEMY:-https://rpc.mainnet.chain.robinhood.com}}
set -a; . /opt/obelisk/.env.mainnet; set +a
DEP=contracts/deployments/robinhood.json

[ "$(cast chain-id --rpc-url "$RPC")" = 4663 ] || { echo "the RPC is not Robinhood mainnet"; exit 1; }
[ -z "$(git -c safe.directory="$PWD" status --porcelain --untracked-files=no)" ] || { echo "tracked files have local changes; deploy from a clean checkout"; exit 1; }
[ "$(jq -r '.vaultVersion // 3' $DEP)" != 4 ] || { echo "the current factory already makes v4 vaults; nothing to do"; exit 1; }

VKEY=$(jq -r .programVKey $DEP)
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
echo "program   $VKEY (unchanged)"
echo "deployer  $DEPLOYER  balance $(cast from-wei "$(cast balance "$DEPLOYER" --rpc-url "$RPC")") ETH"

MODE=""
[ "${1:-}" = "--broadcast" ] && MODE="--broadcast --slow"
(cd contracts && forge build -q && forge test -q --no-match-contract Invariant)
(cd contracts && CHAIN_NAME=robinhood PROGRAM_VKEY=$VKEY SAME_PROGRAM=true \
  forge script script/DeployFactory.s.sol:DeployFactory --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" $MODE)
[ -z "$MODE" ] && { echo "simulation OK. Run with --broadcast to deploy the v4 factory and switch the services."; exit 0; }

[ "$(jq -r .vaultVersion $DEP)" = 4 ] || { echo "the deployment file was not updated; stopping before the restart"; exit 1; }
FACTORY=$(jq -r .factory $DEP)
(cd contracts && forge verify-contract "$FACTORY" src/ObeliskVaultFactory.sol:ObeliskVaultFactory --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api/ --rpc-url "$RPC" --guess-constructor-args) || true

systemctl restart obelisk-executor obelisk-agent
sleep 5
curl -fsS http://127.0.0.1:8080/api/config | jq '{factory, legacyFactories, vaultVersion, programVKey}'
echo "done. Copy $DEP to apps/web/lib/deployment.json, redeploy the website and commit both files."
