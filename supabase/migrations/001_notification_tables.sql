-- ── Notification Recipients per Case ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_notification_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid,
  case_id           uuid REFERENCES public.cases(id) ON DELETE CASCADE,
  recipient_name    text NOT NULL,
  recipient_role    text,
  email             text,
  mobile_number     text,
  whatsapp_number   text,
  notify_email      boolean NOT NULL DEFAULT true,
  notify_sms        boolean NOT NULL DEFAULT false,
  notify_whatsapp   boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Notification Send Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid,
  case_id            uuid REFERENCES public.cases(id),
  cause_list_id      uuid,
  cause_date         date,
  notification_type  text,
  recipient_name     text,
  recipient_role     text,
  recipient_email    text,
  recipient_mobile   text,
  recipient_whatsapp text,
  subject            text,
  message            text,
  status             text,   -- 'sent' | 'failed' | 'pending'
  provider           text,
  provider_response  jsonb,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Provider Config (org-level, encrypted in prod) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  provider_type   text NOT NULL,  -- 'email' | 'sms' | 'whatsapp'
  provider_name   text NOT NULL,  -- 'resend' | 'msg91' | 'wati'
  config          jsonb,          -- api_key, sender_id, etc.
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.case_notification_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_providers      ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write their own organisation's rows
CREATE POLICY "org_recipients" ON public.case_notification_recipients
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "org_logs" ON public.notification_logs
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "org_providers" ON public.notification_providers
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()
  ));
