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
  'id, user_id, organization_id, full_name, email, role, active, last_login_at, ' +
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

function toPayload(input: Partial<UserInput>) {
  const payload: Record<string, unknown> = {};
  if (input.full_name !== undefined) payload.full_name = input.full_name.trim();
  if (input.email !== undefined) payload.email = input.email.trim().toLowerCase();
  if (input.role !== undefined) payload.role = input.role;
  if (input.organization_id !== undefined) payload.organization_id = input.organization_id;
  if (input.active !== undefined) payload.active = input.active;
  if (input.email_notifications !== undefined) payload.email_notifications = input.email_notifications;
  if (input.notify_hearing_reminder !== undefined) payload.notify_hearing_reminder = input.notify_hearing_reminder;
  if (input.notify_task_assignment !== undefined) payload.notify_task_assignment = input.notify_task_assignment;
  if (input.notify_daily_cause_list !== undefined) payload.notify_daily_cause_list = input.notify_daily_cause_list;
  if (input.notify_case_assignment !== undefined) payload.notify_case_assignment = input.notify_case_assignment;
  return payload;
}

/**
 * Invite / create a user profile. Note: full auth provisioning (password, SSO,
 * Entra ID) is handled separately — this records the user in `profiles` so they
 * are recognised on first sign-in. Designed to be swapped for an invite flow.
 */
export async function createUser(input: UserInput): Promise<void> {
  const { error } = await supabase.from('profiles').insert(toPayload(input));
  if (error) throw new Error(error.message);
}

export async function updateUser(id: string, patch: Partial<UserInput>): Promise<void> {
  const { error } = await supabase.from('profiles').update(toPayload(patch)).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', id);
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

  for (const row of (data ?? []) as AdvocateCaseRow[]) {
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
