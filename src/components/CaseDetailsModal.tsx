import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DownloadCloud, Loader2, RefreshCw, Scale, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CaseNotesTab } from '@/components/CaseNotesTab';
import { CaseTasksTab } from '@/components/CaseTasksTab';
import { CaseConnectionsTab } from '@/components/CaseConnectionsTab';
import { EcourtsHistoryTab } from '@/components/EcourtsHistoryTab';
import { AiInsightsTab } from '@/components/AiInsightsTab';
import { getEcourtsCaseType } from '@/config/ecourtsCaseTypes';
import { deriveCaseType } from '@/lib/caseType';
import { apiFetch } from '@/lib/apiClient';
import { supabase } from '@/lib/supabase';
import { advocateStatusClasses } from '@/lib/caseManagement';
import {
  recordApiUsage, hasCredits, detectOrganization, fetchActiveOrganizations, NO_CREDITS_MESSAGE,
} from '@/lib/organizations';
import type { CaseStatusHistory } from '@/types';

// ── eCourts response shape ──────────────────────────────────────────────────────

export interface EcourtsCaseData {
  registrationNumber?: string | null;
  registrationDate?: string | null;
  filingNumber?: string | null;
  filingDate?: string | null;
  cnr?: string | null;
  caseStatus?: string | null;
  natureOfDisposal?: string | null;
  courtName?: string | null;
  courtCode?: string | null;
  judicialSection?: string | null;
  caseCategory?: string | null;
  benchType?: string | null;
  stateCode?: string | null;
  districtCode?: string | null;

  petitioners?: string[] | null;
  petitionerAdvocates?: string[] | null;
  respondents?: string[] | null;
  respondentAdvocates?: string[] | null;
  judges?: string[] | null;

  firstHearingDate?: string | null;
  lastHearingDate?: string | null;
  nextHearingDate?: string | null;
  hearingCount?: number | null;
  orderCount?: number | null;
  interimOrderCount?: number | null;
  judgmentCount?: number | null;
  iaCount?: number | null;
}

interface SearchResponse {
  success: boolean;
  totalHits?: number;
  caseData?: EcourtsCaseData | null;
  usedFallback?: boolean;
  rateLimited?: boolean;
  requestId?: string | null;
  message?: string;
}

// ── Caching infrastructure ───────────────────────────────────────────────

export type CacheSource = 'Memory Cache' | 'Local Storage' | 'Supabase Cache' | 'eCourts API';

const MEMORY_TTL   = 15 * 60 * 1000;        // Layer 1 — 15 minutes
const LOCAL_TTL    = 24 * 60 * 60 * 1000;   // Layer 2 — 24 hours
const SUPABASE_TTL = 24 * 60 * 60 * 1000;   // Layer 3 — 24 hours

interface CacheEntry {
  data: EcourtsCaseData;
  fetchedAt: number;
  requestId?: string | null;
}

// Layer 1 — in-memory cache (module scope, shared across modal instances)
const caseDetailsCache = new Map<string, CacheEntry>();

function readMemory(caseNumber: string): CacheEntry | null {
  const cached = caseDetailsCache.get(caseNumber);
  if (cached && Date.now() - cached.fetchedAt < MEMORY_TTL) return cached;
  return null;
}

// Layer 2 — browser localStorage
function localKey(caseNumber: string) {
  return `case_${caseNumber}`;
}

function readLocal(caseNumber: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(localKey(caseNumber));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed?.data && typeof parsed.fetchedAt === 'number'
        && Date.now() - parsed.fetchedAt < LOCAL_TTL) {
      return parsed;
    }
  } catch {
    /* ignore quota / parse / private-mode errors */
  }
  return null;
}

function writeLocal(caseNumber: string, entry: CacheEntry) {
  try {
    localStorage.setItem(localKey(caseNumber), JSON.stringify(entry));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// Layer 3 — Supabase cases table
async function readSupabase(caseId: string): Promise<CacheEntry | null> {
  try {
    const { data, error } = await supabase
      .from('cases')
      .select('case_details_json, case_details_synced_at, ecourts_request_id')
      .eq('id', caseId)
      .maybeSingle();
    if (error || !data?.case_details_json || !data.case_details_synced_at) return null;
    const syncedAt = new Date(data.case_details_synced_at as string).getTime();
    if (Number.isNaN(syncedAt) || Date.now() - syncedAt >= SUPABASE_TTL) return null;
    return {
      data: data.case_details_json as EcourtsCaseData,
      fetchedAt: syncedAt,
      requestId: (data.ecourts_request_id as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

async function writeSupabase(caseId: string, entry: CacheEntry) {
  try {
    await supabase
      .from('cases')
      .update({
        case_details_json: entry.data,
        case_details_synced_at: new Date(entry.fetchedAt).toISOString(),
        ecourts_request_id: entry.requestId ?? null,
      })
      .eq('id', caseId);
  } catch {
    /* best-effort cache write */
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// Read a case's current organization_id (for credit gating / auto-detection).
async function getCaseOrgId(id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('cases').select('organization_id').eq('id', id).maybeSingle();
    return (data?.organization_id as string | null) ?? null;
  } catch {
    return null;
  }
}

// Layer 4 — eCourts API (via serverless proxy) with exponential backoff on 429
async function fetchFromApi(caseNumber: string): Promise<CacheEntry | null> {
  // WP/4232/2024 → caseType="WP", caseNo="4232", caseYear="2024"
  const [caseType = '', caseNo = '', caseYear = ''] = String(caseNumber ?? '').split('/');
  const ecourtsCaseType = getEcourtsCaseType(caseType);

  if (import.meta.env.DEV) {
    console.log({ caseType, ecourtsCaseType, caseNo, caseYear });
  }

  if (!caseNo || !caseYear) return null;

  const MAX_RETRIES = 5;
  let attempt = 0;

  while (true) {
      const response = await apiFetch('/api/case-details/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseNo, caseYear, caseTypes: ecourtsCaseType }),
    });

    // Rate limited → exponential backoff: 1s, 2s, 4s, 8s, 16s
    if (response.status === 429) {
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        throw new Error('Unable to retrieve case details. Please try again later.');
      }
      await sleep(2 ** (attempt - 1) * 1000);
      continue;
    }

    const result: SearchResponse = await response.json();

    if (!result.success) {
      if (result.rateLimited) {
        attempt += 1;
        if (attempt > MAX_RETRIES) {
          throw new Error('Unable to retrieve case details. Please try again later.');
        }
        await sleep(2 ** (attempt - 1) * 1000);
        continue;
      }
      throw new Error(result.message || 'Failed to fetch case details.');
    }

    if (!result.totalHits || !result.caseData) return null;

    if (import.meta.env.DEV) {
      console.log('Case Details');
      console.log(result.caseData);
    }

    return { data: result.caseData, fetchedAt: Date.now(), requestId: result.requestId ?? null };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDate(value: string | null | undefined) {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function val(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '\u2014';
  const s = String(value).trim();
  return s ? s : '\u2014';
}

function num(value: number | null | undefined) {
  return typeof value === 'number' ? value : 0;
}

const EMPTY_VALUE_TOKENS = new Set(['', '\u2014', '-', 'null', 'undefined', 'n/a', 'na', 'none']);
function isEmptyValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return EMPTY_VALUE_TOKENS.has(String(value).trim().toLowerCase());
}

// Trimmed string or null (for nullable text columns)
function strOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

// Join an array of parties/advocates into a comma-separated string (or null)
function joinList(items: Array<string | number> | null | undefined): string | null {
  if (!items || items.length === 0) return null;
  const s = items.map(x => String(x).trim()).filter(Boolean).join(', ');
  return s || null;
}

// Normalise an eCourts date to YYYY-MM-DD (safe for date OR text columns), else null
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      <span className="h-3.5 w-1 rounded-full bg-primary/60" aria-hidden="true" />
      {children}
    </h3>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="transition-shadow duration-200 hover:shadow-card-hover">
      <CardContent className="p-4 sm:p-5">
        <SectionTitle>{title}</SectionTitle>
        {children}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const empty = isEmptyValue(value);
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{label}</dt>
      <dd className={empty ? 'text-sm italic text-muted-foreground/60' : 'text-[0.9375rem] font-semibold leading-snug text-foreground'}>
        {empty ? 'Not available' : value}
      </dd>
    </div>
  );
}

function PartyList({ items }: { items: Array<string | number> | null | undefined }) {
  if (!items || items.length === 0) return <p className="text-sm italic text-muted-foreground/60">No information available</p>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={`${String(item)}-${i}`} className="text-[0.9375rem] font-medium text-foreground">{String(item)}</li>
      ))}
    </ul>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="bg-gradient-to-br from-slate-50 to-white">
      <CardContent className="px-3 py-3.5 text-center">
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

// Case History timeline (built from the eCourts case data) ──────────────────────
function CaseHistorySection({ caseData }: { caseData: EcourtsCaseData }) {
  const events = [
    { label: 'Case Filed', date: caseData.filingDate },
    { label: 'Case Registered', date: caseData.registrationDate },
    { label: 'First Hearing', date: caseData.firstHearingDate },
    { label: 'Last Hearing', date: caseData.lastHearingDate },
    { label: 'Next Hearing', date: caseData.nextHearingDate },
  ].filter(e => !!e.date);

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Timeline</SectionTitle>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dated events available.</p>
        ) : (
          <ol className="relative ml-2 space-y-4 border-l pl-5">
            {events.map((e, i) => (
              <li key={`${e.label}-${i}`} className="relative">
                <span className="absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-sm font-medium">{e.label}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(e.date)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <SectionTitle>Activity Summary</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Hearings" value={num(caseData.hearingCount)} />
          <StatCard label="Orders" value={num(caseData.orderCount)} />
          <StatCard label="Interim Orders" value={num(caseData.interimOrderCount)} />
          <StatCard label="Judgments" value={num(caseData.judgmentCount)} />
          <StatCard label="IAs" value={num(caseData.iaCount)} />
        </div>
      </section>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────────

interface CaseDetailsModalProps {
  caseNumber: string | null;
  caseId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show the "Sync Case" button (Cases page only — cases is the master record). */
  allowSync?: boolean;
  /** Called after a successful sync so the host can refresh its table row. */
  onSynced?: () => void;
  /** Which tab to open initially (e.g. 'connected' from the Cases list count). */
  initialTab?: string;
}

export function CaseDetailsModal({
  caseNumber, caseId, open, onOpenChange, allowSync = false, onSynced, initialTab = 'overview',
}: CaseDetailsModalProps) {
  const queryClient = useQueryClient();
  const [loadingApi, setLoadingApi] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<EcourtsCaseData | null>(null);
  const [source, setSource] = useState<CacheSource | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [summary, setSummary] = useState<{ connections: number; openTasks: number; notes: number } | null>(null);
  const [viewCase, setViewCase] = useState<{ id: string; number: string | null } | null>(null);
  const [internal, setInternal] = useState<{ courtStatus: string | null; advocateStatus: string | null; organizationId: string | null } | null>(null);
  const [statusHistory, setStatusHistory] = useState<CaseStatusHistory[]>([]);

  const loadInternalStatus = useCallback(async (id: string) => {
    try {
      const [caseRes, histRes] = await Promise.all([
        supabase.from('cases').select('case_status, advocate_status, organization_id').eq('id', id).maybeSingle(),
        supabase.from('case_status_history').select('*').eq('case_id', id).order('changed_at', { ascending: false }),
      ]);
      setInternal({
        courtStatus: (caseRes.data?.case_status as string | null) ?? null,
        advocateStatus: (caseRes.data?.advocate_status as string | null) ?? null,
        organizationId: (caseRes.data?.organization_id as string | null) ?? null,
      });
      setStatusHistory(histRes.error ? [] : ((histRes.data ?? []) as CaseStatusHistory[]));
    } catch {
      setInternal(null);
      setStatusHistory([]);
    }
  }, []);

  const loadSummary = useCallback(async (id: string) => {
    try {
      const [conn, tasks, notes] = await Promise.all([
        supabase.from('case_connections').select('id', { count: 'exact', head: true })
          .or(`parent_case_id.eq.${id},connected_case_id.eq.${id}`),
        supabase.from('case_tasks').select('id', { count: 'exact', head: true })
          .eq('case_id', id).neq('task_status', 'Completed'),
        supabase.from('case_notes').select('id', { count: 'exact', head: true }).eq('case_id', id),
      ]);
      setSummary({
        connections: conn.count ?? 0,
        openTasks: tasks.count ?? 0,
        notes: notes.count ?? 0,
      });
    } catch {
      setSummary(null);
    }
  }, []);

  const load = useCallback(async (rawCaseNumber: string, id: string | null | undefined, forceRefresh: boolean) => {
    const key = String(rawCaseNumber ?? '').trim();
    setError(null);
    setCaseData(null);
    setSource(null);

    if (!key) {
      setError('Case details not found.');
      return;
    }

    // ── Cache layers (skipped on a forced refresh) ──
    if (!forceRefresh) {
      // Layer 1 — memory
      const mem = readMemory(key);
      if (mem) {
        setCaseData(mem.data);
        setSource('Memory Cache');
        return;
      }
      // Layer 2 — localStorage
      const local = readLocal(key);
      if (local) {
        caseDetailsCache.set(key, local); // hydrate memory
        setCaseData(local.data);
        setSource('Local Storage');
        return;
      }
      // Layer 3 — Supabase
      if (id) {
        setLoadingCached(true);
        const sb = await readSupabase(id);
        setLoadingCached(false);
        if (sb) {
          caseDetailsCache.set(key, sb);
          writeLocal(key, sb);
          setCaseData(sb.data);
          setSource('Supabase Cache');
          return;
        }
      }
    }

    // ── Layer 4 — eCourts API ──
    const apiOrgId = id ? await getCaseOrgId(id) : null;
    if (!(await hasCredits(apiOrgId))) {
      setError(NO_CREDITS_MESSAGE);
      return;
    }
    setLoadingApi(true);
    try {
      const entry = await fetchFromApi(key);
      if (!entry) {
        setError('Case details not found.');
        return;
      }
      caseDetailsCache.set(key, entry);
      writeLocal(key, entry);
      if (id) writeSupabase(id, entry);
      setCaseData(entry.data);
      setSource('eCourts API');
      // Paid Case Details flow consumes CASE_SEARCH → CASE_DETAIL.
      recordApiUsage({ organizationId: apiOrgId, caseId: id, endpoint: 'CASE_SEARCH', requestId: entry.requestId, cnr: key });
      recordApiUsage({ organizationId: apiOrgId, caseId: id, endpoint: 'CASE_DETAIL', requestId: entry.requestId, cnr: key });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retrieve case details. Please try again later.');
    } finally {
      setLoadingApi(false);
    }
  }, []);

  // ── Sync Case: fetch fresh from eCourts and persist to the cases master record ──
  const handleSync = useCallback(async () => {
    const key = String(caseNumber ?? '').trim();
    if (!key || !caseId) {
      toast.error('Unable to synchronize case details.');
      return;
    }

    const existingOrgId = await getCaseOrgId(caseId);
    if (!(await hasCredits(existingOrgId))) {
      toast.error(NO_CREDITS_MESSAGE);
      return;
    }

    setSyncing(true);
    setError(null);
    console.log('[Sync] ▶ start', { caseId, caseNumber: key });
    try {
      // Step 1 — fresh case details from eCourts (bypasses all cache layers)
      const entry = await fetchFromApi(key);
      if (!entry) throw new Error('Case record not found.');

      const cd = entry.data;

      // Step 2 — map API response → cases columns and UPDATE only this record.
      // NOTE: id / organization_id / case_number are deliberately NEVER written.
      // court_name is intentionally NOT updated — the Cases page is scoped by
      // `.eq('court_name', 'Principal Bench of Madras High Court')`, so overwriting
      // it with the eCourts court string would push the row out of that filtered
      // view and make it "disappear" from the table.
      const update: Record<string, unknown> = {
        case_status: strOrNull(cd.caseStatus),
        case_type: deriveCaseType(key),
        cnr_number: strOrNull(cd.cnr),
        section: strOrNull(cd.judicialSection),
        petitioner: joinList(cd.petitioners),
        respondent: joinList(cd.respondents),
        advocate_name: joinList(cd.petitionerAdvocates),
        last_hearing_date: toIsoDate(cd.lastHearingDate),
        next_hearing_date: toIsoDate(cd.nextHearingDate),
        last_hearing_update:
          `${strOrNull(cd.caseStatus) ?? '\u2014'}\nLast Hearing:\n${strOrNull(cd.lastHearingDate) ?? '\u2014'}\nNext Hearing:\n${strOrNull(cd.nextHearingDate) ?? '\u2014'}`,
        case_details_json: cd,
        case_details_synced_at: new Date(entry.fetchedAt).toISOString(),
        ecourts_request_id: entry.requestId ?? null,
      };
      // Nature of disposal — only when the API provides it
      const disposal = strOrNull(cd.natureOfDisposal);
      if (disposal) update.nature_of_disposal = disposal;

      // Automatic organization detection from party names. A manually-set
      // organization_id (existingOrgId) always wins and is never overwritten.
      let syncOrgId = existingOrgId;
      if (!syncOrgId) {
        const orgs = await fetchActiveOrganizations();
        const detected = detectOrganization(
          [...(cd.petitioners ?? []), ...(cd.respondents ?? []), ...(cd.petitionerAdvocates ?? []), ...(cd.respondentAdvocates ?? [])],
          orgs,
        );
        if (detected) { syncOrgId = detected; update.organization_id = detected; }
      }

      console.log('[Sync] payload (UPDATE only, .eq id)', { caseId, update });

      // UPDATE-ONLY: never insert / upsert / delete. `.select()` returns the
      // updated row so we can confirm exactly one record changed (an empty array
      // would indicate RLS/permission blocked the write, not a delete).
      const { data: updatedRows, error: updateError } = await supabase
        .from('cases')
        .update(update)
        .eq('id', caseId)
        .select('id, case_number, court_name, case_status, case_details_synced_at');

      console.log('[Sync] Supabase response', { updatedRows, updateError });

      if (updateError) throw updateError;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('No record updated — check RLS/permissions or that the id exists.');
      }

      // Refresh caches + modal data without a page reload
      caseDetailsCache.set(key, entry);
      writeLocal(key, entry);
      setCaseData(cd);
      setSource('eCourts API');
      await queryClient.invalidateQueries();
      onSynced?.();
      if (caseId) loadInternalStatus(caseId);

      // Record the paid eCourts flow (CASE_SEARCH → CASE_DETAIL) and deduct credits.
      recordApiUsage({ organizationId: syncOrgId, caseId, endpoint: 'CASE_SEARCH', requestId: entry.requestId, cnr: key });
      recordApiUsage({ organizationId: syncOrgId, caseId, endpoint: 'CASE_DETAIL', requestId: entry.requestId, cnr: key });
      recordApiUsage({ organizationId: syncOrgId, caseId, endpoint: 'CASE_REFRESH', requestId: entry.requestId, cnr: key });

      // Verification re-fetch — confirms the record still exists & is visible.
      const { data: verifyRow, error: verifyError } = await supabase
        .from('cases')
        .select('id, case_number, court_name, case_status, case_details_synced_at')
        .eq('id', caseId)
        .maybeSingle();
      console.log('[Sync] ✔ verification re-fetch', { verifyRow, verifyError });
      console.log('[Sync] ◼ done', { caseId });

      toast.success('Case synchronized successfully.');
    } catch (err) {
      console.error('[Sync] ✖ failed', { caseId, error: err });
      toast.error('Unable to synchronize case details.');
    } finally {
      setSyncing(false);
    }
  }, [caseNumber, caseId, queryClient, onSynced, loadInternalStatus]);

  useEffect(() => {
    if (open && caseNumber) {
      load(caseNumber, caseId, false);
    }
  }, [open, caseNumber, caseId, load]);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      if (caseId) { loadSummary(caseId); loadInternalStatus(caseId); }
      else { setSummary(null); setInternal(null); setStatusHistory([]); }
    }
  }, [open, caseId, initialTab, loadSummary, loadInternalStatus]);

  const refreshing = (loadingApi || loadingCached) && source === null;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        onOpenChange(o);
        if (!o) { setCaseData(null); setError(null); setSource(null); }
      }}
    >
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[90vw] flex-col overflow-hidden p-0 sm:max-w-[1100px]">
        {/* ── Fixed workspace header (z-30) ── */}
        <div className="relative z-30 shrink-0 border-b border-border/70 bg-gradient-to-br from-slate-50 to-white px-4 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2.5 pr-8">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Scale className="h-[1.1rem] w-[1.1rem]" />
              </span>
              <span className="font-mono text-lg font-bold tracking-tight sm:text-2xl">{val(caseData?.registrationNumber) === '\u2014' ? caseNumber : caseData?.registrationNumber}</span>
              {caseData?.caseStatus && (
                <Badge variant={String(caseData.caseStatus).toLowerCase() === 'pending' ? 'warning' : 'secondary'}>
                  {caseData.caseStatus}
                </Badge>
              )}
              {caseData?.courtName && (
                <span className="text-[15px] font-medium text-muted-foreground">{caseData.courtName}</span>
              )}
              {import.meta.env.DEV && source && (
                <Badge variant="info" className="text-[10px]">Source: {source}</Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={loadingApi || loadingCached || syncing || !caseNumber}
                  onClick={() => caseNumber && load(caseNumber, caseId, true)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh Data
                </Button>
                {allowSync && caseId && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={syncing || loadingApi || loadingCached || !caseNumber}
                    onClick={handleSync}
                  >
                    {syncing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <DownloadCloud className="h-3.5 w-3.5" />}
                    {syncing ? 'Synchronizing...' : 'Sync Case'}
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {syncing && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/70 bg-white/70 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Synchronizing case details...
            </div>
          )}

          {caseId && summary && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                Connected Cases <strong className="tabular-nums">{summary.connections}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Open Tasks <strong className="tabular-nums">{summary.openTasks}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                Notes <strong className="tabular-nums">{summary.notes}</strong>
              </span>
            </div>
          )}
        </div>

        {/* ── Sticky tab bar (z-20) + scrollable body — flex siblings, no overlap ── */}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="relative z-20 shrink-0 border-b border-border/70 bg-background px-4 py-2.5 sm:px-6">
            <TabsList className="flex w-full justify-start gap-1 overflow-x-auto">
              <TabsTrigger value="overview">Case Information</TabsTrigger>
              <TabsTrigger value="ecourts">Hearing History</TabsTrigger>
              <TabsTrigger value="history">Case History</TabsTrigger>
              <TabsTrigger value="ai" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                AI Insights
              </TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="connected">Connected Cases</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto scroll-smooth px-4 py-5 sm:px-6">
          <TabsContent value="overview" className="mt-0 space-y-6">
        {/* CLA Internal Status — always shown (independent of eCourts data) */}
        {internal && (
          <InfoCard title="Status">
           <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Court Status</p>
                <p className="mt-1.5">
                  {internal.courtStatus
                    ? <Badge variant={String(internal.courtStatus).toLowerCase() === 'pending' ? 'warning' : 'secondary'}>{internal.courtStatus}</Badge>
                    : <span className="text-sm italic text-muted-foreground/60">Not available</span>}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">From court systems (eCourts / MHC)</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Advocate Status</p>
                <p className="mt-1.5">
                  {internal.advocateStatus
                    ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${advocateStatusClasses(internal.advocateStatus)}`}>{internal.advocateStatus}</span>
                    : <span className="text-sm italic text-muted-foreground/60">Not available</span>}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">Internal CLA / advocate progress</p>
              </div>
            </div>

            {statusHistory.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Advocate Status Timeline</p>
                <ol className="relative space-y-3 border-l border-muted pl-4">
                  {statusHistory.map(h => (
                    <li key={h.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-background" />
                      <p className="text-xs font-semibold text-muted-foreground">{fmtDate(h.changed_at)}</p>
                      <p className="text-sm font-medium">
                        {h.old_status ? <span className="text-muted-foreground">{h.old_status}{' \u2192 '}</span> : null}
                        {h.new_status ?? 'Not available'}
                      </p>
                      {h.remarks && <p className="text-xs text-muted-foreground">{h.remarks}</p>}
                      {h.changed_by && <p className="text-[11px] text-muted-foreground">by {h.changed_by}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
           </div>
          </InfoCard>
        )}

        {(loadingApi || loadingCached) && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingCached ? 'Loading cached case details...' : 'Loading case details...'}
          </div>
        )}

        {!loadingApi && !loadingCached && error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loadingApi && !loadingCached && !error && caseData && (
          <div className="space-y-4">
            {/* Basic Information */}
            <InfoCard title="Basic Information">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                <Detail label="Case Type" value={val(deriveCaseType(caseNumber ?? ''))} />
                <Detail label="Registration Number" value={val(caseData.registrationNumber)} />
                <Detail label="Registration Date" value={fmtDate(caseData.registrationDate)} />
                <Detail label="Filing Number" value={val(caseData.filingNumber)} />
                <Detail label="Filing Date" value={fmtDate(caseData.filingDate)} />
                <Detail label="Case Status" value={val(caseData.caseStatus)} />
                <Detail label="Court Name" value={val(caseData.courtName)} />
                <Detail label="Court Code" value={val(caseData.courtCode)} />
                <Detail label="Judicial Section" value={val(caseData.judicialSection)} />
                <Detail label="Case Category" value={val(caseData.caseCategory)} />
                <Detail label="Bench Type" value={val(caseData.benchType)} />
              </dl>
            </InfoCard>

            {/* Parties */}
            <InfoCard title="Parties">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Petitioners</p>
                  <PartyList items={caseData.petitioners} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Petitioner Advocates</p>
                  <PartyList items={caseData.petitionerAdvocates} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Respondents</p>
                  <PartyList items={caseData.respondents} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Respondent Advocates</p>
                  <PartyList items={caseData.respondentAdvocates} />
                </div>
              </div>
            </InfoCard>

            {/* Judge Information */}
            <InfoCard title="Judge Information">
              <PartyList items={caseData.judges} />
            </InfoCard>

            {/* Hearing Information */}
            <InfoCard title="Hearing Information">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Detail label="First Hearing Date" value={fmtDate(caseData.firstHearingDate)} />
                <Detail label="Last Hearing Date" value={fmtDate(caseData.lastHearingDate)} />
                <Detail label="Next Hearing Date" value={fmtDate(caseData.nextHearingDate)} />
                <Detail label="Hearing Count" value={String(num(caseData.hearingCount))} />
              </dl>
            </InfoCard>

            {/* Statistics */}
            <InfoCard title="Statistics">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard label="Hearing Count" value={num(caseData.hearingCount)} />
                <StatCard label="Order Count" value={num(caseData.orderCount)} />
                <StatCard label="Interim Order Count" value={num(caseData.interimOrderCount)} />
                <StatCard label="Judgment Count" value={num(caseData.judgmentCount)} />
                <StatCard label="IA Count" value={num(caseData.iaCount)} />
              </div>
            </InfoCard>

            {/* Court Information */}
            <InfoCard title="Court Information">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Detail label="Court Code" value={val(caseData.courtCode)} />
                <Detail label="Court Name" value={val(caseData.courtName)} />
                <Detail label="State Code" value={val(caseData.stateCode)} />
                <Detail label="District Code" value={val(caseData.districtCode)} />
              </dl>
            </InfoCard>
          </div>
        )}
          </TabsContent>

          <TabsContent value="notes">
            <CaseNotesTab caseId={caseId} />
          </TabsContent>

          <TabsContent value="tasks">
            <CaseTasksTab caseId={caseId} caseNumber={caseNumber} />
          </TabsContent>

          <TabsContent value="connected">
            <CaseConnectionsTab
              caseId={caseId}
              orgId={internal?.organizationId ?? null}
              onOpenCase={(id, number) => setViewCase({ id, number })}
              onCountChange={n => setSummary(s => (s && s.connections !== n ? { ...s, connections: n } : s))}
            />
          </TabsContent>

          <TabsContent value="history">
            {(loadingApi || loadingCached) ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading case history...
              </div>
            ) : caseData ? (
              <CaseHistorySection caseData={caseData} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No case history available. Use “Refresh Data” to load from eCourts.
              </p>
            )}
          </TabsContent>

          <TabsContent value="ecourts">
            <EcourtsHistoryTab caseId={caseId} fallbackCnr={caseData?.cnr} />
          </TabsContent>

          <TabsContent value="ai">
            <AiInsightsTab caseId={caseId} caseNumber={caseNumber} caseData={caseData} />
          </TabsContent>
          </div>
        </Tabs>
      </DialogContent>

      {viewCase && (
        <CaseDetailsModal
          caseNumber={viewCase.number}
          caseId={viewCase.id}
          open={!!viewCase}
          onOpenChange={o => { if (!o) setViewCase(null); }}
          initialTab="overview"
        />
      )}
    </Dialog>
  );
}
