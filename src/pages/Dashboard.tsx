import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DistrictDrawer } from '@/components/DistrictDrawer';
import { TNDistrictMap } from '@/components/TNDistrictMap';
import { useOrg } from '@/lib/orgContext';
import { fetchOrganizations } from '@/lib/organizations';
import { fetchExecutiveAnalytics, type DashboardFilters, type KpiTrend } from '@/lib/dashboardQueries';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileDown,
  Gavel,
  LayoutDashboard,
  Link2,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

const PIE_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#0ea5e9'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysRemaining(iso: string | null | undefined): number {
  if (!iso) return 9999;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 9999;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

function Sparkline({ points }: { points: number[] }) {
  const data = points.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendPill({ trend }: { trend: KpiTrend | undefined }) {
  const delta = trend?.deltaPct ?? 0;
  const up = delta >= 0;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
      {up ? '+' : ''}{delta}% vs previous month
    </span>
  );
}

function KpiCard({
  label,
  value,
  trend,
  icon: Icon,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  trend?: KpiTrend;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  onClick?: () => void;
}) {
  const body = (
    <Card className="h-full overflow-hidden border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="text-3xl font-bold tabular-nums">{value.toLocaleString('en-IN')}</p>
        <div className="mt-2">
          <TrendPill trend={trend} />
        </div>
        <div className="mt-2">
          <Sparkline points={trend?.sparkline ?? [0, 0, 0, 0, 0, 0]} />
        </div>
      </CardContent>
    </Card>
  );
  if (!onClick) return body;
  return <button type="button" onClick={onClick} className="w-full text-left">{body}</button>;
}

function MatrixTable({ title, rows }: { title: string; rows: Array<{ row: string; values: Record<string, number> }> }) {
  const cols = rows[0] ? Object.keys(rows[0].values) : [];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Advocate</th>
                  {cols.map(c => <th key={c} className="px-2 py-2 text-right font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.row} className="border-b last:border-0">
                    <td className="px-2 py-2 font-medium">{r.row}</td>
                    {cols.map(c => <td key={`${r.row}-${c}`} className="px-2 py-2 text-right tabular-nums">{r.values[c] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { orgId, org, isPlatformAdmin } = useOrg();
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [platformOrgId, setPlatformOrgId] = useState<string>('__all__');
  const [filters, setFilters] = useState<DashboardFilters>({});

  const orgQ = useQuery({
    queryKey: ['dashboard-orgs', isPlatformAdmin],
    queryFn: fetchOrganizations,
    enabled: isPlatformAdmin,
    staleTime: 10 * 60 * 1000,
  });

  const effectiveOrgId = isPlatformAdmin ? (platformOrgId === '__all__' ? null : platformOrgId) : orgId;

  const exec = useQuery({
    queryKey: ['executive-analytics', effectiveOrgId, filters],
    queryFn: () => fetchExecutiveAnalytics(effectiveOrgId, { ...filters, organizationId: effectiveOrgId ?? undefined }),
    staleTime: 5 * 60 * 1000,
  });

  const a = exec.data;
  const kp = a?.kpis;
  const tr = a?.kpiTrends;
  const drill = selectedDistrict ? a?.districtDetails[selectedDistrict] : undefined;

  const caseStatusPie = useMemo(() => ([
    { name: 'Pending', value: kp?.pendingCases ?? 0 },
    { name: 'Disposed', value: kp?.disposedCases ?? 0 },
    { name: 'Active', value: kp?.activeCases ?? 0 },
  ]), [kp?.activeCases, kp?.disposedCases, kp?.pendingCases]);

  const topDistricts = useMemo(() => (a?.districts ?? []).slice(0, 10), [a?.districts]);
  const heatCols = useMemo(() => Array.from(new Set((a?.courtCaseTypeHeatmap ?? []).map(x => x.caseType))), [a?.courtCaseTypeHeatmap]);
  const heatRows = useMemo(() => Array.from(new Set((a?.courtCaseTypeHeatmap ?? []).map(x => x.court))), [a?.courtCaseTypeHeatmap]);
  const heatMap = useMemo(() => {
    const m = new Map<string, number>();
    (a?.courtCaseTypeHeatmap ?? []).forEach(x => m.set(`${x.court}|||${x.caseType}`, x.value));
    return m;
  }, [a?.courtCaseTypeHeatmap]);

  const pendingTrend = useMemo(() => {
    let running = 0;
    return (a?.trend ?? []).map(t => {
      running += t.newCases - t.casesDisposed;
      return { ...t, pending: Math.max(0, running) };
    });
  }, [a?.trend]);

  function setFilter<K extends keyof DashboardFilters>(key: K, value: string) {
    setFilters(prev => ({ ...prev, [key]: value === '__all__' ? undefined : value }));
  }

  function clearFilters() {
    setSelectedDistrict(null);
    setFilters({});
    if (isPlatformAdmin) setPlatformOrgId('__all__');
  }

  function exportCsvCurrent() {
    const rows = (a?.advocates ?? []).map(x => ({
      advocate: x.advocate,
      total_cases: x.assignedCases,
      pending: x.pendingCases,
      disposed: x.disposedCases,
      upcoming: x.upcomingHearings,
      success_pct: x.successRate,
      avg_disposal_days: x.averageDisposalDays,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Advocates');
    XLSX.writeFile(wb, 'adalat360_dashboard_current.csv');
  }

  function exportExcelDashboard() {
    const wb = XLSX.utils.book_new();
    const kpiRows = [
      { metric: 'Total Cases', value: kp?.totalCases ?? 0 },
      { metric: 'Pending Cases', value: kp?.pendingCases ?? 0 },
      { metric: 'Disposed Cases', value: kp?.disposedCases ?? 0 },
      { metric: 'Upcoming Hearings (30d)', value: kp?.upcomingHearings30 ?? 0 },
      { metric: 'Urgent Hearings (7d)', value: kp?.urgentHearings7 ?? 0 },
      { metric: 'Active Cases', value: kp?.activeCases ?? 0 },
      { metric: 'Update Required', value: kp?.updateRequired ?? 0 },
      { metric: 'CLA Party Cases', value: kp?.claPartyCases ?? 0 },
      { metric: 'Sensitive Cases', value: kp?.sensitiveCases ?? 0 },
      { metric: 'Total Advocates', value: kp?.totalAdvocates ?? 0 },
      { metric: 'Average Disposal Time', value: kp?.averageDisposalDays ?? 0 },
      { metric: 'Case Success Rate', value: kp?.caseSuccessRate ?? 0 },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPIs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a?.caseTypeBreakdown ?? []), 'Case Types');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a?.districts ?? []), 'Districts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a?.advocates ?? []), 'Advocates');
    XLSX.writeFile(wb, 'adalat360_dashboard.xlsx');
  }

  function exportPdf() {
    window.print();
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive Litigation Dashboard</h1>
          <p className="text-sm text-muted-foreground">Modern analytics view for Government Legal Departments across Tamil Nadu.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={exportCsvCurrent}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button variant="outline" className="gap-2" onClick={exportExcelDashboard}><FileDown className="h-4 w-4" /> Export Excel</Button>
          <Button variant="outline" className="gap-2" onClick={exportPdf}><FileDown className="h-4 w-4" /> Export PDF</Button>
          <Button variant="outline" className="gap-2" onClick={() => void exec.refetch()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
      </div>

      <Card className="sticky top-0 z-20 border-blue-100 bg-background/95 backdrop-blur">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><LayoutDashboard className="h-4 w-4 text-blue-600" /> Sticky Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {isPlatformAdmin && (
              <Select value={platformOrgId} onValueChange={setPlatformOrgId}>
                <SelectTrigger><SelectValue placeholder="Organization" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Organizations</SelectItem>
                  {(orgQ.data ?? []).map(o => <SelectItem key={o.id} value={o.id}>{o.short_name || o.organization_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <Select value={filters.court ?? '__all__'} onValueChange={v => setFilter('court', v)}>
              <SelectTrigger><SelectValue placeholder="Court" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Courts</SelectItem>
                {(a?.filterMeta.courts ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.district ?? '__all__'} onValueChange={v => {
              setFilter('district', v);
              setSelectedDistrict(v === '__all__' ? null : v);
            }}>
              <SelectTrigger><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Districts</SelectItem>
                {(a?.filterMeta.districts ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.section ?? '__all__'} onValueChange={v => setFilter('section', v)}>
              <SelectTrigger><SelectValue placeholder="Section" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Sections</SelectItem>
                {(a?.filterMeta.sections ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.caseType ?? '__all__'} onValueChange={v => setFilter('caseType', v)}>
              <SelectTrigger><SelectValue placeholder="Case Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Case Types</SelectItem>
                {(a?.filterMeta.caseTypes ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.advocate ?? '__all__'} onValueChange={v => setFilter('advocate', v)}>
              <SelectTrigger><SelectValue placeholder="Advocate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Advocates</SelectItem>
                {(a?.filterMeta.advocates ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.caseStatus ?? '__all__'} onValueChange={v => setFilter('caseStatus', v)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Statuses</SelectItem>
                {(a?.filterMeta.statuses ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.claParty ?? '__all__'} onValueChange={v => setFilter('claParty', v)}>
              <SelectTrigger><SelectValue placeholder="CLA Party" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All CLA Parties</SelectItem>
                {(a?.filterMeta.claParty ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.sensitive ?? '__all__'} onValueChange={v => setFilter('sensitive', v)}>
              <SelectTrigger><SelectValue placeholder="Sensitive" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                {(a?.filterMeta.sensitive ?? []).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={filters.dateFrom ?? ''} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value || undefined }))} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={filters.dateTo ?? ''} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value || undefined }))} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={clearFilters}>Reset</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {exec.isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Cases" value={kp?.totalCases ?? 0} trend={tr?.totalCases} icon={Briefcase} accent="bg-slate-100 text-slate-700" onClick={() => setFilter('caseStatus', '__all__')} />
        <KpiCard label="Pending Cases" value={kp?.pendingCases ?? 0} trend={tr?.pendingCases} icon={Clock} accent="bg-amber-100 text-amber-700" onClick={() => setFilter('caseStatus', 'Pending')} />
        <KpiCard label="Disposed Cases" value={kp?.disposedCases ?? 0} trend={tr?.disposedCases} icon={CheckCircle2} accent="bg-emerald-100 text-emerald-700" onClick={() => setFilter('caseStatus', 'Disposed')} />
        <KpiCard label="Upcoming Hearings (30d)" value={kp?.upcomingHearings30 ?? 0} trend={tr?.upcomingHearings30} icon={CalendarClock} accent="bg-indigo-100 text-indigo-700" />
        <KpiCard label="Urgent Hearings (7d)" value={kp?.urgentHearings7 ?? 0} trend={tr?.urgentHearings7} icon={AlertTriangle} accent="bg-rose-100 text-rose-700" />
        <KpiCard label="Active Cases" value={kp?.activeCases ?? 0} trend={tr?.activeCases} icon={Gavel} accent="bg-blue-100 text-blue-700" onClick={() => setFilter('caseStatus', 'Active')} />
        <KpiCard label="Update Required" value={kp?.updateRequired ?? 0} trend={tr?.updateRequired} icon={Activity} accent="bg-orange-100 text-orange-700" />
        <KpiCard label="CLA Party Cases" value={kp?.claPartyCases ?? 0} trend={tr?.claPartyCases} icon={Link2} accent="bg-cyan-100 text-cyan-700" />
        <KpiCard label="Sensitive Cases" value={kp?.sensitiveCases ?? 0} trend={tr?.sensitiveCases} icon={ShieldAlert} accent="bg-red-100 text-red-700" />
        <KpiCard label="Total Advocates" value={kp?.totalAdvocates ?? 0} trend={tr?.totalAdvocates} icon={Users} accent="bg-lime-100 text-lime-700" />
        <KpiCard label="Average Disposal Time" value={kp?.averageDisposalDays ?? 0} trend={tr?.averageDisposalDays} icon={TrendingUp} accent="bg-violet-100 text-violet-700" />
        <KpiCard label="Case Success Rate %" value={Math.round(kp?.caseSuccessRate ?? 0)} trend={tr?.caseSuccessRate} icon={Target} accent="bg-emerald-100 text-emerald-700" />
      </div>

      <TNDistrictMap
        districts={a?.districts ?? []}
        details={a?.districtDetails}
        selected={selectedDistrict}
        onSelect={(district) => {
          const next = district || '';
          const chosen = next ? next : null;
          setSelectedDistrict(chosen);
          setFilters(prev => ({ ...prev, district: chosen || undefined }));
        }}
        loading={exec.isLoading}
      />

      <DistrictDrawer
        district={selectedDistrict}
        detail={drill}
        open={!!selectedDistrict}
        onClose={() => {
          setSelectedDistrict(null);
          setFilters(prev => ({ ...prev, district: undefined }));
        }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Court Analytics - Cases by Court</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.courts ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" hide />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">District Analytics - Top 10</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDistricts} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="district" width={120} />
                <Tooltip />
                <Bar dataKey="total" fill="#0284c7" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Case Type Analytics</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a?.caseTypeBreakdown ?? []} layout="vertical" margin={{ left: 16, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="label" width={160} />
                  <Tooltip formatter={(v, _n, ctx) => [v, `${(ctx as { payload?: { percent?: number } }).payload?.percent ?? 0}%`]} />
                  <Bar dataKey="value" fill="#4f46e5" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs">
              {(a?.caseTypeBreakdown ?? []).slice(0, 6).map(r => (
                <button key={r.label} type="button" className="flex items-center justify-between rounded border px-2 py-1 text-left hover:bg-muted" onClick={() => setFilter('caseType', r.label)}>
                  <span>{r.label}</span>
                  <span className="font-semibold tabular-nums">{r.value} ({r.percent}%)</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Section Analytics</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.sections ?? []} layout="vertical" margin={{ left: 16, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#0f766e" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cases by Advocate (Top 10)</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(a?.advocates ?? []).slice(0, 10)} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="advocate" width={150} />
                <Tooltip />
                <Bar dataKey="assignedCases" fill="#059669" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Advocate Workload (Stacked)</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.advocateWorkload ?? []} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="advocate" width={150} />
                <Tooltip />
                <Legend />
                <Bar dataKey="pending" stackId="a" fill="#f59e0b" />
                <Bar dataKey="disposed" stackId="a" fill="#10b981" />
                <Bar dataKey="upcoming" stackId="a" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Advocate Performance</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Advocate</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Disposed</th>
                  <th className="px-3 py-2 text-right">Success %</th>
                  <th className="px-3 py-2 text-right">Avg Disposal Days</th>
                  <th className="px-3 py-2 text-right">Upcoming</th>
                </tr>
              </thead>
              <tbody>
                {(a?.advocates ?? []).map(r => (
                  <tr key={r.advocate} className="border-b last:border-0">
                    <td className="px-3 py-2">{r.advocate}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.assignedCases}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.pendingCases}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.disposedCases}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.successRate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.averageDisposalDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-indigo-600">{r.upcomingHearings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MatrixTable title="Advocate vs Case Type Matrix" rows={a?.advocateCaseTypeMatrix ?? []} />
        <MatrixTable title="Advocate vs Section Matrix" rows={a?.advocateSectionMatrix ?? []} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Court vs Case Type Heatmap</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-2">Court</th>
                  {heatCols.map(c => <th key={c} className="px-2 py-2 text-right">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatRows.map(row => (
                  <tr key={row} className="border-b last:border-0">
                    <td className="px-2 py-2 font-medium">{row}</td>
                    {heatCols.map(col => {
                      const value = heatMap.get(`${row}|||${col}`) ?? 0;
                      const bg = value > 50 ? 'bg-blue-700 text-white' : value > 25 ? 'bg-blue-500 text-white' : value > 10 ? 'bg-blue-200' : value > 0 ? 'bg-blue-100' : 'bg-slate-50';
                      return <td key={`${row}-${col}`} className={`px-2 py-2 text-right tabular-nums ${bg}`}>{value}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Upcoming Hearings</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Case</th>
                  <th className="px-3 py-2">Court</th>
                  <th className="px-3 py-2">Judge</th>
                  <th className="px-3 py-2">District</th>
                  <th className="px-3 py-2">Advocate</th>
                  <th className="px-3 py-2">Next Hearing</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">VC Link</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(a?.upcomingHearings ?? []).map(r => {
                  const d = daysRemaining(r.hearingDate);
                  const urgentClass = d === 0 ? 'bg-red-50' : d === 1 ? 'bg-amber-50' : d <= 7 ? 'bg-indigo-50/60' : '';
                  return (
                    <tr key={r.caseId} className={`border-b last:border-0 ${urgentClass}`}>
                      <td className="px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                      <td className="px-3 py-2">{r.court ?? '\u2014'}</td>
                      <td className="px-3 py-2">{r.judge ?? '\u2014'}</td>
                      <td className="px-3 py-2">{r.district ?? '\u2014'}</td>
                      <td className="px-3 py-2">{r.advocate ?? '\u2014'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.hearingDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d === 9999 ? '\u2014' : d}</td>
                      <td className="px-3 py-2">{r.priority}</td>
                      <td className="px-3 py-2">{r.status ?? '\u2014'}</td>
                      <td className="px-3 py-2">{r.vcLink ? <a href={r.vcLink} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open</a> : '\u2014'}</td>
                      <td className="px-3 py-2"><Button size="sm" variant="outline">Open Case</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Disposal Analytics</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={a?.disposalBreakdown ?? []} dataKey="value" nameKey="label" innerRadius={70} outerRadius={110}>
                  {(a?.disposalBreakdown ?? []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground">Average Disposal Duration: <span className="font-semibold text-foreground">{kp?.averageDisposalDays ?? 0} days</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Hearing Trend (Monthly)</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pendingTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="newCases" name="Filed" stroke="#2563eb" dot={false} />
                <Line type="monotone" dataKey="casesDisposed" name="Disposed" stroke="#16a34a" dot={false} />
                <Line type="monotone" dataKey="pending" name="Pending" stroke="#d97706" dot={false} />
                <Line type="monotone" dataKey="hearings" name="Hearings" stroke="#7c3aed" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Filing Trend - Last 24 Months</CardTitle></CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a?.filingTrend24 ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" interval={1} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="newCases" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {isPlatformAdmin && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Organization Analytics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Organization</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                    <th className="px-3 py-2 text-right">Disposed</th>
                    <th className="px-3 py-2 text-right">Credits</th>
                    <th className="px-3 py-2 text-right">Advocates</th>
                    <th className="px-3 py-2 text-right">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {(a?.organizationAnalytics ?? []).map(r => (
                    <tr key={r.organizationId} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.totalCases}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.pendingCases}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.disposedCases}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.creditsRemaining}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.advocates}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!exec.isLoading && (a?.kpis.totalCases ?? 0) === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No analytics data found for the selected filters.</CardContent>
        </Card>
      )}

      {!exec.isLoading && exec.error && (
        <Card>
          <CardContent className="py-8 text-sm text-red-600">{(exec.error as Error).message}</CardContent>
        </Card>
      )}

      <Card className="border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground">Performance: dashboard computations are memoized, query results are cached, and data refreshes only on manual refresh or mutation-triggered cache invalidation.</CardContent>
      </Card>
    </div>
  );
}
