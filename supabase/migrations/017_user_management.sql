-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 017: Enterprise User Management
--
-- Turns the `profiles` table into the single source of truth for users,
-- their roles, and their notification preferences. Replaces the standalone
-- "notification recipients" concept (the old table is left intact for safety
-- but is no longer used by the application).
--
-- This migration is ADDITIVE and idempotent — it never drops data tables.
--
-- Role hierarchy (highest → lowest privilege):
--   platform_admin  — product owner; manages every organisation
--   super_admin     — one per organisation; manages that org's users/advocates
--   admin           — manages cases / advocates / tasks within the org
--   advocate        — works only assigned cases
--   viewer          — read-only
-- (the legacy value 'user' is treated as 'viewer' by the application)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Extend the role check constraint ──────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('platform_admin', 'super_admin', 'admin', 'advocate', 'viewer', 'user'));
EXCEPTION
  WHEN others THEN
    NULL; -- role column may be an enum; handle separately if so
END;
$$;

-- ── 2. Per-user notification preferences + activity columns ───────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at           timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_notifications     boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_hearing_reminder boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_task_assignment  boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_daily_cause_list boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_case_assignment  boolean NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at              timestamptz DEFAULT now();

-- ── 3. Prevent duplicate email addresses (case-insensitive) ───────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email_lower
  ON profiles (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role            ON profiles(role);

-- ── 4. RLS helper functions (SECURITY DEFINER → bypass RLS, no recursion) ─────
-- get_my_organization_id() and is_super_admin() already exist (migration 012).

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'platform_admin'
  );
$$;

-- True for the org-scoped administrators allowed to manage users.
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'admin')
  );
$$;

-- ── 5. Row-level security on profiles (server-side org isolation) ─────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
DROP POLICY IF EXISTS profiles_delete ON profiles;

-- SELECT — platform admin sees everyone; org admins see their org; everyone
-- can always read their own profile (needed for login bootstrap).
CREATE POLICY profiles_select
  ON profiles
  FOR SELECT
  USING (
    is_platform_admin()
    OR organization_id = get_my_organization_id()
    OR user_id = auth.uid()
  );

-- INSERT — platform admin anywhere; super_admin / admin only within their org.
CREATE POLICY profiles_insert
  ON profiles
  FOR INSERT
  WITH CHECK (
    is_platform_admin()
    OR (is_org_admin() AND organization_id = get_my_organization_id())
  );

-- UPDATE — platform admin anywhere; org admins within their org; users may
-- update their own profile (e.g. notification preferences).
CREATE POLICY profiles_update
  ON profiles
  FOR UPDATE
  USING (
    is_platform_admin()
    OR (is_org_admin() AND organization_id = get_my_organization_id())
    OR user_id = auth.uid()
  )
  WITH CHECK (
    is_platform_admin()
    OR (is_org_admin() AND organization_id = get_my_organization_id())
    OR user_id = auth.uid()
  );

-- DELETE — platform admin anywhere; super_admin within their own org only.
CREATE POLICY profiles_delete
  ON profiles
  FOR DELETE
  USING (
    is_platform_admin()
    OR (get_my_role() = 'super_admin' AND organization_id = get_my_organization_id())
  );

-- ── 6. Record last-login timestamp (called by the app after sign-in) ──────────
CREATE OR REPLACE FUNCTION touch_last_login()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET last_login_at = now(), updated_at = now()
  WHERE user_id = auth.uid();
$$;

-- ── 7. Keep updated_at fresh on every profile change ──────────────────────────
CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_profiles_updated_at();
