-- Agent keys: keys a vault owner hands to an external AI agent (docs/agents.md).
-- A key can only submit tasks for its vault; it cannot withdraw, change the rules or manage other keys.
-- Run in Supabase Dashboard -> SQL Editor (after 0002_multi_user.sql).

create table if not exists public.agent_keys (
  id          uuid primary key default gen_random_uuid(),
  vault       text not null,                  -- lowercase vault address
  address     text not null,                  -- lowercase address of the agent key
  label       text not null default '',
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index if not exists agent_keys_vault_address on public.agent_keys (vault, address);

alter table public.agent_keys enable row level security;
drop policy if exists "public read" on public.agent_keys;
create policy "public read" on public.agent_keys for select to anon, authenticated using (true);

-- Tasks submitted with an agent key are marked so the owner can tell them apart.
alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check check (source in ('chat', 'job', 'agent'));
alter table public.tasks add column if not exists agent_key text;
