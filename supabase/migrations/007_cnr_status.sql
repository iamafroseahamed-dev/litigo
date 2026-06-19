-- ── Add CNR-discovery tracking columns to today_matched_listings ─────────────
-- Run this in the Supabase SQL Editor.

ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS ecourts_case_no   text,
  ADD COLUMN IF NOT EXISTS cnr_status        text NOT NULL DEFAULT 'not_discovered',
  ADD COLUMN IF NOT EXISTS ecourts_error     text;

-- ecourts_sync_status already exists from migration 004 with DEFAULT 'pending'
-- (IF NOT EXISTS makes this a no-op if it is already there)
ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS ecourts_sync_status text NOT NULL DEFAULT 'pending';

-- Back-fill cnr_status for rows that already have a cnr_number
UPDATE public.today_matched_listings
   SET cnr_status = 'discovered'
 WHERE cnr_number IS NOT NULL
   AND cnr_number != ''
   AND cnr_status = 'not_discovered';

-- Index for quick lookup of rows awaiting CNR discovery
CREATE INDEX IF NOT EXISTS idx_tml_cnr_status
  ON public.today_matched_listings (cnr_status, listed_date DESC);
