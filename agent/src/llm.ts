/**
 * LLM planner: turns a natural-language request into a list of actions (tool calls).
 * Uses an OpenAI-compatible chat-completions API, so the provider can be swapped through env:
 *   LLM_BASE_URL / LLM_MODEL / LLM_API_KEY          (utama, default Groq)
 *   LLM_FALLBACK_BASE_URL / LLM_FALLBACK_MODEL      (fallback, for example Ollama on the server)
 *
 * This agent is intentionally naive: there is no prompt-injection filter in the application.
 * Fund safety is enforced by the policy and the proof checked by the contract, not by the prompt.
 */

export type Action =
  | { tool: "vault_status" }
  | { tool: "swap_usdc_to_eth"; amountUsdc: string }
  | { tool: "transfer_usdc"; to: string; amountUsdc: string }
  | { tool: "approve_usdc"; spender: string; amountUsdc: string };

export interface Plan {
  actions: Action[];
  reply: string;
  model: string;
}

export interface PlanContext {
  /** Payees allowed by the vault policy, with names from the user (may be empty). */
  recipients: { address: string; label: string }[];
  /** The vault's stablecoin symbol, for example USDC (testnet) or USDG (mainnet). */
  token?: string;
}

export type Planner = (task: string, ctx?: PlanContext) => Promise<Plan>;

const SYSTEM = `You are the Obelisk Agent, which manages a user's stablecoin vault onchain.
Turn the user's request into tool calls. One request may produce several tool calls.
Amounts are always in the vault's stablecoin as plain decimals (for example "50" or "12.5"). For an unlimited approval use "max".
If the user names a payee, use the address from the payee list. Never invent an address.
If the user asks about the balance or state of the vault, call vault_status.
If the request needs no onchain action, answer briefly without tools.
Reply briefly and kindly, in the language the user wrote in.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "vault_status",
      description: "Show the vault balance (stablecoin, ETH) and what is left of today's spending limit.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "swap_usdc_to_eth",
      description: "Swap the vault's stablecoin into ETH (WETH) through the DEX router.",
      parameters: {
        type: "object",
        properties: { amount_usdc: { type: "string", description: "Amount, for example \"50\"" } },
        required: ["amount_usdc"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_usdc",
      description: "Send stablecoin from the vault to an address.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Destination address 0x..." },
          amount_usdc: { type: "string", description: "Amount" },
        },
        required: ["to", "amount_usdc"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_usdc",
      description: "Grant a contract an allowance on the vault's stablecoin.",
      parameters: {
        type: "object",
        properties: {
          spender: { type: "string", description: "Contract address 0x..." },
          amount_usdc: { type: "string", description: "Amount or \"max\"" },
        },
        required: ["spender", "amount_usdc"],
      },
    },
  },
] as const;

interface Endpoint {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function endpoints(): Endpoint[] {
  const primary: Endpoint = {
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
    model: process.env.LLM_MODEL ?? "openai/gpt-oss-20b",
    apiKey: process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY,
  };
  const out = [primary];
  if (process.env.LLM_FALLBACK_BASE_URL) {
    out.push({
      baseUrl: process.env.LLM_FALLBACK_BASE_URL,
      model: process.env.LLM_FALLBACK_MODEL ?? "qwen2.5:7b",
      apiKey: process.env.LLM_FALLBACK_API_KEY,
    });
  }
  return out;
}

function toAction(name: string, args: Record<string, string>): Action | null {
  switch (name) {
    case "vault_status":
      return { tool: name };
    case "swap_usdc_to_eth":
      return { tool: name, amountUsdc: String(args.amount_usdc) };
    case "transfer_usdc":
      return { tool: name, to: String(args.to), amountUsdc: String(args.amount_usdc) };
    case "approve_usdc":
      return { tool: name, spender: String(args.spender), amountUsdc: String(args.amount_usdc) };
    default:
      return null;
  }
}

function contextMessage(ctx?: PlanContext): string {
  const t = ctx?.token ?? "USDC";
  const token =
    t === "USDC"
      ? ""
      : `This vault's stablecoin is ${t}. The *_usdc tools and the amount_usdc field apply to ${t}; if the user says USDC, dollars or ${t}, they mean ${t}.\n`;
  if (!ctx?.recipients.length) return `${token}Allowed payees: (none).`;
  return (
    token +
    "Allowed payees:\n" +
    ctx.recipients.map((r) => `- ${r.label || "(no name)"}: ${r.address}`).join("\n")
  );
}

async function callOnce(ep: Endpoint, task: string, ctx?: PlanContext): Promise<Plan> {
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ep.model,
      temperature: 0,
      tool_choice: "auto",
      tools: TOOLS,
      messages: [
        { role: "system", content: `${SYSTEM}\n\n${contextMessage(ctx)}` },
        { role: "user", content: task },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`LLM ${ep.baseUrl} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices: { message: { content?: string; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };
  const msg = body.choices[0]?.message;
  const actions = (msg?.tool_calls ?? [])
    .map((c) => toAction(c.function.name, JSON.parse(c.function.arguments || "{}")))
    .filter((a): a is Action => a !== null);
  return { actions, reply: msg?.content ?? "", model: ep.model };
}

/** Default planner: try the primary endpoint, then the fallback. */
export const llmPlanner: Planner = async (task, ctx) => {
  let last: unknown;
  for (const ep of endpoints()) {
    try {
      return await callOnce(ep, task, ctx);
    } catch (e) {
      last = e;
      console.warn(`[llm] ${ep.model} failed: ${(e as Error).message}`);
    }
  }
  throw last;
};
