-- Obelisk multi-user: vaults per user, async tasks, and schedules (jobs).
-- Run in Supabase Dashboard → SQL Editor (after 0001_ledger.sql).

-- Vaults created by users through ObeliskVaultFactory, with their policy JSON
-- (only policyHash is onchain; the agent API checks the hash before storing).
create table if not exists public.vaults (
  address      text primary key,          -- lowercase
  chain_id     integer not null,
  owner        text not null,             -- lowercase
  policy       jsonb not null,
  policy_hash  text not null,
  labels       jsonb not null default '{}'::jsonb,  -- payee names: {"0xabc...": "Alex"}
  name         text,
  created_at   timestamptz not null default now()
);
create index if not exists vaults_owner_idx on public.vaults (owner);

-- Every task for the agent (from chat or from a schedule).
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  vault       text not null,
  source      text not null default 'chat' check (source in ('chat','job')),
  job_id      uuid,
  task        text not null,
  status      text not null check (status in ('queued','planning','proving','done','error')),
  reply       text,
  result      jsonb
);
create index if not exists tasks_vault_idx on public.tasks (vault, created_at desc);

-- Scheduled work: DCA, recurring payments, and so on.
create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  vault            text not null,
  task             text not null,
  interval_minutes integer not null check (interval_minutes >= 5),
  next_run_at      timestamptz not null,
  active           boolean not null default true,
  last_run_at      timestamptz,
  last_status      text
);
create index if not exists jobs_due_idx on public.jobs (active, next_run_at);

alter table public.executions add column if not exists task_id uuid;

-- Every table: public read-only, for full transparency. Writes only go through the secret key.
alter table public.vaults enable row level security;
alter table public.tasks  enable row level security;
alter table public.jobs   enable row level security;
drop policy if exists "public read" on public.vaults;
drop policy if exists "public read" on public.tasks;
drop policy if exists "public read" on public.jobs;
create policy "public read" on public.vaults for select to anon, authenticated using (true);
create policy "public read" on public.tasks  for select to anon, authenticated using (true);
create policy "public read" on public.jobs   for select to anon, authenticated using (true);
