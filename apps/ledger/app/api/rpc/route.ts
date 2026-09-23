// Read-only RPC proxy (the provider key stays on the server). Transactions are sent from the user's wallet.
const RPC = process.env.RPC_URL;
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionCount",
]);

export async function POST(req: Request) {
  if (!RPC) return Response.json({ error: "RPC_URL is not set" }, { status: 500 });
  const body = await req.json();
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 20 || calls.some((c) => !ALLOWED.has(c?.method))) {
    return Response.json({ error: "method not allowed" }, { status: 400 });
  }
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
export const dynamic = "force-dynamic";
