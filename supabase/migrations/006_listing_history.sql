-- ── Convert today_matched_listings to permanent listing history ──────────────
-- Run this in the Supabase SQL Editor.

-- 1. Add new columns
ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS listed_date            date,
  ADD COLUMN IF NOT EXISTS cause_list_import_date date,
  ADD COLUMN IF NOT EXISTS match_created_at       timestamptz NOT NULL DEFAULT now();

-- 2. Back-fill listed_date from the existing match_date column
UPDATE public.today_matched_listings
   SET listed_date = match_date
 WHERE listed_date IS NULL;

-- 3. Make listed_date non-nullable with a default
ALTER TABLE public.today_matched_listings
  ALTER COLUMN listed_date SET NOT NULL,
  ALTER COLUMN listed_date SET DEFAULT CURRENT_DATE;

-- 4. Drop the old unique index (keyed on match_date)
DROP INDEX IF EXISTS idx_tml_unique_match;

-- 5. Create the new unique constraint (keyed on listed_date)
--    This allows the same case to re-appear on different dates while
--    preventing duplicate inserts for the exact same listing date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tml_unique_listing
  ON public.today_matched_listings (listed_date, case_id, daily_cause_list_id);

-- 6. Fast range queries for the history view
CREATE INDEX IF NOT EXISTS idx_tml_listed_date_org
  ON public.today_matched_listings (listed_date DESC, organization_id);

-- 7. Per-case history (for "Times Listed" computation)
CREATE INDEX IF NOT EXISTS idx_tml_case_listed
  ON public.today_matched_listings (case_id, listed_date DESC);
