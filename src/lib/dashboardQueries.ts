import { supabase } from '@/lib/supabase';
import { deriveCaseType } from '@/lib/caseType';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardKpis {
  total_cases: number;
  pending_cases: number;
  disposed_cases: number;
  cases_listed_today: number;
  hearings_within_7_days: number;
  hearings_today: number;
}

export interface CategoryCount {
  label: string;
  value: number;
}

export interface HearingDateCount {
  hearing_date: string;
  value: number;
}

export interface RecentListing {
  id: string;
  case_number: string | null;
  court_hall: string | null;
  judge_name: string | null;
  stage: string | null;
  listed_date: string | null;
  created_at: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function rpcRows<T>(fn: string): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// ── Query functions (server-side SQL aggregation via RPC) ────────────────────

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const { data, error } = await supabase.rpc('dashboard_kpis');
  if (error) throw new Error(error.message);
  return (data ?? {
    total_cases: 0,
    pending_cases: 0,
    disposed_cases: 0,
    cases_listed_today: 0,
    hearings_within_7_days: 0,
    hearings_today: 0,
  }) as DashboardKpis;
}

export const fetchCasesByCourt        = () => rpcRows<CategoryCount>('cases_by_court');
export const fetchCaseStatusBreakdown = () => rpcRows<CategoryCount>('case_status_breakdown');
export const fetchCasesByDistrict     = () => rpcRows<CategoryCount>('cases_by_district');
export const fetchCasesBySection      = () => rpcRows<CategoryCount>('cases_by_section');
export const fetchDisposalOutcomes    = () => rpcRows<CategoryCount>('disposal_outcomes');
export const fetchHearingsByDate       = () => rpcRows<HearingDateCount>('hearings_by_date');

export async function fetchRecentListings(): Promise<RecentListing[]> {
  const { data, error } = await supabase
    .from('today_matched_listings')
    .select('id, case_number, court_hall, judge_name, stage, listed_date, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as RecentListing[];
}

// Top cases by number of connections (both directions). Degrades to [] if the
// case_connections table doesn't exist yet.
export async function fetchMostConnectedCases(): Promise<CategoryCount[]> {
  try {
    const { data, error } = await supabase
      .from('case_connections')
      .select('parent_case_id, connected_case_id');
    if (error) return [];

    const counts: Record<string, number> = {};
    (data ?? []).forEach(r => {
      counts[r.parent_case_id as string] = (counts[r.parent_case_id as string] ?? 0) + 1;
      counts[r.connected_case_id as string] = (counts[r.connected_case_id as string] ?? 0) + 1;
    });

    const topIds = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);
    if (topIds.length === 0) return [];

    const { data: cs } = await supabase
      .from('cases')
      .select('id, case_number')
      .in('id', topIds);
    const byId = new Map((cs ?? []).map(c => [c.id as string, c.case_number as string | null]));

    return topIds.map(id => ({ label: byId.get(id) || '—', value: counts[id] }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Executive Command Center — aggregated analytics bundle
//  All aggregation is done client-side from a small number of broad reads so the
//  feature works without any new Postgres RPCs. Every query is error-tolerant so
//  a missing table never breaks the dashboard.
// ═══════════════════════════════════════════════════════════════════════════════

const PAGE = 49999; // generous upper bound for a single CLA dataset read

export interface ExecKpis {
  totalCases: number;
  pendingCases: number;
  disposedCases: number;
  activeCases: number;
  sensitiveCases: number;
  claPartyCases: number;
  casesListedToday: number;
  upcomingHearings30: number;
  openTasks: number;
  overdueTasks: number;
  // Advocate (internal) activity status counts
  readyForHearing: number;
  counterPending: number;
  documentsAwaited: number;
  legalOpinionPending: number;
  compliancePending: number;
  connectedCases: number;
  assignedAdvocates: number;
  todaysCauseListMatches: number;
  apiCallsToday: number;
  apiCreditsRemaining: number;
  // Extended KPIs
  urgentHearings7: number;
  updateRequired: number;
  totalAdvocates: number;
  avgDisposalDays: number;
  successRate: number;
}

export interface SparklinePoint { month: string; value: number; }

export interface MatrixCell { rowKey: string; colKey: string; count: number; }

export interface AdvocatePerformanceV2 {
  advocate: string;
  assignedCases: number;
  pending: number;
  active: number;
  disposedCases: number;
  upcomingHearings: number;
  readyForHearing: number;
  documentsAwaited: number;
  counterPending: number;
  hearingsThisMonth: number;
  successRate: number;
  avgDisposalDays: number;
}

export interface DashboardFilters {
  district?: string;
  court?: string;
  caseType?: string;
  caseStatus?: string;
  advocate?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ApiDailyUsage {
  date: string;
  calls: number;
}

export interface OrgCaseBreakdown {
  organizationId: string;
  label: string;
  cases: number;
}

export interface TaskProgress {
  open: number;
  completed: number;
}

export interface DistrictLitigation {
  district: string;
  total: number;
  pending: number;
  disposed: number;
}

export interface DistrictDetail {
  district: string;
  total: number;
  pending: number;
  disposed: number;
  active: number;
  sensitive: number;
  upcomingHearings: number;
  advocates: number;
  openTasks: number;
  overdueTasks: number;
  readyForHearing: number;
  counterPending: number;
  documentsAwaited: number;
  compliancePending: number;
  advocateBreakdown: { advocate: string; cases: number }[];
  sectionBreakdown: { section: string; cases: number }[];
  upcomingHearingsList: { caseNumber: string | null; hearingDate: string | null; advocateStatus: string | null }[];
  priorityCases: { caseNumber: string | null; advocateStatus: string | null }[];
  caseList: { caseNumber: string | null; status: string | null; advocateStatus: string | null; sensitive: boolean }[];
}

export interface AdvocatePerformance {
  advocate: string;
  assignedCases: number;
  readyForHearing: number;
  documentsAwaited: number;
  counterPending: number;
  hearingsThisMonth: number;
  upcomingHearings: number;
  disposedCases: number;
}

export interface SectionAdvocateRow {
  section: string;
  advocate: string;
  assignedCases: number;
}

export interface TaskAssigneePerformance {
  assignee: string;
  openTasks: number;
  completedTasks: number;
  overdueTasks: number;
  totalTasks: number;
}

export interface UpcomingHearingRow {
  caseId: string;
  caseNumber: string | null;
  advocate: string | null;
  hearingDate: string | null;
  openTasks: number;
  status: string | null;
  advocateStatus: string | null;
  priority: 'High' | 'Medium' | 'Low';
}

export interface OverdueTaskRow {
  id: string;
  caseNumber: string | null;
  task: string;
  advocate: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  daysOverdue: number;
}

export interface CauseListAnalytics {
  listedToday: number;
  listedThisWeek: number;
  courtHalls: CategoryCount[];
  judges: CategoryCount[];
}

export interface TrendPoint {
  month: string;          // YYYY-MM
  label: string;          // e.g. "Jun 25"
  newCases: number;
  casesDisposed: number;
  hearings: number;
  tasksCreated: number;
  tasksCompleted: number;
}

export interface AiCaseSnapshot {
  caseId: string;
  caseNumber: string | null;
  advocate: string | null;
  district: string | null;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Unknown';
  immediateAttention: boolean;
  upcomingHearing: boolean;
  noActivity: boolean;
  longPending: boolean;
  generatedAt: string | null;
}

export interface ExecutiveAnalytics {
  kpis: ExecKpis;
  districts: DistrictLitigation[];
  districtDetails: Record<string, DistrictDetail>;
  sections: CategoryCount[];
  caseTypes: CategoryCount[];
  sectionAdvocates: SectionAdvocateRow[];
  advocates: AdvocatePerformance[];
  leaderboard: AdvocatePerformance[];
  taskAssignees: TaskAssigneePerformance[];
  upcomingHearings: UpcomingHearingRow[];
  overdueTasks: OverdueTaskRow[];
  connectedTotal: number;
  causeList: CauseListAnalytics;
  trend: TrendPoint[];
  advocateStatusDistribution: CategoryCount[];
  aiCases: AiCaseSnapshot[];
  courts: CategoryCount[];
  taskProgress: TaskProgress;
  apiDailyCalls: ApiDailyUsage[];
  orgCases: OrgCaseBreakdown[];
  filterMeta: {
    districts: string[];
    courts: string[];
    caseTypes: string[];
    statuses: string[];
    advocates: string[];
    sections: string[];
  };
  // Extended analytics
  disposalDistribution: CategoryCount[];
  advocateV2: AdvocatePerformanceV2[];
  filingTrend24: TrendPoint[];
  kpiSparklines: Record<string, SparklinePoint[]>;
  kpiTrends: Record<string, number>;
  advocateCaseTypeMatrix: MatrixCell[];
  advocateSectionMatrix: MatrixCell[];
}

interface CaseRow {
  id: string;
  organization_id: string | null;
  case_number: string | null;
  court_name: string | null;
  district: string | null;
  section: string | null;
  case_status: string | null;
  case_type: string | null;
  advocate_status: string | null;
  next_hearing_date: string | null;
  last_hearing_date: string | null;
  assigned_advocate_name: string | null;
  sensitivity: string | null;
  cla_party_status: string | null;
  nature_of_disposal: string | null;
  follow_up_status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TaskRow {
  id: string;
  case_id: string;
  task_title: string | null;
  task_status: string | null;
  due_date: string | null;
  assigned_to_name: string | null;
  created_at: string | null;
  completed_at: string | null;
}

interface ListingRow {
  court_hall: string | null;
  judge_name: string | null;
  listed_date: string | null;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function monthKey(iso: string | null): string | null {
  if (!iso) return null;
  return String(iso).slice(0, 7);
}
function topN(map: Map<string, number>, n: number): CategoryCount[] {
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function orgOrLegacyFilter(orgId?: string | null): string | null {
  if (!orgId) return null;
  return `organization_id.eq.${orgId},organization_id.is.null`;
}

export async function fetchExecutiveAnalytics(orgId?: string | null, filters?: DashboardFilters): Promise<ExecutiveAnalytics> {
  let casesQuery = supabase.from('cases')
    .select('id, organization_id, case_number, court_name, district, section, case_status, case_type, advocate_status, next_hearing_date, last_hearing_date, assigned_advocate_name, sensitivity, cla_party_status, nature_of_disposal, follow_up_status, created_at, updated_at')
    .range(0, PAGE);
  const scopedFilter = orgOrLegacyFilter(orgId);
  if (scopedFilter) casesQuery = casesQuery.or(scopedFilter);

  const [casesRes, listingsRes, connRes, usageRes] = await Promise.all([
    casesQuery,
    (() => {
      let q = supabase.from('today_matched_listings')
        .select('court_hall, judge_name, listed_date, organization_id')
        .range(0, PAGE);
      if (scopedFilter) q = q.or(scopedFilter);
      return q;
    })(),
    supabase.from('case_connections').select('parent_case_id, connected_case_id').range(0, PAGE),
    (() => {
      let q = supabase.from('ecourts_api_usage').select('created_at, organization_id').range(0, PAGE);
      if (scopedFilter) q = q.or(scopedFilter);
      return q;
    })(),
  ]);

  const rawCases = (casesRes.data ?? []) as CaseRow[];
  const rawListings = (listingsRes.data ?? []) as ListingRow[];
  const usageRows = (usageRes.data ?? []) as Array<{ created_at: string | null; organization_id: string | null }>;

  const inDateRange = (iso: string | null | undefined) => {
    const d = String(iso ?? '').slice(0, 10);
    if (!d) return true;
    if (filters?.dateFrom && d < filters.dateFrom) return false;
    if (filters?.dateTo && d > filters.dateTo) return false;
    return true;
  };

  const cases = rawCases.filter(c => {
    const cType = (c.case_type ?? '').trim() || deriveCaseType(c.case_number) || '';
    return (!filters?.district || (c.district ?? '') === filters.district)
      && (!filters?.court || (c.court_name ?? '') === filters.court)
      && (!filters?.caseType || cType === filters.caseType)
      && (!filters?.caseStatus || (c.case_status ?? '') === filters.caseStatus)
      && (!filters?.advocate || (c.assigned_advocate_name ?? '') === filters.advocate)
      && inDateRange(c.created_at);
  });
  const caseIds = new Set(cases.map(c => c.id));
  const listings = rawListings.filter(l => inDateRange(l.listed_date));

  const filterMeta = {
    districts: Array.from(new Set(rawCases.map(c => (c.district ?? '').trim()).filter(Boolean))).sort(),
    courts: Array.from(new Set(rawCases.map(c => (c.court_name ?? '').trim()).filter(Boolean))).sort(),
    caseTypes: Array.from(new Set(rawCases.map(c => ((c.case_type ?? '').trim() || deriveCaseType(c.case_number) || '').trim()).filter(Boolean))).sort(),
    statuses: Array.from(new Set(rawCases.map(c => (c.case_status ?? '').trim()).filter(Boolean))).sort(),
    advocates: Array.from(new Set(rawCases.map(c => (c.assigned_advocate_name ?? '').trim()).filter(Boolean))).sort(),
    sections: Array.from(new Set(rawCases.map(c => (c.section ?? '').trim()).filter(Boolean))).sort(),
  };
  if (import.meta.env.DEV) {
    console.log('[Dashboard] executive-analytics', { orgId: orgId ?? null, scoped: !!scopedFilter, cases: cases.length, listings: listings.length });
  }
  const tasks = caseIds.size === 0
    ? []
    : ((await supabase.from('case_tasks')
      .select('id, case_id, task_title, task_status, due_date, assigned_to_name, created_at, completed_at')
      .in('case_id', Array.from(caseIds))
      .range(0, PAGE)).data ?? []) as TaskRow[];

  const aiRows = caseIds.size === 0
    ? []
    : ((await supabase.from('case_ai_analysis')
      .select('case_id, ai_json, generated_at')
      .in('case_id', Array.from(caseIds))
      .range(0, PAGE)).data ?? []) as Array<{ case_id: string; ai_json: Record<string, unknown> | null; generated_at: string | null }>;

  const connectedTotal = connRes.error
    ? 0
    : (connRes.data ?? []).filter(r => caseIds.has(r.parent_case_id as string) || caseIds.has(r.connected_case_id as string)).length;

  const now = new Date();
  const today = localIso(now);
  const in3 = localIso(addDays(now, 3));
  const in7 = localIso(addDays(now, 7));
  const in30 = localIso(addDays(now, 30));
  const weekAgo = localIso(addDays(now, -7));
  const thisMonth = today.slice(0, 7);

  const caseById = new Map(cases.map(c => [c.id, c]));

  // ── KPIs ──
  const isPending = (s: string | null) => (s ?? '').toLowerCase() === 'pending';
  const isDisposed = (s: string | null) => (s ?? '').toLowerCase() === 'disposed';
  const taskOpen = (t: TaskRow) => (t.task_status ?? '').toLowerCase() !== 'completed';
  const taskOverdue = (t: TaskRow) => taskOpen(t) && !!t.due_date && String(t.due_date) < today;

  // Advocate (internal) status predicates
  const advEq = (c: CaseRow, status: string) => (c.advocate_status ?? '') === status;
  const isReadyForHearing = (c: CaseRow) => advEq(c, 'Ready For Hearing');
  const isCounterPending = (c: CaseRow) => advEq(c, 'Counter Affidavit Pending');
  const isDocumentsAwaited = (c: CaseRow) => advEq(c, 'Documents Awaited');
  const isLegalOpinionPending = (c: CaseRow) => advEq(c, 'Legal Opinion Pending');
  const isCompliancePending = (c: CaseRow) => advEq(c, 'Order Compliance Pending');

  // Case-level classifications
  const isActive = (s: string | null) => (s ?? '').toLowerCase() === 'active';
  const isSensitive = (c: CaseRow) => (c.sensitivity ?? '').trim().toLowerCase() === 'sensitive';
  const isClaParty = (c: CaseRow) => !!(c.cla_party_status ?? '').trim();

  const kpis: ExecKpis = {
    totalCases: cases.length,
    pendingCases: cases.filter(c => isPending(c.case_status)).length,
    disposedCases: cases.filter(c => isDisposed(c.case_status)).length,
    activeCases: cases.filter(c => isActive(c.case_status)).length,
    sensitiveCases: cases.filter(isSensitive).length,
    claPartyCases: cases.filter(isClaParty).length,
    casesListedToday: listings.filter(l => String(l.listed_date ?? '').slice(0, 10) === today).length,
    upcomingHearings30: cases.filter(c => c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30).length,
    openTasks: tasks.filter(taskOpen).length,
    overdueTasks: tasks.filter(taskOverdue).length,
    readyForHearing: cases.filter(isReadyForHearing).length,
    counterPending: cases.filter(isCounterPending).length,
    documentsAwaited: cases.filter(isDocumentsAwaited).length,
    legalOpinionPending: cases.filter(isLegalOpinionPending).length,
    compliancePending: cases.filter(isCompliancePending).length,
    connectedCases: connectedTotal,
    assignedAdvocates: new Set(cases.map(c => (c.assigned_advocate_name ?? '').trim()).filter(Boolean)).size,
    todaysCauseListMatches: listings.filter(l => String(l.listed_date ?? '').slice(0, 10) === today).length,
    apiCallsToday: usageRows.filter(r => String(r.created_at ?? '').slice(0, 10) === today).length,
    apiCreditsRemaining: 0,
    urgentHearings7: cases.filter(c => c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in7).length,
    updateRequired: cases.filter(c => (c.follow_up_status ?? '').trim() === 'Update Required').length,
    totalAdvocates: new Set(cases.map(c => (c.assigned_advocate_name ?? '').trim()).filter(Boolean)).size,
    avgDisposalDays: (() => {
      const disposed = cases.filter(c => isDisposed(c.case_status) && c.created_at && c.updated_at);
      if (!disposed.length) return 0;
      const total = disposed.reduce((s, c) => {
        const days = Math.max(0, (new Date(String(c.updated_at)).getTime() - new Date(String(c.created_at)).getTime()) / 86400000);
        return s + days;
      }, 0);
      return Math.round(total / disposed.length);
    })(),
    successRate: (() => {
      const disposed = cases.filter(c => isDisposed(c.case_status)).length;
      if (!disposed) return 0;
      const allowed = cases.filter(c => {
        const nd = (c.nature_of_disposal ?? '').toLowerCase();
        return nd.includes('allow') || nd.includes('partly allow');
      }).length;
      return Math.round((allowed / disposed) * 100);
    })(),
  };

  if (orgId) {
    const orgRes = await supabase.from('organizations').select('available_credits').eq('id', orgId).maybeSingle();
    kpis.apiCreditsRemaining = Number(orgRes.data?.available_credits ?? 0);
  }

  // ── Task lookups keyed by case ──
  const openTasksByCase = new Map<string, number>();
  tasks.forEach(t => {
    if (taskOpen(t)) openTasksByCase.set(t.case_id, (openTasksByCase.get(t.case_id) ?? 0) + 1);
  });

  // ── Districts ──
  const districtMap = new Map<string, DistrictLitigation>();
  const districtDetails: Record<string, DistrictDetail> = {};
  const districtReady = new Map<string, number>();
  const districtCounter = new Map<string, number>();
  const districtDocs = new Map<string, number>();
  const districtCompliance = new Map<string, number>();
  const districtActive = new Map<string, number>();
  const districtSensitiveM = new Map<string, number>();
  const districtAdvBreakdown = new Map<string, Map<string, number>>();
  const districtSecBreakdown = new Map<string, Map<string, number>>();
  const districtPriority = new Map<string, { caseNumber: string | null; advocateStatus: string | null }[]>();
  const districtCaseList = new Map<string, { caseNumber: string | null; status: string | null; advocateStatus: string | null; sensitive: boolean }[]>();
  const incM = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const incNested = (m: Map<string, Map<string, number>>, k: string, sub: string) => {
    let inner = m.get(k);
    if (!inner) { inner = new Map(); m.set(k, inner); }
    inner.set(sub, (inner.get(sub) ?? 0) + 1);
  };
  const PRIORITY_STATUSES = new Set(['Counter Affidavit Pending', 'Documents Awaited', 'Order Compliance Pending', 'Ready For Hearing']);
  for (const c of cases) {
    const key = (c.district ?? '').trim() || 'Unspecified';
    let d = districtMap.get(key);
    if (!d) { d = { district: key, total: 0, pending: 0, disposed: 0 }; districtMap.set(key, d); }
    d.total += 1;
    if (isPending(c.case_status)) d.pending += 1;
    if (isDisposed(c.case_status)) d.disposed += 1;
    if (isActive(c.case_status)) incM(districtActive, key);
    if (isSensitive(c)) incM(districtSensitiveM, key);
    if (isReadyForHearing(c)) incM(districtReady, key);
    if (isCounterPending(c)) incM(districtCounter, key);
    if (isDocumentsAwaited(c)) incM(districtDocs, key);
    if (isCompliancePending(c)) incM(districtCompliance, key);
    const advName = (c.assigned_advocate_name ?? '').trim();
    if (advName) incNested(districtAdvBreakdown, key, advName);
    incNested(districtSecBreakdown, key, (c.section ?? '').trim() || 'Unspecified');
    const aStatus = (c.advocate_status ?? '').trim();
    if (aStatus && PRIORITY_STATUSES.has(aStatus)) {
      if (!districtPriority.has(key)) districtPriority.set(key, []);
      const list = districtPriority.get(key)!;
      if (list.length < 50) list.push({ caseNumber: c.case_number, advocateStatus: c.advocate_status });
    }
    if (!districtCaseList.has(key)) districtCaseList.set(key, []);
    districtCaseList.get(key)!.push({
      caseNumber: c.case_number,
      status: c.case_status,
      advocateStatus: c.advocate_status,
      sensitive: isSensitive(c),
    });
  }
  // District details (distinct advocates / upcoming hearings count + list / tasks)
  const districtAdvocates = new Map<string, Set<string>>();
  const districtUpcoming = new Map<string, number>();
  const districtUpcomingList = new Map<string, { caseNumber: string | null; hearingDate: string | null; advocateStatus: string | null; _d: string }[]>();
  for (const c of cases) {
    const key = (c.district ?? '').trim() || 'Unspecified';
    if (c.assigned_advocate_name) {
      if (!districtAdvocates.has(key)) districtAdvocates.set(key, new Set());
      districtAdvocates.get(key)!.add(c.assigned_advocate_name);
    }
    if (c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30) {
      incM(districtUpcoming, key);
      if (!districtUpcomingList.has(key)) districtUpcomingList.set(key, []);
      districtUpcomingList.get(key)!.push({
        caseNumber: c.case_number, hearingDate: c.next_hearing_date,
        advocateStatus: c.advocate_status, _d: String(c.next_hearing_date),
      });
    }
  }
  const districtOpenTasks = new Map<string, number>();
  const districtOverdueTasks = new Map<string, number>();
  for (const t of tasks) {
    const c = caseById.get(t.case_id);
    const key = (c?.district ?? '').trim() || 'Unspecified';
    if (taskOpen(t)) incM(districtOpenTasks, key);
    if (taskOverdue(t)) incM(districtOverdueTasks, key);
  }
  districtMap.forEach((d, key) => {
    const upList = (districtUpcomingList.get(key) ?? [])
      .sort((a, b) => a._d.localeCompare(b._d))
      .slice(0, 10)
      .map(({ caseNumber, hearingDate, advocateStatus }) => ({ caseNumber, hearingDate, advocateStatus }));
    districtDetails[key] = {
      district: key,
      total: d.total,
      pending: d.pending,
      disposed: d.disposed,
      active: districtActive.get(key) ?? 0,
      sensitive: districtSensitiveM.get(key) ?? 0,
      upcomingHearings: districtUpcoming.get(key) ?? 0,
      advocates: districtAdvocates.get(key)?.size ?? 0,
      openTasks: districtOpenTasks.get(key) ?? 0,
      overdueTasks: districtOverdueTasks.get(key) ?? 0,
      readyForHearing: districtReady.get(key) ?? 0,
      counterPending: districtCounter.get(key) ?? 0,
      documentsAwaited: districtDocs.get(key) ?? 0,
      compliancePending: districtCompliance.get(key) ?? 0,
      advocateBreakdown: Array.from(districtAdvBreakdown.get(key)?.entries() ?? [])
        .map(([advocate, cases]) => ({ advocate, cases }))
        .sort((a, b) => b.cases - a.cases),
      sectionBreakdown: Array.from(districtSecBreakdown.get(key)?.entries() ?? [])
        .map(([section, cases]) => ({ section, cases }))
        .sort((a, b) => b.cases - a.cases),
      upcomingHearingsList: upList,
      priorityCases: districtPriority.get(key) ?? [],
      caseList: districtCaseList.get(key) ?? [],
    };
  });
  const districts = Array.from(districtMap.values()).sort((a, b) => b.total - a.total);

  const courtMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.court_name ?? '').trim() || 'Unspecified';
    courtMap.set(key, (courtMap.get(key) ?? 0) + 1);
  }
  const courts = Array.from(courtMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // ── Sections ──
  const sectionMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.section ?? '').trim() || 'Unspecified';
    sectionMap.set(key, (sectionMap.get(key) ?? 0) + 1);
  }
  const sections = topN(sectionMap, 12);

  // ── Case types (derive a fallback for any row not yet backfilled) ──
  const caseTypeMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.case_type ?? '').trim() || deriveCaseType(c.case_number) || 'Unspecified';
    caseTypeMap.set(key, (caseTypeMap.get(key) ?? 0) + 1);
  }
  const caseTypes = Array.from(caseTypeMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // ── Advocate status distribution ──
  const advStatusMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.advocate_status ?? '').trim();
    if (!key) continue;
    advStatusMap.set(key, (advStatusMap.get(key) ?? 0) + 1);
  }
  const advocateStatusDistribution = Array.from(advStatusMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // ── Advocate performance (CASE-level only — never task assignee data) ──
  interface AdvAgg { assignedCases: number; hearings: number; upcoming: number; disposed: number; ready: number; docs: number; counter: number; }
  const advMap = new Map<string, AdvAgg>();
  const adv = (name: string): AdvAgg => {
    let a = advMap.get(name);
    if (!a) { a = { assignedCases: 0, hearings: 0, upcoming: 0, disposed: 0, ready: 0, docs: 0, counter: 0 }; advMap.set(name, a); }
    return a;
  };
  for (const c of cases) {
    const name = (c.assigned_advocate_name ?? '').trim();
    if (!name) continue;
    const a = adv(name);
    a.assignedCases += 1;
    if (isDisposed(c.case_status)) a.disposed += 1;
    if (c.next_hearing_date && String(c.next_hearing_date).slice(0, 7) === thisMonth) a.hearings += 1;
    if (c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30) a.upcoming += 1;
    if (isReadyForHearing(c)) a.ready += 1;
    if (isDocumentsAwaited(c)) a.docs += 1;
    if (isCounterPending(c)) a.counter += 1;
  }
  const advocates: AdvocatePerformance[] = Array.from(advMap.entries())
    .map(([advocate, a]) => ({
      advocate,
      assignedCases: a.assignedCases,
      readyForHearing: a.ready,
      documentsAwaited: a.docs,
      counterPending: a.counter,
      hearingsThisMonth: a.hearings,
      upcomingHearings: a.upcoming,
      disposedCases: a.disposed,
    }))
    .sort((x, y) => y.assignedCases - x.assignedCases);

  // Leaderboard: ranked purely on case work — assigned, disposed, then hearings.
  const leaderboard = [...advocates]
    .sort((x, y) =>
      y.assignedCases - x.assignedCases ||
      y.disposedCases - x.disposedCases ||
      y.hearingsThisMonth - x.hearingsThisMonth,
    )
    .slice(0, 10);

  // ── Task assignee performance (TASK-level — anyone: IAS, Tahsildar, clerk…) ──
  interface TaAgg { open: number; completed: number; overdue: number; total: number; }
  const taMap = new Map<string, TaAgg>();
  for (const t of tasks) {
    const name = (t.assigned_to_name ?? '').trim();
    if (!name) continue;
    let a = taMap.get(name);
    if (!a) { a = { open: 0, completed: 0, overdue: 0, total: 0 }; taMap.set(name, a); }
    a.total += 1;
    if ((t.task_status ?? '').toLowerCase() === 'completed') a.completed += 1;
    else a.open += 1;
    if (taskOverdue(t)) a.overdue += 1;
  }
  const taskAssignees: TaskAssigneePerformance[] = Array.from(taMap.entries())
    .map(([assignee, a]) => ({
      assignee,
      openTasks: a.open,
      completedTasks: a.completed,
      overdueTasks: a.overdue,
      totalTasks: a.total,
    }))
    .sort((x, y) => (y.openTasks + y.overdueTasks) - (x.openTasks + x.overdueTasks) || y.totalTasks - x.totalTasks);
  const taskProgress: TaskProgress = {
    open: tasks.filter(t => (t.task_status ?? '').toLowerCase() !== 'completed').length,
    completed: tasks.filter(t => (t.task_status ?? '').toLowerCase() === 'completed').length,
  };

  // ── Section → Advocate matrix (CASE-level: section + assigned advocate) ──
  const saMap = new Map<string, SectionAdvocateRow>();
  const saKey = (s: string, a: string) => `${s}|||${a}`;
  for (const c of cases) {
    const name = (c.assigned_advocate_name ?? '').trim();
    if (!name) continue;
    const section = (c.section ?? '').trim() || 'Unspecified';
    const key = saKey(section, name);
    let row = saMap.get(key);
    if (!row) { row = { section, advocate: name, assignedCases: 0 }; saMap.set(key, row); }
    row.assignedCases += 1;
  }
  const sectionAdvocates = Array.from(saMap.values())
    .sort((a, b) => b.assignedCases - a.assignedCases)
    .slice(0, 25);

  // ── Upcoming hearings requiring action (next 30 days) ──
  const upcomingHearings: UpcomingHearingRow[] = cases
    .filter(c => c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30)
    .sort((a, b) => String(a.next_hearing_date).localeCompare(String(b.next_hearing_date)))
    .slice(0, 50)
    .map(c => {
      const nh = String(c.next_hearing_date);
      const priority: 'High' | 'Medium' | 'Low' = nh <= in3 ? 'High' : nh <= in7 ? 'Medium' : 'Low';
      return {
        caseId: c.id,
        caseNumber: c.case_number,
        advocate: c.assigned_advocate_name,
        hearingDate: c.next_hearing_date,
        openTasks: openTasksByCase.get(c.id) ?? 0,
        status: c.case_status,
        advocateStatus: c.advocate_status,
        priority,
      };
    });

  // ── Overdue task tracker ──
  const overdueTasks: OverdueTaskRow[] = tasks
    .filter(taskOverdue)
    .map(t => {
      const c = caseById.get(t.case_id);
      const due = new Date(String(t.due_date));
      const days = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
      return {
        id: t.id,
        caseNumber: c?.case_number ?? null,
        task: t.task_title ?? '—',
        advocate: t.assigned_to_name || c?.assigned_advocate_name || null,
        assignedTo: t.assigned_to_name || null,
        dueDate: t.due_date,
        daysOverdue: days,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 50);

  // ── Daily cause list analytics ──
  const courtHallMap = new Map<string, number>();
  const judgeMap = new Map<string, number>();
  let listedThisWeek = 0;
  for (const l of listings) {
    const ld = String(l.listed_date ?? '').slice(0, 10);
    if (ld >= weekAgo && ld <= today) listedThisWeek += 1;
    if (l.court_hall) courtHallMap.set(l.court_hall, (courtHallMap.get(l.court_hall) ?? 0) + 1);
    if (l.judge_name) judgeMap.set(l.judge_name, (judgeMap.get(l.judge_name) ?? 0) + 1);
  }
  const causeList: CauseListAnalytics = {
    listedToday: kpis.casesListedToday,
    listedThisWeek,
    courtHalls: topN(courtHallMap, 10),
    judges: topN(judgeMap, 10),
  };

  // ── Litigation trend (last 12 months) ──
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(localIso(d).slice(0, 7));
  }
  const trendMap = new Map<string, TrendPoint>();
  months.forEach(m => {
    const d = new Date(`${m}-01T00:00:00`);
    trendMap.set(m, {
      month: m,
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      newCases: 0, casesDisposed: 0, hearings: 0, tasksCreated: 0, tasksCompleted: 0,
    });
  });
  for (const c of cases) {
    const m = monthKey(c.created_at);
    const pt = m ? trendMap.get(m) : null;
    if (pt) {
      pt.newCases += 1;
      if (isDisposed(c.case_status)) pt.casesDisposed += 1;
    }
  }
  for (const t of tasks) {
    const cm = monthKey(t.created_at);
    if (cm && trendMap.has(cm)) trendMap.get(cm)!.tasksCreated += 1;
    const dm = monthKey(t.completed_at);
    if (dm && trendMap.has(dm)) trendMap.get(dm)!.tasksCompleted += 1;
  }
  for (const l of listings) {
    const m = monthKey(l.listed_date);
    if (m && trendMap.has(m)) trendMap.get(m)!.hearings += 1;
  }
  const trend = months.map(m => trendMap.get(m)!);

  const apiDailyMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = localIso(addDays(now, -i));
    apiDailyMap.set(d, 0);
  }
  usageRows.forEach(r => {
    const d = String(r.created_at ?? '').slice(0, 10);
    if (apiDailyMap.has(d)) apiDailyMap.set(d, (apiDailyMap.get(d) ?? 0) + 1);
  });
  const apiDailyCalls: ApiDailyUsage[] = Array.from(apiDailyMap.entries()).map(([date, calls]) => ({ date, calls }));

  const orgCases: OrgCaseBreakdown[] = Array.from(rawCases.reduce((m, c) => {
    const key = c.organization_id ?? 'legacy';
    m.set(key, (m.get(key) ?? 0) + 1);
    return m;
  }, new Map<string, number>()).entries())
    .map(([organizationId, casesCount]) => ({ organizationId, label: organizationId === 'legacy' ? 'Legacy/Unassigned' : organizationId, cases: casesCount }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 12);

  const aiCases: AiCaseSnapshot[] = aiRows.map(row => {
    const c = caseById.get(row.case_id);
    const ai = (row.ai_json ?? {}) as Record<string, unknown>;
    const riskBlock = (ai.litigation_risk_assessment ?? ai.risk_assessment) as Record<string, unknown> | undefined;
    const risk = (riskBlock?.level as string | undefined) ?? 'Unknown';
    const updatedAt = c?.updated_at ? new Date(String(c.updated_at)).getTime() : 0;
    const createdAt = c?.created_at ? new Date(String(c.created_at)).getTime() : 0;
    const ageDays = createdAt > 0 ? Math.floor((now.getTime() - createdAt) / 86400000) : 0;
    const staleDays = updatedAt > 0 ? Math.floor((now.getTime() - updatedAt) / 86400000) : 9999;
    return {
      caseId: row.case_id,
      caseNumber: c?.case_number ?? null,
      advocate: c?.assigned_advocate_name ?? null,
      district: c?.district ?? null,
      riskLevel: (risk === 'Low' || risk === 'Medium' || risk === 'High' ? risk : 'Unknown'),
      immediateAttention: Boolean(ai.attention_required ?? (risk === 'High')),
      upcomingHearing: Boolean(ai.upcoming_hearing ?? (c?.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30)),
      noActivity: Boolean(ai.no_activity ?? (staleDays >= 30)),
      longPending: Boolean(ai.long_pending ?? (!isDisposed(c?.case_status ?? null) && ageDays >= 365)),
      generatedAt: row.generated_at ?? null,
    };
  });

  // ── Filing trend 24 months ──
  const months24: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months24.push(localIso(d).slice(0, 7));
  }
  const trend24Map = new Map<string, TrendPoint>();
  months24.forEach(m => {
    const d = new Date(`${m}-01T00:00:00`);
    trend24Map.set(m, { month: m, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), newCases: 0, casesDisposed: 0, hearings: 0, tasksCreated: 0, tasksCompleted: 0 });
  });
  for (const c of rawCases) {
    const m = monthKey(c.created_at);
    if (m && trend24Map.has(m)) { trend24Map.get(m)!.newCases += 1; if (isDisposed(c.case_status)) trend24Map.get(m)!.casesDisposed += 1; }
  }
  const filingTrend24 = months24.map(m => trend24Map.get(m)!);

  // ── Disposal distribution ──
  const disposalMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.nature_of_disposal ?? '').trim();
    if (key) disposalMap.set(key, (disposalMap.get(key) ?? 0) + 1);
  }
  const disposalDistribution = Array.from(disposalMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // ── Extended advocate performance (V2) ──
  const advV2Map = new Map<string, { assigned: number; pending: number; active: number; disposed: number; upcoming: number; ready: number; docs: number; counter: number; hearings: number; allowedDisposed: number; disposalDaysTotal: number; disposalCount: number }>();
  for (const c of cases) {
    const name = (c.assigned_advocate_name ?? '').trim();
    if (!name) continue;
    let a = advV2Map.get(name);
    if (!a) { a = { assigned: 0, pending: 0, active: 0, disposed: 0, upcoming: 0, ready: 0, docs: 0, counter: 0, hearings: 0, allowedDisposed: 0, disposalDaysTotal: 0, disposalCount: 0 }; advV2Map.set(name, a); }
    a.assigned += 1;
    if (isPending(c.case_status)) a.pending += 1;
    if (isActive(c.case_status)) a.active += 1;
    if (isDisposed(c.case_status)) {
      a.disposed += 1;
      const nd = (c.nature_of_disposal ?? '').toLowerCase();
      if (nd.includes('allow') || nd.includes('partly allow')) a.allowedDisposed += 1;
      if (c.created_at && c.updated_at) { const days = Math.max(0, (new Date(String(c.updated_at)).getTime() - new Date(String(c.created_at)).getTime()) / 86400000); a.disposalDaysTotal += days; a.disposalCount += 1; }
    }
    if (c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30) a.upcoming += 1;
    if (isReadyForHearing(c)) a.ready += 1;
    if (isDocumentsAwaited(c)) a.docs += 1;
    if (isCounterPending(c)) a.counter += 1;
    if (c.next_hearing_date && String(c.next_hearing_date).slice(0, 7) === thisMonth) a.hearings += 1;
  }
  const advocateV2: AdvocatePerformanceV2[] = Array.from(advV2Map.entries())
    .map(([advocate, a]) => ({
      advocate,
      assignedCases: a.assigned,
      pending: a.pending,
      active: a.active,
      disposedCases: a.disposed,
      upcomingHearings: a.upcoming,
      readyForHearing: a.ready,
      documentsAwaited: a.docs,
      counterPending: a.counter,
      hearingsThisMonth: a.hearings,
      successRate: a.disposed > 0 ? Math.round((a.allowedDisposed / a.disposed) * 100) : 0,
      avgDisposalDays: a.disposalCount > 0 ? Math.round(a.disposalDaysTotal / a.disposalCount) : 0,
    }))
    .sort((x, y) => y.assignedCases - x.assignedCases);

  // ── KPI sparklines (last 12 months) ──
  const kpiSparklines: Record<string, SparklinePoint[]> = {
    totalCases: trend.map(t => ({ month: t.label, value: t.newCases })),
    pending: trend.map(t => ({ month: t.label, value: t.newCases - t.casesDisposed })),
    disposed: trend.map(t => ({ month: t.label, value: t.casesDisposed })),
    hearings: trend.map(t => ({ month: t.label, value: t.hearings })),
    tasks: trend.map(t => ({ month: t.label, value: t.tasksCreated })),
  };

  // ── KPI trends (% change last vs prev month) ──
  const kpiTrends: Record<string, number> = {};
  if (trend.length >= 2) {
    const last = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    if (prev.newCases > 0) kpiTrends.totalCases = +((last.newCases - prev.newCases) / prev.newCases * 100).toFixed(1);
    if (prev.casesDisposed > 0) kpiTrends.disposed = +((last.casesDisposed - prev.casesDisposed) / prev.casesDisposed * 100).toFixed(1);
    if (prev.hearings > 0) kpiTrends.hearings = +((last.hearings - prev.hearings) / prev.hearings * 100).toFixed(1);
  }

  // ── Advocate × CaseType matrix ──
  const actMap = new Map<string, Map<string, number>>();
  for (const c of cases) {
    const adv = (c.assigned_advocate_name ?? '').trim();
    if (!adv) continue;
    const ct = ((c.case_type ?? '').trim() || deriveCaseType(c.case_number) || 'Other').trim();
    let inner = actMap.get(adv);
    if (!inner) { inner = new Map(); actMap.set(adv, inner); }
    inner.set(ct, (inner.get(ct) ?? 0) + 1);
  }
  const advocateCaseTypeMatrix: MatrixCell[] = [];
  actMap.forEach((ctMap, adv) => ctMap.forEach((count, ct) => advocateCaseTypeMatrix.push({ rowKey: adv, colKey: ct, count })));

  // ── Advocate × Section matrix ──
  const asmMap = new Map<string, Map<string, number>>();
  for (const c of cases) {
    const adv = (c.assigned_advocate_name ?? '').trim();
    if (!adv) continue;
    const sec = (c.section ?? '').trim() || 'Unspecified';
    let inner = asmMap.get(adv);
    if (!inner) { inner = new Map(); asmMap.set(adv, inner); }
    inner.set(sec, (inner.get(sec) ?? 0) + 1);
  }
  const advocateSectionMatrix: MatrixCell[] = [];
  asmMap.forEach((secMap, adv) => secMap.forEach((count, sec) => advocateSectionMatrix.push({ rowKey: adv, colKey: sec, count })));

  return {
    kpis,
    districts,
    districtDetails,
    sections,
    caseTypes,
    sectionAdvocates,
    advocates,
    leaderboard,
    taskAssignees,
    upcomingHearings,
    overdueTasks,
    connectedTotal,
    causeList,
    trend,
    advocateStatusDistribution,
    aiCases,
    courts,
    taskProgress,
    apiDailyCalls,
    orgCases,
    filterMeta,
    disposalDistribution,
    advocateV2,
    filingTrend24,
    kpiSparklines,
    kpiTrends,
    advocateCaseTypeMatrix,
    advocateSectionMatrix,
  };
}

