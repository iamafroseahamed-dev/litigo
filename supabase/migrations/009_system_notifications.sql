-- ── Automatic notification system ────────────────────────────────────────────

-- 1. Recipients who receive notifications for every new matched listing
CREATE TABLE IF NOT EXISTS public.system_notification_recipients (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  email            text,
  mobile_number    text,
  whatsapp_number  text,
  notify_email     boolean     NOT NULL DEFAULT true,
  notify_sms       boolean     NOT NULL DEFAULT false,
  notify_whatsapp  boolean     NOT NULL DEFAULT false,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_system_notification_recipients"
  ON public.system_notification_recipients
  FOR ALL TO authenticated USING (true);

-- 2. Delivery log for every send attempt
CREATE TABLE IF NOT EXISTS public.notification_delivery_logs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_listing_id  uuid        REFERENCES public.today_matched_listings(id) ON DELETE CASCADE,
  recipient_id        uuid        REFERENCES public.system_notification_recipients(id) ON DELETE SET NULL,
  recipient_name      text,
  channel             text        NOT NULL,  -- 'email' | 'sms' | 'whatsapp'
  recipient_address   text,
  subject             text,
  message             text,
  status              text        NOT NULL DEFAULT 'pending',  -- 'sent' | 'failed' | 'pending'
  provider            text,
  provider_response   jsonb,
  error_message       text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_notification_delivery_logs"
  ON public.notification_delivery_logs
  FOR ALL TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ndl_matched_listing_id
  ON public.notification_delivery_logs (matched_listing_id);

CREATE INDEX IF NOT EXISTS idx_ndl_created_at
  ON public.notification_delivery_logs (created_at DESC);

-- 3. New columns on today_matched_listings for notification tracking
ALTER TABLE public.today_matched_listings
  ADD COLUMN IF NOT EXISTS notification_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS notification_count    integer NOT NULL DEFAULT 0;

-- Back-fill: mark existing rows that have already been handled
UPDATE public.today_matched_listings
   SET notification_status = 'no_recipients'
 WHERE notification_status = 'not_notified';
