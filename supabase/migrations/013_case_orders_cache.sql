-- Cache eCourts order download metadata (PDF download URLs) for 24 hours.
CREATE TABLE IF NOT EXISTS public.case_orders_cache (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnr        text NOT NULL,
  filename   text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_orders_cache_cnr_filename_key UNIQUE (cnr, filename)
);

CREATE INDEX IF NOT EXISTS idx_case_orders_cache_cnr
  ON public.case_orders_cache (cnr);

CREATE INDEX IF NOT EXISTS idx_case_orders_cache_created_at
  ON public.case_orders_cache (created_at DESC);
