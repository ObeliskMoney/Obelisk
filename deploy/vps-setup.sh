#!/usr/bin/env bash
# Obelisk server setup (Ubuntu 24.04, x86_64). Idempotent, safe to run again.
# Installs: Docker, Node 22 + pnpm, Rust + SP1, Foundry, Ollama (+ qwen2.5:7b), 32 GB swap.
# Every Obelisk service only listens on 127.0.0.1; outside access goes through an SSH tunnel or Caddy.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo -e "\n==> $*"; }

log "base packages"
apt-get update -qq
apt-get install -y -qq build-essential pkg-config libssl-dev protobuf-compiler golang-go clang git curl jq unzip ca-certificates >/dev/null

log "32 GB swap (Groth16 proofs need a lot of RAM)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 32G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

log "Node 22 + pnpm"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || npm install -g pnpm@11 >/dev/null

log "Rust + SP1"
if [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
fi
source "$HOME/.cargo/env"
if [ ! -x "$HOME/.sp1/bin/cargo-prove" ]; then
  curl -sL https://sp1up.succinct.xyz | bash >/dev/null
  "$HOME/.sp1/bin/sp1up" >/dev/null
fi

log "Foundry"
if [ ! -x "$HOME/.foundry/bin/forge" ]; then
  curl -sL https://foundry.paradigm.xyz | bash >/dev/null
  "$HOME/.foundry/bin/foundryup" >/dev/null
fi

log "Ollama (127.0.0.1 only)"
if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh >/dev/null
fi
systemctl enable --now ollama >/dev/null
ollama list | grep -q 'qwen2.5:7b' || ollama pull qwen2.5:7b

log "done"
docker --version; node -v; pnpm -v; cargo --version; "$HOME/.sp1/bin/cargo-prove" prove --version || true
"$HOME/.foundry/bin/forge" --version | head -1; ollama list; swapon --show
