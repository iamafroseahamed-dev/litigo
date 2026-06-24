
create table if not exists public.case_connections (
  id                uuid primary key default gen_random_uuid(),
  parent_case_id    uuid not null references public.cases(id) on delete cascade,
  connected_case_id uuid not null references public.cases(id) on delete cascade,
  relationship_type text default 'Connected',  -- Connected | WMP | Appeal | Review | Contempt | Interim Application | Transfer | Related Matter
  created_at        timestamptz default now(),
  unique (parent_case_id, connected_case_id)
);

create index if not exists case_connections_parent_idx    on public.case_connections(parent_case_id);
create index if not exists case_connections_connected_idx on public.case_connections(connected_case_id);

-- Optional parent → child matter linkage (recommended future enhancement)
alter table public.cases
  add column if not exists parent_case_id uuid references public.cases(id) on delete set null;

-- RLS ─────────────────────────────────────────────────────────────────────────
alter table public.case_connections enable row level security;

drop policy if exists case_connections_all on public.case_connections;
create policy case_connections_all on public.case_connections
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.case_connections to anon, authenticated;
