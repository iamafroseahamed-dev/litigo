import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, RefreshCw, ShieldAlert, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getEcourtsCaseType } from '@/config/ecourtsCaseTypes';
import { hasCredits, NO_CREDITS_MESSAGE, recordApiUsage } from '@/lib/organizations';
import type { AiCaseAnalysisJson, CaseAiAnalysis } from '@/types';
import type { EcourtsCaseData } from '@/components/CaseDetailsModal';

interface SearchResponse {
  success: boolean;
  totalHits?: number;
  caseData?: EcourtsCaseData | null;
  requestId?: string | null;
  message?: string;
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

function riskVariant(level: string | null | undefined): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch ((level ?? '').toLowerCase()) {
    case 'high': return 'destructive';
    case 'medium': return 'warning';
    case 'low': return 'success';
    default: return 'secondary';
  }
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

  const response = await fetch('/api/case-details/search', {
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

export function AiInsightsTab({ caseId, caseNumber, caseData }: { caseId: string | null | undefined; caseNumber: string | null; caseData?: EcourtsCaseData | null }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<CaseAiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setRecord((data ?? null) as CaseAiAnalysis | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI analysis.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void loadCached(); }, [loadCached]);

  const analysis = useMemo(() => record?.ai_json ?? null, [record]);

  const generate = useCallback(async (refresh: boolean) => {
    if (!caseId) return;
    setGenerating(true);
    setError(null);
    try {
      const payload = await buildAiContext(caseId, caseNumber, caseData);
      const resp = await fetch('/api/case-analysis/sarvam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, caseNumber, context: payload.context }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) throw new Error(json?.message || 'Unable to generate AI analysis.');

      const upsertPayload = {
        case_id: caseId,
        cnr_number: payload.cnrNumber || null,
        ai_summary: json.summary ?? null,
        ai_json: json.analysis as AiCaseAnalysisJson,
        generated_at: new Date().toISOString(),
        generated_by: user?.profile?.full_name || user?.email || 'Unknown',
      };

      const { data, error: upsertErr } = await supabase
        .from('case_ai_analysis')
        .upsert(upsertPayload, { onConflict: 'case_id' })
        .select('*')
        .single();
      if (upsertErr) throw upsertErr;
      setRecord(data as CaseAiAnalysis);
      toast.success(refresh ? 'AI analysis refreshed.' : 'AI analysis generated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate AI analysis.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }, [caseData, caseId, caseNumber, user]);

  if (!caseId) {
    return <p className="py-10 text-center text-sm text-muted-foreground">AI insights are available once a case is selected.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-4 py-3">
        <div>
          <p className="text-sm font-medium">AI Case Analysis</p>
          <p className="text-xs text-muted-foreground">
            {record ? `AI Analysis generated on ${fmtDateTime(record.generated_at)}` : 'Generate a structured legal summary from cached case details and internal notes.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!record ? (
            <Button size="sm" className="gap-1" disabled={generating || loading} onClick={() => void generate(false)}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate AI Analysis
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-1" disabled={generating} onClick={() => void generate(true)}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh AI Analysis
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI analysis…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !analysis && !error && (
        <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No cached AI analysis available yet.
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Executive Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{analysis.executive_summary.case_about}</p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Dispute</p>
                  <p className="mt-1 text-sm">{analysis.executive_summary.key_dispute}</p>
                </div>
                {record?.ai_summary && <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{record.ai_summary}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risk Assessment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant={riskVariant(analysis.risk_assessment.level)}>{analysis.risk_assessment.level} Risk</Badge>
                <p className="text-sm">{analysis.risk_assessment.reason}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {analysis.attention_required && <Badge variant="destructive">Immediate Attention</Badge>}
                  {analysis.no_activity && <Badge variant="warning">No Activity</Badge>}
                  {analysis.long_pending && <Badge variant="warning">Long Pending</Badge>}
                  {analysis.upcoming_hearing && <Badge variant="info">Upcoming Hearing</Badge>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <InfoListCard title="Parties" sections={[
              { label: 'Petitioners', items: toList(analysis.parties.petitioners) },
              { label: 'Respondents', items: toList(analysis.parties.respondents) },
              { label: 'Advocates', items: toList(analysis.parties.advocates) },
            ]} />
            <InfoTextCard title="Case Status" rows={[
              ['Status', analysis.case_status.status],
              ['Current Stage', analysis.case_status.current_stage],
              ['Total Hearings', String(analysis.hearing_analysis.total_hearings)],
              ['Hearing Trend', analysis.hearing_analysis.hearing_trend],
              ['Delays', analysis.hearing_analysis.delays],
            ]} />
            <InfoTextCard title="Timeline Summary" rows={[
              ['Filing Date', analysis.timeline_summary.filing_date],
              ['First Hearing', analysis.timeline_summary.first_hearing],
              ['Last Hearing', analysis.timeline_summary.last_hearing],
              ['Next Hearing', analysis.timeline_summary.next_hearing],
            ]} />
            <InfoTextCard title="Department Impact" rows={[
              ['Organization Impact', analysis.department_impact.organization_impact],
              ['Department Impact', analysis.department_impact.department_impact],
            ]} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <InfoListCard title="Key Legal Observations" sections={[
              { label: 'Important Legal Issues', items: toList(analysis.key_legal_observations.important_legal_issues) },
              { label: 'Risks', items: toList(analysis.key_legal_observations.risks) },
              { label: 'Potential Impact', items: toList(analysis.key_legal_observations.potential_impact) },
            ]} />
            <InfoListCard title="Advocate Action Items" sections={[
              { label: 'Immediate Actions', items: toList(analysis.advocate_action_items.immediate_actions) },
              { label: 'Documents Required', items: toList(analysis.advocate_action_items.documents_required) },
              { label: 'Follow-up Recommendations', items: toList(analysis.advocate_action_items.follow_up_recommendations) },
            ]} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recommended Next Steps</CardTitle>
            </CardHeader>
            <CardContent>
              {analysis.recommended_next_steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No specific next steps returned.</p>
              ) : (
                <ul className="space-y-2">
                  {analysis.recommended_next_steps.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="flex items-start gap-2 text-sm">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-indigo-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function InfoTextCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-sm">{value || '\u2014'}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function InfoListCard({ title, sections }: { title: string; sections: Array<{ label: string; items: string[] }> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map(section => (
          <div key={section.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</p>
            {section.items.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">\u2014</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {section.items.map((item, idx) => (
                  <li key={`${section.label}-${idx}`} className="flex items-start gap-2 text-sm">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
