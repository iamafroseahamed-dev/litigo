import { supabase } from '@/lib/supabase';
import type { Organization, EcourtsApiPricing, EcourtsApiUsage } from '@/types';

// eCourts endpoint identifiers — keep in sync with ecourts_api_pricing seed.
export const ECOURTS_ENDPOINTS = {
  CASE_DETAIL: 'CASE_DETAIL',
  CASE_SEARCH: 'CASE_SEARCH',
  ORDER_PDF: 'ORDER_PDF',
  ORDER_PDF_AI: 'ORDER_PDF_AI',
  CAUSE_LIST: 'CAUSE_LIST',
  ORDER_PDF_MD: 'ORDER_PDF_MD',
  CASE_REFRESH: 'CASE_REFRESH',
} as const;
export type EcourtsEndpoint = keyof typeof ECOURTS_ENDPOINTS;

export const PLAN_NAMES = ['Trial', 'Standard', 'Enterprise'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export interface EndpointUsage {
  endpoint: string;
  calls: number;
  rate: number;          // amount_per_call — the subscriber rate applied (₹)
  amountCharged: number; // calls × rate (₹)
}

export interface OrgUsageSummary {
  amountCharged: number;    // total ₹ charged across all usage
  apiCalls: number;
  casesSynced: number;
  amountThisMonth: number;  // ₹ charged in the current calendar month
  byEndpoint: EndpointUsage[];
  lastSync: string | null;
}

// ── Organizations ───────────────────────────────────────────────────────────────
export async function fetchOrganizations(): Promise<Organization[]> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('organization_name', { ascending: true });
    if (error) return [];
    return (data ?? []) as Organization[];
  } catch {
    return [];
  }
}

export async function fetchActiveOrganizations(): Promise<Organization[]> {
  return (await fetchOrganizations()).filter(o => o.active !== false);
}

export async function createOrganization(input: Partial<Organization>): Promise<void> {
  const payload = {
    organization_name: input.organization_name,
    short_name: input.short_name ?? null,
    contact_person: input.contact_person ?? null,
    contact_email: input.contact_email ?? null,
    contact_mobile: input.contact_mobile ?? null,
    plan_name: input.plan_name ?? 'Trial',
    trial_credits: input.trial_credits ?? 100,
    available_credits: input.available_credits ?? input.trial_credits ?? 100,
    active: input.active ?? true,
  };
  const { error } = await supabase.from('organizations').insert(payload);
  if (error) throw new Error(error.message);
}

export async function updateOrganization(id: string, patch: Partial<Organization>): Promise<void> {
  const { error } = await supabase.from('organizations').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// Add (or remove, with a negative amount) credits to an organization.
export async function addCredits(id: string, amount: number): Promise<void> {
  const { data, error } = await supabase
    .from('organizations').select('available_credits').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const current = Number(data?.available_credits ?? 0);
  await updateOrganization(id, { available_credits: current + amount });
}

export async function setPlan(id: string, plan: string, topUpTo?: number): Promise<void> {
  const patch: Partial<Organization> = { plan_name: plan };
  if (typeof topUpTo === 'number') patch.available_credits = topUpTo;
  await updateOrganization(id, patch);
}

export async function setOrganizationActive(id: string, active: boolean): Promise<void> {
  await updateOrganization(id, { active });
}

// ── Pricing ───────────────────────────────────────────────────────────────────
export async function fetchPricing(): Promise<EcourtsApiPricing[]> {
  try {
    const { data, error } = await supabase.from('ecourts_api_pricing').select('*');
    if (error) return [];
    return (data ?? []) as EcourtsApiPricing[];
  } catch {
    return [];
  }
}

// ── Credit gate ─────────────────────────────────────────────────────────────────
export const NO_CREDITS_MESSAGE = 'No credits available. Please upgrade your subscription.';

/**
 * Returns the organization's remaining credits, or null when the org is unknown
 * (no organization_id on the case yet → can't gate, allow the call).
 */
export async function getOrgCredits(orgId: string | null | undefined): Promise<number | null> {
  if (!orgId) return null;
  try {
    const { data, error } = await supabase
      .from('organizations').select('available_credits, active').eq('id', orgId).maybeSingle();
    if (error || !data) return null;
    if (data.active === false) return 0;
    return Number(data.available_credits ?? 0);
  } catch {
    return null;
  }
}

// true when the org has credits (or is unknown → not gated).
export async function hasCredits(orgId: string | null | undefined): Promise<boolean> {
  const c = await getOrgCredits(orgId);
  return c === null || c > 0;
}

// ── Usage recording + credit deduction ──────────────────────────────────────────
// Records one paid API call and deducts the endpoint's credits atomically via the
// record_ecourts_usage RPC. Best-effort: never throws (audit must not break sync).
export async function recordApiUsage(args: {
  organizationId: string | null | undefined;
  caseId?: string | null;
  endpoint: EcourtsEndpoint;
  requestId?: string | null;
  cnr?: string | null;
}): Promise<void> {
  try {
    await supabase.rpc('record_ecourts_usage', {
      p_org: args.organizationId ?? null,
      p_case: args.caseId ?? null,
      p_endpoint: ECOURTS_ENDPOINTS[args.endpoint],
      p_request_id: args.requestId ?? null,
      p_cnr: args.cnr ?? null,
    });
  } catch {
    /* audit/deduction is best-effort */
  }
}

// ── Automatic organization detection from eCourts party names ────────────────────
// Matches any party / advocate string against an organization's name or short
// name (case-insensitive substring, both directions). Returns the org id or null.
export function detectOrganization(parties: Array<string | null | undefined>, orgs: Organization[]): string | null {
  const names = parties.map(p => (p ?? '').toLowerCase()).filter(Boolean);
  if (names.length === 0) return null;
  for (const org of orgs) {
    if (org.active === false) continue;
    const needles = [org.organization_name, org.short_name]
      .map(n => (n ?? '').trim().toLowerCase())
      .filter(n => n.length >= 3);
    for (const needle of needles) {
      if (names.some(n => n.includes(needle) || needle.includes(n))) return org.id;
    }
  }
  return null;
}

// ── Usage analytics for the org dashboard / admin panel ──────────────────────────
export async function fetchUsageForOrg(orgId: string): Promise<EcourtsApiUsage[]> {
  try {
    const { data, error } = await supabase
      .from('ecourts_api_usage')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) return [];
    return (data ?? []) as EcourtsApiUsage[];
  } catch {
    return [];
  }
}

// Always price usage with the CURRENT subscriber pricing table (amount_per_call),
// so the displayed "Amount Charged" reflects subscriber rates regardless of what
// was recorded historically.
export function summarizeUsage(rows: EcourtsApiUsage[], pricing: EcourtsApiPricing[]): OrgUsageSummary {
  const rateByEndpoint = new Map(pricing.map(p => [p.endpoint_name, Number(p.amount_per_call ?? 0)]));
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const callsByEndpoint = new Map<string, number>();
  const syncedCases = new Set<string>();
  let amountThisMonth = 0;
  let lastSync: string | null = null;

  for (const r of rows) {
    const ep = r.endpoint_name ?? 'UNKNOWN';
    callsByEndpoint.set(ep, (callsByEndpoint.get(ep) ?? 0) + 1);
    if (r.case_id) syncedCases.add(r.case_id);
    if (!lastSync || String(r.created_at) > lastSync) lastSync = String(r.created_at);
    if (String(r.created_at ?? '').slice(0, 7) === monthKey) {
      amountThisMonth += rateByEndpoint.get(ep) ?? 0;
    }
  }

  const byEndpoint: EndpointUsage[] = Array.from(callsByEndpoint.entries())
    .map(([endpoint, calls]) => {
      const rate = rateByEndpoint.get(endpoint) ?? 0;
      return { endpoint, calls, rate, amountCharged: +(calls * rate).toFixed(2) };
    })
    .sort((a, b) => b.amountCharged - a.amountCharged);

  const amountCharged = +byEndpoint.reduce((s, e) => s + e.amountCharged, 0).toFixed(2);

  return {
    amountCharged,
    apiCalls: rows.length,
    casesSynced: syncedCases.size,
    amountThisMonth: +amountThisMonth.toFixed(2),
    byEndpoint,
    lastSync,
  };
}
