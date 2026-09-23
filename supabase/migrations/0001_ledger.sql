-- Obelisk activity log: one row per intent proposed by the agent.
-- Run in Supabase Dashboard → SQL Editor.

create table if not exists public.executions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  chain_id       integer not null,
  vault          text not null,
  agent          text,
  task           text,                 -- the user's task for the agent
  action         text,                 -- swap | transfer | approve | unknown
  target         text,
  selector       text,
  calldata       text,
  amount         numeric,              -- in the token's smallest unit
  nonce          numeric,
  intent_hash    text,
  policy_hash    text,
  status         text not null check (status in ('pending','executed','rejected_policy','reverted')),
  reject_code    text,
  reject_reason  text,
  spent_before   numeric,
  spent_after    numeric,
  day            integer,
  prover         text,                 -- mock | cpu | network
  public_values  text,
  proof          text,
  tx_hash        text,
  block_number   bigint,
  attestation    jsonb
);

create index if not exists executions_created_at_idx on public.executions (created_at desc);
create index if not exists executions_vault_idx on public.executions (vault);
create unique index if not exists executions_tx_hash_idx on public.executions (tx_hash) where tx_hash is not null;

-- The public can only read. Writes only go through the secret key (executor), which bypasses RLS.
alter table public.executions enable row level security;
drop policy if exists "public read" on public.executions;
create policy "public read" on public.executions for select to anon, authenticated using (true);
