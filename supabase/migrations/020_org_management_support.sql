-- =============================================================================
-- 020_org_management_support.sql
-- Organization Management — let Platform Admins manage notification recipients
-- for ANY organization.
--
-- Migration 012 scoped system_notification_recipients RLS to super-admins and
-- same-org members. Platform admins (role = 'platform_admin') were introduced
-- later (migrations 017/019) and need cross-organization access here. This
-- re-creates the four policies to also allow is_platform_admin().
--
-- Re-uses is_platform_admin() from migration 017 and the helpers from 012.
-- Idempotent: drops policies first, then recreates them.
-- =============================================================================

ALTER TABLE public.system_notification_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recipients_select" ON public.system_notification_recipients;
DROP POLICY IF EXISTS "recipients_insert" ON public.system_notification_recipients;
DROP POLICY IF EXISTS "recipients_update" ON public.system_notification_recipients;
DROP POLICY IF EXISTS "recipients_delete" ON public.system_notification_recipients;

CREATE POLICY "recipients_select"
  ON public.system_notification_recipients
  FOR SELECT
  USING (
    is_platform_admin()
    OR is_super_admin()
    OR organization_id = get_my_organization_id()
  );

CREATE POLICY "recipients_insert"
  ON public.system_notification_recipients
  FOR INSERT
  WITH CHECK (
    is_platform_admin()
    OR is_super_admin()
    OR organization_id = get_my_organization_id()
  );

CREATE POLICY "recipients_update"
  ON public.system_notification_recipients
  FOR UPDATE
  USING (
    is_platform_admin()
    OR is_super_admin()
    OR organization_id = get_my_organization_id()
  )
  WITH CHECK (
    is_platform_admin()
    OR is_super_admin()
    OR organization_id = get_my_organization_id()
  );

CREATE POLICY "recipients_delete"
  ON public.system_notification_recipients
  FOR DELETE
  USING (
    is_platform_admin()
    OR is_super_admin()
    OR organization_id = get_my_organization_id()
  );
