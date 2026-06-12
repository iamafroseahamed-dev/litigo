import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchCases } from '@/services/mockCaseService';
import { fetchMatches } from '@/services/mockCauseListService';
import { fetchNotifications } from '@/services/mockNotificationService';
import type { Case, CauseListMatch, Notification } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, BarChart3, Filter } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import * as XLSX from 'xlsx';

type ReportType = 'cases' | 'matches' | 'notifications';

export default function ReportsPage() {
  const { user } = useAuth();
  const [reportType, setReportType] = useState<ReportType>('notifications');
  const [cases, setCases] = useState<Case[]>([]);
  const [matches, setMatches] = useState<CauseListMatch[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterAdvocate, setFilterAdvocate] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterNotifStatus, setFilterNotifStatus] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [c, m, n] = await Promise.all([
        fetchCases(user.organization.id),
        fetchMatches(user.organization.id),
        fetchNotifications(user.organization.id),
      ]);
      setCases(c); setMatches(m); setNotifications(n);
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Filtered data per report type
  const filteredCases = cases.filter(c => {
    const matchCourt = !filterCourt || c.court_name.toLowerCase().includes(filterCourt.toLowerCase());
    const matchAdv = !filterAdvocate || c.advocate_name.toLowerCase().includes(filterAdvocate.toLowerCase());
    const matchClient = !filterClient || c.client_name.toLowerCase().includes(filterClient.toLowerCase());
    const matchDate = (!dateFrom || c.created_at >= dateFrom) && (!dateTo || c.created_at <= dateTo + 'T23:59:59');
    return matchCourt && matchAdv && matchClient && matchDate;
  });

  const filteredNotifs = notifications.filter(n => {
    const matchStatus = !filterNotifStatus || n.status === filterNotifStatus;
    const matchDate = (!dateFrom || (n.sent_time ?? n.created_at) >= dateFrom) && (!dateTo || (n.sent_time ?? n.created_at) <= dateTo + 'T23:59:59');
    return matchStatus && matchDate;
  });

  const filteredMatches = matches.filter(m => {
    const matchDate = (!dateFrom || m.matched_on >= dateFrom) && (!dateTo || m.matched_on <= dateTo);
    const matchCourt = !filterCourt || m.cause_list?.court_name.toLowerCase().includes(filterCourt.toLowerCase());
    return matchDate && matchCourt;
  });

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();

    if (reportType === 'cases') {
      const data = filteredCases.map(c => ({
        'Case Number': c.case_number, 'CNR': c.cnr_number, 'Court': c.court_name,
        'Bench': c.bench, 'Petitioner': c.petitioner, 'Respondent': c.respondent,
        'Advocate': c.advocate_name, 'Client': c.client_name, 'Status': c.active ? 'Active' : 'Inactive',
        'Created': formatDate(c.created_at),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Cases');
      XLSX.writeFile(wb, 'cases_report.xlsx');
    } else if (reportType === 'matches') {
      const data = filteredMatches.map(m => ({
        'Case Number': m.case?.case_number, 'CNR': m.case?.cnr_number,
        'Client': m.case?.client_name, 'Advocate': m.case?.advocate_name,
        'Court': m.cause_list?.court_name, 'Bench': m.cause_list?.bench,
        'Judge': m.cause_list?.judge_name, 'Match Type': m.match_type,
        'Confidence': m.match_confidence + '%', 'Date': m.matched_on,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Matches');
      XLSX.writeFile(wb, 'matched_cases_report.xlsx');
    } else {
      const data = filteredNotifs.map(n => ({
        'Case Number': n.case?.case_number, 'Client': n.case?.client_name,
        'Type': n.notification_type, 'Recipient': n.recipient,
        'Status': n.status, 'Sent Time': n.sent_time ? formatDateTime(n.sent_time) : '—',
        'Response': n.response ?? '—', 'Retries': n.retry_count,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Notifications');
      XLSX.writeFile(wb, 'notifications_report.xlsx');
    }
  };

  const advocates = [...new Set(cases.map(c => c.advocate_name))].sort();
  const courts = [...new Set(cases.map(c => c.court_name))].sort();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
            <SelectTrigger className="h-10 w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="notifications">Notifications Report</SelectItem>
              <SelectItem value="matches">Matched Cases Report</SelectItem>
              <SelectItem value="cases">Cases Report</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => setShowFilters(!showFilters)} className="h-10 w-10">
            <Filter className="w-4 h-4" />
          </Button>
        </div>
        <Button onClick={exportToExcel} className="h-10 w-full gap-2 sm:w-auto">
          <Download className="w-4 h-4" /> Export to Excel
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1.5">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Court</Label>
              <Select value={filterCourt || 'all'} onValueChange={v => setFilterCourt(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {courts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Advocate</Label>
              <Select value={filterAdvocate || 'all'} onValueChange={v => setFilterAdvocate(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {advocates.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client (search)</Label>
              <Input placeholder="Client name…" value={filterClient} onChange={e => setFilterClient(e.target.value)} className="h-8 text-xs" />
            </div>
            {reportType === 'notifications' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Notif Status</Label>
                <Select value={filterNotifStatus || 'all'} onValueChange={v => setFilterNotifStatus(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            {reportType === 'cases' ? 'Cases' : reportType === 'matches' ? 'Matched Cases' : 'Notifications'}
            <Badge variant="outline" className="ml-1">
              {reportType === 'cases' ? filteredCases.length : reportType === 'matches' ? filteredMatches.length : filteredNotifs.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : reportType === 'cases' ? (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Advocate</TableHead>
                  <TableHead>Court</TableHead>
                  <TableHead>Bench</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCases.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.case_number}</TableCell>
                    <TableCell className="text-xs">{c.client_name}</TableCell>
                    <TableCell className="text-xs">{c.advocate_name}</TableCell>
                    <TableCell className="text-xs">{c.court_name}</TableCell>
                    <TableCell className="text-xs">{c.bench}</TableCell>
                    <TableCell><Badge variant={c.active ? 'success' : 'secondary'} className="text-xs">{c.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell className="text-xs">{formatDate(c.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : reportType === 'matches' ? (
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Advocate</TableHead>
                  <TableHead>Court</TableHead>
                  <TableHead>Judge</TableHead>
                  <TableHead>Match Type</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatches.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.case?.case_number}</TableCell>
                    <TableCell className="text-xs">{m.case?.client_name}</TableCell>
                    <TableCell className="text-xs">{m.case?.advocate_name}</TableCell>
                    <TableCell className="text-xs">{m.cause_list?.court_name}</TableCell>
                    <TableCell className="text-xs">{m.cause_list?.judge_name}</TableCell>
                    <TableCell><Badge variant="info" className="text-xs">{m.match_type}</Badge></TableCell>
                    <TableCell className="text-xs font-bold text-green-700">{m.match_confidence}%</TableCell>
                    <TableCell className="text-xs">{formatDate(m.matched_on)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotifs.map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.case?.case_number}</TableCell>
                    <TableCell className="text-xs">{n.case?.client_name}</TableCell>
                    <TableCell className="capitalize text-xs">{n.notification_type}</TableCell>
                    <TableCell className="font-mono text-xs">{n.recipient}</TableCell>
                    <TableCell>
                      <Badge variant={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'destructive' : 'warning'} className="text-xs capitalize">{n.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{n.sent_time ? formatDateTime(n.sent_time) : '—'}</TableCell>
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
