import { defineChain, type Chain } from "viem";
import { anvil, baseSepolia } from "viem/chains";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.mainnet.chain.robinhood.com" } },
});

export const CHAINS: Record<string, { chain: Chain; rpcEnv: string }> = {
  local: { chain: anvil, rpcEnv: "LOCAL_RPC_URL" },
  robinhood: { chain: robinhood, rpcEnv: "ROBINHOOD_RPC_URL" },
  // Local mainnet fork (anvil) for the dress rehearsal: scripts/fork-rehearsal.sh
  "robinhood-fork": { chain: robinhood, rpcEnv: "ROBINHOOD_FORK_RPC_URL" },
  "robinhood-testnet": { chain: robinhoodTestnet, rpcEnv: "ROBINHOOD_TESTNET_RPC_URL" },
  "base-sepolia": { chain: baseSepolia, rpcEnv: "BASE_SEPOLIA_RPC_URL" },
};

export function resolveChain(name: string): { chain: Chain; rpcUrl: string } {
  const c = CHAINS[name];
  if (!c) throw new Error(`unknown chain ${name} (${Object.keys(CHAINS).join(", ")})`);
  const rpcUrl = process.env[c.rpcEnv] ?? (name === "local" ? "http://127.0.0.1:8545" : undefined);
  if (!rpcUrl) throw new Error(`env ${c.rpcEnv} is not set`);
  return { chain: c.chain, rpcUrl };
}
