-- ── Add hearing_history JSONB column to today_matched_listings ───────────────
-- This stores the parsed hearing history as an array so the UI can display
-- it without calling eCourts on every page load.

ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS hearing_history jsonb;

-- Also add ecourts_sync_status which is referenced by the frontend badge
ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS ecourts_sync_status text NOT NULL DEFAULT 'pending';
