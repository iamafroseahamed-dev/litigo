import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { sessionCache } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase, CheckCircle2, Clock, AlertTriangle, Moon, CalendarDays, Bell, Send, BellOff,
} from 'lucide-react';
import type { Case } from '@/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function isoToday(): string { return new Date().toISOString().split('T')[0]; }
function isoTomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
}
function isoInNDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0];
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function isDormant(c: Case): boolean {
  if (c.case_status !== 'Pending') return false;
  if (!c.next_hearing_date) return true;
  return c.next_hearing_date < isoToday();
}

// Module-level — not recreated on every render
function groupBy(arr: Case[], key: keyof Case) {
  const map = new Map<string, { pending: number; disposed: number }>();
  arr.forEach(c => {
    const k = String(c[key] ?? '');
    if (!map.has(k)) map.set(k, { pending: 0, disposed: 0 });
    const entry = map.get(k)!;
    if (c.case_status === 'Pending') entry.pending++;
    else if (c.case_status === 'Disposed') entry.disposed++;
  });
  return [...map.entries()].map(([label, counts]) => ({ label, ...counts }))
    .sort((a, b) => (b.pending + b.disposed) - (a.pending + a.disposed));
}

// ─── MetricCard ──────────────────────────────────────────────────────────────

function MetricCard({
  title, value, icon: Icon, colorClass, subtitle, loading,
}: {
  title: string; value: number; icon: React.ElementType; colorClass: string; subtitle?: string; loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading
              ? <Skeleton className="mt-2 h-8 w-16" />
              : <p className={`mt-1 text-3xl font-bold ${colorClass}`}>{value.toLocaleString()}</p>}
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-full ${colorClass.replace('text-', 'bg-').replace('-600', '-100').replace('-500', '-100').replace('-700', '-100')}`}>
            <Icon className={`h-5 w-5 ${colorClass}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── MiniBarChart ─────────────────────────────────────────────────────────────

function MiniBar({ label, pendingCount, disposedCount, maxVal }: {
  label: string; pendingCount: number; disposedCount: number; maxVal: number;
}) {
  const pct = (n: number) => maxVal > 0 ? Math.round((n / maxVal) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="truncate font-medium" title={label}>{label || '(blank)'}</span>
        <span className="ml-2 shrink-0 text-muted-foreground">{pendingCount}P / {disposedCount}D</span>
      </div>
      <div className="flex gap-1">
        {pendingCount > 0 && (
          <div
            className="h-3 rounded-sm bg-amber-400 transition-all"
            style={{ width: `${pct(pendingCount)}%`, minWidth: '4px' }}
            title={`Pending: ${pendingCount}`}
          />
        )}
        {disposedCount > 0 && (
          <div
            className="h-3 rounded-sm bg-emerald-500 transition-all"
            style={{ width: `${pct(disposedCount)}%`, minWidth: '4px' }}
            title={`Disposed: ${disposedCount}`}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

function SensitivityBadge({ v }: { v: string | null }) {
  if (v === 'Sensitive') return <Badge variant="purple">Sensitive</Badge>;
  if (v === 'Non-Sensitive') return <Badge variant="outline">Non-Sensitive</Badge>;
  return <Badge variant="outline">{v ?? '—'}</Badge>;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const orgId = user?.profile?.organization_id;
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifStats, setNotifStats] = useState({ sentToday: 0, failedToday: 0, casesNotifiedToday: 0 });

  useEffect(() => {
    if (!orgId) return;
    const today = isoToday();
    const CACHE_KEY = `litigo_dashboard_${orgId}`;

    (async () => {
      // Fast path: serve from 15-min session cache
      const cached = sessionCache.get<{ cases: Case[]; notifStats: typeof notifStats }>(CACHE_KEY);
      if (cached) {
        setCases(cached.cases);
        setNotifStats(cached.notifStats);
        setLoading(false);
        return;
      }

      setLoading(true);
      const [casesResp, logsResp, notifiedResp] = await Promise.all([
        supabase.from('cases')
          .select('id,case_number,cnr_number,case_status,next_hearing_date,sensitivity,cla_party_status,district,court_name,advocate_name,client_name,petitioner,respondent')
          .eq('organization_id', orgId)
          .eq('active', true)
          .order('next_hearing_date', { ascending: true, nullsFirst: false }),
        supabase.from('notification_delivery_logs')
          .select('status')
          .gte('created_at', today).lt('created_at', isoTomorrow()),
        supabase.from('today_matched_listings')
          .select('case_id')
          .eq('organization_id', orgId)
          .eq('notification_status', 'notified')
          .eq('listed_date', today),
      ]);
      const fetchedCases = (casesResp.data ?? []) as Case[];
      const logs = (logsResp.data ?? []) as { status: string }[];
      const notifiedCases = (notifiedResp.data ?? []) as { case_id: string }[];
      const stats = {
        sentToday: logs.filter(l => l.status === 'sent').length,
        failedToday: logs.filter(l => l.status === 'failed').length,
        casesNotifiedToday: new Set(notifiedCases.map(r => r.case_id)).size,
      };
      sessionCache.set(CACHE_KEY, { cases: fetchedCases, notifStats: stats });
      setCases(fetchedCases);
      setNotifStats(stats);
      setLoading(false);
    })();
  }, [orgId]);

  const today = isoToday();
  const tomorrow = isoTomorrow();
  const in7 = isoInNDays(7);

  const pending = useMemo(() => cases.filter(c => c.case_status === 'Pending'), [cases]);
  const disposed = useMemo(() => cases.filter(c => c.case_status === 'Disposed'), [cases]);
  const hearingsToday = useMemo(() => cases.filter(c => c.next_hearing_date === today), [cases, today]);
  const hearingsTomorrow = useMemo(() => cases.filter(c => c.next_hearing_date === tomorrow), [cases, tomorrow]);
  const hearings7 = useMemo(() => cases.filter(c => c.next_hearing_date && c.next_hearing_date >= today && c.next_hearing_date <= in7), [cases, today, in7]);
  const dormant = useMemo(() => cases.filter(isDormant), [cases]);

  const bySensitivity = useMemo(() => groupBy(cases, 'sensitivity'), [cases]);
  const byCLA = useMemo(() => groupBy(cases, 'cla_party_status'), [cases]);
  const pendingByDistrict = useMemo(() => pending
    .reduce<Record<string, number>>((acc, c) => {
      const k = c.district ?? '(blank)';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}), [pending]);
  const disposedByDistrict = useMemo(() => disposed
    .reduce<Record<string, number>>((acc, c) => {
      const k = c.district ?? '(blank)';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}), [disposed]);

  const sensitivityMax = Math.max(...bySensitivity.map(r => r.pending + r.disposed), 1);
  const claMax = Math.max(...byCLA.map(r => r.pending + r.disposed), 1);

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold">Executive Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Case portfolio overview · {fmtDate(today)}</p>
      </div>

      {/* ── Alert banner ── */}
      {!loading && hearings7.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            <strong>WARNING:</strong> {hearings7.length} pending case{hearings7.length !== 1 ? 's' : ''} have hearings within 7 days
            &nbsp;·&nbsp; <strong>Today: {hearingsToday.length}</strong>
            &nbsp;·&nbsp; <strong>Tomorrow: {hearingsTomorrow.length}</strong>
          </span>
        </div>
      )}

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard title="Cases Under Management" value={pending.length} icon={Briefcase} colorClass="text-amber-600" loading={loading} />
        <MetricCard title="Disposed / Closed" value={disposed.length} icon={CheckCircle2} colorClass="text-emerald-600" loading={loading} />
        <MetricCard title="Today’s Court Listings" value={hearingsToday.length} icon={CalendarDays} colorClass="text-blue-600" loading={loading} />
        <MetricCard title="Tomorrow’s Hearings" value={hearingsTomorrow.length} icon={Clock} colorClass="text-indigo-600" loading={loading} />
        <MetricCard title="Upcoming (7 Days)" value={hearings7.length} icon={Bell} colorClass="text-orange-500" loading={loading} />
        <MetricCard title="Dormant Cases" value={dormant.length} icon={Moon} colorClass="text-red-600" subtitle="Pending, no upcoming date" loading={loading} />
      </div>

      {/* ── Notification metrics ── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard title="Notifications Sent Today" value={notifStats.sentToday} icon={Send} colorClass="text-emerald-600" loading={loading} />
        <MetricCard title="Pending Notifications" value={notifStats.failedToday} icon={BellOff} colorClass="text-red-600" loading={loading} />
        <MetricCard title="Cases Notified Today" value={notifStats.casesNotifiedToday} icon={Bell} colorClass="text-blue-600" loading={loading} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Sensitivity breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By Sensitivity</CardTitle>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Pending</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Disposed</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? [1,2].map(i => <Skeleton key={i} className="h-6" />) :
              bySensitivity.length === 0
                ? <p className="text-xs text-muted-foreground">No data.</p>
                : bySensitivity.map(r => (
                    <MiniBar key={r.label} label={r.label} pendingCount={r.pending} disposedCount={r.disposed} maxVal={sensitivityMax} />
                  ))
            }
          </CardContent>
        </Card>

        {/* CLA breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By CLA Party Status</CardTitle>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Pending</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Disposed</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? [1,2,3].map(i => <Skeleton key={i} className="h-6" />) :
              byCLA.length === 0
                ? <p className="text-xs text-muted-foreground">No data.</p>
                : byCLA.map(r => (
                    <MiniBar key={r.label} label={r.label} pendingCount={r.pending} disposedCount={r.disposed} maxVal={claMax} />
                  ))
            }
          </CardContent>
        </Card>

        {/* Pending by district */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending Cases by District</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-24" /> :
              Object.keys(pendingByDistrict).length === 0
                ? <p className="text-xs text-muted-foreground">No pending cases.</p>
                : (
                  <div className="space-y-1.5">
                    {Object.entries(pendingByDistrict)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([district, count]) => (
                        <div key={district} className="flex items-center justify-between text-sm">
                          <span className="truncate">{district}</span>
                          <Badge variant="warning">{count}</Badge>
                        </div>
                      ))}
                  </div>
                )
            }
          </CardContent>
        </Card>

        {/* Disposed by district */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Disposed Cases by District</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-24" /> :
              Object.keys(disposedByDistrict).length === 0
                ? <p className="text-xs text-muted-foreground">No disposed cases.</p>
                : (
                  <div className="space-y-1.5">
                    {Object.entries(disposedByDistrict)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([district, count]) => (
                        <div key={district} className="flex items-center justify-between text-sm">
                          <span className="truncate">{district}</span>
                          <Badge variant="success">{count}</Badge>
                        </div>
                      ))}
                  </div>
                )
            }
          </CardContent>
        </Card>
      </div>

      {/* ── Upcoming hearings table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upcoming Hearings Within 7 Days</CardTitle>
          {!loading && <p className="text-xs text-muted-foreground">{hearings7.length} case{hearings7.length !== 1 ? 's' : ''} scheduled between today and {fmtDate(in7)}</p>}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : hearings7.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No hearings in the next 7 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Case Number</TableHead>
                    <TableHead className="whitespace-nowrap">Section</TableHead>
                    <TableHead className="whitespace-nowrap">District</TableHead>
                    <TableHead className="whitespace-nowrap">Next Hearing</TableHead>
                    <TableHead className="whitespace-nowrap">Sensitivity</TableHead>
                    <TableHead className="whitespace-nowrap">CLA Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hearings7.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap font-medium font-mono text-xs">{c.case_number}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{c.section ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{c.district ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={`text-xs font-semibold ${c.next_hearing_date === today ? 'text-red-600' : c.next_hearing_date === tomorrow ? 'text-amber-600' : 'text-foreground'}`}>
                          {fmtDate(c.next_hearing_date)}
                          {c.next_hearing_date === today && ' (Today)'}
                          {c.next_hearing_date === tomorrow && ' (Tomorrow)'}
                        </span>
                      </TableCell>
                      <TableCell><SensitivityBadge v={c.sensitivity} /></TableCell>
                      <TableCell>
                        {c.cla_party_status
                          ? <Badge variant="info">{c.cla_party_status}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
