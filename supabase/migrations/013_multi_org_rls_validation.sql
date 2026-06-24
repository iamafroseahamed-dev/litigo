-- Migration 013: Multi-organization RLS hardening + validation helpers
--
-- Goals:
--   1. Add org-aware RLS policies to additional tables used by the app.
--   2. Keep super_admin cross-org access.
--   3. Preserve legacy rows with organization_id IS NULL for backward compatibility.
--   4. Provide a simple SQL validator to inspect RLS posture.

-- -----------------------------------------------------------------------------
-- Shared helper functions (re-declared idempotently)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_my_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- today_matched_listings
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'today_matched_listings'
  ) THEN
    EXECUTE 'ALTER TABLE public.today_matched_listings ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS tml_select_org ON public.today_matched_listings';
    EXECUTE 'DROP POLICY IF EXISTS tml_update_org ON public.today_matched_listings';

    EXECUTE '
      CREATE POLICY tml_select_org
      ON public.today_matched_listings
      FOR SELECT
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';

    EXECUTE '
      CREATE POLICY tml_update_org
      ON public.today_matched_listings
      FOR UPDATE
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
      WITH CHECK (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- ecourts_api_usage
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ecourts_api_usage'
  ) THEN
    EXECUTE 'ALTER TABLE public.ecourts_api_usage ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS ecourts_usage_select_org ON public.ecourts_api_usage';

    EXECUTE '
      CREATE POLICY ecourts_usage_select_org
      ON public.ecourts_api_usage
      FOR SELECT
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- advocates (optional; only if organization_id exists)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'advocates'
      AND column_name = 'organization_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.advocates ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS advocates_select_org ON public.advocates';
    EXECUTE 'DROP POLICY IF EXISTS advocates_insert_org ON public.advocates';
    EXECUTE 'DROP POLICY IF EXISTS advocates_update_org ON public.advocates';
    EXECUTE 'DROP POLICY IF EXISTS advocates_delete_org ON public.advocates';

    EXECUTE '
      CREATE POLICY advocates_select_org
      ON public.advocates
      FOR SELECT
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';

    EXECUTE '
      CREATE POLICY advocates_insert_org
      ON public.advocates
      FOR INSERT
      WITH CHECK (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';

    EXECUTE '
      CREATE POLICY advocates_update_org
      ON public.advocates
      FOR UPDATE
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
      WITH CHECK (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';

    EXECUTE '
      CREATE POLICY advocates_delete_org
      ON public.advocates
      FOR DELETE
      USING (
        is_super_admin()
        OR organization_id = get_my_organization_id()
        OR organization_id IS NULL
      )
    ';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- RLS validation function
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_multi_org_rls()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count integer
)
LANGUAGE sql
STABLE
AS $$
  WITH target_tables AS (
    SELECT unnest(ARRAY[
      'system_notification_recipients',
      'today_matched_listings',
      'ecourts_api_usage',
      'advocates'
    ]) AS t
  ),
  rels AS (
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (SELECT t FROM target_tables)
  ),
  pols AS (
    SELECT tablename AS table_name, COUNT(*)::int AS policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (SELECT t FROM target_tables)
    GROUP BY tablename
  )
  SELECT
    tt.t AS table_name,
    COALESCE(r.rls_enabled, false) AS rls_enabled,
    COALESCE(p.policy_count, 0) AS policy_count
  FROM target_tables tt
  LEFT JOIN rels r ON r.table_name = tt.t
  LEFT JOIN pols p ON p.table_name = tt.t
  ORDER BY tt.t;
$$;
