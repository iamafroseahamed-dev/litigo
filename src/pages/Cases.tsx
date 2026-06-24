import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Plus, Search, Edit2, Eye, ExternalLink, FileText, Filter, Loader2, X, PowerOff, RefreshCw, Download, Scale, UserPlus, ListPlus, Link2, Trash2, MoreHorizontal, StickyNote } from 'lucide-react';
import * as XLSX from 'xlsx';
import { CaseDetailsModal } from '@/components/CaseDetailsModal';
import { TaskFormDialog } from '@/components/TaskFormDialog';
import { AddConnectionDialog } from '@/components/AddConnectionDialog';
import { addConnection, loadConnectionCounts, type CaseSearchResult } from '@/lib/connections';
import { ADVOCATE_STATUSES, advocateStatusClasses, advocateStatusShort } from '@/lib/caseManagement';
import { DEVELOPER_NAME, DEVELOPER_EMAIL } from '@/lib/appInfo';
import { useAuth } from '@/lib/auth';
import type { Case, Advocate } from '@/types';

const COURTS = [
  'Supreme Court of India', 'High Court', 'District Court', 'Sessions Court',
  'Civil Court', 'Family Court', 'Magistrate Court', 'Tribunal', 'Consumer Forum', 'Labour Court',
];
const CLA_PARTY_STATUSES = ['Petitioner', 'Respondent', 'Appellant', 'Defendant', 'Complainant', 'Accused'];
const SENSITIVITIES = ['Sensitive', 'Non-Sensitive'];
const CASE_STATUSES = ['Active', 'Pending', 'Disposed'];
const FOLLOW_UP_STATUSES = ['Urgent', 'Update Required', 'No Action'];

type FormData = Omit<Case, 'id' | 'organization_id' | 'created_at' | 'updated_at' | 'source_file' | 'source_sheet' | 'import_batch' | 'case_section' | 'followup_status' | 'ecourts_case_no' | 'cnr_discovered_at'>;

const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

interface DraftTask { task_title: string; task_description: string; assigned_to_name: string; assigned_to_email: string; assigned_to_mobile: string; priority: string; due_date: string | null; }
interface DraftConnection { case: CaseSearchResult; relationship_type: string; }
interface CaseFormExtras { notes: string[]; tasks: DraftTask[]; connections: DraftConnection[]; }

const EMPTY_FORM: FormData = {
  cnr_number: null, case_number: '', court_name: null, district: null, section: null,
  petitioner: null, respondent: null, prayer: null, subject_matter: null,
  cla_party_status: null, sensitivity: null, case_status: null, nature_of_disposal: null,
  last_hearing_date: null, last_hearing_update: null, next_hearing_date: null,
  advocate_name: null, advocate_mobile: null, advocate_email: null,
  client_name: null, client_mobile: null, client_whatsapp: null, client_email: null,
  follow_up_status: null, active: true, advocate_status: null,
};

interface Filters {
  district: string; section: string;
  cla_party_status: string; sensitivity: string;
  case_status: string; follow_up_status: string; active: string;
}
const EMPTY_FILTERS: Filters = { district: '', section: '', cla_party_status: '', sensitivity: '', case_status: '', follow_up_status: '', active: '' };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CaseStatusBadge({ status }: { status: string | null }) {
  if (status === 'Active') return <Badge variant="success">Active</Badge>;
  if (status === 'Pending') return <Badge variant="warning">Pending</Badge>;
  if (status === 'Disposed') return <Badge variant="secondary">Disposed</Badge>;
  return status ? <Badge variant="outline">{status}</Badge> : null;
}

function FollowUpBadge({ status }: { status: string | null }) {
  if (status === 'Urgent') return <Badge variant="destructive">Urgent</Badge>;
  if (status === 'Update Required') return <Badge variant="info">Update Required</Badge>;
  if (status === 'No Action') return <Badge variant="secondary">No Action</Badge>;
  if (status === 'Inactive') return <Badge variant="secondary">Inactive</Badge>;
  return status ? <Badge variant="outline">{status}</Badge> : null;
}

function SensitivityBadge({ sensitivity }: { sensitivity: string | null }) {
  if (sensitivity === 'Sensitive') return <Badge variant="purple">Sensitive</Badge>;
  if (sensitivity === 'Non-Sensitive') return <Badge variant="outline">Non-Sensitive</Badge>;
  return null;
}

function AdvocateStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${advocateStatusClasses(status)}`} title={status}>
      {advocateStatusShort(status)}
    </span>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">{title}</p>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function CaseForm({ initial, advocates, onSave, onCancel, saving }: {
  initial: FormData; advocates: Advocate[]; onSave: (d: FormData, extras: CaseFormExtras) => void; onCancel: () => void; saving: boolean;
}) {
  const [form, setForm] = useState<FormData>(initial);
  const [notes, setNotes] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [taskDraft, setTaskDraft] = useState<DraftTask>({ task_title: '', task_description: '', assigned_to_name: '', assigned_to_email: '', assigned_to_mobile: '', priority: 'Medium', due_date: null });
  const [connections, setConnections] = useState<DraftConnection[]>([]);
  const [connOpen, setConnOpen] = useState(false);

  const txt = (f: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value || null }));
  const sel = (f: keyof FormData) => (v: string) =>
    setForm(p => ({ ...p, [f]: v === '__none__' ? null : v }));

  const assignAdvocate = (id: string) => {
    if (id === '__none__') {
      setForm(p => ({ ...p, assigned_advocate_name: null, assigned_advocate_email: null, assigned_advocate_mobile: null }));
      return;
    }
    const adv = advocates.find(a => a.id === id);
    if (adv) setForm(p => ({ ...p, assigned_advocate_name: adv.advocate_name, assigned_advocate_email: adv.email, assigned_advocate_mobile: adv.mobile }));
  };
  const selectedAdvocateId = advocates.find(a => a.advocate_name === form.assigned_advocate_name)?.id ?? '__none__';

  const addNote = () => { const v = noteDraft.trim(); if (!v) return; setNotes(p => [...p, v]); setNoteDraft(''); };
  const addTask = () => { const t = taskDraft.task_title.trim(); if (!t) return; setTasks(p => [...p, { ...taskDraft, task_title: t }]); setTaskDraft({ task_title: '', task_description: '', assigned_to_name: '', assigned_to_email: '', assigned_to_mobile: '', priority: 'Medium', due_date: null }); };

  return (
    <div className="overflow-y-auto max-h-[65vh] pr-1 space-y-5">
      <div className="space-y-3">
        <SectionHeader title="Case Identification" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Case Number" required>
            <Input placeholder="WP/1234/2024" value={form.case_number} onChange={e => setForm(p => ({ ...p, case_number: e.target.value }))} />
          </Field>
          <Field label="CNR Number">
            <Input placeholder="TNHC0010002024" value={form.cnr_number ?? ''} onChange={txt('cnr_number')} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Parties" />
        <Field label="Petitioner Details">
          <Textarea rows={2} placeholder="Petitioner name / details" value={form.petitioner ?? ''} onChange={txt('petitioner')} />
        </Field>
        <Field label="Respondent Details">
          <Textarea rows={2} placeholder="Respondent name / details" value={form.respondent ?? ''} onChange={txt('respondent')} />
        </Field>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Court Information" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Court Name">
            <Select value={form.court_name ?? '__none__'} onValueChange={sel('court_name')}>
              <SelectTrigger><SelectValue placeholder="Select court" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {COURTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="District">
            <Input placeholder="e.g. Chennai" value={form.district ?? ''} onChange={txt('district')} />
          </Field>
          <Field label="Section">
            <Input placeholder="e.g. Sec. 34 IPC" value={form.section ?? ''} onChange={txt('section')} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Classification" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="CLA Party Status">
            <Select value={form.cla_party_status ?? '__none__'} onValueChange={sel('cla_party_status')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {CLA_PARTY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Sensitivity">
            <Select value={form.sensitivity ?? '__none__'} onValueChange={sel('sensitivity')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {SENSITIVITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Case Status">
            <Select value={form.case_status ?? '__none__'} onValueChange={sel('case_status')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {CASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Nature of Disposal">
          <Input placeholder="e.g. Allowed, Dismissed, Withdrawn" value={form.nature_of_disposal ?? ''} onChange={txt('nature_of_disposal')} />
        </Field>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Case Profile" />
        <Field label="Subject Matter / Connected Cases">
          <Textarea rows={2} placeholder="Subject matter or connected case numbers" value={form.subject_matter ?? ''} onChange={txt('subject_matter')} />
        </Field>
        <Field label="Prayer">
          <Textarea rows={3} placeholder="Prayer / relief sought" value={form.prayer ?? ''} onChange={txt('prayer')} />
        </Field>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Hearing Information" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Last Hearing Date">
            <Input type="date" value={form.last_hearing_date ?? ''} onChange={txt('last_hearing_date')} />
          </Field>
          <Field label="Next Hearing Date">
            <Input type="date" value={form.next_hearing_date ?? ''} onChange={txt('next_hearing_date')} />
          </Field>
        </div>
        <Field label="Last Hearing Update">
          <Textarea rows={2} placeholder="What transpired at the last hearing" value={form.last_hearing_update ?? ''} onChange={txt('last_hearing_update')} />
        </Field>
        <Field label="Follow-up Status">
          <Select value={form.follow_up_status ?? '__none__'} onValueChange={sel('follow_up_status')}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {FOLLOW_UP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Advocate Assignment" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Assigned Advocate">
            <Select value={selectedAdvocateId} onValueChange={assignAdvocate}>
              <SelectTrigger><SelectValue placeholder="Select advocate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Unassigned —</SelectItem>
                {advocates.map(a => <SelectItem key={a.id} value={a.id}>{a.advocate_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Advocate Email">
            <Input value={form.assigned_advocate_email ?? ''} onChange={txt('assigned_advocate_email')} placeholder="advocate@example.com" />
          </Field>
          <Field label="Advocate Mobile">
            <Input value={form.assigned_advocate_mobile ?? ''} onChange={txt('assigned_advocate_mobile')} placeholder="+91…" />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Advocate Activity Status" />
        <p className="text-[11px] text-muted-foreground -mt-1">
          Internal progress of the advocate / CLA team on this case — separate from the court status, which is updated automatically from the court systems.
        </p>
        <Field label="Advocate Status">
          <Select value={form.advocate_status ?? '__none__'} onValueChange={sel('advocate_status')}>
            <SelectTrigger><SelectValue placeholder="Select activity status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {ADVOCATE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        <SectionHeader title="Notes" />
        <div className="flex gap-2">
          <Input placeholder="Add a note…" value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }} />
          <Button type="button" variant="outline" onClick={addNote}><Plus className="h-4 w-4" /></Button>
        </div>
        {notes.length > 0 && (
          <ul className="space-y-1">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="whitespace-pre-wrap">{n}</span>
                <button type="button" className="text-red-500 hover:text-red-700" onClick={() => setNotes(p => p.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <SectionHeader title="Tasks" />
        <p className="text-[11px] text-muted-foreground -mt-1">
          Tasks can be assigned to anyone (Legal Officer, Assistant, Advocate, Case Worker, Clerk or external user) — independent of the case advocate.
        </p>
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <Input placeholder="Task title…" value={taskDraft.task_title}
            onChange={e => setTaskDraft(p => ({ ...p, task_title: e.target.value }))} />
          <Input placeholder="Task description (optional)…" value={taskDraft.task_description}
            onChange={e => setTaskDraft(p => ({ ...p, task_description: e.target.value }))} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input placeholder="Assignee name" value={taskDraft.assigned_to_name}
              onChange={e => setTaskDraft(p => ({ ...p, assigned_to_name: e.target.value }))} />
            <Input placeholder="Assignee email" value={taskDraft.assigned_to_email}
              onChange={e => setTaskDraft(p => ({ ...p, assigned_to_email: e.target.value }))} />
            <Input placeholder="Assignee mobile" value={taskDraft.assigned_to_mobile}
              onChange={e => setTaskDraft(p => ({ ...p, assigned_to_mobile: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto]">
            <Select value={taskDraft.priority} onValueChange={v => setTaskDraft(p => ({ ...p, priority: v }))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" value={taskDraft.due_date ?? ''}
              onChange={e => setTaskDraft(p => ({ ...p, due_date: e.target.value || null }))} />
            <Button type="button" variant="outline" className="gap-1" onClick={addTask}><Plus className="h-4 w-4" /> Add Task</Button>
          </div>
        </div>
        {tasks.length > 0 && (
          <ul className="space-y-1">
            {tasks.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="truncate">
                  {t.task_title}
                  <span className="text-muted-foreground"> · {t.priority}{t.due_date ? ` · ${t.due_date}` : ''}{t.assigned_to_name ? ` · ${t.assigned_to_name}` : ''}</span>
                </span>
                <button type="button" className="text-red-500 hover:text-red-700" onClick={() => setTasks(p => p.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <SectionHeader title="Connected Cases" />
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setConnOpen(true)}>
          <Link2 className="h-3.5 w-3.5" /> Add Connected Case
        </Button>
        {connections.length > 0 && (
          <ul className="space-y-1">
            {connections.map((c, i) => (
              <li key={c.case.id} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="truncate font-mono">{c.case.case_number} <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-indigo-700">{c.relationship_type}</span></span>
                <button type="button" className="text-red-500 hover:text-red-700" onClick={() => setConnections(p => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <AddConnectionDialog
          open={connOpen}
          onOpenChange={setConnOpen}
          excludeIds={connections.map(c => c.case.id)}
          onAdd={(row, relationship) => {
            setConnections(p => p.some(c => c.case.id === row.id) ? p : [...p, { case: row, relationship_type: relationship }]);
          }}
        />
      </div>

      <div className="flex items-center gap-3 border-t pt-3">
        <Switch checked={form.active} onCheckedChange={v => setForm(p => ({ ...p, active: v }))} id="active-sw" />
        <Label htmlFor="active-sw">Active Case</Label>
      </div>

      <DialogFooter className="pt-2 sticky bottom-0 bg-background pb-1">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(form, { notes, tasks, connections })} disabled={!form.case_number || saving}>
          {saving ? 'Saving…' : 'Save Case'}
        </Button>
      </DialogFooter>
    </div>
  );
}


// ── MHC Order Details ──────────────────────────────────────────────────────────

interface MhcOrderDetails {
  caseNumber: string;
  caseType: string;
  pdfUrl: string | null;
  judge: string;
  judgmentDate: string;
  petitioner: string;
  respondent: string;
}

export default function CasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | 'view' | null>(null);
  const [selected, setSelected] = useState<Case | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Case | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Order modal state ────────────────────────────────────────────────────────
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderRecord, setOrderRecord]       = useState<Case | null>(null);
  const [orderDetails, setOrderDetails]     = useState<MhcOrderDetails | null>(null);
  const [orderLoading, setOrderLoading]     = useState(false);
  const [orderError, setOrderError]         = useState<string | null>(null);

  // ── eCourts Case Details modal state ─────────────────────────────────────────
  const [caseDetailsOpen, setCaseDetailsOpen]   = useState(false);
  const [caseDetailsNumber, setCaseDetailsNumber] = useState<string | null>(null);
  const [caseDetailsId, setCaseDetailsId]       = useState<string | null>(null);
  const [caseDetailsTab, setCaseDetailsTab]     = useState<string>('overview');

  // ── Advocate assignment ──────────────────────────────────────────────────────
  const [advocates, setAdvocates]           = useState<Advocate[]>([]);
  const [assignTarget, setAssignTarget]     = useState<Case | null>(null);
  const [assignAdvocateId, setAssignAdvocateId] = useState<string>('');
  const [assigning, setAssigning]           = useState(false);

  // ── Task management ──────────────────────────────────────────────────────────
  const [taskCase, setTaskCase]             = useState<Case | null>(null);
  const [taskCounts, setTaskCounts]         = useState<Record<string, { open: number; overdue: number }>>({});

  // ── Connected cases counts ───────────────────────────────────────────────────
  const [connCounts, setConnCounts]         = useState<Record<string, number>>({});
  const { user } = useAuth();
  const createdBy = user?.profile?.full_name || user?.email || 'Unknown';

  const loadConnCounts = useCallback(async () => {
    try { setConnCounts(await loadConnectionCounts()); } catch { /* table may not exist yet */ }
  }, []);
  useEffect(() => { loadConnCounts(); }, [loadConnCounts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('cases')
      .select('*')
      .eq('court_name', 'Principal Bench of Madras High Court')
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    console.log('[Cases] refreshed list', { count: data?.length ?? 0, ids: (data ?? []).map(c => c.id) });
    setCases(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Advocate master for the assignment + task dropdowns
  useEffect(() => {
    supabase
      .from('advocates')
      .select('id, advocate_name, email, mobile, designation, active, created_at')
      .eq('active', true)
      .order('advocate_name', { ascending: true })
      .then(({ data }) => setAdvocates((data ?? []) as Advocate[]));
  }, []);

  // Per-case open / overdue task counts
  const loadTaskCounts = useCallback(async () => {
    const { data } = await supabase
      .from('case_tasks')
      .select('case_id, due_date')
      .neq('task_status', 'Completed');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const m: Record<string, { open: number; overdue: number }> = {};
    (data ?? []).forEach(r => {
      const id = r.case_id as string;
      if (!m[id]) m[id] = { open: 0, overdue: 0 };
      m[id].open += 1;
      if (r.due_date && String(r.due_date) < today) m[id].overdue += 1;
    });
    setTaskCounts(m);
  }, []);

  useEffect(() => { loadTaskCounts(); }, [loadTaskCounts]);

  async function saveAssignment() {
    if (!assignTarget) return;
    const adv = advocates.find(a => a.id === assignAdvocateId);
    if (!adv) { toast.error('Select an advocate.'); return; }
    setAssigning(true);
    const { error: err } = await supabase.from('cases').update({
      assigned_advocate_name: adv.advocate_name,
      assigned_advocate_email: adv.email,
      assigned_advocate_mobile: adv.mobile,
      assigned_on: new Date().toISOString(),
    }).eq('id', assignTarget.id);
    setAssigning(false);
    if (err) { toast.error(err.message); return; }
    toast.success('Assigned successfully');
    setAssignTarget(null);
    setAssignAdvocateId('');
    await load();
  }

  const setFilter = (key: keyof Filters) => (v: string) =>
    setFilters(p => ({ ...p, [key]: v === '__all__' ? '' : v }));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cases.filter(c => {
      const matchSearch = !q ||
        (c.case_number ?? '').toLowerCase().includes(q) ||
        (c.cnr_number ?? '').toLowerCase().includes(q) ||
        (c.petitioner ?? '').toLowerCase().includes(q) ||
        (c.respondent ?? '').toLowerCase().includes(q) ||
        (c.client_name ?? '').toLowerCase().includes(q) ||
        (c.advocate_name ?? '').toLowerCase().includes(q);
      const matchFilters =
        (!filters.district || (c.district ?? '').toLowerCase().includes(filters.district.toLowerCase())) &&
        (!filters.section || (c.section ?? '').toLowerCase().includes(filters.section.toLowerCase())) &&
        (!filters.cla_party_status || c.cla_party_status === filters.cla_party_status) &&
        (!filters.sensitivity || c.sensitivity === filters.sensitivity) &&
        (!filters.case_status || c.case_status === filters.case_status) &&
        (!filters.follow_up_status || c.follow_up_status === filters.follow_up_status) &&
        (filters.active === '' || (filters.active === 'active' ? c.active : !c.active));
      return matchSearch && matchFilters;
    });
  }, [cases, search, filters]);

  const hasFilters = search || Object.values(filters).some(Boolean);
  const clearFilters = () => { setSearch(''); setFilters(EMPTY_FILTERS); };

  // Record an advocate-status change in the audit trail (case_status_history).
  // Best-effort: never blocks the save if the table is missing.
  async function logAdvocateStatusChange(caseId: string, oldStatus: string | null, newStatus: string | null) {
    try {
      await supabase.from('case_status_history').insert({
        case_id: caseId,
        old_status: oldStatus,
        new_status: newStatus,
        changed_by: createdBy,
        changed_at: new Date().toISOString(),
      });
    } catch { /* case_status_history may not exist yet */ }
  }

  const handleSave = async (data: FormData, extras: CaseFormExtras) => {
    setSaving(true);
    const now = new Date().toISOString();
    try {
      let caseId: string;
      if (dialogMode === 'add') {
        const payload: Record<string, unknown> = { ...data, created_at: now, updated_at: now };
        if (data.assigned_advocate_name) payload.assigned_on = now;
        const { data: inserted, error: err } = await supabase.from('cases')
          .insert(payload).select('id').single();
        if (err) throw err;
        caseId = inserted!.id as string;
        if (data.advocate_status) await logAdvocateStatusChange(caseId, null, data.advocate_status);
        toast.success('Case added successfully');
      } else if (dialogMode === 'edit' && selected) {
        const payload: Record<string, unknown> = { ...data, updated_at: now };
        if (data.assigned_advocate_name && !selected.assigned_on) payload.assigned_on = now;
        const { error: err } = await supabase.from('cases')
          .update(payload)
          .eq('id', selected.id);
        if (err) throw err;
        caseId = selected.id;
        if ((data.advocate_status ?? null) !== (selected.advocate_status ?? null)) {
          await logAdvocateStatusChange(caseId, selected.advocate_status ?? null, data.advocate_status ?? null);
        }
        toast.success('Case updated successfully');
      } else {
        setSaving(false);
        return;
      }

      // Persist draft notes, tasks and connections created in the form.
      if (extras.notes.length) {
        await supabase.from('case_notes').insert(
          extras.notes.map(n => ({ case_id: caseId, note_text: n, created_by: createdBy, created_at: new Date().toISOString() })),
        );
      }
      if (extras.tasks.length) {
        await supabase.from('case_tasks').insert(
          extras.tasks.map(t => ({
            case_id: caseId, task_title: t.task_title, task_description: t.task_description || null,
            assigned_to_name: t.assigned_to_name || null, assigned_to_email: t.assigned_to_email || null,
            assigned_to_mobile: t.assigned_to_mobile || null,
            priority: t.priority, due_date: t.due_date, task_status: 'Pending', created_by: createdBy,
            created_at: new Date().toISOString(),
          })),
        );
      }
      for (const c of extras.connections) {
        try { await addConnection(caseId, c.case.id, c.relationship_type); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'A connection could not be saved.'); }
      }

      setDialogMode(null);
      await Promise.all([load(), loadTaskCounts(), loadConnCounts()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (err as { message?: string }).message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    const { error: err } = await supabase.from('cases')
      .update({ active: false, follow_up_status: 'Inactive', updated_at: new Date().toISOString() })
      .eq('id', deactivateTarget.id);
    if (err) { toast.error(err.message); return; }
    toast.success('Case deactivated');
    setDeactivateTarget(null);
    await load();
  };

  // ── Fetch MHC order (via server-side proxy) ──────────────────────────────────
  async function fetchCaseDetails(caseRecord: Case) {
    const caseNumber = caseRecord.case_number;
    if (!caseNumber) return;

    setOrderRecord(caseRecord);
    setOrderModalOpen(true);
    setOrderLoading(true);
    setOrderError(null);
    setOrderDetails(null);

    try {
      const response = await fetch('/api/mhc/case-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: caseNumber }),
      });

      const result = await response.json();

      console.log('MHC CASE STATUS RESPONSE');
      console.log(result);

      if (!result.success) {
        throw new Error(result.message || 'MHC API returned an error.');
      }

      const orders: Record<string, string>[] = result.orders ?? [];
      if (orders.length === 0) {
        throw new Error('No order data returned for this case.');
      }

      const data = orders[0];
      const pdfUrl = (data.pdf_url as string | null | undefined) || null;

      console.log('PDF URL');
      console.log(pdfUrl);

      setOrderDetails({
        caseNumber:   data.caseno     ?? caseNumber,
        caseType:     data.casetype_t ?? '',
        pdfUrl,
        judge:        data.jud1    ?? '',
        judgmentDate: data.juddate ?? '',
        petitioner:   data.petname ?? '',
        respondent:   data.resname ?? '',
      });
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to fetch case details.');
    } finally {
      setOrderLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search case no, CNR, petitioner, client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant={showFilters ? 'default' : 'outline'} size="icon" className="h-10 w-10"
            onClick={() => setShowFilters(!showFilters)} title="Filters">
            <Filter className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={load} title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 text-muted-foreground">
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {filtered.length > 0 && (
            <Button variant="outline" className="w-full sm:w-auto h-10 gap-1" onClick={() => {
              const rows = filtered.map(c => ({
                'Case Number': c.case_number ?? '',
                'CNR Number': c.cnr_number ?? '',
                'Court': c.court_name ?? '',
                'District': c.district ?? '',
                'Section': c.section ?? '',
                'Petitioner': c.petitioner ?? '',
                'Respondent': c.respondent ?? '',
                'CLA Party Status': c.cla_party_status ?? '',
                'Case Status': c.case_status ?? '',
                'Sensitivity': c.sensitivity ?? '',
                'Last Hearing': c.last_hearing_date ?? '',
                'Next Hearing': c.next_hearing_date ?? '',
                'Follow Up': c.follow_up_status ?? '',
                'Advocate': c.advocate_name ?? '',
                'Client': c.client_name ?? '',
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Cases');
              XLSX.utils.sheet_add_aoa(ws, [
                [],
                [`Developed by ${DEVELOPER_NAME}`],
                [DEVELOPER_EMAIL],
              ], { origin: -1 });
              XLSX.writeFile(wb, `cases_export_${new Date().toISOString().split('T')[0]}.xlsx`);
            }}>
              <Download className="w-4 h-4" /> Export Excel
            </Button>
          )}
          <Button onClick={() => { setSelected(null); setDialogMode('add'); }} className="w-full sm:w-auto h-10">
            <Plus className="w-4 h-4 mr-1" /> Add Case
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="space-y-1">
              <Label className="text-xs">District</Label>
              <Input className="h-8 text-xs" placeholder="Filter…" value={filters.district}
                onChange={e => setFilters(p => ({ ...p, district: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Section</Label>
              <Input className="h-8 text-xs" placeholder="Filter…" value={filters.section}
                onChange={e => setFilters(p => ({ ...p, section: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CLA Party</Label>
              <Select value={filters.cla_party_status || '__all__'} onValueChange={setFilter('cla_party_status')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {CLA_PARTY_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sensitivity</Label>
              <Select value={filters.sensitivity || '__all__'} onValueChange={setFilter('sensitivity')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {SENSITIVITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Case Status</Label>
              <Select value={filters.case_status || '__all__'} onValueChange={setFilter('case_status')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {CASE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Follow-up</Label>
              <Select value={filters.follow_up_status || '__all__'} onValueChange={setFilter('follow_up_status')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {FOLLOW_UP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Active</Label>
              <Select value={filters.active || '__all__'} onValueChange={setFilter('active')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Cases
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({filtered.length}{cases.length !== filtered.length && ` of ${cases.length}`})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="py-20 text-center text-sm text-destructive">
              <p className="font-medium">Failed to load cases</p>
              <p className="text-xs mt-1 text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={load}>Retry</Button>
            </div>
          ) : cases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm font-medium">No cases found</p>
              <p className="text-xs mt-1">Add your first case or upload case data.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">No cases match your current filters.</div>
          ) : (
            <Table className="min-w-[1580px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Case No.</TableHead>
                  <TableHead className="w-36">CNR</TableHead>
                  <TableHead className="w-40">Court</TableHead>
                  <TableHead className="w-28">District</TableHead>
                  <TableHead className="w-28">Section</TableHead>
                  <TableHead>Petitioner</TableHead>
                  <TableHead>Respondent</TableHead>
                  <TableHead className="w-24">Case Status</TableHead>
                  <TableHead className="w-36">Advocate Status</TableHead>
                  <TableHead className="w-28">Next Hearing</TableHead>
                  <TableHead className="w-44">Assigned Advocate</TableHead>
                  <TableHead className="w-28">Connected</TableHead>
                  <TableHead className="w-24">Open Tasks</TableHead>
                  <TableHead className="w-24">Overdue Tasks</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(c => (
                  <TableRow key={c.id} className={!c.active ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-xs font-semibold">{c.case_number}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.cnr_number || '—'}</TableCell>
                    <TableCell className="text-xs">{c.court_name || '—'}</TableCell>
                    <TableCell className="text-xs">{c.district || '—'}</TableCell>
                    <TableCell className="text-xs">{c.section || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate" title={c.petitioner ?? ''}>{c.petitioner || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate" title={c.respondent ?? ''}>{c.respondent || '—'}</TableCell>
                    <TableCell><CaseStatusBadge status={c.case_status} /></TableCell>
                    <TableCell><AdvocateStatusBadge status={c.advocate_status} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(c.next_hearing_date)}</TableCell>
                    <TableCell className="text-xs">
                      {c.assigned_advocate_name ? (
                        <div className="leading-tight">
                          <p className="font-medium">{c.assigned_advocate_name}</p>
                          {c.assigned_advocate_email && <p className="text-muted-foreground">{c.assigned_advocate_email}</p>}
                          {c.assigned_advocate_mobile && <p className="text-muted-foreground">{c.assigned_advocate_mobile}</p>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {connCounts[c.id]
                        ? <button type="button" title="View connected cases"
                            className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-200"
                            onClick={() => { setCaseDetailsNumber(c.case_number); setCaseDetailsId(c.id); setCaseDetailsTab('connected'); setCaseDetailsOpen(true); }}>
                            <Link2 className="h-3 w-3" />{connCounts[c.id]}
                          </button>
                        : <button type="button" title="View connected cases" className="text-muted-foreground hover:text-foreground"
                            onClick={() => { setCaseDetailsNumber(c.case_number); setCaseDetailsId(c.id); setCaseDetailsTab('connected'); setCaseDetailsOpen(true); }}>0</button>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {taskCounts[c.id]?.open
                        ? <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{taskCounts[c.id].open} Open</span>
                        : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {taskCounts[c.id]?.overdue
                        ? <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{taskCounts[c.id].overdue} Overdue</span>
                        : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Primary actions — always labeled, visible on tablet/desktop */}
                        <Button size="sm" className="hidden h-8 gap-1 bg-blue-600 px-2.5 text-white hover:bg-blue-700 sm:inline-flex"
                          title="View Case" onClick={() => { setSelected(c); setDialogMode('view'); }}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                        <Button size="sm" className="hidden h-8 gap-1 bg-orange-500 px-2.5 text-white hover:bg-orange-600 sm:inline-flex"
                          title="Edit Case" onClick={() => { setSelected(c); setDialogMode('edit'); }}>
                          <Edit2 className="h-3.5 w-3.5" /> Edit
                        </Button>

                        {/* Secondary actions — labeled menu (also holds View/Edit on mobile) */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5" title="More actions">
                              <span className="sm:hidden">Actions</span>
                              <span className="hidden sm:inline">More</span>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>{c.case_number}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {/* View & Edit appear in the menu only on mobile */}
                            <DropdownMenuItem className="sm:hidden text-blue-700"
                              onClick={() => { setSelected(c); setDialogMode('view'); }}>
                              <Eye className="text-blue-600" /> View Case
                            </DropdownMenuItem>
                            <DropdownMenuItem className="sm:hidden text-orange-700"
                              onClick={() => { setSelected(c); setDialogMode('edit'); }}>
                              <Edit2 className="text-orange-500" /> Edit Case
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="sm:hidden" />
                            <DropdownMenuItem className="text-purple-700" disabled={!c.case_number}
                              onClick={() => { setCaseDetailsNumber(c.case_number); setCaseDetailsId(c.id); setCaseDetailsTab('overview'); setCaseDetailsOpen(true); }}>
                              <Scale className="text-purple-600" /> Case Details
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-green-700" disabled={!c.case_number}
                              onClick={() => fetchCaseDetails(c)}>
                              <RefreshCw className="text-green-600" /> Sync Case
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-indigo-700"
                              onClick={() => setTaskCase(c)}>
                              <ListPlus className="text-indigo-600" /> Create Task
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-teal-700"
                              onClick={() => { setAssignTarget(c); setAssignAdvocateId(''); }}>
                              <UserPlus className="text-teal-600" /> Assign Advocate
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-amber-800" disabled={!c.case_number}
                              onClick={() => { setCaseDetailsNumber(c.case_number); setCaseDetailsId(c.id); setCaseDetailsTab('connected'); setCaseDetailsOpen(true); }}>
                              <Link2 className="text-amber-700" /> Connected Cases
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-slate-700" disabled={!c.case_number}
                              onClick={() => { setCaseDetailsNumber(c.case_number); setCaseDetailsId(c.id); setCaseDetailsTab('notes'); setCaseDetailsOpen(true); }}>
                              <StickyNote className="text-slate-500" /> Notes
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 focus:text-red-700"
                              onClick={() => setDeactivateTarget(c)}>
                              <PowerOff className="text-red-500" /> Deactivate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogMode === 'add' || dialogMode === 'edit'} onOpenChange={() => setDialogMode(null)}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{dialogMode === 'add' ? 'Add New Case' : `Edit — ${selected?.case_number}`}</DialogTitle>
            <DialogDescription>{dialogMode === 'add' ? 'Complete the case profile below.' : 'Update the case record.'}</DialogDescription>
          </DialogHeader>
          <CaseForm
            initial={dialogMode === 'edit' && selected ? { ...selected } as FormData : EMPTY_FORM}
            advocates={advocates}
            onSave={handleSave}
            onCancel={() => setDialogMode(null)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === 'view'} onOpenChange={() => setDialogMode(null)}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {selected.case_number}
                  <CaseStatusBadge status={selected.case_status} />
                  <SensitivityBadge sensitivity={selected.sensitivity} />
                  <FollowUpBadge status={selected.follow_up_status} />
                </DialogTitle>
                {selected.cnr_number && <DialogDescription className="font-mono">{selected.cnr_number}</DialogDescription>}
              </DialogHeader>
              <div className="space-y-6 mt-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mb-3">Status</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Court Status</p>
                      <div><CaseStatusBadge status={selected.case_status} /></div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Advocate Status</p>
                      <div><AdvocateStatusBadge status={selected.advocate_status} /></div>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mb-3">Parties</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailRow label="Petitioner" value={selected.petitioner} />
                    <DetailRow label="Respondent" value={selected.respondent} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mb-3">Court Information</p>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <DetailRow label="Court" value={selected.court_name} />
                    <DetailRow label="District" value={selected.district} />
                    <DetailRow label="Section" value={selected.section} />
                    <DetailRow label="CLA Party Status" value={selected.cla_party_status} />
                    <DetailRow label="Nature of Disposal" value={selected.nature_of_disposal} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mb-3">Case Details</p>
                  <div className="space-y-4">
                    <DetailRow label="Subject Matter / Connected Cases" value={selected.subject_matter} />
                    <DetailRow label="Prayer" value={selected.prayer} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mb-3">Hearing Information</p>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <DetailRow label="Last Hearing Date" value={fmtDate(selected.last_hearing_date)} />
                    <DetailRow label="Next Hearing Date" value={fmtDate(selected.next_hearing_date)} />
                  </div>
                  <DetailRow label="Last Hearing Update" value={selected.last_hearing_update} />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setDialogMode(null)}>Close</Button>
                <Button onClick={() => setDialogMode('edit')}>Edit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate Case</DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate <strong>{deactivateTarget?.case_number}</strong>?
              The case will be marked inactive and follow-up status set to "Inactive".
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeactivate}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MHC Order Details Modal ── */}
      <Dialog open={orderModalOpen} onOpenChange={open => {
        setOrderModalOpen(open);
        if (!open) { setOrderRecord(null); setOrderDetails(null); setOrderError(null); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Case Details
              {orderRecord?.case_number && (
                <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">
                  — {orderRecord.case_number}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {orderLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching case details…
            </div>
          )}

          {!orderLoading && orderError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {orderError}
            </div>
          )}

          {!orderLoading && !orderError && orderDetails && (() => {
            const pdfUrl = orderDetails.pdfUrl;
            const fmtJudgmentDate = orderDetails.judgmentDate
              ? fmtDate(orderDetails.judgmentDate.replace(/\//g, '-'))
              : '—';
            return (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Case Information
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Case Number</dt>
                      <dd className="font-mono font-medium">{orderDetails.caseNumber}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Case Type</dt>
                      <dd className="font-medium">{orderDetails.caseType || '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Petitioner</dt>
                      <dd className="font-medium">{orderDetails.petitioner || '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Respondent</dt>
                      <dd className="font-medium">{orderDetails.respondent || '—'}</dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Judge Information
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Judge</dt>
                      <dd className="font-medium">{orderDetails.judge || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Judgment Date</dt>
                      <dd className="font-medium">{fmtJudgmentDate}</dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Order Information
                  </h3>
                  {pdfUrl ? (
                    <p className="text-sm text-muted-foreground">Order PDF is available for this case.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No judgment/order PDF available for this case.</p>
                  )}
                </section>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!pdfUrl}
                    onClick={() => pdfUrl && window.open(pdfUrl, '_blank')}
                    className="gap-1.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View Order
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pdfUrl}
                    onClick={() => {
                      if (!pdfUrl) return;
                      const link = document.createElement('a');
                      link.href = pdfUrl;
                      link.download = `${orderDetails.caseNumber}.pdf`;
                      link.click();
                    }}
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Order
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Assign Advocate Dialog ── */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) { setAssignTarget(null); setAssignAdvocateId(''); } }}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Advocate</DialogTitle>
            <DialogDescription>{assignTarget?.case_number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Advocate</Label>
            <Select value={assignAdvocateId} onValueChange={setAssignAdvocateId}>
              <SelectTrigger><SelectValue placeholder="Select advocate" /></SelectTrigger>
              <SelectContent>
                {advocates.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No advocates found. Add them to the advocate master.</div>
                ) : advocates.map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.advocate_name}{a.mobile ? ` · ${a.mobile}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignTarget(null); setAssignAdvocateId(''); }} disabled={assigning}>Cancel</Button>
            <Button onClick={saveAssignment} disabled={assigning || !assignAdvocateId} className="gap-1">
              {assigning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── eCourts Case Details Modal ── */}
      <CaseDetailsModal
        caseNumber={caseDetailsNumber}
        caseId={caseDetailsId}
        open={caseDetailsOpen}
        onOpenChange={(o) => { setCaseDetailsOpen(o); if (!o) { setCaseDetailsTab('overview'); loadConnCounts(); } }}
        allowSync
        initialTab={caseDetailsTab}
        onSynced={load}
      />

      {/* ── Create Task Dialog ── */}
      {taskCase && (
        <TaskFormDialog
          open={!!taskCase}
          onOpenChange={(o) => { if (!o) setTaskCase(null); }}
          caseId={taskCase.id}
          caseNumber={taskCase.case_number}
          initialHearingDate={taskCase.next_hearing_date}
          onSaved={loadTaskCounts}
        />
      )}
    </div>
  );
}
