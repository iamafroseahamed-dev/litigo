import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase, Clock, CheckCircle2, Gavel, ShieldAlert, Landmark,
  Users, Layers, CalendarClock, AlertTriangle, Scale,
} from 'lucide-react';
import { fetchExecutiveAnalytics } from '@/lib/dashboardQueries';
import { TNDistrictMap } from '@/components/TNDistrictMap';
import { DistrictDrawer } from '@/components/DistrictDrawer';
import { advocateStatusClasses } from '@/lib/caseManagement';
import { useOrg } from '@/lib/orgContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function priorityPill(p: 'High' | 'Medium' | 'Low'): string {
  if (p === 'High') return 'bg-red-100 text-red-700';
  if (p === 'Medium') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function KpiCard({
  label, value, icon: Icon, accent, chip, loading, onClick, danger,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  chip: string;
  loading: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  const body = (
    <Card className={`group relative h-full overflow-hidden ${onClick ? 'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover' : ''} ${danger && value > 0 ? 'border-red-200 bg-red-50/30' : ''}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2.5">
            <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
            {loading
              ? <Skeleton className="h-9 w-16" />
              : <p className={`text-[1.75rem] font-bold leading-none tabular-nums ${accent}`}>{value.toLocaleString('en-IN')}</p>}
          </div>
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${chip} ${accent} shadow-xs ring-1 ring-inset ring-black/[0.03] transition-transform duration-200 group-hover:scale-105`}>
            <Icon className="h-[1.15rem] w-[1.15rem]" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full text-left transition-transform" aria-label={label}>
        {body}
      </button>
    );
  }
  return body;
}

function StatCard({ label, value, accent, loading }: { label: string; value: number; accent: string; loading: boolean }) {
  return (
    <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-card-hover">
      <CardContent className="px-4 py-4 text-center">
        {loading
          ? <Skeleton className="mx-auto h-7 w-12" />
          : <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value.toLocaleString('en-IN')}</p>}
        <p className="mt-1.5 text-[11px] font-medium leading-tight text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const { org } = useOrg();
  const exec = useQuery({
    queryKey: ['executive-analytics', org?.id ?? null],
    queryFn: () => fetchExecutiveAnalytics(org?.id ?? null),
  });

  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [aiAdvocateFilter, setAiAdvocateFilter] = useState<string>('__all__');
  const [aiDistrictFilter, setAiDistrictFilter] = useState<string>('__all__');
  const [aiRiskFilter, setAiRiskFilter] = useState<string>('__all__');

  const a = exec.data;
  const kp = a?.kpis;
  const drill = selectedDistrict ? a?.districtDetails[selectedDistrict] : undefined;
  const aiCases = a?.aiCases ?? [];
  const aiAdvocates = useMemo(() => Array.from(new Set(aiCases.map(c => c.advocate).filter(Boolean))).sort() as string[], [aiCases]);
  const aiDistricts = useMemo(() => Array.from(new Set(aiCases.map(c => c.district).filter(Boolean))).sort() as string[], [aiCases]);
  const filteredAiCases = useMemo(() => aiCases.filter(c =>
    (aiAdvocateFilter === '__all__' || c.advocate === aiAdvocateFilter) &&
    (aiDistrictFilter === '__all__' || c.district === aiDistrictFilter) &&
    (aiRiskFilter === '__all__' || c.riskLevel === aiRiskFilter)
  ), [aiAdvocateFilter, aiCases, aiDistrictFilter, aiRiskFilter]);
  const aiMetrics = useMemo(() => ({
    highRisk: filteredAiCases.filter(c => c.riskLevel === 'High').length,
    immediateAttention: filteredAiCases.filter(c => c.immediateAttention).length,
    upcomingHearings: filteredAiCases.filter(c => c.upcomingHearing).length,
    noActivity: filteredAiCases.filter(c => c.noActivity).length,
    longPending: filteredAiCases.filter(c => c.longPending).length,
  }), [filteredAiCases]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Welcome to Adalat360</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Actionable litigation insight — which cases need attention, which hearings are coming, who owns each case.
        </p>
      </div>

      {exec.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
          {(exec.error as Error).message}
        </p>
      )}

      {/* Executive Summary */}
      <div>
        <p className="eyebrow mb-3">Executive Summary</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total Cases"     value={kp?.totalCases ?? 0}     icon={Briefcase}    accent="text-slate-700"   chip="bg-slate-100"   loading={exec.isLoading} onClick={() => navigate('/cases')} />
          <KpiCard label="Pending Cases"   value={kp?.pendingCases ?? 0}   icon={Clock}        accent="text-amber-600"   chip="bg-amber-50"    loading={exec.isLoading} />
          <KpiCard label="Disposed Cases"  value={kp?.disposedCases ?? 0}  icon={CheckCircle2} accent="text-emerald-600" chip="bg-emerald-50"  loading={exec.isLoading} />
          <KpiCard label="Active Cases"    value={kp?.activeCases ?? 0}    icon={Gavel}        accent="text-blue-600"    chip="bg-blue-50"     loading={exec.isLoading} />
          <KpiCard label="Sensitive Cases" value={kp?.sensitiveCases ?? 0} icon={ShieldAlert}  accent="text-rose-600"    chip="bg-rose-50"     loading={exec.isLoading} />
          <KpiCard label="CLA Party Cases" value={kp?.claPartyCases ?? 0}  icon={Landmark}     accent="text-indigo-600"  chip="bg-indigo-50"   loading={exec.isLoading} />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-rose-600" /> AI Risk Monitoring</CardTitle>
          <p className="text-xs text-muted-foreground">Counts from cached AI case analyses. Organization scope follows the current organization context.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={aiAdvocateFilter} onValueChange={setAiAdvocateFilter}>
              <SelectTrigger><SelectValue placeholder="All Advocates" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Advocates</SelectItem>
                {aiAdvocates.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={aiDistrictFilter} onValueChange={setAiDistrictFilter}>
              <SelectTrigger><SelectValue placeholder="All Districts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Districts</SelectItem>
                {aiDistricts.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={aiRiskFilter} onValueChange={setAiRiskFilter}>
              <SelectTrigger><SelectValue placeholder="All Risk Levels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Risk Levels</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="High Risk Cases" value={aiMetrics.highRisk} accent="text-red-600" loading={exec.isLoading} />
            <StatCard label="Immediate Attention" value={aiMetrics.immediateAttention} accent="text-rose-600" loading={exec.isLoading} />
            <StatCard label="Upcoming Hearings" value={aiMetrics.upcomingHearings} accent="text-indigo-600" loading={exec.isLoading} />
            <StatCard label="No Activity" value={aiMetrics.noActivity} accent="text-amber-600" loading={exec.isLoading} />
            <StatCard label="Long Pending" value={aiMetrics.longPending} accent="text-orange-600" loading={exec.isLoading} />
          </div>
        </CardContent>
      </Card>

      {/* Tamil Nadu Litigation Heat Map — click a district for full analytics */}
      <TNDistrictMap
        districts={a?.districts ?? []}
        selected={selectedDistrict}
        onSelect={(d) => setSelectedDistrict(d)}
        loading={exec.isLoading}
      />

      <DistrictDrawer
        district={selectedDistrict}
        detail={drill}
        open={!!selectedDistrict}
        onClose={() => setSelectedDistrict(null)}
      />

      {/* Advocate Performance (case-level) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Advocate Performance</CardTitle>
          <p className="text-xs text-muted-foreground">Case-level workload from cases.assigned_advocate_name (excludes task assignees)</p>
        </CardHeader>
        <CardContent className="p-0">
          {exec.isLoading ? (
            <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
          ) : (a?.advocates ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No advocate data.</p>
          ) : (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Advocate</th>
                    <th className="px-3 py-2 text-right font-medium">Assigned Cases</th>
                    <th className="px-3 py-2 text-right font-medium">Ready For Hearing</th>
                    <th className="px-3 py-2 text-right font-medium">Pending Documents</th>
                    <th className="px-3 py-2 text-right font-medium">Counter Pending</th>
                    <th className="px-3 py-2 text-right font-medium">Upcoming Hearings</th>
                  </tr>
                </thead>
                <tbody>
                  {(a?.advocates ?? []).map((r, i) => (
                    <tr key={`${r.advocate}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2">{r.advocate}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.assignedCases}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.readyForHearing}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-600">{r.documentsAwaited}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-600">{r.counterPending}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-indigo-600">{r.upcomingHearings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section → Advocate Mapping */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> Section → Advocate Mapping</CardTitle>
          <p className="text-xs text-muted-foreground">Case-level: section &amp; assigned advocate (cases.section + cases.assigned_advocate_name)</p>
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
                    <th className="px-3 py-2 font-medium">Assigned Advocate</th>
                    <th className="px-3 py-2 text-right font-medium">Total Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {(a?.sectionAdvocates ?? []).map((r, i) => (
                    <tr key={`${r.section}-${r.advocate}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2">{r.section}</td>
                      <td className="px-3 py-2">{r.advocate}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.assignedCases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

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
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Case Number</th>
                      <th className="px-3 py-2 font-medium">Hearing Date</th>
                      <th className="px-3 py-2 font-medium">Advocate</th>
                      <th className="px-3 py-2 font-medium">Advocate Status</th>
                      <th className="px-3 py-2 font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a?.upcomingHearings ?? []).map(r => (
                      <tr key={r.caseId} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.hearingDate)}</td>
                        <td className="px-3 py-2">{r.advocate ?? '\u2014'}</td>
                        <td className="px-3 py-2">
                          {r.advocateStatus
                            ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${advocateStatusClasses(r.advocateStatus)}`}>{r.advocateStatus}</span>
                            : <span className="text-muted-foreground">{'\u2014'}</span>}
                        </td>
                        <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityPill(r.priority)}`}>{r.priority}</span></td>
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
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No overdue tasks.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Task</th>
                      <th className="px-3 py-2 font-medium">Assigned To</th>
                      <th className="px-3 py-2 font-medium">Due Date</th>
                      <th className="px-3 py-2 text-right font-medium">Days Overdue</th>
                      <th className="px-3 py-2 font-medium">Related Case</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a?.overdueTasks ?? []).map(r => (
                      <tr key={r.id} className="border-b bg-red-50/40 last:border-0">
                        <td className="max-w-[180px] truncate px-3 py-2" title={r.task}>{r.task}</td>
                        <td className="px-3 py-2">{r.assignedTo ?? '\u2014'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.dueDate)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">{r.daysOverdue}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Advocate Status Analytics */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Scale className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold">Advocate Status Analytics</p>
          <span className="text-xs text-muted-foreground">Case readiness across the portfolio</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Ready For Hearing"        value={kp?.readyForHearing ?? 0}     accent="text-emerald-600" loading={exec.isLoading} />
          <StatCard label="Documents Awaited"        value={kp?.documentsAwaited ?? 0}    accent="text-orange-600"  loading={exec.isLoading} />
          <StatCard label="Counter Affidavit Pending" value={kp?.counterPending ?? 0}     accent="text-amber-600"   loading={exec.isLoading} />
          <StatCard label="Legal Opinion Pending"    value={kp?.legalOpinionPending ?? 0} accent="text-blue-600"    loading={exec.isLoading} />
          <StatCard label="Compliance Pending"       value={kp?.compliancePending ?? 0}   accent="text-rose-600"    loading={exec.isLoading} />
        </div>
      </div>
    </div>
  );
}
