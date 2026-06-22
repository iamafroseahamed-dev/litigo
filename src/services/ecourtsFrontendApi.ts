const ECOURTS_API_BASE = '/api/ecourts';

const HC_CASE_TYPE_NUMERIC: Record<string, string> = {
  WP: '49',
  WA: '48',
  WMP: '133',
  WPMP: '134',
  WAMP: '132',
  WVMP: '135',
  WPCRL: '334',
  WPMPCRL: '346',
  CRLOP: '12',
  CRLA: '11',
  CRLRC: '13',
  CRLMC: '114',
  CRLMP: '114',
  CRLREF: '51',
  AS: '1',
  SA: '38',
  CMA: '2',
  CMSA: '5',
  LPA: '24',
  CRP: '15',
  CRPNPD: '16',
  CRPPD: '17',
  CMP: '113',
  OSA: '120',
  RFA: '1',
  OP: '119',
  OS: '19',
  CS: '19',
  OA: '117',
  OMS: '118',
  TC: '40',
  TCA: '41',
  TCP: '42',
  TCR: '43',
  TCMP: '126',
  HCP: '22',
  HCMP: '115',
  CONTP: '9',
  CONTPMD: '166',
  CONTA: '7',
  CONTAPP: '143',
  CP: '10',
  COMAPEL: '6',
  COMPA: '142',
  IP: '23',
  IA: '116',
  IC: '146',
  IN: '141',
  ELP: '144',
  EP: '145',
  REVAPLC: '32',
  REVAPLO: '122',
  REVAPLW: '34',
  REVAPPL: '35',
  REVPET: '123',
  PIL: '49',
  MP: '113',
  RC: '30',
  RCP: '31',
  RCMP: '121',
  RT: '37',
};

export type EcourtsCaptchaChallenge = {
  caseNumber: string;
  captchaImage: string;
  captchaToken: string;
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

type LookupCnrResponse = {
  success?: boolean;
  requiresCaptcha?: boolean;
  message?: string;
  caseNumber?: string;
  captchaImage?: string;
  captchaToken?: string;
  cnr_number?: string;
  ecourts_case_no?: string;
  case_number?: string;
};

type CaseHistoryApiResponse = {
  success?: boolean;
  message?: string;
  cnr_number?: string;
  case_number?: string;
  raw_html?: string;
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

function normalizeCaseType(value: string): string {
  return clean(value)
    .toUpperCase()
    .replace(/[.\s_-]+/g, '');
}

function parseCaseNumber(caseNumber: string): {
  caseNumber: string;
  caseType: string;
  caseTypeOrder: string;
  caseNumberOrder: string;
  caseYearOrder: string;
} {
  const normalizedCaseNumber = clean(caseNumber).toUpperCase();
  const [rawType = '', rawNumber = '', rawYear = ''] = normalizedCaseNumber.split('/');
  const caseType = normalizeCaseType(rawType);
  const caseNumberOrder = rawNumber.replace(/\D/g, '');
  const caseYearOrder = rawYear.replace(/\D/g, '');
  const caseTypeOrder = HC_CASE_TYPE_NUMERIC[caseType] ?? '';

  if (!caseType || !caseNumberOrder || !caseYearOrder || !caseTypeOrder) {
    throw new EcourtsError('UNKNOWN', `Unsupported or invalid case number: ${caseNumber}`);
  }

  return {
    caseNumber: normalizedCaseNumber,
    caseType,
    caseTypeOrder,
    caseNumberOrder,
    caseYearOrder,
  };
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
  return Boolean(clean(value.case_no) || clean(value.cino));
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
      currentAdvocate = line.replace(/advocate-\s*/i, '').trim();
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

function mapShowRecord(
  record: Record<string, unknown>,
  parsedCase: ReturnType<typeof parseCaseNumber>,
): EcourtsOrderRecord {
  const orderUrlPath = clean(record.orderurlpath);
  const typeName = clean(record.type_name) || parsedCase.caseType;
  const registrationNumber = clean(record.reg_no) || parsedCase.caseNumberOrder;
  const registrationYear = clean(record.reg_year) || parsedCase.caseYearOrder;
  const cino = clean(record.cino);
  const caseNo = clean(record.case_no);

  if (!caseNo || !cino) {
    console.error('SHOW RECORD DATA MISSING REQUIRED FIELDS');
    console.error(record);
    throw new EcourtsError('UNKNOWN', 'showRecords returned an unexpected case lookup shape');
  }

  const pdfUrl = orderUrlPath
    ? buildPdfUrl({
        orderurlpath: orderUrlPath,
        type_name: typeName,
        reg_no: registrationNumber,
        reg_year: registrationYear,
        cino,
      })
    : '';

  console.log('SHOW RECORD DATA');
  console.log(record);
  if (pdfUrl) {
    console.log('PDF URL');
    console.log(pdfUrl);
  }

  return {
    caseNo,
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
  const payload = {
    cnr_number: showRecord.cino,
    ecourts_case_no: showRecord.caseNo,
  };

  console.log('CASE HISTORY REQUEST');
  console.log(new URLSearchParams({
    court_code: '1',
    state_code: '10',
    court_complex_code: '1',
    case_no: showRecord.caseNo,
    cino: showRecord.cino,
    appFlag: '',
  }).toString());

  let response: Response;
  try {
    response = await fetch(`${ECOURTS_API_BASE}/case-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Unable to fetch case history');
  }

  let data: CaseHistoryApiResponse;
  try {
    data = await response.json() as CaseHistoryApiResponse;
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Invalid case history response');
  }

  console.log('CASE HISTORY HTML');
  console.log(data.raw_html ?? '');

  if (!response.ok || !data.success) {
    console.error(data.message ?? data.raw_html ?? '');
    throw new EcourtsError('UNKNOWN', data.message || 'Case history request failed');
  }

  return data.raw_html ?? '';
}

export async function loadShowRecordsCaptcha(caseNumber: string): Promise<EcourtsCaptchaChallenge> {
  const parsedCase = parseCaseNumber(caseNumber);
  let resp: Response;
  try {
    resp = await fetch(`${ECOURTS_API_BASE}/lookup-cnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_number: parsedCase.caseNumber }),
    });
  } catch (error) {
    console.error(error);
    throw new EcourtsError('SESSION_EXPIRED', 'Unable to load captcha image');
  }

  let data: LookupCnrResponse;
  try {
    data = await resp.json() as LookupCnrResponse;
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Unable to load captcha image');
  }

  if (!resp.ok || !data.requiresCaptcha || !data.captchaImage || !data.captchaToken) {
    console.error(data.message ?? data);
    throw new EcourtsError('UNKNOWN', data.message || 'Unable to load captcha image');
  }

  return {
    caseNumber: data.caseNumber || parsedCase.caseNumber,
    captchaImage: data.captchaImage,
    captchaToken: data.captchaToken,
  };
}

export async function submitShowRecordsCaptcha(args: { caseNumber: string; captchaValue: string; captchaToken: string }): Promise<EcourtsShowRecordsResult> {
  const parsedCase = parseCaseNumber(args.caseNumber);
  let response: Response;
  try {
    response = await fetch(`${ECOURTS_API_BASE}/lookup-cnr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_number: parsedCase.caseNumber,
        captcha: args.captchaValue,
        captcha_token: args.captchaToken,
      }),
    });
  } catch (error) {
    console.error(error);
    throw new EcourtsError('UNKNOWN', 'Unable to submit showRecords request');
  }

  const responseText = await response.text();
  console.log('SHOW RECORDS RESPONSE');
  console.log(responseText);

  try {
    const data = JSON.parse(responseText) as LookupCnrResponse;
    console.log(data);

    if (!response.ok) {
      console.error(data.message ?? responseText);
      throw new EcourtsError('UNKNOWN', data.message || 'showRecords request failed');
    }

    if (data.requiresCaptcha && data.captchaImage && data.captchaToken) {
      throw new EcourtsError('INVALID_CAPTCHA', data.message || 'Invalid captcha. Please try again.');
    }

    if (!data.success || !data.cnr_number) {
      throw new EcourtsError('UNKNOWN', data.message || 'Unable to resolve case number from eCourts.');
    }

    const showRecord = mapShowRecord({
      case_no: data.ecourts_case_no,
      cino: data.cnr_number,
      reg_no: parsedCase.caseNumberOrder,
      reg_year: parsedCase.caseYearOrder,
      type_name: parsedCase.caseType,
    }, parsedCase);

    console.log('PARSED RESULTS');
    console.log(showRecord);
    const caseHistoryHtml = await fetchCaseHistoryHtml(showRecord);
    const parsedCaseHistory = parseCaseHistoryHtml(caseHistoryHtml, showRecord);
    return { parsedCaseHistory };
  } catch (error) {
    console.error(error);
    if (error instanceof EcourtsError) {
      throw error;
    }
    throw new EcourtsError('UNKNOWN', 'Unable to parse showRecords response');
  }
}
