const ECOURTS_PROXY_BASE = '/hcservices-proxy';

const TEST_CASE_NUMBER = 'WP/16207/2026';
const TEST_CASE_TYPE_ORDER = '49';
const TEST_CASE_NO_ORDER = '16207';
const TEST_CASE_YEAR_ORDER = '2026';

export type EcourtsCaptchaChallenge = {
  caseNumber: string;
  captchaImage: string;
};

export type EcourtsOrderRecord = {
  caseNo: string;
  cino: string;
  orderUrlPath: string;
  registrationNumber: string;
  registrationYear: string;
  typeName: string;
  orderDate: string;
  orderNumber: string;
  documentType: string;
  pdfUrl: string;
};

export type EcourtsCaseDetails = {
  caseNumber: string;
  cnrNumber: string;
  caseStatus: string;
  nextHearingDate: string;
  judgeName: string;
  courtNumber: string;
  filingNumber: string;
  registrationNumber: string;
};

export type EcourtsParties = {
  petitioner: string;
  respondent: string;
  petitionerAdvocate: string;
  respondentAdvocate: string;
};

export type EcourtsHearingRecord = {
  hearingDate: string;
  purpose: string;
  stage: string;
  remarks: string;
};

export type EcourtsParsedCaseHistory = {
  caseDetails: EcourtsCaseDetails;
  parties: EcourtsParties;
  hearingHistory: EcourtsHearingRecord[];
  orders: EcourtsOrderRecord[];
  rawHtml: string;
};

export type EcourtsShowRecordsResult = {
  parsedCaseHistory: EcourtsParsedCaseHistory;
};

export class EcourtsError extends Error {
  code: 'INVALID_CAPTCHA' | 'SESSION_EXPIRED' | 'UNKNOWN';

  constructor(code: EcourtsError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function clean(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function buildPdfUrl(record: {
  orderurlpath: string;
  type_name: string;
  reg_no: string | number;
  reg_year: string | number;
  cino: string;
}): string {
  const orderUrlPath = clean(record.orderurlpath);
  const caseNo = `${clean(record.type_name)}/${clean(record.reg_no)}/${clean(record.reg_year)}`;
  const cino = clean(record.cino);

  return (
    'https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php' +
    `?filename=${orderUrlPath}` +
    `&caseno=${caseNo}` +
    '&cCode=1' +
    '&appFlag=web' +
    '&normal_v=1' +
    `&cino=${cino}` +
    '&state_code=10' +
    '&flag=nojudgement'
  );
}

function hasOrderFields(value: Record<string, unknown>): boolean {
  return [
    'case_no',
    'cino',
    'orderurlpath',
    'reg_no',
    'reg_year',
    'type_name',
  ].some((key) => clean(value[key]).length > 0);
}

function parseConRecords(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseConRecords(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseConRecords(entry));
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (hasOrderFields(record)) {
      return [record];
    }

    return Object.values(record).flatMap((entry) => parseConRecords(entry));
  }

  return [];
}

function headingKey(value: string): string {
  return clean(value).toLowerCase();
}

function buildHeadingTableMap(doc: Document): Map<string, HTMLTableElement> {
  const map = new Map<string, HTMLTableElement>();
  let currentHeading = '';

  for (const el of Array.from(doc.querySelectorAll('h1,h2,h3,h4,table'))) {
    if (el instanceof HTMLTableElement) {
      const key = headingKey(currentHeading);
      if (key && !map.has(key)) {
        map.set(key, el);
      }
    } else {
      const text = clean(el.textContent);
      if (text) {
        currentHeading = text;
      }
    }
  }

  return map;
}

function tableHeaders(table: HTMLTableElement): string[] {
  const firstRow = table.querySelector('tr');
  if (!firstRow) return [];
  const headers = Array.from(firstRow.querySelectorAll('th')).map((cell) => clean(cell.textContent));
  return headers.filter(Boolean);
}

function tableRows(table: HTMLTableElement, skipHeader = true): string[][] {
  const headers = tableHeaders(table);
  const rows = Array.from(table.querySelectorAll('tr'));
  const startIndex = skipHeader && headers.length > 0 ? 1 : 0;

  return rows.slice(startIndex)
    .map((row) => Array.from(row.querySelectorAll('td')).map((cell) => clean(cell.textContent)))
    .filter((row) => row.some(Boolean));
}

function flat4ColToPairs(table: HTMLTableElement): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const values = Array.from(row.querySelectorAll('th,td'))
      .map((cell) => clean(cell.textContent))
      .filter(Boolean);

    if (values.length >= 4) {
      pairs.push([values[0], values[1] ?? '']);
      pairs.push([values[2], values[3] ?? '']);
    } else if (values.length === 2) {
      pairs.push([values[0], values[1]]);
    } else if (values.length === 1) {
      pairs.push([values[0], '']);
    }
  }

  return pairs.filter(([label, value]) => Boolean(label || value));
}

function setSummaryPairs(summary: Record<string, string>, pairs: Array<[string, string]>): void {
  for (const [label, value] of pairs) {
    if (label && value) {
      summary[label] = value;
    }
  }
}

function summaryValue(summary: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const match = Object.keys(summary).find((candidate) => headingKey(candidate) === headingKey(key));
    if (match && clean(summary[match])) {
      return clean(summary[match]);
    }
  }
  return '';
}

function parsePartySpan(span: Element | null): { name: string; advocate: string } {
  if (!span) {
    return { name: '', advocate: '' };
  }

  const lines = clean(span.textContent)
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean);

  let currentName = '';
  let currentAdvocate = '';
  for (const line of lines) {
    if (/^\d+\)/.test(line)) {
      if (!currentName) {
        currentName = line.replace(/^\d+\)\s*/, '').trim();
      }
      continue;
    }
    if (/advocate-/i.test(line)) {
      currentAdvocate = line.replace(/(?i)advocate-\s*/, '').trim();
      continue;
    }
    if (!currentName) {
      currentName = line;
    }
  }

  return { name: currentName, advocate: currentAdvocate };
}

function headerIndex(headers: string[], keywords: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = headingKey(headers[index] ?? '');
    if (keywords.some((keyword) => header.includes(headingKey(keyword)))) {
      return index;
    }
  }
  return -1;
}

function rowValue(row: string[], index: number): string {
  return index >= 0 ? clean(row[index]) : '';
}

function parseCaseHistoryHtml(html: string, fallbackOrder: EcourtsOrderRecord): EcourtsParsedCaseHistory {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const headingToTable = buildHeadingTableMap(doc);
  const summary: Record<string, string> = {};

  const caseDetailsTable = headingToTable.get('case details');
  if (caseDetailsTable) {
    setSummaryPairs(summary, flat4ColToPairs(caseDetailsTable));
  }

  const caseStatusTable = headingToTable.get('case status');
  if (caseStatusTable) {
    setSummaryPairs(summary, flat4ColToPairs(caseStatusTable));
  }

  const petitioner = parsePartySpan(doc.querySelector('span.Petitioner_Advocate_table'));
  const respondent = parsePartySpan(doc.querySelector('span.Respondent_Advocate_table'));

  const caseDetails: EcourtsCaseDetails = {
    caseNumber:
      summaryValue(summary, ['Case Number', 'Registration Number']) ||
      `${fallbackOrder.typeName}/${fallbackOrder.registrationNumber}/${fallbackOrder.registrationYear}`,
    cnrNumber: summaryValue(summary, ['CNR Number']) || fallbackOrder.cino,
    caseStatus: summaryValue(summary, ['Case Status', 'Status']),
    nextHearingDate: summaryValue(summary, ['Next Hearing Date', 'Next Date']),
    judgeName: summaryValue(summary, ['Judge', 'Coram', 'Judge Name']),
    courtNumber: summaryValue(summary, ['Court Number', 'Court No', 'Court Hall']),
    filingNumber: summaryValue(summary, ['Filing Number']),
    registrationNumber: summaryValue(summary, ['Registration Number']) || fallbackOrder.registrationNumber,
  };

  const parties: EcourtsParties = {
    petitioner: petitioner.name,
    respondent: respondent.name,
    petitionerAdvocate: petitioner.advocate,
    respondentAdvocate: respondent.advocate,
  };

  const hearingHistory: EcourtsHearingRecord[] = [];
  const hearingTable = headingToTable.get('history of case hearing');
  if (hearingTable) {
    const headers = tableHeaders(hearingTable);
    const rows = tableRows(hearingTable, headers.length > 0);
    const dateIndex = headerIndex(headers, ['Hearing Date', 'Date']);
    const purposeIndex = headerIndex(headers, ['Purpose']);
    const stageIndex = headerIndex(headers, ['Stage', 'Cause List Type']);
    const judgeIndex = headerIndex(headers, ['Judge']);
    const businessIndex = headerIndex(headers, ['Business On Date']);
    const remarksIndex = headerIndex(headers, ['Remarks']);

    for (const row of rows) {
      const remarksParts = [rowValue(row, remarksIndex), rowValue(row, judgeIndex), rowValue(row, businessIndex)]
        .filter(Boolean);
      hearingHistory.push({
        hearingDate: rowValue(row, dateIndex) || clean(row[3]),
        purpose: rowValue(row, purposeIndex) || clean(row[4]),
        stage: rowValue(row, stageIndex) || clean(row[0]),
        remarks: remarksParts.join(' | '),
      });
    }
  }

  const orders: EcourtsOrderRecord[] = [];
  const ordersTable = headingToTable.get('orders');
  if (ordersTable) {
    const headers = tableHeaders(ordersTable);
    const bodyRows = Array.from(ordersTable.querySelectorAll('tr'));
    const startIndex = headers.length > 0 ? 1 : 0;

    for (const row of bodyRows.slice(startIndex)) {
      const cells = Array.from(row.querySelectorAll('td,th')).map((cell) => clean(cell.textContent));
      if (!cells.some(Boolean)) continue;

      const anchor = row.querySelector('a[href]');
      const href = anchor?.getAttribute('href') ?? '';
      const absoluteHref = href ? new URL(href, 'https://hcservices.ecourts.gov.in/hcservices/').toString() : '';
      const absoluteUrl = absoluteHref ? new URL(absoluteHref) : null;
      const orderUrlPath = clean(absoluteUrl?.searchParams.get('filename'));
      const orderNumber = rowValue(cells, headerIndex(headers, ['Order Number', 'Order No'])) || clean(cells[0]);
      const orderDate = rowValue(cells, headerIndex(headers, ['Order Date', 'Order On', 'Date'])) || clean(cells[cells.length - 1]);
      const orderType = rowValue(cells, headerIndex(headers, ['Type', 'Document Type', 'Details'])) || clean(anchor?.textContent) || fallbackOrder.documentType;

      if (!orderUrlPath && !orderNumber && !orderDate && !orderType) {
        continue;
      }

      const pdfUrl = orderUrlPath
        ? buildPdfUrl({
            orderurlpath: orderUrlPath,
            type_name: fallbackOrder.typeName,
            reg_no: fallbackOrder.registrationNumber,
            reg_year: fallbackOrder.registrationYear,
            cino: caseDetails.cnrNumber || fallbackOrder.cino,
          })
        : absoluteHref;

      orders.push({
        caseNo: fallbackOrder.caseNo,
        cino: caseDetails.cnrNumber || fallbackOrder.cino,
        orderUrlPath,
        registrationNumber: fallbackOrder.registrationNumber,
        registrationYear: fallbackOrder.registrationYear,
        typeName: fallbackOrder.typeName,
        orderDate,
        orderNumber,
        documentType: orderType,
        pdfUrl,
      });
    }
  }

  const parsedData: EcourtsParsedCaseHistory = {
    caseDetails,
    parties,
    hearingHistory,
    orders,
    rawHtml: html,
  };

  console.log('CASE DETAILS', caseDetails);
  console.log('HEARINGS', hearingHistory);
  console.log('ORDERS', orders);
  console.log(parsedData);

  return parsedData;
}

function mapOrderRecord(record: Record<string, unknown>): EcourtsOrderRecord {
  const orderUrlPath = clean(record.orderurlpath);
  const typeName = clean(record.type_name);
  const registrationNumber = clean(record.reg_no);
  const registrationYear = clean(record.reg_year);
  const cino = clean(record.cino);

  if (!orderUrlPath || !typeName || !registrationNumber || !registrationYear || !cino) {
    console.error('ORDER DATA MISSING REQUIRED FIELDS');
    console.error(record);
    throw new EcourtsError('UNKNOWN', 'showRecords returned an unexpected order shape');
  }

  const pdfUrl = buildPdfUrl({
    orderurlpath: orderUrlPath,
    type_name: typeName,
    reg_no: registrationNumber,
    reg_year: registrationYear,
    cino,
  });

  console.log('ORDER DATA');
  console.log(record);
  console.log('PDF URL');
  console.log(pdfUrl);

  return {
    caseNo: clean(record.case_no),
    cino,
    orderUrlPath,
    registrationNumber,
    registrationYear,
    typeName,
    orderDate: clean(record.order_dt),
    orderNumber: clean(record.order_no),
    documentType: clean(record.docu_name),
    pdfUrl,
  };
}

async function fetchCaseHistoryHtml(showRecord: EcourtsOrderRecord): Promise<string> {
  const payload = new URLSearchParams({
    court_code: '1',
    state_code: '10',
    court_complex_code: '1',
    case_no: showRecord.caseNo,
    cino: showRecord.cino,
    appFlag: '',
  });

  console.log('CASE HISTORY REQUEST');
  console.log(payload.toString());

  let response: Response;
  try {
    response = await fetch(
      `${ECOURTS_PROXY_BASE}/hcservices/cases_qry/o_civil_case_history.php`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: payload,
      },
    );
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Unable to fetch case history');
  }

  const responseText = await response.text();
  console.log('CASE HISTORY HTML');
  console.log(responseText);

  if (!response.ok) {
    console.error(responseText);
    throw new EcourtsError('UNKNOWN', 'Case history request failed');
  }

  return responseText;
}

async function responseToDataUrl(resp: Response): Promise<string> {
  const blob = await resp.blob();
  if (!blob.size) {
    throw new EcourtsError('UNKNOWN', 'Unable to load captcha image');
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new EcourtsError('UNKNOWN', 'Unable to load captcha image'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
}

async function bootstrapSession(): Promise<void> {
  const rootResp = await fetch(`${ECOURTS_PROXY_BASE}/`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!rootResp.ok) {
    throw new EcourtsError('SESSION_EXPIRED', 'Unable to initialize eCourts session');
  }

  const mainResp = await fetch(`${ECOURTS_PROXY_BASE}/hcservices/main.php?v=1`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Referer: `${ECOURTS_PROXY_BASE}/`,
    },
  });

  if (!mainResp.ok) {
    throw new EcourtsError('SESSION_EXPIRED', 'Unable to initialize eCourts session');
  }
}

export async function loadShowRecordsCaptcha(): Promise<EcourtsCaptchaChallenge> {
  await bootstrapSession();

  const random = Math.floor(Math.random() * 1_000_000);
  const resp = await fetch(
    `${ECOURTS_PROXY_BASE}/hcservices/securimage/securimage_show.php?${random}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        Referer: `${ECOURTS_PROXY_BASE}/hcservices/main.php?v=1`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error(errorText);
    throw new EcourtsError('SESSION_EXPIRED', 'Unable to load captcha image');
  }

  const contentType = clean(resp.headers.get('content-type')).toLowerCase();
  if (!contentType.includes('image')) {
    const errorText = await resp.text();
    console.error(errorText);
    throw new EcourtsError('UNKNOWN', 'Unable to load captcha image');
  }

  return {
    caseNumber: TEST_CASE_NUMBER,
    captchaImage: await responseToDataUrl(resp),
  };
}

export async function submitShowRecordsCaptcha(args: { captchaValue: string }): Promise<EcourtsShowRecordsResult> {
  const payload = new URLSearchParams({
    court_code: '1',
    state_code: '10',
    court_complex_code: '1',
    caseStatusSearchType: 'COcaseNumber',
    captcha: args.captchaValue,
    case_type_order: TEST_CASE_TYPE_ORDER,
    case_no_order: TEST_CASE_NO_ORDER,
    rgyearCaseOrder: TEST_CASE_YEAR_ORDER,
  });

  let response: Response;
  try {
    response = await fetch(
      `${ECOURTS_PROXY_BASE}/hcservices/cases_qry/index_qry.php?action_code=showRecords`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: 'https://hcservices.ecourts.gov.in',
          Referer: `${ECOURTS_PROXY_BASE}/hcservices/main.php?v=1`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: payload,
      },
    );
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Unable to submit showRecords request');
  }

  const responseText = await response.text();
  console.log('SHOW RECORDS RESPONSE');
  console.log(responseText);

  if (!response.ok) {
    console.error(responseText);
    throw new EcourtsError('UNKNOWN', 'showRecords request failed');
  }

  try {
    const data = JSON.parse(responseText);
    console.log(data);

    const records = parseConRecords(data?.con ?? data);
    if (records.length > 0) {
      console.log('PARSED RESULTS');
      console.log(records[0]);
      const orderRecords = records.map(mapOrderRecord);
      const caseHistoryHtml = await fetchCaseHistoryHtml(orderRecords[0]);
      const parsedCaseHistory = parseCaseHistoryHtml(caseHistoryHtml, orderRecords[0]);
      return { parsedCaseHistory };
    }

    throw new EcourtsError('UNKNOWN', 'No order data returned from showRecords');
  } catch (error) {
    console.error(error);
    if (error instanceof EcourtsError) {
      throw error;
    }
    throw new EcourtsError('UNKNOWN', 'Unable to parse showRecords response');
  }
}
