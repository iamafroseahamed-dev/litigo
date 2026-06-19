-- ── Add eCourts enrichment columns to today_matched_listings ─────────────────
-- Run this in Supabase SQL Editor after 003_today_matched_listings.sql.

ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS latest_case_status  text,
  ADD COLUMN IF NOT EXISTS latest_stage        text,
  ADD COLUMN IF NOT EXISTS latest_hearing_date date,
  ADD COLUMN IF NOT EXISTS latest_hearing_remarks text,
  ADD COLUMN IF NOT EXISTS latest_business     text,
  ADD COLUMN IF NOT EXISTS next_hearing_date   date,
  ADD COLUMN IF NOT EXISTS last_order_date     date,
  ADD COLUMN IF NOT EXISTS last_order_number   text,
  ADD COLUMN IF NOT EXISTS last_order_type     text,
  ADD COLUMN IF NOT EXISTS hearing_history     jsonb,
  ADD COLUMN IF NOT EXISTS ecourts_last_synced timestamptz,
  ADD COLUMN IF NOT EXISTS ecourts_sync_status text NOT NULL DEFAULT 'pending';

-- Index for quickly finding unsynced records
CREATE INDEX IF NOT EXISTS idx_tml_sync_status
  ON public.today_matched_listings (match_date, ecourts_sync_status)
  WHERE ecourts_sync_status IN ('pending', 'failed', 'no_cnr');
