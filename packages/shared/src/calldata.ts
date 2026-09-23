import { encodeFunctionData, parseAbi, type Address } from "viem";

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const swapRouter02Abi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

/** Uniswap QuoterV2 (called with eth_call). */
export const quoterV2Abi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** MockSwapRouter (dev/testnet): a fixed rate updated by the keeper. */
export const mockRouterAbi = parseAbi([
  "function rateNum() view returns (uint256)",
  "function rateDen() view returns (uint256)",
]);

export const SELECTORS = {
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
  exactInputSingle: "0x04e45aaf",
} as const;

export const approveData = (spender: Address, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });

export const transferData = (to: Address, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });

export const exactInputSingleData = (p: {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum?: bigint;
}) =>
  encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [{ ...p, amountOutMinimum: p.amountOutMinimum ?? 0n, sqrtPriceLimitX96: 0n }],
  });
