"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authMessage, type AuthAction } from "@/lib/auth";
import { REASON } from "@/lib/reasons";
import { lastWallet, rememberWallet, useWallets, type WalletOption } from "@/lib/wallets";
import {
  buildPolicy,
  erc20Abi,
  wethAbi,
  factoryAbi,
  factoryAbiV4,
  limitsFor,
  minOutPerInToPriceCap,
  policyHash,
  priceCapToMinOutPerIn,
  quoterAbi,
  vaultAbi,
  vaultAbiV4,
  type AgentConfig,
  type Policy,
} from "@/lib/chain";
import { CHAIN, EXPLORER, IS_MAINNET, MOCK_ASSETS, NETWORK_LABEL, QUOTER, TEE_SIMULATED, TOKEN } from "@/lib/network";

const CHAIN_HEX = `0x${CHAIN.id.toString(16)}`;

// ------------------------------------------------------------------ helpers


async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/agent${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

const fmt = (v: bigint | undefined, d: number, max = 4) =>
  v === undefined ? "…" : Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: max });
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const errMsg = (e: unknown) => {
  const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
  return m.includes("User rejected") || m.includes("denied") ? "Cancelled in your wallet." : m;
};

interface Pending {
  policy: Policy;
  labels: Record<string, string>;
  name: string;
}
const pendingKey = (v: string) => `obelisk:pending:${v.toLowerCase()}`;
function loadPending(v: string): Pending | null {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(v)) ?? "null");
  } catch {
    return null;
  }
}
function savePending(v: string, p: Pending | null) {
  try {
    if (p) localStorage.setItem(pendingKey(v), JSON.stringify(p));
    else localStorage.removeItem(pendingKey(v));
  } catch {}
}

interface VaultRow {
  address: string;
  name: string | null;
  policy: Policy;
  labels: Record<string, string>;
}
interface TaskRow {
  id: string;
  created_at: string;
  task: string;
  source: string;
  status: "queued" | "planning" | "proving" | "done" | "error";
  reply: string | null;
  result: { steps?: { label: string; status: string; code?: string; reason?: string; txHash?: string }[] } | null;
}
interface JobRow {
  id: string;
  task: string;
  interval_minutes: number;
  next_run_at: string;
  last_status: string | null;
}

const PHASE: Record<TaskRow["status"], string> = {
  queued: "Queued",
  planning: "The agent is planning",
  proving: "Generating the proof (about 15 minutes per step)",
  done: "Done",
  error: "Failed",
};
const STEP_LABEL: Record<string, string> = {
  executed: "Executed",
  rejected_policy: "Blocked by rules",
  reverted: "Rejected by contract",
  invalid_action: "Invalid",
  error: "Error",
};
const STEP_BADGE: Record<string, string> = {
  executed: "b-executed",
  rejected_policy: "b-rejected_policy",
  reverted: "b-reverted",
};

// ------------------------------------------------------------------ app

export default function ObeliskApp() {
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [vaults, setVaults] = useState<Address[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  // Vaults from the current factory when it makes v4 vaults (onchain limits); the rest are earlier versions.
  const [v4Vaults, setV4Vaults] = useState<Address[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const wallets = useWallets();
  const [active, setActive] = useState<WalletOption | null>(null);
  const [picking, setPicking] = useState(false);

  const pub = useMemo<PublicClient | null>(
    () =>
      typeof window === "undefined"
        ? null
        : (createPublicClient({ chain: CHAIN, transport: http(`${window.location.origin}/api/rpc`) }) as PublicClient),
    [],
  );
  const wallet = useMemo<WalletClient | null>(
    () => (active && account ? createWalletClient({ chain: CHAIN, transport: custom(active.provider), account }) : null),
    [active, account],
  );

  useEffect(() => {
    api<AgentConfig>("GET", "/config").then(setCfg).catch((e) => setCfgErr(errMsg(e)));
  }, []);

  // Silently reconnect to the last chosen wallet (no popup).
  useEffect(() => {
    if (active) return;
    const w = wallets.find((x) => x.rdns === lastWallet());
    if (!w) return;
    w.provider
      .request({ method: "eth_accounts" })
      .then((a) => {
        const first = (a as Address[])[0];
        if (first) {
          setActive(w);
          setAccount(first);
        }
      })
      .catch(() => {});
  }, [wallets, active]);

  useEffect(() => {
    if (!active) return;
    const e = active.provider;
    const onAcc = (a: Address[]) => setAccount(a[0] ?? null);
    const onChain = (c: string) => setChainId(Number(c));
    e.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c))).catch(() => {});
    e.on?.("accountsChanged", onAcc);
    e.on?.("chainChanged", onChain);
    return () => {
      e.removeListener?.("accountsChanged", onAcc);
      e.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  const loadVaults = useCallback(async () => {
    if (!pub || !cfg || !account) return;
    // Vaults from earlier factories stay listed; the app offers to move them to the current rules program.
    const lists = await Promise.all(
      [cfg.factory, ...(cfg.legacyFactories ?? [])].map(
        (f) => pub.readContract({ address: f, abi: factoryAbi, functionName: "vaultsOf", args: [account] }) as Promise<Address[]>,
      ),
    );
    const list = [...lists.slice(1).flat(), ...lists[0]!];
    setV4Vaults(cfg.vaultVersion === 4 ? lists[0]! : []);
    setVaults([...list].reverse());
    setSelected((s) => (s && list.includes(s) ? s : (list[list.length - 1] ?? null)));
  }, [pub, cfg, account]);

  useEffect(() => {
    loadVaults().catch((e) => setNotice({ kind: "err", text: errMsg(e) }));
  }, [loadVaults]);

  async function connect(w: WalletOption) {
    const a = (await w.provider.request({ method: "eth_requestAccounts" })) as Address[];
    setActive(w);
    setAccount(a[0] ?? null);
    setPicking(false);
    rememberWallet(w.rdns);
    await ensureChain(w);
  }

  function disconnect() {
    setActive(null);
    setAccount(null);
    setChainId(null);
    setVaults([]);
    setSelected(null);
    rememberWallet(null);
  }

  async function ensureChain(w: WalletOption | null = active) {
    const e = w?.provider;
    if (!e) return;
    try {
      await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch {
      await e.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_HEX,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: CHAIN.rpcUrls.default.http,
            blockExplorerUrls: [EXPLORER],
          },
        ],
      });
    }
    setChainId(CHAIN.id);
  }

  /** Run an action with a "busy" state and a readable error message. */
  const run = useCallback(async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: "ok", text: msg });
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }, []);

  const sign = useCallback(
    async (vault: string, action: AuthAction, payload: string) => {
      if (!wallet || !account) throw new Error("Connect your wallet first");
      const ts = Math.floor(Date.now() / 1000);
      const signature = await wallet.signMessage({ account, message: authMessage({ vault, action, payload, ts }) });
      return { vault, ts, signature };
    },
    [wallet, account],
  );

  if (cfgErr) return <div className="card empty">The Obelisk agent cannot be reached right now: {cfgErr}</div>;
  if (!cfg) return <div className="card empty">Loading</div>;

  const wrongChain = account && chainId !== null && chainId !== cfg.chainId;

  return (
    <>
      <div className="app-head">
        <div>
          <h1>Your vault</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Give the agent tasks in plain words. Every action it takes needs a zero-knowledge proof that it stays inside
            the limits you set.
          </p>
        </div>
        {account ? (
          <span className="acct">
            {active?.icon && <img src={active.icon} alt="" width={18} height={18} />}
            <span className="net mono">{short(account)}</span>
            <button className="btn ghost small-btn" onClick={disconnect}>
              Change wallet
            </button>
          </span>
        ) : (
          <button className="btn primary" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            Connect wallet
          </button>
        )}
      </div>

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      {!account && picking && (
        <div className="card pad wallet-pick">
          <h2>Choose a wallet</h2>
          {wallets.length ? (
            <div className="wallet-list">
              {wallets.map((w) => (
                <button key={w.rdns} className="wallet-opt" disabled={!!busy} onClick={() => run("connect", () => connect(w))}>
                  {w.icon ? <img src={w.icon} alt="" width={28} height={28} /> : <span className="wallet-ph" aria-hidden />}
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              No wallet extension found in this browser. Install one, for example{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a>,{" "}
              <a href="https://www.okx.com/web3" target="_blank" rel="noreferrer">OKX Wallet</a> or{" "}
              <a href="https://rabby.io/" target="_blank" rel="noreferrer">Rabby</a>, then reload this page.
            </p>
          )}
          <p className="muted small">Any wallet that supports custom EVM networks works. It will be switched to {CHAIN.name}.</p>
        </div>
      )}

      {!account ? (
        <Onboarding />
      ) : wrongChain ? (
        <div className="card pad">
          <p>Your wallet is on a different network.</p>
          <button className="btn primary" onClick={() => run("chain", ensureChain)}>
            Switch to {CHAIN.name}
          </button>
        </div>
      ) : (
        <>
          <div className="vault-tabs">
            {vaults.map((v) => (
              <button key={v} className={`tab ${v === selected && !creating ? "on" : ""}`} onClick={() => (setSelected(v), setCreating(false))}>
                {short(v)}
              </button>
            ))}
            <button className={`tab ${creating || !vaults.length ? "on" : ""}`} onClick={() => setCreating(true)}>
              New vault
            </button>
          </div>

          {creating || !vaults.length ? (
            <CreateVault
              cfg={cfg}
              pub={pub}
              busy={busy}
              onCreate={(form) =>
                run("create", async () => {
                  if (!wallet || !pub || !account) return;
                  const policy = buildPolicy(cfg, form);
                  const h =
                    cfg.vaultVersion === 4
                      ? await wallet.writeContract({
                          chain: CHAIN,
                          account,
                          address: cfg.factory,
                          abi: factoryAbiV4,
                          functionName: "createVault",
                          args: [policyHash(policy), cfg.agent, limitsFor(policy)],
                        })
                      : await wallet.writeContract({
                          chain: CHAIN,
                          account,
                          address: cfg.factory,
                          abi: factoryAbi,
                          functionName: "createVault",
                          args: [policyHash(policy), cfg.agent],
                        });
                  await pub.waitForTransactionReceipt({ hash: h });
                  const list = (await pub.readContract({ address: cfg.factory, abi: factoryAbi, functionName: "vaultsOf", args: [account] })) as Address[];
                  const vault = list[list.length - 1]!;
                  savePending(vault, { policy, labels: form.labels, name: form.name });
                  await api("POST", "/vaults", { ...(await sign(vault, "vault:register", policyHash(policy))), policy, labels: form.labels, name: form.name });
                  savePending(vault, null);
                  setCreating(false);
                  await loadVaults();
                  setSelected(vault);
                  return `Vault created and registered with the agent. Deposit ${TOKEN}, then give it a task.`;
                })
              }
            />
          ) : selected && pub && wallet && account ? (
            <VaultView
              key={selected}
              vault={selected}
              cfg={cfg}
              pub={pub}
              wallet={wallet}
              account={account}
              busy={busy}
              run={run}
              sign={sign}
              isV4={v4Vaults.includes(selected)}
              newest={v4Vaults[v4Vaults.length - 1] ?? null}
              onVaultsChanged={loadVaults}
              onOpen={setSelected}
            />
          ) : null}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ onboarding

function Onboarding() {
  return (
    <div className="grid3">
      {[
        [
          "1. Connect a wallet",
          IS_MAINNET
            ? `MetaMask, OKX Wallet, Rabby or any EVM wallet on ${CHAIN.name}. You need ${TOKEN} to deposit and a little ETH for gas.`
            : `MetaMask, OKX Wallet, Rabby or any EVM wallet on ${CHAIN.name}. Get a little test ETH from the faucet for gas.`,
        ],
        ["2. Create a vault and set limits", "You decide the most per transaction, the most per day, and who it may pay."],
        ["3. Give it tasks", `"swap 50 ${TOKEN} to ETH", "pay Alex 20 ${TOKEN}", or a schedule like "swap 10 ${TOKEN} to ETH" every day.`],
      ].map(([t, d]) => (
        <div className="card pad" key={t}>
          <b>{t}</b>
          <p className="muted">{d}</p>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ create

function CreateVault({
  cfg,
  pub,
  busy,
  onCreate,
}: {
  cfg: AgentConfig;
  pub: PublicClient | null;
  busy: string | null;
  onCreate: (f: {
    name: string;
    maxPerTx: bigint;
    maxPerDay: bigint;
    recipients: Address[];
    minOutPerIn: bigint;
    labels: Record<string, string>;
  }) => void;
}) {
  const [name, setName] = useState("Main vault");
  const [perTx, setPerTx] = useState(IS_MAINNET ? "10" : "100");
  const [perDay, setPerDay] = useState(IS_MAINNET ? "20" : "300");
  const { maxPrice, setMaxPrice, spot } = usePriceLimit(pub, cfg);
  const [rows, setRows] = useState<{ label: string; address: string }[]>([]);

  const priceOk = Number(maxPrice) > 0;
  const valid =
    Number(perTx) > 0 &&
    Number(perDay) >= Number(perTx) &&
    priceOk &&
    rows.every((r) => isAddress(r.address, { strict: false }) && r.label.trim());

  return (
    <div className="card pad">
      <h2>Create a vault</h2>
      <p className="muted">
        These limits are locked into the contract as a hash. The agent cannot go past them, even if it is tricked by a
        prompt injection or its key leaks.
      </p>
      <div className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <label>
          Max per transaction ({TOKEN})
          <input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
        </label>
        <label>
          Max per day ({TOKEN})
          <input inputMode="decimal" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </label>
        <label>
          Highest ETH price the agent may pay ({TOKEN} per ETH)
          <input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </label>
      </div>
      <PriceHint spot={spot} />
      <div className="section-title">People the agent may pay (optional)</div>
      {rows.map((r, i) => (
        <div className="form row" key={i}>
          <input placeholder="Name, e.g. Alex" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input placeholder="0x…" className="mono" value={r.address} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)))} />
          <button className="btn ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => setRows([...rows, { label: "", address: "" }])}>
        Add a payee
      </button>
      <p className="muted small">
        Agent <span className="mono">{short(cfg.agent)}</span> (
        {cfg.attestation === "tdx" ? (TEE_SIMULATED ? "dstack simulator" : "TDX enclave") : "dev key"}). Swaps go only
        through {IS_MAINNET ? "Uniswap" : "the test exchange"}, into ETH (held as WETH), back to the vault.
      </p>
      <button
        className="btn primary"
        disabled={!valid || !!busy}
        onClick={() =>
          onCreate({
            name,
            maxPerTx: parseUnits(perTx, 6),
            maxPerDay: parseUnits(perDay, 6),
            recipients: rows.map((r) => r.address as Address),
            minOutPerIn: priceCapToMinOutPerIn(parseUnits(maxPrice, 6)),
            labels: Object.fromEntries(rows.map((r) => [r.address, r.label.trim()])),
          })
        }
      >
        {busy === "create" ? "Creating vault" : "Create vault (2 wallet prompts)"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ agent keys

interface AgentKeyRow {
  address: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
}

/**
 * Keys for the owner's own AI agent (docs/agents.md). The browser makes the key, the owner's wallet allows it,
 * and the private key is shown once. The key can only submit tasks; rules and proofs still decide what runs.
 */
function AgentKeys({
  vault,
  busy,
  run,
  sign,
}: {
  vault: Address;
  busy: string | null;
  run: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  sign: (vault: string, action: AuthAction, payload: string) => Promise<{ vault: string; ts: number; signature: `0x${string}` }>;
}) {
  const [keys, setKeys] = useState<AgentKeyRow[] | null>(null);
  const [label, setLabel] = useState("My agent");
  const [fresh, setFresh] = useState<{ privateKey: `0x${string}`; address: string } | null>(null);

  const load = useCallback(() => {
    api<AgentKeyRow[]>("GET", `/agent-keys?vault=${vault}`)
      .then(setKeys)
      .catch(() => setKeys([]));
  }, [vault]);
  useEffect(load, [load]);

  const active = (keys ?? []).filter((k) => !k.revoked_at);
  const env = fresh ? `OBELISK_AGENT_KEY=${fresh.privateKey}\nOBELISK_VAULT=${vault}` : "";
  const mcp = fresh
    ? JSON.stringify(
        { mcpServers: { obelisk: { command: "npx", args: ["-y", "@obeliskmoney/mcp"], env: { OBELISK_AGENT_KEY: fresh.privateKey, OBELISK_VAULT: vault } } } },
        null,
        2,
      )
    : "";

  return (
    <div className="card pad">
      <h2>Agent keys</h2>
      <p className="muted small">
        Let your own AI agent use this vault (Claude, ChatGPT, a script, any framework). A key can only ask for swaps,
        payments to your payees and the balance. It cannot withdraw, change the rules or add keys, and everything it
        asks for still needs a proof that it follows the rules above.{" "}
        <Link href="/guide#agents">How to connect an agent</Link>
      </p>

      {fresh ? (
        <div className="stack">
          <p className="small">
            <b>Copy this key now.</b> It is shown only once and is not stored by Obelisk. Give it to your agent as an
            environment variable:
          </p>
          <pre className="mono small code-block">{env}</pre>
          <p className="small">For Claude Desktop, Cursor or any MCP client:</p>
          <pre className="mono small code-block">{mcp}</pre>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(env)}>
            Copy environment variables
          </button>
          <button className="btn ghost" onClick={() => setFresh(null)}>
            I saved the key
          </button>
        </div>
      ) : (
        <div className="form row">
          <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} aria-label="Key name" placeholder="Key name" />
          <button
            className="btn primary"
            disabled={!!busy || !label.trim() || active.length >= 10}
            onClick={() =>
              run("agent-key", async () => {
                const privateKey = generatePrivateKey();
                const address = privateKeyToAccount(privateKey).address.toLowerCase();
                const name = label.trim();
                await api("POST", "/agent-keys", { ...(await sign(vault, "agent-key:add", `${address}|${name}`)), address, label: name });
                setFresh({ privateKey, address });
                load();
                return "Agent key created. Copy it now; it is shown only once.";
              })
            }
          >
            {busy === "agent-key" ? "Creating key" : "Create agent key (1 signature)"}
          </button>
        </div>
      )}

      {active.length > 0 && (
        <ul className="plain small">
          {active.map((k) => (
            <li key={k.address} className="row-between">
              <span>
                {k.label || "Agent key"} <span className="mono muted">{short(k.address)}</span>
              </span>
              <button
                className="btn ghost small"
                disabled={!!busy}
                onClick={() =>
                  run("agent-key", async () => {
                    await api("POST", "/agent-keys/revoke", { ...(await sign(vault, "agent-key:revoke", k.address)), address: k.address });
                    load();
                    return `Key "${k.label || short(k.address)}" revoked. It cannot submit tasks any more.`;
                  })
                }
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">The emergency brake above also stops every agent key, because all tasks run through the Obelisk agent.</p>
    </div>
  );
}

/**
 * The "highest ETH price the agent may pay" field. Suggests 1.5x the current Uniswap price: a swap can then lose
 * at most a third to a bad price, and ETH has to rise 50% before swaps are refused and the owner must raise it.
 */
function usePriceLimit(pub: PublicClient | null, cfg: AgentConfig) {
  const [maxPrice, setMaxPrice] = useState(MOCK_ASSETS ? "10000" : "");
  const [spot, setSpot] = useState<number | null>(null);
  useEffect(() => {
    if (!pub || !QUOTER || MOCK_ASSETS) return;
    const amountIn = 100_000_000n; // 100 tokens
    pub
      .simulateContract({
        address: QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: cfg.usdc, tokenOut: cfg.weth, amountIn, fee: cfg.swapFee ?? 500, sqrtPriceLimitX96: 0n }],
      })
      .then(({ result }) => {
        const price = 100 / Number(formatUnits(result[0], 18));
        setSpot(price);
        setMaxPrice((v) => v || String(Math.ceil((price * 1.5) / 100) * 100));
      })
      .catch(() => {});
  }, [pub, cfg]);
  return { maxPrice, setMaxPrice, spot };
}

function PriceHint({ spot }: { spot: number | null }) {
  return (
    <p className="muted small">
      {spot ? `ETH is about ${Math.round(spot).toLocaleString("en-US")} ${TOKEN} now. ` : ""}
      The agent cannot swap at a worse price than this, so a manipulated pool cannot drain the vault. If ETH rises
      above it, swaps are refused until you raise the limit.
    </p>
  );
}

// ------------------------------------------------------------------ vault

function VaultView({
  vault,
  cfg,
  pub,
  wallet,
  account,
  busy,
  run,
  sign,
  isV4,
  newest,
  onVaultsChanged,
  onOpen,
}: {
  vault: Address;
  cfg: AgentConfig;
  pub: PublicClient;
  wallet: WalletClient;
  account: Address;
  busy: string | null;
  run: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  sign: (vault: string, action: AuthAction, payload: string) => Promise<{ vault: string; ts: number; signature: `0x${string}` }>;
  isV4: boolean;
  newest: Address | null;
  onVaultsChanged: () => Promise<void>;
  onOpen: (vault: Address) => void;
}) {
  const [info, setInfo] = useState<VaultRow | null | undefined>(undefined);
  const [bal, setBal] = useState<{ vUsdc: bigint; vWeth: bigint; wUsdc: bigint; wWeth: bigint; wEth: bigint; spent: bigint; allowed: boolean } | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [jobText, setJobText] = useState(`swap 10 ${TOKEN} to ETH`);
  const [jobEvery, setJobEvery] = useState("1440");
  const [onchain, setOnchain] = useState<{ vkey: string; policyHash: string } | null>(null);
  const [limits, setLimits] = useState<{ maxPerTx: bigint; maxPerDay: bigint } | null>(null);
  const { maxPrice, setMaxPrice, spot } = usePriceLimit(pub, cfg);

  const refresh = useCallback(async () => {
    const day = BigInt(Math.floor(Date.now() / 86_400_000));
    const [vUsdc, vWeth, wUsdc, wWeth, wEth, spent, allowed] = await Promise.all([
      pub.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      pub.readContract({ address: cfg.weth, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      pub.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      pub.readContract({ address: cfg.weth, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      pub.getBalance({ address: account }),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "spentOnDay", args: [day] }),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "agentAllowed", args: [cfg.agent] }),
    ]);
    setBal({ vUsdc, vWeth, wUsdc, wWeth, wEth, spent, allowed });
    const [vkey, ph] = await Promise.all([
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "programVKey" }),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "policyHash" }),
    ]);
    setOnchain({ vkey, policyHash: ph });
    if (isV4) setLimits(await pub.readContract({ address: vault, abi: vaultAbiV4, functionName: "limits" }));
    const [t, j, vs] = await Promise.all([
      api<TaskRow[]>("GET", `/tasks?vault=${vault}`),
      api<JobRow[]>("GET", `/jobs?vault=${vault}`),
      api<VaultRow[]>("GET", `/vaults?owner=${account}`),
    ]);
    setTasks(t);
    setJobs(j);
    setInfo(vs.find((v) => v.address.toLowerCase() === vault.toLowerCase()) ?? null);
  }, [pub, cfg, vault, account, isV4]);

  useEffect(() => {
    refresh().catch(() => {});
    const id = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const tx = async (label: string, write: () => Promise<`0x${string}`>, ok: string) =>
    run(label, async () => {
      const h = await write();
      await pub.waitForTransactionReceipt({ hash: h });
      await refresh();
      return ok;
    });

  const common = { chain: CHAIN, account } as const;
  const pending = typeof window !== "undefined" ? loadPending(vault) : null;
  const policy = info?.policy;
  const limit = policy ? BigInt(policy.maxPerDay) : 0n;
  const pct = bal && limit ? Math.min(100, Number((bal.spent * 100n) / limit)) : 0;
  // Example amount for chips and placeholder: half the per-transaction limit, so it is not refused outright.
  const suggest = policy ? Math.max(1, Math.floor(Number(BigInt(policy.maxPerTx) / 2n) / 1e6)) : 5;

  // A vault from before policy v3 runs an older program. The prover only runs the current one, so the owner moves
  // the vault over: same limits and payees, plus a pool and a price limit, then the new rules go to the agent.
  const outdated = !!(onchain && cfg.programVKey && onchain.vkey.toLowerCase() !== cfg.programVKey.toLowerCase());
  const unsynced = !!(onchain && policy && policyHash(policy).toLowerCase() !== onchain.policyHash.toLowerCase());
  const upgrade = () =>
    run("upgrade", async () => {
      if (!policy) return;
      const next = buildPolicy(cfg, {
        maxPerTx: BigInt(policy.maxPerTx),
        maxPerDay: BigInt(policy.maxPerDay),
        recipients: policy.allowedRecipients,
        minOutPerIn: priceCapToMinOutPerIn(parseUnits(maxPrice, 6)),
      });
      const h = policyHash(next);
      savePending(vault, { policy: next, labels: info?.labels ?? {}, name: info?.name ?? "" });
      const hash = await wallet.writeContract({ ...common, address: vault, abi: vaultAbi, functionName: "setPolicy", args: [h, cfg.programVKey!] });
      await pub.waitForTransactionReceipt({ hash });
      await api("POST", "/vaults", { ...(await sign(vault, "vault:register", h)), policy: next, labels: info?.labels ?? {}, name: info?.name ?? "" });
      savePending(vault, null);
      await refresh();
      return "Rules updated. The agent can use this vault again.";
    });
  const finish = () =>
    run("upgrade", async () => {
      if (!pending) return;
      await api("POST", "/vaults", { ...(await sign(vault, "vault:register", policyHash(pending.policy))), ...pending });
      savePending(vault, null);
      await refresh();
      return "Rules sent to the agent.";
    });

  // v4 vaults check the limits onchain too. Contracts cannot be upgraded, so an earlier vault moves by creating a
  // new vault with the same rules and moving the funds over.
  const canMove = cfg.vaultVersion === 4 && !isV4 && !!info && !!policy;
  const floor = policy?.minOutPerIn?.[0];
  const createNew = () =>
    run("move", async () => {
      if (!policy) return;
      const next = buildPolicy(cfg, {
        maxPerTx: BigInt(policy.maxPerTx),
        maxPerDay: BigInt(policy.maxPerDay),
        recipients: policy.allowedRecipients,
        minOutPerIn: floor ? BigInt(floor) : priceCapToMinOutPerIn(parseUnits(maxPrice, 6)),
      });
      const h = await wallet.writeContract({
        ...common,
        address: cfg.factory,
        abi: factoryAbiV4,
        functionName: "createVault",
        args: [policyHash(next), cfg.agent, limitsFor(next)],
      });
      await pub.waitForTransactionReceipt({ hash: h });
      const list = await pub.readContract({ address: cfg.factory, abi: factoryAbiV4, functionName: "vaultsOf", args: [account] });
      const nv = list[list.length - 1]!;
      const meta = { policy: next, labels: info?.labels ?? {}, name: info?.name ?? "" };
      savePending(nv, meta);
      await api("POST", "/vaults", { ...(await sign(nv, "vault:register", policyHash(next))), ...meta });
      savePending(nv, null);
      await onVaultsChanged();
      return "New vault created with the same rules. Now move your funds into it.";
    });
  const moveFunds = (to: Address) =>
    run("move", async () => {
      const amt = bal!.vUsdc;
      let h = await wallet.writeContract({ ...common, address: vault, abi: vaultAbi, functionName: "withdraw", args: [cfg.usdc, account, amt] });
      await pub.waitForTransactionReceipt({ hash: h });
      h = await wallet.writeContract({ ...common, address: cfg.usdc, abi: erc20Abi, functionName: "transfer", args: [to, amt] });
      await pub.waitForTransactionReceipt({ hash: h });
      await refresh();
      return `${fmt(amt, 6, 2)} ${TOKEN} moved to the new vault.`;
    });
  const moveCard = canMove ? (
    <div className="card pad">
      <h2>Move to a vault with onchain limits</h2>
      <p className="muted">
        New vaults check your limits in the vault contract too: it measures how much {TOKEN} leaves on every action,
        and only lets the agent approve the exchange, pay your payees or swap back into the vault. This vault was made
        before that. Create a new vault with the same rules, then move your funds. Agent keys belong to one vault, so
        create them again on the new one.
      </p>
      {newest ? (
        <div className="stack">
          <p className="muted small">
            New vault <span className="mono">{short(newest)}</span>
          </p>
          {bal && bal.vUsdc > 0n ? (
            <button className="btn primary" disabled={!!busy} onClick={() => moveFunds(newest)}>
              {busy === "move" ? "Moving" : `Move ${fmt(bal.vUsdc, 6, 2)} ${TOKEN} to the new vault (2 wallet prompts)`}
            </button>
          ) : (
            <button className="btn primary" disabled={!!busy} onClick={() => onOpen(newest)}>
              Open the new vault
            </button>
          )}
          {bal && bal.vWeth > 0n && <p className="muted small">Withdraw the WETH in Funds below; it goes to your wallet.</p>}
        </div>
      ) : (
        <>
          {!floor && (
            <>
              <div className="form">
                <label>
                  Highest ETH price the agent may pay ({TOKEN} per ETH)
                  <input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                </label>
              </div>
              <PriceHint spot={spot} />
            </>
          )}
          <button className="btn primary" disabled={!!busy || (!floor && !(Number(maxPrice) > 0))} onClick={createNew}>
            {busy === "move" ? "Creating" : "Create the new vault (2 wallet prompts)"}
          </button>
        </>
      )}
    </div>
  ) : null;

  if (info && policy && outdated && canMove) {
    return moveCard;
  }

  if (info && policy && outdated) {
    return (
      <div className="card pad">
        <h2>Update this vault's rules</h2>
        <p className="muted">
          Obelisk now also pins the exchange pool and a price limit for every swap. This vault was made before that, so
          the agent cannot use it until you update its rules. Your limits and payees stay the same. Your funds are safe
          and you can withdraw at any time.
        </p>
        <div className="form">
          <label>
            Highest ETH price the agent may pay ({TOKEN} per ETH)
            <input inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          </label>
        </div>
        <PriceHint spot={spot} />
        <button className="btn primary" disabled={!!busy || !(Number(maxPrice) > 0)} onClick={upgrade}>
          {busy === "upgrade" ? "Updating rules" : "Update rules (2 wallet prompts)"}
        </button>
      </div>
    );
  }

  if (info && unsynced && !outdated) {
    return (
      <div className="card pad">
        <h2>Send the new rules to the agent</h2>
        <p className="muted">The vault's rules changed onchain, but the agent still has the old ones.</p>
        {pending && policyHash(pending.policy).toLowerCase() === onchain!.policyHash.toLowerCase() ? (
          <button className="btn primary" disabled={!!busy} onClick={finish}>
            {busy === "upgrade" ? "Sending" : "Send rules"}
          </button>
        ) : (
          <p className="muted">This browser does not have the new rules. Update them again from the browser you used.</p>
        )}
      </div>
    );
  }

  if (info === null) {
    return (
      <div className="card pad">
        <h2>This vault is not registered with the agent</h2>
        <p className="muted">The vault exists onchain, but its rules have not been sent to the agent yet.</p>
        {pending ? (
          <button
            className="btn primary"
            disabled={!!busy}
            onClick={() =>
              run("register", async () => {
                await api("POST", "/vaults", { ...(await sign(vault, "vault:register", policyHash(pending.policy))), ...pending });
                savePending(vault, null);
                await refresh();
                return "Vault registered.";
              })
            }
          >
            Register now
          </button>
        ) : (
          <p className="muted">This browser does not have this vault's rules. Create a new vault instead.</p>
        )}
      </div>
    );
  }

  return (
    <>
      {moveCard}
      <div className="stats">
        <div className="stat">
          <b>{fmt(bal?.vUsdc, 6, 2)}</b>
          <span>{TOKEN} in vault</span>
        </div>
        <div className="stat">
          <b>{fmt(bal?.vWeth, 18, 5)}</b>
          <span>WETH in vault (1 WETH = 1 ETH)</span>
        </div>
        <div className="stat">
          <b>
            {fmt(bal?.spent, 6, 2)} / {fmt(limit, 6, 0)}
          </b>
          <span>Spent today ({TOKEN})</span>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="stat">
          <b className={bal?.allowed ? "ok-text" : "bad-text"}>{bal ? (bal.allowed ? "Active" : "Stopped") : "Loading"}</b>
          <span>Agent for this vault</span>
        </div>
      </div>

      <div className="grid2">
        <div className="card pad">
          <h2>Ask the agent</h2>
          <form
            className="chat-in"
            onSubmit={(e) => {
              e.preventDefault();
              const task = text.trim();
              if (!task) return;
              void run("task", async () => {
                await api("POST", "/tasks", { ...(await sign(vault, "task", task)), task });
                setText("");
                await refresh();
              });
            }}
          >
            <input
              placeholder={`e.g. "swap ${suggest} ${TOKEN} to ETH" or "what is my balance?"`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
            />
            <button className="btn primary" disabled={!!busy || !bal?.allowed}>
              {busy === "task" ? "Signing" : "Send"}
            </button>
          </form>
          <div className="chips">
            {["what is my balance?", `swap ${suggest} ${TOKEN} to ETH`, ...Object.values(info?.labels ?? {}).slice(0, 2).map((l) => `pay ${l} ${suggest} ${TOKEN}`)].map((c) => (
              <button key={c} className="chip" onClick={() => setText(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="tasks">
            {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
            {tasks.map((t) => (
              <div className="task-item" key={t.id}>
                <div className="task-q">
                  {t.source === "job" && <span className="tag">scheduled</span>}
                  {t.source === "agent" && <span className="tag">agent key</span>} {t.task}
                </div>
                <div className={`task-phase ${t.status}`}>{PHASE[t.status]}</div>
                {t.reply && <div className="task-reply">{t.reply}</div>}
                {t.result?.steps?.map((s, i) => (
                  <div className="step" key={i}>
                    <span className={`badge ${STEP_BADGE[s.status] ?? "b-pending"}`}>{STEP_LABEL[s.status] ?? s.status.replace("_", " ")}</span> {s.label}
                    {(s.code || s.reason) && (
                      <div className="reason">{s.code ? (REASON[s.code] ?? "The rules check refused this step.") : s.reason}</div>
                    )}
                    {s.txHash && (
                      <a className="mono small" href={`${EXPLORER}/tx/${s.txHash}`} target="_blank" rel="noreferrer">
                        {short(s.txHash)}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card pad">
            <h2>Funds</h2>
            <p className="muted small">
              Your wallet: {fmt(bal?.wUsdc, 6, 2)} {TOKEN}, {fmt(bal?.wWeth, 18, 5)} WETH, {fmt(bal?.wEth, 18, 5)} ETH
            </p>
            <div className="form row">
              <input inputMode="decimal" placeholder={`Amount in ${TOKEN}`} aria-label={`Amount in ${TOKEN}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button
                className="btn"
                disabled={!!busy || !(Number(amount) > 0)}
                onClick={() =>
                  tx("deposit", () => wallet.writeContract({ ...common, address: cfg.usdc, abi: erc20Abi, functionName: "transfer", args: [vault, parseUnits(amount || "0", 6)] }), `${amount} ${TOKEN} deposited to the vault.`)
                }
              >
                Deposit
              </button>
              <button
                className="btn"
                disabled={!!busy || !(Number(amount) > 0)}
                onClick={() =>
                  tx("withdraw", () => wallet.writeContract({ ...common, address: vault, abi: vaultAbi, functionName: "withdraw", args: [cfg.usdc, account, parseUnits(amount || "0", 6)] }), `${amount} ${TOKEN} withdrawn to your wallet.`)
                }
              >
                Withdraw
              </button>
            </div>
            {MOCK_ASSETS && (
              <button
                className="btn ghost"
                disabled={!!busy}
                onClick={() => tx("mint", () => wallet.writeContract({ ...common, address: cfg.usdc, abi: erc20Abi, functionName: "mint", args: [account, parseUnits("1000", 6)] }), "1,000 test USDC added to your wallet.")}
              >
                Get 1,000 test USDC
              </button>
            )}
            {bal && bal.vWeth > 0n && (
              <button
                className="btn ghost"
                disabled={!!busy}
                onClick={() => tx("withdraw-weth", () => wallet.writeContract({ ...common, address: vault, abi: vaultAbi, functionName: "withdraw", args: [cfg.weth, account, bal.vWeth] }), "WETH withdrawn to your wallet. Unwrap it below to get ETH.")}
              >
                Withdraw all WETH
              </button>
            )}
            {!MOCK_ASSETS && bal && bal.wWeth > 0n && (
              <button
                className="btn ghost"
                disabled={!!busy}
                onClick={() => tx("unwrap", () => wallet.writeContract({ ...common, address: cfg.weth, abi: wethAbi, functionName: "withdraw", args: [bal.wWeth] }), "WETH unwrapped to ETH in your wallet.")}
              >
                Unwrap {fmt(bal.wWeth, 18, 5)} WETH to ETH
              </button>
            )}
            <p className="muted small">
              Swaps land in the vault as WETH, the ERC-20 form of ETH. Withdraw it, then unwrap it here to get ETH in
              your wallet.
            </p>
          </div>

          <div className="card pad">
            <h2>Scheduled tasks</h2>
            <p className="muted small">The agent runs these on its own. Every run still needs its own proof.</p>
            <div className="form">
              <input value={jobText} onChange={(e) => setJobText(e.target.value)} maxLength={300} />
              <select value={jobEvery} onChange={(e) => setJobEvery(e.target.value)}>
                <option value="60">every hour</option>
                <option value="1440">every day</option>
                <option value="10080">every week</option>
              </select>
              <button
                className="btn"
                disabled={!!busy || !jobText.trim()}
                onClick={() =>
                  run("job", async () => {
                    const minutes = Number(jobEvery);
                    await api("POST", "/jobs", { ...(await sign(vault, "job:create", `${minutes}|${jobText.trim()}`)), task: jobText.trim(), intervalMinutes: minutes });
                    await refresh();
                    return "Schedule created. The first run starts in about a minute.";
                  })
                }
              >
                Schedule
              </button>
            </div>
            {jobs.map((j) => (
              <div className="job" key={j.id}>
                <div>
                  <b>{j.task}</b>
                  <div className="muted small">
                    every {j.interval_minutes >= 1440 ? `${j.interval_minutes / 1440} day(s)` : `${j.interval_minutes / 60} hour(s)`}, next{" "}
                    {new Date(j.next_run_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                    {j.last_status ? `, last: ${j.last_status}` : ""}
                  </div>
                </div>
                <button
                  className="btn ghost"
                  disabled={!!busy}
                  onClick={() =>
                    run("unjob", async () => {
                      await api("DELETE", `/jobs/${j.id}`, await sign(vault, "job:delete", j.id));
                      await refresh();
                      return "Schedule stopped.";
                    })
                  }
                >
                  Stop
                </button>
              </div>
            ))}
          </div>

          <div className="card pad">
            <h2>Safety</h2>
            {policy && (
              <ul className="plain small">
                <li>
                  At most {fmt(BigInt(policy.maxPerTx), 6, 2)} {TOKEN} per transaction and {fmt(BigInt(policy.maxPerDay), 6, 2)} {TOKEN} per day
                </li>
                <li>
                  Payees:{" "}
                  {policy.allowedRecipients.length
                    ? policy.allowedRecipients.map((r) => info?.labels?.[r] ?? short(r)).join(", ")
                    : `none, so the agent cannot send ${TOKEN} to anyone`}
                </li>
                <li>Swaps only into ETH through one approved exchange, with price protection, and the ETH returns to the vault as WETH</li>
                {policy.minOutPerIn?.[0] && (
                  <li>
                    Never pays more than {fmt(minOutPerInToPriceCap(BigInt(policy.minOutPerIn[0])), 6, 0)} {TOKEN} per ETH
                  </li>
                )}
                {limits && (
                  <li>
                    Also checked by the vault contract: at most {fmt(limits.maxPerTx, 6, 2)} {TOKEN} can leave per action and{" "}
                    {fmt(limits.maxPerDay, 6, 2)} {TOKEN} per day, only to your payees or through the exchange
                  </li>
                )}
              </ul>
            )}
            <button
              className={`btn ${bal?.allowed ? "danger" : ""}`}
              disabled={!!busy || !bal}
              onClick={() =>
                tx(
                  "agent",
                  () => wallet.writeContract({ ...common, address: vault, abi: vaultAbi, functionName: "setAgent", args: [cfg.agent, !bal!.allowed] }),
                  bal!.allowed ? "Agent stopped. Nothing can be executed on this vault now." : "Agent allowed again.",
                )
              }
            >
              {bal?.allowed ? "Stop the agent (emergency brake)" : "Allow the agent again"}
            </button>
            <p className="muted small">
              Vault{" "}
              <a className="mono" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">
                {short(vault)}
              </a>{" "}
              on {NETWORK_LABEL}. <Link href={`/activity?vault=${vault}`}>History and proofs</Link>
            </p>
          </div>

          <AgentKeys vault={vault} busy={busy} run={run} sign={sign} />
        </div>
      </div>
    </>
  );
}
