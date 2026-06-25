/**
 * Administration.tsx — Enterprise Administration console.
 *
 * Central place to manage an organisation: Dashboard, Users, Advocates, Roles &
 * Permissions, Notification Settings, Organization Settings, API Credits, Billing
 * (platform admin) and Audit Logs (future). Visibility of every module and action
 * is permission-gated (see lib/roles.ts); the real boundary is RLS (migrations
 * 017 & 018). The console uses a left sub-navigation, like a modern admin portal.
 */
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import {
  fetchOrganizations, fetchUsageForOrg, fetchPricing, summarizeUsage,
  type OrgUsageSummary,
} from '@/lib/organizations';
import {
  fetchUsers, createUser, updateUser, setUserActive, resetUserPassword,
  fetchAdvocates, updateMyNotificationPreferences, fetchAuditLogs,
  type AppUser, type UserInput, type AdvocateSummary, type NotificationPrefs, type AuditLogEntry,
} from '@/lib/userManagement';
import {
  ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_BADGE_VARIANT, normalizeRole, assignableRoles,
  canManageUsers, canChangeOrganization, canViewPlatformTools,
  canAccessAdministration, canConfigureRoles, canManageOrgSettings,
  canManageCredits, canManageBilling, isPlatformAdmin, type BadgeVariant,
} from '@/lib/roles';
import {
  PERMISSION_CATEGORIES, PERMISSION_LABELS, PERMISSION_DESCRIPTIONS, MATRIX_ROLES,
  fetchPermissionMatrix, savePermissionMatrix, cloneDefaultMatrix,
  type PermissionMatrix, type PermissionCategory, type ManagedRole,
} from '@/lib/permissions';
import type { Organization, Role } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Users, Scale, Building2, Search, Plus, Edit2, ShieldCheck, CreditCard,
  BarChart3, Mail, Loader2, ShieldAlert, ArrowRight, LayoutDashboard, SlidersHorizontal,
  Bell, History, Wallet, Check, X, RefreshCw, TrendingUp, Activity, ChevronRight,
  MoreHorizontal, KeyRound, Ban, UserCheck, Copy, Phone,
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
  full_name: '', email: '', mobile: '', role: 'viewer', organization_id: null, active: true,
  email_notifications: true, notify_hearing_reminder: true, notify_task_assignment: true,
  notify_daily_cause_list: true, notify_case_assignment: true,
};

// ── Credential dialog (one-time temporary password) ───────────────────────────

function CredentialDialog({
  open, title, description, email, password, onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nTemporary password: ${password}`);
      setCopied(true);
      toast.success('Credentials copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-600" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Email</p>
            <p className="break-all font-mono text-sm text-foreground">{email}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Temporary Password</p>
            <p className="break-all font-mono text-sm font-semibold text-foreground">{password}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This password is shown only once. Share it securely and ask the user to change it after first sign-in.</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User form dialog ──────────────────────────────────────────────────────────

function UserFormDialog({
  open, mode, initial, actorRole, defaultOrgId, organizations, onClose, onSaved, onCreated,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  initial: AppUser | null;
  actorRole: Role;
  defaultOrgId: string | null;
  organizations: Organization[];
  onClose: () => void;
  onSaved: () => void;
  onCreated: (info: { email: string; temporaryPassword: string }) => void;
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
        mobile: initial.mobile ?? '',
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
        const result = await createUser(form);
        toast.success('User created.');
        onSaved();
        onClose();
        onCreated({ email: form.email.trim().toLowerCase(), temporaryPassword: result.temporaryPassword });
        return;
      } else if (initial) {
        await updateUser(initial.id, form);
        toast.success('User updated.');
      }
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        /already exists/i.test(msg) ? 'A user with this email already exists.'
          : /permission|not allowed|outside your organization/i.test(msg) ? msg
          : /organization not found/i.test(msg) ? 'The selected organization could not be found.'
          : msg,
      );
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
              <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@department.gov.in" disabled={mode === 'edit'} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Mobile Number <span className="text-[11px] font-normal text-muted-foreground">(optional)</span></Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="+91 98765 43210" />
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
  const [disableTarget, setDisableTarget] = useState<AppUser | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [credential, setCredential] = useState<{ title: string; description: string; email: string; password: string } | null>(null);

  const isPlatform = isPlatformAdmin(actorRole);
  const canEdit = canManageUsers(actorRole);

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
      if (q) {
        const haystack = [
          u.full_name,
          u.email,
          ROLE_LABELS[normalizeRole(u.role)],
          orgName(u.organization_id, organizations),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (roleFilter !== '__all__' && normalizeRole(u.role) !== roleFilter) return false;
      if (statusFilter !== '__all__' && String(u.active) !== statusFilter) return false;
      if (isPlatform && orgFilter !== '__all__' && u.organization_id !== orgFilter) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter, orgFilter, isPlatform, organizations]);

  async function confirmDisable() {
    if (!disableTarget) return;
    setStatusBusy(true);
    try {
      await setUserActive(disableTarget.id, !disableTarget.active);
      const nowActive = !disableTarget.active;
      setUsers(prev => prev.map(x => x.id === disableTarget.id ? { ...x, active: nowActive } : x));
      toast.success(nowActive ? 'User activated.' : 'User disabled.');
      setDisableTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setStatusBusy(false);
    }
  }

  async function activate(u: AppUser) {
    try {
      await setUserActive(u.id, true);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: true } : x));
      toast.success('User activated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    }
  }

  async function confirmReset() {
    if (!resetTarget) return;
    setResetBusy(true);
    try {
      const password = await resetUserPassword(resetTarget.id);
      const email = resetTarget.email;
      setResetTarget(null);
      setCredential({
        title: 'Password Reset',
        description: 'A new temporary password has been generated. Share it securely with the user.',
        email,
        password,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Password reset failed.');
    } finally {
      setResetBusy(false);
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
            <Input className="pl-9" placeholder="Search name, email, role or organization…" value={search} onChange={e => setSearch(e.target.value)} />
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
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
                  <Skeleton className="hidden h-6 w-16 rounded-full md:block" />
                  <Skeleton className="hidden h-4 w-24 lg:block" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              ))}
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
                          <Badge variant="outline" className="gap-1.5 font-normal">
                            <Building2 className="h-3.5 w-3.5" /> {orgName(u.organization_id, organizations)}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        {u.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(u.last_login_at)}</TableCell>
                      <TableCell className="text-center">
                        {u.email_notifications
                          ? <Mail className="mx-auto h-4 w-4 text-emerald-500" />
                          : <Mail className="mx-auto h-4 w-4 text-muted-foreground/40" />}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" title="Actions">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Manage user</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => setDialog({ mode: 'edit', user: u })}>
                                  <Edit2 className="h-4 w-4" /> Edit user
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setResetTarget(u)}>
                                  <KeyRound className="h-4 w-4" /> Reset password
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {u.active ? (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setDisableTarget(u)}
                                  >
                                    <Ban className="h-4 w-4" /> Disable user
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem className="text-emerald-600 focus:text-emerald-600" onSelect={() => activate(u)}>
                                    <UserCheck className="h-4 w-4" /> Activate user
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
          onCreated={info => setCredential({
            title: 'User Created',
            description: 'The user has been created. Share these one-time credentials securely.',
            email: info.email,
            password: info.temporaryPassword,
          })}
        />
      )}

      <Dialog open={!!disableTarget} onOpenChange={v => !v && setDisableTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disable User</DialogTitle>
            <DialogDescription>
              Disable <strong>{disableTarget?.full_name || disableTarget?.email}</strong>? They will be signed out and
              unable to sign in until re-activated. Their data is preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableTarget(null)}>Cancel</Button>
            <Button variant="destructive" loading={statusBusy} onClick={confirmDisable}>Disable User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={v => !v && setResetTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Generate a new temporary password for <strong>{resetTarget?.full_name || resetTarget?.email}</strong>?
              Their current password will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button loading={resetBusy} onClick={confirmReset}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CredentialDialog
        open={!!credential}
        title={credential?.title ?? ''}
        description={credential?.description ?? ''}
        email={credential?.email ?? ''}
        password={credential?.password ?? ''}
        onClose={() => setCredential(null)}
      />
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

// ── Reusable building blocks ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ModuleKey =
  | 'dashboard' | 'users' | 'advocates' | 'roles' | 'notifications'
  | 'organization' | 'credits' | 'billing' | 'audit';

interface ModuleDef {
  key: ModuleKey;
  label: string;
  icon: typeof Users;
  group: 'Organization' | 'Platform';
  visible: (role: Role) => boolean;
}

const ADMIN_MODULES: ModuleDef[] = [
  { key: 'dashboard',     label: 'Dashboard',              icon: LayoutDashboard,   group: 'Organization', visible: canAccessAdministration },
  { key: 'users',         label: 'Users',                  icon: Users,             group: 'Organization', visible: canManageUsers },
  { key: 'advocates',     label: 'Advocates',              icon: Scale,             group: 'Organization', visible: canAccessAdministration },
  { key: 'roles',         label: 'Roles & Permissions',    icon: SlidersHorizontal, group: 'Organization', visible: canConfigureRoles },
  { key: 'notifications', label: 'Notification Settings',  icon: Bell,              group: 'Organization', visible: canAccessAdministration },
  { key: 'organization',  label: 'Organization Settings',  icon: Building2,         group: 'Organization', visible: canManageOrgSettings },
  { key: 'credits',       label: 'API Credits',            icon: Wallet,            group: 'Organization', visible: canAccessAdministration },
  { key: 'audit',         label: 'Audit Logs',             icon: History,           group: 'Organization', visible: canConfigureRoles },
  { key: 'billing',       label: 'Billing',                icon: CreditCard,        group: 'Platform',     visible: canManageBilling },
];

const MODULE_GROUPS: Array<'Organization' | 'Platform'> = ['Organization', 'Platform'];

function StatCard({ icon: Icon, label, value, hint, tone }: {
  icon: typeof Users; label: string; value: string | number; hint?: string; tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5 p-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none tracking-tight text-foreground tabular-nums">{value}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground/80">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function LinkCard({ icon: Icon, title, description, to }: { icon: typeof Users; title: string; description: string; to: string }) {
  return (
    <Link to={to} className="group block">
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

// ── Dashboard module ──────────────────────────────────────────────────────────

function AdminDashboard({ actorRole, orgId, org, organizations, onNavigate }: {
  actorRole: Role; orgId: string | null; org: Organization | null;
  organizations: Organization[]; onNavigate: (key: ModuleKey) => void;
}) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [advocates, setAdvocates] = useState<AdvocateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const isPlatform = canViewPlatformTools(actorRole);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchUsers(actorRole, orgId).catch(() => [] as AppUser[]),
      fetchAdvocates(actorRole, orgId).catch(() => [] as AdvocateSummary[]),
    ]).then(([u, a]) => { if (active) { setUsers(u); setAdvocates(a); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorRole, orgId]);

  const activeUsers = users.filter(u => u.active).length;
  const roleCounts = useMemo(() => {
    const counts = Object.fromEntries(MATRIX_ROLES.map(r => [r, 0])) as Record<ManagedRole, number>;
    for (const u of users) counts[normalizeRole(u.role)] += 1;
    return counts;
  }, [users]);
  const credits = Number(org?.available_credits ?? 0);

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading overview…</div>;
  }

  return (
    <div className="space-y-6">
      <ModuleHeader title="Overview" description={org ? `Administration summary for ${org.organization_name}.` : 'Administration summary.'} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Users" value={users.length} tone="bg-blue-50 text-blue-600" />
        <StatCard icon={Activity} label="Active Users" value={activeUsers} hint={`${users.length - activeUsers} inactive`} tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={Scale} label="Advocates" value={advocates.length} tone="bg-violet-50 text-violet-600" />
        <StatCard icon={Wallet} label="API Credits" value={credits.toLocaleString('en-IN')} hint={org?.plan_name ?? 'Trial'} tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-primary" /> Role Distribution</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {MATRIX_ROLES.map(r => {
              const count = roleCounts[r];
              const pct = users.length ? Math.round((count / users.length) * 100) : 0;
              return (
                <div key={r} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <RoleBadge role={r} />
                    <span className="font-semibold tabular-nums text-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {canManageUsers(actorRole) && <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('users')}><Users className="h-4 w-4" /> Manage Users</Button>}
            {canConfigureRoles(actorRole) && <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('roles')}><SlidersHorizontal className="h-4 w-4" /> Roles & Permissions</Button>}
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('notifications')}><Bell className="h-4 w-4" /> Notification Settings</Button>
            {isPlatform && <Button variant="outline" className="w-full justify-start gap-2" onClick={() => onNavigate('billing')}><CreditCard className="h-4 w-4" /> Billing &amp; Plans</Button>}
          </CardContent>
        </Card>
      </div>

      {isPlatform && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Building2} label="Organizations" value={organizations.length} tone="bg-indigo-50 text-indigo-600" />
          <StatCard icon={BarChart3} label="Active Orgs" value={organizations.filter(o => o.active !== false).length} tone="bg-sky-50 text-sky-600" />
        </div>
      )}
    </div>
  );
}

// ── Roles & Permissions module ────────────────────────────────────────────────

function RolesPermissionsModule({ actorRole, orgId }: { actorRole: Role; orgId: string | null }) {
  const [matrix, setMatrix] = useState<PermissionMatrix>(cloneDefaultMatrix);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const isPlatform = isPlatformAdmin(actorRole);
  const canEdit = canConfigureRoles(actorRole);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPermissionMatrix(orgId)
      .then(m => { if (active) { setMatrix(m); setDirty(false); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orgId]);

  function toggle(role: ManagedRole, cat: PermissionCategory) {
    if (!canEdit || role === 'platform_admin') return;
    setMatrix(prev => ({ ...prev, [role]: { ...prev[role], [cat]: !prev[role][cat] } }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await savePermissionMatrix(actorRole, orgId, matrix);
      toast.success('Permissions saved.');
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save permissions.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading permissions…</div>;
  }

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Roles & Permissions"
        description="Toggle what each role can access. Platform Admin always has full access."
        action={canEdit ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setMatrix(cloneDefaultMatrix()); setDirty(true); }}><RefreshCw className="h-3.5 w-3.5" /> Reset to defaults</Button>
            <Button size="sm" loading={saving} disabled={!dirty} onClick={save} className="gap-1.5"><Check className="h-3.5 w-3.5" /> Save changes</Button>
          </div>
        ) : undefined}
      />

      <div className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${isPlatform ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{isPlatform
          ? 'You are editing the platform-wide defaults. These apply to every organisation unless individually overridden.'
          : 'You are editing permission overrides for your organisation only. Platform defaults apply elsewhere.'}</span>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card">Permission</TableHead>
                {MATRIX_ROLES.map(r => (
                  <TableHead key={r} className="text-center"><div className="flex justify-center"><RoleBadge role={r} /></div></TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_CATEGORIES.map(cat => (
                <TableRow key={cat}>
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <p className="font-medium text-foreground">{PERMISSION_LABELS[cat]}</p>
                    <p className="text-[11px] text-muted-foreground">{PERMISSION_DESCRIPTIONS[cat]}</p>
                  </TableCell>
                  {MATRIX_ROLES.map(role => {
                    const allowed = matrix[role][cat];
                    const locked = role === 'platform_admin' || !canEdit;
                    return (
                      <TableCell key={role} className="text-center">
                        {locked
                          ? (allowed
                            ? <Check className="mx-auto h-4 w-4 text-emerald-500" />
                            : <X className="mx-auto h-4 w-4 text-muted-foreground/40" />)
                          : <Switch checked={allowed} onCheckedChange={() => toggle(role, cat)} />}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Notification settings module (current user, self-service) ─────────────────

function NotificationSettingsModule() {
  const { user } = useAuth();
  const p = user?.profile;
  const userId = p?.user_id ?? null;
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    email_notifications: p?.email_notifications ?? true,
    notify_hearing_reminder: p?.notify_hearing_reminder ?? true,
    notify_task_assignment: p?.notify_task_assignment ?? true,
    notify_daily_cause_list: p?.notify_daily_cause_list ?? true,
    notify_case_assignment: p?.notify_case_assignment ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (k: keyof NotificationPrefs, v: boolean) => { setPrefs(prev => ({ ...prev, [k]: v })); setDirty(true); };

  async function save() {
    if (!userId) { toast.error('No profile is associated with your account.'); return; }
    setSaving(true);
    try {
      await updateMyNotificationPreferences(userId, prefs);
      toast.success('Notification preferences saved.');
      setDirty(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="Notification Settings"
        description="Choose which email notifications you personally receive."
        action={<Button size="sm" loading={saving} disabled={!dirty} onClick={save} className="gap-1.5"><Check className="h-3.5 w-3.5" /> Save</Button>}
      />
      <Card className="max-w-2xl">
        <CardContent className="space-y-1 p-2">
          <div className="flex items-center justify-between rounded-lg px-3.5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-4 w-4" /></span>
              <div>
                <p className="font-medium text-foreground">Email Notifications</p>
                <p className="text-[11px] text-muted-foreground">Master switch for all email alerts.</p>
              </div>
            </div>
            <Switch checked={prefs.email_notifications} onCheckedChange={v => set('email_notifications', v)} />
          </div>
          <div className="mx-3.5 h-px bg-border/70" />
          {NOTIFICATION_FIELDS.map(f => {
            const key = f.key as keyof NotificationPrefs;
            return (
              <div key={f.key} className="flex items-center justify-between rounded-lg px-3.5 py-3">
                <div>
                  <p className="font-medium text-foreground">{f.label}</p>
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                </div>
                <Switch checked={Boolean(prefs[key]) && prefs.email_notifications} disabled={!prefs.email_notifications} onCheckedChange={v => set(key, v)} />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ── API Credits module ────────────────────────────────────────────────────────

function ApiCreditsModule({ org, actorRole }: { org: Organization | null; actorRole: Role }) {
  const [summary, setSummary] = useState<OrgUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const credits = Number(org?.available_credits ?? 0);

  useEffect(() => {
    let active = true;
    const id = org?.id;
    if (!id || !UUID_RE.test(id)) { setLoading(false); setSummary(null); return; }
    setLoading(true);
    Promise.all([fetchUsageForOrg(id), fetchPricing()])
      .then(([usage, pricing]) => { if (active) setSummary(summarizeUsage(usage, pricing)); })
      .catch(() => { if (active) setSummary(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [org?.id]);

  return (
    <div className="space-y-5">
      <ModuleHeader
        title="API Credits"
        description="eCourts usage and remaining credits for your organisation."
        action={canManageCredits(actorRole)
          ? <Link to="/organizations"><Button variant="outline" size="sm" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Manage credits</Button></Link>
          : undefined}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Available Credits</div>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{credits.toLocaleString('en-IN')}</p>
            <p className="mt-1 text-xs text-muted-foreground">Plan: {org?.plan_name ?? 'Trial'}</p>
          </CardContent>
        </Card>
        <StatCard icon={Activity} label="API Calls" value={summary?.apiCalls ?? 0} tone="bg-blue-50 text-blue-600" />
        <StatCard icon={RefreshCw} label="Cases Synced" value={summary?.casesSynced ?? 0} hint={summary?.lastSync ? `Last: ${fmtDate(summary.lastSync)}` : undefined} tone="bg-emerald-50 text-emerald-600" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Usage by Endpoint</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading usage…</div>
          ) : !summary || summary.byEndpoint.length === 0 ? (
            <EmptyState icon={BarChart3} title="No usage yet" description="API usage will appear here once you sync cases from eCourts." className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Rate (₹)</TableHead>
                    <TableHead className="text-right">Charged (₹)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byEndpoint.map(e => (
                    <TableRow key={e.endpoint}>
                      <TableCell className="font-medium">{e.endpoint}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.calls}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{e.rate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{e.amountCharged.toFixed(2)}</TableCell>
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

// ── Billing module (platform admin only) ──────────────────────────────────────

function BillingModule({ organizations }: { organizations: Organization[] }) {
  const totalCredits = organizations.reduce((s, o) => s + Number(o.available_credits ?? 0), 0);
  return (
    <div className="space-y-5">
      <ModuleHeader title="Billing &amp; Plans" description="Subscriptions, plans and credits across all organisations." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Building2} label="Organizations" value={organizations.length} tone="bg-indigo-50 text-indigo-600" />
        <StatCard icon={Wallet} label="Total Credits" value={totalCredits.toLocaleString('en-IN')} tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LinkCard icon={Building2} to="/organizations" title="Manage Organizations" description="Create organisations, change plans and top up credits." />
        <LinkCard icon={BarChart3} to="/organizations" title="Platform Analytics" description="Usage, spend and adoption across all tenants." />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Organizations</CardTitle></CardHeader>
        <CardContent className="p-0">
          {organizations.length === 0 ? (
            <EmptyState icon={Building2} title="No organizations" description="Create your first organisation to begin billing." className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.organization_name}</TableCell>
                      <TableCell><Badge variant="info">{o.plan_name ?? 'Trial'}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{Number(o.available_credits ?? 0).toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-center">{o.active === false ? <Badge variant="secondary">Inactive</Badge> : <Badge variant="success">Active</Badge>}</TableCell>
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

// ── Audit logs module (future) ────────────────────────────────────────────────

const AUDIT_ACTION_META: Record<string, { label: string; variant: BadgeVariant }> = {
  user_created: { label: 'User Created', variant: 'success' },
  user_updated: { label: 'User Updated', variant: 'info' },
  user_disabled: { label: 'User Disabled', variant: 'destructive' },
  user_activated: { label: 'User Activated', variant: 'success' },
  password_reset: { label: 'Password Reset', variant: 'warning' },
  role_changed: { label: 'Role Changed', variant: 'purple' },
};

function AuditLogsModule({ actorRole, orgId }: { actorRole: Role; orgId: string | null }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAuditLogs(actorRole, orgId)
      .then(rows => { if (active) setLogs(rows); })
      .catch(e => { if (active) { toast.error(e instanceof Error ? e.message : 'Failed to load audit logs.'); setLogs([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorRole, orgId]);

  return (
    <div className="space-y-4">
      <ModuleHeader title="Audit Logs" description="A history of administrative activity, with actor and timestamp." />
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-6 w-28 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Administrative actions such as creating users or resetting passwords will appear here."
              className="m-4"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => {
                    const meta = AUDIT_ACTION_META[log.action] ?? { label: log.action, variant: 'secondary' as BadgeVariant };
                    return (
                      <TableRow key={log.id}>
                        <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.actor_email || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.target_email || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(log.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Console shell ─────────────────────────────────────────────────────────────

export default function Administration() {
  const { user } = useAuth();
  const { org } = useOrg();
  const actorRole = normalizeRole(user?.profile?.role);
  const orgId = user?.profile?.organization_id ?? org?.id ?? null;

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [active, setActive] = useState<ModuleKey>('dashboard');

  useEffect(() => {
    fetchOrganizations().then(setOrganizations).catch(() => setOrganizations([]));
  }, []);

  const visibleModules = useMemo(() => ADMIN_MODULES.filter(m => m.visible(actorRole)), [actorRole]);
  // Derive the effective module during render so we never hold a key the current
  // role can't see (avoids a corrective setState-in-effect / cascading render).
  const current = visibleModules.find(m => m.key === active) ?? visibleModules[0];
  const activeKey: ModuleKey = current?.key ?? 'dashboard';

  if (!canAccessAdministration(actorRole)) {
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

  function renderModule() {
    switch (activeKey) {
      case 'users': return <UsersTab actorRole={actorRole} orgId={orgId} organizations={organizations} />;
      case 'advocates': return <AdvocatesTab actorRole={actorRole} orgId={orgId} />;
      case 'roles': return <RolesPermissionsModule actorRole={actorRole} orgId={orgId} />;
      case 'notifications': return <NotificationSettingsModule />;
      case 'organization': return <OrgSettingsTab org={org} />;
      case 'credits': return <ApiCreditsModule org={org} actorRole={actorRole} />;
      case 'billing': return <BillingModule organizations={organizations} />;
      case 'audit': return <AuditLogsModule actorRole={actorRole} orgId={orgId} />;
      case 'dashboard':
      default:
        return <AdminDashboard actorRole={actorRole} orgId={orgId} org={org} organizations={organizations} onNavigate={setActive} />;
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="eyebrow text-primary">Administration</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Administration</h1>
          <Badge variant={ROLE_BADGE_VARIANT[actorRole]} className="gap-1">
            <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[actorRole]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Central console to manage your organisation — users, roles, notifications, credits and more.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[248px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            {MODULE_GROUPS.map(group => {
              const items = visibleModules.filter(m => m.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="flex gap-1 lg:flex-col lg:gap-0.5">
                  <p className="hidden px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground lg:block">{group}</p>
                  {items.map(m => {
                    const selected = activeKey === m.key;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setActive(m.key)}
                        className={`group flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${selected ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                      >
                        <m.icon className="h-4 w-4 shrink-0" />
                        <span>{m.label}</span>
                        {selected && <ChevronRight className="ml-auto hidden h-4 w-4 lg:block" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">{renderModule()}</div>
      </div>
    </div>
  );
}
