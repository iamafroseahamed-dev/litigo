-- Migration 014: Bulk upload history + org-aware audit trail
--
-- Stores bulk-import history, summaries, and error reports per organization.

CREATE TABLE IF NOT EXISTS public.bulk_upload_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  uploaded_by text NULL,
  uploaded_by_email text NULL,
  file_name text NOT NULL,
  import_mode text NOT NULL CHECK (import_mode IN ('update_existing', 'skip_existing', 'update', 'skip')),
  status text NOT NULL CHECK (status IN ('validated', 'imported', 'completed', 'completed_with_errors', 'failed')),
  total_records integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  issue_count integer NOT NULL DEFAULT 0,
  preview_counts jsonb NULL,
  summary jsonb NULL,
  summary_json jsonb NULL,
  error_report_json jsonb NULL,
  error_text text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_bulk_upload_history_org_id
  ON public.bulk_upload_history(organization_id);

CREATE INDEX IF NOT EXISTS idx_bulk_upload_history_created_at
  ON public.bulk_upload_history(created_at DESC);

ALTER TABLE public.bulk_upload_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_upload_history_select_org ON public.bulk_upload_history;
DROP POLICY IF EXISTS bulk_upload_history_insert_org ON public.bulk_upload_history;

CREATE POLICY bulk_upload_history_select_org
  ON public.bulk_upload_history
  FOR SELECT
  USING (
    is_super_admin()
    OR organization_id = get_my_organization_id()
    OR organization_id IS NULL
  );

CREATE POLICY bulk_upload_history_insert_org
  ON public.bulk_upload_history
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR organization_id = get_my_organization_id()
    OR organization_id IS NULL
  );
