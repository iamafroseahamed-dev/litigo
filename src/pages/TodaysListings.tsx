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
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, RefreshCw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TodayMatchedListing, HearingEntry } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

type SortField = 'listed_date' | 'court_hall' | 'item_number' | 'case_number' | 'next_hearing_date';
type SortDir   = 'asc' | 'desc';

const PAGE_SIZE = 20;

function NotifBadge({ status, count }: { status: string | null | undefined; count?: number | null }) {
  const map: Record<string, { label: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
    pending:       { label: 'Pending',       variant: 'warning'     },
    notified:      { label: 'Notified',      variant: 'success'     },
    partial:       { label: 'Partial',       variant: 'warning'     },
    failed:        { label: 'Failed',        variant: 'destructive' },
    no_recipients: { label: 'No Recipients', variant: 'outline'     },
    not_notified:  { label: 'Not Sent',      variant: 'secondary'   },
  };
  const key = (status ?? '').trim();
  const entry = map[key] ?? { label: 'Not Sent', variant: 'secondary' as const };
  const label = count != null && count > 0 ? `${entry.label} (${count})` : entry.label;
  return <Badge variant={entry.variant} className="text-[10px] whitespace-nowrap">{label}</Badge>;
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
  const [autoRefreshedEmptyView, setAutoRefreshedEmptyView] = useState(false);
  const [expandedRows, setExpandedRows]   = useState<Set<string>>(new Set());
  const [listingHistoryMap, setListingHistoryMap] = useState<
    Map<string, { count: number; firstListed: string; lastListed: string }>
  >(new Map());

  // ── Filters ──────────────────────────────────────────────────────────────────
  const todayUtc = useMemo(() => new Date().toISOString().split('T')[0], []);
  // defaultDate is set to the latest available matched listing date on load.
  const [defaultDate,    setDefaultDate   ] = useState<string>(todayUtc);
  const [listedDateFrom, setListedDateFrom] = useState<string>('');
  const [listedDateTo,   setListedDateTo  ] = useState<string>('');
  const [filterCaseNumber, setFilterCaseNumber] = useState('');
  const [filterCnr,        setFilterCnr       ] = useState('');
  const [filterJudge,      setFilterJudge      ] = useState('');
  const [sortField, setSortField] = useState<SortField>('court_hall');
  const [sortDir,   setSortDir  ] = useState<SortDir>('asc');
  const [page, setPage]           = useState(1);

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Initialise date filters to the latest available matched date ──────────────
  useEffect(() => {
    supabase
      .from('today_matched_listings')
      .select('listed_date')
      .order('listed_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn('[TodaysListings] latest date lookup failed:', error.message);
        }
        const d = data?.listed_date ?? todayUtc;
        setDefaultDate(d);
        setListedDateFrom(d);
        setListedDateTo(d);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const refreshListings = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res  = await fetch('/api/match-todays-listings', { method: 'POST' });
      const data = await res.json();
      setListedDateFrom(defaultDate);
      setListedDateTo(defaultDate);
      await fetchData();
      toast.success(
        data.matched_count != null
          ? `${data.matched_count} records matched, ${data.synced_cases_count ?? 0} cases synced for ${data.match_date ?? defaultDate}.`
          : 'Listings refreshed.',
      );
    } catch {
      toast.error('Unable to refresh listings. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  }, [defaultDate, fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const usingDefaultRange = listedDateFrom === defaultDate && listedDateTo === defaultDate;
    if (!usingDefaultRange || loading || error || listings.length > 0 || autoRefreshedEmptyView) {
      return;
    }

    setAutoRefreshedEmptyView(true);
    void refreshListings();
  }, [
    autoRefreshedEmptyView,
    defaultDate,
    error,
    listedDateFrom,
    listedDateTo,
    listings.length,
    loading,
    refreshListings,
  ]);

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
        case 'next_hearing_date': av = a.next_hearing_date ?? '';                     bv = b.next_hearing_date ?? '';                     break;
      }
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [listings, filterJudge, filterCaseNumber, filterCnr, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = filterCaseNumber || filterCnr || filterJudge ||
    listedDateFrom !== defaultDate || listedDateTo !== defaultDate;

  function clearFilters() {
    setFilterCaseNumber(''); setFilterCnr(''); setFilterJudge('');
    setListedDateFrom(defaultDate); setListedDateTo(defaultDate);
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
            Every time your tracked cases appeared in the Madras High Court cause list.
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="h-9 gap-1"
          disabled={loading || isRefreshing}
          onClick={refreshListings}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing\u2026' : 'Refresh'}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="Matched in Range" value={loading ? '—' : listings.length} />
        <SummaryCard title="Notified"         value={loading ? '—' : listings.filter(r => r.notification_status === 'notified' || r.notification_status === 'partial').length} />
        <SummaryCard title="Not Sent"         value={loading ? '—' : listings.filter(r => !r.notification_status || r.notification_status === 'not_notified' || r.notification_status === 'pending' || r.notification_status === 'failed').length} />
        <SummaryCard title="With CNR"         value={loading ? '—' : listings.filter(r => r.cnr_number).length} />
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
                  {/* Expand toggle column */}
                  <TableHead className="w-8" />
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
                  <TableHead className="whitespace-nowrap">CNR Number</TableHead>
                  <TableHead className="whitespace-nowrap">Petitioner</TableHead>
                  <TableHead className="whitespace-nowrap">Respondent</TableHead>
                  <TableHead className="whitespace-nowrap">Judge</TableHead>
                  <TableHead className="cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort('next_hearing_date')}>
                    Latest Hearing <SortIcon field="next_hearing_date" />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Next Hearing</TableHead>
                  <TableHead className="whitespace-nowrap">Case Status</TableHead>
                  <TableHead className="whitespace-nowrap">Sensitivity</TableHead>
                  <TableHead className="whitespace-nowrap">CLA Party</TableHead>
                  <TableHead className="whitespace-nowrap">Notification</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                      <TableCell colSpan={15}
                      className="py-10 text-center text-muted-foreground">
                      No records match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.flatMap(record => {
                    const isExpanded = expandedRows.has(record.id);
                    const hearings: HearingEntry[] = Array.isArray(record.hearing_history)
                      ? record.hearing_history
                      : [];
                    const hist = listingHistoryMap.get(record.case_id);

                    return [
                      <TableRow key={record.id}
                        className={isExpanded ? 'bg-muted/20' : undefined}>

                        {/* Expand toggle */}
                        <TableCell className="w-8 p-1">
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6"
                            disabled={hearings.length === 0}
                            title={hearings.length === 0
                              ? 'No hearing history stored'
                              : isExpanded ? 'Collapse' : 'Show hearing history'}
                            onClick={() => toggleRow(record.id)}
                          >
                            {isExpanded
                              ? <ChevronUp className="h-3.5 w-3.5" />
                              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          </Button>
                        </TableCell>

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

                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {record.cnr_number ?? record.case?.cnr_number ?? '\u2014'}
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
                        <TableCell className="whitespace-nowrap">
                          {record.latest_hearing_date ? fmtDate(record.latest_hearing_date) : '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {record.next_hearing_date ? fmtDate(record.next_hearing_date) : '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.latest_case_status ?? record.case?.case_status ?? '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.case?.sensitivity ?? '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {record.case?.cla_party_status ?? '\u2014'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <NotifBadge
                            status={record.notification_status}
                            count={record.notification_count}
                          />
                        </TableCell>
                      </TableRow>,

                      /* Expanded hearing history row */
                      isExpanded && (
                        <TableRow key={`${record.id}-exp`}
                          className="bg-muted/10 hover:bg-muted/10">
                          <TableCell colSpan={15} className="p-0">
                            <div className="px-10 py-3 border-t">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Hearing History
                                {record.ecourts_synced_at && (
                                  <span className="ml-2 font-normal normal-case">
                                    (synced {fmtDate(record.ecourts_synced_at)})
                                  </span>
                                )}
                              </p>
                              {hearings.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-1">
                                  No hearing history available.
                                </p>
                              ) : (
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="border-b text-muted-foreground">
                                      <th className="text-left py-1 pr-4 font-medium">Date</th>
                                      <th className="text-left py-1 pr-4 font-medium">Stage</th>
                                      <th className="text-left py-1 pr-4 font-medium">Business / Purpose</th>
                                      <th className="text-left py-1 font-medium">Remarks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {hearings.map((h, i) => (
                                      <tr key={i}
                                        className="border-b border-muted/30 last:border-0">
                                        <td className="py-1 pr-4 font-mono whitespace-nowrap">
                                          {fmtDate(h.date) || h.date || '\u2014'}
                                        </td>
                                        <td className="py-1 pr-4">{h.stage || '\u2014'}</td>
                                        <td className="py-1 pr-4">{h.business || '\u2014'}</td>
                                        <td className="py-1">{h.remarks || '\u2014'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ),
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
    </div>
  );
}
