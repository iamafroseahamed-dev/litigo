-- ============================================================================
-- 021_cases_rls_org_scoping.sql
--
-- PURPOSE
--   Authoritatively (re)define Row Level Security for the case-data tables so
--   that data visibility is scoped strictly by organisation. This eliminates
--   any LEGACY single-tenant policy (e.g. one that filtered by created_by /
--   auth.uid()) that could cause a brand-new Super Admin — who has not personally
--   created any cases — to see ZERO rows even though their organisation owns
--   plenty of cases.
--
-- SCOPING RULES (must match the frontend exactly):
--   * platform_admin .................. sees ALL organisations' rows.
--   * super_admin / admin / advocate / viewer
--                       .............. sees ONLY rows where
--                                       organization_id = their own org.
--   * Legacy rows with a NULL organization_id remain visible to everyone so
--     pre-multi-tenant data is never silently lost. (Admins can bulk-assign
--     them from the Cases page.)
--
-- This migration is IDEMPOTENT: it drops every existing policy on each target
-- table and recreates a clean, consistent set. Run it in the Supabase SQL
-- editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER so they bypass RLS while reading the
--    caller's own profile by auth.uid()). Re-created idempotently.
-- ----------------------------------------------------------------------------

create or replace function public.get_my_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where user_id = auth.uid()
  limit 1
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role = 'platform_admin'
  )
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role = 'super_admin'
  )
$$;

-- ----------------------------------------------------------------------------
-- 2. Diagnostic helper. Call `select public.debug_whoami();` while logged in as
--    the affected user to confirm what the RLS layer actually sees. A
--    `profiles_for_uid` value other than 1 means duplicate / missing profile
--    rows, which would make get_my_organization_id() return the wrong org.
-- ----------------------------------------------------------------------------

create or replace function public.debug_whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'auth_uid',          auth.uid(),
    'role',              public.get_my_role(),
    'organization_id',   public.get_my_organization_id(),
    'is_platform_admin', public.is_platform_admin(),
    'is_super_admin',    public.is_super_admin(),
    'profiles_for_uid',  (select count(*) from public.profiles where user_id = auth.uid())
  )
$$;

-- ----------------------------------------------------------------------------
-- 3. Re-apply RLS on every case-data table.
--    A temporary helper drops all existing policies on the table and recreates
--    the standard org-scoped set. Tables with their own organization_id column
--    are scoped directly; child tables are scoped via their parent case.
-- ----------------------------------------------------------------------------

create or replace function public._apply_org_rls(p_table text)
returns void
language plpgsql
as $$
declare
  pol        record;
  has_org    boolean;
  case_col   text;
  expr       text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = p_table
  ) then
    raise notice 'skip %, table does not exist', p_table;
    return;
  end if;

  has_org := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'organization_id'
  );

  -- Determine which column references the parent case (for child tables).
  select column_name into case_col
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table
    and column_name in ('case_id', 'parent_case_id')
  order by case when column_name = 'case_id' then 0 else 1 end
  limit 1;

  if has_org then
    expr := 'public.is_platform_admin() '
         || 'or organization_id = public.get_my_organization_id() '
         || 'or organization_id is null';
  elsif case_col is not null then
    expr := format(
      'public.is_platform_admin() or exists (select 1 from public.cases c '
      || 'where c.id = %I.%I and (c.organization_id = public.get_my_organization_id() '
      || 'or c.organization_id is null))',
      p_table, case_col
    );
  else
    raise notice 'skip %, no organization_id or case reference column', p_table;
    return;
  end if;

  execute format('alter table public.%I enable row level security', p_table);

  -- Drop every existing policy so legacy single-tenant rules cannot linger.
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_table
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, p_table);
  end loop;

  execute format('create policy %I on public.%I for select using (%s)',
                 p_table || '_select_org', p_table, expr);
  execute format('create policy %I on public.%I for insert with check (%s)',
                 p_table || '_insert_org', p_table, expr);
  execute format('create policy %I on public.%I for update using (%s) with check (%s)',
                 p_table || '_update_org', p_table, expr, expr);
  execute format('create policy %I on public.%I for delete using (%s)',
                 p_table || '_delete_org', p_table, expr);

  raise notice 'applied org RLS on %', p_table;
end;
$$;

select public._apply_org_rls('cases');
select public._apply_org_rls('today_matched_listings');
select public._apply_org_rls('case_notes');
select public._apply_org_rls('case_tasks');
select public._apply_org_rls('case_connections');
select public._apply_org_rls('case_status_history');

drop function public._apply_org_rls(text);

-- ----------------------------------------------------------------------------
-- 4. Sanity check — list the resulting policies.
-- ----------------------------------------------------------------------------
-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('cases','today_matched_listings','case_notes',
--                     'case_tasks','case_connections','case_status_history')
-- order by tablename, cmd;
