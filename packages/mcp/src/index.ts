#!/usr/bin/env node
/**
 * Obelisk MCP server (stdio). Gives any MCP client (Claude Desktop, Cursor, agent frameworks) tools to use an
 * Obelisk vault with an agent key. The key can only submit tasks; the vault's rules and a zero-knowledge proof
 * decide what actually executes.
 *
 * Env: OBELISK_AGENT_KEY (the key's private key), OBELISK_VAULT, optional OBELISK_API_URL.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Obelisk, type TaskOutcome } from "@obeliskmoney/agent-sdk";

const obelisk = new Obelisk({
  agentKey: process.env.OBELISK_AGENT_KEY,
  vault: process.env.OBELISK_VAULT,
  apiUrl: process.env.OBELISK_API_URL,
});
// Keep each tool call under typical client timeouts; a longer task can be followed with obelisk_task.
const WAIT_MS = Number(process.env.OBELISK_WAIT_SECS ?? 300) * 1000;

const server = new McpServer({ name: "obelisk", version: "0.1.0" });

function text(o: unknown) {
  return { content: [{ type: "text" as const, text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] };
}

function summary(o: TaskOutcome) {
  return text({
    ok: o.ok,
    status: o.status,
    reply: o.reply || undefined,
    executed: o.executed,
    refused: o.refused,
    taskId: o.id,
    note: o.refused.length ? "Refused steps broke the vault owner's rules; they were not sent onchain." : undefined,
  });
}

async function runAndWait(start: () => Promise<{ id: string }>) {
  const { id } = await start();
  try {
    return summary(await obelisk.wait(id, { timeoutMs: WAIT_MS }));
  } catch {
    return text({ taskId: id, status: "still running", hint: "Call obelisk_task with this taskId to get the result." });
  }
}

server.registerTool(
  "obelisk_status",
  {
    title: "Vault status",
    description: "Balances of the Obelisk vault, what was spent today and what is left under the daily limit.",
    inputSchema: {},
  },
  async () => runAndWait(() => obelisk.submit([{ type: "status" }])),
);

server.registerTool(
  "obelisk_swap_to_eth",
  {
    title: "Swap to ETH",
    description:
      "Swap an amount of the vault's stablecoin (USDG on mainnet) to ETH on the approved exchange; the ETH stays in the vault. " +
      "Refused if it breaks the owner's per-transaction limit, daily limit or price limit. Takes about 3 minutes (two proofs).",
    inputSchema: { amount: z.string().regex(/^\d+(\.\d{1,6})?$/).describe('Amount in the stablecoin, for example "2" or "0.5"') },
  },
  async ({ amount }) => runAndWait(() => obelisk.submit([{ type: "swap", amount }])),
);

server.registerTool(
  "obelisk_pay",
  {
    title: "Pay an approved payee",
    description:
      "Send an amount of the vault's stablecoin to an address the vault owner approved as a payee. Any other address is refused by the proof.",
    inputSchema: {
      to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Payee address approved by the vault owner"),
      amount: z.string().regex(/^\d+(\.\d{1,6})?$/).describe('Amount in the stablecoin, for example "10"'),
    },
  },
  async ({ to, amount }) => runAndWait(() => obelisk.submit([{ type: "pay", to, amount }])),
);

server.registerTool(
  "obelisk_task",
  {
    title: "Task result",
    description: "Current state of an earlier Obelisk task, with executed transactions and refusals.",
    inputSchema: { taskId: z.string().uuid() },
  },
  async ({ taskId }) => {
    const t = await obelisk.getTask(taskId);
    return ["done", "error"].includes(t.status) ? summary(await obelisk.wait(taskId, { timeoutMs: 0 })) : text({ taskId, status: t.status });
  },
);

await server.connect(new StdioServerTransport());
