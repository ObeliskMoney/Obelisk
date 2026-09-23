#!/usr/bin/env bash
# Move the server services (agent, prover, executor) from testnet to Robinhood Chain mainnet.
# Run AFTER scripts/deploy-mainnet.sh --broadcast has succeeded. A backup of .env is made automatically.
set -euo pipefail
cd /opt/obelisk
[ -f contracts/deployments/robinhood.json ] || { echo "deployments/robinhood.json does not exist yet"; exit 1; }
[ -f .env.mainnet ] || { echo ".env.mainnet does not exist yet"; exit 1; }

cp -a .env ".env.testnet.$(date +%s)"
MAINNET_RPC=${ROBINHOOD_RPC_URL:-$(grep ^ROBINHOOD_TESTNET_RPC_URL .env | cut -d= -f2- | sed s/robinhood-testnet/robinhood-mainnet/)}
EXEC_PK=$(grep ^EXECUTOR_PRIVATE_KEY .env.mainnet | cut -d= -f2-)

set_kv() { # set_kv KEY VALUE: replace or append the line KEY=VALUE
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi
}
set_kv OBELISK_CHAIN robinhood
set_kv ROBINHOOD_RPC_URL "$MAINNET_RPC"
set_kv EXECUTOR_PRIVATE_KEY "$EXEC_PK"
set_kv PRICE_KEEPER off
chmod 600 .env

systemctl restart obelisk-prover obelisk-executor
sleep 3
systemctl restart obelisk-agent
sleep 8
systemctl is-active obelisk-dstack-sim obelisk-prover obelisk-executor obelisk-agent
curl -fsS http://127.0.0.1:8080/api/health; echo
