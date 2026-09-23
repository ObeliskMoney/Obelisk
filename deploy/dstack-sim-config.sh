#!/usr/bin/env bash
# Configure the dstack simulator on the server for Obelisk:
# 1. Replace the example k256_key (public in the dstack repo) with a random key, so the agent key is actually secret.
# 2. Fill app-compose.json with the Obelisk compose file + git commit, so the compose hash = our code measurement.
set -euo pipefail
SIM=/opt/dstack/sdk/simulator
ROOT=/opt/obelisk
COMMIT=${1:?usage: dstack-sim-config.sh <git-commit>}

cd "$SIM"
[ -f appkeys.json.orig ] || cp appkeys.json appkeys.json.orig
[ -f app-compose.json.orig ] || cp app-compose.json app-compose.json.orig

python3 - "$ROOT" "$COMMIT" <<'PY'
import json, secrets, sys
root, commit = sys.argv[1], sys.argv[2]
keys = json.load(open("appkeys.json"))
orig = json.load(open("appkeys.json.orig"))
if keys["k256_key"] == orig["k256_key"]:
    keys["k256_key"] = secrets.token_hex(32)
    json.dump(keys, open("appkeys.json", "w"))
    print("k256_key replaced with a random key")
compose = open(f"{root}/deploy/dstack/docker-compose.yml").read()
app = {
    "manifest_version": 2,
    "name": "obelisk-agent",
    "runner": "docker-compose",
    "docker_compose_file": compose + f"\n# obelisk-commit: {commit}\n",
    "gateway_enabled": False,
    "public_logs": True,
    "public_sysinfo": True,
    "public_tcbinfo": True,
    "key_provider_id": "",
    "allowed_envs": ["ROBINHOOD_TESTNET_RPC_URL", "GROQ_API_KEY", "PROVER_URL", "EXECUTOR_URL"],
    "no_instance_id": False,
    "secure_time": False,
    "key_provider": "kms",
    "kms_enabled": True,
    "storage_fs": "ext4",
}
json.dump(app, open("app-compose.json", "w"), separators=(",", ":"))
print("app-compose.json written for commit", commit)
PY
chmod 600 appkeys.json
