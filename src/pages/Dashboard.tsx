import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend,
  AreaChart, Area, LineChart, Line,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Briefcase, Clock, CheckCircle2, CalendarDays, CalendarClock, Gavel,
  ChevronLeft, ChevronRight, ListTodo, AlertTriangle, Link2,
  MapPin, Users, Trophy, Layers, FileText, FolderOpen, ShieldAlert,
} from 'lucide-react';
import {
  fetchCaseStatusBreakdown, fetchDisposalOutcomes,
  fetchHearingsByDate, fetchRecentListings, fetchMostConnectedCases,
  fetchExecutiveAnalytics,
  type CategoryCount,
} from '@/lib/dashboardQueries';
import { TNLitigationHeatMap } from '@/components/TNLitigationHeatMap';
import type { Case } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777', '#0d9488', '#4f46e5', '#ca8a04'];
const STATUS_COLORS: Record<string, string> = {
  Pending: '#d97706',
  Disposed: '#16a34a',
  Active: '#2563eb',
  Unknown: '#94a3b8',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, accent, loading, onClick, danger,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  loading: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  const body = (
    <Card className={`${onClick ? 'h-full transition-colors hover:bg-muted/40' : 'h-full'} ${danger && value > 0 ? 'border-red-300 bg-red-50/40' : ''}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${accent}`} />
        </div>
        {loading
          ? <Skeleton className="mt-2 h-8 w-16" />
          : <p className={`mt-1 text-3xl font-bold ${accent}`}>{value.toLocaleString('en-IN')}</p>}
      </CardContent>
    </Card>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-left" aria-label={label}>
        {body}
      </button>
    );
  }
  return body;
}

// ── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title, loading, empty, height = 300, children,
}: {
  title: string;
  loading: boolean;
  empty: boolean;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : empty ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            No data available.
          </div>
        ) : (
          <div style={{ width: '100%', height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Hearing calendar widget ──────────────────────────────────────────────────

function HearingCalendar({ counts }: { counts: Map<string, number> }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const todayIso = isoLocal(new Date());

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) out.push(null);
    for (let day = 1; day <= daysInMonth; day++) out.push(isoLocal(new Date(year, month, day)));
    return out;
  }, [cursor]);

  const { data: dayHearings, isFetching } = useQuery({
    queryKey: ['hearings-on-date', selected],
    queryFn: async (): Promise<Case[]> => {
      if (!selected) return [];
      const { data, error } = await supabase
        .from('cases')
        .select('id,case_number,court_name,district,next_hearing_date,case_status,petitioner,respondent')
        .eq('next_hearing_date', selected)
        .order('case_number', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Case[];
    },
    enabled: !!selected,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Hearing Calendar</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[120px] text-center text-sm font-medium">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((iso, i) => {
            if (!iso) return <div key={`empty-${i}`} />;
            const count = counts.get(iso) ?? 0;
            const isToday = iso === todayIso;
            const isSelected = iso === selected;
            const day = Number(iso.slice(8, 10));
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelected(iso === selected ? null : iso)}
                className={[
                  'relative flex h-12 flex-col items-center justify-center rounded-md border text-xs transition-colors',
                  isSelected ? 'border-primary bg-primary/10' : 'border-transparent',
                  count > 0 ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-muted',
                  isToday ? 'font-bold text-primary' : '',
                ].join(' ')}
              >
                <span>{day}</span>
                {count > 0 && (
                  <span className="mt-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-sm font-medium">Hearings on {fmtDate(selected)}</p>
            {isFetching ? (
              <Skeleton className="h-16 w-full" />
            ) : !dayHearings || dayHearings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hearings scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {dayHearings.map(h => (
                  <li key={h.id} className="rounded-md border px-3 py-2 text-xs">
                    <p className="font-mono font-medium">{h.case_number}</p>
                    <p className="text-muted-foreground">
                      {[h.court_name, h.district, h.case_status].filter(Boolean).join(' · ') || '\u2014'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Small presentational helpers ───────────────────────────────────────────

function ProgressBar({ pct, color = '#2563eb' }: { pct: number; color?: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: color }} />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums">{v}%</span>
    </div>
  );
}

function pctColor(pct: number): string {
  if (pct >= 75) return '#16a34a';
  if (pct >= 50) return '#d97706';
  return '#dc2626';
}

function statusPill(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'disposed') return 'bg-emerald-100 text-emerald-700';
  if (s === 'pending') return 'bg-amber-100 text-amber-700';
  if (s === 'active') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-100 text-slate-600';
}

function DrillMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value.toLocaleString('en-IN')}</p>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();

  const exec        = useQuery({ queryKey: ['executive-analytics'], queryFn: fetchExecutiveAnalytics });
  const statusMix   = useQuery({ queryKey: ['case-status-breakdown'], queryFn: fetchCaseStatusBreakdown });
  const disposal    = useQuery({ queryKey: ['disposal-outcomes'], queryFn: fetchDisposalOutcomes });
  const hearings    = useQuery({ queryKey: ['hearings-by-date'], queryFn: fetchHearingsByDate });
  const listings    = useQuery({ queryKey: ['recent-listings'], queryFn: fetchRecentListings });
  const mostConnected = useQuery({ queryKey: ['most-connected-cases'], queryFn: fetchMostConnectedCases });

  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  const a = exec.data;
  const kp = a?.kpis;
  const drill = selectedDistrict ? a?.districtDetails[selectedDistrict] : undefined;

  const hearingCounts = useMemo(() => {
    const m = new Map<string, number>();
    (hearings.data ?? []).forEach(h => m.set(h.hearing_date.slice(0, 10), Number(h.value)));
    return m;
  }, [hearings.data]);

  const hearingTrend = useMemo(() => {
    return (hearings.data ?? [])
      .slice(0, 30)
      .map(h => ({ date: fmtDate(h.hearing_date), value: Number(h.value) }));
  }, [hearings.data]);

  const num = (rows: CategoryCount[] | undefined) =>
    (rows ?? []).map(r => ({ ...r, value: Number(r.value) }));

  const statusData   = num(statusMix.data);
  const disposalData = num(disposal.data);
  const sectionData  = (a?.sections ?? []).map(s => ({ ...s, value: Number(s.value) }));

  const anyError = exec.error || statusMix.error || disposal.error || hearings.error || listings.error;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome to Adalat360</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Monitor litigation, hearings, listings, advocates and compliance activities from a single platform.
        </p>
      </div>

      {anyError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(anyError as Error).message}
        </p>
      )}

      {/* Row 1 — Executive KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KpiCard label="Total Cases"        value={kp?.totalCases ?? 0}        icon={Briefcase}     accent="text-slate-700"  loading={exec.isLoading} onClick={() => navigate('/cases')} />
        <KpiCard label="Pending Cases"      value={kp?.pendingCases ?? 0}      icon={Clock}         accent="text-amber-600"  loading={exec.isLoading} />
        <KpiCard label="Disposed Cases"     value={kp?.disposedCases ?? 0}     icon={CheckCircle2}  accent="text-emerald-600" loading={exec.isLoading} />
        <KpiCard label="Listed Today"       value={kp?.casesListedToday ?? 0}  icon={CalendarDays}  accent="text-blue-600"   loading={exec.isLoading} onClick={() => navigate('/todays-listings')} />
        <KpiCard label="Upcoming (30 Days)" value={kp?.upcomingHearings30 ?? 0} icon={CalendarClock} accent="text-indigo-600" loading={exec.isLoading} onClick={() => navigate('/upcoming-hearings')} />
        <KpiCard label="Open Tasks"         value={kp?.openTasks ?? 0}         icon={ListTodo}      accent="text-slate-700"  loading={exec.isLoading} />
        <KpiCard label="Overdue Tasks"      value={kp?.overdueTasks ?? 0}      icon={AlertTriangle} accent="text-red-600"    loading={exec.isLoading} danger />
      </div>

      {/* Row 1b — Advocate (internal) readiness KPI cards */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Litigation Readiness (Advocate Status)</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Ready For Hearing"  value={kp?.readyForHearing ?? 0}   icon={Gavel}       accent="text-emerald-600" loading={exec.isLoading} />
          <KpiCard label="Counter Pending"    value={kp?.counterPending ?? 0}    icon={FileText}    accent="text-amber-600"   loading={exec.isLoading} />
          <KpiCard label="Documents Awaited"  value={kp?.documentsAwaited ?? 0}  icon={FolderOpen}  accent="text-orange-600"  loading={exec.isLoading} />
          <KpiCard label="Compliance Pending" value={kp?.compliancePending ?? 0} icon={ShieldAlert} accent="text-rose-600"    loading={exec.isLoading} />
        </div>
      </div>

      {/* Tamil Nadu Litigation Heat Map + District drill-down */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TNLitigationHeatMap
            districts={a?.districts ?? []}
            selected={selectedDistrict}
            onSelect={(d) => setSelectedDistrict(d === selectedDistrict ? null : d)}
            loading={exec.isLoading}
          />
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-blue-600" /> District Drill-Down
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedDistrict ? selectedDistrict : 'Select a district on the heat map'}
            </p>
          </CardHeader>
          <CardContent>
            {!drill ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No district selected.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <DrillMetric label="Total Cases"       value={drill.total}            color="text-slate-700" />
                <DrillMetric label="Pending"           value={drill.pending}          color="text-amber-600" />
                <DrillMetric label="Disposed"          value={drill.disposed}         color="text-emerald-600" />
                <DrillMetric label="Ready For Hearing" value={drill.readyForHearing}  color="text-emerald-600" />
                <DrillMetric label="Counter Pending"   value={drill.counterPending}   color="text-amber-600" />
                <DrillMetric label="Documents Awaited" value={drill.documentsAwaited} color="text-orange-600" />
                <DrillMetric label="Upcoming Hearings" value={drill.upcomingHearings} color="text-indigo-600" />
                <DrillMetric label="Advocates"         value={drill.advocates}        color="text-blue-600" />
                <DrillMetric label="Open Tasks"        value={drill.openTasks}        color="text-slate-700" />
                <DrillMetric label="Overdue Tasks"     value={drill.overdueTasks}     color="text-red-600" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section → Advocate mapping */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> Section → Advocate Mapping</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {exec.isLoading ? (
            <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
          ) : (a?.sectionAdvocates ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No section-advocate data.</p>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Section</th>
                    <th className="px-3 py-2 font-medium">Advocate</th>
                    <th className="px-3 py-2 text-right font-medium">Assigned</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Completed</th>
                    <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {(a?.sectionAdvocates ?? []).map((r, i) => (
                    <tr key={`${r.section}-${r.advocate}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2">{r.section}</td>
                      <td className="px-3 py-2">{r.advocate}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.assignedCases}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.openTasks}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.completedTasks}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.overdueTasks > 0 ? 'font-semibold text-red-600' : ''}`}>{r.overdueTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advocate Performance + Leaderboard */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Advocate Performance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {exec.isLoading ? (
                <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
              ) : (a?.advocates ?? []).length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No advocate data.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Advocate</th>
                        <th className="px-3 py-2 text-right font-medium">Cases</th>
                        <th className="px-3 py-2 text-right font-medium">Open</th>
                        <th className="px-3 py-2 text-right font-medium">Done</th>
                        <th className="px-3 py-2 text-right font-medium">Overdue</th>
                        <th className="px-3 py-2 text-right font-medium">Hearings</th>
                        <th className="px-3 py-2 font-medium" style={{ minWidth: 130 }}>Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(a?.advocates ?? []).map((r, i) => (
                        <tr key={`${r.advocate}-${i}`} className="border-b last:border-0">
                          <td className="px-3 py-2">{r.advocate}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.assignedCases}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.openTasks}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.completedTasks}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${r.overdueTasks > 0 ? 'font-semibold text-red-600' : ''}`}>{r.overdueTasks}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.hearingsThisMonth}</td>
                          <td className="px-3 py-2"><ProgressBar pct={r.completionPct} color={pctColor(r.completionPct)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4 text-amber-500" /> Advocate Leaderboard</CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by task completion %, closed cases &amp; on-time delivery</p>
          </CardHeader>
          <CardContent className="p-0">
            {exec.isLoading ? (
              <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (a?.leaderboard ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No data.</p>
            ) : (
              <ul className="divide-y">
                {(a?.leaderboard ?? []).map((r, i) => (
                  <li key={`${r.advocate}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.advocate}</p>
                      <p className="text-[11px] text-muted-foreground">{r.closedCases} closed · {r.completedTasks}/{r.totalTasks} tasks</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{r.completionPct}%</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Hearings Requiring Action + Overdue Task Tracker */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-indigo-600" /> Upcoming Hearings Requiring Action</CardTitle>
            <p className="text-xs text-muted-foreground">Next 30 days</p>
          </CardHeader>
          <CardContent className="p-0">
            {exec.isLoading ? (
              <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (a?.upcomingHearings ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No upcoming hearings.</p>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Case Number</th>
                      <th className="px-3 py-2 font-medium">Advocate</th>
                      <th className="px-3 py-2 font-medium">Hearing Date</th>
                      <th className="px-3 py-2 text-right font-medium">Open Tasks</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a?.upcomingHearings ?? []).map(r => (
                      <tr key={r.caseId} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                        <td className="px-3 py-2">{r.advocate ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.hearingDate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.openTasks}</td>
                        <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill(r.status)}`}>{r.status ?? '\u2014'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-red-600"><AlertTriangle className="h-4 w-4" /> Overdue Task Tracker</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {exec.isLoading ? (
              <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (a?.overdueTasks ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No overdue tasks. 🎯</p>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Case Number</th>
                      <th className="px-3 py-2 font-medium">Task</th>
                      <th className="px-3 py-2 font-medium">Advocate</th>
                      <th className="px-3 py-2 font-medium">Due Date</th>
                      <th className="px-3 py-2 text-right font-medium">Days Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a?.overdueTasks ?? []).map(r => (
                      <tr key={r.id} className="border-b bg-red-50/40 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                        <td className="max-w-[180px] truncate px-3 py-2" title={r.task}>{r.task}</td>
                        <td className="px-3 py-2">{r.advocate ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.dueDate)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">{r.daysOverdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connected Cases Analytics + Daily Cause List Analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" /> Connected Cases Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 rounded-md bg-indigo-50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Total Connected Cases</p>
              <p className="text-2xl font-bold text-indigo-700">{exec.isLoading ? '…' : (a?.connectedTotal ?? 0)}</p>
            </div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Most Connected Cases</p>
            {mostConnected.isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-7" />)}</div>
            ) : (mostConnected.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No connected cases yet.</p>
            ) : (
              <ul className="divide-y">
                {(mostConnected.data ?? []).map((c, i) => (
                  <li key={`${c.label}-${i}`} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                      <span className="truncate font-mono text-xs">{c.label}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      <Link2 className="h-3 w-3" />{c.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Gavel className="h-4 w-4" /> Daily Cause List Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="rounded-md bg-blue-50 px-4 py-3">
                <p className="text-xs text-muted-foreground">Listed Today</p>
                <p className="text-2xl font-bold text-blue-700">{exec.isLoading ? '…' : (a?.causeList.listedToday ?? 0)}</p>
              </div>
              <div className="rounded-md bg-slate-50 px-4 py-3">
                <p className="text-xs text-muted-foreground">Listed This Week</p>
                <p className="text-2xl font-bold text-slate-700">{exec.isLoading ? '…' : (a?.causeList.listedThisWeek ?? 0)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Court Hall Distribution</p>
                {(a?.causeList.courtHalls ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data.</p>
                ) : (
                  <ul className="space-y-1">
                    {(a?.causeList.courtHalls ?? []).map((c, i) => (
                      <li key={i} className="flex justify-between text-xs"><span className="truncate" title={c.label}>{c.label}</span><span className="font-semibold tabular-nums">{c.value}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Judge Wise Listings</p>
                {(a?.causeList.judges ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data.</p>
                ) : (
                  <ul className="space-y-1">
                    {(a?.causeList.judges ?? []).map((c, i) => (
                      <li key={i} className="flex justify-between text-xs"><span className="truncate" title={c.label}>{c.label}</span><span className="font-semibold tabular-nums">{c.value}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Litigation Trend Analysis (last 12 months) */}
      <ChartCard title="Litigation Trend Analysis (Last 12 Months)" loading={exec.isLoading} empty={(a?.trend ?? []).length === 0} height={340}>
        <ResponsiveContainer>
          <LineChart data={a?.trend ?? []} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend verticalAlign="top" height={28} iconType="circle" />
            <Line type="monotone" dataKey="newCases" name="New Cases" stroke="#2563eb" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="casesDisposed" name="Disposed" stroke="#16a34a" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="hearings" name="Hearings" stroke="#d97706" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="tasksCreated" name="Tasks Created" stroke="#7c3aed" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="tasksCompleted" name="Tasks Completed" stroke="#0891b2" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Section-wise litigation + Status donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Section Wise Litigation" loading={exec.isLoading} empty={sectionData.length === 0}>
            <ResponsiveContainer>
              <BarChart data={sectionData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {sectionData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <ChartCard title="Case Status Breakdown" loading={statusMix.isLoading} empty={statusData.length === 0}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="label" cx="50%" cy="50%"
                innerRadius={55} outerRadius={90} paddingAngle={2}>
                {statusData.map((d, i) => (
                  <Cell key={i} fill={STATUS_COLORS[d.label] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={24} iconType="circle" />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Disposal outcomes + hearing trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Disposal Outcomes" loading={disposal.isLoading} empty={disposalData.length === 0}>
          <ResponsiveContainer>
            <BarChart data={disposalData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Upcoming Hearings Trend" loading={hearings.isLoading} empty={hearingTrend.length === 0}>
          <ResponsiveContainer>
            <AreaChart data={hearingTrend} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="hearingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d97706" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" height={50} angle={-20} textAnchor="end" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#d97706" fill="url(#hearingFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 5 — Calendar + recent listings */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HearingCalendar counts={hearingCounts} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Listings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {listings.isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9" />)}
              </div>
            ) : (listings.data ?? []).length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No recent listings.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Case Number</th>
                      <th className="px-3 py-2 font-medium">Court Hall</th>
                      <th className="px-3 py-2 font-medium">Judge</th>
                      <th className="px-3 py-2 font-medium">Stage</th>
                      <th className="px-3 py-2 font-medium">Listed Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(listings.data ?? []).map(r => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.case_number ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{r.court_hall ?? '\u2014'}</td>
                        <td className="max-w-[160px] truncate px-3 py-2" title={r.judge_name ?? undefined}>{r.judge_name ?? '\u2014'}</td>
                        <td className="max-w-[140px] truncate px-3 py-2" title={r.stage ?? undefined}>{r.stage ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.listed_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
