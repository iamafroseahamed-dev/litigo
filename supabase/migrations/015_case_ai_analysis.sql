-- Migration 015: Cached Sarvam AI analysis for case details
--
-- Stores one cached AI analysis per case. Access is controlled via the linked
-- case's organization so users only see analyses for cases they are allowed to
-- access.

CREATE TABLE IF NOT EXISTS public.case_ai_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  cnr_number text NULL,
  ai_summary text NULL,
  ai_json jsonb NULL,
  generated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  generated_by text NULL,
  CONSTRAINT uq_case_ai_analysis_case_id UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_case_ai_analysis_case_id
  ON public.case_ai_analysis(case_id);

CREATE INDEX IF NOT EXISTS idx_case_ai_analysis_generated_at
  ON public.case_ai_analysis(generated_at DESC);

ALTER TABLE public.case_ai_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_ai_analysis_select_org ON public.case_ai_analysis;
DROP POLICY IF EXISTS case_ai_analysis_insert_org ON public.case_ai_analysis;
DROP POLICY IF EXISTS case_ai_analysis_update_org ON public.case_ai_analysis;
DROP POLICY IF EXISTS case_ai_analysis_delete_org ON public.case_ai_analysis;

CREATE POLICY case_ai_analysis_select_org
  ON public.case_ai_analysis
  FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_ai_analysis.case_id
        AND (c.organization_id = get_my_organization_id() OR c.organization_id IS NULL)
    )
  );

CREATE POLICY case_ai_analysis_insert_org
  ON public.case_ai_analysis
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_ai_analysis.case_id
        AND (c.organization_id = get_my_organization_id() OR c.organization_id IS NULL)
    )
  );

CREATE POLICY case_ai_analysis_update_org
  ON public.case_ai_analysis
  FOR UPDATE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_ai_analysis.case_id
        AND (c.organization_id = get_my_organization_id() OR c.organization_id IS NULL)
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_ai_analysis.case_id
        AND (c.organization_id = get_my_organization_id() OR c.organization_id IS NULL)
    )
  );

CREATE POLICY case_ai_analysis_delete_org
  ON public.case_ai_analysis
  FOR DELETE
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.id = case_ai_analysis.case_id
        AND (c.organization_id = get_my_organization_id() OR c.organization_id IS NULL)
    )
  );
