-- ── today_matched_listings ────────────────────────────────────────────────────
-- Stores backend-matched records between cases and daily_cause_list.
-- Populated by POST /api/match-todays-listings; read-only from the frontend.

CREATE TABLE IF NOT EXISTS public.today_matched_listings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date            date        NOT NULL,
  organization_id       uuid,
  case_id               uuid        REFERENCES public.cases(id) ON DELETE CASCADE,
  daily_cause_list_id   uuid        REFERENCES public.daily_cause_list(id) ON DELETE CASCADE,
  case_number           text,
  cnr_number            text,
  court_hall            text,
  item_number           text,
  judge_name            text,
  stage                 text,
  petitioner            text,
  respondent            text,
  match_type            text        NOT NULL DEFAULT 'case_number',
  match_status          text        NOT NULL DEFAULT 'matched',
  notification_status   text        NOT NULL DEFAULT 'not_notified',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One match per case per cause list row per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_tml_unique_match
  ON public.today_matched_listings (match_date, case_id, daily_cause_list_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tml_match_date_org
  ON public.today_matched_listings (match_date DESC, organization_id);

CREATE INDEX IF NOT EXISTS idx_tml_case_id
  ON public.today_matched_listings (case_id);

CREATE INDEX IF NOT EXISTS idx_tml_court_hall
  ON public.today_matched_listings (court_hall, item_number);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.today_matched_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_today_matched_listings" ON public.today_matched_listings
  FOR ALL TO authenticated
  USING (
    organization_id = (
      SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_tml_updated_at
  BEFORE UPDATE ON public.today_matched_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
