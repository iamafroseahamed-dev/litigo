/**
 * lib/permissions.ts — The Roles & Permissions matrix.
 *
 * A permission is one functional area of the product (a "category"). Every role
 * has an allow/deny flag for every category. The DEFAULT matrix below ships with
 * the app so it is fully functional with zero configuration; administrators can
 * override individual cells, which are persisted to the `role_permissions` table
 * (migration 018). NULL organization_id = platform default, otherwise per-org.
 */
import { supabase } from '@/lib/supabase';
import type { Role } from '@/types';
import { isPlatformAdmin } from '@/lib/roles';

export type ManagedRole = Exclude<Role, 'user'>;

export const MATRIX_ROLES: ManagedRole[] = [
  'platform_admin', 'super_admin', 'admin', 'advocate', 'viewer',
];

export const PERMISSION_CATEGORIES = [
  'dashboard', 'cases', 'hearings', 'tasks', 'advocates', 'users',
  'organizations', 'ai_insights', 'bulk_upload', 'ecourts_sync',
  'api_credits', 'reports', 'settings',
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const PERMISSION_LABELS: Record<PermissionCategory, string> = {
  dashboard: 'Dashboard',
  cases: 'Cases',
  hearings: 'Hearings',
  tasks: 'Tasks',
  advocates: 'Advocates',
  users: 'Users',
  organizations: 'Organizations',
  ai_insights: 'AI Insights',
  bulk_upload: 'Bulk Upload',
  ecourts_sync: 'eCourts Sync',
  api_credits: 'API Credits',
  reports: 'Reports',
  settings: 'Settings',
};

export const PERMISSION_DESCRIPTIONS: Record<PermissionCategory, string> = {
  dashboard: 'View the analytics dashboard and KPIs.',
  cases: 'Create, edit and manage cases.',
  hearings: 'View and manage upcoming hearings.',
  tasks: 'Create, assign and complete tasks.',
  advocates: 'Manage advocates and their assignments.',
  users: 'Invite, edit and deactivate users.',
  organizations: 'Manage organisation settings.',
  ai_insights: 'Access AI analysis of orders and cases.',
  bulk_upload: 'Import cases in bulk from spreadsheets.',
  ecourts_sync: 'Run eCourts synchronisation.',
  api_credits: 'View and manage API credits.',
  reports: 'Generate and export reports.',
  settings: 'Change organisation-wide settings.',
};

export type PermissionMatrix = Record<ManagedRole, Record<PermissionCategory, boolean>>;

// `true` for every category — used to compose the matrix concisely.
function all(value: boolean): Record<PermissionCategory, boolean> {
  return PERMISSION_CATEGORIES.reduce((acc, c) => { acc[c] = value; return acc; },
    {} as Record<PermissionCategory, boolean>);
}

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  platform_admin: all(true),
  super_admin: all(true),
  admin: {
    dashboard: true, cases: true, hearings: true, tasks: true, advocates: true,
    users: false, organizations: false, ai_insights: true, bulk_upload: true,
    ecourts_sync: true, api_credits: true, reports: true, settings: false,
  },
  advocate: {
    dashboard: true, cases: true, hearings: true, tasks: true, advocates: false,
    users: false, organizations: false, ai_insights: true, bulk_upload: false,
    ecourts_sync: false, api_credits: false, reports: false, settings: false,
  },
  viewer: {
    dashboard: true, cases: true, hearings: true, tasks: false, advocates: false,
    users: false, organizations: false, ai_insights: true, bulk_upload: false,
    ecourts_sync: false, api_credits: false, reports: true, settings: false,
  },
};

/** Deep-clone the default matrix so callers can mutate safely. */
export function cloneDefaultMatrix(): PermissionMatrix {
  return MATRIX_ROLES.reduce((acc, role) => {
    acc[role] = { ...DEFAULT_PERMISSION_MATRIX[role] };
    return acc;
  }, {} as PermissionMatrix);
}

interface RolePermissionRow {
  organization_id: string | null;
  role: ManagedRole;
  permission: PermissionCategory;
  allowed: boolean;
}

/**
 * Load the effective matrix for the given organisation: platform defaults
 * overlaid with this org's overrides. Falls back to the hard-coded defaults
 * when the table is unavailable (e.g. local / dev sessions).
 */
export async function fetchPermissionMatrix(orgId: string | null): Promise<PermissionMatrix> {
  const matrix = cloneDefaultMatrix();
  try {
    let query = supabase.from('role_permissions').select('organization_id, role, permission, allowed');
    // Global defaults always apply; org rows override them for non-platform scope.
    if (orgId) query = query.or(`organization_id.is.null,organization_id.eq.${orgId}`);
    else query = query.is('organization_id', null);

    const { data, error } = await query;
    if (error || !data) return matrix;

    // Apply global rows first, then org-specific rows so the latter win.
    const rows = (data as unknown as RolePermissionRow[])
      .filter(r => MATRIX_ROLES.includes(r.role) && r.permission in PERMISSION_LABELS)
      .sort((a, b) => (a.organization_id === null ? -1 : 1) - (b.organization_id === null ? -1 : 1));

    for (const r of rows) matrix[r.role][r.permission] = r.allowed;
    return matrix;
  } catch {
    return matrix;
  }
}

/**
 * Persist the matrix. Platform admins write global defaults (organization_id
 * NULL); everyone else writes overrides scoped to their organisation.
 */
export async function savePermissionMatrix(
  actorRole: Role | null | undefined,
  orgId: string | null,
  matrix: PermissionMatrix,
): Promise<void> {
  const scope = isPlatformAdmin(actorRole) ? null : orgId;
  if (!scope && !isPlatformAdmin(actorRole)) {
    throw new Error('No organisation is associated with your account.');
  }

  const rows = MATRIX_ROLES.flatMap(role =>
    PERMISSION_CATEGORIES.map(permission => ({
      organization_id: scope,
      role,
      permission,
      allowed: matrix[role][permission],
    })),
  );

  const onConflict = scope ? 'organization_id,role,permission' : 'role,permission';
  const { error } = await supabase.from('role_permissions').upsert(rows, { onConflict });
  if (error) throw new Error(error.message);
}
