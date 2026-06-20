import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
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
import { toast } from 'sonner';
import { Plus, Search, Edit2, Eye, Filter, X, PowerOff, RefreshCw, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Case } from '@/types';

const COURTS = [
  'Supreme Court of India', 'High Court', 'District Court', 'Sessions Court',
  'Civil Court', 'Family Court', 'Magistrate Court', 'Tribunal', 'Consumer Forum', 'Labour Court',
];
const CLA_PARTY_STATUSES = ['Petitioner', 'Respondent', 'Appellant', 'Defendant', 'Complainant', 'Accused'];
const SENSITIVITIES = ['Sensitive', 'Non-Sensitive'];
const CASE_STATUSES = ['Active', 'Pending', 'Disposed'];
const FOLLOW_UP_STATUSES = ['Urgent', 'Update Required', 'No Action'];

type FormData = Omit<Case, 'id' | 'organization_id' | 'created_at' | 'updated_at' | 'source_file' | 'source_sheet' | 'import_batch' | 'case_section' | 'followup_status' | 'ecourts_case_no' | 'cnr_discovered_at'>;

const EMPTY_FORM: FormData = {
  cnr_number: null, case_number: '', court_name: null, district: null, section: null,
  petitioner: null, respondent: null, prayer: null, subject_matter: null,
  cla_party_status: null, sensitivity: null, case_status: null, nature_of_disposal: null,
  last_hearing_date: null, last_hearing_update: null, next_hearing_date: null,
  advocate_name: null, advocate_mobile: null, advocate_email: null,
  client_name: null, client_mobile: null, client_whatsapp: null, client_email: null,
  follow_up_status: null, active: true,
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

function CaseForm({ initial, onSave, onCancel, saving }: {
  initial: FormData; onSave: (d: FormData) => void; onCancel: () => void; saving: boolean;
}) {
  const [form, setForm] = useState<FormData>(initial);

  const txt = (f: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value || null }));
  const sel = (f: keyof FormData) => (v: string) =>
    setForm(p => ({ ...p, [f]: v === '__none__' ? null : v }));

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

      <div className="flex items-center gap-3 border-t pt-3">
        <Switch checked={form.active} onCheckedChange={v => setForm(p => ({ ...p, active: v }))} id="active-sw" />
        <Label htmlFor="active-sw">Active Case</Label>
      </div>

      <DialogFooter className="pt-2 sticky bottom-0 bg-background pb-1">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.case_number || saving}>
          {saving ? 'Saving…' : 'Save Case'}
        </Button>
      </DialogFooter>
    </div>
  );
}


export default function CasesPage() {
  const { user } = useAuth();
  const orgId = user?.profile?.organization_id;
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

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('cases')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setCases(data ?? []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

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

  const handleSave = async (data: FormData) => {
    setSaving(true);
    const now = new Date().toISOString();
    try {
      if (dialogMode === 'add') {
        const { error: err } = await supabase.from('cases').insert({
          ...data,
          organization_id: orgId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (err) throw err;
        toast.success('Case added successfully');
      } else if (dialogMode === 'edit' && selected) {
        const { error: err } = await supabase.from('cases')
          .update({ ...data, updated_at: now })
          .eq('id', selected.id);
        if (err) throw err;
        toast.success('Case updated successfully');
      }
      setDialogMode(null);
      await load();
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
            <Table className="min-w-[1100px]">
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
                  <TableHead className="w-28">Next Hearing</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
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
                    <TableCell className="text-xs">{fmtDate(c.next_hearing_date)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="View"
                          onClick={() => { setSelected(c); setDialogMode('view'); }}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit"
                          onClick={() => { setSelected(c); setDialogMode('edit'); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700" title="Deactivate"
                          onClick={() => setDeactivateTarget(c)}>
                          <PowerOff className="w-3.5 h-3.5" />
                        </Button>
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
    </div>
  );
}
