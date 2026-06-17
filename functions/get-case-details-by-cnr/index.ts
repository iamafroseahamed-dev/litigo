import { serve } from 'https://deno.land/std@0.205.0/http/server.ts';

interface CaseDetailsResponse {
  caseDetails: Record<string, string>[];
  caseStatus: Record<string, string>[];
  hearingHistory: Record<string, string>[];
}

interface RequestPayload {
  cnr_number: string;
}

function parseTable(table: HTMLTableElement) {
  const headerCells = Array.from(table.querySelectorAll('thead th')) as HTMLTableCellElement[];
  let headers = headerCells.map((cell) => cell.textContent?.trim() ?? '');

  if (headers.length === 0) {
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      headers = Array.from(firstRow.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? '');
    }
  }

  const rows = Array.from(table.querySelectorAll('tbody tr')).length
    ? Array.from(table.querySelectorAll('tbody tr'))
    : Array.from(table.querySelectorAll('tr')).slice(headers.length ? 1 : 0);

  return rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[];
    const result: Record<string, string> = {};

    cells.forEach((cell, index) => {
      const key = headers[index] || `col${index + 1}`;
      result[key] = cell.textContent?.trim() ?? '';
    });

    return result;
  });
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

  const cnrNumber = String(payload.cnr_number ?? '').trim();
  if (!cnrNumber) {
    return new Response(JSON.stringify({ message: 'cnr_number is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL('https://hcservices.ecourts.gov.in/hcservices/cases_qry/o_civil_case_history.php');
  url.searchParams.set('state_code', '10');
  url.searchParams.set('dist_code', '1');
  url.searchParams.set('court_code', '1');
  url.searchParams.set('caseStatusSearchType', 'CNRNumber');
  url.searchParams.set('cino', cnrNumber);
  url.searchParams.set('national_court_code', 'HCMA01');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://hcservices.ecourts.gov.in/',
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ message: 'Remote service returned an error', status: response.status }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const html = await response.text();
    const parser = new DOMParser();
    const document = parser.parseFromString(html, 'text/html');

    const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[];
    const parsedTables = tables.map(parseTable);

    const caseDetails = parsedTables[0] ?? [];
    const caseStatus = parsedTables[1] ?? [];
    const hearingHistory = parsedTables[2] ?? [];

    const payloadResponse: CaseDetailsResponse = {
      caseDetails,
      caseStatus,
      hearingHistory,
    };

    return new Response(JSON.stringify(payloadResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('Edge function fetch failed', error);
    return new Response(JSON.stringify({ message: 'Unable to fetch case details' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
