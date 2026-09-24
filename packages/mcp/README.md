# @obeliskmoney/mcp

MCP server for [Obelisk](https://obelisk.cash): lets Claude Desktop, Cursor or any MCP client use an Obelisk vault
with an **agent key**. The key can only ask for swaps into ETH, payments to approved payees and the balance; the
vault's rules and a zero-knowledge proof decide what actually executes.

Create the key in the Obelisk app (your vault, **Agent keys**), then add to the client's MCP configuration:

```json
{
  "mcpServers": {
    "obelisk": {
      "command": "npx",
      "args": ["-y", "@obeliskmoney/mcp"],
      "env": { "OBELISK_AGENT_KEY": "0x...", "OBELISK_VAULT": "0x..." }
    }
  }
}
```

| Tool | What it does |
|---|---|
| `obelisk_status` | Balances, spent today, left today |
| `obelisk_swap_to_eth` | Swap an amount of the stablecoin to ETH, kept in the vault |
| `obelisk_pay` | Pay an approved payee |
| `obelisk_task` | Result of an earlier task (for tasks that outlast a tool call) |

Optional env: `OBELISK_API_URL`, `OBELISK_WAIT_SECS` (default 300). Guide: [docs/agents.md](https://github.com/ObeliskMoney/Obelisk/blob/main/docs/agents.md).
