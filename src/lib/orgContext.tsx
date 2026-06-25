import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { fetchOrganizations } from '@/lib/organizations';
import { isPlatformAdmin as isPlatformAdminRole, normalizeRole } from '@/lib/roles';
import type { Organization, Role } from '@/types';

/**
 * Global current-organization context. Resolved once at startup from the logged
 * in user's profile.organization_id, then reused across every page via useOrg().
 *
 * IMPORTANT — multi-tenant data scoping:
 *   `orgId` is the canonical id used to FILTER every case/listing query and is
 *   derived directly from the signed-in user's profile.organization_id (the
 *   source of truth), NOT from the resolved `org` object. We must never silently
 *   substitute a different organisation for a user who already has a real
 *   organization_id — doing so would filter their data to the wrong tenant and
 *   make their own cases disappear.
 *
 *   - platform_admin  → orgId = null  → no org filter (sees ALL organisations).
 *   - super_admin / admin / advocate / viewer → orgId = profile.organization_id.
 *
 * The `org` object is resolved for display/credits only.
 */

interface OrgState {
  /** Resolved organisation object — for display (name, plan, credits) only. */
  org: Organization | null;
  /** Canonical org id used to scope data queries. null => no filter (platform admin / unknown). */
  orgId: string | null;
  /** Normalised role of the signed-in user. */
  role: Exclude<Role, 'user'>;
  /** True when the user is a platform admin (cross-org, sees everything). */
  isPlatformAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgState | null>(null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): boolean {
  return !!s && UUID_RE.test(s);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const role = normalizeRole(user?.profile?.role);
  const platformAdmin = isPlatformAdminRole(user?.profile?.role);
  const profileOrgId = isUuid(user?.profile?.organization_id)
    ? (user!.profile!.organization_id as string)
    : null;
  // Effective filter id: platform admins see everything (null), everyone else is
  // pinned to their own organisation. This is the single source of truth for
  // every case/listing query in the app.
  const orgId = platformAdmin ? null : profileOrgId;

  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const orgs = await fetchOrganizations();
      let resolved: Organization | null = null;
      if (profileOrgId) resolved = orgs.find(o => o.id === profileOrgId) ?? null;
      // Only fall back to an arbitrary org when the user has NO profile org at all
      // (e.g. a platform admin with no home org, or a local/dev session). We must
      // NEVER substitute a different org for a user who has a real
      // organization_id — that would scope their data to the wrong tenant.
      if (!resolved && !profileOrgId) resolved = orgs.find(o => o.active !== false) ?? orgs[0] ?? null;
      if (!resolved && profileOrgId) {
        console.warn('[Org] Profile organization_id not found in organizations list; data is still scoped to the profile org id.', { profileOrgId });
      }
      setOrg(resolved);
    } catch (e) {
      console.warn('[Org] Failed to load organization', e);
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [profileOrgId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Clear all cached query data whenever the signed-in identity changes so one
  // user never sees another user's (or another org's) cached cases.
  const prevUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = user?.id ?? null;
    if (prevUserId.current !== undefined && prevUserId.current !== id) {
      queryClient.clear();
    }
    prevUserId.current = id;
  }, [user?.id, queryClient]);

  return (
    <OrgContext.Provider value={{ org, orgId, role, isPlatformAdmin: platformAdmin, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
