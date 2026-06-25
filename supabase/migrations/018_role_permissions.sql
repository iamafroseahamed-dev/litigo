-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 018: Configurable Role Permissions
--
-- Backs the Administration → "Roles & Permissions" matrix. Each row is a single
-- (role × permission) toggle. A NULL organization_id row is a PLATFORM DEFAULT;
-- a non-NULL organization_id row is a per-organisation OVERRIDE that wins for
-- members of that organisation.
--
-- The application also ships a hard-coded default matrix (src/lib/permissions.ts)
-- so the product is fully functional before any rows exist here. This table only
-- stores deltas the administrator has customised.
--
-- ADDITIVE and idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS role_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('platform_admin','super_admin','admin','advocate','viewer')),
  permission      text NOT NULL,
  allowed         boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per (scope, role, permission). Two partial unique indexes because a
-- single index can't treat NULL organization_id as a distinct key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_perm_global
  ON role_permissions (role, permission)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_perm_org
  ON role_permissions (organization_id, role, permission)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_perm_org ON role_permissions(organization_id);

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_perm_select ON role_permissions;
DROP POLICY IF EXISTS role_perm_write  ON role_permissions;

-- SELECT — platform admin sees everything; everyone else sees the global
-- defaults plus their own organisation's overrides.
CREATE POLICY role_perm_select
  ON role_permissions
  FOR SELECT
  USING (
    is_platform_admin()
    OR organization_id IS NULL
    OR organization_id = get_my_organization_id()
  );

-- INSERT / UPDATE / DELETE — platform admin manages any scope (incl. global
-- defaults); super_admin manages only their own organisation's overrides.
CREATE POLICY role_perm_write
  ON role_permissions
  FOR ALL
  USING (
    is_platform_admin()
    OR (get_my_role() = 'super_admin' AND organization_id = get_my_organization_id())
  )
  WITH CHECK (
    is_platform_admin()
    OR (get_my_role() = 'super_admin' AND organization_id = get_my_organization_id())
  );

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION set_role_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_permissions_updated_at ON role_permissions;
CREATE TRIGGER trg_role_permissions_updated_at
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION set_role_permissions_updated_at();
