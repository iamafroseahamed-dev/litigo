import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Scale, Mail, Info, Plus, Edit2, Trash2, Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

interface Recipient {
  id: string;
  name: string;
  email: string | null;
  mobile_number: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  active: boolean;
  created_at: string;
}

const EMPTY: Omit<Recipient, 'id' | 'created_at'> = {
  name: '', email: null, mobile_number: null,
  notify_email: true, notify_sms: false, active: true,
};

export default function Settings() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading]       = useState(true);
  const [dialog, setDialog]         = useState<'add' | 'edit' | null>(null);
  const [selected, setSelected]     = useState<Recipient | null>(null);
  const [form, setForm]             = useState(EMPTY);
  const [saving, setSaving]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Recipient | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('system_notification_recipients')
      .select('id,name,email,mobile_number,notify_email,notify_sms,active,created_at')
      .order('created_at', { ascending: true });
    if (error) toast.error(error.message);
    setRecipients((data ?? []) as Recipient[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(EMPTY);
    setSelected(null);
    setDialog('add');
  }

  function openEdit(r: Recipient) {
    setForm({
      name: r.name,
      email: r.email,
      mobile_number: r.mobile_number,
      notify_email: r.notify_email,
      notify_sms: r.notify_sms,
      active: r.active,
    });
    setSelected(r);
    setDialog('edit');
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        name:          form.name.trim(),
        email:         form.email?.trim() || null,
        mobile_number: form.mobile_number?.trim() || null,
        notify_email:  form.notify_email,
        notify_sms:    form.notify_sms,
        active:        form.active,
        updated_at:    new Date().toISOString(),
      };
      if (dialog === 'add') {
        const { error } = await supabase.from('system_notification_recipients').insert(payload);
        if (error) throw error;
        toast.success('Recipient added.');
      } else if (selected) {
        const { error } = await supabase
          .from('system_notification_recipients')
          .update(payload)
          .eq('id', selected.id);
        if (error) throw error;
        toast.success('Recipient updated.');
      }
      setDialog(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('system_notification_recipients')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Recipient removed.');
    setDeleteTarget(null);
    await load();
  }

  async function toggleActive(r: Recipient) {
    const { error } = await supabase
      .from('system_notification_recipients')
      .update({ active: !r.active, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  const field = (f: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value || null }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage notification recipients for case listing alerts.
        </p>
      </div>

      {/* ── Notification Recipients ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notification Recipients
          </CardTitle>
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" /> Add Recipient
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            These recipients automatically receive Email / SMS notifications
            whenever a tracked case appears in the daily cause list.
          </p>

          {loading && <p className="text-sm text-muted-foreground py-2">Loading…</p>}

          {!loading && recipients.length === 0 && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No notification recipients configured.<br />
              Add recipients to enable automatic alerts.
            </div>
          )}

          {!loading && recipients.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead className="text-center">Channels</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map(r => (
                    <TableRow key={r.id} className={r.active ? undefined : 'opacity-50'}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.email ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.mobile_number ?? '—'}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center gap-1 flex-wrap">
                          {r.notify_email && r.email         && <Badge variant="outline" className="text-[10px] px-1">Email</Badge>}
                          {r.notify_sms   && r.mobile_number && <Badge variant="outline" className="text-[10px] px-1">SMS</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => toggleActive(r)}
                          className="cursor-pointer"
                          title={r.active ? 'Click to disable' : 'Click to enable'}
                        >
                          {r.active
                            ? <Badge variant="success">Active</Badge>
                            : <Badge variant="secondary">Inactive</Badge>}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(r)}>
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
        </CardContent>
      </Card>

      {/* ── About ─────────────────────────────────────────────────────────── */}
      <Card className="border-blue-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-blue-600" />
            About Litigo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
              <Scale className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight">Litigo</p>
              <p className="text-xs text-muted-foreground">Legal Case Management &amp; Court Intelligence Platform</p>
            </div>
            <Badge variant="outline" className="ml-auto text-xs">v1.0</Badge>
          </div>
          <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
            <div className="grid grid-cols-[140px_1fr] gap-y-2">
              <span className="text-muted-foreground font-medium">Version</span><span>1.0</span>
              <span className="text-muted-foreground font-medium">Developed by</span><span>Afrose Ahamed</span>
              <span className="text-muted-foreground font-medium">Contact</span>
              <a href="mailto:iamafroseahamed@gmail.com"
                className="flex items-center gap-1.5 text-blue-600 hover:underline">
                <Mail className="h-3.5 w-3.5" />
                iamafroseahamed@gmail.com
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!dialog} onOpenChange={v => !v && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === 'add' ? 'Add Notification Recipient' : 'Edit Recipient'}</DialogTitle>
            <DialogDescription>
              This person will receive automatic notifications for every new matched listing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Legal Head"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email ?? ''} onChange={field('email')} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Mobile (for SMS)</Label>
              <Input value={form.mobile_number ?? ''} onChange={field('mobile_number')} placeholder="+91 9XXXXXXXX" />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notification Channels</p>
              <div className="flex items-center justify-between">
                <Label>Email</Label>
                <Switch checked={form.notify_email}
                  onCheckedChange={v => setForm(p => ({ ...p, notify_email: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label>SMS</Label>
                <Switch checked={form.notify_sms}
                  onCheckedChange={v => setForm(p => ({ ...p, notify_sms: v }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>Active</Label>
              <Switch checked={form.active} onCheckedChange={v => setForm(p => ({ ...p, active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Recipient</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteTarget?.name}</strong> from automatic notifications?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={remove}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
