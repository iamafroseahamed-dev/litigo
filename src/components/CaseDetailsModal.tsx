import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { getEcourtsCaseType } from '@/config/ecourtsCaseTypes';
import { supabase } from '@/lib/supabase';

// ── eCourts response shape ──────────────────────────────────────────────────────

export interface EcourtsCaseData {
  registrationNumber?: string | null;
  registrationDate?: string | null;
  filingNumber?: string | null;
  filingDate?: string | null;
  caseStatus?: string | null;
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

// ── Modal ────────────────────────────────────────────────────────────────────────

interface CaseDetailsModalProps {
  caseNumber: string | null;
  caseId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CaseDetailsModal({ caseNumber, caseId, open, onOpenChange }: CaseDetailsModalProps) {
  const [loadingApi, setLoadingApi] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
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
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1 text-xs"
              disabled={loadingApi || loadingCached || !caseNumber}
              onClick={() => caseNumber && load(caseNumber, caseId, true)}
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Case Details
            </Button>
          </DialogTitle>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
