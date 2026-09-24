# Obelisk user guide

Obelisk gives you an **AI agent that manages funds for you but can never break the limits you set**. Even if the agent is tricked (prompt injection), makes a mistake or its key leaks, the contract rejects every transaction that breaks those limits. That does not depend on trusting the agent: it is enforced with a zero-knowledge proof.

> Obelisk runs on **Robinhood Chain mainnet** with USDG, a dollar stablecoin. It is beta software without a third-party audit. Deposit only what you can afford to lose.

App: **https://obelisk.cash/app**

---

## 1. Setup (once)

1. **Install a wallet** such as [MetaMask](https://metamask.io), [OKX Wallet](https://www.okx.com/web3) or [Rabby](https://rabby.io).
2. **Open the app** and click **Connect wallet**, then pick your wallet. The app offers to add Robinhood Chain; approve it.
3. **Get ETH for gas and USDG** on Robinhood Chain. About $2 of ETH covers many transactions. Check that the USDG address is `0x5fc5360d0400a0fd4f2af552add042d716f1d168`, since other tokens use similar names.

## 2. Create a vault

A vault is your own safe onchain. Only you can withdraw from it. The agent can only act inside the limits you choose.

Under **New vault**, fill in:

| Field | Meaning | Example |
|---|---|---|
| Max per transaction | The largest amount for a single agent action | 10 USDG |
| Max per day | The total the agent may spend in one day (UTC) | 20 USDG |
| People the agent may pay | Named addresses the agent may send USDG to | Alex, 0x12...ab |

Click **Create vault**. Your wallet asks twice:
1. A transaction that creates the vault onchain (a small gas fee).
2. A free signature that registers those limits with the agent.

> If you add no payees, the agent **cannot send USDG out of the vault at all**. It can only swap USDG into ETH, and the ETH always returns to the vault.

## 3. Add funds

Enter an amount under **Funds** and click **Deposit** to move USDG from your wallet into the vault.

Click **Withdraw** at any time to move USDG, or the ETH from swaps, back to your wallet. Withdrawals do not go through the agent and are not subject to any limit.

## 4. Give tasks

Type a task in plain words and click **Send**. You sign every task in your wallet (free), so only the vault owner can instruct the agent.

| Example task | What happens |
|---|---|
| `what is my balance?` | The agent reports the balance and what is left of today's limit |
| `swap 5 USDG to ETH` | The agent swaps 5 USDG to ETH on Uniswap, and the ETH goes into the vault |
| `pay Alex 10 USDG` | The agent sends 10 USDG to Alex, if Alex is on your payee list |
| `swap 500 USDG to ETH` (above the limit) | **Refused** within seconds. No proof can be made and no funds move |

The status of each task shows on screen:
- **The agent is planning**: the LLM is turning your words into actions.
- **Generating the proof**: the agent is proving that the action follows your limits. This takes about 15 minutes per step.
- **Done**: a link to the transaction on the explorer, or the reason it was refused.

## 5. Scheduled tasks

Under **Scheduled tasks**, write a task and choose how often it runs:

- `swap 5 USDG to ETH` **every day**: buy ETH a little at a time.
- `pay Alex 10 USDG` **every week**: a recurring payment.

The agent runs these on its own without asking for another signature. **Every run still needs a valid proof**, so a mistyped schedule (for example "swap 5000 USDG") is always refused. Click **Stop** to cancel a schedule.

## 6. If something looks wrong: the emergency brake

Click **Stop the agent (emergency brake)** under Safety. Once that transaction lands, the vault contract **rejects every agent action**, including schedules and transactions that were already signed. You can still withdraw your funds. Click **Allow the agent again** to turn it back on.

## 7. Checking the proofs

Every agent action, including refusals, is listed on the **activity page** (https://obelisk.cash/activity). Each entry shows:

- which agent signed it,
- the intent (target, function, amount),
- the zero-knowledge proof and its public values (spending before and after),
- a link to the transaction on the Robinhood Chain explorer.

## FAQ

**Can the agent drain my vault?**
No. In the worst case (the agent is tricked, hijacked or its key leaks) the most it can spend is your daily limit, and only as swaps into ETH that return to the vault or as payments to people you approved yourself.

**Who can withdraw?**
Only the vault owner's wallet.

**Why does a proof take a while?**
The Groth16 proof is generated on a CPU server. It is what makes your rules mathematically enforced. Scheduled tasks are not affected because they run in the background.

**Are my tasks public?**
Yes. The activity page shows every task and action for transparency. Do not put personal information in tasks.

**How do I change my limits?**
Create a new vault with different limits and move your funds with Withdraw and Deposit.
