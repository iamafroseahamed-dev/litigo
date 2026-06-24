import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Scale, ListPlus } from 'lucide-react';
import { CaseDetailsModal } from '@/components/CaseDetailsModal';
import { TaskFormDialog } from '@/components/TaskFormDialog';
import { HEARING_TASK_TEMPLATES } from '@/lib/caseManagement';
import { useOrg } from '@/lib/orgContext';
import type { Case } from '@/types';

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Days from today (>= 0 for future). Returns null when undatable.
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

// Color coding: Today=red, ≤7d=orange, ≤30d=blue, future=grey
function HearingDateBadge({ iso }: { iso: string | null | undefined }) {
  const days = daysUntil(iso);
  let cls = 'bg-gray-100 text-gray-700';
  let tag = 'Future';
  if (days !== null) {
    if (days <= 0) { cls = 'bg-red-100 text-red-700'; tag = 'Today'; }
    else if (days <= 7) { cls = 'bg-orange-100 text-orange-700'; tag = `In ${days}d`; }
    else if (days <= 30) { cls = 'bg-blue-100 text-blue-700'; tag = `In ${days}d`; }
    else { cls = 'bg-gray-100 text-gray-700'; tag = `In ${days}d`; }
  }
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap">{fmtDate(iso)}</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{tag}</span>
    </div>
  );
}

export default function UpcomingHearingsPage() {
  const today = useMemo(() => isoToday(), []);
  const { org } = useOrg();
  const orgId = org?.id ?? null;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsNumber, setDetailsNumber] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  // Quick task creation (hearing within 7 days)
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskCaseId, setTaskCaseId] = useState<string | null>(null);
  const [taskCaseNumber, setTaskCaseNumber] = useState<string | null>(null);
  const [taskHearingDate, setTaskHearingDate] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['upcoming-hearings', today, orgId],
    queryFn: async (): Promise<Case[]> => {
      let query = supabase
        .from('cases')
        .select('*')
        .gte('next_hearing_date', today)
        .order('next_hearing_date', { ascending: true, nullsFirst: false });
      if (orgId) query = query.or(`organization_id.eq.${orgId},organization_id.is.null`);
      const { data, error: sbErr } = await query;
      if (sbErr) throw new Error(sbErr.message);
      return (data ?? []) as Case[];
    },
  });

  const rows = data ?? [];

  function openDetails(c: Case) {
    setDetailsNumber(c.case_number);
    setDetailsId(c.id);
    setDetailsOpen(true);
  }

  function openTask(c: Case) {
    setTaskCaseId(c.id);
    setTaskCaseNumber(c.case_number ?? null);
    setTaskHearingDate(c.next_hearing_date ? String(c.next_hearing_date).slice(0, 10) : null);
    setTaskOpen(true);
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">Upcoming Hearings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          All cases with a next hearing date on or after today, soonest first.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isLoading ? 'Hearings' : `${rows.length} upcoming hearing${rows.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-sm text-destructive">
              {(error as Error).message}
              <Button variant="ghost" size="sm" className="ml-2" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No upcoming hearings scheduled.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Case Number</TableHead>
                    <TableHead className="whitespace-nowrap">Court</TableHead>
                    <TableHead className="whitespace-nowrap">District</TableHead>
                    <TableHead className="whitespace-nowrap">Next Hearing Date</TableHead>
                    <TableHead className="whitespace-nowrap">Case Status</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                        {c.case_number}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate" title={c.court_name ?? undefined}>
                        {c.court_name ?? '\u2014'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{c.district ?? '\u2014'}</TableCell>
                      <TableCell><HearingDateBadge iso={c.next_hearing_date} /></TableCell>
                      <TableCell className="whitespace-nowrap">{c.case_status ?? '\u2014'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            title="Create task for this case"
                            onClick={() => openTask(c)}
                          >
                            <ListPlus className="h-3 w-3" />
                            Create Task
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            disabled={!c.case_number}
                            onClick={() => openDetails(c)}
                          >
                            <Scale className="h-3 w-3" />
                            View Details
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── eCourts Case Details Modal (fresh data, not DB) ── */}
      <CaseDetailsModal
        caseNumber={detailsNumber}
        caseId={detailsId}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />

      {/* ── Quick task creation for upcoming hearing ── */}
      {taskCaseId && (
        <TaskFormDialog
          open={taskOpen}
          onOpenChange={setTaskOpen}
          caseId={taskCaseId}
          caseNumber={taskCaseNumber}
          initialDueDate={taskHearingDate}
          initialHearingDate={taskHearingDate}
          templates={HEARING_TASK_TEMPLATES}
        />
      )}
    </div>
  );
}
