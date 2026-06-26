import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Sparkles, RefreshCw, ShieldAlert, FileText, TrendingUp, Building2, ClipboardList, Target, Lightbulb, ListChecks, AlertTriangle, Gavel, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/apiClient';
import { getEcourtsCaseType } from '@/config/ecourtsCaseTypes';
import { hasCredits, NO_CREDITS_MESSAGE, recordApiUsage } from '@/lib/organizations';
import type { AiCaseAnalysisJson, AiActionPlanItem, CaseAiAnalysis, ParsedOrderRecord } from '@/types';
import type { EcourtsCaseData } from '@/components/CaseDetailsModal';

interface SearchResponse {
  success: boolean;
  totalHits?: number;
  caseData?: EcourtsCaseData | null;
  requestId?: string | null;
  message?: string;
}

interface OrdersResponse {
  success: boolean;
  orders?: ParsedOrderRecord[];
  count?: number;
  note?: string;
  message?: string;
}

interface AiAnalysisResponse {
  success: boolean;
  summary?: string | null;
  analysis?: AiCaseAnalysisJson;
  model?: string | null;
  usage?: Record<string, unknown> | null;
  generatedAt?: string | number | null;
  message?: string;
  detail?: string;
  responsePreview?: string;
  fallbackPreview?: string;
}

function buildAiErrorMessage(payload: AiAnalysisResponse | null | undefined): string {
  if (!payload) return 'Unable to generate AI analysis.';
  const parts = [payload.message, payload.detail]
    .map(v => String(v || '').trim())
    .filter(Boolean);

  const primaryPreview = String(payload.responsePreview || '').trim();
  const fallbackPreview = String(payload.fallbackPreview || '').trim();
  if (primaryPreview) parts.push(`Primary response: ${primaryPreview}`);
  if (fallbackPreview) parts.push(`Fallback response: ${fallbackPreview}`);

  return parts.length > 0 ? parts.join(' | ') : 'Unable to generate AI analysis.';
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asLevel(value: unknown): 'Low' | 'Medium' | 'High' {
  const v = asStr(value).toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'low') return 'Low';
  return 'Medium';
}

function asActionPlan(value: unknown): AiActionPlanItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { step: item, priority: 'Medium' as const, owner: 'Assigned Advocate' };
      const obj = (item ?? {}) as Record<string, unknown>;
      const step = asStr(obj.step);
      if (!step) return null;
      const priority = asLevel(obj.priority);
      return { step, priority, owner: asStr(obj.owner) || 'Assigned Advocate' };
    })
    .filter((x): x is AiActionPlanItem => x !== null);
}

/**
 * Coerce any cached ai_json (including legacy/partial shapes) into the full
 * 10-section AiCaseAnalysisJson with safe defaults so the UI never crashes on
 * missing nested fields.
 */
function normalizeAnalysis(raw: AiCaseAnalysisJson | null | undefined): AiCaseAnalysisJson | null {
  if (!raw) return null;
  const r = raw as unknown as Record<string, unknown>;
  const risk = (r.litigation_risk_assessment ?? r.risk_assessment ?? {}) as Record<string, unknown>;
  const hearing = (r.hearing_trend_analysis ?? {}) as Record<string, unknown>;
  const dept = (r.department_impact_analysis ?? {}) as Record<string, unknown>;
  const level = asLevel(risk.level);

  return {
    executive_legal_summary: asStr(r.executive_legal_summary),
    litigation_risk_assessment: {
      level,
      rationale: asStr(risk.rationale) || asStr(risk.reason),
      key_risk_factors: toList(risk.key_risk_factors as string[] | undefined),
    },
    hearing_trend_analysis: {
      pattern: asStr(hearing.pattern),
      adjournment_concerns: asStr(hearing.adjournment_concerns),
      observations: toList(hearing.observations as string[] | undefined),
    },
    department_impact_analysis: {
      summary: asStr(dept.summary),
      financial_exposure: asStr(dept.financial_exposure),
      policy_or_operational_impact: asStr(dept.policy_or_operational_impact),
    },
    advocate_recommendations: toList(r.advocate_recommendations as string[] | undefined),
    missing_information: toList(r.missing_information as string[] | undefined),
    next_hearing_preparation_checklist: toList(r.next_hearing_preparation_checklist as string[] | undefined),
    strategic_recommendations: toList(r.strategic_recommendations as string[] | undefined),
    similar_case_risk_indicators: toList(r.similar_case_risk_indicators as string[] | undefined),
    ai_action_plan: asActionPlan(r.ai_action_plan),
    risk_assessment: {
      level,
      reason: asStr((r.risk_assessment as Record<string, unknown> | undefined)?.reason) || asStr(risk.rationale),
    },
    attention_required: Boolean(r.attention_required),
    no_activity: Boolean(r.no_activity),
    long_pending: Boolean(r.long_pending),
    upcoming_hearing: Boolean(r.upcoming_hearing),
  };
}

async function fetchCaseCache(caseId: string) {
  const { data, error } = await supabase
    .from('cases')
    .select('case_number, cnr_number, case_details_json, case_details_synced_at, ecourts_request_id, organization_id, district, section, advocate_status, assigned_advocate_name, assigned_advocate_email, assigned_advocate_mobile, case_status, next_hearing_date, updated_at')
    .eq('id', caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildCaseHash(caseId: string): Promise<string> {
  const cache = await fetchCaseCache(caseId);
  const [notesRes, tasksRes] = await Promise.all([
    supabase.from('case_notes').select('note_text, created_by, created_at').eq('case_id', caseId).order('created_at', { ascending: true }),
    supabase.from('case_tasks').select('task_title, task_description, assigned_to_name, due_date, task_status, priority, created_at, completed_at').eq('case_id', caseId).order('created_at', { ascending: true }),
  ]);

  const source = stableStringify({
    case_details_json: cache?.case_details_json ?? null,
    advocate_status: cache?.advocate_status ?? null,
    case_notes: notesRes.data ?? [],
    case_tasks: tasksRes.data ?? [],
  });

  return sha256(source);
}

async function ensureCaseDetails(caseId: string, caseNumber: string | null, provided: EcourtsCaseData | null | undefined): Promise<{ data: EcourtsCaseData; requestId: string | null; organizationId: string | null }> {
  if (provided) {
    const row = await fetchCaseCache(caseId);
    return {
      data: provided,
      requestId: (row?.ecourts_request_id as string | null) ?? null,
      organizationId: (row?.organization_id as string | null) ?? null,
    };
  }

  const row = await fetchCaseCache(caseId);
  if (row?.case_details_json) {
    return {
      data: row.case_details_json as EcourtsCaseData,
      requestId: (row.ecourts_request_id as string | null) ?? null,
      organizationId: (row.organization_id as string | null) ?? null,
    };
  }

  const orgId = (row?.organization_id as string | null) ?? null;
  if (!(await hasCredits(orgId))) throw new Error(NO_CREDITS_MESSAGE);

  const rawCase = String(caseNumber || row?.case_number || '').trim();
  const [caseType = '', caseNo = '', caseYear = ''] = rawCase.split('/');
  const ecourtsCaseType = getEcourtsCaseType(caseType);
  if (!caseNo || !caseYear) throw new Error('Case details cache is missing and the case number cannot be parsed for refresh.');

  const response = await apiFetch('/api/case-details/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseNo, caseYear, caseTypes: ecourtsCaseType }),
  });
  const result = await response.json() as SearchResponse;
  if (!response.ok || !result.success || !result.caseData) {
    throw new Error(result.message || 'Unable to load case details for AI analysis.');
  }

  await supabase
    .from('cases')
    .update({
      case_details_json: result.caseData,
      case_details_synced_at: new Date().toISOString(),
      ecourts_request_id: result.requestId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId);

  recordApiUsage({ organizationId: orgId, caseId, endpoint: 'CASE_SEARCH', requestId: result.requestId ?? null, cnr: rawCase });
  recordApiUsage({ organizationId: orgId, caseId, endpoint: 'CASE_DETAIL', requestId: result.requestId ?? null, cnr: rawCase });

  return { data: result.caseData, requestId: result.requestId ?? null, organizationId: orgId };
}

async function buildAiContext(caseId: string, caseNumber: string | null, caseData: EcourtsCaseData | null | undefined) {
  const cache = await fetchCaseCache(caseId);
  const ensured = await ensureCaseDetails(caseId, caseNumber, caseData);

  const [notesRes, tasksRes, historyRes] = await Promise.all([
    supabase.from('case_notes').select('note_text, created_by, created_at').eq('case_id', caseId).order('created_at', { ascending: false }),
    supabase.from('case_tasks').select('task_title, task_description, assigned_to_name, due_date, task_status, priority, created_at, completed_at').eq('case_id', caseId).order('created_at', { ascending: false }),
    supabase.from('case_status_history').select('old_status, new_status, remarks, changed_by, changed_at').eq('case_id', caseId).order('changed_at', { ascending: false }),
  ]);

  return {
    organizationId: ensured.organizationId,
    requestId: ensured.requestId,
    cnrNumber: String(cache?.cnr_number || ensured.data.cnr || '' || null),
    context: {
      caseNumber: String(caseNumber || cache?.case_number || ''),
      caseRecord: {
        district: cache?.district ?? null,
        section: cache?.section ?? null,
        advocate_status: cache?.advocate_status ?? null,
        assigned_advocate_name: cache?.assigned_advocate_name ?? null,
        assigned_advocate_email: cache?.assigned_advocate_email ?? null,
        assigned_advocate_mobile: cache?.assigned_advocate_mobile ?? null,
        case_status: cache?.case_status ?? null,
        next_hearing_date: cache?.next_hearing_date ?? null,
        updated_at: cache?.updated_at ?? null,
      },
      caseDetailsJson: ensured.data,
      hearingHistory: (ensured.data as Record<string, unknown>).hearingHistory ?? (ensured.data as Record<string, unknown>).historyOfCaseHearings ?? null,
      petitioners: ensured.data.petitioners ?? [],
      respondents: ensured.data.respondents ?? [],
      advocates: [
        ...(ensured.data.petitionerAdvocates ?? []),
        ...(ensured.data.respondentAdvocates ?? []),
      ],
      interimOrders: (ensured.data as Record<string, unknown>).interimOrders ?? [],
      orders: (ensured.data as Record<string, unknown>).judgmentOrders ?? (ensured.data as Record<string, unknown>).orders ?? [],
      judgmentDetails: (ensured.data as Record<string, unknown>).judgmentOrders ?? [],
      caseNotes: notesRes.data ?? [],
      internalTasks: tasksRes.data ?? [],
      advocateNotes: notesRes.data ?? [],
      advocateStatusTimeline: historyRes.data ?? [],
    },
  };
}

/**
 * Orders are downloaded and parsed only once, then cached permanently in
 * case_ai_analysis.parsed_orders. If a cached copy exists we reuse it and never
 * hit the MHC server again. Returns null only when no attempt could be made.
 */
async function ensureParsedOrders(
  caseNumber: string | null,
  cached: ParsedOrderRecord[] | null | undefined,
): Promise<ParsedOrderRecord[] | null> {
  if (Array.isArray(cached) && cached.length > 0) return cached;
  const number = String(caseNumber || '').trim();
  if (!number) return cached ?? null;

  try {
    const resp = await apiFetch('/api/case-analysis/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseNumber: number, limit: 8 }),
    });
    const json = await resp.json() as OrdersResponse;
    if (resp.ok && json.success && Array.isArray(json.orders)) {
      return json.orders;
    }
  } catch {
    // Orders are optional context — never block analysis on order fetch failure.
  }
  return cached ?? null;
}

export function AiInsightsTab({ caseId, caseNumber, caseData }: { caseId: string | null | undefined; caseNumber: string | null; caseData?: EcourtsCaseData | null }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<CaseAiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [staleAnalysis, setStaleAnalysis] = useState(false);

  const loadCached = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('case_ai_analysis')
        .select('*')
        .eq('case_id', caseId)
        .maybeSingle();
      if (qErr) throw qErr;
      const current = await buildCaseHash(caseId);
      setCurrentHash(current);

      if (data) {
        const lastAccessed = new Date().toISOString();
        const { data: updated, error: updateErr } = await supabase
          .from('case_ai_analysis')
          .update({ last_accessed_at: lastAccessed })
          .eq('id', (data as CaseAiAnalysis).id)
          .select('*')
          .single();
        if (updateErr) throw updateErr;
        const next = updated as CaseAiAnalysis;
        setRecord(next);
        setStaleAnalysis(Boolean(next.case_hash && next.case_hash !== current));
      } else {
        setRecord(null);
        setStaleAnalysis(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI analysis.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void loadCached(); }, [loadCached]);

  const analysis = useMemo(() => normalizeAnalysis(record?.ai_json), [record]);
  const parsedOrders = useMemo<ParsedOrderRecord[]>(() => Array.isArray(record?.parsed_orders) ? record!.parsed_orders! : [], [record]);

  const generate = useCallback(async (refresh: boolean) => {
    if (!caseId) return;
    setGenerating(true);
    setError(null);
    try {
      const payload = await buildAiContext(caseId, caseNumber, caseData);

      // Download + parse orders once, then reuse the permanent cache thereafter.
      const parsedOrders = await ensureParsedOrders(caseNumber ?? payload.context.caseNumber, record?.parsed_orders ?? null);
      const ordersChanged = parsedOrders !== (record?.parsed_orders ?? null);
      const context = { ...payload.context, parsedOrders: parsedOrders ?? [] };

      const resp = await apiFetch('/api/case-analysis/sarvam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, caseNumber: caseNumber ?? null, context }),
      });
      let json: AiAnalysisResponse | null = null;
      try {
        json = await resp.json() as AiAnalysisResponse;
      } catch {
        const raw = await resp.text().catch(() => '');
        throw new Error(raw.trim() || `Request failed (HTTP ${resp.status})`);
      }
      if (!resp.ok || !json?.success) throw new Error(buildAiErrorMessage(json));

      const upsertPayload: Record<string, unknown> = {
        case_id: caseId,
        cnr_number: payload.cnrNumber || null,
        case_hash: currentHash ?? await buildCaseHash(caseId),
        ai_summary: json.summary ?? null,
        ai_json: json.analysis as AiCaseAnalysisJson,
        model: json.model ?? null,
        generated_at: new Date().toISOString(),
        generated_by: user?.profile?.full_name || user?.email || 'Unknown',
        last_accessed_at: new Date().toISOString(),
      };
      if (parsedOrders) {
        upsertPayload.parsed_orders = parsedOrders;
        if (ordersChanged || !record?.parsed_orders_at) {
          upsertPayload.parsed_orders_at = new Date().toISOString();
        }
      }

      const { data: existingRow, error: existingErr } = await supabase
        .from('case_ai_analysis')
        .select('id')
        .eq('case_id', caseId)
        .maybeSingle();
      if (existingErr) throw existingErr;

      const persisted = existingRow?.id
        ? await supabase
            .from('case_ai_analysis')
            .update(upsertPayload)
            .eq('id', existingRow.id)
            .select('*')
            .single()
        : await supabase
            .from('case_ai_analysis')
            .insert(upsertPayload)
            .select('*')
            .single();

      if (persisted.error) throw persisted.error;
      setRecord(persisted.data as CaseAiAnalysis);
      setCurrentHash((persisted.data as CaseAiAnalysis).case_hash ?? currentHash);
      setStaleAnalysis(false);
      toast.success(refresh ? 'AI analysis refreshed.' : 'AI analysis generated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate AI analysis.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }, [caseData, caseId, caseNumber, currentHash, record, user]);

  if (!caseId) {
    return <p className="py-10 text-center text-sm text-muted-foreground">AI insights are available once a case is selected.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-blue-50/60 to-white px-5 py-4 shadow-xs">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-indigo-200/30 blur-2xl" aria-hidden="true" />
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.9375rem] font-bold tracking-tight text-indigo-950">Legal Intelligence Report</p>
            <p className="text-xs text-muted-foreground">
              {record ? `Generated ${fmtDateTime(record.generated_at)}` : 'AI-generated senior-advocate analysis from cached case details, orders and notes.'}
            </p>
            {record && (
              <p className="mt-0.5 text-xs text-muted-foreground">Last viewed: {fmtDateTime(record.last_accessed_at)}</p>
            )}
          </div>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {!record ? (
            <Button size="sm" className="gap-1.5" disabled={generating || loading} onClick={() => void generate(false)}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate AI Analysis
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={generating} onClick={() => void generate(true)}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh AI Analysis
            </Button>
          )}
        </div>
      </div>

      {(loading || generating) && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 lg:col-span-2" />
          <Skeleton className="h-40" />
          <Skeleton className="h-32 lg:col-span-3" />
        </div>
      )}

      {!loading && !generating && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      {!loading && !generating && !error && staleAnalysis && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Case data changed since last AI analysis. Refresh recommended.
        </div>
      )}

      {!loading && !generating && !analysis && !error && (
        <EmptyState
          icon={Sparkles}
          title="No AI analysis yet"
          description="Generate a senior-advocate style legal analysis with risk assessment, hearing trends and an action plan. Runs only when you click."
          action={<Button size="sm" className="gap-1.5" disabled={generating} onClick={() => void generate(false)}><Sparkles className="h-4 w-4" />Generate AI Analysis</Button>}
        />
      )}

      {analysis && (
        <div className="space-y-4">
          {/* 1. Executive Legal Summary + risk header */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="relative overflow-hidden lg:col-span-2">
              <span className="absolute inset-y-0 left-0 w-1 bg-indigo-500" aria-hidden="true" />
              <CardHeader className="flex flex-row items-center gap-2 pb-2 pl-7">
                <FileText className="h-4 w-4 text-indigo-600" />
                <CardTitle>Executive Legal Summary</CardTitle>
              </CardHeader>
              <CardContent className="pl-7">
                <p className="text-sm leading-relaxed text-foreground/90">{analysis.executive_legal_summary || '\u2014'}</p>
              </CardContent>
            </Card>
            <RiskCard
              level={analysis.litigation_risk_assessment.level}
              rationale={analysis.litigation_risk_assessment.rationale}
              flags={{
                attention: analysis.attention_required,
                noActivity: analysis.no_activity,
                longPending: analysis.long_pending,
                upcoming: analysis.upcoming_hearing,
              }}
            />
          </div>

          {/* 2 & 3. Risk factors + hearing trend */}
          <div className="grid gap-4 lg:grid-cols-2">
            <BulletCard icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} title="Key Risk Factors" items={toList(analysis.litigation_risk_assessment.key_risk_factors)} />
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <TrendingUp className="h-4 w-4 text-amber-600" />
                <CardTitle className="text-base">Hearing Trend Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <TextRow label="Pattern" value={analysis.hearing_trend_analysis.pattern} />
                <TextRow label="Adjournment Concerns" value={analysis.hearing_trend_analysis.adjournment_concerns} />
                <BulletList items={toList(analysis.hearing_trend_analysis.observations)} />
              </CardContent>
            </Card>
          </div>

          {/* 4. Department Impact */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-base">Department Impact Analysis</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <TextRow label="Summary" value={analysis.department_impact_analysis.summary} />
              <TextRow label="Financial Exposure" value={analysis.department_impact_analysis.financial_exposure} />
              <TextRow label="Policy / Operational Impact" value={analysis.department_impact_analysis.policy_or_operational_impact} />
            </CardContent>
          </Card>

          {/* 5 & 6. Advocate recommendations + missing info */}
          <div className="grid gap-4 lg:grid-cols-2">
            <BulletCard icon={<Lightbulb className="h-4 w-4 text-emerald-600" />} title="Advocate Recommendations" items={toList(analysis.advocate_recommendations)} />
            <BulletCard icon={<ClipboardList className="h-4 w-4 text-orange-600" />} title="Missing Information / Documents" items={toList(analysis.missing_information)} />
          </div>

          {/* 7 & 8. Hearing prep + strategy */}
          <div className="grid gap-4 lg:grid-cols-2">
            <BulletCard icon={<ListChecks className="h-4 w-4 text-indigo-600" />} title="Next Hearing Preparation Checklist" items={toList(analysis.next_hearing_preparation_checklist)} />
            <BulletCard icon={<Target className="h-4 w-4 text-violet-600" />} title="Strategic Recommendations" items={toList(analysis.strategic_recommendations)} />
          </div>

          {/* 9. Similar case risk indicators */}
          <BulletCard icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} title="Similar Case Risk Indicators" items={toList(analysis.similar_case_risk_indicators)} />

          {/* 10. AI Generated Action Plan */}
          <Card className="relative overflow-hidden">
            <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-blue-500" aria-hidden="true" />
            <CardHeader className="flex flex-row items-center gap-2 pb-2 pl-7">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <CardTitle>AI Generated Action Plan</CardTitle>
            </CardHeader>
            <CardContent className="pl-7">
              {analysis.ai_action_plan.length === 0 ? (
                <p className="text-sm text-muted-foreground">No action plan returned.</p>
              ) : (
                <ol className="space-y-2.5">
                  {analysis.ai_action_plan.map((item, idx) => (
                    <li key={`${item.step}-${idx}`} className="flex items-start gap-3 rounded-xl border border-border/70 bg-slate-50/60 px-3.5 py-3 text-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-xs font-semibold text-white shadow-sm">{idx + 1}</span>
                      <div className="flex-1">
                        <p className="leading-relaxed text-foreground/90">{item.step}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" /> Owner: {item.owner}
                        </p>
                      </div>
                      <Badge variant={priorityVariant(item.priority)}>{item.priority}</Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Cached court orders (downloaded & parsed once) */}
          {parsedOrders.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <Gavel className="h-4 w-4 text-slate-600" />
                <CardTitle className="text-base">Court Orders (Cached)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {parsedOrders.map((order, idx) => (
                  <div key={`${order.pdf_url ?? idx}`} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{order.order_type || 'Order'}{order.order_date ? ` \u2014 ${order.order_date}` : ''}</span>
                      {order.pdf_url && (
                        <a href={order.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 underline">View PDF</a>
                      )}
                    </div>
                    {order.judge && <p className="text-xs text-muted-foreground">Bench: {order.judge}</p>}
                    {order.summary && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{order.summary}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function priorityVariant(level: string): 'destructive' | 'warning' | 'secondary' {
  switch (level.toLowerCase()) {
    case 'high': return 'destructive';
    case 'medium': return 'warning';
    default: return 'secondary';
  }
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{value?.trim() ? value : 'Not available'}</p>
    </div>
  );
}

const RISK_STYLES: Record<string, { ring: string; text: string; bar: string; chip: string; segments: number }> = {
  High:   { ring: 'border-rose-200 bg-rose-50',   text: 'text-rose-700',   bar: 'bg-rose-500',   chip: 'bg-rose-100 text-rose-700',   segments: 3 },
  Medium: { ring: 'border-amber-200 bg-amber-50', text: 'text-amber-700',  bar: 'bg-amber-500',  chip: 'bg-amber-100 text-amber-700', segments: 2 },
  Low:    { ring: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', segments: 1 },
};

function RiskCard({ level, rationale, flags }: {
  level: 'Low' | 'Medium' | 'High';
  rationale: string;
  flags: { attention: boolean; noActivity: boolean; longPending: boolean; upcoming: boolean };
}) {
  const s = RISK_STYLES[level] ?? RISK_STYLES.Medium;
  return (
    <Card className={`relative overflow-hidden border ${s.ring}`}>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <ShieldAlert className={`h-4 w-4 ${s.text}`} />
        <CardTitle>Litigation Risk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className={`text-2xl font-bold tracking-tight ${s.text}`}>{level} Risk</span>
          <div className="flex items-end gap-1" aria-hidden="true">
            {[1, 2, 3].map(i => (
              <span key={i} className={`w-2 rounded-sm ${i <= s.segments ? s.bar : 'bg-slate-200'}`} style={{ height: `${8 + i * 6}px` }} />
            ))}
          </div>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{rationale?.trim() ? rationale : 'Not available'}</p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          {flags.attention && <Badge variant="destructive">Immediate Attention</Badge>}
          {flags.noActivity && <Badge variant="warning">No Activity</Badge>}
          {flags.longPending && <Badge variant="warning">Long Pending</Badge>}
          {flags.upcoming && <Badge variant="info">Upcoming Hearing</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm italic text-muted-foreground/60">No information available</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500/80" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BulletCard({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        {icon}
        <CardTitle>{title}</CardTitle>
        {items.length > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold tabular-nums text-slate-500">{items.length}</span>
        )}
      </CardHeader>
      <CardContent>
        <BulletList items={items} />
      </CardContent>
    </Card>
  );
}
