import { useState, useEffect, useCallback } from 'react';
import { fetchCauseList } from '@/services/mockCauseListService';
import type { CauseList } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Filter, X, List, Info } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const STATUSES = ['Listed', 'Adjourned', 'Part Heard', 'Orders Reserved', 'Pending'];
const COURTS = ['Madras High Court', 'City Civil Court Chennai', 'Family Court Chennai'];

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    Listed: 'bg-green-100 text-green-800',
    Adjourned: 'bg-amber-100 text-amber-800',
    'Part Heard': 'bg-blue-100 text-blue-800',
    'Orders Reserved': 'bg-purple-100 text-purple-800',
    Pending: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

export default function CauseListPage() {
  const [causeList, setCauseList] = useState<CauseList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterBench, setFilterBench] = useState('');
  const [filterJudge, setFilterJudge] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCauseList(await fetchCauseList()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = causeList.filter(cl => {
    const q = search.toLowerCase();
    const matchSearch = !q || cl.case_number.toLowerCase().includes(q) ||
      cl.cnr_number.toLowerCase().includes(q) || cl.judge_name.toLowerCase().includes(q);
    const matchDate = !filterDate || cl.cause_date === filterDate;
    const matchCourt = !filterCourt || cl.court_name === filterCourt;
    const matchBench = !filterBench || cl.bench === filterBench;
    const matchJudge = !filterJudge || cl.judge_name.toLowerCase().includes(filterJudge.toLowerCase());
    const matchStatus = !filterStatus || cl.status === filterStatus;
    return matchSearch && matchDate && matchCourt && matchBench && matchJudge && matchStatus;
  });

  const hasFilters = search || filterDate || filterCourt || filterBench || filterJudge || filterStatus;
  const clearFilters = () => {
    setSearch(''); setFilterDate(''); setFilterCourt(''); setFilterBench(''); setFilterJudge(''); setFilterStatus('');
  };

  const judges = [...new Set(causeList.map(cl => cl.judge_name))].sort();

  return (
    <div className="space-y-4">
      {/* Demo note */}
      <div className="flex items-start gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Showing today's sample cause list data. Click <strong>Run Daily Sync</strong> in the header to refresh.
          Real eCourts API integration is configured in <strong>Settings</strong>.
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by case no, CNR, judge…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" size="icon" onClick={() => setShowFilters(!showFilters)} className="h-10 w-10">
          <Filter className="w-4 h-4" />
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 gap-1 text-muted-foreground">
            <X className="w-3 h-3" /> Clear
          </Button>
        )}
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Court</Label>
              <Select value={filterCourt || 'all'} onValueChange={v => setFilterCourt(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {COURTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bench</Label>
              <Input placeholder="All" value={filterBench} onChange={e => setFilterBench(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Judge</Label>
              <Select value={filterJudge || 'all'} onValueChange={v => setFilterJudge(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {judges.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus || 'all'} onValueChange={v => setFilterStatus(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <List className="w-4 h-4 text-indigo-600" />
            Cause List
            <Badge variant="outline" className="ml-1">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <List className="w-8 h-8 mb-2 mx-auto opacity-30" />
              <p className="text-sm">No cause list records found.</p>
            </div>
          ) : (
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Cause Date</TableHead>
                  <TableHead>Court Name</TableHead>
                  <TableHead>Bench</TableHead>
                  <TableHead>Court Hall</TableHead>
                  <TableHead>Judge</TableHead>
                  <TableHead>Listing No</TableHead>
                  <TableHead>Case Number</TableHead>
                  <TableHead>CNR Number</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(cl => (
                  <TableRow key={cl.id}>
                    <TableCell className="text-xs font-medium">{formatDate(cl.cause_date)}</TableCell>
                    <TableCell className="text-xs">{cl.court_name}</TableCell>
                    <TableCell className="text-xs">{cl.bench}</TableCell>
                    <TableCell className="text-xs font-medium">{cl.court_no}</TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">{cl.judge_name}</TableCell>
                    <TableCell className="text-center font-semibold text-sm">{cl.listing_no}</TableCell>
                    <TableCell className="font-mono text-xs">{cl.case_number}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{cl.cnr_number || '—'}</TableCell>
                    <TableCell><StatusBadge status={cl.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
