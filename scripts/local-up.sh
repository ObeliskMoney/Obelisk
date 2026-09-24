#!/usr/bin/env bash
# Run all of Obelisk on a local chain (Anvil): deploy, register the agent, prover (mock), executor.
# Usage:  scripts/local-up.sh            then   pnpm --filter @obelisk/agent task "swap 50 USDC to ETH"
#         scripts/local-up.sh --down     to stop everything
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.local"
mkdir -p "$RUN"

stop() { for f in "$RUN"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done; }
if [ "${1:-}" = "--down" ]; then stop; echo "stopped"; exit 0; fi
stop

# Default Anvil account #0 (public, local chain only)
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC=http://127.0.0.1:8545

anvil --port 8545 --silent > "$RUN/anvil.log" 2>&1 & echo $! > "$RUN/anvil.pid"
for _ in $(seq 30); do cast block-number --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.3; done

[ -x "$ROOT/zk/target/release/vkey" ] || (cd "$ROOT/zk" && cargo build --release -p obelisk-prover)
VKEY=$("$ROOT/zk/target/release/vkey" 2>/dev/null)

# Dev agent key (in a TEE this key is derived by dstack and never leaves the enclave)
if [ ! -f "$RUN/agent.env" ]; then
  echo "AGENT_DEV_PRIVATE_KEY=$(cast wallet new --json | node -p 'JSON.parse(require("fs").readFileSync(0))[0].private_key')" > "$RUN/agent.env"
fi
AGENT_PK=$(cut -d= -f2 "$RUN/agent.env")
AGENT=$(cast wallet address --private-key "$AGENT_PK")

(cd "$ROOT/contracts" && DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK CHAIN_NAME=local PROGRAM_VKEY=$VKEY AGENT_ADDRESS=$AGENT \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast >/dev/null)
REGISTRY=$(node -p "require('$ROOT/contracts/deployments/local.json').registry")
(cd "$ROOT/contracts" && DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK REGISTRY=$REGISTRY AGENT_ADDRESS=$AGENT \
  CODE_MEASUREMENT=$(cast keccak obelisk-agent-dev) \
  forge script script/Deploy.s.sol:RegisterAgent --rpc-url $RPC --broadcast >/dev/null)

rm -f "$ROOT/executor/data/local.jsonl"
export OBELISK_CHAIN=local
(cd "$ROOT/executor" && SP1_PROVER=${SP1_PROVER:-mock} exec node --import tsx src/prover-server.ts > "$RUN/prover.log" 2>&1 & echo $! > "$RUN/prover.pid")
(cd "$ROOT/executor" && LEDGER_STORE=file PRICE_KEEPER=off DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK exec node --import tsx src/server.ts > "$RUN/executor.log" 2>&1 & echo $! > "$RUN/executor.pid")
(cd "$ROOT/agent" && DB=memory AGENT_DEV_PRIVATE_KEY=$AGENT_PK exec node --import tsx src/server.ts > "$RUN/agent.log" 2>&1 & echo $! > "$RUN/agent.pid")
for _ in $(seq 60); do curl -sf localhost:8082/health >/dev/null && curl -sf localhost:8081/health >/dev/null && curl -sf localhost:8080/api/config >/dev/null && break; sleep 0.5; done

echo "✓ anvil :8545  prover :8081 (${SP1_PROVER:-mock})  executor :8082  agent API :8080"
echo "✓ vault $(node -p "require('$ROOT/contracts/deployments/local.json').vault")  agent $AGENT"
echo
echo "Try:  OBELISK_CHAIN=local \$(cat .local/agent.env) pnpm --filter @obelisk/agent task \"swap 50 USDC to ETH\""
