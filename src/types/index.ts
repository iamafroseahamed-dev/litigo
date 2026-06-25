export interface Organization {
  id: string;
  organization_name: string;
  short_name?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_mobile?: string | null;
  plan_name?: string | null;
  trial_credits?: number | null;
  available_credits?: number | null;
  active: boolean;
  created_at: string;
  // Legacy fields populated by the auth profile join.
  email?: string | null;
  mobile?: string | null;
}

export interface EcourtsApiPricing {
  endpoint_name: string;
  credits_per_call: number | null;
  amount_per_call: number | null;
}

export interface EcourtsApiUsage {
  id: string;
  organization_id: string | null;
  case_id: string | null;
  endpoint_name: string | null;
  credits_used: number | null;
  request_id: string | null;
  cnr_number: string | null;
  created_at: string;
}

export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'advocate' | 'viewer' | 'user';

export interface Profile {
  id: string;
  user_id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
  // User Management (migration 017)
  last_login_at?: string | null;
  email_notifications?: boolean;
  notify_hearing_reminder?: boolean;
  notify_task_assignment?: boolean;
  notify_daily_cause_list?: boolean;
  notify_case_assignment?: boolean;
  updated_at?: string | null;
  organization?: Organization;
}

export type CLAPartyStatus = 'Petitioner' | 'Respondent' | 'Appellant' | 'Defendant' | 'Complainant' | 'Accused' | '';
export type Sensitivity = 'Sensitive' | 'Non-Sensitive' | '';
export type CaseStatus = 'Active' | 'Pending' | 'Disposed' | '';
export type FollowUpStatus = 'Urgent' | 'Update Required' | 'No Action' | 'Inactive' | '';

export interface Case {
  id: string;
  organization_id: string;
  cnr_number: string | null;
  case_number: string;
  court_name: string | null;
  district: string | null;
  section: string | null;
  petitioner: string | null;
  respondent: string | null;
  prayer: string | null;
  subject_matter: string | null;
  cla_party_status: string | null;
  sensitivity: string | null;
  case_status: string | null;
  nature_of_disposal: string | null;
  last_hearing_date: string | null;
  last_hearing_update: string | null;
  next_hearing_date: string | null;
  advocate_name: string | null;
  advocate_mobile: string | null;
  advocate_email: string | null;
  client_name: string | null;
  client_mobile: string | null;
  client_whatsapp: string | null;
  client_email: string | null;
  follow_up_status: string | null;
  active: boolean;
  source_file: string | null;
  source_sheet: string | null;
  import_batch: string | null;
  case_section: string | null;
  followup_status: string | null;
  // Advocate (internal) activity status — distinct from court case_status
  // (requires advocate_status.sql)
  advocate_status?: string | null;
  // Case assignment (requires case_management.sql)
  assigned_advocate_name?: string | null;
  assigned_advocate_email?: string | null;
  assigned_advocate_mobile?: string | null;
  assigned_on?: string | null;
  // Connected / parent-child cases (requires connected_cases.sql)
  parent_case_id?: string | null;
  // eCourts discovery (set after first captcha lookup — requires migration 005)
  ecourts_case_no?: string | null;
  cnr_discovered_at?: string | null;
  // eCourts Case Details cache (Layer 3 — requires add_case_details_cache.sql)
  case_details_json?: Record<string, unknown> | null;
  case_details_synced_at?: string | null;
  ecourts_request_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseStatusHistory {
  id: string;
  case_id: string;
  old_status: string | null;
  new_status: string | null;
  remarks: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface AiActionPlanItem {
  step: string;
  priority: 'High' | 'Medium' | 'Low';
  owner: string;
}

export interface AiCaseAnalysisJson {
  // 1. Executive Legal Summary — senior-advocate narrative of the matter.
  executive_legal_summary: string;
  // 2. Litigation Risk Assessment.
  litigation_risk_assessment: {
    level: 'Low' | 'Medium' | 'High';
    rationale: string;
    key_risk_factors: string[];
  };
  // 3. Hearing Trend Analysis.
  hearing_trend_analysis: {
    pattern: string;
    adjournment_concerns: string;
    observations: string[];
  };
  // 4. Department Impact Analysis.
  department_impact_analysis: {
    summary: string;
    financial_exposure: string;
    policy_or_operational_impact: string;
  };
  // 5. Advocate Recommendations.
  advocate_recommendations: string[];
  // 6. Missing Information / Missing Documents.
  missing_information: string[];
  // 7. Next Hearing Preparation Checklist.
  next_hearing_preparation_checklist: string[];
  // 8. Strategic Recommendations.
  strategic_recommendations: string[];
  // 9. Similar Case Risk Indicators.
  similar_case_risk_indicators: string[];
  // 10. AI Generated Action Plan.
  ai_action_plan: AiActionPlanItem[];

  // Dashboard signal flags (mirrors litigation_risk_assessment for analytics).
  risk_assessment: {
    level: 'Low' | 'Medium' | 'High';
    reason: string;
  };
  attention_required: boolean;
  no_activity: boolean;
  long_pending: boolean;
  upcoming_hearing: boolean;
}

export interface ParsedOrderRecord {
  order_date: string | null;
  order_type: string | null;
  judge: string | null;
  pdf_url: string | null;
  summary: string | null;
}

export interface CaseAiAnalysis {
  id: string;
  case_id: string;
  cnr_number: string | null;
  case_hash: string | null;
  ai_summary: string | null;
  ai_json: AiCaseAnalysisJson | null;
  parsed_orders: ParsedOrderRecord[] | null;
  parsed_orders_at: string | null;
  model: string | null;
  generated_at: string;
  generated_by: string | null;
  last_accessed_at: string;
}

export interface CauseList {
  id: string;
  cause_date: string;
  court_name: string;
  bench: string | null;
  court_no: string | null;
  judge_name: string | null;
  item_number: number | null;
  case_number: string;
  cnr_number: string | null;
  petitioner: string | null;
  respondent: string | null;
  section?: string | null;
  district?: string | null;
  status: string | null;
  raw_response?: object;
  created_at: string;
}

export interface CauseListMatch {
  id: string;
  organization_id: string;
  case_id: string;
  cause_list_id: string;
  match_type: 'cnr' | 'case_number' | 'fuzzy';
  match_confidence: number;
  matched_on: string;
  alert_required: boolean;
  created_at: string;
  prayer?: string | null;
  last_hearing?: string | null;
  posted_stage?: string | null;
  counsel_name?: string | null;
  raw_case_detail_response?: object;
  case?: Case;
  cause_list?: CauseList;
}

export type NotificationType = 'whatsapp' | 'sms' | 'email';
export type NotificationStatus = 'sent' | 'failed' | 'pending';

export interface Notification {
  id: string;
  organization_id: string;
  case_id: string;
  cause_list_match_id: string;
  notification_type: NotificationType;
  recipient: string;
  message: string;
  sent_time?: string;
  status: NotificationStatus;
  response?: string;
  retry_count: number;
  created_at: string;
  case?: Case;
}

// ── Notification Recipients (per case) ────────────────────────────────────────
export interface CaseNotificationRecipient {
  id: string;
  organization_id: string;
  case_id: string;
  recipient_name: string;
  recipient_role: string | null;
  email: string | null;
  mobile_number: string | null;
  whatsapp_number: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  notify_whatsapp: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Notification Log ──────────────────────────────────────────────────────────
export interface NotificationLog {
  id: string;
  organization_id: string | null;
  case_id: string | null;
  cause_list_id: string | null;
  cause_date: string | null;
  notification_type: string | null;
  recipient_name: string | null;
  recipient_role: string | null;
  recipient_email: string | null;
  recipient_mobile: string | null;
  recipient_whatsapp: string | null;
  subject: string | null;
  message: string | null;
  status: string | null; // 'sent' | 'failed' | 'pending'
  provider: string | null;
  provider_response: Record<string, unknown> | null;
  sent_at: string | null;
  created_at: string;
}

// Status shown per case in Today's Listings
export type CauseListNotifStatus =
  | 'not_notified'
  | 'notified'
  | 'partial'
  | 'failed'
  | 'no_recipients';

// ── Today's Matched Listings ──────────────────────────────────────────────────
// Populated by POST /api/match-todays-listings; read-only from the frontend.

export interface HearingEntry {
  date: string;
  business: string;
  stage: string;
  remarks: string;
}

export interface TodayMatchedListing {
  id: string;
  // listed_date = actual court cause-list date (migration 006+)
  listed_date: string;
  // match_date kept for backward compat (= listed_date)
  match_date: string;
  cause_list_import_date: string | null;
  match_created_at: string | null;
  organization_id: string | null;
  case_id: string;
  daily_cause_list_id: string;
  case_number: string | null;
  cnr_number: string | null;
  court_hall: string | null;
  item_number: string | null;
  judge_name: string | null;
  stage: string | null;
  vc_link: string | null;
  petitioner: string | null;
  respondent: string | null;
  match_type: string;
  match_status: string;
  notification_status: string;
  // eCourts enrichment fields (populated lazily, not during matching)
  latest_case_status: string | null;
  latest_stage: string | null;
  latest_hearing_date: string | null;
  latest_hearing_remarks: string | null;
  latest_business: string | null;
  next_hearing_date: string | null;
  last_order_date: string | null;
  last_order_number: string | null;
  last_order_type: string | null;
  hearing_history: HearingEntry[] | null;
  ecourts_last_synced: string | null;
  ecourts_sync_status: string | null;
  // CNR discovery tracking (migration 007)
  ecourts_case_no: string | null;
  cnr_status: string | null;      // 'discovered' | 'not_discovered' | 'failed'
  ecourts_error: string | null;
  ecourts_synced_at: string | null;  // actual column name in DB
  case_details_json?: Record<string, unknown> | null;
  case_details_last_fetched?: string | null;
  created_at: string;
  updated_at: string;
  // Joined via Supabase select('*, case:cases(*)')
  case?: Case;
}

export interface NotificationProvider {
  id: string;
  organization_id: string;
  provider_type: string; // 'email' | 'sms' | 'whatsapp'
  provider_name: string;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UploadedFile {
  id: string;
  organization_id: string;
  file_name: string;
  uploaded_by: string;
  total_records: number;
  success_count: number;
  failed_count: number;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface BulkUploadHistory {
  id: string;
  organization_id: string | null;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  file_name: string;
  import_mode: 'update_existing' | 'skip_existing';
  status: 'validated' | 'imported' | 'failed';
  total_records: number;
  success_count: number;
  error_count: number;
  warning_count: number;
  summary_json: Record<string, unknown> | null;
  error_report_json: Record<string, unknown>[] | null;
  created_at: string;
}

export interface CaseHearingHistory {
  id: string;
  organization_id: string;
  case_id: string;
  hearing_date: string;
  judge_name: string;
  court_no: string;
  stage: string;
  remarks: string;
  order_url?: string;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: Profile;
  organization: Organization;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface DashboardMetrics {
  totalActiveCases: number;
  totalCauseListToday: number;
  matchedCasesToday: number;
  unmatchedCasesToday: number;
  alertsGeneratedToday: number;
  failedAlerts: number;
  pendingAlerts: number;
  upcomingHearings: number;
}

export interface BulkUploadRow {
  rowNumber: number;
  data: Partial<Case>;
  errors: string[];
  status: 'success' | 'error' | 'duplicate';
}

export interface BulkUploadResult {
  total: number;
  success: number;
  failed: number;
  duplicates: number;
  rows: BulkUploadRow[];
}

export interface BulkImportIssue {
  sheet: string;
  rowNumber: number;
  severity: 'error' | 'warning';
  field?: string;
  message: string;
}

export interface BulkImportSummary {
  cases: number;
  connectedCases: number;
  tasks: number;
  advocates: number;
  notificationRecipients: number;
}

export interface BulkTemplateCaseRow {
  case_number: string;
  cnr_number?: string;
  court_name?: string;
  district?: string;
  section?: string;
  petitioner?: string;
  respondent?: string;
  case_status?: string;
  next_hearing_date?: string;
  advocate_status?: string;
  client_name?: string;
}

export interface BulkTemplateConnectedCaseRow {
  parent_case_number: string;
  connected_case_number: string;
  relationship_type?: string;
}

export interface BulkTemplateTaskRow {
  case_number: string;
  task_title: string;
  task_description?: string;
  assigned_to_name?: string;
  assigned_to_email?: string;
  assigned_to_mobile?: string;
  due_date?: string;
  related_hearing_date?: string;
  priority?: string;
}

export interface BulkTemplateAdvocateRow {
  advocate_name: string;
  email?: string;
  mobile?: string;
  designation?: string;
  active?: string | boolean;
}

export interface BulkTemplateNotificationRecipientRow {
  name: string;
  email?: string;
  mobile_number?: string;
  whatsapp_number?: string;
  notify_email?: string | boolean;
  notify_sms?: string | boolean;
  notify_whatsapp?: string | boolean;
  active?: string | boolean;
}

export interface CaseFilters {
  search?: string;
  court_name?: string;
  bench?: string;
  advocate_name?: string;
  client_name?: string;
  active?: boolean | null;
}

export interface NotificationFilters {
  notification_type?: NotificationType | '';
  status?: NotificationStatus | '';
}

export interface CauseListFilters {
  date?: string;
  court?: string;
  bench?: string;
  judge?: string;
  status?: string;
}

// ── Case Management — notes & tasks (requires case_management.sql) ─────────────
export interface CaseNote {
  id: string;
  case_id: string;
  note_text: string;
  created_by: string | null;
  created_at: string;
}

export type TaskStatus = 'Open' | 'In Progress' | 'Waiting' | 'Completed' | 'Cancelled';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type EmailNotificationStatus = 'Pending' | 'Sent' | 'Failed' | 'Skipped';

export interface Advocate {
  id: string;
  organization_id?: string | null;
  advocate_name: string;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  active: boolean;
  created_at: string;
}

export interface CaseTask {
  id: string;
  case_id: string;
  task_title: string;
  task_description: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  assigned_to_mobile: string | null;
  due_date: string | null;
  related_hearing_date: string | null;
  task_status: TaskStatus;
  priority: TaskPriority;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  email_notification_sent: boolean | null;
  email_notification_sent_at: string | null;
  email_notification_status: EmailNotificationStatus | null;
}

// ── Connected cases (requires connected_cases.sql) ─────────────────────────
export type RelationshipType =
  | 'Connected' | 'WMP' | 'Appeal' | 'Review' | 'Contempt'
  | 'Interim Application' | 'Transfer' | 'Related Matter';

export interface CaseConnection {
  id: string;
  parent_case_id: string;
  connected_case_id: string;
  relationship_type: string;
  created_at: string;
}

// A connection resolved to the "other" case relative to the case being viewed.
export interface ConnectedCaseRow {
  connectionId: string;
  relationship_type: string;
  case: {
    id: string;
    case_number: string | null;
    court_name: string | null;
    case_status: string | null;
    next_hearing_date: string | null;
  };
}
