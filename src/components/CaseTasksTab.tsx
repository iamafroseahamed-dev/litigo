import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CheckCircle2, Edit2, Loader2, ListTodo, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { TaskFormDialog } from '@/components/TaskFormDialog';
import { fmtDate, taskPriorityClasses, taskStatusClasses, emailStatusClasses } from '@/lib/caseManagement';
import type { CaseTask } from '@/types';

export function CaseTasksTab({ caseId, caseNumber }: { caseId: string | null | undefined; caseNumber?: string | null }) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CaseTask | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('case_tasks')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setTasks((data ?? []) as CaseTask[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditing(null); setDialogOpen(true); }
  function openEdit(t: CaseTask) { setEditing(t); setDialogOpen(true); }

  async function markComplete(t: CaseTask) {
    setBusyId(t.id);
    const { error } = await supabase
      .from('case_tasks')
      .update({ task_status: 'Completed', completed_at: new Date().toISOString() })
      .eq('id', t.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Task marked complete.');
    await load();
  }

  async function remove(t: CaseTask) {
    setBusyId(t.id);
    const { error } = await supabase.from('case_tasks').delete().eq('id', t.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Task deleted.');
    await load();
  }

  if (!caseId) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Tasks are available once a case is selected.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        <Button size="sm" className="h-8 gap-1" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" /> Add Task
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
          <ListTodo className="h-5 w-5" /> No tasks yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Email Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-[200px]">
                    <p className="text-sm font-medium">{t.task_title}</p>
                    {t.task_description && (
                      <p className="truncate text-xs text-muted-foreground" title={t.task_description}>{t.task_description}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{t.assigned_to_name || '\u2014'}</TableCell>
                  <TableCell className="text-xs">{t.assigned_to_mobile || '\u2014'}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs" title={t.assigned_to_email ?? ''}>{t.assigned_to_email || '\u2014'}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDate(t.due_date)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskPriorityClasses(t.priority)}`}>{t.priority}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskStatusClasses(t.task_status)}`}>{t.task_status}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${emailStatusClasses(t.email_notification_status)}`}>{t.email_notification_status ?? 'Pending'}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit"
                        disabled={busyId === t.id} onClick={() => openEdit(t)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="Mark Complete"
                        disabled={busyId === t.id || t.task_status === 'Completed'} onClick={() => markComplete(t)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" title="Delete"
                        disabled={busyId === t.id} onClick={() => remove(t)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        caseId={caseId}
        caseNumber={caseNumber}
        task={editing}
        onSaved={load}
      />
    </div>
  );
}
