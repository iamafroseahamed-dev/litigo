-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 012: Make system_notification_recipients organisation-aware
--
-- Changes:
--   1. Add organization_id to system_notification_recipients
--   2. Add organization_id to today_matched_listings (for org-scoped dispatch)
--   3. Backfill today_matched_listings.organization_id from cases
--   4. Two SECURITY DEFINER helpers used by all RLS policies
--   5. Drop + recreate RLS policies on system_notification_recipients so that:
--        • Normal users (admin / advocate / user) see ONLY their org's recipients
--        • Super-admin users see ALL recipients across every organisation
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. system_notification_recipients: add organization_id ───────────────────

ALTER TABLE system_notification_recipients
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_snr_organization_id
  ON system_notification_recipients(organization_id);

-- ── 2. today_matched_listings: add organization_id (for org-scoped dispatch) ─

ALTER TABLE today_matched_listings
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tml_organization_id
  ON today_matched_listings(organization_id);

-- ── 3. Backfill today_matched_listings from their linked case ─────────────────

UPDATE today_matched_listings tml
SET organization_id = c.organization_id
FROM cases c
WHERE tml.case_id = c.id
  AND tml.organization_id IS NULL;

-- ── 4. RLS helper functions ───────────────────────────────────────────────────

-- Returns the organization_id of the currently authenticated user.
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

-- Returns true if the currently authenticated user has the 'super_admin' role.
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

-- ── 5. RLS policies on system_notification_recipients ────────────────────────

ALTER TABLE system_notification_recipients ENABLE ROW LEVEL SECURITY;

-- Drop any previous blanket policies so we start clean.
DROP POLICY IF EXISTS "allow_all_notification_recipients" ON system_notification_recipients;
DROP POLICY IF EXISTS "authenticated_full_access"         ON system_notification_recipients;
DROP POLICY IF EXISTS "recipients_select"                 ON system_notification_recipients;
DROP POLICY IF EXISTS "recipients_insert"                 ON system_notification_recipients;
DROP POLICY IF EXISTS "recipients_update"                 ON system_notification_recipients;
DROP POLICY IF EXISTS "recipients_delete"                 ON system_notification_recipients;

-- SELECT ─────────────────────────────────────────────────────────────────────
-- Super-admins see every row; all other authenticated users see only their org.
CREATE POLICY "recipients_select"
  ON system_notification_recipients
  FOR SELECT
  USING (
    is_super_admin()
    OR organization_id = get_my_organization_id()
  );

-- INSERT ─────────────────────────────────────────────────────────────────────
-- Users may only insert recipients scoped to their own organisation.
-- Super-admins may insert for any organisation.
CREATE POLICY "recipients_insert"
  ON system_notification_recipients
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR organization_id = get_my_organization_id()
  );

-- UPDATE ─────────────────────────────────────────────────────────────────────
CREATE POLICY "recipients_update"
  ON system_notification_recipients
  FOR UPDATE
  USING (
    is_super_admin()
    OR organization_id = get_my_organization_id()
  )
  WITH CHECK (
    is_super_admin()
    OR organization_id = get_my_organization_id()
  );

-- DELETE ─────────────────────────────────────────────────────────────────────
CREATE POLICY "recipients_delete"
  ON system_notification_recipients
  FOR DELETE
  USING (
    is_super_admin()
    OR organization_id = get_my_organization_id()
  );

-- ── 6. Extend profiles.role to recognise 'super_admin' ───────────────────────
-- Only add the value if the column uses an enum-like check constraint; if your
-- role column is a plain text/varchar this block is harmless (constraint won't
-- exist and the ALTER is skipped).

DO $$
BEGIN
  -- Attempt to add 'super_admin' to the role check constraint if one exists.
  -- Silently continue if it's already present or no constraint exists.
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  ALTER TABLE profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'advocate', 'user', 'super_admin'));
EXCEPTION
  WHEN others THEN
    NULL; -- Column may be an enum type; handle separately if needed.
END;
$$;
