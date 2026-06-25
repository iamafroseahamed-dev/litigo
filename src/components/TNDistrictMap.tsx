import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin } from 'lucide-react';
import type { DistrictDetail, DistrictLitigation } from '@/lib/dashboardQueries';

export function TNDistrictMap({
  districts, details, selected, onSelect, loading,
}: {
  districts: DistrictLitigation[];
  details?: Record<string, DistrictDetail>;
  selected: string | null;
  onSelect: (district: string) => void;
  loading: boolean;
}) {
  const totalAcross = useMemo(() => districts.reduce((sum, d) => sum + d.total, 0), [districts]);
  const ranked = useMemo(() => [...districts].sort((a, b) => b.total - a.total), [districts]);
  const topTotal = ranked[0]?.total ?? 0;

  const tooltipText = (d: DistrictLitigation) => {
    const detail = details?.[d.district];
    const sensitive = detail?.sensitive ?? 0;
    const upcoming = detail?.upcomingHearings ?? 0;
    const advocates = detail?.advocates ?? 0;
    const openTasks = detail?.openTasks ?? 0;
    const overdueTasks = detail?.overdueTasks ?? 0;
    return [
      d.district,
      `Total cases: ${d.total}`,
      `Pending: ${d.pending}`,
      `Disposed: ${d.disposed}`,
      `Sensitive: ${sensitive}`,
      `Upcoming hearings: ${upcoming}`,
      `Advocates: ${advocates}`,
      `Open tasks: ${openTasks}`,
      `Overdue tasks: ${overdueTasks}`,
      'Click for full district analytics',
    ].join('\n');
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-blue-600" /> District Insights Explorer
        </CardTitle>
        <p className="text-xs text-muted-foreground">Hover each district row for tooltip details. Click a district to open full analytics.</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[420px] w-full animate-pulse rounded-md bg-muted" />
        ) : ranked.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No district analytics available.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Districts Covered</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{ranked.length}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Total District Cases</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{totalAcross.toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Peak District Volume</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{topTotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Selected District</p>
                <p className="mt-1 truncate text-xl font-semibold">{selected ?? 'None'}</p>
              </div>
            </div>

            <div className="max-h-[440px] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">District</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">Pending</th>
                    <th className="px-3 py-2 text-right font-medium">Disposed</th>
                    <th className="px-3 py-2 font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(d => {
                    const selectedRow = selected === d.district;
                    const share = totalAcross > 0 ? (d.total / totalAcross) * 100 : 0;
                    const pct = topTotal > 0 ? Math.max(4, Math.round((d.total / topTotal) * 100)) : 4;
                    return (
                      <tr
                        key={d.district}
                        title={tooltipText(d)}
                        onClick={() => onSelect(d.district)}
                        className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-blue-50/60 ${selectedRow ? 'bg-blue-50/80' : ''}`}
                        aria-label={`Open ${d.district} district analytics`}
                      >
                        <td className="px-3 py-2 font-medium">{d.district}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{d.total.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600">{d.pending.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{d.disposed.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-right text-[11px] text-muted-foreground">{share.toFixed(1)}%</p>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
