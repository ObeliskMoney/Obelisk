/**
 * Single source of truth for "which chain is this website serving".
 * Everything derives from lib/deployment.json (a copy of contracts/deployments/<chain>.json),
 * so switching testnet ↔ mainnet only means replacing that file and redeploying.
 */
import { defineChain } from "viem";
import deployment from "./deployment.json";

type Dep = typeof deployment & { tokenSymbol?: string; swapFee?: number; mockAssets?: boolean; quoter?: string };
const dep = deployment as Dep;

/** Official accounts, linked from the header and footer. */
export const X_URL = "https://x.com/Obeliskdotmoney";
export const REPO_URL = "https://github.com/ObeliskMoney/Obelisk";

/** The official Obelisk token on Robinhood Chain mainnet. This site and @Obeliskdotmoney are the only sources for it. */
export const OBSK = {
  ticker: "OBSK",
  name: "OBELISK",
  address: "0x909b27ce60eab5c6bf7688acd8e5026106828f02",
  supply: "1,000,000,000",
  decimals: 18,
  /** The launchpad page where $OBSK launched and trades. */
  trade: "https://www.ponsfamily.com/launchpad/0x909B27ce60eab5C6bF7688ACd8E5026106828f02",
} as const;

/** Uniswap QuoterV2, used to suggest a price limit when a vault is created. Absent on mock deployments. */
export const QUOTER = dep.quoter as `0x${string}` | undefined;

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
