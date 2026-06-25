/**
 * lib/userManagement.ts — Data access for the User Management module.
 *
 * Every query is scoped to the caller's organisation UNLESS they are a platform
 * admin. This mirrors the row-level-security policies in migration 017 — the
 * client filter is a convenience; RLS is the real boundary.
 */
import { supabase } from '@/lib/supabase';
import type { Organization, Role } from '@/types';
import { isPlatformAdmin } from '@/lib/roles';

export interface AppUser {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  full_name: string;
  email: string;
  mobile: string | null;
  role: Role;
  active: boolean;
  last_login_at: string | null;
  email_notifications: boolean;
  notify_hearing_reminder: boolean;
  notify_task_assignment: boolean;
  notify_daily_cause_list: boolean;
  notify_case_assignment: boolean;
  created_at: string;
  organization?: Organization | null;
}

export interface UserInput {
  full_name: string;
  email: string;
  mobile: string;
  role: Role;
  organization_id: string | null;
  active: boolean;
  email_notifications: boolean;
  notify_hearing_reminder: boolean;
  notify_task_assignment: boolean;
  notify_daily_cause_list: boolean;
  notify_case_assignment: boolean;
}

const USER_COLUMNS =
  'id, user_id, organization_id, full_name, email, mobile, role, active, last_login_at, ' +
  'email_notifications, notify_hearing_reminder, notify_task_assignment, ' +
  'notify_daily_cause_list, notify_case_assignment, created_at, ' +
  'organization:organizations(*)';

/**
 * Fetch users visible to the current actor.
 * Platform admins see all users; everyone else is restricted to their own org.
 */
export async function fetchUsers(actorRole: Role | null | undefined, orgId: string | null): Promise<AppUser[]> {
  let query = supabase
    .from('profiles')
    .select(USER_COLUMNS)
    .order('full_name', { ascending: true });

  if (!isPlatformAdmin(actorRole)) {
    if (!orgId) return [];
    query = query.eq('organization_id', orgId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AppUser[];
}

export interface CreateUserResult {
  userId: string;
  temporaryPassword: string;
}

/**
 * Invoke the secure `admin-users` Edge Function. The function is the ONLY place
 * privileged operations run (it holds the service-role key) and it enforces
 * role/organisation permissions on the server. This helper unwraps both the
 * transport-level errors and the JSON `{ error }` body the function returns.
 */
async function invokeAdmin<T = { success: true }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });

  if (error) {
    let message = error.message;
    // supabase-js wraps non-2xx responses in a FunctionsHttpError whose JSON
    // body carries the friendly message we returned from the function.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = await ctx.json();
        if (payload?.error) message = payload.error;
      } catch {
        /* fall back to the transport error message */
      }
    }
    throw new Error(friendlyError(message));
  }

  if (data && (data as { error?: string }).error) {
    throw new Error(friendlyError((data as { error: string }).error));
  }
  return data as T;
}

function friendlyError(message: string): string {
  if (/Failed to (send|fetch)|NetworkError|Failed to fetch/i.test(message)) {
    return 'Could not reach the user service. Ensure the admin-users Edge Function is deployed.';
  }
  return message;
}

/**
 * Create a fully provisioned user: Supabase Auth account + profile (+ advocate
 * directory entry). Returns a one-time temporary password to share securely.
 */
export async function createUser(input: UserInput): Promise<CreateUserResult> {
  return invokeAdmin<CreateUserResult>({
    action: 'create',
    full_name: input.full_name.trim(),
    email: input.email.trim().toLowerCase(),
    mobile: input.mobile.trim(),
    role: input.role,
    organization_id: input.organization_id,
    notifications: {
      email_notifications: input.email_notifications,
      notify_hearing_reminder: input.notify_hearing_reminder,
      notify_task_assignment: input.notify_task_assignment,
      notify_daily_cause_list: input.notify_daily_cause_list,
      notify_case_assignment: input.notify_case_assignment,
    },
  });
}

export async function updateUser(id: string, patch: Partial<UserInput>): Promise<void> {
  const body: Record<string, unknown> = { action: 'update', profile_id: id };
  if (patch.full_name !== undefined) body.full_name = patch.full_name.trim();
  if (patch.email !== undefined) body.email = patch.email.trim().toLowerCase();
  if (patch.mobile !== undefined) body.mobile = patch.mobile.trim();
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.organization_id !== undefined) body.organization_id = patch.organization_id;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.email_notifications !== undefined) body.email_notifications = patch.email_notifications;
  if (patch.notify_hearing_reminder !== undefined) body.notify_hearing_reminder = patch.notify_hearing_reminder;
  if (patch.notify_task_assignment !== undefined) body.notify_task_assignment = patch.notify_task_assignment;
  if (patch.notify_daily_cause_list !== undefined) body.notify_daily_cause_list = patch.notify_daily_cause_list;
  if (patch.notify_case_assignment !== undefined) body.notify_case_assignment = patch.notify_case_assignment;
  await invokeAdmin(body);
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await invokeAdmin({ action: 'set_status', profile_id: id, active });
}

/** Issue a new one-time temporary password for an existing user. */
export async function resetUserPassword(id: string): Promise<string> {
  const res = await invokeAdmin<{ temporaryPassword: string }>({
    action: 'reset_password',
    profile_id: id,
  });
  return res.temporaryPassword;
}

// ── Notification preferences (current user, self-service) ─────────────────────

export interface NotificationPrefs {
  email_notifications: boolean;
  notify_hearing_reminder: boolean;
  notify_task_assignment: boolean;
  notify_daily_cause_list: boolean;
  notify_case_assignment: boolean;
}

/**
 * Update the signed-in user's own notification preferences. RLS allows a user to
 * update their own profile row (see migration 017 profiles_update policy).
 */
export async function updateMyNotificationPreferences(userId: string, prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase.from('profiles').update(prefs).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// ── Advocates module ──────────────────────────────────────────────────────────
// Advocates are derived from the cases they are assigned to, with live metrics.
// Every advocate belongs to one organisation (the org of their cases).

export interface AdvocateSummary {
  name: string;
  email: string | null;
  mobile: string | null;
  assignedCases: number;
  activeCases: number;
  disposedCases: number;
  upcomingHearings: number;
  statusBreakdown: Record<string, number>;
  lastAssignedOn: string | null;
}

interface AdvocateCaseRow {
  assigned_advocate_name: string | null;
  assigned_advocate_email: string | null;
  assigned_advocate_mobile: string | null;
  advocate_name: string | null;
  advocate_email: string | null;
  advocate_mobile: string | null;
  advocate_status: string | null;
  case_status: string | null;
  next_hearing_date: string | null;
  assigned_on: string | null;
}

export async function fetchAdvocates(actorRole: Role | null | undefined, orgId: string | null): Promise<AdvocateSummary[]> {
  let query = supabase
    .from('cases')
    .select(
      'assigned_advocate_name, assigned_advocate_email, assigned_advocate_mobile, ' +
      'advocate_name, advocate_email, advocate_mobile, advocate_status, case_status, ' +
      'next_hearing_date, assigned_on',
    )
    .limit(10000);

  if (!isPlatformAdmin(actorRole)) {
    if (!orgId) return [];
    query = query.eq('organization_id', orgId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const today = new Date().toISOString().slice(0, 10);
  const byAdvocate = new Map<string, AdvocateSummary>();

  for (const row of (data ?? []) as unknown as AdvocateCaseRow[]) {
    const name = (row.assigned_advocate_name || row.advocate_name || '').trim();
    if (!name) continue;

    let summary = byAdvocate.get(name.toLowerCase());
    if (!summary) {
      summary = {
        name,
        email: row.assigned_advocate_email || row.advocate_email || null,
        mobile: row.assigned_advocate_mobile || row.advocate_mobile || null,
        assignedCases: 0,
        activeCases: 0,
        disposedCases: 0,
        upcomingHearings: 0,
        statusBreakdown: {},
        lastAssignedOn: null,
      };
      byAdvocate.set(name.toLowerCase(), summary);
    }

    summary.assignedCases += 1;
    const status = (row.case_status || '').toLowerCase();
    if (status === 'disposed') summary.disposedCases += 1;
    else summary.activeCases += 1;

    if (row.next_hearing_date && row.next_hearing_date >= today) summary.upcomingHearings += 1;

    const advStatus = (row.advocate_status || '').trim();
    if (advStatus) summary.statusBreakdown[advStatus] = (summary.statusBreakdown[advStatus] ?? 0) + 1;

    if (row.assigned_on && (!summary.lastAssignedOn || row.assigned_on > summary.lastAssignedOn)) {
      summary.lastAssignedOn = row.assigned_on;
    }
    if (!summary.email && (row.assigned_advocate_email || row.advocate_email)) {
      summary.email = row.assigned_advocate_email || row.advocate_email || null;
    }
    if (!summary.mobile && (row.assigned_advocate_mobile || row.advocate_mobile)) {
      summary.mobile = row.assigned_advocate_mobile || row.advocate_mobile || null;
    }
  }

  return Array.from(byAdvocate.values()).sort((a, b) => b.assignedCases - a.assignedCases);
}
