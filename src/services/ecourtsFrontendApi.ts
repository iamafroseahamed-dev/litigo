const ECOURTS_PROXY_BASE = '/hcservices-proxy';

const TEST_CASE_NUMBER = 'WP/16207/2026';
const TEST_CASE_TYPE_ORDER = '49';
const TEST_CASE_NO_ORDER = '16207';
const TEST_CASE_YEAR_ORDER = '2026';

export type EcourtsCaptchaChallenge = {
  caseNumber: string;
  captchaImage: string;
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

export async function submitShowRecordsCaptcha(args: { captchaValue: string }): Promise<void> {
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

    if (Array.isArray(data?.con) && data.con.length > 0) {
      console.log('PARSED RESULTS');
      const first = data.con[0];
      if (typeof first === 'string') {
        console.log(JSON.parse(first));
      } else {
        console.log(first);
      }
    }

    const conValue = data?.con;
    if (typeof conValue === 'string') {
      const parsedCon = JSON.parse(conValue);
      if (Array.isArray(parsedCon) && parsedCon.length > 0) {
        console.log('PARSED RESULTS');
        const first = parsedCon[0];
        if (typeof first === 'string') {
          console.log(JSON.parse(first));
        } else {
          console.log(first);
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}
