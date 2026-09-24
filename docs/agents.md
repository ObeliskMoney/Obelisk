# Use Obelisk from your own AI agent

Obelisk gives your AI agent a vault it can spend from without being able to lose it. You keep the vault's rules
(limits per transaction and per day, the payees it may pay, the exchange and the price limit for swaps). Your agent
gets an **agent key** that can only ask for actions. Every action still needs a zero-knowledge proof that it follows
the rules before the vault contract lets it through, so a tricked, buggy or leaked agent stays inside your limits.

## What an agent key can and cannot do

| An agent key can | An agent key cannot |
|---|---|
| Swap the vault's stablecoin (USDG) to ETH, which stays in the vault as WETH | Withdraw anything from the vault |
| Pay an address you approved as a payee | Pay anyone else (the proof fails) |
| Read the balance and what is left today | Change the rules, the price limit or the payees |
| Submit free-text tasks for the Obelisk agent | Create or revoke keys, schedule tasks |

The worst case for a stolen key is the same as for a prompt-injected agent: at most your daily limit in swaps into
ETH (as WETH) that stays in the vault, or payments to payees you approved. Revoke a key in the app at any time; it stops
working at once. The emergency brake in the app stops every key.

## 1. Create a key

In [the app](https://obelisk.cash/app), open your vault, go to **Agent keys**, name the key and click
**Create agent key**. Your browser makes the key, your wallet signs once to allow it, and the private key is shown
once. Obelisk stores only its address. Give it to your agent as environment variables:

```bash
OBELISK_AGENT_KEY=0x...   # the agent key's private key
OBELISK_VAULT=0x...       # your vault
```

## 2a. TypeScript / JavaScript: the SDK

```bash
npm install @obeliskmoney/agent-sdk
```

```ts
import { Obelisk } from "@obeliskmoney/agent-sdk";

const obelisk = new Obelisk({ agentKey: process.env.OBELISK_AGENT_KEY, vault: process.env.OBELISK_VAULT });

const status = await obelisk.status();
console.log(status.reply); // "Vault balance: 3 USDG and 0.00074 ETH. Spent today: 0 of 5 USDG (5 left)."

const swap = await obelisk.swap("2"); // about 3 minutes: two proofs, then the swap onchain
if (swap.ok) console.log("done", swap.executed);
else console.log("refused by the vault rules", swap.refused); // e.g. [{ code: "EXCEEDS_PER_DAY", ... }]

await obelisk.pay("0xPayeeYouApproved", "10");
```

`submit()` returns a task id right away and `wait(id)` polls until it finishes, if your agent should not block.

## 2b. Claude Desktop, Cursor and other MCP clients

Add this to the client's MCP configuration (Claude Desktop: Settings, Developer, Edit Config):

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

Tools: `obelisk_status`, `obelisk_swap_to_eth`, `obelisk_pay`, `obelisk_task`. Ask the model, for example, "swap 2
USDG to ETH in my Obelisk vault".

## 2c. Any language: the HTTP API

Base URL: `https://www.obelisk.cash/api/agent`.

**Submit a task.** `POST /tasks` with JSON:

```json
{
  "vault": "0xYourVault",
  "actions": "[{\"type\":\"swap\",\"amount\":\"2\"}]",
  "ts": 1790250000,
  "signature": "0x..."
}
```

- `actions` is a JSON **string** (the exact text you sign). Up to 5 actions: `{"type":"status"}`,
  `{"type":"swap","amount":"2"}`, `{"type":"pay","to":"0x...","amount":"10"}`. Amounts are decimal strings in the
  stablecoin, up to 6 decimals. Instead of `actions` you may send `task` with free text, for example
  `"swap 2 USDG to ETH"`, which the Obelisk agent interprets.
- `ts` is the current Unix time in seconds; a signature is valid for 5 minutes and only once.
- `signature` is an EIP-191 `personal_sign` by the agent key over exactly this text (lines joined with `\n`, vault
  in lowercase, `content` is the `actions` string or the `task` text):

```
Obelisk agent command
vault: 0xyourvaultinlowercase
action: task
content: [{"type":"swap","amount":"2"}]
time: 1790250000
```

The response is `{ "id": "<task id>", "status": "queued", ... }`.

**Read a task.** `GET /tasks/<id>` returns its `status` (`queued`, `planning`, `proving`, `done` or
`error`) and, when done, `result.steps`: each step has `status` (`executed`, `rejected_policy`, `reverted`, ...),
`code` (for example `EXCEEDS_PER_DAY`, `RECIPIENT_NOT_ALLOWED`, `MIN_OUT_BELOW_FLOOR`) and `txHash` when it ran.

Python example:

```python
import json, time, requests
from eth_account import Account
from eth_account.messages import encode_defunct

API = "https://www.obelisk.cash/api/agent"
key, vault = "0x...", "0x..."
actions = json.dumps([{"type": "swap", "amount": "2"}], separators=(",", ":"))
ts = int(time.time())
msg = f"Obelisk agent command\nvault: {vault.lower()}\naction: task\ncontent: {actions}\ntime: {ts}"
sig = Account.sign_message(encode_defunct(text=msg), key).signature.hex()
task = requests.post(f"{API}/tasks", json={"vault": vault, "actions": actions, "ts": ts,
                                           "signature": sig if sig.startswith("0x") else "0x" + sig}).json()
while (t := requests.get(f"{API}/tasks/{task['id']}").json())["status"] not in ("done", "error"):
    time.sleep(4)
print(t["result"]["steps"])
```

## Limits and timing

- At most 3 tasks in progress per vault, and 10 commands per minute from one IP address.
- A step that breaks the rules is refused within seconds and nothing is sent.
- A step that follows them needs a Groth16 proof: about a minute on the GPU prover, up to about 15 minutes when
  the server proves on its CPU. A first swap takes two steps (an allowance for the exchange, then the swap).
- The vault must have been created in the app and moved to the current rules (policy v3).
