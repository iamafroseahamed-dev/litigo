import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, RefreshCw, Search, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { recordApiUsage, hasCredits, NO_CREDITS_MESSAGE } from '@/lib/organizations';

/**
 * eCourts Case History tab — complete litigation history from the eCourts partner
 * *case* API (by CNR), with 24h browser caching. Order/PDF download is intentionally
 * NOT shown here (Case Summary, Parties, Hearing History, Timeline, Disposal,
 * Statistics only). The API token stays server-side (proxied via
 * /api/case-details/history). Each real (non-cached) fetch records a CASE_DETAIL
 * credit against the case's organization.
 */

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

type Dict = Record<string, unknown>;

function cacheKey(cnr: string) { return `ecourts_case_${cnr}`; }

interface CacheEntry { data: Dict; cachedAt: string; requestId: string | null }

function readCache(cnr: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(cnr));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed?.data && parsed.cachedAt) {
      const age = Date.now() - new Date(parsed.cachedAt).getTime();
      if (age >= 0 && age < CACHE_TTL) return parsed;
    }
  } catch { /* ignore quota / parse errors */ }
  return null;
}

function writeCache(cnr: string, data: Dict, requestId: string | null) {
  try {
    localStorage.setItem(cacheKey(cnr), JSON.stringify({ data, cachedAt: new Date().toISOString(), requestId }));
  } catch { /* ignore quota / private-mode errors */ }
}

// ── Field access helpers (tolerate camelCase / snake_case / Title Case) ──────────
function pickFrom(objs: Dict[], keys: string[]): unknown {
  for (const o of objs) {
    if (!o) continue;
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}
function s(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}
function arrOf(objs: Dict[], keys: string[]): Dict[] {
  const v = pickFrom(objs, keys);
  return Array.isArray(v) ? (v as Dict[]) : [];
}
function strArr(objs: Dict[], keys: string[]): string[] {
  const v = pickFrom(objs, keys);
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map(x => (x && typeof x === 'object' ? s((x as Dict).name ?? JSON.stringify(x)) : s(x))).filter(Boolean);
}
function fmtDate(value: unknown): string {
  const str = s(value);
  if (!str) return '\u2014';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(value: unknown): string {
  const str = s(value);
  if (!str) return '\u2014';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function daysBetween(a: unknown, b: unknown): number | null {
  const d1 = new Date(s(a)); const d2 = new Date(s(b));
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
}

function SumCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value || '\u2014'}</p>
    </div>
  );
}
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="px-3 py-3 text-center">
        <p className="text-2xl font-bold">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
function PartyBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{'\u2014'}</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5">
          {items.map((it, i) => <li key={`${it}-${i}`} className="text-sm">{it}</li>)}
        </ul>
      )}
    </div>
  );
}

export function EcourtsHistoryTab({ caseId, fallbackCnr }: { caseId?: string | null; fallbackCnr?: string | null }) {
  const [cnr, setCnr] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [data, setData] = useState<Dict | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [sub, setSub] = useState('summary');
  const [hearingSearch, setHearingSearch] = useState('');

  const resolveCase = useCallback(async (): Promise<{ cnr: string; orgId: string | null }> => {
    if (caseId) {
      try {
        const { data: row } = await supabase
          .from('cases').select('cnr_number, organization_id').eq('id', caseId).maybeSingle();
        const dbc = s(row?.cnr_number);
        return { cnr: dbc || s(fallbackCnr), orgId: (row?.organization_id as string | null) ?? null };
      } catch { /* fall through */ }
    }
    return { cnr: s(fallbackCnr), orgId: null };
  }, [caseId, fallbackCnr]);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    setBlocked(false);
    const { cnr: c, orgId: oid } = await resolveCase();
    setCnr(c);
    setOrgId(oid);
    if (!c) { setData(null); setCachedAt(null); setLoading(false); return; }

    if (!force) {
      const cached = readCache(c);
      if (cached) { setData(cached.data); setCachedAt(cached.cachedAt); setLoading(false); return; }
    }

    // Paid API call ahead — gate on the organization's credit balance.
    if (!(await hasCredits(oid))) { setBlocked(true); setLoading(false); return; }

    try {
      const res = await fetch(`/api/case-details/history?cnr=${encodeURIComponent(c)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error('fail');
      if (!json.data) { setData(null); setCachedAt(null); setLoading(false); return; }
      const requestId = (json.requestId as string | null) ?? null;
      setData(json.data as Dict);
      setCachedAt(new Date().toISOString());
      writeCache(c, json.data as Dict, requestId);
      // Record the paid CASE_DETAIL call (best-effort, deducts a credit).
      recordApiUsage({ organizationId: oid, caseId, endpoint: 'CASE_DETAIL', requestId, cnr: c });
    } catch {
      setError('Unable to retrieve case history from eCourts.');
    } finally {
      setLoading(false);
    }
  }, [resolveCase, caseId]);

  useEffect(() => { load(false); }, [load]);

  const vm = useMemo(() => {
    if (!data) return null;
    const root = data;
    const cc = (root.courtCaseData && typeof root.courtCaseData === 'object' ? root.courtCaseData as Dict : root);
    const containers = [cc, root];

    const summary: { label: string; value: string }[] = [
      { label: 'Case Status', value: s(pickFrom(containers, ['caseStatus', 'case_status', 'status'])) },
      { label: 'Case Type', value: s(pickFrom(containers, ['caseType', 'case_type', 'type'])) },
      { label: 'Court Name', value: s(pickFrom(containers, ['courtName', 'court_name', 'court'])) },
      { label: 'District', value: s(pickFrom(containers, ['district', 'districtName', 'district_name'])) },
      { label: 'Filing Date', value: fmtDate(pickFrom(containers, ['filingDate', 'filing_date'])) },
      { label: 'Registration Date', value: fmtDate(pickFrom(containers, ['registrationDate', 'registration_date'])) },
      { label: 'First Hearing Date', value: fmtDate(pickFrom(containers, ['firstHearingDate', 'first_hearing_date'])) },
      { label: 'Last Hearing Date', value: fmtDate(pickFrom(containers, ['lastHearingDate', 'last_hearing_date'])) },
      { label: 'Next Hearing Date', value: fmtDate(pickFrom(containers, ['nextHearingDate', 'next_hearing_date'])) },
      { label: 'Purpose', value: s(pickFrom(containers, ['purpose', 'caseStage', 'stage', 'nextPurpose'])) },
      { label: 'Filing Number', value: s(pickFrom(containers, ['filingNumber', 'filing_number'])) },
      { label: 'Registration Number', value: s(pickFrom(containers, ['registrationNumber', 'registration_number'])) },
    ];

    const petitioners = strArr(containers, ['petitioners', 'petitionerNames']);
    const petitionerAdvocates = strArr(containers, ['petitionerAdvocates', 'petitioner_advocates']);
    const respondents = strArr(containers, ['respondents', 'respondentNames']);
    const respondentAdvocates = strArr(containers, ['respondentAdvocates', 'respondent_advocates']);

    const hearingsRaw = arrOf(containers, ['historyOfCaseHearings', 'hearingHistory', 'caseHistory', 'hearings']);
    const hearings = hearingsRaw.map(h => ({
      hearingDate: s(pickFrom([h], ['hearingDate', 'hearing_date', 'businessDate', 'date'])),
      businessDate: s(pickFrom([h], ['businessDate', 'business_date', 'causeListDate'])),
      purpose: s(pickFrom([h], ['purpose', 'hearingPurpose', 'nextPurpose'])),
      judge: s(pickFrom([h], ['judge', 'judgeName', 'coram', 'judge_name'])),
    })).sort((a, b) => new Date(b.hearingDate).getTime() - new Date(a.hearingDate).getTime());

    const timelineRaw = arrOf(containers, ['businessOnDateEntries', 'businessOnDate', 'dailyBusiness', 'businessEntries']);
    const timeline = timelineRaw.map(b => ({
      date: s(pickFrom([b], ['date', 'businessDate', 'business_date'])),
      businessNotes: s(pickFrom([b], ['businessNotes', 'business', 'businessOnDate', 'notes', 'observation'])),
      nextPurpose: s(pickFrom([b], ['nextPurpose', 'next_purpose', 'purpose'])),
      nextHearingDate: s(pickFrom([b], ['nextHearingDate', 'next_hearing_date'])),
      courtOf: s(pickFrom([b], ['courtOf', 'court_of', 'court', 'judge'])),
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const disposal: { label: string; value: string }[] = [
      { label: 'Case Status', value: s(pickFrom(containers, ['caseStatus', 'case_status', 'status'])) },
      { label: 'Disposal Type', value: s(pickFrom(containers, ['disposalType', 'disposal_type'])) },
      { label: 'Nature of Disposal', value: s(pickFrom(containers, ['natureOfDisposal', 'nature_of_disposal'])) },
      { label: 'Decision Date', value: fmtDate(pickFrom(containers, ['decisionDate', 'decision_date', 'disposalDate'])) },
      { label: 'Disposed By', value: s(pickFrom(containers, ['disposedBy', 'decisionBy', 'judge', 'coram'])) },
      { label: 'Contested Status', value: s(pickFrom(containers, ['contestedStatus', 'contested_status', 'contested'])) },
    ];

    const interimOrders = arrOf(containers, ['interimOrders', 'interim_orders']);
    const judgmentOrders = arrOf(containers, ['judgmentOrders', 'judgment_orders', 'judgments']);
    const totalHearings = Number(pickFrom(containers, ['totalHearings', 'hearingCount'])) || hearings.length;
    const totalInterim = Number(pickFrom(containers, ['interimOrderCount'])) || interimOrders.length;
    const totalJudgments = Number(pickFrom(containers, ['judgmentCount'])) || judgmentOrders.length;
    const totalOrders = Number(pickFrom(containers, ['orderCount'])) || (interimOrders.length + judgmentOrders.length);
    const durationDays = daysBetween(
      pickFrom(containers, ['filingDate', 'filing_date', 'registrationDate']),
      pickFrom(containers, ['decisionDate', 'decision_date']) ?? new Date().toISOString(),
    );
    const daysToFirst = daysBetween(
      pickFrom(containers, ['filingDate', 'filing_date', 'registrationDate']),
      pickFrom(containers, ['firstHearingDate', 'first_hearing_date']),
    );

    return {
      summary, petitioners, petitionerAdvocates, respondents, respondentAdvocates,
      hearings, timeline, disposal,
      stats: {
        totalHearings, totalOrders, totalJudgments, totalInterim,
        durationDays: durationDays ?? 0, daysToFirst: daysToFirst ?? 0,
      },
    };
  }, [data]);

  const filteredHearings = useMemo(() => {
    if (!vm) return [];
    const q = hearingSearch.trim().toLowerCase();
    if (!q) return vm.hearings;
    return vm.hearings.filter(h => [h.hearingDate, h.businessDate, h.purpose, h.judge].some(v => v.toLowerCase().includes(q)));
  }, [vm, hearingSearch]);

  function exportHearings() {
    if (!vm || vm.hearings.length === 0) { toast.error('No hearing history to export.'); return; }
    const rows = vm.hearings.map(h => ({
      'Hearing Date': h.hearingDate || '', 'Business Date': h.businessDate || '',
      'Purpose': h.purpose || '', 'Judge': h.judge || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hearings');
    XLSX.writeFile(wb, `hearing_history_${cnr || 'case'}.xlsx`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Fetching eCourts Case History...
      </div>
    );
  }
  if (blocked) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-6 text-center text-sm font-medium text-amber-800">
        {NO_CREDITS_MESSAGE}
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Unable to retrieve case history from eCourts.
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => load(true)}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh eCourts Data
        </Button>
      </div>
    );
  }
  if (!vm) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No eCourts history available.</p>
        {cnr && (
          <Button variant="outline" size="sm" className="gap-1" onClick={() => load(true)}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh eCourts Data
          </Button>
        )}
      </div>
    );
  }

  const lastSynced = cachedAt ? fmtDateTime(cachedAt) : '\u2014';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Last Synced:</span> {lastSynced}
          {cnr && <span className="ml-2 font-mono text-[11px]">CNR: {cnr}</span>}
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => load(true)}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh eCourts Data
        </Button>
      </div>

      <Tabs value={sub} onValueChange={setSub}>
        <div className="overflow-x-auto">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="parties">Parties</TabsTrigger>
            <TabsTrigger value="hearings">Hearing History</TabsTrigger>
            <TabsTrigger value="timeline">Case Timeline</TabsTrigger>
            <TabsTrigger value="disposal">Disposal Information</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {vm.summary.map(c => <SumCard key={c.label} label={c.label} value={c.value} />)}
          </div>
        </TabsContent>

        <TabsContent value="parties">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <PartyBlock title="Petitioners" items={vm.petitioners} />
            <PartyBlock title="Petitioner Advocates" items={vm.petitionerAdvocates} />
            <PartyBlock title="Respondents" items={vm.respondents} />
            <PartyBlock title="Respondent Advocates" items={vm.respondentAdvocates} />
          </div>
        </TabsContent>

        <TabsContent value="hearings">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search hearings (date, purpose, judge)…"
                value={hearingSearch} onChange={e => setHearingSearch(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={exportHearings}>
              <Download className="h-3.5 w-3.5" /> Export Excel
            </Button>
          </div>
          {filteredHearings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No hearing history.</p>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Hearing Date</th>
                    <th className="px-3 py-2 font-medium">Business Date</th>
                    <th className="px-3 py-2 font-medium">Purpose</th>
                    <th className="px-3 py-2 font-medium">Judge</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHearings.map((h, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">{fmtDate(h.hearingDate)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtDate(h.businessDate)}</td>
                      <td className="px-3 py-2">{h.purpose || '\u2014'}</td>
                      <td className="px-3 py-2">{h.judge || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          {vm.timeline.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No business timeline available.</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5">
              {vm.timeline.map((b, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                  <p className="text-sm font-semibold">{fmtDate(b.date)}</p>
                  {b.businessNotes && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{b.businessNotes}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {b.nextPurpose && <span>Next Purpose: <span className="text-foreground">{b.nextPurpose}</span></span>}
                    {b.nextHearingDate && <span>Next Hearing: <span className="text-foreground">{fmtDate(b.nextHearingDate)}</span></span>}
                    {b.courtOf && <span>Court Of: <span className="text-foreground">{b.courtOf}</span></span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="disposal">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {vm.disposal.map(c => <SumCard key={c.label} label={c.label} value={c.value} />)}
          </div>
        </TabsContent>

        <TabsContent value="stats">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total Hearings" value={vm.stats.totalHearings} />
            <StatCard label="Total Orders" value={vm.stats.totalOrders} />
            <StatCard label="Total Judgments" value={vm.stats.totalJudgments} />
            <StatCard label="Total Interim Orders" value={vm.stats.totalInterim} />
            <StatCard label="Case Duration (Days)" value={vm.stats.durationDays} />
            <StatCard label="Days to First Hearing" value={vm.stats.daysToFirst} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
