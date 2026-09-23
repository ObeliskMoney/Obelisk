/**
 * Single source of truth for "which chain is this website serving".
 * Everything derives from lib/deployment.json (a copy of contracts/deployments/<chain>.json),
 * so switching testnet ↔ mainnet only means replacing that file and redeploying.
 */
import { defineChain } from "viem";
import deployment from "./deployment.json";

type Dep = typeof deployment & { tokenSymbol?: string; swapFee?: number; mockAssets?: boolean };
const dep = deployment as Dep;

export const IS_MAINNET = dep.chainId === 4663;

export const CHAIN = IS_MAINNET
  ? defineChain({
      id: 4663,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
      blockExplorers: { default: { name: "Explorer", url: "https://explorer.mainnet.chain.robinhood.com" } },
    })
  : defineChain({
      id: 46630,
      name: "Robinhood Chain Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
      blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
      testnet: true,
    });

export const EXPLORER = CHAIN.blockExplorers!.default.url;
/** "Robinhood Chain" or "Robinhood Chain testnet", for sentences on the website. */
export const NETWORK_LABEL = IS_MAINNET ? "Robinhood Chain" : "Robinhood Chain testnet";
/** The stablecoin limited by the policy: USDG on mainnet, mock USDC on testnet. */
export const TOKEN = dep.tokenSymbol ?? "USDC";
/** true = mock token and router; the "get test tokens" button only appears here. */
export const MOCK_ASSETS = dep.mockAssets !== false;
/**
 * The agent currently runs in the dstack simulator, not Intel TDX hardware. The website must say so honestly.
 * Set NEXT_PUBLIC_TEE_SIMULATED=false only after the agent moves to a real TEE (for example Phala Cloud).
 */
export const TEE_SIMULATED = process.env.NEXT_PUBLIC_TEE_SIMULATED !== "false";
