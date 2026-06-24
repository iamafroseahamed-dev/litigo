import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';
import { DEVELOPER_NAME, DEVELOPER_EMAIL } from '@/lib/appInfo';
import { useOrg } from '@/lib/orgContext';

interface DailyCauseListRecord {
  cause_date?: string | null;
  court_name?: string | null;
  bench?: string | null;
  court_hall: string | null;
  item_number: string | null;
  case_number: string | null;
  cnr_number?: string | null;
  petitioner: string | null;
  respondent: string | null;
  party_names: string | null;
  judge_name: string | null;
  last_hearing_or_stage: string | null;
  counsel_name: string | null;
}

type SortField = 'court_hall' | 'item_number' | 'judge_name' | 'case_number';
type SortDir = 'asc' | 'desc';

const COLS = 'cause_date,court_name,bench,court_hall,item_number,case_number,cnr_number,petitioner,respondent,party_names,judge_name,last_hearing_or_stage,counsel_name';
const PAGE = 1000; // Supabase page size

async function fetchFromSupabase(orgId?: string | null): Promise<DailyCauseListRecord[]> {
  // 1. Find the most recent available cause_date
  const { data: dateRow, error: dateErr } = await supabase
    .from('daily_cause_list')
    .select('cause_date')
    .eq('court_name', 'Madras High Court')
    .eq('bench', 'Chennai')
    .order('cause_date', { ascending: false })
    .limit(1)
    .single();

  if (dateErr || !dateRow) throw new Error('No cause list data available in the database.');

  const causeDate = dateRow.cause_date as string;

  // 2. Organization-aware mapping via today_matched_listings -> daily_cause_list ids.
  // If organization_id is not available yet (older schema), we gracefully fall
  // back to the global cause list behavior below.
  if (orgId) {
    const mappedIds = new Set<string>();
    const tml = await supabase
      .from('today_matched_listings')
      .select('daily_cause_list_id')
      .eq('listed_date', causeDate)
      .or(`organization_id.eq.${orgId},organization_id.is.null`)
      .range(0, 49999);

    if (!tml.error) {
      (tml.data ?? []).forEach(r => {
        const id = (r as { daily_cause_list_id: string | null }).daily_cause_list_id;
        if (id) mappedIds.add(id);
      });
      if (mappedIds.size === 0) return [];

      const mappedRows: DailyCauseListRecord[] = [];
      const ids = Array.from(mappedIds);
      for (let i = 0; i < ids.length; i += PAGE) {
        const chunk = ids.slice(i, i + PAGE);
        const { data, error } = await supabase
          .from('daily_cause_list')
          .select(COLS)
          .in('id', chunk)
          .order('court_hall', { ascending: true })
          .order('item_number', { ascending: true });
        if (error) throw new Error(error.message);
        mappedRows.push(...((data ?? []) as DailyCauseListRecord[]));
      }
      return mappedRows;
    }
  }

  // 3. Global fallback: fetch all rows for that date (paginated)
  const allRows: DailyCauseListRecord[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('daily_cause_list')
      .select(COLS)
      .eq('cause_date', causeDate)
      .eq('court_name', 'Madras High Court')
      .eq('bench', 'Chennai')
      .order('court_hall', { ascending: true })
      .order('item_number', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allRows.push(...(data as DailyCauseListRecord[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

export default function CauseListPage() {
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const today = new Date().toISOString().split('T')[0];

  const [records, setRecords] = useState<DailyCauseListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [filterCourtHall, setFilterCourtHall] = useState('');
  const [filterJudge, setFilterJudge] = useState('');
  const [filterStage, setFilterStage] = useState('');

  const [sortField, setSortField] = useState<SortField>('court_hall');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const rows = await fetchFromSupabase(orgId);
      setRecords(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const courtHallOptions = useMemo(() =>
    [...new Set(records.map(r => r.court_hall).filter(Boolean))].sort() as string[],
    [records]);

  const judgeOptions = useMemo(() =>
    [...new Set(records.map(r => r.judge_name).filter(Boolean))].sort() as string[],
    [records]);

  const stageOptions = useMemo(() =>
    [...new Set(records.map(r => r.last_hearing_or_stage).filter(Boolean))].sort() as string[],
    [records]);

  const filtered = useMemo(() => {
    let rows = records;

    if (filterCourtHall) rows = rows.filter(r => r.court_hall === filterCourtHall);
    if (filterJudge)     rows = rows.filter(r => r.judge_name === filterJudge);
    if (filterStage)     rows = rows.filter(r => r.last_hearing_or_stage === filterStage);

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        [r.case_number, r.petitioner, r.respondent, r.party_names, r.judge_name, r.counsel_name]
          .some(v => v?.toLowerCase().includes(q))
      );
    }

    return [...rows].sort((a, b) => {
      const av = (a[sortField] ?? '').toString().toLowerCase();
      const bv = (b[sortField] ?? '').toString().toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [records, search, filterCourtHall, filterJudge, filterStage, sortField, sortDir]);

  const hasActiveFilters = filterCourtHall || filterJudge || filterStage;

  function clearFilters() {
    setFilterCourtHall('');
    setFilterJudge('');
    setFilterStage('');
    setSearch('');
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="ml-1 text-muted-foreground/40">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Court Cause List</h1>
          {!loading && !error && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Total Records: {records.length}
              {filtered.length !== records.length && ` · Showing: ${filtered.length}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1"
            onClick={async () => {
              await loadData();
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {!loading && !error && filtered.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1"
              onClick={() => {
                const rows = filtered.map(r => ({
                  'Court Hall': r.court_hall ?? '',
                  'Item No': r.item_number ?? '',
                  'Case Number': r.case_number ?? '',
                  'Petitioner': r.petitioner ?? '',
                  'Respondent': r.respondent ?? '',
                  'Judge': r.judge_name ?? '',
                  'Stage': r.last_hearing_or_stage ?? '',
                  'Counsel': r.counsel_name ?? '',
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Cause List');
                XLSX.utils.sheet_add_aoa(ws, [
                  [],
                  [`Developed by ${DEVELOPER_NAME}`],
                  [DEVELOPER_EMAIL],
                ], { origin: -1 });
                XLSX.writeFile(wb, `cause_list_${today}.xlsx`);
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export Excel
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterCourtHall || '__all__'} onValueChange={v => setFilterCourtHall(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue placeholder="All Court Halls" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Court Halls</SelectItem>
            {courtHallOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterJudge || '__all__'} onValueChange={v => setFilterJudge(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-52 text-sm">
            <SelectValue placeholder="All Judges" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Judges</SelectItem>
            {judgeOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStage || '__all__'} onValueChange={v => setFilterStage(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Stages</SelectItem>
            {stageOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search case, petitioner, respondent, judge, counsel..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {(hasActiveFilters || search) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          Fetching today's cause list...
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadData()}>Try Again</Button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          No cause list records found.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('court_hall')}>
                  Court Hall<SortIcon field="court_hall" />
                </TableHead>
                <TableHead className="whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('item_number')}>
                  Item No<SortIcon field="item_number" />
                </TableHead>
                <TableHead className="whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('case_number')}>
                  Case Number<SortIcon field="case_number" />
                </TableHead>
                <TableHead>Petitioner</TableHead>
                <TableHead>Respondent</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('judge_name')}>
                  Judge<SortIcon field="judge_name" />
                </TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Counsel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r, idx) => (
                <TableRow key={`${r.court_hall}-${r.item_number}-${r.case_number}-${idx}`}>
                  <TableCell className="font-medium">{r.court_hall ?? '—'}</TableCell>
                  <TableCell>{r.item_number ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.case_number ?? '—'}</TableCell>
                  <TableCell>{r.petitioner ?? '—'}</TableCell>
                  <TableCell>{r.respondent ?? '—'}</TableCell>
                  <TableCell>{r.judge_name ?? '—'}</TableCell>
                  <TableCell>{r.last_hearing_or_stage ?? '—'}</TableCell>
                  <TableCell>{r.counsel_name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}