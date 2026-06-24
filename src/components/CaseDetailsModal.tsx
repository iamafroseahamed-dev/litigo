import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DownloadCloud, Loader2, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CaseNotesTab } from '@/components/CaseNotesTab';
import { CaseTasksTab } from '@/components/CaseTasksTab';
import { getEcourtsCaseType } from '@/config/ecourtsCaseTypes';
import { supabase } from '@/lib/supabase';

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
    const response = await fetch('/api/case-details/search', {
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
    <h3 className="mb-3 border-b pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function PartyList({ items }: { items: Array<string | number> | null | undefined }) {
  if (!items || items.length === 0) return <p className="text-sm text-muted-foreground">\u2014</p>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={`${String(item)}-${i}`} className="text-sm font-medium">{String(item)}</li>
      ))}
    </ul>
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
}

export function CaseDetailsModal({
  caseNumber, caseId, open, onOpenChange, allowSync = false, onSynced,
}: CaseDetailsModalProps) {
  const queryClient = useQueryClient();
  const [loadingApi, setLoadingApi] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseData, setCaseData] = useState<EcourtsCaseData | null>(null);
  const [source, setSource] = useState<CacheSource | null>(null);

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
  }, [caseNumber, caseId, queryClient, onSynced]);

  useEffect(() => {
    if (open && caseNumber) {
      load(caseNumber, caseId, false);
    }
  }, [open, caseNumber, caseId, load]);

  const refreshing = (loadingApi || loadingCached) && source === null;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        onOpenChange(o);
        if (!o) { setCaseData(null); setError(null); setSource(null); }
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-[1200px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="font-mono">{val(caseData?.registrationNumber) === '\u2014' ? caseNumber : caseData?.registrationNumber}</span>
            {caseData?.caseStatus && (
              <Badge variant={String(caseData.caseStatus).toLowerCase() === 'pending' ? 'warning' : 'secondary'}>
                {caseData.caseStatus}
              </Badge>
            )}
            {caseData?.courtName && (
              <span className="text-sm font-normal text-muted-foreground">{caseData.courtName}</span>
            )}
            {import.meta.env.DEV && source && (
              <Badge variant="info" className="text-[10px]">Source: {source}</Badge>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={loadingApi || loadingCached || syncing || !caseNumber}
                onClick={() => caseNumber && load(caseNumber, caseId, true)}
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh Data
              </Button>
              {allowSync && caseId && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={syncing || loadingApi || loadingCached || !caseNumber}
                  onClick={handleSync}
                >
                  {syncing
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <DownloadCloud className="h-3 w-3" />}
                  {syncing ? 'Synchronizing...' : 'Sync Case'}
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {syncing && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Synchronizing case details...
          </div>
        )}

        <Tabs defaultValue="overview" className="mt-1">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="history">Case History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
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
          <div className="space-y-6">
            {/* Basic Information */}
            <section>
              <SectionTitle>Basic Information</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
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
            </section>

            {/* Parties */}
            <section>
              <SectionTitle>Parties</SectionTitle>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Petitioners</p>
                  <PartyList items={caseData.petitioners} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Petitioner Advocates</p>
                  <PartyList items={caseData.petitionerAdvocates} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Respondents</p>
                  <PartyList items={caseData.respondents} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Respondent Advocates</p>
                  <PartyList items={caseData.respondentAdvocates} />
                </div>
              </div>
            </section>

            {/* Judge Information */}
            <section>
              <SectionTitle>Judge Information</SectionTitle>
              <PartyList items={caseData.judges} />
            </section>

            {/* Hearing Information */}
            <section>
              <SectionTitle>Hearing Information</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Detail label="First Hearing Date" value={fmtDate(caseData.firstHearingDate)} />
                <Detail label="Last Hearing Date" value={fmtDate(caseData.lastHearingDate)} />
                <Detail label="Next Hearing Date" value={fmtDate(caseData.nextHearingDate)} />
                <Detail label="Hearing Count" value={String(num(caseData.hearingCount))} />
              </dl>
            </section>

            {/* Statistics */}
            <section>
              <SectionTitle>Statistics</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatCard label="Hearing Count" value={num(caseData.hearingCount)} />
                <StatCard label="Order Count" value={num(caseData.orderCount)} />
                <StatCard label="Interim Order Count" value={num(caseData.interimOrderCount)} />
                <StatCard label="Judgment Count" value={num(caseData.judgmentCount)} />
                <StatCard label="IA Count" value={num(caseData.iaCount)} />
              </div>
            </section>

            {/* Court Information */}
            <section>
              <SectionTitle>Court Information</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Detail label="Court Code" value={val(caseData.courtCode)} />
                <Detail label="Court Name" value={val(caseData.courtName)} />
                <Detail label="State Code" value={val(caseData.stateCode)} />
                <Detail label="District Code" value={val(caseData.districtCode)} />
              </dl>
            </section>
          </div>
        )}
          </TabsContent>

          <TabsContent value="notes">
            <CaseNotesTab caseId={caseId} />
          </TabsContent>

          <TabsContent value="tasks">
            <CaseTasksTab caseId={caseId} caseNumber={caseNumber} />
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
