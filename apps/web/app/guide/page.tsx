import type { Metadata } from "next";
import Link from "next/link";
import { CHAIN, IS_MAINNET, MOCK_ASSETS, TOKEN } from "@/lib/network";
import deployment from "@/lib/deployment.json";

export const metadata: Metadata = {
  title: "How to use it",
  description: "Set up a vault, give the agent tasks and stay in control, step by step.",
};

export default function Guide() {
  return (
    <main className="wrap page prose">
      <h1>How to use Obelisk</h1>
      <p className="lede">About five minutes to set up. After that you give the agent tasks in plain words.</p>

      <h2>1. Get a wallet ready</h2>
      <p>
        Use any browser wallet that supports custom networks, such as MetaMask, OKX Wallet or Rabby. The app adds{" "}
        {CHAIN.name} for you when you connect.
      </p>
      {IS_MAINNET ? (
        <p>
          You need two things on {CHAIN.name}: a little ETH for gas (about $2 is plenty) and some {TOKEN}, the dollar
          stablecoin your vault uses. Check that the token address is{" "}
          <span className="mono">{deployment.usdc}</span>, since other tokens use similar names.
        </p>
      ) : (
        <p>You need a little test ETH for gas. Test {TOKEN} can be minted in the app for free.</p>
      )}

      <h2>2. Create a vault</h2>
      <ul className="plain-list">
        <li>
          <b>Max per transaction:</b> the largest amount the agent may spend in one go.
        </li>
        <li>
          <b>Max per day:</b> the total it may spend in one day. It resets at 00:00 UTC.
        </li>
        <li>
          <b>People the agent may pay:</b> optional. Leave it empty if you only want swaps.
        </li>
      </ul>
      <p>
        Your wallet asks twice: once to create the vault (a small gas fee) and once to sign a message that registers it
        with the agent (free). Start with small limits while you try it out.
      </p>

      <h2>3. Add funds</h2>
      <p>
        Enter an amount under Funds and press Deposit.{" "}
        {MOCK_ASSETS ? `On testnet, press "Get 1,000 test USDC" first.` : "You can withdraw at any time, with or without the agent."}
      </p>

      <h2>4. Give it tasks</h2>
      <ul className="plain-list">
        <li>
          <span className="mono">swap 5 {TOKEN} to ETH</span> swaps through the approved exchange. The ETH returns to
          your vault.
        </li>
        <li>
          <span className="mono">pay Alex 10 {TOKEN}</span> works if Alex is on your list of people it may pay.
        </li>
        <li>
          <span className="mono">what is my balance?</span> answers right away.
        </li>
      </ul>
      <p>
        A task that breaks your rules is refused within seconds and nothing is sent. A task that follows them waits for
        its proof, usually a minute or two per step (up to about 15 minutes when the GPU prover is offline). Your first swap takes two steps (an allowance for the exchange, then the swap), and so does any swap after that allowance is used up.
        You can close the page while it runs.
      </p>

      <h2>5. Stay in control</h2>
      <ul className="plain-list">
        <li>
          <b>Scheduled tasks</b> run on their own, for example a daily swap. Each run needs its own proof.
        </li>
        <li>
          <b>Stop the agent</b> with one click under Safety. Nothing can run on that vault until you allow it again.
        </li>
        <li>
          <b>Withdraw</b> your {TOKEN} or the swapped ETH back to your wallet whenever you want.
        </li>
      </ul>

      <h2 id="agents">6. Use it from your own AI agent</h2>
      <p>
        Already have an agent (Claude, ChatGPT, a script or any framework)? Give it an <b>agent key</b> instead of your
        wallet. In the app, open your vault, go to <b>Agent keys</b> and create one. The key can ask for swaps into ETH,
        payments to your payees and the balance. It cannot withdraw, change the rules or add keys, and every action it
        asks for still needs a proof that it follows your rules. Revoke it any time.
      </p>
      <ul className="plain-list">
        <li>
          <b>Claude Desktop, Cursor and other MCP clients:</b> add the <span className="mono">@obeliskmoney/mcp</span>{" "}
          server with the key. The app shows the configuration when you create the key.
        </li>
        <li>
          <b>TypeScript:</b> <span className="mono">npm install @obeliskmoney/agent-sdk</span>, then{" "}
          <span className="mono">obelisk.swap(&quot;2&quot;)</span>.
        </li>
        <li>
          <b>Any language:</b> a signed HTTP request per task.{" "}
          <a href="https://github.com/ObeliskMoney/Obelisk/blob/main/docs/agents.md" target="_blank" rel="noreferrer">
            Developer guide
          </a>
          .
        </li>
      </ul>

      <p>
        <Link href="/app">Open the app</Link> or read <Link href="/security">how Obelisk is secured</Link>.
      </p>
    </main>
  );
}
