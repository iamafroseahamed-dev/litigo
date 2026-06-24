import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChevronLeft, ChevronRight, FileText, Loader2, Scale, Video, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CaseDetailsModal } from '@/components/CaseDetailsModal';
import { useOrg } from '@/lib/orgContext';
import type { TodayMatchedListing } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function normalizeJudgeName(value: string | null | undefined) {
  if (!value) return '';
  return value
    .toUpperCase()
    .replace(/\bTHE\b/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type SortField = 'listed_date' | 'court_hall' | 'item_number' | 'case_number';
type SortDir   = 'asc' | 'desc';

type RangeFilter = 'today' | '7d' | '30d' | '90d' | 'all';

const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: 'Last 7 days' },
  { value: '30d',   label: 'Last 30 days' },
  { value: '90d',   label: 'Last 90 days' },
  { value: 'all',   label: 'All time' },
];

const PAGE_SIZE = 20;

function NotifBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
    pending:       { label: 'Pending',       variant: 'warning'     },
    sent:          { label: 'Sent',          variant: 'success'     },
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
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const [loading, setLoading]             = useState(true);
  const [error,   setError]               = useState<string | null>(null);
  const [listings, setListings]           = useState<TodayMatchedListing[]>([]);
  const [listingHistoryMap, setListingHistoryMap] = useState<
    Map<string, { count: number; firstListed: string; lastListed: string }>
  >(new Map());

  // ── Latest-order download state ───────────────────────────────────────────────
  const [orderLoadingId, setOrderLoadingId]       = useState<string | null>(null);

  // ── eCourts Case Details modal state ─────────────────────────────────────────
  const [caseDetailsOpen, setCaseDetailsOpen]     = useState(false);
  const [caseDetailsNumber, setCaseDetailsNumber] = useState<string | null>(null);
  const [caseDetailsId, setCaseDetailsId]         = useState<string | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const todayUtc = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterJudge, setFilterJudge] = useState('');
  const [sortField, setSortField] = useState<SortField>('court_hall');
  const [sortDir,   setSortDir  ] = useState<SortDir>('asc');
  const [page, setPage]           = useState(1);

  // Earliest listed_date to include for the selected range (null = no lower bound).
  const rangeStart = useMemo(() => {
    if (rangeFilter === 'all') return null;
    if (rangeFilter === 'today') return todayUtc;
    const days = rangeFilter === '7d' ? 6 : rangeFilter === '30d' ? 29 : 89;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split('T')[0];
  }, [rangeFilter, todayUtc]);

  // ── Data loading ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('today_matched_listings')
        .select(`
          *,
          case:cases(
            id, cnr_number, case_number, district, section,
            cla_party_status, sensitivity, case_status
          )
        `);
      if (orgId) query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
      query = rangeStart ? query.gte('listed_date', rangeStart) : query;
      const [{ data, error: sbErr }, { data: vcLinkData, error: vcLinkErr }] = await Promise.all([
        query
        .order('listed_date', { ascending: false })
        .order('court_hall',  { ascending: true  })
        .order('item_number', { ascending: true  }),
        supabase
          .from('vc_links')
          .select('judge_name,vc_link')
          .eq('vc_date', todayUtc)
          .not('vc_link', 'is', null),
      ]);

      if (sbErr) throw sbErr;
      if (vcLinkErr) throw vcLinkErr;

      const vcLinkMap = new Map<string, string>();
      for (const row of vcLinkData ?? []) {
        const judgeName = normalizeJudgeName(row.judge_name as string | null | undefined);
        const vcLink = row.vc_link as string | null | undefined;
        if (judgeName && vcLink && !vcLinkMap.has(judgeName)) {
          vcLinkMap.set(judgeName, vcLink);
        }
      }

      const rows = ((data ?? []) as unknown as TodayMatchedListing[]).map(record => ({
        ...record,
        vc_link: record.vc_link ?? vcLinkMap.get(normalizeJudgeName(record.judge_name)) ?? null,
      }));
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
  }, [todayUtc, rangeStart, orgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fetch the latest MHC order and open its PDF directly ────────────────────
  async function viewLatestOrder(record: TodayMatchedListing) {
    const caseNumber = record.case_number;
    if (!caseNumber) return;

    setOrderLoadingId(record.id);
    try {
      const response = await fetch('/api/mhc/case-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: caseNumber }),
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'MHC API returned an error.');
      }

      const orders: Record<string, string>[] = result.orders ?? [];
      const pdfUrl = (orders[0]?.pdf_url as string | null | undefined) || null;

      if (!pdfUrl) {
        toast.error('No order PDF available for this case yet.');
        return;
      }

      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch the latest order.');
    } finally {
      setOrderLoadingId(null);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const judgeOptions = useMemo(
    () => [...new Set(listings.map(r => r.judge_name).filter(Boolean))].sort() as string[],
    [listings],
  );

  const filtered = useMemo(() => {
    let rows = listings;
    if (filterJudge) rows = rows.filter(r => r.judge_name === filterJudge);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.case_number ?? '').toLowerCase().includes(q) ||
        (r.petitioner ?? '').toLowerCase().includes(q) ||
        (r.respondent ?? '').toLowerCase().includes(q) ||
        (r.judge_name ?? '').toLowerCase().includes(q) ||
        (r.stage ?? '').toLowerCase().includes(q) ||
        (r.court_hall ?? '').toLowerCase().includes(q) ||
        (r.item_number ?? '').toLowerCase().includes(q),
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
  }, [listings, filterJudge, searchQuery, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = searchQuery || filterJudge;

  function clearFilters() {
    setSearchQuery('');
    setFilterJudge('');
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

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Listings History</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Today&apos;s tracked cases from the Madras High Court cause list.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard title="Matched in Range" value={loading ? '\u2014' : listings.length} />
        <SummaryCard title="With CNR"         value={loading ? '\u2014' : listings.filter(r => r.cnr_number).length} />
        <SummaryCard title="Without CNR"      value={loading ? '\u2014' : listings.filter(r => !r.cnr_number).length} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <Select value={rangeFilter}
          onValueChange={v => { setRangeFilter(v as RangeFilter); setPage(1); }}>
          <SelectTrigger className="h-9 w-40 text-sm">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="Search visible columns"
          className="h-9 w-52 text-sm sm:w-64" />
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
          <p className="text-base font-medium">No matched listings found for today.</p>
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
                  <TableHead className="w-[96px] whitespace-nowrap text-center">VC Link</TableHead>
                  <TableHead className="whitespace-nowrap">Notification</TableHead>
                  <TableHead className="whitespace-nowrap">Details</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                      <TableCell colSpan={11}
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
                        <TableCell className="w-[96px] whitespace-nowrap text-center">
                          {record.vc_link ? (
                            <a
                              href={record.vc_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open Microsoft Teams Hearing Link"
                              aria-label="Open Microsoft Teams Hearing Link"
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input px-2 text-xs font-medium text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              <Video className="h-3.5 w-3.5" />
                              <span>Join VC</span>
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <NotifBadge status={record.notification_status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={!record.case_number || orderLoadingId === record.id}
                              onClick={() => viewLatestOrder(record)}
                            >
                              {orderLoadingId === record.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <FileText className="h-3 w-3" />}
                              View Latest Order
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={!record.case_number}
                              onClick={() => { setCaseDetailsNumber(record.case_number); setCaseDetailsId(record.case_id); setCaseDetailsOpen(true); }}
                            >
                              <Scale className="h-3 w-3" />
                              Case Details
                            </Button>
                          </div>
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

      {/* ── eCourts Case Details Modal ── */}
      <CaseDetailsModal
        caseNumber={caseDetailsNumber}
        caseId={caseDetailsId}
        open={caseDetailsOpen}
        onOpenChange={setCaseDetailsOpen}
      />
    </div>
  );
}
