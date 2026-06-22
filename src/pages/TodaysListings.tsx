import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChevronLeft, ChevronRight, Eye, FileText, Loader2, RefreshCw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TodayMatchedListing } from '@/types';

type CaseDetails = {
  caseNumber: string;
  cnrNumber: string;
  petitioner: string;
  respondent: string;
  courtHall: string;
  judge: string;
  stageStatus: string;
  prayer: string;
  hearingHistory: Array<{ date: string; purpose: string; stage: string; remarks: string }>;
  orders: Array<{ orderDate: string; orderNumber: string; orderType: string }>;
};

type EcourtsCaseDetailsResponse = {
  success: boolean;
  cnr_number?: string;
  case_number?: string;
  summary_fields?: Record<string, string>;
  tables?: Array<{ title?: string; headers?: string[]; rows?: string[][] }>;
  text?: string;
  detail?: string;
  message?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

type SortField = 'listed_date' | 'court_hall' | 'item_number' | 'case_number';
type SortDir   = 'asc' | 'desc';

const PAGE_SIZE = 20;

function NotifBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
    pending:       { label: 'Pending',       variant: 'warning'     },
    notified:      { label: 'Notified',      variant: 'success'     },
    partial:       { label: 'Partial',       variant: 'warning'     },
    failed:        { label: 'Failed',        variant: 'destructive' },
    no_recipients: { label: 'No Recipients', variant: 'outline'     },
    not_notified:  { label: 'Pending',       variant: 'secondary'   },
  };
  const entry = map[status ?? ''];
  if (!entry) return null;
  return <Badge variant={entry.variant} className="text-[10px] whitespace-nowrap">{entry.label}</Badge>;
}

function SummaryCard({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TodaysListingsPage() {
  const [loading, setLoading]             = useState(true);
  const [error,   setError]               = useState<string | null>(null);
  const [listings, setListings]           = useState<TodayMatchedListing[]>([]);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [listingHistoryMap, setListingHistoryMap] = useState<
    Map<string, { count: number; firstListed: string; lastListed: string }>
  >(new Map());

  // ── Filters ──────────────────────────────────────────────────────────────────
  const todayUtc = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [listedDateFrom, setListedDateFrom] = useState<string>(todayUtc);
  const [listedDateTo,   setListedDateTo  ] = useState<string>(todayUtc);
  const [filterCaseNumber, setFilterCaseNumber] = useState('');
  const [filterCnr,        setFilterCnr       ] = useState('');
  const [filterJudge,      setFilterJudge      ] = useState('');
  const [sortField, setSortField] = useState<SortField>('court_hall');
  const [sortDir,   setSortDir  ] = useState<SortDir>('asc');
  const [page, setPage]           = useState(1);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<TodayMatchedListing | null>(null);
  const [caseDetails, setCaseDetails] = useState<CaseDetails | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaText, setCaptchaText] = useState('');

  // ── Data loading ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = listedDateFrom || todayUtc;
      const to   = listedDateTo   || todayUtc;

      const { data, error: sbErr } = await supabase
        .from('today_matched_listings')
        .select(`
          *,
          case:cases(
            id, cnr_number, case_number, district, section,
            cla_party_status, sensitivity, case_status
          )
        `)
        .gte('listed_date', from)
        .lte('listed_date', to)
        .order('listed_date', { ascending: false })
        .order('court_hall',  { ascending: true  })
        .order('item_number', { ascending: true  });

      if (sbErr) throw sbErr;
      const rows = (data ?? []) as TodayMatchedListing[];
      setListings(rows);

      // Listing-history counts
      if (rows.length > 0) {
        const caseIds = [...new Set(rows.map(r => r.case_id).filter(Boolean))];
        const { data: histData } = await supabase
          .from('today_matched_listings')
          .select('case_id,listed_date')
          .in('case_id', caseIds);

        const hmap = new Map<string, { count: number; firstListed: string; lastListed: string }>();
        for (const row of histData ?? []) {
          const cid = row.case_id as string;
          const d   = row.listed_date as string;
          const ex  = hmap.get(cid);
          if (ex) {
            ex.count++;
            if (d < ex.firstListed) ex.firstListed = d;
            if (d > ex.lastListed)  ex.lastListed  = d;
          } else {
            hmap.set(cid, { count: 1, firstListed: d, lastListed: d });
          }
        }
        setListingHistoryMap(hmap);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [listedDateFrom, listedDateTo, todayUtc]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const judgeOptions = useMemo(
    () => [...new Set(listings.map(r => r.judge_name).filter(Boolean))].sort() as string[],
    [listings],
  );

  const filtered = useMemo(() => {
    let rows = listings;
    if (filterJudge) rows = rows.filter(r => r.judge_name === filterJudge);
    if (filterCaseNumber.trim()) {
      const q = filterCaseNumber.trim().toLowerCase();
      rows = rows.filter(r => (r.case_number ?? '').toLowerCase().includes(q));
    }
    if (filterCnr.trim()) {
      const q = filterCnr.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.cnr_number ?? '').toLowerCase().includes(q) ||
        (r.case?.cnr_number ?? '').toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      let av = '', bv = '';
      switch (sortField) {
        case 'listed_date':       av = a.listed_date ?? a.match_date ?? '';           bv = b.listed_date ?? b.match_date ?? '';           break;
        case 'court_hall':        av = a.court_hall ?? '';                            bv = b.court_hall ?? '';                            break;
        case 'item_number':       av = a.item_number ?? '';                           bv = b.item_number ?? '';                           break;
        case 'case_number':       av = a.case_number ?? '';                           bv = b.case_number ?? '';                           break;
      }
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [listings, filterJudge, filterCaseNumber, filterCnr, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = filterCaseNumber || filterCnr || filterJudge ||
    listedDateFrom !== todayUtc || listedDateTo !== todayUtc;

  function clearFilters() {
    setFilterCaseNumber(''); setFilterCnr(''); setFilterJudge('');
    setListedDateFrom(todayUtc); setListedDateTo(todayUtc);
    setPage(1);
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="ml-1 text-muted-foreground/40">&#8597;</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
  }

  function mapEcourtsToCaseDetails(
    record: TodayMatchedListing,
    data: EcourtsCaseDetailsResponse,
  ): CaseDetails {
    const summary = data.summary_fields ?? {};
    const tables = data.tables ?? [];

    const hearingTable = tables.find(t =>
      (t.title ?? '').toLowerCase().includes('history of case hearing'),
    );
    const hearingHeaders = (hearingTable?.headers ?? []).map(h => h.toLowerCase());
    const hearingRows = hearingTable?.rows ?? [];

    const idx = (headers: string[], keys: string[], fallback: number) => {
      for (const key of keys) {
        const i = headers.findIndex(h => h.includes(key));
        if (i >= 0) return i;
      }
      return fallback;
    };

    const dateIdx = idx(hearingHeaders, ['hearing date', 'date'], 3);
    const purposeIdx = idx(hearingHeaders, ['purpose', 'business'], 4);
    const stageIdx = idx(hearingHeaders, ['cause list type', 'stage'], 0);
    const remarksIdx = idx(hearingHeaders, ['remarks', 'remark'], -1);

    const hearingHistory = hearingRows.map((r) => ({
      date: r[dateIdx] ?? '',
      purpose: r[purposeIdx] ?? '',
      stage: r[stageIdx] ?? '',
      remarks: remarksIdx >= 0 ? (r[remarksIdx] ?? '') : '',
    })).filter(h => h.date || h.purpose || h.stage || h.remarks);

    const ordersTable = tables.find(t => (t.title ?? '').toLowerCase() === 'orders');
    const orderHeaders = (ordersTable?.headers ?? []).map(h => h.toLowerCase());
    const orderRows = ordersTable?.rows ?? [];
    const orderDateIdx = idx(orderHeaders, ['order date', 'order on'], 3);
    const orderNumberIdx = idx(orderHeaders, ['order no', 'order number'], 0);
    const orderTypeIdx = idx(orderHeaders, ['order type', 'type'], -1);
    const orders = orderRows.map((r) => ({
      orderDate: r[orderDateIdx] ?? '',
      orderNumber: r[orderNumberIdx] ?? '',
      orderType: orderTypeIdx >= 0 ? (r[orderTypeIdx] ?? '') : '',
    })).filter(o => o.orderDate || o.orderNumber || o.orderType);

    const prayerFromSummary = summary['Prayer'] || summary['Prayer / Relief'] || '';
    const prayerFromText = data.text?.match(/prayer\s*[:\-]?\s*(.+?)(?:\n\s*\n|history of case hearing|orders|$)/is)?.[1] ?? '';

    return {
      caseNumber: data.case_number || summary['Registration Number'] || summary['Case Number'] || record.case_number || record.case?.case_number || '',
      cnrNumber: data.cnr_number || summary['CNR Number'] || record.case?.cnr_number || record.cnr_number || '',
      petitioner: summary['Petitioner'] || record.petitioner || record.case?.petitioner || '',
      respondent: summary['Respondent'] || record.respondent || record.case?.respondent || '',
      courtHall: summary['Court Hall'] || summary['Court'] || record.court_hall || '',
      judge: summary['Coram'] || summary['Judge'] || record.judge_name || '',
      stageStatus: summary['Stage of Case'] || summary['Case Status'] || record.stage || '',
      prayer: prayerFromSummary || prayerFromText || '',
      hearingHistory,
      orders,
    };
  }

  async function loadCaseDetailsFallback(record: TodayMatchedListing): Promise<boolean> {
    let cnr = record.case?.cnr_number ?? record.cnr_number ?? '';
    const caseNumber = record.case_number ?? record.case?.case_number ?? '';

    if (!cnr) {
      const lookupRes = await fetch('/api/lookup-cnr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: caseNumber }),
      });
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok || !lookupData?.success || !lookupData?.cnr_number) {
        setDetailsError(lookupData?.message ?? 'Unable to retrieve case details');
        return false;
      }
      cnr = String(lookupData.cnr_number);
    }

    const detailsRes = await fetch('/api/ecourts/case-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnr_number: cnr, case_number: caseNumber }),
    });
    const detailsData = (await detailsRes.json()) as EcourtsCaseDetailsResponse;
    if (!detailsRes.ok || !detailsData?.success) {
      setDetailsError(detailsData?.detail ?? detailsData?.message ?? 'Unable to retrieve case details');
      return false;
    }

    setCaseDetails(mapEcourtsToCaseDetails(record, detailsData));
    setCaptchaImage(null);
    setCaptchaToken('');
    setCaptchaText('');
    return true;
  }

  async function loadCaseDetails(record: TodayMatchedListing, captchaOverride?: string) {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const res = await fetch('/api/case-details/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: record.id,
          caseId: record.case_id,
          caseNumber: record.case_number ?? record.case?.case_number ?? '',
          captcha: captchaOverride ?? '',
          captchaToken,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.requiresCaptcha) {
          setCaptchaImage(data.captchaImage ?? null);
          setCaptchaToken(data.captchaToken ?? '');
          setCaseDetails(null);
          setDetailsError(data.message ?? 'Captcha Required');
          return;
        }

        const msg = String(data.message ?? '');
        const shouldFallback =
          res.status === 404
          || msg.includes('Unable to load listing details')
          || msg.includes('Listing not found');

        if (shouldFallback) {
          const ok = await loadCaseDetailsFallback(record);
          if (ok) return;
        }

        setDetailsError(data.message ?? 'Unable to retrieve case details');
        return;
      }
      setCaseDetails((data.caseDetails ?? null) as CaseDetails | null);
      setCaptchaImage(null);
      setCaptchaToken('');
      setCaptchaText('');
      await fetchData();
    } catch {
      setDetailsError('Unable to retrieve case details');
    } finally {
      setDetailsLoading(false);
    }
  }

  function openCaseDetails(record: TodayMatchedListing) {
    setSelectedRecord(record);
    setCaseDetails(null);
    setCaptchaImage(null);
    setCaptchaToken('');
    setCaptchaText('');
    setDetailsError(null);
    setIsDetailsOpen(true);
    void loadCaseDetails(record);
  }

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Listings History</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every time your tracked cases appeared in the Madras High Court cause list.
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="h-9 gap-1"
          disabled={loading || isRefreshing}
          onClick={async () => {
            setIsRefreshing(true);
            try {
              await fetch('/api/todays-cause-list?refresh=1').catch(() => null);
              const res  = await fetch('/api/match-todays-listings', { method: 'POST' });
              const data = await res.json();
              setListedDateFrom(todayUtc);
              setListedDateTo(todayUtc);
              await fetchData();
              toast.success(
                data.matched_count != null
                  ? `${data.matched_count} records matched for ${data.match_date ?? todayUtc}.`
                  : 'Listings refreshed.',
              );
            } catch {
              toast.error('Unable to refresh listings. Please try again.');
            } finally {
              setIsRefreshing(false);
            }
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing\u2026' : 'Refresh'}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard title="Matched in Range" value={loading ? '\u2014' : listings.length} />
        <SummaryCard title="With CNR"         value={loading ? '\u2014' : listings.filter(r => r.cnr_number).length} />
        <SummaryCard title="Without CNR"      value={loading ? '\u2014' : listings.filter(r => !r.cnr_number).length} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
          <Input type="date" value={listedDateFrom}
            onChange={e => { setListedDateFrom(e.target.value); setPage(1); }}
            className="h-9 w-36 text-sm" />
          <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
          <Input type="date" value={listedDateTo}
            onChange={e => { setListedDateTo(e.target.value); setPage(1); }}
            className="h-9 w-36 text-sm" />
        </div>
        <Input value={filterCaseNumber}
          onChange={e => { setFilterCaseNumber(e.target.value); setPage(1); }}
          placeholder="Case No." className="h-9 w-36 text-sm" />
        <Input value={filterCnr}
          onChange={e => { setFilterCnr(e.target.value); setPage(1); }}
          placeholder="CNR" className="h-9 w-44 text-sm" />
        <Select value={filterJudge || '__all__'}
          onValueChange={v => { setFilterJudge(v === '__all__' ? '' : v); setPage(1); }}>
          <SelectTrigger className="h-9 w-48 text-sm">
            <SelectValue placeholder="All Judges" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Judges</SelectItem>
            {judgeOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground"
            onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* States */}
      {loading && (
        <div className="flex justify-center py-24 text-sm text-muted-foreground">
          Loading listings\u2026
        </div>
      )}
      {!loading && error && (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="ghost" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      )}
      {!loading && !error && listings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <p className="text-base font-medium">No matched listings for the selected date range.</p>
          <p className="mt-1 text-sm">
            Click <strong>Refresh</strong> to run the matching job, or adjust the date range above.
          </p>
        </div>
      )}

      {!loading && !error && listings.length > 0 && (
        <>
          {filtered.length !== listings.length && (
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {listings.length} records
            </p>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('listed_date')}>
                    Listed Date <SortIcon field="listed_date" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('item_number')}>
                    Item No <SortIcon field="item_number" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('court_hall')}>
                    Court Hall <SortIcon field="court_hall" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('case_number')}>
                    Case Number <SortIcon field="case_number" />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Petitioner</TableHead>
                  <TableHead className="whitespace-nowrap">Respondent</TableHead>
                  <TableHead className="whitespace-nowrap">Judge</TableHead>
                  <TableHead className="whitespace-nowrap">Stage Status</TableHead>
                  <TableHead className="whitespace-nowrap">Case Details</TableHead>
                  <TableHead className="whitespace-nowrap">Notification</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                      <TableCell colSpan={10}
                      className="py-10 text-center text-muted-foreground">
                      No records match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.flatMap(record => {
                    const hist = listingHistoryMap.get(record.case_id);

                    return [
                      <TableRow key={record.id}>

                        {/* Listed Date + history count */}
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              {fmtDate(record.listed_date ?? record.match_date)}
                            </span>
                            {hist && (
                              <span
                                className="text-[10px] text-muted-foreground cursor-default"
                                title={`First: ${fmtDate(hist.firstListed)} \u00b7 Last: ${fmtDate(hist.lastListed)}`}
                              >
                                Listed {hist.count}\u00d7
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">{record.item_number ?? '\u2014'}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{record.court_hall ?? '\u2014'}</TableCell>

                        {/* Case number + match-type badge */}
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span>{record.case_number ?? '\u2014'}</span>
                            <Badge
                              variant={record.match_type === 'cnr' ? 'success' : 'info'}
                              className="w-fit text-[10px]"
                            >
                              {record.match_type === 'cnr' ? 'CNR' : 'Case No.'}
                            </Badge>
                          </div>
                        </TableCell>

                        <TableCell className="max-w-[140px] truncate"
                          title={record.petitioner ?? undefined}>
                          {record.petitioner ?? '\u2014'}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate"
                          title={record.respondent ?? undefined}>
                          {record.respondent ?? '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{record.judge_name ?? '\u2014'}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.stage  ?? '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => openCaseDetails(record)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            View Case Details
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <NotifBadge status={record.notification_status} />
                        </TableCell>
                      </TableRow>,
                    ].filter(Boolean);
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {(safePage - 1) * PAGE_SIZE + 1}\u2013{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 font-medium text-foreground">
                  {safePage} / {totalPages}
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Case Details
            </DialogTitle>
          </DialogHeader>

          {detailsLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading case details...
            </div>
          )}

          {!detailsLoading && captchaImage && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">Captcha Required</p>
              <img src={captchaImage} alt="captcha" className="h-16 w-auto rounded border" />
              <Input
                value={captchaText}
                onChange={(e) => setCaptchaText(e.target.value)}
                placeholder="Enter captcha"
                className="max-w-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!captchaText.trim() || !selectedRecord}
                  onClick={() => {
                    if (!selectedRecord) return;
                    void loadCaseDetails(selectedRecord, captchaText.trim());
                  }}
                >
                  Search
                </Button>
              </div>
              {detailsError && <p className="text-sm text-destructive">{detailsError}</p>}
            </div>
          )}

          {!detailsLoading && !captchaImage && detailsError && (
            <p className="text-sm text-destructive">{detailsError}</p>
          )}

          {!detailsLoading && caseDetails && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <p><span className="font-medium">Case Number:</span> {caseDetails.caseNumber || '\u2014'}</p>
                <p><span className="font-medium">CNR Number:</span> {caseDetails.cnrNumber || '\u2014'}</p>
                <p><span className="font-medium">Petitioner:</span> {caseDetails.petitioner || '\u2014'}</p>
                <p><span className="font-medium">Respondent:</span> {caseDetails.respondent || '\u2014'}</p>
                <p><span className="font-medium">Court Hall:</span> {caseDetails.courtHall || '\u2014'}</p>
                <p><span className="font-medium">Judge:</span> {caseDetails.judge || '\u2014'}</p>
                <p><span className="font-medium">Stage Status:</span> {caseDetails.stageStatus || '\u2014'}</p>
              </div>

              <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-semibold">Prayer</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {caseDetails.prayer || '\u2014'}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Hearing History</p>
                {caseDetails.hearingHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hearing history available.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left">
                          <th className="px-2 py-1">Date</th>
                          <th className="px-2 py-1">Purpose</th>
                          <th className="px-2 py-1">Stage</th>
                          <th className="px-2 py-1">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseDetails.hearingHistory.map((h, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1">{h.date || '\u2014'}</td>
                            <td className="px-2 py-1">{h.purpose || '\u2014'}</td>
                            <td className="px-2 py-1">{h.stage || '\u2014'}</td>
                            <td className="px-2 py-1">{h.remarks || '\u2014'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Orders</p>
                {caseDetails.orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders available.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left">
                          <th className="px-2 py-1">Order Date</th>
                          <th className="px-2 py-1">Order Number</th>
                          <th className="px-2 py-1">Order Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseDetails.orders.map((o, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1">{o.orderDate || '\u2014'}</td>
                            <td className="px-2 py-1">{o.orderNumber || '\u2014'}</td>
                            <td className="px-2 py-1">{o.orderType || '\u2014'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
