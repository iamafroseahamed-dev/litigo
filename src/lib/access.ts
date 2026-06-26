import { normalizeRole } from '@/lib/roles';
import type { Role } from '@/types';

type NormalizedRole = Exclude<Role, 'user'>;

export type AppPermission =
  | 'dashboard:view'
  | 'cases:view'
  | 'cases:manage'
  | 'cases:sync'
  | 'cases:assign'
  | 'cases:bulk-assign'
  | 'tasks:manage'
  | 'hearings:view'
  | 'bulk-upload:manage'
  | 'administration:view'
  | 'organizations:manage';

const ROLE_PERMISSIONS: Record<NormalizedRole, AppPermission[]> = {
  platform_admin: [
    'dashboard:view',
    'cases:view',
    'cases:manage',
    'cases:sync',
    'cases:assign',
    'cases:bulk-assign',
    'tasks:manage',
    'hearings:view',
    'bulk-upload:manage',
    'administration:view',
    'organizations:manage',
  ],
  super_admin: [
    'dashboard:view',
    'cases:view',
    'cases:manage',
    'cases:sync',
    'cases:assign',
    'cases:bulk-assign',
    'tasks:manage',
    'hearings:view',
    'bulk-upload:manage',
    'administration:view',
  ],
  admin: [
    'dashboard:view',
    'cases:view',
    'cases:manage',
    'cases:sync',
    'cases:assign',
    'cases:bulk-assign',
    'tasks:manage',
    'hearings:view',
    'bulk-upload:manage',
    'administration:view',
  ],
  advocate: [
    'dashboard:view',
    'cases:view',
    'tasks:manage',
    'hearings:view',
  ],
  viewer: [
    'dashboard:view',
    'cases:view',
    'hearings:view',
  ],
};

export function hasPermission(role: Role | null | undefined, permission: AppPermission): boolean {
  const normalized = normalizeRole(role);
  return ROLE_PERMISSIONS[normalized].includes(permission);
}
