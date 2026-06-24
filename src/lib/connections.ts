import { supabase } from '@/lib/supabase';
import type { ConnectedCaseRow, RelationshipType } from '@/types';

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  'Connected', 'WMP', 'Appeal', 'Review', 'Contempt',
  'Interim Application', 'Transfer', 'Related Matter',
];

export interface CaseSearchResult {
  id: string;
  organization_id?: string | null;
  case_number: string | null;
  court_name: string | null;
  case_status: string | null;
  next_hearing_date: string | null;
  petitioner: string | null;
  respondent: string | null;
  cnr_number: string | null;
}

function sameOrLegacyScope(rowOrg: string | null | undefined, orgId: string | null | undefined): boolean {
  if (!orgId) return true;
  return !rowOrg || rowOrg === orgId;
}

// Load every case connected to `caseId` in either direction, resolved to the
// "other" case so the relationship is visible from both sides (bidirectional).
export async function loadConnections(caseId: string, orgId?: string | null): Promise<ConnectedCaseRow[]> {
  const { data: conns, error } = await supabase
    .from('case_connections')
    .select('id, parent_case_id, connected_case_id, relationship_type, created_at')
    .or(`parent_case_id.eq.${caseId},connected_case_id.eq.${caseId}`)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = conns ?? [];
  const otherIds = Array.from(new Set(
    rows.map(r => (r.parent_case_id === caseId ? r.connected_case_id : r.parent_case_id)),
  ));
  if (otherIds.length === 0) return [];

  const { data: cs } = await supabase
    .from('cases')
    .select('id, organization_id, case_number, court_name, case_status, next_hearing_date')
    .in('id', otherIds);
  const byId = new Map((cs ?? []).map(c => [c.id, c]));

  return rows
    .filter(r => {
      if (!orgId) return true;
      const parentOrg = byId.get(r.parent_case_id as string)?.organization_id as string | null | undefined;
      const connectedOrg = byId.get(r.connected_case_id as string)?.organization_id as string | null | undefined;
      return sameOrLegacyScope(parentOrg, orgId) && sameOrLegacyScope(connectedOrg, orgId);
    })
    .map(r => {
    const otherId = r.parent_case_id === caseId ? r.connected_case_id : r.parent_case_id;
    const c = byId.get(otherId);
    return {
      connectionId: r.id as string,
      relationship_type: (r.relationship_type as string) ?? 'Connected',
      case: {
        id: otherId as string,
        case_number: c?.case_number ?? null,
        court_name: c?.court_name ?? null,
        case_status: c?.case_status ?? null,
        next_hearing_date: c?.next_hearing_date ?? null,
      },
    };
  });
}

export async function addConnection(parentId: string, connectedId: string, relationshipType: string, orgId?: string | null) {
  if (parentId === connectedId) throw new Error('A case cannot be connected to itself.');

  // Connected cases must stay inside the same organization scope (legacy NULL rows allowed).
  const { data: pairRows, error: pairErr } = await supabase
    .from('cases')
    .select('id, organization_id')
    .in('id', [parentId, connectedId]);
  if (pairErr) throw new Error(pairErr.message);
  if (!pairRows || pairRows.length < 2) throw new Error('Unable to validate cases for connection.');

  const byId = new Map(pairRows.map(r => [r.id as string, (r.organization_id as string | null) ?? null]));
  const parentOrg = byId.get(parentId);
  const connectedOrg = byId.get(connectedId);
  const scopeOrg = orgId ?? parentOrg ?? connectedOrg ?? null;
  if (!sameOrLegacyScope(parentOrg, scopeOrg) || !sameOrLegacyScope(connectedOrg, scopeOrg)) {
    throw new Error('Cases from different organizations cannot be connected.');
  }
  if (parentOrg && connectedOrg && parentOrg !== connectedOrg) {
    throw new Error('Cases from different organizations cannot be connected.');
  }

  // Guard the reverse direction too (the unique index only blocks exact dupes).
  const { data: existing } = await supabase
    .from('case_connections')
    .select('id')
    .or(`and(parent_case_id.eq.${parentId},connected_case_id.eq.${connectedId}),and(parent_case_id.eq.${connectedId},connected_case_id.eq.${parentId})`)
    .limit(1);
  if (existing && existing.length > 0) throw new Error('These cases are already connected.');

  const { error } = await supabase.from('case_connections').insert({
    parent_case_id: parentId,
    connected_case_id: connectedId,
    relationship_type: relationshipType,
  });
  if (error) throw new Error(error.message);
}

export async function removeConnection(connectionId: string) {
  const { error } = await supabase.from('case_connections').delete().eq('id', connectionId);
  if (error) throw new Error(error.message);
}

// Per-case connection counts (both directions) for the Cases list column.
export async function loadConnectionCounts(orgId?: string | null): Promise<Record<string, number>> {
  const { data } = await supabase.from('case_connections').select('parent_case_id, connected_case_id');
  let allowed: Set<string> | null = null;
  if (orgId) {
    const { data: scopedCases } = await supabase
      .from('cases')
      .select('id, organization_id')
      .or(`organization_id.eq.${orgId},organization_id.is.null`);
    allowed = new Set((scopedCases ?? []).map(r => r.id as string));
  }

  const m: Record<string, number> = {};
  (data ?? []).forEach(r => {
    if (allowed && (!allowed.has(r.parent_case_id as string) || !allowed.has(r.connected_case_id as string))) return;
    m[r.parent_case_id as string] = (m[r.parent_case_id as string] ?? 0) + 1;
    m[r.connected_case_id as string] = (m[r.connected_case_id as string] ?? 0) + 1;
  });
  return m;
}

// Free-text search over the cases table for the connection picker.
export async function searchCases(query: string, excludeIds: string[] = [], limit = 50, orgId?: string | null): Promise<CaseSearchResult[]> {
  const q = query.trim().replace(/[,()%]/g, ' ');
  let req = supabase
    .from('cases')
    .select('id, organization_id, case_number, court_name, case_status, next_hearing_date, petitioner, respondent, cnr_number')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (orgId) req = req.or(`organization_id.eq.${orgId},organization_id.is.null`);
  if (q) {
    req = req.or(
      `case_number.ilike.%${q}%,petitioner.ilike.%${q}%,respondent.ilike.%${q}%,cnr_number.ilike.%${q}%`,
    );
  }
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  return ((data ?? []) as CaseSearchResult[]).filter(c => !excludeIds.includes(c.id));
}
