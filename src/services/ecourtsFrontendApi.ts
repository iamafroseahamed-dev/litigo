export const CASE_TYPE_IDS: Record<string, number> = {
  WP: 49,
  WMP: 133,
  WA: 48,
  WAMP: 132,
  WPMP: 134,
  CRP: 15,
  CMP: 113,
  CMA: 2,
  HCP: 22,
  'CONT P': 9,
  OP: 119,
  OSA: 120,
};

const ECOURTS_PROXY_BASE = '/hcservices-proxy';

export type EcourtsSession = {
  sessionId: string;
  jsession: string;
};

export type EcourtsSearchResult = {
  ecourtsCaseNo: string;
  cnrNumber: string;
  raw: unknown;
};

export type EcourtsCaseDetails = {
  overview: {
    caseNumber: string;
    cnrNumber: string;
    petitioner: string;
    respondent: string;
    judge: string;
    courtHall: string;
    stage: string;
    caseStatus: string;
    nextHearingDate: string;
  };
  hearings: Array<{ date: string; purpose: string; stage: string; remarks: string }>;
  orders: Array<{ orderDate: string; orderNumber: string; downloadUrl: string }>;
  rawResponse: {
    text: string;
    summaryFields: Record<string, string>;
  };
};

export class EcourtsError extends Error {
  code: 'INVALID_CAPTCHA' | 'CASE_NOT_FOUND' | 'UNABLE_TO_FETCH_HISTORY' | 'SESSION_EXPIRED' | 'UNKNOWN';

  constructor(code: EcourtsError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function clean(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseCaseNumber(caseNumber: string): { caseType: string; caseNo: string; caseYear: string } {
  const [rawType, rawNo, rawYear] = caseNumber.replace(/\s+/g, '').toUpperCase().split('/');
  const caseType = (rawType ?? '').replace(/\./g, ' ').replace(/_/g, ' ').trim();
  const caseNo = (rawNo ?? '').replace(/\D/g, '');
  const caseYear = (rawYear ?? '').replace(/\D/g, '');

  if (!caseType || !caseNo || !caseYear) {
    throw new EcourtsError('UNKNOWN', 'Invalid case number format. Use TYPE/NUMBER/YEAR.');
  }

  return { caseType, caseNo, caseYear };
}

function resolveCaseTypeId(caseType: string): number {
  const normalized = caseType.toUpperCase().replace(/\s+/g, ' ');
  const direct = CASE_TYPE_IDS[normalized];
  if (direct) return direct;

  const compact = normalized.replace(/\s+/g, '');
  const fromCompact = CASE_TYPE_IDS[compact];
  if (fromCompact) return fromCompact;

  if (compact === 'CONTP') return CASE_TYPE_IDS['CONT P'];

  throw new EcourtsError('UNKNOWN', `Unsupported case type: ${caseType}`);
}

function parseCookiesFromDocument(): EcourtsSession {
  const map = new Map<string, string>();
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.split('=');
    if (!k) continue;
    map.set(k.trim(), rest.join('=').trim());
  }

  return {
    sessionId: map.get('HCSERVICES_SESSID') ?? '',
    jsession: map.get('JSESSION') ?? map.get('JSESSIONID') ?? '',
  };
}

function normalizeRelativeUrl(href: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return `${ECOURTS_PROXY_BASE}${href}`;
  return `${ECOURTS_PROXY_BASE}/${href}`;
}

export async function createEcourtsSession(): Promise<EcourtsSession> {
  // Step 1: touch root to initialize upstream session cookies.
  const rootResp = await fetch(`${ECOURTS_PROXY_BASE}/`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!rootResp.ok) {
    throw new EcourtsError('SESSION_EXPIRED', 'Session Expired');
  }

  // Step 2: load main page; captcha endpoint depends on this flow.
  const mainResp = await fetch(`${ECOURTS_PROXY_BASE}/hcservices/main.php?v=1`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Referer: `${ECOURTS_PROXY_BASE}/`,
    },
  });
  if (!mainResp.ok) {
    throw new EcourtsError('SESSION_EXPIRED', 'Session Expired');
  }

  return parseCookiesFromDocument();
}

export async function loadEcourtsCaptcha(): Promise<string> {
  const random = Math.floor(Math.random() * 1000);
  const resp = await fetch(
    `${ECOURTS_PROXY_BASE}/hcservices/securimage/securimage_show.php?${random}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    throw new EcourtsError('SESSION_EXPIRED', 'Session Expired');
  }

  const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('image')) {
    const text = await resp.text();
    const lower = text.toLowerCase();
    if (lower.includes('session') || lower.includes('expire') || lower.includes('captcha')) {
      throw new EcourtsError('SESSION_EXPIRED', 'Session Expired');
    }
    throw new EcourtsError('UNKNOWN', 'Unable to load captcha image');
  }

  const blob = await resp.blob();
  if (!blob.size) {
    throw new EcourtsError('UNKNOWN', 'Unable to load captcha image');
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new EcourtsError('UNKNOWN', 'Unable to load captcha image'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });

  return dataUrl;
}

export async function searchEcourtsCase(args: {
  caseNumber: string;
  captcha: string;
}): Promise<EcourtsSearchResult> {
  const { caseType, caseNo, caseYear } = parseCaseNumber(args.caseNumber);
  const caseTypeId = resolveCaseTypeId(caseType);

  const body = new URLSearchParams({
    court_code: '1',
    state_code: '10',
    court_complex_code: '1',
    caseStatusSearchType: 'COcaseNumber',
    captcha: args.captcha,
    case_type_order: String(caseTypeId),
    case_no_order: caseNo,
    rgyearCaseOrder: caseYear,
  });

  const resp = await fetch(
    `${ECOURTS_PROXY_BASE}/hcservices/cases_qry/index_qry.php?action_code=showRecords`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  const text = await resp.text();
  const lower = text.toLowerCase();

  if (!resp.ok) {
    throw new EcourtsError('UNKNOWN', 'Unable to search case details.');
  }

  if (
    lower.includes('captcha') &&
    (lower.includes('invalid') || lower.includes('incorrect') || lower.includes('wrong'))
  ) {
    throw new EcourtsError('INVALID_CAPTCHA', 'Invalid Captcha');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.con)
    ? parsed.con
    : Array.isArray(parsed?.results)
    ? parsed.results
    : [];

  const first = rows[0] ?? null;
  const ecourtsCaseNo = clean(first?.case_no);
  const cnrNumber = clean(first?.cino ?? first?.cnr_number).toUpperCase();

  if (!ecourtsCaseNo || !cnrNumber) {
    throw new EcourtsError('CASE_NOT_FOUND', 'Case Not Found');
  }

  return {
    ecourtsCaseNo,
    cnrNumber,
    raw: parsed ?? text,
  };
}

function getSummaryFields(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};

  doc.querySelectorAll('table tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent));
    if (cells.length >= 2 && cells.length % 2 === 0) {
      for (let i = 0; i < cells.length; i += 2) {
        const key = cells[i];
        const value = cells[i + 1];
        if (key && value && key !== value) out[key] = value;
      }
    }
  });

  return out;
}

function parseHearings(doc: Document): Array<{ date: string; purpose: string; stage: string; remarks: string }> {
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,strong,b,p')).map((el) => clean(el.textContent));
  const tables = Array.from(doc.querySelectorAll('table'));

  let hearingTable: HTMLTableElement | null = null;
  for (let i = 0; i < tables.length; i += 1) {
    const title = headings[i] ?? '';
    if (title.toLowerCase().includes('history of case hearing')) {
      hearingTable = tables[i] as HTMLTableElement;
      break;
    }
  }

  if (!hearingTable) return [];

  const rows = Array.from(hearingTable.querySelectorAll('tr'));
  const out: Array<{ date: string; purpose: string; stage: string; remarks: string }> = [];

  for (const row of rows) {
    const cols = Array.from(row.querySelectorAll('td')).map((c) => clean(c.textContent));
    if (cols.length < 2) continue;

    out.push({
      date: cols[3] ?? cols[0] ?? '',
      purpose: cols[4] ?? cols[1] ?? '',
      stage: cols[0] ?? cols[2] ?? '',
      remarks: cols[5] ?? cols[3] ?? '',
    });
  }

  return out.filter((h) => h.date || h.purpose || h.stage || h.remarks);
}

function parseOrders(doc: Document): Array<{ orderDate: string; orderNumber: string; downloadUrl: string }> {
  const out: Array<{ orderDate: string; orderNumber: string; downloadUrl: string }> = [];

  const orderAnchors = Array.from(doc.querySelectorAll('a[href]')).filter((a) => {
    const t = clean(a.textContent).toLowerCase();
    const h = String(a.getAttribute('href') ?? '').toLowerCase();
    return t.includes('order') || t.includes('judgment') || h.includes('.pdf');
  });

  for (const a of orderAnchors) {
    const tr = a.closest('tr');
    const cols = tr ? Array.from(tr.querySelectorAll('td')).map((c) => clean(c.textContent)) : [];
    out.push({
      orderDate: cols[0] ?? '',
      orderNumber: cols[1] ?? clean(a.textContent),
      downloadUrl: normalizeRelativeUrl(String(a.getAttribute('href') ?? '')),
    });
  }

  return out;
}

export async function fetchEcourtsCaseHistory(args: {
  caseNumber: string;
  ecourtsCaseNo: string;
  cnrNumber: string;
}): Promise<EcourtsCaseDetails> {
  const body = new URLSearchParams({
    court_code: '1',
    state_code: '10',
    court_complex_code: '1',
    case_no: args.ecourtsCaseNo,
    cino: args.cnrNumber,
    appFlag: '',
  });

  const resp = await fetch(`${ECOURTS_PROXY_BASE}/hcservices/cases_qry/o_civil_case_history.php`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await resp.text();
  const lower = text.toLowerCase();

  if (!resp.ok) {
    throw new EcourtsError('UNABLE_TO_FETCH_HISTORY', 'Unable To Fetch History');
  }

  if (lower.includes('session') && lower.includes('expire')) {
    throw new EcourtsError('SESSION_EXPIRED', 'Session Expired');
  }

  if (
    lower.includes('case not found') ||
    lower.includes('no records found') ||
    lower.includes('invalid cnr')
  ) {
    throw new EcourtsError('CASE_NOT_FOUND', 'Case Not Found');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const summaryFields = getSummaryFields(doc);

  const overview = {
    caseNumber: clean(summaryFields['Case Number'] ?? summaryFields['Registration Number'] ?? args.caseNumber),
    cnrNumber: clean(summaryFields['CNR Number'] ?? args.cnrNumber),
    petitioner: clean(summaryFields['Petitioner']),
    respondent: clean(summaryFields['Respondent']),
    judge: clean(summaryFields['Coram'] ?? summaryFields['Judge']),
    courtHall: clean(summaryFields['Court Hall'] ?? summaryFields['Court'] ?? summaryFields['Court No']),
    stage: clean(summaryFields['Stage of Case']),
    caseStatus: clean(summaryFields['Case Status']),
    nextHearingDate: clean(summaryFields['Next Date'] ?? summaryFields['Next Hearing Date']),
  };

  return {
    overview,
    hearings: parseHearings(doc),
    orders: parseOrders(doc),
    rawResponse: {
      text,
      summaryFields,
    },
  };
}
