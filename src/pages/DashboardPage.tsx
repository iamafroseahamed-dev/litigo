import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Briefcase, CheckCircle2, Clock, AlertTriangle, Moon, CalendarDays, Bell,
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

// ─── Notification Modal ───────────────────────────────────────────────────────

interface Recipient { label: string; email: string | null; mobile: string | null; selected: boolean }

function NotifyModal({ open, onClose, caseItem }: {
  open: boolean; onClose: () => void; caseItem: Case | null;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!caseItem || !open) return;
    setResult(null);

    const recs: Recipient[] = [];
    if (caseItem.client_email || caseItem.client_mobile) {
      recs.push({ label: `Client: ${caseItem.client_name ?? 'Client'}`, email: caseItem.client_email, mobile: caseItem.client_mobile, selected: true });
    }
    if (caseItem.client_whatsapp) {
      recs.push({ label: `Client WhatsApp: ${caseItem.client_name ?? 'Client'}`, email: null, mobile: caseItem.client_whatsapp, selected: false });
    }
    if (caseItem.advocate_email || caseItem.advocate_mobile) {
      recs.push({ label: `Advocate: ${caseItem.advocate_name ?? 'Advocate'}`, email: caseItem.advocate_email, mobile: caseItem.advocate_mobile, selected: true });
    }
    setRecipients(recs);

    setSubject(`Upcoming Court Hearing - ${caseItem.case_number}`);
    setMessage(
      `Dear Sir/Madam,\n\nThis is a reminder that the following matter is listed for hearing.\n\n` +
      `Case Number: ${caseItem.case_number}\n` +
      `Court: ${caseItem.court_name ?? '—'}\n` +
      `Next Hearing Date: ${fmtDate(caseItem.next_hearing_date)}\n` +
      `Petitioner: ${caseItem.petitioner ?? '—'}\n` +
      `Respondent: ${caseItem.respondent ?? '—'}\n` +
      `Advocate: ${caseItem.advocate_name ?? '—'}\n\n` +
      `Please take necessary action.\n\nRegards,\nLitigo`
    );
  }, [caseItem, open]);

  async function handleSendEmail() {
    if (!caseItem) return;
    setSending(true);
    setResult(null);

    const selected = recipients.filter(r => r.selected && r.email);
    if (selected.length === 0) {
      setResult({ ok: false, msg: 'No email recipients selected.' });
      setSending(false);
      return;
    }

    // Log each notification attempt (email service not configured yet)
    const logs = selected.map(r => ({
      case_id: caseItem.id,
      notification_type: 'email',
      recipient_name: r.label,
      recipient_email: r.email,
      recipient_mobile: r.mobile,
      subject,
      message,
      status: 'pending',
      sent_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from('notification_logs').insert(logs);
    setSending(false);
    if (error) {
      setResult({ ok: false, msg: `Failed to log notification: ${error.message}` });
    } else {
      setResult({ ok: true, msg: 'Email service is not configured yet. Notification logged for future delivery.' });
    }
  }

  if (!caseItem) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notify — {caseItem.case_number}</DialogTitle>
          <DialogDescription>Preview and send a hearing reminder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Recipients */}
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipients</Label>
            <div className="space-y-1.5">
              {recipients.length === 0 && (
                <p className="text-xs text-muted-foreground">No contact details available for this case.</p>
              )}
              {recipients.map((r, i) => (
                <label key={i} className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={r.selected}
                    onChange={() => setRecipients(prev => prev.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="flex-1">{r.label}</span>
                  {r.email && <span className="text-xs text-muted-foreground">{r.email}</span>}
                </label>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label htmlFor="notify-subject">Subject</Label>
            <Input id="notify-subject" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="notify-message">Message</Label>
            <Textarea id="notify-message" rows={10} value={message} onChange={e => setMessage(e.target.value)} className="font-mono text-xs" />
          </div>

          {result && (
            <div className={`rounded-md px-3 py-2 text-sm ${result.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {result.msg}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled title="Not implemented yet">Send WhatsApp</Button>
          <Button variant="outline" disabled title="Not implemented yet">Send SMS</Button>
          <Button onClick={handleSendEmail} disabled={sending}>
            {sending ? 'Sending...' : 'Send Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifyCase, setNotifyCase] = useState<Case | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('cases')
        .select('*')
        .eq('active', true)
        .order('next_hearing_date', { ascending: true, nullsFirst: false });
      setCases((data ?? []) as Case[]);
      setLoading(false);
    })();
  }, []);

  const today = isoToday();
  const tomorrow = isoTomorrow();
  const in7 = isoInNDays(7);

  const pending = useMemo(() => cases.filter(c => c.case_status === 'Pending'), [cases]);
  const disposed = useMemo(() => cases.filter(c => c.case_status === 'Disposed'), [cases]);
  const hearingsToday = useMemo(() => cases.filter(c => c.next_hearing_date === today), [cases, today]);
  const hearingsTomorrow = useMemo(() => cases.filter(c => c.next_hearing_date === tomorrow), [cases, tomorrow]);
  const hearings7 = useMemo(() => cases.filter(c => c.next_hearing_date && c.next_hearing_date >= today && c.next_hearing_date <= in7), [cases, today, in7]);
  const dormant = useMemo(() => cases.filter(isDormant), [cases]);

  // Chart data helpers
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

  function SensitivityBadge({ v }: { v: string | null }) {
    if (v === 'Sensitive') return <Badge variant="purple">Sensitive</Badge>;
    if (v === 'Non-Sensitive') return <Badge variant="outline">Non-Sensitive</Badge>;
    return <Badge variant="outline">{v ?? '—'}</Badge>;
  }

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
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
        <MetricCard title="Total Pending" value={pending.length} icon={Briefcase} colorClass="text-amber-600" loading={loading} />
        <MetricCard title="Total Disposed" value={disposed.length} icon={CheckCircle2} colorClass="text-emerald-600" loading={loading} />
        <MetricCard title="Hearings Today" value={hearingsToday.length} icon={CalendarDays} colorClass="text-blue-600" loading={loading} />
        <MetricCard title="Hearings Tomorrow" value={hearingsTomorrow.length} icon={Clock} colorClass="text-indigo-600" loading={loading} />
        <MetricCard title="Within 7 Days" value={hearings7.length} icon={Bell} colorClass="text-orange-500" loading={loading} />
        <MetricCard title="Dormant Cases" value={dormant.length} icon={Moon} colorClass="text-red-600" subtitle="Pending, no upcoming date" loading={loading} />
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
                    <TableHead className="whitespace-nowrap">Action</TableHead>
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
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => setNotifyCase(c)}
                        >
                          <Bell className="h-3 w-3" /> Notify User
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Notification modal ── */}
      <NotifyModal open={!!notifyCase} onClose={() => setNotifyCase(null)} caseItem={notifyCase} />
    </div>
  );
}
