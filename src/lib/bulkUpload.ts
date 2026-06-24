import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { addConnection } from '@/lib/connections';

export type ExistingMode = 'update' | 'skip';

export interface BulkValidationIssue {
  sheet: SheetName;
  row: number;
  field: string;
  severity: 'error' | 'warning';
  message: string;
  value?: string;
}

export interface BulkPreviewCounts {
  cases: number;
  connectedCases: number;
  tasks: number;
  advocates: number;
  recipients: number;
}

export interface BulkPreview {
  fileName: string;
  generatedAt: string;
  counts: BulkPreviewCounts;
  issues: BulkValidationIssue[];
  data: BulkData;
}

export interface BulkImportResult {
  historyId: string | null;
  inserted: BulkPreviewCounts;
  updated: BulkPreviewCounts;
  skipped: BulkPreviewCounts;
  errors: BulkValidationIssue[];
  warnings: BulkValidationIssue[];
}

export type SheetName = 'Cases' | 'Connected Cases' | 'Tasks' | 'Advocates' | 'Notification Recipients';

export interface CaseSheetRow {
  rowNo: number;
  case_number: string;
  cnr_number: string | null;
  court_name: string | null;
  district: string | null;
  section: string | null;
  petitioner: string | null;
  respondent: string | null;
  case_status: string | null;
  next_hearing_date: string | null;
  assigned_advocate_name: string | null;
  assigned_advocate_email: string | null;
  assigned_advocate_mobile: string | null;
  cla_party_status: string | null;
  sensitivity: string | null;
  advocate_status: string | null;
  active: boolean;
}

export interface ConnectedCaseSheetRow {
  rowNo: number;
  parent_case_number: string;
  connected_case_number: string;
  relationship_type: string;
}

export interface TaskSheetRow {
  rowNo: number;
  case_number: string;
  task_title: string;
  task_description: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  assigned_to_mobile: string | null;
  due_date: string | null;
  priority: string;
  task_status: string;
}

export interface AdvocateSheetRow {
  rowNo: number;
  advocate_name: string;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  active: boolean;
}

export interface RecipientSheetRow {
  rowNo: number;
  name: string;
  email: string | null;
  mobile_number: string | null;
  whatsapp_number: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  notify_whatsapp: boolean;
  active: boolean;
}

export interface BulkData {
  cases: CaseSheetRow[];
  connectedCases: ConnectedCaseSheetRow[];
  tasks: TaskSheetRow[];
  advocates: AdvocateSheetRow[];
  recipients: RecipientSheetRow[];
}

const SHEETS: SheetName[] = ['Cases', 'Connected Cases', 'Tasks', 'Advocates', 'Notification Recipients'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOBILE_RE = /^\+?[0-9]{10,15}$/;

function clean(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function asNullable(v: unknown): string | null {
  const s = clean(v);
  return s || null;
}

function asBool(v: unknown, fallback = false): boolean {
  const s = clean(v).toLowerCase();
  if (!s) return fallback;
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function normalCaseNo(s: string): string {
  return clean(s).toUpperCase().replace(/\s+/g, '');
}

function nowIso(): string {
  return new Date().toISOString();
}

function pushIssue(
  out: BulkValidationIssue[],
  sheet: SheetName,
  row: number,
  field: string,
  severity: 'error' | 'warning',
  message: string,
  value?: string,
) {
  out.push({ sheet, row, field, severity, message, value });
}

function readSheetRows(workbook: XLSX.WorkBook, sheet: SheetName): Record<string, unknown>[] {
  const ws = workbook.Sheets[sheet];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const casesRows = [
    {
      case_number: 'WP/1234/2026',
      cnr_number: 'TNHC0012342026',
      court_name: 'Principal Bench of Madras High Court',
      district: 'Chennai',
      section: 'Civil',
      petitioner: 'ABC Corporation',
      respondent: 'State of Tamil Nadu',
      case_status: 'Pending',
      next_hearing_date: '2026-07-15',
      assigned_advocate_name: 'Ravi Kumar',
      assigned_advocate_email: 'ravi@example.com',
      assigned_advocate_mobile: '+919876543210',
      cla_party_status: 'Petitioner',
      sensitivity: 'Sensitive',
      advocate_status: 'Ready For Hearing',
      active: 'true',
    },
  ];

  const connectedRows = [
    {
      parent_case_number: 'WP/1234/2026',
      connected_case_number: 'WMP/222/2026',
      relationship_type: 'Connected',
    },
  ];

  const taskRows = [
    {
      case_number: 'WP/1234/2026',
      task_title: 'Prepare counter affidavit',
      task_description: 'Compile annexures and legal brief',
      assigned_to_name: 'Legal Assistant',
      assigned_to_email: 'assistant@example.com',
      assigned_to_mobile: '+919876500000',
      due_date: '2026-07-10',
      priority: 'High',
      task_status: 'Open',
    },
  ];

  const advocateRows = [
    {
      advocate_name: 'Ravi Kumar',
      email: 'ravi@example.com',
      mobile: '+919876543210',
      designation: 'Panel Advocate',
      active: 'true',
    },
  ];

  const recipientRows = [
    {
      name: 'Legal Head',
      email: 'legalhead@example.com',
      mobile_number: '+919812345678',
      whatsapp_number: '+919812345678',
      notify_email: 'true',
      notify_sms: 'false',
      notify_whatsapp: 'true',
      active: 'true',
    },
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(casesRows), 'Cases');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(connectedRows), 'Connected Cases');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskRows), 'Tasks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(advocateRows), 'Advocates');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recipientRows), 'Notification Recipients');

  return wb;
}

export function downloadTemplate(fileName = 'adalat360_bulk_upload_template.xlsx') {
  const wb = buildTemplateWorkbook();
  XLSX.writeFile(wb, fileName);
}

export function parseWorkbook(file: File): Promise<BulkPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const missing = SHEETS.filter(s => !wb.Sheets[s]);
        if (missing.length > 0) {
          reject(new Error(`Missing required sheet(s): ${missing.join(', ')}`));
          return;
        }

        const cases = readSheetRows(wb, 'Cases').map((r, i): CaseSheetRow => ({
          rowNo: i + 2,
          case_number: clean(r.case_number),
          cnr_number: asNullable(r.cnr_number),
          court_name: asNullable(r.court_name),
          district: asNullable(r.district),
          section: asNullable(r.section),
          petitioner: asNullable(r.petitioner),
          respondent: asNullable(r.respondent),
          case_status: asNullable(r.case_status),
          next_hearing_date: asNullable(r.next_hearing_date),
          assigned_advocate_name: asNullable(r.assigned_advocate_name),
          assigned_advocate_email: asNullable(r.assigned_advocate_email),
          assigned_advocate_mobile: asNullable(r.assigned_advocate_mobile),
          cla_party_status: asNullable(r.cla_party_status),
          sensitivity: asNullable(r.sensitivity),
          advocate_status: asNullable(r.advocate_status),
          active: asBool(r.active, true),
        })).filter(r => r.case_number || r.cnr_number || r.petitioner || r.respondent);

        const connectedCases = readSheetRows(wb, 'Connected Cases').map((r, i): ConnectedCaseSheetRow => ({
          rowNo: i + 2,
          parent_case_number: clean(r.parent_case_number),
          connected_case_number: clean(r.connected_case_number),
          relationship_type: clean(r.relationship_type) || 'Connected',
        })).filter(r => r.parent_case_number || r.connected_case_number);

        const tasks = readSheetRows(wb, 'Tasks').map((r, i): TaskSheetRow => ({
          rowNo: i + 2,
          case_number: clean(r.case_number),
          task_title: clean(r.task_title),
          task_description: asNullable(r.task_description),
          assigned_to_name: asNullable(r.assigned_to_name),
          assigned_to_email: asNullable(r.assigned_to_email),
          assigned_to_mobile: asNullable(r.assigned_to_mobile),
          due_date: asNullable(r.due_date),
          priority: clean(r.priority) || 'Medium',
          task_status: clean(r.task_status) || 'Open',
        })).filter(r => r.case_number || r.task_title);

        const advocates = readSheetRows(wb, 'Advocates').map((r, i): AdvocateSheetRow => ({
          rowNo: i + 2,
          advocate_name: clean(r.advocate_name),
          email: asNullable(r.email),
          mobile: asNullable(r.mobile),
          designation: asNullable(r.designation),
          active: asBool(r.active, true),
        })).filter(r => r.advocate_name || r.email || r.mobile);

        const recipients = readSheetRows(wb, 'Notification Recipients').map((r, i): RecipientSheetRow => ({
          rowNo: i + 2,
          name: clean(r.name),
          email: asNullable(r.email),
          mobile_number: asNullable(r.mobile_number),
          whatsapp_number: asNullable(r.whatsapp_number),
          notify_email: asBool(r.notify_email, true),
          notify_sms: asBool(r.notify_sms, false),
          notify_whatsapp: asBool(r.notify_whatsapp, false),
          active: asBool(r.active, true),
        })).filter(r => r.name || r.email || r.mobile_number || r.whatsapp_number);

        const data: BulkData = { cases, connectedCases, tasks, advocates, recipients };
        const issues = validateParsedData(data);
        const counts: BulkPreviewCounts = {
          cases: cases.length,
          connectedCases: connectedCases.length,
          tasks: tasks.length,
          advocates: advocates.length,
          recipients: recipients.length,
        };

        resolve({
          fileName: file.name,
          generatedAt: nowIso(),
          counts,
          issues,
          data,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse workbook'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read uploaded file'));
    reader.readAsArrayBuffer(file);
  });
}

export function validateParsedData(data: BulkData): BulkValidationIssue[] {
  const issues: BulkValidationIssue[] = [];

  const cnrSeen = new Set<string>();
  data.cases.forEach(r => {
    if (!r.case_number) {
      pushIssue(issues, 'Cases', r.rowNo, 'case_number', 'error', 'Case Number is mandatory.');
    }
    if (r.cnr_number) {
      const key = r.cnr_number.toUpperCase();
      if (cnrSeen.has(key)) {
        pushIssue(issues, 'Cases', r.rowNo, 'cnr_number', 'error', 'Duplicate CNR found in upload file.', r.cnr_number);
      } else {
        cnrSeen.add(key);
      }
    }
    if (r.assigned_advocate_email && !EMAIL_RE.test(r.assigned_advocate_email)) {
      pushIssue(issues, 'Cases', r.rowNo, 'assigned_advocate_email', 'error', 'Invalid email format.', r.assigned_advocate_email);
    }
    if (r.assigned_advocate_mobile && !MOBILE_RE.test(r.assigned_advocate_mobile)) {
      pushIssue(issues, 'Cases', r.rowNo, 'assigned_advocate_mobile', 'error', 'Invalid mobile format.', r.assigned_advocate_mobile);
    }
  });

  data.advocates.forEach(r => {
    if (!r.advocate_name) {
      pushIssue(issues, 'Advocates', r.rowNo, 'advocate_name', 'error', 'Advocate Name is mandatory.');
    }
    if (r.email && !EMAIL_RE.test(r.email)) {
      pushIssue(issues, 'Advocates', r.rowNo, 'email', 'error', 'Invalid email format.', r.email);
    }
    if (r.mobile && !MOBILE_RE.test(r.mobile)) {
      pushIssue(issues, 'Advocates', r.rowNo, 'mobile', 'error', 'Invalid mobile format.', r.mobile);
    }
  });

  data.recipients.forEach(r => {
    if (!r.name) {
      pushIssue(issues, 'Notification Recipients', r.rowNo, 'name', 'error', 'Recipient Name is mandatory.');
    }
    if (r.email && !EMAIL_RE.test(r.email)) {
      pushIssue(issues, 'Notification Recipients', r.rowNo, 'email', 'error', 'Invalid email format.', r.email);
    }
    if (r.mobile_number && !MOBILE_RE.test(r.mobile_number)) {
      pushIssue(issues, 'Notification Recipients', r.rowNo, 'mobile_number', 'error', 'Invalid mobile format.', r.mobile_number);
    }
    if (r.whatsapp_number && !MOBILE_RE.test(r.whatsapp_number)) {
      pushIssue(issues, 'Notification Recipients', r.rowNo, 'whatsapp_number', 'error', 'Invalid mobile format.', r.whatsapp_number);
    }
  });

  data.tasks.forEach(r => {
    if (!r.case_number) {
      pushIssue(issues, 'Tasks', r.rowNo, 'case_number', 'error', 'Case Number is mandatory for task rows.');
    }
    if (!r.task_title) {
      pushIssue(issues, 'Tasks', r.rowNo, 'task_title', 'error', 'Task Title is mandatory.');
    }
    if (r.assigned_to_email && !EMAIL_RE.test(r.assigned_to_email)) {
      pushIssue(issues, 'Tasks', r.rowNo, 'assigned_to_email', 'error', 'Invalid email format.', r.assigned_to_email);
    }
    if (r.assigned_to_mobile && !MOBILE_RE.test(r.assigned_to_mobile)) {
      pushIssue(issues, 'Tasks', r.rowNo, 'assigned_to_mobile', 'error', 'Invalid mobile format.', r.assigned_to_mobile);
    }
  });

  data.connectedCases.forEach(r => {
    if (!r.parent_case_number) {
      pushIssue(issues, 'Connected Cases', r.rowNo, 'parent_case_number', 'error', 'Parent Case Number is mandatory.');
    }
    if (!r.connected_case_number) {
      pushIssue(issues, 'Connected Cases', r.rowNo, 'connected_case_number', 'error', 'Connected Case Number is mandatory.');
    }
  });

  return issues;
}

export function downloadErrorReport(preview: BulkPreview, fileName = 'adalat360_bulk_upload_errors.xlsx') {
  const wb = XLSX.utils.book_new();
  const rows = preview.issues.map(i => ({
    sheet: i.sheet,
    row: i.row,
    field: i.field,
    severity: i.severity,
    message: i.message,
    value: i.value ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Errors and Warnings');
  XLSX.writeFile(wb, fileName);
}

async function loadExistingCasesForOrg(orgId: string) {
  const { data, error } = await supabase
    .from('cases')
    .select('id, case_number, cnr_number, organization_id')
    .or(`organization_id.eq.${orgId},organization_id.is.null`)
    .range(0, 49999);
  if (error) throw new Error(error.message);

  const byCase = new Map<string, { id: string; org: string | null }>();
  const byCnr = new Map<string, { id: string; org: string | null }>();

  (data ?? []).forEach((r: Record<string, unknown>) => {
    const id = clean(r.id);
    const caseNo = normalCaseNo(clean(r.case_number));
    const cnr = clean(r.cnr_number).toUpperCase();
    const org = asNullable(r.organization_id);
    if (caseNo) byCase.set(caseNo, { id, org });
    if (cnr) byCnr.set(cnr, { id, org });
  });

  return { byCase, byCnr };
}

async function loadExistingAdvocatesForOrg(orgId: string) {
  let q = supabase
    .from('advocates')
    .select('id, advocate_name, email, mobile, organization_id')
    .or(`organization_id.eq.${orgId},organization_id.is.null`)
    .range(0, 49999);

  let data: Array<Record<string, unknown>> | null = null;
  let error: { message?: string } | null = null;
  {
    const res = await q;
    data = (res.data ?? null) as Array<Record<string, unknown>> | null;
    error = res.error as { message?: string } | null;
  }

  // Backward compatibility where organization_id may not exist yet.
  if (error?.message?.toLowerCase().includes('organization_id')) {
    const fallback = await supabase
      .from('advocates')
      .select('id, advocate_name, email, mobile')
      .range(0, 49999);
    data = (fallback.data ?? null) as Array<Record<string, unknown>> | null;
    error = fallback.error as { message?: string } | null;
  }

  if (error) throw new Error(error.message);

  const byName = new Map<string, string>();
  (data ?? []).forEach((r: Record<string, unknown>) => {
    const n = clean(r.advocate_name).toLowerCase();
    if (n) byName.set(n, clean(r.id));
  });
  return byName;
}

async function insertImportHistory(orgId: string, uploadedBy: string, mode: ExistingMode, preview: BulkPreview, status: string, summary: Record<string, unknown>, errorText?: string | null): Promise<string | null> {
  try {
    const payload = {
      organization_id: orgId,
      uploaded_by: uploadedBy,
      file_name: preview.fileName,
      import_mode: mode,
      preview_counts: preview.counts,
      issue_count: preview.issues.length,
      status,
      summary,
      error_text: errorText ?? null,
      created_at: nowIso(),
    };

    const { data, error } = await supabase
      .from('bulk_upload_history')
      .insert(payload)
      .select('id')
      .single();
    if (error) return null;
    return clean((data as Record<string, unknown>)?.id);
  } catch {
    return null;
  }
}

export async function runBulkImport(args: {
  orgId: string;
  uploadedBy: string;
  mode: ExistingMode;
  preview: BulkPreview;
}): Promise<BulkImportResult> {
  const { orgId, uploadedBy, mode, preview } = args;
  const inserted: BulkPreviewCounts = { cases: 0, connectedCases: 0, tasks: 0, advocates: 0, recipients: 0 };
  const updated: BulkPreviewCounts = { cases: 0, connectedCases: 0, tasks: 0, advocates: 0, recipients: 0 };
  const skipped: BulkPreviewCounts = { cases: 0, connectedCases: 0, tasks: 0, advocates: 0, recipients: 0 };
  const errors: BulkValidationIssue[] = [];
  const warnings: BulkValidationIssue[] = [];

  const hardErrors = preview.issues.filter(i => i.severity === 'error');
  if (hardErrors.length > 0) {
    return {
      historyId: null,
      inserted,
      updated,
      skipped,
      errors: hardErrors,
      warnings: preview.issues.filter(i => i.severity === 'warning'),
    };
  }

  try {
    const existingCases = await loadExistingCasesForOrg(orgId);
    const existingAdvocates = await loadExistingAdvocatesForOrg(orgId);

    const importedCaseByNo = new Map<string, string>();

    // CASES
    for (const row of preview.data.cases) {
      const keyCase = normalCaseNo(row.case_number);
      const keyCnr = clean(row.cnr_number).toUpperCase();
      const foundByCase = existingCases.byCase.get(keyCase);
      const foundByCnr = keyCnr ? existingCases.byCnr.get(keyCnr) : undefined;
      const found = foundByCase ?? foundByCnr;

      if (found && found.org && found.org !== orgId) {
        errors.push({
          sheet: 'Cases',
          row: row.rowNo,
          field: 'case_number',
          severity: 'error',
          message: 'Organization isolation violation: matching case belongs to another organization.',
          value: row.case_number,
        });
        continue;
      }

      const payload: Record<string, unknown> = {
        organization_id: orgId,
        case_number: row.case_number,
        cnr_number: row.cnr_number,
        court_name: row.court_name ?? 'Principal Bench of Madras High Court',
        district: row.district,
        section: row.section,
        petitioner: row.petitioner,
        respondent: row.respondent,
        case_status: row.case_status,
        next_hearing_date: row.next_hearing_date,
        assigned_advocate_name: row.assigned_advocate_name,
        assigned_advocate_email: row.assigned_advocate_email,
        assigned_advocate_mobile: row.assigned_advocate_mobile,
        cla_party_status: row.cla_party_status,
        sensitivity: row.sensitivity,
        advocate_status: row.advocate_status,
        active: row.active,
        updated_at: nowIso(),
      };

      if (found) {
        if (mode === 'skip') {
          skipped.cases += 1;
          importedCaseByNo.set(keyCase, found.id);
          continue;
        }

        const { error } = await supabase.from('cases').update(payload).eq('id', found.id);
        if (error) {
          errors.push({ sheet: 'Cases', row: row.rowNo, field: 'case_number', severity: 'error', message: error.message, value: row.case_number });
        } else {
          updated.cases += 1;
          importedCaseByNo.set(keyCase, found.id);
        }
      } else {
        const { data, error } = await supabase.from('cases').insert({ ...payload, created_at: nowIso() }).select('id').single();
        if (error) {
          errors.push({ sheet: 'Cases', row: row.rowNo, field: 'case_number', severity: 'error', message: error.message, value: row.case_number });
        } else {
          inserted.cases += 1;
          importedCaseByNo.set(keyCase, clean((data as Record<string, unknown>)?.id));
        }
      }
    }

    // Refresh case index after inserts/updates for downstream sheets.
    const refreshedCases = await loadExistingCasesForOrg(orgId);

    // ADVOCATES
    for (const row of preview.data.advocates) {
      const key = row.advocate_name.toLowerCase();
      const existing = existingAdvocates.get(key);

      if (existing) {
        if (mode === 'skip') {
          skipped.advocates += 1;
          continue;
        }

        const updatePayload: Record<string, unknown> = {
          advocate_name: row.advocate_name,
          email: row.email,
          mobile: row.mobile,
          designation: row.designation,
          active: row.active,
        };
        const { error } = await supabase.from('advocates').update(updatePayload).eq('id', existing);
        if (error) {
          errors.push({ sheet: 'Advocates', row: row.rowNo, field: 'advocate_name', severity: 'error', message: error.message, value: row.advocate_name });
        } else {
          updated.advocates += 1;
        }
      } else {
        const insertPayload: Record<string, unknown> = {
          advocate_name: row.advocate_name,
          email: row.email,
          mobile: row.mobile,
          designation: row.designation,
          active: row.active,
          created_at: nowIso(),
        };
        // Add organization_id if the DB supports it; ignore if not.
        const withOrg = { ...insertPayload, organization_id: orgId };
        const insertedRes = await supabase.from('advocates').insert(withOrg);
        if (insertedRes.error?.message?.toLowerCase().includes('organization_id')) {
          const fallbackRes = await supabase.from('advocates').insert(insertPayload);
          if (fallbackRes.error) {
            errors.push({ sheet: 'Advocates', row: row.rowNo, field: 'advocate_name', severity: 'error', message: fallbackRes.error.message, value: row.advocate_name });
          } else {
            inserted.advocates += 1;
          }
        } else if (insertedRes.error) {
          errors.push({ sheet: 'Advocates', row: row.rowNo, field: 'advocate_name', severity: 'error', message: insertedRes.error.message, value: row.advocate_name });
        } else {
          inserted.advocates += 1;
        }
      }
    }

    // TASKS
    for (const row of preview.data.tasks) {
      const caseKey = normalCaseNo(row.case_number);
      const caseRef = importedCaseByNo.get(caseKey) ? { id: importedCaseByNo.get(caseKey) as string, org: orgId } : refreshedCases.byCase.get(caseKey);
      if (!caseRef) {
        errors.push({ sheet: 'Tasks', row: row.rowNo, field: 'case_number', severity: 'error', message: 'Referenced case does not exist.', value: row.case_number });
        continue;
      }
      if (caseRef.org && caseRef.org !== orgId) {
        errors.push({ sheet: 'Tasks', row: row.rowNo, field: 'case_number', severity: 'error', message: 'Organization isolation violation for case reference.', value: row.case_number });
        continue;
      }

      const payload = {
        case_id: caseRef.id,
        task_title: row.task_title,
        task_description: row.task_description,
        assigned_to_name: row.assigned_to_name,
        assigned_to_email: row.assigned_to_email,
        assigned_to_mobile: row.assigned_to_mobile,
        due_date: row.due_date,
        priority: row.priority,
        task_status: row.task_status,
        created_by: uploadedBy,
        created_at: nowIso(),
        email_notification_status: 'Pending',
      };
      const { error } = await supabase.from('case_tasks').insert(payload);
      if (error) {
        errors.push({ sheet: 'Tasks', row: row.rowNo, field: 'task_title', severity: 'error', message: error.message, value: row.task_title });
      } else {
        inserted.tasks += 1;
      }
    }

    // NOTIFICATION RECIPIENTS
    for (const row of preview.data.recipients) {
      const payload = {
        organization_id: orgId,
        name: row.name,
        email: row.email,
        mobile_number: row.mobile_number,
        whatsapp_number: row.whatsapp_number,
        notify_email: row.notify_email,
        notify_sms: row.notify_sms,
        notify_whatsapp: row.notify_whatsapp,
        active: row.active,
        updated_at: nowIso(),
      };

      const { data: existing, error: findErr } = await supabase
        .from('system_notification_recipients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', row.name)
        .maybeSingle();

      if (findErr) {
        errors.push({ sheet: 'Notification Recipients', row: row.rowNo, field: 'name', severity: 'error', message: findErr.message, value: row.name });
        continue;
      }

      if (existing?.id) {
        if (mode === 'skip') {
          skipped.recipients += 1;
          continue;
        }
        const { error } = await supabase.from('system_notification_recipients').update(payload).eq('id', existing.id);
        if (error) {
          errors.push({ sheet: 'Notification Recipients', row: row.rowNo, field: 'name', severity: 'error', message: error.message, value: row.name });
        } else {
          updated.recipients += 1;
        }
      } else {
        const { error } = await supabase.from('system_notification_recipients').insert(payload);
        if (error) {
          errors.push({ sheet: 'Notification Recipients', row: row.rowNo, field: 'name', severity: 'error', message: error.message, value: row.name });
        } else {
          inserted.recipients += 1;
        }
      }
    }

    // CONNECTED CASES
    for (const row of preview.data.connectedCases) {
      const pKey = normalCaseNo(row.parent_case_number);
      const cKey = normalCaseNo(row.connected_case_number);

      const pRef = importedCaseByNo.get(pKey) ? { id: importedCaseByNo.get(pKey) as string, org: orgId } : refreshedCases.byCase.get(pKey);
      const cRef = importedCaseByNo.get(cKey) ? { id: importedCaseByNo.get(cKey) as string, org: orgId } : refreshedCases.byCase.get(cKey);

      if (!pRef || !cRef) {
        errors.push({
          sheet: 'Connected Cases',
          row: row.rowNo,
          field: 'parent_case_number',
          severity: 'error',
          message: 'Connected cases must exist before mapping.',
          value: `${row.parent_case_number} -> ${row.connected_case_number}`,
        });
        continue;
      }

      if ((pRef.org && pRef.org !== orgId) || (cRef.org && cRef.org !== orgId)) {
        errors.push({
          sheet: 'Connected Cases',
          row: row.rowNo,
          field: 'parent_case_number',
          severity: 'error',
          message: 'Organization isolation violation for connected case mapping.',
          value: `${row.parent_case_number} -> ${row.connected_case_number}`,
        });
        continue;
      }

      try {
        await addConnection(pRef.id, cRef.id, row.relationship_type || 'Connected', orgId);
        inserted.connectedCases += 1;
      } catch (err) {
        // Duplicate connections are non-fatal and tracked as skipped in skip mode.
        const msg = err instanceof Error ? err.message : 'Unable to create connected case mapping.';
        if (msg.toLowerCase().includes('already connected') || msg.toLowerCase().includes('duplicate')) {
          skipped.connectedCases += 1;
          warnings.push({
            sheet: 'Connected Cases',
            row: row.rowNo,
            field: 'parent_case_number',
            severity: 'warning',
            message: msg,
            value: `${row.parent_case_number} -> ${row.connected_case_number}`,
          });
        } else {
          errors.push({
            sheet: 'Connected Cases',
            row: row.rowNo,
            field: 'parent_case_number',
            severity: 'error',
            message: msg,
            value: `${row.parent_case_number} -> ${row.connected_case_number}`,
          });
        }
      }
    }

    const historyId = await insertImportHistory(
      orgId,
      uploadedBy,
      mode,
      preview,
      errors.length > 0 ? 'completed_with_errors' : 'completed',
      { inserted, updated, skipped, warnings: warnings.length, errors: errors.length },
      errors.length > 0 ? 'Some rows failed during import. See error report.' : null,
    );

    return {
      historyId,
      inserted,
      updated,
      skipped,
      errors,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk import failed.';
    const historyId = await insertImportHistory(
      orgId,
      uploadedBy,
      mode,
      preview,
      'failed',
      { inserted, updated, skipped, warnings: warnings.length, errors: errors.length },
      message,
    );

    return {
      historyId,
      inserted,
      updated,
      skipped,
      errors: [...errors, { sheet: 'Cases', row: 0, field: 'system', severity: 'error', message }],
      warnings,
    };
  }
}

export async function fetchImportHistory(orgId: string) {
  const { data, error } = await supabase
    .from('bulk_upload_history')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}
