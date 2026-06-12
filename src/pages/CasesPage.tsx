import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchCases, createCase, updateCase, deleteCase } from '@/services/mockCaseService';
import type { Case } from '@/types';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Search, Edit2, PowerOff, Eye, Filter, X } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const COURTS = ['Madras High Court', 'City Civil Court Chennai', 'Family Court Chennai'];
const BENCHES = ['Chennai', 'Madurai', 'Principal', 'I Additional'];

const EMPTY_FORM: Omit<Case, 'id' | 'organization_id' | 'created_at' | 'updated_at'> = {
  cnr_number: '', case_number: '', court_name: '', bench: '', petitioner: '',
  respondent: '', advocate_name: '', advocate_mobile: '', advocate_email: '',
  client_name: '', client_mobile: '', client_whatsapp: '', client_email: '', active: true,
};

function CaseForm({
  initial, onSave, onCancel, saving,
}: {
  initial: typeof EMPTY_FORM;
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cnr">CNR Number</Label>
          <Input id="cnr" placeholder="TNHC0010002024" value={form.cnr_number} onChange={set('cnr_number')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case_no">Case Number <span className="text-red-500">*</span></Label>
          <Input id="case_no" placeholder="WP/1234/2024" value={form.case_number} onChange={set('case_number')} required />
        </div>
        <div className="space-y-1.5">
          <Label>Court Name</Label>
          <Select value={form.court_name} onValueChange={v => setForm(p => ({ ...p, court_name: v }))}>
            <SelectTrigger><SelectValue placeholder="Select court" /></SelectTrigger>
            <SelectContent>{COURTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Bench</Label>
          <Select value={form.bench} onValueChange={v => setForm(p => ({ ...p, bench: v }))}>
            <SelectTrigger><SelectValue placeholder="Select bench" /></SelectTrigger>
            <SelectContent>{BENCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="petitioner">Petitioner</Label>
          <Input id="petitioner" value={form.petitioner} onChange={set('petitioner')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="respondent">Respondent</Label>
          <Input id="respondent" value={form.respondent} onChange={set('respondent')} />
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Advocate Details</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.advocate_name} onChange={set('advocate_name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Mobile</Label>
            <Input value={form.advocate_mobile} onChange={set('advocate_mobile')} placeholder="9XXXXXXXXX" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.advocate_email} onChange={set('advocate_email')} />
          </div>
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Client Details</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Client Name</Label>
            <Input value={form.client_name} onChange={set('client_name')} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.client_email} onChange={set('client_email')} />
          </div>
          <div className="space-y-1.5">
            <Label>Mobile</Label>
            <Input value={form.client_mobile} onChange={set('client_mobile')} placeholder="9XXXXXXXXX" />
          </div>
          <div className="space-y-1.5">
            <Label>WhatsApp</Label>
            <Input value={form.client_whatsapp} onChange={set('client_whatsapp')} placeholder="9XXXXXXXXX" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t pt-3">
        <Switch
          checked={form.active}
          onCheckedChange={v => setForm(p => ({ ...p, active: v }))}
          id="active-switch"
        />
        <Label htmlFor="active-switch">Active Case</Label>
      </div>
      <DialogFooter className="pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(form)} loading={saving} disabled={!form.case_number}>Save Case</Button>
      </DialogFooter>
    </div>
  );
}

export default function CasesPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterBench, setFilterBench] = useState('');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | 'view' | null>(null);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Case | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try { setCases(await fetchCases(user.organization.id)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = cases.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.case_number.toLowerCase().includes(q) ||
      c.cnr_number.toLowerCase().includes(q) || c.client_name.toLowerCase().includes(q) ||
      c.advocate_name.toLowerCase().includes(q) || c.petitioner.toLowerCase().includes(q);
    const matchCourt = !filterCourt || c.court_name === filterCourt;
    const matchBench = !filterBench || c.bench === filterBench;
    const matchActive = filterActive === 'all' ? true : filterActive === 'active' ? c.active : !c.active;
    return matchSearch && matchCourt && matchBench && matchActive;
  });

  const handleSave = async (data: typeof EMPTY_FORM) => {
    if (!user) return;
    setSaving(true);
    try {
      if (dialogMode === 'add') {
        await createCase(user.organization.id, data);
        toast.success('Case created successfully');
      } else if (dialogMode === 'edit' && selectedCase) {
        await updateCase(user.organization.id, selectedCase.id, data);
        toast.success('Case updated successfully');
      }
      setDialogMode(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save case');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!user || !deactivateTarget) return;
    try {
      await deleteCase(user.organization.id, deactivateTarget.id);
      toast.success('Case deactivated');
      setDeactivateTarget(null);
      await load();
    } catch {
      toast.error('Failed to deactivate case');
    }
  };

  const clearFilters = () => { setFilterCourt(''); setFilterBench(''); setFilterActive('all'); setSearch(''); };
  const hasFilters = filterCourt || filterBench || filterActive !== 'all' || search;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by case no, CNR, client, advocate…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => setShowFilters(!showFilters)} className="h-10 w-10">
            <Filter className="w-4 h-4" />
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 text-muted-foreground">
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>
        <Button onClick={() => { setSelectedCase(null); setDialogMode('add'); }} className="h-10 w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-1" /> Add Case
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Court</Label>
              <Select value={filterCourt || 'all'} onValueChange={v => setFilterCourt(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Courts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courts</SelectItem>
                  {COURTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bench</Label>
              <Select value={filterBench || 'all'} onValueChange={v => setFilterBench(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Benches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Benches</SelectItem>
                  {BENCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filterActive} onValueChange={setFilterActive}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Cases
            <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} of {cases.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">No cases found.</p>
            </div>
          ) : (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>CNR</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Advocate</TableHead>
                  <TableHead>Court / Bench</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-semibold">{c.case_number}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.cnr_number || '—'}</TableCell>
                    <TableCell className="text-sm">{c.client_name}</TableCell>
                    <TableCell className="text-sm">{c.advocate_name}</TableCell>
                    <TableCell className="text-xs">
                      <div>{c.court_name}</div>
                      <div className="text-muted-foreground">{c.bench}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.active ? 'success' : 'secondary'} className="text-xs">
                        {c.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" title="View" onClick={() => { setSelectedCase(c); setDialogMode('view'); }} className="h-9 w-9">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Edit" onClick={() => { setSelectedCase(c); setDialogMode('edit'); }} className="h-9 w-9">
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        {c.active && (
                          <Button size="icon" variant="ghost" title="Deactivate" onClick={() => setDeactivateTarget(c)} className="h-9 w-9 text-red-500 hover:text-red-700">
                            <PowerOff className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogMode === 'add' || dialogMode === 'edit'} onOpenChange={() => setDialogMode(null)}>
        <DialogContent className="max-h-[90vh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Add New Case' : 'Edit Case'}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'add' ? 'Fill in the case details below' : `Editing: ${selectedCase?.case_number}`}
            </DialogDescription>
          </DialogHeader>
          <CaseForm
            initial={selectedCase ? { ...selectedCase } : EMPTY_FORM}
            onSave={handleSave}
            onCancel={() => setDialogMode(null)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={dialogMode === 'view'} onOpenChange={() => setDialogMode(null)}>
        <DialogContent className="max-h-[90vh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Case Details — {selectedCase?.case_number}</DialogTitle>
          </DialogHeader>
          {selectedCase && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {[
                  ['CNR Number', selectedCase.cnr_number],
                  ['Case Number', selectedCase.case_number],
                  ['Court', selectedCase.court_name],
                  ['Bench', selectedCase.bench],
                  ['Petitioner', selectedCase.petitioner],
                  ['Respondent', selectedCase.respondent],
                  ['Advocate', selectedCase.advocate_name],
                  ['Advocate Mobile', selectedCase.advocate_mobile],
                  ['Advocate Email', selectedCase.advocate_email],
                  ['Client', selectedCase.client_name],
                  ['Client Mobile', selectedCase.client_mobile],
                  ['Client WhatsApp', selectedCase.client_whatsapp],
                  ['Client Email', selectedCase.client_email],
                  ['Status', selectedCase.active ? 'Active' : 'Inactive'],
                  ['Created', formatDate(selectedCase.created_at)],
                  ['Updated', formatDate(selectedCase.updated_at)],
                ].map(([label, value]) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Close</Button>
            <Button onClick={() => setDialogMode('edit')}>Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirm */}
      <Dialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Deactivate Case</DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate case <strong>{deactivateTarget?.case_number}</strong>?
              It will no longer be matched against cause lists.
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
