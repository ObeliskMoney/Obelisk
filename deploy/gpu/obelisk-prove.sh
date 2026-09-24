#!/usr/bin/env bash
# Forced command for the server's SSH key on the GPU machine (see docs/gpu-prover.md).
# The key can only run the prover: the ProverInput JSON arrives on stdin, the result JSON leaves on stdout.
set -euo pipefail
case "${SSH_ORIGINAL_COMMAND:-}" in
  prove) MODE=prove ;;
  check) MODE=check ;;
  *) echo '{"ok":false,"code":"PROVER_ERROR","reason":"unsupported command"}'; exit 1 ;;
esac
cd /root/zk
exec env SP1_PROVER=cuda ./target/release/obelisk-prover --mode "$MODE" --input -
