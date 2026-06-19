-- ── Add eCourts case tracking fields to the cases table ─────────────────────
-- ecourts_case_no  : eCourts internal case number (e.g. "204900042322024")
--                   returned alongside the CNR from the case-number search.
--                   Used in the history POST payload (case_no field) so no
--                   captcha is ever needed again after first discovery.
-- cnr_discovered_at: timestamp when the CNR was first resolved via eCourts.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS ecourts_case_no    text,
  ADD COLUMN IF NOT EXISTS cnr_discovered_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_cases_ecourts_case_no
  ON public.cases (ecourts_case_no)
  WHERE ecourts_case_no IS NOT NULL;
