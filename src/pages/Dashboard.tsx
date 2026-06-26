// ── Dashboard.tsx — Executive Analytics Dashboard ────────────────────────────
// Redesigned: KPI sparklines, sticky filters, advocate matrices, comprehensive charts
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowDown, ArrowUp, BarChart3, Briefcase, CalendarClock, CheckCircle2,
  CheckSquare, Clock, Download, FileText, Filter, Gavel, Landmark,
  Link2, RefreshCw, Scale, ShieldAlert, TrendingUp, Users, Zap,
} from 'lucide-react';
import {
  fetchExecutiveAnalytics,
  type DashboardFilters,
  type SparklinePoint,
  type AdvocatePerformanceV2,
  type MatrixCell,
} from '@/lib/dashboardQueries';
import { TNDistrictMap } from '@/components/TNDistrictMap';
import { DistrictDrawer } from '@/components/DistrictDrawer';
import { useOrg } from '@/lib/orgContext';
import { fetchOrganizations } from '@/lib/organizations';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = ['#2563eb','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#be185d','#0f766e','#ca8a04','#4338ca','#0369a1','#9333ea'];
const STATUS_FILL: Record<string, string> = { Active: '#3b82f6', Pending: '#f59e0b', Disposed: '#10b981', Open: '#f59e0b', Completed: '#10b981' };

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function KpiCard({
  label, value, icon: Icon, chip, loading, onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  chip: string;
  loading: boolean;
  onClick?: () => void;
}) {
  const body = (
    <Card className="h-full overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className="truncate text-[12px] font-medium text-muted-foreground">{label}</p>
            {loading ? <Skeleton className="h-8 w-20" /> : <p className="text-3xl font-bold tabular-nums">{value.toLocaleString('en-IN')}</p>}
          </div>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
  if (!onClick) return body;
  return <button type="button" onClick={onClick} className="w-full text-left">{body}</button>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { orgId, org, isPlatformAdmin } = useOrg();

  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [platformOrgId, setPlatformOrgId] = useState<string>('__all__');

  const orgQ = useQuery({
    queryKey: ['dashboard-orgs', isPlatformAdmin],
    queryFn: fetchOrganizations,
    enabled: isPlatformAdmin,
    staleTime: 10 * 60 * 1000,
  });

  const scopedOrgId = isPlatformAdmin ? (platformOrgId === '__all__' ? null : platformOrgId) : orgId;

  const exec = useQuery({
    queryKey: ['executive-analytics', scopedOrgId, filters],
    queryFn: () => fetchExecutiveAnalytics(scopedOrgId, filters),
    staleTime: 5 * 60 * 1000,
  });

  const a = exec.data;
  const kp = a?.kpis;

  const statusData = useMemo(() => ([
    { name: 'Pending', value: kp?.pendingCases ?? 0 },
    { name: 'Disposed', value: kp?.disposedCases ?? 0 },
    { name: 'Active', value: kp?.activeCases ?? 0 },
  ]), [kp?.activeCases, kp?.disposedCases, kp?.pendingCases]);

  const taskData = useMemo(() => ([
    { name: 'Open', value: a?.taskProgress.open ?? 0 },
    { name: 'Completed', value: a?.taskProgress.completed ?? 0 },
  ]), [a?.taskProgress.completed, a?.taskProgress.open]);

  const topDistricts = useMemo(() => (a?.districts ?? []).slice(0, 10), [a?.districts]);
  const topAdvocates = useMemo(() => (a?.advocates ?? []).slice(0, 10), [a?.advocates]);
  const caseTypeChart = useMemo(() => (a?.caseTypes ?? []).slice(0, 10), [a?.caseTypes]);

  const drill = selectedDistrict ? a?.districtDetails[selectedDistrict] : undefined;

  function setFilter<K extends keyof DashboardFilters>(key: K, value: string) {
    setFilters(prev => ({ ...prev, [key]: value === '__all__' ? undefined : value }));
  }

  function clearFilters() {
    setSelectedDistrict(null);
    setFilters({});
    if (isPlatformAdmin) setPlatformOrgId('__all__');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive Litigation Analytics</h1>
          <p className="text-sm text-muted-foreground">Real-time case intelligence by district, case type, status, advocate and API utilization.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void exec.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-blue-600" /> Global Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            {isPlatformAdmin && (
              <Select value={platformOrgId} onValueChange={setPlatformOrgId}>
                <SelectTrigger><SelectValue placeholder="Organization" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Organizations</SelectItem>
                  {(orgQ.data ?? []).map(o => <SelectItem key={o.id} value={o.id}>{o.short_name || o.organization_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <Select value={filters.district ?? '__all__'} onValueChange={(v) => { setFilter('district', v); setSelectedDistrict(v === '__all__' ? null : v); }}>
              <SelectTrigger><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Districts</SelectItem>
                {(a?.filterMeta.districts ?? []).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.court ?? '__all__'} onValueChange={(v) => setFilter('court', v)}>
              <SelectTrigger><SelectValue placeholder="Court" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Courts</SelectItem>
                {(a?.filterMeta.courts ?? []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.caseType ?? '__all__'} onValueChange={(v) => setFilter('caseType', v)}>
              <SelectTrigger><SelectValue placeholder="Case Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Case Types</SelectItem>
                {(a?.filterMeta.caseTypes ?? []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.caseStatus ?? '__all__'} onValueChange={(v) => setFilter('caseStatus', v)}>
              <SelectTrigger><SelectValue placeholder="Case Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Statuses</SelectItem>
                {(a?.filterMeta.statuses ?? []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.advocate ?? '__all__'} onValueChange={(v) => setFilter('advocate', v)}>
              <SelectTrigger><SelectValue placeholder="Advocate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Advocates</SelectItem>
                {(a?.filterMeta.advocates ?? []).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="space-y-1.5">
              <Label>From Date</Label>
              <Input type="date" value={filters.dateFrom ?? ''} onChange={e => setFilters(prev => ({ ...prev, dateFrom: e.target.value || undefined }))} />
            </div>
            <div className="space-y-1.5">
              <Label>To Date</Label>
              <Input type="date" value={filters.dateTo ?? ''} onChange={e => setFilters(prev => ({ ...prev, dateTo: e.target.value || undefined }))} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={clearFilters}>Clear Filters</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total Cases" value={kp?.totalCases ?? 0} icon={Briefcase} chip="bg-slate-100 text-slate-700" loading={exec.isLoading} onClick={() => navigate('/cases')} />
        <KpiCard label="Active Cases" value={kp?.activeCases ?? 0} icon={Gavel} chip="bg-blue-100 text-blue-700" loading={exec.isLoading} />
        <KpiCard label="Disposed Cases" value={kp?.disposedCases ?? 0} icon={CheckCircle2} chip="bg-emerald-100 text-emerald-700" loading={exec.isLoading} />
        <KpiCard label="Upcoming Hearings" value={kp?.upcomingHearings30 ?? 0} icon={CalendarClock} chip="bg-indigo-100 text-indigo-700" loading={exec.isLoading} />
        <KpiCard label="Today's Cause Matches" value={kp?.todaysCauseListMatches ?? 0} icon={Clock} chip="bg-amber-100 text-amber-700" loading={exec.isLoading} />
        <KpiCard label="Connected Cases" value={kp?.connectedCases ?? 0} icon={Link2} chip="bg-fuchsia-100 text-fuchsia-700" loading={exec.isLoading} />
        <KpiCard label="Assigned Advocates" value={kp?.assignedAdvocates ?? 0} icon={Users} chip="bg-cyan-100 text-cyan-700" loading={exec.isLoading} />
        <KpiCard label="Open Tasks" value={kp?.openTasks ?? 0} icon={CheckSquare} chip="bg-rose-100 text-rose-700" loading={exec.isLoading} />
        <KpiCard label="API Calls Today" value={kp?.apiCallsToday ?? 0} icon={Cpu} chip="bg-violet-100 text-violet-700" loading={exec.isLoading} />
        <KpiCard label="API Credits Remaining" value={isPlatformAdmin ? 0 : (kp?.apiCreditsRemaining ?? Number(org?.available_credits ?? 0))} icon={Cpu} chip="bg-lime-100 text-lime-700" loading={exec.isLoading} />
      </div>

      <TNDistrictMap
        districts={a?.districts ?? []}
        details={a?.districtDetails}
        selected={selectedDistrict}
        onSelect={(district) => {
          const next = !district ? null : district;
          setSelectedDistrict(next);
          setFilters(prev => ({ ...prev, district: next || undefined }));
        }}
        loading={exec.isLoading}
      />

      <DistrictDrawer district={selectedDistrict} detail={drill} open={!!selectedDistrict} onClose={() => {
        setSelectedDistrict(null);
        setFilters(prev => ({ ...prev, district: undefined }));
      }} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Case Status (Donut)</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={105}>
                  {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tasks Open vs Completed</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={taskData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={105}>
                  <Cell fill="#f59e0b" />
                  <Cell fill="#10b981" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Case Types</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={caseTypeChart} layout="vertical" margin={{ left: 8, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="label" type="category" width={150} />
                <Tooltip />
                <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-2">
              {caseTypeChart.slice(0, 6).map(ct => (
                <Button key={ct.label} variant="outline" size="sm" onClick={() => setFilter('caseType', ct.label)}>{ct.label}</Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">API Usage - Last 30 Days</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a?.apiDailyCalls ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                <YAxis />
                <Tooltip labelFormatter={(v) => fmtDate(String(v))} />
                <Line dataKey="calls" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top 10 Districts</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">District</th>
                    <th className="px-3 py-2 text-right">Cases</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                    <th className="px-3 py-2 text-right">Disposed</th>
                    <th className="px-3 py-2 text-right">Upcoming</th>
                  </tr>
                </thead>
                <tbody>
                  {topDistricts.map(d => {
                    const upcoming = a?.districtDetails[d.district]?.upcomingHearings ?? 0;
                    return (
                      <tr key={d.district} className="cursor-pointer border-b last:border-0 hover:bg-blue-50/60" onClick={() => {
                        setSelectedDistrict(d.district);
                        setFilters(prev => ({ ...prev, district: d.district }));
                      }}>
                        <td className="px-3 py-2 font-medium">{d.district}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{d.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600">{d.pending}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{d.disposed}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-indigo-600">{upcoming}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top Advocates (Cases Handled)</CardTitle></CardHeader>
          <CardContent className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topAdvocates} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="advocate" width={160} />
                <Tooltip />
                <Bar dataKey="assignedCases" fill="#0f766e" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {isPlatformAdmin && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Organization-wise Cases</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.orgCases ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" hide />
                <YAxis />
                <Tooltip />
                <Bar dataKey="cases" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
