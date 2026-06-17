import { serve } from 'https://deno.land/std@0.205.0/http/server.ts';

interface RequestPayload {
  cnr_number?: string;
  case_type: string;
  case_number: string;
  case_year: string;
}

interface MadrasApiMainRow {
  case_number?: string;
  petitioner?: string;
  respondent?: string;
  judgment_date?: string;
  judge?: string;
  citation?: string;
  filename?: string;
}

interface MadrasApiBatchRow extends MadrasApiMainRow {}

interface MadrasApiResponse {
  main_tb?: MadrasApiMainRow[] | MadrasApiMainRow;
  batch_tb?: MadrasApiBatchRow[] | MadrasApiBatchRow;
  [key: string]: unknown;
}

interface MadrasCaseDetail {
  caseNumber: string;
  petitioner: string;
  respondent: string;
  judgmentDate: string;
  judge: string;
  citation: string;
  filename: string;
  pdfUrl: string;
  tamilPdfUrl: string;
  tamilPdfAvailable: boolean;
}

function normalizeRow(row: MadrasApiMainRow | MadrasApiBatchRow): MadrasCaseDetail {
  const filename = String(row.filename ?? '').trim();
  const pdfUrl = filename
    ? `https://mhc.tn.gov.in/judis/index.php/casestatus/viewpdf/${encodeURIComponent(filename)}`
    : '';
  const tamilPdfUrl = filename
    ? `https://mhc.tn.gov.in/judis/index.php/casestatus/viewtpdf/${encodeURIComponent(filename)}`
    : '';

  return {
    caseNumber: String(row.case_number ?? '').trim(),
    petitioner: String(row.petitioner ?? '').trim(),
    respondent: String(row.respondent ?? '').trim(),
    judgmentDate: String(row.judgment_date ?? '').trim(),
    judge: String(row.judge ?? '').trim(),
    citation: String(row.citation ?? '').trim(),
    filename,
    pdfUrl,
    tamilPdfUrl,
    tamilPdfAvailable: false,
  };
}

async function checkTamilPdf(url: string) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { cnr_number, case_type, case_number, case_year } = payload;
  if (!case_type || !case_number || !case_year) {
    return new Response(JSON.stringify({ message: 'case_type, case_number and case_year are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const formData = new URLSearchParams();
  formData.set('cno', case_number);
  formData.set('cyear', case_year);
  formData.set('reportable', 'A');
  formData.set('casetype', case_type);

  try {
    const response = await fetch('https://mhc.tn.gov.in/judis/index.php/casestatus/viewstatus', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://mhc.tn.gov.in',
        Referer: 'https://mhc.tn.gov.in/judis/index.php/casestatus/caseno',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ message: 'Remote service returned an error', status: response.status }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const json = (await response.json()) as MadrasApiResponse;
    const mainRows = toArray(json.main_tb as MadrasApiMainRow | MadrasApiMainRow[] | undefined);
    const batchRows = toArray(json.batch_tb as MadrasApiBatchRow | MadrasApiBatchRow[] | undefined);

    const allRows = [...mainRows, ...batchRows].filter((row) => Boolean(row.filename));
    const results = await Promise.all(
      allRows.map(async (row) => {
        const normalized = normalizeRow(row);
        if (normalized.tamilPdfUrl) {
          normalized.tamilPdfAvailable = await checkTamilPdf(`https://mhc.tn.gov.in/judis/tpdf/t${encodeURIComponent(normalized.filename)}.pdf`);
        }
        return normalized;
      })
    );

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('get-madras-case-details failed', error);
    return new Response(JSON.stringify({ message: 'Unable to fetch Madras case details' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
