# @obeliskmoney/agent-sdk

Let any AI agent spend from an [Obelisk](https://obelisk.cash) vault, inside the owner's onchain rules.

The vault owner creates an **agent key** in the Obelisk app. The key can only ask for swaps into ETH, payments to
approved payees and the balance: it cannot withdraw, change the rules or add keys. Every action needs a
zero-knowledge proof that it follows the vault's rules, so a tricked or leaked agent stays inside the limits.

```bash
npm install @obeliskmoney/agent-sdk
```

```ts
import { Obelisk } from "@obeliskmoney/agent-sdk";

const obelisk = new Obelisk({ agentKey: process.env.OBELISK_AGENT_KEY, vault: process.env.OBELISK_VAULT });

console.log((await obelisk.status()).reply);
const r = await obelisk.swap("2"); // USDG to ETH, the ETH stays in the vault
if (!r.ok) console.log(r.refused); // e.g. [{ code: "EXCEEDS_PER_DAY", reason: "..." }]
await obelisk.pay("0xApprovedPayee", "10");
```

| Method | What it does |
|---|---|
| `status()` | Balances, spent today, left today |
| `swap(amount)` | Stablecoin to ETH on the approved exchange, back into the vault |
| `pay(to, amount)` | Payment to a payee the owner approved |
| `submit(actions)` / `wait(id)` | Queue structured actions and poll, for non-blocking agents |
| `submitText(text)` | Free-text task for the Obelisk agent |

Each result has `ok`, `executed` (with transaction hashes) and `refused` (with the rule that refused it).
Full guide, HTTP API and a Python example: [docs/agents.md](https://github.com/ObeliskMoney/Obelisk/blob/main/docs/agents.md).

Beta on Robinhood Chain mainnet. The contracts have not had a third-party audit.
