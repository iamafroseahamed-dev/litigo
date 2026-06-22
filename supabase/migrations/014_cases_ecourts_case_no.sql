-- Add eCourts case number cache column for Madras HC captcha-discovery flow.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS ecourts_case_no text;

CREATE INDEX IF NOT EXISTS idx_cases_ecourts_case_no
  ON public.cases (ecourts_case_no);
