# GPU prover

A Groth16 proof of the policy program takes about 15 minutes on the server's CPU and about 75 seconds on one
RTX 4090 (measured 24 September 2026, including GPU server start and circuit loading). The server can hand
proofs to a rented GPU machine and falls back to its own CPU when that machine is unavailable.

## GPU machine

- NVIDIA GPU with 24 GB VRAM or more (compute capability 8.0+), CUDA 12 runtime, Linux x86_64, 32 GB+ disk.
  A Vast.ai RTX 4090 container works; Docker is not needed because `zk/elf` is committed.
- Build the prover with CUDA support (Rust stable, Go for gnark, `build-essential pkg-config libssl-dev clang
  protobuf-compiler cmake golang-go`):

```bash
cd zk/script && cargo build --release --features cuda --bin obelisk-prover --bin vkey
```

- `target/release/vkey` must print the deployed `programVKey`. The first proof downloads the Groth16 circuit
  (about 8 GB) to `~/.sp1/circuits`.
- Install [`deploy/gpu/obelisk-prove.sh`](../deploy/gpu/obelisk-prove.sh) as `/root/obelisk-prove.sh` and add the
  server's public key to `/root/.ssh/authorized_keys`, restricted to that script:

```
command="/root/obelisk-prove.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... obelisk-server-to-gpu
```

## Server

- An SSH host entry (for example `obelisk-gpu`) with the GPU machine's address, port and the key above.
- In `/opt/obelisk/.env`: `PROVER_GPU_SSH=obelisk-gpu` (optional `PROVER_GPU_TIMEOUT_SECS`, default 600), then
  `systemctl restart obelisk-prover`. `GET /health` on the prover reports `"gpu": true`.
- Proof results carry `"prover": "cuda"` when the GPU made them. Rules checks always run on the server.
- If the GPU machine stops (for example the rental ends), proofs fall back to the CPU. Remove `PROVER_GPU_SSH`
  to stop trying the GPU.
