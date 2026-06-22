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
  ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText, Loader2, RefreshCw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TodayMatchedListing } from '@/types';

type CaseOrder = {
  orderDate: string;
  orderNumber: string;
  orderType: string;
  orderUrl: string;
  category: 'judgment' | 'interim' | 'other';
};

type CaseDetails = {
  caseNumber: string;
  cnrNumber: string;
  courtName: string;
  caseStatus: string;
  nextHearingDate: string | null;
  petitioners: string[];
  respondents: string[];
  petitionerAdvocates: string[];
  respondentAdvocates: string[];
  hearingHistory: Array<{ date: string; purpose: string; businessDate: string; remarks: string }>;
  orders: CaseOrder[];
  orderCount: number;
  judgmentCount: number;
  interimOrderCount: number;
  filingDate: string | null;
  registrationDate: string | null;
  disposalDate: string | null;
  disposalNature: string | null;
  acts: string[];
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
  const [orderDownloading, setOrderDownloading] = useState<string | null>(null);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfViewerTitle, setPdfViewerTitle] = useState('');

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

  async function loadCaseDetails(record: TodayMatchedListing) {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const cnr = record.case?.cnr_number ?? record.cnr_number ?? '';
      const caseNumber = record.case_number ?? record.case?.case_number ?? '';

      // Calls go through Vite proxy at /ecourts-proxy → eCourtsIndia API
      // The proxy injects the Authorization header (API key never reaches the browser)

      // If CNR exists, fetch case details directly
      let resolvedCnr = cnr;

      if (!resolvedCnr) {
        // Search by case number to discover CNR
        if (!caseNumber) {
          setDetailsError('No CNR and no case number available to search.');
          return;
        }
        const parsed = caseNumber.replace(/\s+/g, '').toUpperCase().split('/');
        if (parsed.length !== 3) {
          setDetailsError(`Cannot parse case number: ${caseNumber}. Expected TYPE/NUMBER/YEAR.`);
          return;
        }

        const searchPayload = {
          case_type: parsed[0],
          case_number: parsed[1].replace(/\D/g, ''),
          year: parsed[2].replace(/\D/g, ''),
          state_code: '33',
          court_code: '1',
        };

        let searchUrl = '/ecourts-proxy/api/partner/search';
        let searchMethod: 'POST' | 'GET' = 'POST';
        let searchRes = await fetch(searchUrl, {
          method: searchMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchPayload),
        });

        if (searchRes.status === 405) {
          const qs = new URLSearchParams(searchPayload).toString();
          searchUrl = `/ecourts-proxy/api/partner/search?${qs}`;
          searchMethod = 'GET';
          searchRes = await fetch(searchUrl, {
            method: searchMethod,
            headers: { 'Accept': 'application/json' },
          });
        }

        if (searchRes.status === 405) {
          searchUrl = '/ecourts-proxy/api/partner/case/search';
          searchMethod = 'POST';
          searchRes = await fetch(searchUrl, {
            method: searchMethod,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchPayload),
          });
        }

        const searchText = await searchRes.text();
        console.log('[case-details] Search request:', searchMethod, searchUrl, searchPayload);
        console.log('[case-details] Search response:', searchRes.status, searchText.slice(0, 500));
        let searchData: any = {};
        try { searchData = searchText ? JSON.parse(searchText) : {}; } catch { /* not JSON */ }

        if (!searchRes.ok) {
          setDetailsError(`Search API ${searchMethod} ${searchUrl} returned ${searchRes.status}: ${searchText.slice(0, 300)}`);
          return;
        }

        const results = Array.isArray(searchData)
          ? searchData
          : searchData?.results
            ?? searchData?.con
            ?? searchData?.data?.results
            ?? searchData?.data
            ?? [];
        const firstResult = Array.isArray(results) ? (results[0] ?? null) : null;
        const discoveredCnr = String(
          firstResult?.cino
          ?? firstResult?.cnr
          ?? firstResult?.cnrNumber
          ?? firstResult?.cnr_number
          ?? firstResult?.id
          ?? '',
        ).trim();

        if (!firstResult || !discoveredCnr) {
          setDetailsError(`Case not found in eCourtsIndia. Response: ${JSON.stringify(searchData).slice(0, 200)}`);
          return;
        }

        resolvedCnr = discoveredCnr;

        // Save discovered CNR to database
        if (record.case_id) {
          await supabase
            .from('cases')
            .update({ cnr_number: resolvedCnr, cnr_discovered_at: new Date().toISOString() })
            .eq('id', record.case_id);
        }
      }

      // Fetch case details by CNR
      const detailUrl = `/ecourts-proxy/api/partner/case/${encodeURIComponent(resolvedCnr)}`;
      console.log('[case-details] Fetching:', detailUrl);

      const res = await fetch(detailUrl, {
        headers: { 'Accept': 'application/json' },
      });
      const resText = await res.text();
      console.log('[case-details] Response:', res.status, resText.slice(0, 500));

      if (!res.ok || !resText) {
        setDetailsError(`eCourts API returned ${res.status}: ${resText.slice(0, 300) || '(empty body)'}`);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(resText);
      } catch {
        setDetailsError(`eCourts API returned non-JSON: ${resText.slice(0, 300)}`);
        return;
      }
      console.log('[case-details] Parsed:', data);

      // Some API responses nest the payload under `data` / `courtCaseData`.
      const cc = data.courtCaseData ?? data.data?.courtCaseData ?? data.data ?? data;

      const mapOrders = (
        list: any[] | undefined,
        category: CaseOrder['category'],
      ): CaseOrder[] =>
        (list ?? []).map((o: Record<string, string>) => ({
          orderDate: o.orderDate ?? o.order_date ?? '',
          orderNumber: o.orderNumber ?? o.order_no ?? o.order_number ?? '',
          orderType: o.orderType ?? o.order_type ?? (category === 'judgment' ? 'JUDGMENT' : category === 'interim' ? 'INTERIM ORDER' : ''),
          orderUrl: o.orderUrl ?? o.order_url ?? o.url ?? '',
          category,
        }));

      const judgmentOrders = mapOrders(cc.judgmentOrders, 'judgment');
      const interimOrders = mapOrders(cc.interimOrders, 'interim');
      const legacyOrders = mapOrders(cc.orders ?? data.orders, 'other');
      const allOrders = [...judgmentOrders, ...interimOrders, ...legacyOrders];

      // Map API response to CaseDetails
      const caseDetails: CaseDetails = {
        caseNumber: data.case_no ?? cc.case_no ?? `${data.case_type ?? ''}/${data.reg_no ?? ''}/${data.reg_year ?? ''}`,
        cnrNumber: data.cino ?? cc.cnr ?? data.cnr ?? resolvedCnr,
        courtName: data.court_name ?? cc.courtName ?? 'Madras High Court',
        caseStatus: data.case_status ?? cc.caseStatus ?? '',
        nextHearingDate: data.next_hearing_date ?? cc.nextHearingDate ?? null,
        petitioners: data.petitioner ?? cc.petitioners ?? [],
        respondents: data.respondent ?? cc.respondents ?? [],
        petitionerAdvocates: data.pet_adv ?? cc.petitionerAdvocates ?? [],
        respondentAdvocates: data.res_adv ?? cc.respondentAdvocates ?? [],
        hearingHistory: (data.hearing_history ?? cc.hearingHistory ?? []).map((h: Record<string, string>) => ({
          date: h.hearing_date ?? h.hearingDate ?? '',
          purpose: h.purpose ?? '',
          businessDate: h.business_date ?? h.businessDate ?? '',
          remarks: h.remarks ?? '',
        })),
        orders: allOrders,
        orderCount: allOrders.length,
        judgmentCount: judgmentOrders.length,
        interimOrderCount: interimOrders.length,
        filingDate: data.filing_date ?? cc.filingDate ?? null,
        registrationDate: data.reg_date ?? cc.registrationDate ?? null,
        disposalDate: data.disposal_date ?? cc.disposalDate ?? null,
        disposalNature: data.disposal_nature ?? cc.disposalNature ?? null,
        acts: data.acts ?? cc.acts ?? [],
      };

      setCaseDetails(caseDetails);

      // Save to database for caching
      if (record.case_id) {
        await supabase
          .from('cases')
          .update({
            case_details_json: caseDetails,
            case_details_last_fetched: new Date().toISOString(),
            case_status: caseDetails.caseStatus || undefined,
            petitioner: caseDetails.petitioners.join(', ') || undefined,
            respondent: caseDetails.respondents.join(', ') || undefined,
            next_hearing_date: caseDetails.nextHearingDate || undefined,
          })
          .eq('id', record.case_id);
      }

      await fetchData();
    } catch (err) {
      console.error('[case-details] Error:', err);
      setDetailsError(err instanceof Error ? err.message : 'Unable to retrieve case details');
    } finally {
      setDetailsLoading(false);
    }
  }

  function openCaseDetails(record: TodayMatchedListing) {
    setSelectedRecord(record);
    setCaseDetails(null);
    setDetailsError(null);
    setIsDetailsOpen(true);
    void loadCaseDetails(record);
  }

  // Resolve an order's download URL via the Supabase Edge Function (keeps API key server-side).
  async function resolveOrderDownload(order: CaseOrder): Promise<{ url: string; filename: string } | null> {
    if (!caseDetails?.cnrNumber || !order.orderUrl) {
      toast.error('Missing CNR or order file reference.');
      return null;
    }
    const { data, error } = await supabase.functions.invoke('download-order', {
      body: { cnr: caseDetails.cnrNumber, filename: order.orderUrl },
    });
    if (error) {
      toast.error(error.message ?? 'Unable to fetch order.');
      return null;
    }
    if (!data?.success) {
      toast.error(data?.error ?? data?.message ?? 'Unable to fetch order.');
      return null;
    }
    const url: string = data.downloadUrl ?? data.url ?? '';
    const filename: string = data.downloadFilename ?? order.orderUrl;
    if (!url) {
      toast.error('Order download URL not returned by server.');
      return null;
    }
    return { url, filename };
  }

  async function handleDownloadOrder(order: CaseOrder) {
    const key = `${order.category}:${order.orderUrl}`;
    setOrderDownloading(key);
    try {
      const resolved = await resolveOrderDownload(order);
      if (resolved) window.open(resolved.url, '_blank', 'noopener,noreferrer');
    } finally {
      setOrderDownloading(null);
    }
  }

  async function handleViewOrder(order: CaseOrder) {
    const key = `view:${order.category}:${order.orderUrl}`;
    setOrderDownloading(key);
    try {
      const resolved = await resolveOrderDownload(order);
      if (resolved) {
        setPdfViewerUrl(resolved.url);
        setPdfViewerTitle(`${order.orderType || 'Order'} \u2014 ${fmtDate(order.orderDate)}`);
      }
    } finally {
      setOrderDownloading(null);
    }
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

          {!detailsLoading && detailsError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{detailsError}</p>
              {selectedRecord && (
                <Button size="sm" variant="outline" onClick={() => loadCaseDetails(selectedRecord)}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {!detailsLoading && caseDetails && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <p><span className="font-medium">Case Number:</span> {caseDetails.caseNumber || '\u2014'}</p>
                <p><span className="font-medium">CNR Number:</span> {caseDetails.cnrNumber || '\u2014'}</p>
                <p><span className="font-medium">Court Name:</span> {caseDetails.courtName || '\u2014'}</p>
                <p><span className="font-medium">Case Status:</span> {caseDetails.caseStatus || '\u2014'}</p>
                <p><span className="font-medium">Next Hearing Date:</span> {caseDetails.nextHearingDate ? fmtDate(caseDetails.nextHearingDate) : '\u2014'}</p>
                <p><span className="font-medium">Filing Date:</span> {caseDetails.filingDate ? fmtDate(caseDetails.filingDate) : '\u2014'}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="mb-1 text-sm font-semibold">Petitioners</p>
                  {caseDetails.petitioners.length === 0
                    ? <p className="text-muted-foreground">{'\u2014'}</p>
                    : <ul className="list-disc pl-4 text-sm text-muted-foreground">
                        {caseDetails.petitioners.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                  }
                </div>
                <div className="rounded-md border p-3">
                  <p className="mb-1 text-sm font-semibold">Respondents</p>
                  {caseDetails.respondents.length === 0
                    ? <p className="text-muted-foreground">{'\u2014'}</p>
                    : <ul className="list-disc pl-4 text-sm text-muted-foreground">
                        {caseDetails.respondents.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                  }
                </div>
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
                          <th className="px-2 py-1">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseDetails.hearingHistory.map((h, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1 whitespace-nowrap">{h.date || '\u2014'}</td>
                            <td className="px-2 py-1">{h.purpose || '\u2014'}</td>
                            <td className="px-2 py-1">{h.remarks || '\u2014'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">Orders</p>
                  <Badge variant="secondary" className="text-[10px]">Orders: {caseDetails.orderCount}</Badge>
                  <Badge variant="success" className="text-[10px]">Judgments: {caseDetails.judgmentCount}</Badge>
                  <Badge variant="info" className="text-[10px]">Interim Orders: {caseDetails.interimOrderCount}</Badge>
                </div>
                {caseDetails.orderCount === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders available for this case.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left">
                          <th className="px-2 py-1">Order Date</th>
                          <th className="px-2 py-1">Order Type</th>
                          <th className="px-2 py-1">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseDetails.orders.map((o, i) => {
                          const dlKey = `${o.category}:${o.orderUrl}`;
                          const viewKey = `view:${o.category}:${o.orderUrl}`;
                          return (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-2 py-1 whitespace-nowrap">{o.orderDate ? fmtDate(o.orderDate) : '\u2014'}</td>
                              <td className="px-2 py-1">
                                <Badge
                                  variant={o.category === 'judgment' ? 'success' : o.category === 'interim' ? 'info' : 'secondary'}
                                  className="text-[10px]"
                                >
                                  {o.orderType || (o.category === 'judgment' ? 'Judgment' : o.category === 'interim' ? 'Interim Order' : 'Order')}
                                </Badge>
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    disabled={!o.orderUrl || orderDownloading === viewKey}
                                    onClick={() => handleViewOrder(o)}
                                  >
                                    {orderDownloading === viewKey
                                      ? <Loader2 className="h-3 w-3 animate-spin" />
                                      : <Eye className="h-3 w-3" />}
                                    View Order
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1 text-xs"
                                    disabled={!o.orderUrl || orderDownloading === dlKey}
                                    onClick={() => handleDownloadOrder(o)}
                                  >
                                    {orderDownloading === dlKey
                                      ? <Loader2 className="h-3 w-3 animate-spin" />
                                      : <Download className="h-3 w-3" />}
                                    Download PDF
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Order Viewer */}
      <Dialog open={!!pdfViewerUrl} onOpenChange={(open) => { if (!open) setPdfViewerUrl(null); }}>
        <DialogContent className="h-[90vh] max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {pdfViewerTitle || 'Order'}
              {pdfViewerUrl && (
                <a
                  href={pdfViewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Open in new tab
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          {pdfViewerUrl && (
            <iframe
              src={pdfViewerUrl}
              title="Order PDF"
              className="h-full w-full rounded-md border"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
