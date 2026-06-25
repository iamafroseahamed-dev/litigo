/**
 * Administration.tsx — Enterprise User Management module.
 *
 * Replaces the old "Notification Recipients" settings page. Notifications are now
 * driven from each user's profile preferences. Visibility of tabs and actions is
 * permission-gated (see lib/roles.ts); the real boundary is RLS (migration 017).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { fetchOrganizations } from '@/lib/organizations';
import {
  fetchUsers, createUser, updateUser, setUserActive, deleteUser,
  fetchAdvocates, type AppUser, type UserInput, type AdvocateSummary,
} from '@/lib/userManagement';
import {
  ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_BADGE_VARIANT, normalizeRole, assignableRoles,
  canManageUsers, canDeleteUsers, canChangeOrganization, canViewPlatformTools,
  canAccessUserManagement, isPlatformAdmin,
} from '@/lib/roles';
import type { Organization, Role } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Users, Scale, Building2, Search, Plus, Edit2, Trash2, ShieldCheck, CreditCard,
  BarChart3, Mail, Loader2, ShieldAlert, ArrowRight,
} from 'lucide-react';

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_BADGE_VARIANT[role]}>{ROLE_LABELS[role]}</Badge>;
}

function orgName(orgId: string | null | undefined, orgs: Organization[]): string {
  if (!orgId) return 'Unassigned';
  const o = orgs.find(x => x.id === orgId);
  return o?.short_name || o?.organization_name || 'Unknown';
}

const NOTIFICATION_FIELDS: { key: keyof UserInput; label: string; hint: string }[] = [
  { key: 'notify_hearing_reminder', label: 'Hearing Reminder', hint: 'Alerts before scheduled hearings' },
  { key: 'notify_task_assignment', label: 'Task Assignment', hint: 'When a task is assigned to this user' },
  { key: 'notify_daily_cause_list', label: 'Daily Cause List', hint: 'Daily digest of matched listings' },
  { key: 'notify_case_assignment', label: 'Case Assignment', hint: 'When a case is assigned to this user' },
];

const EMPTY_USER: UserInput = {
  full_name: '', email: '', role: 'viewer', organization_id: null, active: true,
  email_notifications: true, notify_hearing_reminder: true, notify_task_assignment: true,
  notify_daily_cause_list: true, notify_case_assignment: true,
};

// ── User form dialog ──────────────────────────────────────────────────────────

function UserFormDialog({
  open, mode, initial, actorRole, defaultOrgId, organizations, onClose, onSaved,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  initial: AppUser | null;
  actorRole: Role;
  defaultOrgId: string | null;
  organizations: Organization[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UserInput>(EMPTY_USER);
  const [saving, setSaving] = useState(false);

  const roleOptions = useMemo(() => {
    const allowed = assignableRoles(actorRole);
    // Keep the existing role visible even if the actor couldn't normally assign it.
    if (mode === 'edit' && initial && !allowed.includes(normalizeRole(initial.role))) {
      return [normalizeRole(initial.role), ...allowed];
    }
    return allowed;
  }, [actorRole, mode, initial]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      setForm({
        full_name: initial.full_name ?? '',
        email: initial.email ?? '',
        role: normalizeRole(initial.role),
        organization_id: initial.organization_id,
        active: initial.active,
        email_notifications: initial.email_notifications ?? true,
        notify_hearing_reminder: initial.notify_hearing_reminder ?? true,
        notify_task_assignment: initial.notify_task_assignment ?? true,
        notify_daily_cause_list: initial.notify_daily_cause_list ?? true,
        notify_case_assignment: initial.notify_case_assignment ?? true,
      });
    } else {
      setForm({ ...EMPTY_USER, role: roleOptions[0] ?? 'viewer', organization_id: defaultOrgId });
    }
  }, [open, mode, initial, defaultOrgId, roleOptions]);

  const canEditOrg = canChangeOrganization(actorRole);
  const set = <K extends keyof UserInput>(key: K, value: UserInput[K]) =>
    setForm(p => ({ ...p, [key]: value }));

  async function handleSave() {
    if (!form.full_name.trim()) { toast.error('Name is required.'); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('A valid email is required.'); return;
    }
    if (!form.organization_id && !isPlatformAdmin(actorRole)) {
      toast.error('No organization is associated with your account.'); return;
    }
    setSaving(true);
    try {
      if (mode === 'add') {
        await createUser(form);
        toast.success('User created.');
      } else if (initial) {
        await updateUser(initial.id, form);
        toast.success('User updated.');
      }
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes('duplicate') ? 'A user with this email already exists.'
        : msg.includes('row-level') ? 'Permission denied for this organization.'
        : `Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-lg">
        <div className="shrink-0 border-b border-border/70 px-6 py-4">
          <DialogHeader>
            <DialogTitle>{mode === 'add' ? 'Invite User' : 'Edit User'}</DialogTitle>
            <DialogDescription>
              {mode === 'add'
                ? 'Add a member to the organization and set their access and notifications.'
                : 'Update access level, status and notification preferences.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Priya Raman" />
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@department.gov.in" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => set('role', v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">{ROLE_DESCRIPTIONS[normalizeRole(form.role)]}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Organization {!canEditOrg && <span className="text-[11px] font-normal text-muted-foreground">(read-only)</span>}</Label>
              {canEditOrg ? (
                <Select value={form.organization_id ?? ''} onValueChange={v => set('organization_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                  <SelectContent>
                    {organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.organization_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  {orgName(form.organization_id, organizations)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3.5 py-3">
            <div>
              <Label className="cursor-default">Active</Label>
              <p className="text-[11px] text-muted-foreground">Inactive users cannot sign in.</p>
            </div>
            <Switch checked={form.active} onCheckedChange={v => set('active', v)} />
          </div>

          <div className="rounded-lg border border-border/70 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Notification Preferences</p>
                <p className="text-[11px] text-muted-foreground">Master switch for all email notifications.</p>
              </div>
              <Switch checked={form.email_notifications} onCheckedChange={v => set('email_notifications', v)} />
            </div>
            <div className="space-y-2.5">
              {NOTIFICATION_FIELDS.map(f => (
                <div key={f.key} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                  </div>
                  <Switch
                    checked={Boolean(form[f.key]) && form.email_notifications}
                    disabled={!form.email_notifications}
                    onCheckedChange={v => set(f.key, v as never)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border/70 px-6 py-4">
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{mode === 'add' ? 'Create User' : 'Save Changes'}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ actorRole, orgId, organizations }: { actorRole: Role; orgId: string | null; organizations: Organization[] }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [orgFilter, setOrgFilter] = useState('__all__');
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; user: AppUser | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isPlatform = isPlatformAdmin(actorRole);
  const canEdit = canManageUsers(actorRole);
  const canRemove = canDeleteUsers(actorRole);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsers(actorRole, orgId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [actorRole, orgId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (q && !(`${u.full_name} ${u.email}`.toLowerCase().includes(q))) return false;
      if (roleFilter !== '__all__' && normalizeRole(u.role) !== roleFilter) return false;
      if (statusFilter !== '__all__' && String(u.active) !== statusFilter) return false;
      if (isPlatform && orgFilter !== '__all__' && u.organization_id !== orgFilter) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter, orgFilter, isPlatform]);

  async function toggleActive(u: AppUser) {
    try {
      await setUserActive(u.id, !u.active);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: !u.active } : x));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteUser(deleteTarget.id);
      toast.success('User removed.');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  const hasFilters = search || roleFilter !== '__all__' || statusFilter !== '__all__' || orgFilter !== '__all__';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-white p-3 shadow-card lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-10 w-auto min-w-[8rem] gap-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Roles</SelectItem>
              {assignableRoles('platform_admin').map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-auto min-w-[7.5rem] gap-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Status</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {isPlatform && (
            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="h-10 w-auto min-w-[9rem] gap-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Organizations</SelectItem>
                {organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.organization_name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-10" onClick={() => { setSearch(''); setRoleFilter('__all__'); setStatusFilter('__all__'); setOrgFilter('__all__'); }}>
              Clear
            </Button>
          )}
        </div>
        {canEdit && (
          <Button className="h-10 gap-1.5" onClick={() => setDialog({ mode: 'add', user: null })}>
            <Plus className="h-4 w-4" /> Invite User
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={hasFilters ? 'No matching users' : 'No users yet'}
              description={hasFilters ? 'Try adjusting your search or filters.' : 'Invite your first team member to get started.'}
              action={canEdit && !hasFilters ? <Button className="gap-1.5" onClick={() => setDialog({ mode: 'add', user: null })}><Plus className="h-4 w-4" /> Invite User</Button> : undefined}
              className="m-4"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    {isPlatform && <TableHead>Organization</TableHead>}
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-center">Email Notifs</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(u => (
                    <TableRow key={u.id} className={u.active ? undefined : 'opacity-60'}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
                            {initials(u.full_name || u.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{u.full_name || '—'}</p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={normalizeRole(u.role)} /></TableCell>
                      {isPlatform && (
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" /> {orgName(u.organization_id, organizations)}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => canEdit && toggleActive(u)}
                          disabled={!canEdit}
                          className={canEdit ? 'cursor-pointer' : 'cursor-default'}
                          title={canEdit ? (u.active ? 'Click to deactivate' : 'Click to activate') : undefined}
                        >
                          {u.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                        </button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(u.last_login_at)}</TableCell>
                      <TableCell className="text-center">
                        {u.email_notifications
                          ? <Mail className="mx-auto h-4 w-4 text-emerald-500" />
                          : <Mail className="mx-auto h-4 w-4 text-muted-foreground/40" />}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button size="icon-sm" variant="ghost" onClick={() => setDialog({ mode: 'edit', user: u })} title="Edit">
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {canRemove && (
                              <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(u)} title="Remove">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <UserFormDialog
          open
          mode={dialog.mode}
          initial={dialog.user}
          actorRole={actorRole}
          defaultOrgId={orgId}
          organizations={organizations}
          onClose={() => setDialog(null)}
          onSaved={load}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove User</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong> from this organization? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" loading={deleting} onClick={confirmDelete}>Remove User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Advocates tab ─────────────────────────────────────────────────────────────

function AdvocatesTab({ actorRole, orgId }: { actorRole: Role; orgId: string | null }) {
  const [advocates, setAdvocates] = useState<AdvocateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAdvocates(actorRole, orgId)
      .then(rows => { if (active) setAdvocates(rows); })
      .catch(e => { if (active) { toast.error(e instanceof Error ? e.message : 'Failed to load advocates.'); setAdvocates([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorRole, orgId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? advocates.filter(a => a.name.toLowerCase().includes(q)) : advocates;
  }, [advocates, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search advocates…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading advocates…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Scale}
              title={search ? 'No matching advocates' : 'No advocates assigned'}
              description={search ? 'Try a different search term.' : 'Advocates appear here once cases are assigned to them.'}
              className="m-4"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Advocate</TableHead>
                    <TableHead className="text-center">Assigned</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="text-center">Disposed</TableHead>
                    <TableHead className="text-center">Upcoming Hearings</TableHead>
                    <TableHead>Last Assigned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(a => (
                    <TableRow key={a.name}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white">
                            {initials(a.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{a.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{a.email || a.mobile || 'No contact on file'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{a.assignedCases}</TableCell>
                      <TableCell className="text-center tabular-nums text-blue-600">{a.activeCases}</TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{a.disposedCases}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {a.upcomingHearings > 0
                          ? <Badge variant="info">{a.upcomingHearings}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{a.lastAssignedOn ? fmtDate(a.lastAssignedOn) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Organization settings tab ─────────────────────────────────────────────────

function OrgSettingsTab({ org }: { org: Organization | null }) {
  if (!org) {
    return <EmptyState icon={Building2} title="No organization" description="Your account is not linked to an organization yet." />;
  }
  const rows: { label: string; value: string }[] = [
    { label: 'Organization Name', value: org.organization_name },
    { label: 'Short Name', value: org.short_name || '—' },
    { label: 'Contact Person', value: org.contact_person || '—' },
    { label: 'Contact Email', value: org.contact_email || org.email || '—' },
    { label: 'Contact Mobile', value: org.contact_mobile || org.mobile || '—' },
    { label: 'Subscription Plan', value: org.plan_name || 'Trial' },
    { label: 'Available Credits', value: String(org.available_credits ?? 0) },
    { label: 'Status', value: org.active === false ? 'Inactive' : 'Active' },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Organization Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {rows.map(r => (
            <div key={r.label} className="space-y-1">
              <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{r.label}</dt>
              <dd className="text-[0.9375rem] font-semibold text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Platform tools (platform admin only) ──────────────────────────────────────

function PlatformLinkCard({ icon: Icon, title, description }: { icon: typeof Building2; title: string; description: string }) {
  return (
    <Link to="/organizations" className="group block">
      <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
        <CardContent className="flex items-start gap-3 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="flex items-center gap-1 font-semibold text-foreground">
              {title}
              <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PlatformTab() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <PlatformLinkCard icon={Building2} title="Organizations" description="Create, edit and manage every organization on the platform." />
      <PlatformLinkCard icon={CreditCard} title="Billing & Plans" description="Manage subscriptions and plan assignments across organizations." />
      <PlatformLinkCard icon={ShieldCheck} title="Credits" description="Allocate and top up API credits for each organization." />
      <PlatformLinkCard icon={BarChart3} title="Platform Analytics" description="Usage, spend and adoption metrics across all tenants." />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Administration() {
  const { user } = useAuth();
  const { org } = useOrg();
  const actorRole = normalizeRole(user?.profile?.role);
  const orgId = user?.profile?.organization_id ?? org?.id ?? null;
  const isPlatform = canViewPlatformTools(actorRole);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tab, setTab] = useState('users');

  useEffect(() => {
    fetchOrganizations().then(setOrganizations).catch(() => setOrganizations([]));
  }, []);

  if (!canAccessUserManagement(actorRole)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ShieldAlert}
          title="Access restricted"
          description="You don't have permission to access Administration. Contact your organization's Super Admin."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="eyebrow text-primary">Administration</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">User Management</h1>
          <Badge variant={ROLE_BADGE_VARIANT[actorRole]} className="gap-1">
            <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[actorRole]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage users, roles, advocates and notification preferences for your organization.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
          <TabsTrigger value="advocates" className="gap-1.5"><Scale className="h-3.5 w-3.5" /> Advocates</TabsTrigger>
          <TabsTrigger value="organization" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Organization</TabsTrigger>
          {isPlatform && <TabsTrigger value="platform" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Platform</TabsTrigger>}
        </TabsList>

        <TabsContent value="users" className="mt-5">
          <UsersTab actorRole={actorRole} orgId={orgId} organizations={organizations} />
        </TabsContent>
        <TabsContent value="advocates" className="mt-5">
          <AdvocatesTab actorRole={actorRole} orgId={orgId} />
        </TabsContent>
        <TabsContent value="organization" className="mt-5">
          <OrgSettingsTab org={org} />
        </TabsContent>
        {isPlatform && (
          <TabsContent value="platform" className="mt-5">
            <PlatformTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
