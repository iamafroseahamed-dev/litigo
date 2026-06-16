export interface Organization {
  id: string;
  organization_name: string;
  contact_person: string;
  email: string;
  mobile: string;
  active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'advocate' | 'user';
  active: boolean;
  created_at: string;
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
  created_at: string;
  updated_at: string;
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
