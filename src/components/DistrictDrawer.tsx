import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, MapPin, Users, Layers, CalendarClock, AlertTriangle, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { advocateStatusClasses, advocateStatusShort } from '@/lib/caseManagement';
import type { DistrictDetail } from '@/lib/dashboardQueries';

/**
 * District analytics drawer — opens on map click. Right-side drawer on desktop,
 * full-screen bottom sheet on mobile. Shows district summary, advocate & section
 * breakdowns, upcoming hearings, high-priority cases and a filterable case list,
 * so the Tamil Nadu map acts as an in-dashboard navigation/analytics surface.
 */

const FILTERS = [
  { key: 'all', label: 'All Cases' },
  { key: 'pending', label: 'Pending' },
  { key: 'disposed', label: 'Disposed' },
  { key: 'active', label: 'Active' },
  { key: 'sensitive', label: 'Sensitive' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString('en-IN')}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">{'\u2014'}</span>;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${advocateStatusClasses(status)}`} title={status}>
      {advocateStatusShort(status)}
    </span>
  );
}

function SectionTitle({ icon: Icon, children, color }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; color: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${color}`} />
      <h3 className="text-sm font-semibold">{children}</h3>
    </div>
  );
}

export function DistrictDrawer({
  district, detail, open, onClose,
}: {
  district: string | null;
  detail: DistrictDetail | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');

  // Reset the case filter whenever a different district is opened.
  useEffect(() => { setFilter('all'); }, [district]);

  const filteredCases = useMemo(() => {
    const list = detail?.caseList ?? [];
    switch (filter) {
      case 'pending': return list.filter(c => (c.status ?? '').toLowerCase() === 'pending');
      case 'disposed': return list.filter(c => (c.status ?? '').toLowerCase() === 'disposed');
      case 'active': return list.filter(c => (c.status ?? '').toLowerCase() === 'active');
      case 'sensitive': return list.filter(c => c.sensitive);
      default: return list;
    }
  }, [detail, filter]);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-background shadow-2xl focus:outline-none',
            'inset-0 w-full',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-full sm:max-w-xl sm:border-l',
            'data-[state=open]:animate-in data-[state=closed]:animate-out duration-300',
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            'sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2">
              <MapPin className="h-5 w-5 shrink-0 text-blue-300" />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-bold">{district ? `${district} District` : 'District'}</Dialog.Title>
                <Dialog.Description className="text-[11px] text-blue-200">Litigation analytics</Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none" aria-label="Close">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {!detail ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              No data available for this district.
            </div>
          ) : (
            <div className="flex-1 space-y-6 overflow-y-auto p-4">
              {/* District Summary */}
              <section>
                <SectionTitle icon={Briefcase} color="text-slate-700">District Summary</SectionTitle>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Total Cases"       value={detail.total}           color="text-slate-700" />
                  <Tile label="Pending Cases"     value={detail.pending}         color="text-amber-600" />
                  <Tile label="Disposed Cases"    value={detail.disposed}        color="text-emerald-600" />
                  <Tile label="Active Cases"      value={detail.active}          color="text-blue-600" />
                  <Tile label="Sensitive Cases"   value={detail.sensitive}       color="text-rose-600" />
                  <Tile label="Upcoming Hearings" value={detail.upcomingHearings} color="text-indigo-600" />
                  <Tile label="Open Tasks"        value={detail.openTasks}       color="text-slate-700" />
                  <Tile label="Overdue Tasks"     value={detail.overdueTasks}    color="text-red-600" />
                </div>
              </section>

              {/* Advocate Summary */}
              <section>
                <SectionTitle icon={Users} color="text-blue-600">Advocate Summary</SectionTitle>
                {detail.advocateBreakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No advocates assigned.</p>
                ) : (
                  <div className="max-h-56 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Advocate</th>
                          <th className="px-3 py-2 text-right font-medium">Assigned Cases</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.advocateBreakdown.map((r, i) => (
                          <tr key={`${r.advocate}-${i}`} className="border-b last:border-0">
                            <td className="px-3 py-2">{r.advocate}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.cases}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Section Summary */}
              <section>
                <SectionTitle icon={Layers} color="text-indigo-600">Section Summary</SectionTitle>
                {detail.sectionBreakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No section data.</p>
                ) : (
                  <div className="max-h-56 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Section</th>
                          <th className="px-3 py-2 text-right font-medium">Cases</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sectionBreakdown.map((r, i) => (
                          <tr key={`${r.section}-${i}`} className="border-b last:border-0">
                            <td className="px-3 py-2">{r.section}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.cases}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Upcoming Hearings */}
              <section>
                <SectionTitle icon={CalendarClock} color="text-indigo-600">Upcoming Hearings</SectionTitle>
                {detail.upcomingHearingsList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming hearings.</p>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-background">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Case Number</th>
                          <th className="px-3 py-2 font-medium">Hearing Date</th>
                          <th className="px-3 py-2 font-medium">Advocate Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.upcomingHearingsList.map((r, i) => (
                          <tr key={`${r.caseNumber}-${i}`} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                            <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.hearingDate)}</td>
                            <td className="px-3 py-2"><StatusPill status={r.advocateStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Top Priority Cases */}
              <section>
                <SectionTitle icon={AlertTriangle} color="text-amber-600">Top Priority Cases</SectionTitle>
                <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>Counter Pending <b className="text-foreground">{detail.counterPending}</b></span>
                  <span>Documents Awaited <b className="text-foreground">{detail.documentsAwaited}</b></span>
                  <span>Compliance Pending <b className="text-foreground">{detail.compliancePending}</b></span>
                  <span>Ready For Hearing <b className="text-foreground">{detail.readyForHearing}</b></span>
                </div>
                {detail.priorityCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No high-priority cases.</p>
                ) : (
                  <div className="max-h-56 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Case Number</th>
                          <th className="px-3 py-2 font-medium">Advocate Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.priorityCases.map((r, i) => (
                          <tr key={`${r.caseNumber}-${i}`} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                            <td className="px-3 py-2"><StatusPill status={r.advocateStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Filterable case list */}
              <section>
                <SectionTitle icon={Briefcase} color="text-slate-700">Cases</SectionTitle>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {FILTERS.map(f => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        filter === f.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-input bg-background hover:bg-muted',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                  <span className="ml-auto self-center text-xs text-muted-foreground">{filteredCases.length} case{filteredCases.length !== 1 ? 's' : ''}</span>
                </div>
                {filteredCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cases for this filter.</p>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Case Number</th>
                          <th className="px-3 py-2 font-medium">Court Status</th>
                          <th className="px-3 py-2 font-medium">Advocate Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCases.slice(0, 200).map((r, i) => (
                          <tr key={`${r.caseNumber}-${i}`} className="border-b last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.caseNumber ?? '\u2014'}</td>
                            <td className="px-3 py-2">{r.status ?? '\u2014'}{r.sensitive ? <span className="ml-1 rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700">SENSITIVE</span> : null}</td>
                            <td className="px-3 py-2"><StatusPill status={r.advocateStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
