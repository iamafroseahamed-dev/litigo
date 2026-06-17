import base64
from datetime import date, datetime, timedelta
import re
import secrets
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import fitz
import psycopg
import requests
from bs4 import BeautifulSoup
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: Optional[str] = None
    SUPABASE_URL: str = 'https://iyohifpzsqjxcrgrtsza.supabase.co'
    SUPABASE_SERVICE_ROLE_KEY: str = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5b2hpZnB6c3FqeGNyZ3J0c3phIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4OTQ1MiwiZXhwIjoyMDk3MTY1NDUyfQ.BLz5-PeIc5TTjSAiYuWxnGgJYrVnqjh0RYwdirJn_50'
    MHC_TIMEOUT_SECONDS: int = 30

    class Config:
        env_file = '.env'
        extra = 'ignore'


settings = Settings()

ECOURTS_BASE_URL = 'https://hcservices.ecourts.gov.in'
ECOURTS_MAIN_URL = f'{ECOURTS_BASE_URL}/hcservices/main.php?v=1'
ECOURTS_CNR_URL = f'{ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php'
ECOURTS_CASE_NUMBER_URL = f'{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords'
CASE_TYPE_MAPPING = {
    'WP': '49',
}
CAPTCHA_SESSION_TTL = timedelta(minutes=10)

captcha_sessions: Dict[str, Dict[str, Any]] = {}
captcha_sessions_lock = Lock()

app = FastAPI(title='Litigo API Backend')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['GET', 'POST', 'OPTIONS'],
    allow_headers=['*'],
)


class CaseDetailsRequest(BaseModel):
    cnr_number: Optional[str] = None
    case_number: Optional[str] = None
    captcha: Optional[str] = None
    captcha_token: Optional[str] = None


class ExtractPdfTextRequest(BaseModel):
    pdfUrl: HttpUrl
    filename: str


@app.get('/api/matched-listings')
def get_matched_listings() -> List[Dict[str, Any]]:
    today = date.today().isoformat()

    if settings.DATABASE_URL:
        query = '''
            SELECT
                d.id,
                d.cause_date,
                d.court_hall,
                d.item_number,
                d.cnr_number,
                d.case_number,
                d.petitioner,
                d.respondent,
                d.judge_name,
                d.last_hearing_or_stage,
                c.advocate_name,
                c.client_name
            FROM daily_cause_list d
            JOIN cases c ON d.cnr_number = c.cnr_number OR d.case_number = c.case_number
            WHERE d.cause_date = (SELECT MAX(cause_date) FROM daily_cause_list WHERE cause_date <= %s)
              AND d.court_name = 'Madras High Court'
              AND d.bench = 'Chennai'
            ORDER BY d.court_hall ASC, d.item_number ASC
        '''

        try:
            with psycopg.connect(settings.DATABASE_URL, autocommit=True) as conn:
                with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                    cur.execute(query, (today,))
                    return cur.fetchall()
        except Exception as exc:
            raise HTTPException(status_code=500, detail='Unable to load matched listings.') from exc

    try:
        # Find latest available cause date <= today
        latest_date_url = (
            f"{settings.SUPABASE_URL}/rest/v1/daily_cause_list"
            f"?select=cause_date&cause_date=lte.{today}&order=cause_date.desc&limit=1"
        )
        latest_resp = requests.get(
            latest_date_url,
            headers={
                'apikey': settings.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
                'Accept': 'application/json',
            },
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        latest_resp.raise_for_status()
        latest_rows = latest_resp.json()
        if not latest_rows:
            return []
        latest_date = latest_rows[0]['cause_date']

        cause_list_url = (
            f"{settings.SUPABASE_URL}/rest/v1/daily_cause_list"
            "?select=id,cause_date,court_hall,item_number,cnr_number,case_number,petitioner,respondent,judge_name,last_hearing_or_stage"
            f"&cause_date=eq.{latest_date}"
            "&court_name=eq.Madras%20High%20Court"
            "&bench=eq.Chennai"
            "&order=court_hall.asc,item_number.asc"
            "&limit=5000"
        )
        cause_list_resp = requests.get(
            cause_list_url,
            headers={
                'apikey': settings.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
                'Accept': 'application/json',
            },
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        cause_list_resp.raise_for_status()
        cause_rows = cause_list_resp.json() or []

        cases_url = (
            f"{settings.SUPABASE_URL}/rest/v1/cases"
            "?select=cnr_number,case_number,advocate_name,client_name&limit=10000"
        )
        cases_resp = requests.get(
            cases_url,
            headers={
                'apikey': settings.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
                'Accept': 'application/json',
            },
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        cases_resp.raise_for_status()
        cases_rows = cases_resp.json() or []

        case_lookup: Dict[str, Any] = {}
        for row in cases_rows:
            cnr = str(row.get('cnr_number') or '').strip().upper()
            case_number = str(row.get('case_number') or '').strip().upper()
            if cnr:
                case_lookup[cnr] = row
            if case_number:
                case_lookup.setdefault(case_number, row)

        matched_rows = []
        for row in cause_rows:
            cnr_key = str(row.get('cnr_number') or '').strip().upper()
            case_key = str(row.get('case_number') or '').strip().upper()
            match = (cnr_key and case_lookup.get(cnr_key)) or (case_key and case_lookup.get(case_key))
            if match:
                matched_rows.append({
                    **row,
                    'advocate_name': match.get('advocate_name'),
                    'client_name': match.get('client_name'),
                })

        return matched_rows
    except requests.RequestException as exc:
        raise HTTPException(status_code=500, detail='Unable to load matched listings.') from exc


def to_array(value: Any) -> List[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    filename = str(row.get('filename') or '').strip()
    pdf_url = (
        f'https://mhc.tn.gov.in/judis/index.php/casestatus/viewpdf/{filename}'
        if filename
        else ''
    )
    tamil_pdf_url = (
        f'https://mhc.tn.gov.in/judis/index.php/casestatus/viewtpdf/{filename}'
        if filename
        else ''
    )
    tamil_available = False
    if filename:
        try:
            resp = requests.head(
                f'https://mhc.tn.gov.in/judis/tpdf/t{filename}.pdf',
                timeout=settings.MHC_TIMEOUT_SECONDS,
            )
            tamil_available = resp.ok
        except requests.RequestException:
            tamil_available = False

    return {
        'caseNumber': str(row.get('case_number') or '').strip(),
        'petitioner': str(row.get('petitioner') or '').strip(),
        'respondent': str(row.get('respondent') or '').strip(),
        'judgmentDate': str(row.get('judgment_date') or '').strip(),
        'judge': str(row.get('judge') or '').strip(),
        'citation': str(row.get('citation') or '').strip(),
        'filename': filename,
        'pdfUrl': pdf_url,
        'tamilPdfUrl': tamil_pdf_url,
        'tamilPdfAvailable': tamil_available,
    }


def extract_case_rows_from_html(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, 'html.parser')
    rows: List[Dict[str, Any]] = []

    for table in soup.find_all('table'):
        headers = [th.get_text(strip=True).lower().replace(' ', '_') for th in table.find_all('th')]
        if not headers:
            continue

        for tr in table.find_all('tr'):
            cells = tr.find_all('td')
            if len(cells) != len(headers):
                continue
            row = {headers[index]: cells[index].get_text(strip=True) for index in range(len(headers))}
            rows.append(row)

    if not rows:
        for anchor in soup.find_all('a', href=True):
            href = anchor['href']
            if 'viewpdf/' in href:
                filename = href.rsplit('/', 1)[-1]
                rows.append({'filename': filename})

    return rows


def clean_text(value: Any) -> str:
    return ' '.join(str(value or '').split()).strip()


def cleanup_captcha_sessions() -> None:
    now = datetime.utcnow()
    expired_tokens: List[str] = []
    with captcha_sessions_lock:
        for token, payload in captcha_sessions.items():
            created_at = payload.get('created_at')
            if not isinstance(created_at, datetime) or now - created_at > CAPTCHA_SESSION_TTL:
                expired_tokens.append(token)
        for token in expired_tokens:
            captcha_sessions.pop(token, None)


def store_captcha_session(session: requests.Session) -> str:
    cleanup_captcha_sessions()
    token = secrets.token_urlsafe(24)
    with captcha_sessions_lock:
        captcha_sessions[token] = {
            'session': session,
            'created_at': datetime.utcnow(),
        }
    return token


def pop_captcha_session(token: str) -> Optional[requests.Session]:
    cleanup_captcha_sessions()
    with captcha_sessions_lock:
        payload = captcha_sessions.pop(token, None)
    if not payload:
        return None
    session = payload.get('session')
    return session if isinstance(session, requests.Session) else None


def get_captcha_headers() -> Dict[str, str]:
    return {
        'User-Agent': 'Mozilla/5.0',
        'Referer': ECOURTS_MAIN_URL,
        'X-Requested-With': 'XMLHttpRequest',
    }


def create_captcha_challenge() -> Dict[str, Any]:
    session = requests.Session()

    try:
        page_response = session.get(
            ECOURTS_MAIN_URL,
            headers={'User-Agent': 'Mozilla/5.0', 'Referer': ECOURTS_BASE_URL + '/'},
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        page_response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to initialize captcha session.') from exc

    soup = BeautifulSoup(page_response.text, 'html.parser')
    captcha_image = soup.find('img', id='captcha_image')
    if not captcha_image or not captcha_image.get('src'):
        raise HTTPException(status_code=502, detail='Unable to find captcha image.')

    captcha_image_url = urljoin(page_response.url, str(captcha_image['src']))

    try:
        image_response = session.get(
            captcha_image_url,
            headers=get_captcha_headers(),
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        image_response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to download captcha image.') from exc

    mime_type = image_response.headers.get('Content-Type') or 'image/png'
    image_b64 = base64.b64encode(image_response.content).decode('ascii')
    return {
        'captchaToken': store_captcha_session(session),
        'captchaImage': f'data:{mime_type};base64,{image_b64}',
    }


def parse_case_number(case_number: str) -> Optional[Tuple[str, str, str]]:
    cleaned = clean_text(case_number).replace(' ', '')
    parts = [part for part in cleaned.split('/') if part]
    if len(parts) != 3:
        return None

    case_type_text = parts[0].upper()
    case_no = re.sub(r'\D', '', parts[1])
    case_year = re.sub(r'\D', '', parts[2])
    if not case_type_text or not case_no or not case_year:
        return None

    return case_type_text, case_no, case_year


def get_table_title(table: Any, index: int) -> str:
    caption = table.find('caption')
    if caption:
        title = clean_text(caption.get_text(' ', strip=True))
        if title:
            return title

    previous = table.find_previous(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'p'])
    if previous:
        title = clean_text(previous.get_text(' ', strip=True))
        if title and len(title) <= 120:
            return title

    return f'Table {index}'


def extract_tables_from_soup(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []

    for index, table in enumerate(soup.find_all('table'), start=1):
        headers: List[str] = []
        rows: List[List[str]] = []

        for tr in table.find_all('tr'):
            cells = tr.find_all(['th', 'td'])
            if not cells:
                continue

            row = [clean_text(cell.get_text(' ', strip=True)) for cell in cells]
            if not any(row):
                continue

            if tr.find_all('th') and not tr.find_all('td') and not headers:
                headers = row
                continue

            rows.append(row)

        if not headers and not rows:
            continue

        if headers and not rows:
            rows = [headers]
            headers = []

        column_count = max([len(headers)] + [len(row) for row in rows])
        tables.append(
            {
                'title': get_table_title(table, index),
                'headers': headers,
                'rows': rows,
                'columnCount': column_count,
            }
        )

    return tables


def extract_links_from_soup(soup: BeautifulSoup) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    seen = set()

    for anchor in soup.find_all('a', href=True):
        href = urljoin(ECOURTS_BASE_URL + '/', str(anchor.get('href') or '').strip())
        text = clean_text(anchor.get_text(' ', strip=True)) or href
        key = (text, href)
        if not href or key in seen:
            continue
        seen.add(key)
        links.append({'text': text, 'href': href})

    return links


def build_case_details_response(
    *,
    search_type: str,
    cnr_number: str,
    case_number: str,
    html: str,
) -> Dict[str, Any]:
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()

    return {
        'success': True,
        'searchType': search_type,
        'cnr_number': cnr_number,
        'case_number': case_number,
        'text': soup.get_text('\n', strip=True),
        'tables': extract_tables_from_soup(soup),
        'links': extract_links_from_soup(soup),
        'raw_html': html,
    }


def build_requires_captcha_response(case_number: str, message: str) -> Dict[str, Any]:
    challenge = create_captcha_challenge()
    return {
        'success': False,
        'requiresCaptcha': True,
        'message': message,
        'caseNumber': case_number,
        **challenge,
    }


def has_invalid_captcha(html: str) -> bool:
    lowered = html.lower()
    if 'captcha' not in lowered:
        return False
    return any(
        marker in lowered
        for marker in ['invalid captcha', 'incorrect captcha', 'captcha does not match', 'enter captcha', 'wrong captcha']
    )


@app.post('/api/ecourts/case-details')
def post_ecourts_case_details(request: CaseDetailsRequest) -> Dict[str, Any]:
    cnr_number = clean_text(request.cnr_number)
    case_number = clean_text(request.case_number)

    if cnr_number:
        try:
            response = requests.get(
                ECOURTS_CNR_URL,
                params={
                    'state_code': '10',
                    'dist_code': '1',
                    'court_code': '1',
                    'caseStatusSearchType': 'CNRNumber',
                    'cino': cnr_number,
                    'national_court_code': 'HCMA01',
                },
                headers={
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': ECOURTS_BASE_URL + '/',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                timeout=settings.MHC_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail='Unable to fetch case details from eCourts.') from exc

        return build_case_details_response(
            search_type='CNR',
            cnr_number=cnr_number,
            case_number=case_number,
            html=response.text,
        )

    if not case_number:
        raise HTTPException(status_code=400, detail='Either cnr_number or case_number is required.')

    if not request.captcha:
        return build_requires_captcha_response(
            case_number,
            'CNR number is not available. Captcha is required for case number search.',
        )

    parsed_case_number = parse_case_number(case_number)
    if not parsed_case_number:
        return {
            'success': False,
            'message': 'Unable to parse the case number for eCourts lookup.',
        }

    case_type_text, case_no, case_year = parsed_case_number
    case_type_code = CASE_TYPE_MAPPING.get(case_type_text)
    if not case_type_code:
        return {
            'success': False,
            'message': 'Case type mapping not available for this case type.',
        }

    captcha_token = clean_text(request.captcha_token)
    if not captcha_token:
        return build_requires_captcha_response(
            case_number,
            'Captcha session is missing. Please enter the new captcha and try again.',
        )

    captcha_session = pop_captcha_session(captcha_token)
    if not captcha_session:
        return build_requires_captcha_response(
            case_number,
            'Captcha session expired. Please enter the new captcha and try again.',
        )

    try:
        response = captcha_session.post(
            ECOURTS_CASE_NUMBER_URL,
            data={
                'action_code': 'showRecords',
                'court_code': '1',
                'state_code': '10',
                'court_complex_code': '1',
                'caseStatusSearchType': 'CScaseNumber',
                'captcha': clean_text(request.captcha),
                'case_type': case_type_code,
                'case_no': case_no,
                'rgyear': case_year,
                'caseNoType': 'new',
                'displayOldCaseNo': 'NO',
            },
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Origin': ECOURTS_BASE_URL,
                'Referer': ECOURTS_MAIN_URL,
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            timeout=settings.MHC_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to fetch case details from eCourts.') from exc

    if has_invalid_captcha(response.text):
        return build_requires_captcha_response(
            case_number,
            'Invalid captcha. Please try again.',
        )

    return build_case_details_response(
        search_type='CASE_NUMBER',
        cnr_number='',
        case_number=case_number,
        html=response.text,
    )


@app.post('/api/extract-pdf-text')
def post_extract_pdf_text(request: ExtractPdfTextRequest) -> Dict[str, str]:
    try:
        response = requests.get(request.pdfUrl, timeout=settings.MHC_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to download PDF.') from exc

    try:
        pdf_doc = fitz.open(stream=response.content, filetype='pdf')
        extracted_pages: List[str] = []
        for page in pdf_doc:
            extracted_pages.append(page.get_text('text') or '')
        text = '\n\n'.join(part.strip() for part in extracted_pages if part.strip())
    except Exception as exc:
        raise HTTPException(status_code=500, detail='Unable to extract text from PDF.') from exc

    return {'text': text}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8001)
