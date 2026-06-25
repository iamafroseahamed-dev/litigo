/**
 * lib/roles.ts — Role definitions, display metadata, and permission helpers for
 * the User Management module. Permissions are enforced server-side by RLS
 * (migration 017); these helpers drive what the UI exposes.
 *
 * Role hierarchy (highest → lowest privilege):
 *   platform_admin → super_admin → admin → advocate → viewer
 * The legacy database value `user` is treated as `viewer`.
 */
import type { Role } from '@/types';

export const ROLES: Exclude<Role, 'user'>[] = [
  'platform_admin',
  'super_admin',
  'admin',
  'advocate',
  'viewer',
];

/** Normalise the legacy `user` value to `viewer`. */
export function normalizeRole(role: Role | null | undefined): Exclude<Role, 'user'> {
  if (!role || role === 'user') return 'viewer';
  return role;
}

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform Admin',
  super_admin: 'Super Admin',
  admin: 'Admin',
  advocate: 'Advocate',
  viewer: 'Viewer',
  user: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Exclude<Role, 'user'>, string> = {
  platform_admin: 'Product owner. Manages every organisation, subscriptions and credits.',
  super_admin: 'One per organisation. Manages users, advocates and organisation settings.',
  admin: 'Manages cases, advocates, tasks and hearings within the organisation.',
  advocate: 'Works only assigned cases — updates status, notes and tasks.',
  viewer: 'Read-only access to the organisation workspace.',
};

export type BadgeVariant =
  | 'default' | 'secondary' | 'destructive' | 'outline'
  | 'success' | 'warning' | 'info' | 'purple';

export const ROLE_BADGE_VARIANT: Record<Role, BadgeVariant> = {
  platform_admin: 'purple',
  super_admin: 'destructive',
  admin: 'info',
  advocate: 'success',
  viewer: 'secondary',
  user: 'secondary',
};

// ── Permission helpers ────────────────────────────────────────────────────────

export function isPlatformAdmin(role: Role | null | undefined): boolean {
  return role === 'platform_admin';
}

export function isSuperAdmin(role: Role | null | undefined): boolean {
  return role === 'super_admin';
}

/** advocate / viewer cannot reach the User Management module at all. */
export function canAccessUserManagement(role: Role | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'platform_admin' || r === 'super_admin' || r === 'admin';
}

/** Who may create / edit / deactivate users. */
export function canManageUsers(role: Role | null | undefined): boolean {
  return canAccessUserManagement(role);
}

/** Only super_admin (own org) and platform_admin may delete users. */
export function canDeleteUsers(role: Role | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'platform_admin' || r === 'super_admin';
}

/** Only the platform admin can create / edit / delete organisations. */
export function canManageOrganizations(role: Role | null | undefined): boolean {
  return isPlatformAdmin(role);
}

/** Only the platform admin can assign or change the Super Admin role. */
export function canAssignSuperAdmin(role: Role | null | undefined): boolean {
  return isPlatformAdmin(role);
}

/** Only the platform admin can move a user between organisations. */
export function canChangeOrganization(role: Role | null | undefined): boolean {
  return isPlatformAdmin(role);
}

/** Platform-admin-only surfaces: Organizations, Billing, Credits, Analytics. */
export function canViewPlatformTools(role: Role | null | undefined): boolean {
  return isPlatformAdmin(role);
}

/**
 * The set of roles an actor is allowed to assign when creating / editing a user.
 *   platform_admin → every role
 *   super_admin    → admin, advocate, viewer (cannot mint another super admin)
 *   admin          → advocate, viewer
 */
export function assignableRoles(actorRole: Role | null | undefined): Exclude<Role, 'user'>[] {
  const r = normalizeRole(actorRole);
  if (r === 'platform_admin') return ['platform_admin', 'super_admin', 'admin', 'advocate', 'viewer'];
  if (r === 'super_admin') return ['admin', 'advocate', 'viewer'];
  if (r === 'admin') return ['advocate', 'viewer'];
  return [];
}
