-- =============================================================================
-- 019_advocates_audit_invites.sql
-- Phase 5 — secure user provisioning support objects.
--
-- Adds (idempotently):
--   1. profiles.mobile column
--   2. advocates table (organization directory) + RLS
--   3. audit_logs table (admin action trail, written by Edge Function) + RLS
--
-- Re-uses the SECURITY DEFINER helpers created in migrations 012 / 017:
--   is_platform_admin(), get_my_organization_id()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles.mobile
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile text;

-- -----------------------------------------------------------------------------
-- 2. advocates directory
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.advocates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  advocate_name   text NOT NULL,
  email           text,
  mobile          text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate advocate (per organization) by email or by name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_advocates_org_email
  ON public.advocates (organization_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_advocates_org_name
  ON public.advocates (organization_id, lower(advocate_name));

CREATE INDEX IF NOT EXISTS idx_advocates_org
  ON public.advocates (organization_id);

ALTER TABLE public.advocates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advocates_select ON public.advocates;
DROP POLICY IF EXISTS advocates_insert ON public.advocates;
DROP POLICY IF EXISTS advocates_update ON public.advocates;
DROP POLICY IF EXISTS advocates_delete ON public.advocates;

CREATE POLICY advocates_select ON public.advocates
  FOR SELECT
  USING (is_platform_admin() OR organization_id = get_my_organization_id());

CREATE POLICY advocates_insert ON public.advocates
  FOR INSERT
  WITH CHECK (is_platform_admin() OR organization_id = get_my_organization_id());

CREATE POLICY advocates_update ON public.advocates
  FOR UPDATE
  USING (is_platform_admin() OR organization_id = get_my_organization_id())
  WITH CHECK (is_platform_admin() OR organization_id = get_my_organization_id());

CREATE POLICY advocates_delete ON public.advocates
  FOR DELETE
  USING (is_platform_admin() OR organization_id = get_my_organization_id());

-- -----------------------------------------------------------------------------
-- 3. audit_logs (admin action trail)
--    Rows are INSERTed by the Edge Function using the service-role key, which
--    bypasses RLS. No client INSERT/UPDATE/DELETE policy is granted on purpose.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_user_id   uuid,
  actor_email     text,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  target_email    text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org
  ON public.audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON public.audit_logs (created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;

-- Platform admins see everything; org admins see their own organization's trail.
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT
  USING (is_platform_admin() OR organization_id = get_my_organization_id());
