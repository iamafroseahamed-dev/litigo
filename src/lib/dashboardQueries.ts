import { supabase } from '@/lib/supabase';

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
  upcomingHearings: number;
  advocates: number;
  openTasks: number;
  overdueTasks: number;
  readyForHearing: number;
  counterPending: number;
  documentsAwaited: number;
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

export interface ExecutiveAnalytics {
  kpis: ExecKpis;
  districts: DistrictLitigation[];
  districtDetails: Record<string, DistrictDetail>;
  sections: CategoryCount[];
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
}

interface CaseRow {
  id: string;
  case_number: string | null;
  district: string | null;
  section: string | null;
  case_status: string | null;
  advocate_status: string | null;
  next_hearing_date: string | null;
  assigned_advocate_name: string | null;
  sensitivity: string | null;
  cla_party_status: string | null;
  created_at: string | null;
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

export async function fetchExecutiveAnalytics(): Promise<ExecutiveAnalytics> {
  const [casesRes, tasksRes, listingsRes, connRes] = await Promise.all([
    supabase.from('cases')
      .select('id, case_number, district, section, case_status, advocate_status, next_hearing_date, assigned_advocate_name, sensitivity, cla_party_status, created_at')
      .range(0, PAGE),
    supabase.from('case_tasks')
      .select('id, case_id, task_title, task_status, due_date, assigned_to_name, created_at, completed_at')
      .range(0, PAGE),
    supabase.from('today_matched_listings')
      .select('court_hall, judge_name, listed_date')
      .range(0, PAGE),
    supabase.from('case_connections').select('id').range(0, PAGE),
  ]);

  const cases = (casesRes.data ?? []) as CaseRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const listings = (listingsRes.data ?? []) as ListingRow[];
  const connectedTotal = connRes.error ? 0 : (connRes.data ?? []).length;

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
  };

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
  for (const c of cases) {
    const key = (c.district ?? '').trim() || 'Unspecified';
    let d = districtMap.get(key);
    if (!d) { d = { district: key, total: 0, pending: 0, disposed: 0 }; districtMap.set(key, d); }
    d.total += 1;
    if (isPending(c.case_status)) d.pending += 1;
    if (isDisposed(c.case_status)) d.disposed += 1;
    if (isReadyForHearing(c)) districtReady.set(key, (districtReady.get(key) ?? 0) + 1);
    if (isCounterPending(c)) districtCounter.set(key, (districtCounter.get(key) ?? 0) + 1);
    if (isDocumentsAwaited(c)) districtDocs.set(key, (districtDocs.get(key) ?? 0) + 1);
  }
  // District details (advocates / hearings / tasks)
  const districtAdvocates = new Map<string, Set<string>>();
  const districtUpcoming = new Map<string, number>();
  for (const c of cases) {
    const key = (c.district ?? '').trim() || 'Unspecified';
    if (c.assigned_advocate_name) {
      if (!districtAdvocates.has(key)) districtAdvocates.set(key, new Set());
      districtAdvocates.get(key)!.add(c.assigned_advocate_name);
    }
    if (c.next_hearing_date && String(c.next_hearing_date) >= today && String(c.next_hearing_date) <= in30) {
      districtUpcoming.set(key, (districtUpcoming.get(key) ?? 0) + 1);
    }
  }
  const districtOpenTasks = new Map<string, number>();
  const districtOverdueTasks = new Map<string, number>();
  for (const t of tasks) {
    const c = caseById.get(t.case_id);
    const key = (c?.district ?? '').trim() || 'Unspecified';
    if (taskOpen(t)) districtOpenTasks.set(key, (districtOpenTasks.get(key) ?? 0) + 1);
    if (taskOverdue(t)) districtOverdueTasks.set(key, (districtOverdueTasks.get(key) ?? 0) + 1);
  }
  districtMap.forEach((d, key) => {
    districtDetails[key] = {
      district: key,
      total: d.total,
      pending: d.pending,
      disposed: d.disposed,
      upcomingHearings: districtUpcoming.get(key) ?? 0,
      advocates: districtAdvocates.get(key)?.size ?? 0,
      openTasks: districtOpenTasks.get(key) ?? 0,
      overdueTasks: districtOverdueTasks.get(key) ?? 0,
      readyForHearing: districtReady.get(key) ?? 0,
      counterPending: districtCounter.get(key) ?? 0,
      documentsAwaited: districtDocs.get(key) ?? 0,
    };
  });
  const districts = Array.from(districtMap.values()).sort((a, b) => b.total - a.total);

  // ── Sections ──
  const sectionMap = new Map<string, number>();
  for (const c of cases) {
    const key = (c.section ?? '').trim() || 'Unspecified';
    sectionMap.set(key, (sectionMap.get(key) ?? 0) + 1);
  }
  const sections = topN(sectionMap, 12);

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

  return {
    kpis,
    districts,
    districtDetails,
    sections,
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
  };
}

