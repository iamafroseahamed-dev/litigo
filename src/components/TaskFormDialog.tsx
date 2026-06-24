import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { TASK_STATUSES, TASK_PRIORITIES, isValidEmail, fmtDate } from '@/lib/caseManagement';
import type { Advocate, CaseTask, TaskPriority, TaskStatus } from '@/types';

interface TaskFormState {
  task_title: string;
  task_description: string;
  assigned_to_name: string;
  assigned_to_email: string;
  assigned_to_mobile: string;
  due_date: string;
  related_hearing_date: string;
  priority: TaskPriority;
  task_status: TaskStatus;
}

const EMPTY: TaskFormState = {
  task_title: '', task_description: '', assigned_to_name: '', assigned_to_email: '',
  assigned_to_mobile: '', due_date: '', related_hearing_date: '', priority: 'Medium', task_status: 'Open',
};

interface PendingNotify {
  taskId: string;
  email: string;
  subject: string;
  body: string;
}

export function TaskFormDialog({
  open, onOpenChange, caseId, caseNumber, task, initialTitle, initialDueDate, initialHearingDate, templates, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber?: string | null;
  task?: CaseTask | null;
  initialTitle?: string;
  initialDueDate?: string | null;
  initialHearingDate?: string | null;
  templates?: readonly string[];
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<TaskFormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [advocates, setAdvocates] = useState<Advocate[]>([]);
  const [advocateId, setAdvocateId] = useState<string>('');
  const [notify, setNotify] = useState<PendingNotify | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const isEdit = !!task;

  // Advocate master for the assignment dropdown
  useEffect(() => {
    if (!open) return;
    supabase
      .from('advocates')
      .select('id, advocate_name, email, mobile, designation, active, created_at')
      .eq('active', true)
      .order('advocate_name', { ascending: true })
      .then(({ data }) => setAdvocates((data ?? []) as Advocate[]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAdvocateId('');
    if (task) {
      setForm({
        task_title: task.task_title ?? '',
        task_description: task.task_description ?? '',
        assigned_to_name: task.assigned_to_name ?? '',
        assigned_to_email: task.assigned_to_email ?? '',
        assigned_to_mobile: task.assigned_to_mobile ?? '',
        due_date: task.due_date ?? '',
        related_hearing_date: task.related_hearing_date ?? '',
        priority: task.priority ?? 'Medium',
        task_status: task.task_status ?? 'Open',
      });
    } else {
      setForm({
        ...EMPTY,
        task_title: initialTitle ?? '',
        due_date: initialDueDate ?? '',
        related_hearing_date: initialHearingDate ?? '',
      });
    }
  }, [open, task, initialTitle, initialDueDate, initialHearingDate]);

  const txt = (f: keyof TaskFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value }));

  function pickAdvocate(id: string) {
    setAdvocateId(id);
    const a = advocates.find(x => x.id === id);
    if (a) {
      setForm(p => ({
        ...p,
        assigned_to_name: a.advocate_name ?? '',
        assigned_to_email: a.email ?? '',
        assigned_to_mobile: a.mobile ?? '',
      }));
    }
  }

  const emailRaw = form.assigned_to_email.trim();
  const emailInvalid = emailRaw !== '' && !isValidEmail(emailRaw);

  function buildEmailBody(): string {
    const assignedBy = user?.profile?.full_name || user?.email || 'Legal Officer';
    return [
      `Case Number: ${caseNumber || '\u2014'}`,
      `Task: ${form.task_title.trim()}`,
      `Description: ${form.task_description.trim() || '\u2014'}`,
      `Priority: ${form.priority}`,
      `Due Date: ${form.due_date ? fmtDate(form.due_date) : '\u2014'}`,
      `Assigned By: ${assignedBy}`,
      '',
      'Please login to Litigo to review the case.',
    ].join('\n');
  }

  async function save() {
    if (!form.task_title.trim()) { toast.error('Task title is required.'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        task_title: form.task_title.trim(),
        task_description: form.task_description.trim() || null,
        assigned_to_name: form.assigned_to_name.trim() || null,
        assigned_to_email: emailRaw || null,
        assigned_to_mobile: form.assigned_to_mobile.trim() || null,
        due_date: form.due_date || null,
        related_hearing_date: form.related_hearing_date || null,
        priority: form.priority,
        task_status: form.task_status,
        completed_at: form.task_status === 'Completed' ? new Date().toISOString() : null,
      };

      if (isEdit && task) {
        const { error } = await supabase.from('case_tasks').update(payload).eq('id', task.id);
        if (error) throw error;
        toast.success('Task updated.');
        onOpenChange(false);
        onSaved?.();
        return;
      }

      const { data, error } = await supabase.from('case_tasks').insert({
        ...payload,
        case_id: caseId,
        created_by: user?.profile?.full_name || user?.email || 'Unknown',
        email_notification_status: 'Pending',
      }).select('id').single();
      if (error) throw error;

      toast.success('Task assigned successfully.');
      onOpenChange(false);
      onSaved?.();

      // Offer email notification only when a valid email is present.
      if (data?.id && emailRaw && isValidEmail(emailRaw)) {
        setNotify({
          taskId: data.id as string,
          email: emailRaw,
          subject: 'New Litigation Task Assigned',
          body: buildEmailBody(),
        });
      } else if (emailInvalid) {
        toast.warning('Email notification unavailable. Valid email address not found.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save task.');
    } finally {
      setSaving(false);
    }
  }

  async function resolveNotify(send: boolean) {
    if (!notify) return;
    setNotifyBusy(true);
    try {
      if (send) {
        const { error } = await supabase.from('case_tasks').update({
          email_notification_sent: true,
          email_notification_sent_at: new Date().toISOString(),
          email_notification_status: 'Sent',
        }).eq('id', notify.taskId);
        if (error) throw error;
        toast.success(`Email notification sent to ${notify.email}.`);
      } else {
        const { error } = await supabase.from('case_tasks').update({
          email_notification_sent: false,
          email_notification_status: 'Skipped',
        }).eq('id', notify.taskId);
        if (error) throw error;
        toast.info('Email notification skipped.');
      }
      setNotify(null);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update notification status.');
    } finally {
      setNotifyBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit Task' : 'Create Task'}</DialogTitle>
            <DialogDescription>
              {isEdit ? 'Update the task details.' : 'Create and assign a task for this case.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {caseNumber && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Case Number</Label>
                <Input value={caseNumber} readOnly className="bg-muted/40 font-mono text-sm" />
              </div>
            )}

            {!isEdit && templates && templates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {templates.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, task_title: t }))}
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Task Title <span className="text-red-500">*</span></Label>
              <Input value={form.task_title} onChange={txt('task_title')} placeholder="e.g. Prepare Counter Affidavit" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Task Description</Label>
              <Textarea value={form.task_description} onChange={txt('task_description')} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Assigned Advocate</Label>
              <Select value={advocateId} onValueChange={pickAdvocate}>
                <SelectTrigger><SelectValue placeholder="Select advocate" /></SelectTrigger>
                <SelectContent>
                  {advocates.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No advocates found. Add them to the advocate master.</div>
                  ) : advocates.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.advocate_name}{a.designation ? ` \u00b7 ${a.designation}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Advocate Name</Label>
                <Input value={form.assigned_to_name} onChange={txt('assigned_to_name')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Mobile Number</Label>
                <Input value={form.assigned_to_mobile} onChange={txt('assigned_to_mobile')} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium">Email Address</Label>
                <Input
                  value={form.assigned_to_email}
                  onChange={txt('assigned_to_email')}
                  placeholder="advocate@cla.gov.in"
                  className={emailInvalid ? 'border-red-400 focus-visible:ring-red-400' : ''}
                />
                {emailInvalid && (
                  <p className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3 w-3" />
                    Email notification unavailable. Valid email address not found.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <Input type="date" value={form.due_date} onChange={txt('due_date')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Related Hearing Date</Label>
                <Input type="date" value={form.related_hearing_date} onChange={txt('related_hearing_date')} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm(p => ({ ...p, priority: v as TaskPriority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isEdit && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Status</Label>
                  <Select value={form.task_status} onValueChange={(v) => setForm(p => ({ ...p, task_status: v as TaskStatus }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="gap-1">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* \u2500\u2500 Email notification confirmation \u2500\u2500 */}
      <Dialog open={!!notify} onOpenChange={(o) => { if (!o && !notifyBusy) resolveNotify(false); }}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Task assigned successfully
            </DialogTitle>
            <DialogDescription>
              Send email notification to <strong>{notify?.email}</strong>?
            </DialogDescription>
          </DialogHeader>
          {notify && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-muted-foreground">Subject</p>
              <p className="mb-2 text-sm">{notify.subject}</p>
              <p className="text-xs font-semibold text-muted-foreground">Body</p>
              <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">{notify.body}</pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => resolveNotify(false)} disabled={notifyBusy}>No</Button>
            <Button onClick={() => resolveNotify(true)} disabled={notifyBusy} className="gap-1">
              {notifyBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Yes, Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
