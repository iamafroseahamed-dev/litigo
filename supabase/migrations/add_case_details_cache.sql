-- eCourts Case Details cache (Layer 3 - Supabase)
-- Stores the most recent eCourts partner-search response per case so that
-- the frontend can avoid calling the eCourts API more than once every 24h.

ALTER TABLE cases
ADD COLUMN IF NOT EXISTS case_details_json jsonb;

ALTER TABLE cases
ADD COLUMN IF NOT EXISTS case_details_synced_at timestamptz;

ALTER TABLE cases
ADD COLUMN IF NOT EXISTS ecourts_request_id text;
promp