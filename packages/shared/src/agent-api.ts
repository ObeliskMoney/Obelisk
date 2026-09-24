/**
 * Structured actions for external AI agents (docs/agents.md). An agent sends these instead of free text,
 * so no language model sits between its decision and the proof. The vault's rules still decide what runs.
 */
import { getAddress, isAddress } from "viem";

export type AgentAction =
  | { type: "status" }
  | { type: "swap"; amount: string }
  | { type: "pay"; to: string; amount: string };

/** At most this many actions per request. */
export const MAX_AGENT_ACTIONS = 5;
const AMOUNT = /^(?:\d{1,12})(?:\.\d{1,6})?$/;

/**
 * Parse and validate the JSON string an agent signed. Throws a readable error for anything unexpected,
 * so a malformed request is refused before it reaches the queue.
 */
export function parseAgentActions(json: string): AgentAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("actions must be a JSON array");
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("actions must be a non-empty array");
  if (raw.length > MAX_AGENT_ACTIONS) throw new Error(`at most ${MAX_AGENT_ACTIONS} actions per request`);
  return raw.map((a, i): AgentAction => {
    const where = `action ${i + 1}`;
    if (!a || typeof a !== "object") throw new Error(`${where} must be an object`);
    const o = a as Record<string, unknown>;
    const amount = () => {
      if (typeof o.amount !== "string" || !AMOUNT.test(o.amount) || Number(o.amount) <= 0) {
        throw new Error(`${where}: amount must be a positive decimal string, for example "2" or "0.5"`);
      }
      return o.amount;
    };
    switch (o.type) {
      case "status":
        return { type: "status" };
      case "swap":
        return { type: "swap", amount: amount() };
      case "pay":
        if (typeof o.to !== "string" || !isAddress(o.to, { strict: false })) throw new Error(`${where}: to must be an address`);
        return { type: "pay", to: getAddress(o.to), amount: amount() };
      default:
        throw new Error(`${where}: type must be "status", "swap" or "pay"`);
    }
  });
}

/** A short line for the task list and activity log, for example "swap 2 USDG to ETH". */
export function describeAgentActions(actions: AgentAction[], symbol: string): string {
  return actions
    .map((a) =>
      a.type === "status" ? "vault status" : a.type === "swap" ? `swap ${a.amount} ${symbol} to ETH` : `pay ${a.to} ${a.amount} ${symbol}`,
    )
    .join(", ");
}
