-- Madras High Court case classification + sync tracking on the cases table.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_category text,
  ADD COLUMN IF NOT EXISTS case_details_last_synced timestamptz;

CREATE INDEX IF NOT EXISTS idx_cases_case_details_last_synced
  ON public.cases (case_details_last_synced DESC);

CREATE INDEX IF NOT EXISTS idx_cases_case_category
  ON public.cases (case_category);
