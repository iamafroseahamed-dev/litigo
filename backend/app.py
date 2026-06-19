import base64
from datetime import date, datetime, timedelta
import json
import os
import re
import secrets
from threading import Lock
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import ddddocr
import fitz
import psycopg
import requests
import urllib3
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: Optional[str] = None
    SUPABASE_URL: str = ''
    SUPABASE_SERVICE_ROLE_KEY: str = ''
    MHC_TIMEOUT_SECONDS: int = 60  # read timeout; connect timeout is fixed at 10s

    class Config:
        env_file = '.env'
        extra = 'ignore'


settings = Settings()

ECOURTS_BASE_URL = 'https://hcservices.ecourts.gov.in'
ECOURTS_MAIN_URL = f'{ECOURTS_BASE_URL}/hcservices/main.php?v=1'
ECOURTS_CNR_URL = f'{ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php'
ECOURTS_CASE_NUMBER_URL = f'{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords'

# ecourtindiaHC endpoints (used for case-number search + history)
HC_BASE_URL = 'https://hcservices.ecourts.gov.in/ecourtindiaHC'
HC_CAPTCHA_URL = f'{HC_BASE_URL}/securimage/securimage_show.php'
HC_CASE_NO_QUERY_URL = f'{HC_BASE_URL}/cases/case_no_qry.php'
HC_HISTORY_URL = f'{HC_BASE_URL}/cases/o_civil_case_history.php'
# eCourts case type STRING codes for the case_no_qry.php API (used by /api/ecourts/case-details).
# Returns JSON: {"con": [{cino, case_no, token, ...}]}
CASE_TYPE_MAPPING: Dict[str, str] = {
    'WP':     'WP_C',    # Writ Petition
    'WA':     'WA',      # Writ Appeal
    'WMP':    'WMP',     # Writ Miscellaneous Petition
    'CRLOP':  'WP_CRL',  # Criminal Original Petition
    'CRLA':   'CRL.A',   # Criminal Appeal
    'CRLRC':  'CRL.RC',  # Criminal Revision Case
    'CRLMC':  'CRL.MC',  # Criminal Miscellaneous Case
    'CMP':    'MA',      # Civil Miscellaneous Petition (eCourts: MA)
    'AS':     'AS',      # Appeal Suit
    'SA':     'SA',      # Second Appeal
    'OS':     'OS',      # Original Suit
    'OSA':    'OSA',     # Original Side Appeal
    'TCP':    'TCP',     # Tax Case Petition
    'TCA':    'TCA',     # Tax Case Appeal
    'CRP':    'CRP',     # Civil Revision Petition
    'CONTP':  'CONMT',   # Contempt Petition (eCourts: CONMT)
    'LPA':    'LPA',     # Letters Patent Appeal
    'MP':     'MP',      # Miscellaneous Petition
    'RFA':    'RFA',     # Regular First Appeal
    'CMA':    'CMA',     # Civil Miscellaneous Appeal
    'HCP':    'HCP',     # Habeas Corpus Petition
    'PIL':    'PIL',     # Public Interest Litigation
    'EP':     'EP',      # Election Petition
    'OP':     'OP',      # Original Petition
}

# eCourts case type NUMERIC codes for the case_no_qry.php API.
# Sourced from the <select id="case_type"> dropdown on the eCourts HC site.
# Returns tilde-delimited text: id~case_number~parties~CNR~...##
# Keys are canonical normalized forms (from _normalize_case_type).
HC_CASE_TYPE_NUMERIC: Dict[str, str] = {
    # ── Writ ──────────────────────────────────────────────────────────────
    'WP':       '49',   # Writ Petition
    'WA':       '48',   # Writ Appeal
    'WMP':      '133',  # Writ Misc. Petition
    'WPMP':     '134',  # W.P. Miscellaneous Petition
    'WAMP':     '132',  # W.A. Miscellaneous Petition
    'WVMP':     '135',  # Vacating Order - Misc (Writ)
    'WPCRL':    '334',  # Writ Petition Criminal
    'WPMPCRL':  '346',  # Writ Misc. Petition Criminal
    # ── Criminal ──────────────────────────────────────────────────────────
    'CRLOP':    '12',   # Criminal Original Petition
    'CRLA':     '11',   # Criminal Appeal
    'CRLRC':    '13',   # Criminal Revision Case
    'CRLMC':    '114',  # Criminal Misc. Petition (CRL MP in eCourts)
    'CRLMP':    '114',  # alias for CRLMC
    'CRLREF':   '51',   # Criminal Reference
    # ── Civil / Appeals ───────────────────────────────────────────────────
    'AS':       '1',    # First Appeal
    'SA':       '38',   # Second Appeal
    'CMA':      '2',    # Civil Misc. Appeal
    'CMSA':     '5',    # Civil Misc. Second Appeal
    'LPA':      '24',   # Letters Patent Appeal
    'CRP':      '15',   # Civil Revision Petition
    'CRPNPD':   '16',   # Civil Rev. Petn. (NPD)
    'CRPPD':    '17',   # Civil Rev. Petn. (PD)
    'CMP':      '113',  # Civil Misc. Petition
    'OSA':      '120',  # Original Side Appeal
    'RFA':      '1',    # Regular First Appeal → AS (First Appeal) in eCourts
    # ── Original / Suits ──────────────────────────────────────────────────
    'OP':       '119',  # Original Petition
    'OS':       '19',   # Original Suit (CS – Civil Suits in eCourts)
    'CS':       '19',   # Civil Suits
    'OA':       '117',  # Original Application
    'OMS':      '118',  # Original Matrimonial
    # ── Tax ───────────────────────────────────────────────────────────────
    'TC':       '40',   # Tax Cases
    'TCA':      '41',   # Tax Case Appeal
    'TCP':      '42',   # Tax Case Petition
    'TCR':      '43',   # Tax Case Reference
    'TCMP':     '126',  # Tax CMP
    # ── Habeas Corpus ─────────────────────────────────────────────────────
    'HCP':      '22',   # Habeas Corpus Petition
    'HCMP':     '115',  # Habeas Corpus Misc. Petition
    # ── Contempt ──────────────────────────────────────────────────────────
    'CONTP':    '9',    # Contempt Petition
    'CONTPMD':  '166',  # Contempt Petition (MD)
    'CONTA':    '7',    # Contempt Appeal
    'CONTAPP':  '143',  # Contempt Application
    # ── Company / Insolvency ──────────────────────────────────────────────
    'CP':       '10',   # Company Petition
    'COMAPEL':  '6',    # Company Appeal
    'COMPA':    '142',  # Company Applications
    'IP':       '23',   # Insolvency Petition
    'IA':       '116',  # Insolvency Application
    'IC':       '146',  # Insolvency Cases
    'IN':       '141',  # Insolvency Notice
    # ── Election / Execution ──────────────────────────────────────────────
    'ELP':      '144',  # Election Petition
    'EP':       '145',  # Execution Petition
    # ── Review ────────────────────────────────────────────────────────────
    'REVAPLC':  '32',   # Review Application Civil
    'REVAPLO':  '122',  # Review Application (OS)
    'REVAPLW':  '34',   # Review Application (Writ)
    'REVAPPL':  '35',   # Review Applications
    'REVPET':   '123',  # Review Petition (O)
    # ── Misc ──────────────────────────────────────────────────────────────
    'PIL':      '49',   # Public Interest Litigation → filed as WP in eCourts
    'MP':       '113',  # Misc. Petition → closest is CMP
    'RC':       '30',   # Referred Cases
    'RCP':      '31',   # Referred Case Petition
    'RCMP':     '121',  # RCP Misc. Petition
    'RT':       '37',   # Referred Trial
    'SUBA':     '124',  # Sub Application
    'SUBAPPL':  '125',  # Sub Applications (OS)
    'SCMP':     '138',  # Supreme Court Misc. Petition
    'SCP':      '139',  # Supreme Court Petition
    'STA':      '39',   # Special Tribunal Appeal
    'STP':      '140',  # Special Tribunal Petition
    'VCMP':     '131',  # Vacating Order Misc.
    'TRAPL':    '148',  # Transfer Application
    'TRAS':     '128',  # Transfer First Appeal
    'TRCMA':    '47',   # Transfer Civil Misc. Appeal
    'TRCMP':    '129',  # Transfer Civil Misc. Petition
    'TRCS':     '130',  # Transfer Civil Suit
    'TOS':      '127',  # Testamentary Original Suit
    'LTS':      '147',  # Leave to Sue
    'RP':       '165',  # Reference Petition
    'CROSOBJ':  '136',  # Cross Objection
}
CAPTCHA_SESSION_TTL = timedelta(minutes=10)

captcha_sessions: Dict[str, Dict[str, Any]] = {}
captcha_sessions_lock = Lock()

# Lazy-initialised ddddocr singleton (model load is expensive)
_ocr_instance: Optional[Any] = None
_ocr_lock = Lock()


def _get_ocr() -> Any:
    global _ocr_instance
    with _ocr_lock:
        if _ocr_instance is None:
            _ocr_instance = ddddocr.DdddOcr(show_ad=False)
    return _ocr_instance


def _auto_solve_captcha_hc() -> Tuple[requests.Session, str]:
    """Create a fresh ecourtindiaHC session, fetch the captcha image, and OCR it.

    Returns (session, solved_captcha_text). The session has the captcha cookie
    already bound so it can be used directly in the next POST request.
    Raises HTTPException(502) if the captcha image cannot be fetched.
    """
    ocr = _get_ocr()
    session = _ecourts_session()
    try:
        session.get(
            HC_BASE_URL + '/',
            headers={'User-Agent': 'Mozilla/5.0'},
            verify=False,
            timeout=ECOURTS_REQUEST_TIMEOUT,
        )
        cap_resp = session.get(
            HC_CAPTCHA_URL,
            headers={'User-Agent': 'Mozilla/5.0', 'Referer': HC_BASE_URL + '/'},
            timeout=ECOURTS_REQUEST_TIMEOUT,
        )
        cap_resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f'Unable to fetch captcha image: {exc}') from exc
    captcha_text = ocr.classification(cap_resp.content)
    return session, captcha_text

# Suppress SSL warnings for MHC government site (certificate chain issues)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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


class LookupCnrRequest(BaseModel):
    case_number: str


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

        # Fetch all rows for that date using pagination (Supabase caps at 1000/request)
        sb_headers = {
            'apikey': settings.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
            'Accept': 'application/json',
        }
        cause_rows: List[Dict[str, Any]] = []
        page_size = 1000
        offset = 0
        while True:
            cause_list_url = (
                f"{settings.SUPABASE_URL}/rest/v1/daily_cause_list"
                "?select=id,cause_date,court_hall,item_number,cnr_number,case_number,petitioner,respondent,judge_name,last_hearing_or_stage"
                f"&cause_date=eq.{latest_date}"
                "&court_name=eq.Madras%20High%20Court"
                "&bench=eq.Chennai"
                "&order=court_hall.asc,item_number.asc"
                f"&limit={page_size}&offset={offset}"
            )
            cause_list_resp = requests.get(
                cause_list_url, headers=sb_headers, timeout=settings.MHC_TIMEOUT_SECONDS,
            )
            cause_list_resp.raise_for_status()
            page = cause_list_resp.json() or []
            cause_rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size

        cases_url = (
            f"{settings.SUPABASE_URL}/rest/v1/cases"
            "?select=cnr_number,case_number,advocate_name,client_name&limit=1000&offset=0"
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


MHC_XML_BASE = 'https://mhc.tn.gov.in/judis/clists/clists-madras/causelists/xml/cause_{date}.xml'


def _parse_mhc_xml(xml_bytes: bytes, cause_date_str: str, xml_url: str) -> List[Dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    seen: Set[Tuple[str, str, str, str]] = set()
    rows: List[Dict[str, Any]] = []

    for court in root.iter('court'):
        court_hall = court.findtext('courtno') or ''
        judge_name = court.findtext('judge1') or ''

        for stage in court.iter('stage'):
            stage_name = stage.findtext('stagename') or ''

            for case in stage.iter('casedetails'):
                case_type = case.findtext('mcasetype') or ''
                case_no = case.findtext('mcaseno') or ''
                case_year = case.findtext('mcaseyr') or ''
                case_number = f'{case_type}/{case_no}/{case_year}'
                petitioner = case.findtext('pname') or ''
                respondent = case.findtext('rname') or ''
                item_number = case.findtext('serial_no') or ''
                counsel_name = case.findtext('mpadv') or ''

                dedup_key = (cause_date_str, court_hall, item_number, case_number)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                party_names = ' | '.join(filter(None, [petitioner, respondent]))

                rows.append({
                    'cause_date': cause_date_str,
                    'source_type': 'xml',
                    'source_url': xml_url,
                    'court_name': 'Madras High Court',
                    'bench': 'Chennai',
                    'court_hall': court_hall,
                    'item_number': item_number,
                    'case_number': case_number,
                    'cnr_number': None,
                    'petitioner': petitioner,
                    'respondent': respondent,
                    'party_names': party_names,
                    'judge_name': judge_name,
                    'section': None,
                    'district': None,
                    'prayer': None,
                    'last_hearing_or_stage': stage_name,
                    'counsel_name': counsel_name,
                    'raw_text': None,
                    'raw_data': None,
                    'import_status': 'parsed',
                    'updated_at': datetime.utcnow().isoformat(),
                })

    return rows


_SB_HEADERS = {
    'apikey': settings.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}
_SB_BATCH = 500
_SB_COLS = (
    'cause_date,court_name,bench,court_hall,item_number,case_number,'
    'cnr_number,petitioner,respondent,party_names,judge_name,'
    'last_hearing_or_stage,counsel_name'
)


def _supabase_fetch_today(cause_date_str: str) -> List[Dict[str, Any]]:
    """Read today's cause list from Supabase (paginated, fast path)."""
    all_rows: List[Dict[str, Any]] = []
    page_size, offset = 1000, 0
    base = f'{settings.SUPABASE_URL}/rest/v1/daily_cause_list'
    while True:
        url = (
            f'{base}?cause_date=eq.{cause_date_str}'
            '&court_name=eq.Madras%20High%20Court&bench=eq.Chennai'
            f'&select={_SB_COLS}'
            '&order=court_hall.asc,item_number.asc'
            f'&limit={page_size}&offset={offset}'
        )
        resp = requests.get(url, headers=_SB_HEADERS, timeout=30)
        resp.raise_for_status()
        page = resp.json() or []
        all_rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return all_rows


def _supabase_sync(rows: List[Dict[str, Any]], cause_date_str: str) -> None:
    """Delete today's rows then bulk-insert fresh ones into Supabase."""
    base = f'{settings.SUPABASE_URL}/rest/v1/daily_cause_list'
    delete_url = (
        f'{base}?cause_date=eq.{cause_date_str}'
        '&court_name=eq.Madras%20High%20Court&bench=eq.Chennai'
    )
    requests.delete(delete_url, headers=_SB_HEADERS, timeout=30)

    insert_headers = {**_SB_HEADERS, 'Prefer': 'return=minimal'}
    for i in range(0, len(rows), _SB_BATCH):
        batch = rows[i:i + _SB_BATCH]
        resp = requests.post(base, headers=insert_headers, json=batch, timeout=30)
        resp.raise_for_status()
    print(f'[cause-list] Supabase sync complete: {len(rows)} rows for {cause_date_str}')


@app.get('/api/todays-cause-list')
def get_todays_cause_list(refresh: bool = False) -> JSONResponse:
    today = date.today()
    cause_date_str = today.isoformat()

    # ── Fast path: Supabase (skipped when ?refresh=1) ─────────────────────────
    if not refresh and settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            cached = _supabase_fetch_today(cause_date_str)
            if cached:
                print(f'[cause-list] Supabase hit: {len(cached)} rows for {cause_date_str}')
                return JSONResponse(
                    content=cached,
                    headers={'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache'},
                )
            print('[cause-list] Supabase empty — downloading from MHC')
        except Exception as exc:
            print(f'[cause-list] Supabase read failed ({exc}) — downloading from MHC')

    # ── Slow path: download from MHC ──────────────────────────────────────────
    date_for_url = today.strftime('%d%m%Y')
    xml_url = MHC_XML_BASE.format(date=date_for_url)
    print(f'[cause-list] Downloading XML: {xml_url}')

    try:
        xml_resp = requests.get(xml_url, timeout=(10, 60), verify=False)
        xml_resp.raise_for_status()
        print(f'[cause-list] XML Download Status: {xml_resp.status_code}')
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Today's cause list XML is not available: {exc}",
        ) from exc

    try:
        parsed_rows = _parse_mhc_xml(xml_resp.content, cause_date_str, xml_url)
    except ET.ParseError as exc:
        preview = xml_resp.content[:200].decode('utf-8', errors='replace')
        raise HTTPException(
            status_code=502,
            detail=f'Cause list XML is malformed or not yet published (ParseError: {exc}). Response preview: {preview}',
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Failed to parse cause list XML: {exc}') from exc

    if not parsed_rows:
        raise HTTPException(status_code=404, detail="No records found in today's cause list XML.")

    print(f'[cause-list] Parsed {len(parsed_rows)} rows — syncing to Supabase')

    # Write to Supabase so subsequent requests are fast
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            _supabase_sync(parsed_rows, cause_date_str)
        except Exception as exc:
            print(f'[cause-list] Supabase sync failed (non-fatal): {exc}')

    return JSONResponse(
        content=parsed_rows,
        headers={'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache'},
    )


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


ECOURTS_REQUEST_TIMEOUT = (10, settings.MHC_TIMEOUT_SECONDS)  # (connect, read)


def _ecourts_session() -> requests.Session:
    """Return a Session pre-configured with retry-on-network-error for eCourts requests."""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('https://', adapter)
    session.mount('http://', adapter)
    return session


def create_captcha_challenge() -> Dict[str, Any]:
    session = _ecourts_session()

    try:
        page_response = session.get(
            ECOURTS_MAIN_URL,
            headers={'User-Agent': 'Mozilla/5.0', 'Referer': ECOURTS_BASE_URL + '/'},
            timeout=ECOURTS_REQUEST_TIMEOUT,
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
            timeout=ECOURTS_REQUEST_TIMEOUT,
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


def _normalize_case_type(raw: str) -> str:
    """Canonicalize a raw case type string before CASE_TYPE_MAPPING lookup.

    Examples:
      W.P.       → WP
      W.P.No.    → WP
      WP(MD)     → WP
      WP.MD      → WP
      CRL.OP     → CRLOP
      CRL.O.P    → CRLOP
      CRL O.P    → CRLOP
      CONT.P     → CONTP
      W.A.       → WA
      C.M.P.     → CMP
    """
    s = raw.strip().upper()
    # Drop parenthetical bench codes: WP(MD) → WP, WA(MD/MHC) → WA
    s = re.sub(r'\([^)]*\)', '', s)
    # Remove dots and spaces
    s = s.replace('.', '').replace(' ', '')
    # Remove trailing NO (W.P.No → WPNO → WP)
    s = re.sub(r'NO$', '', s)
    # Collapse consecutive duplicate letters that dots introduced:
    # CRLOP stays CRLOP; CONTP stays CONTP — no collapsing needed
    return s.strip()


def parse_case_number(case_number: str) -> Optional[Tuple[str, str, str]]:
    """Parse various case number formats into (canonical_type, case_no, year).

    Handles:
      WP/4232/2024           → WP, 4232, 2024
      W.P.No.4232/2024       → WP, 4232, 2024
      WP(MD)/4232/2024       → WP, 4232, 2024
      CRL.OP/1234/2025       → CRLOP, 1234, 2025
      CRL.O.P.No.1234/2025   → CRLOP, 1234, 2025
      WA/100/2024            → WA, 100, 2024
      CMP/500/2024           → CMP, 500, 2024
    """
    original = case_number
    cleaned = clean_text(case_number).replace(' ', '')

    # Strategy 1: Standard TYPE/NO/YEAR
    parts = [p for p in cleaned.split('/') if p]
    if len(parts) == 3:
        case_type_raw = parts[0]
        case_no = re.sub(r'\D', '', parts[1])
        case_year = re.sub(r'\D', '', parts[2])
        if case_type_raw and case_no and case_year:
            canonical = _normalize_case_type(case_type_raw)
            print(f'[parse_case_number] original={original!r} → type_raw={case_type_raw!r} canonical={canonical!r} no={case_no} year={case_year}')
            return canonical, case_no, case_year

    # Strategy 2: TYPE+NO/YEAR  (e.g. W.P.No.4232/2024 → 2 slash parts)
    if len(parts) == 2:
        m = re.match(r'^([A-Za-z.]+?)\.?(\d+)$', parts[0])
        if m:
            case_type_raw = m.group(1)
            case_no = m.group(2)
            case_year = re.sub(r'\D', '', parts[1])
            if case_type_raw and case_no and case_year:
                canonical = _normalize_case_type(case_type_raw)
                print(f'[parse_case_number] original={original!r} → type_raw={case_type_raw!r} canonical={canonical!r} no={case_no} year={case_year}')
                return canonical, case_no, case_year

    print(f'[parse_case_number] FAILED to parse: {original!r}')
    return None


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


def extract_summary_fields(soup: BeautifulSoup) -> Dict[str, str]:
    """Extract all key-value pairs from 2-column table rows as a flat dict."""
    fields: Dict[str, str] = {}
    for table in soup.find_all('table'):
        for tr in table.find_all('tr'):
            cells = tr.find_all(['th', 'td'])
            if len(cells) == 2:
                key = clean_text(cells[0].get_text(' ', strip=True))
                value = clean_text(cells[1].get_text(' ', strip=True))
                if key and value and 2 < len(key) <= 80 and value != key:
                    fields[key] = value
    return fields


# ─── eCourts case history parser ─────────────────────────────────────────────

def _make_table(title: str, headers: List[str], rows: List[List[str]]) -> Dict[str, Any]:
    col_count = max([len(headers)] + [len(r) for r in rows], default=0)
    return {'title': title, 'headers': headers, 'rows': rows, 'columnCount': col_count}


def _parse_party_span(span: Any) -> List[List[str]]:
    """Parse a Petitioner_Advocate_table or Respondent_Advocate_table span
    into [['Name', 'advocate1, advocate2'], ...] rows."""
    if not span:
        return []
    lines = [l.strip() for l in span.get_text('\n').splitlines() if l.strip()]
    parties: List[List[str]] = []
    current_name = ''
    current_advocate = ''
    for line in lines:
        if re.match(r'^\d+\)', line):
            if current_name:
                parties.append([current_name, current_advocate])
            current_name = re.sub(r'^\d+\)\s*', '', line).strip()
            current_advocate = ''
        elif 'advocate-' in line.lower():
            current_advocate = re.sub(r'advocate-\s*', '', line, flags=re.IGNORECASE).strip()
        else:
            if current_name and not current_advocate and line:
                current_name += ', ' + line
    if current_name:
        parties.append([current_name, current_advocate])
    return parties


def parse_ecourts_case_number_json(body: str, fallback_case_number: str) -> Optional[Dict[str, Any]]:
    """Parse the JSON response from eCourts index_qry showRecords endpoint.

    The API returns one of:
      {"con": [...list of case objects...], "totRecords": N}
      {"con": "[...JSON string...]"}   (older format)
      {"con": "Invalid Captcha"}
      {"con": ""}  or {"Error": "ERROR_VAL"}
    """
    try:
        root = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(root, dict):
        return None

    # Error / captcha sentinel values
    con_raw = root.get('con')
    if con_raw == 'Invalid Captcha' or con_raw == '' or not con_raw:
        return None  # caller handles these

    if root.get('Error'):
        return None

    # con may be a list already or a JSON-encoded string
    if isinstance(con_raw, str):
        try:
            con_raw = json.loads(con_raw)
        except (json.JSONDecodeError, ValueError):
            return None

    if not isinstance(con_raw, list) or not con_raw:
        return None

    tables: List[Dict[str, Any]] = []
    summary: Dict[str, str] = {}
    cnr_out = ''
    case_num_out = ''

    # ── Build structured sections from the record list ───────────────────────
    # Each element in con_raw is one case match; we show all of them.

    FIELD_LABELS = {
        'cino':          'CNR Number',
        'case_no':       'Case Number',
        'pet_name':      'Petitioner',
        'res_name':      'Respondent',
        'court_name':    'Court',
        'judge_name':    'Judge',
        'next_date':     'Next Hearing Date',
        'next_purpose':  'Next Hearing Purpose',
        'case_type':     'Case Type',
        'case_year':     'Year',
        'case_no_only':  'Case No. (Short)',
        'orderurlpath':  'Order URL',
        'filing_no':     'Filing Number',
        'reg_no':        'Registration Number',
        'reg_date':      'Registration Date',
        'filing_date':   'Filing Date',
        'date_of_filing':'Filing Date',
        'date_of_reg':   'Registration Date',
        'decision_date': 'Decision Date',
        'disp_nature':   'Nature of Disposal',
        'case_status':   'Case Status',
        'coram':         'Judge/Coram',
        'bench_type':    'Bench Type',
        'state_name':    'State',
        'district_name': 'District',
    }

    # Use first record for summary strip
    first = con_raw[0]
    cnr_out = clean_text(first.get('cino') or first.get('cnr_number') or '')
    case_num_out = clean_text(first.get('case_no') or fallback_case_number)

    # Case Summary table – build from all known fields
    summary_rows: List[List[str]] = []
    for key, label in FIELD_LABELS.items():
        val = clean_text(first.get(key) or '')
        if not val or val in ('0', 'null', 'None'):
            continue
        summary_rows.append([label, val])
        summary[label] = val

    if summary_rows:
        tables.append(_make_table('Case Summary', ['Field', 'Value'], summary_rows))

    # If multiple matches returned, show a Case List table
    if len(con_raw) > 1:
        list_headers = ['Case Number', 'Petitioner', 'Respondent', 'Court', 'Next Hearing']
        list_rows: List[List[str]] = []
        for rec in con_raw:
            list_rows.append([
                clean_text(rec.get('case_no') or ''),
                clean_text(rec.get('pet_name') or ''),
                clean_text(rec.get('res_name') or ''),
                clean_text(rec.get('court_name') or ''),
                clean_text(rec.get('next_date') or ''),
            ])
        tables.append(_make_table('Matching Cases', list_headers, list_rows))

    # Orders: check if orderurlpath is present
    order_rows: List[List[str]] = []
    for idx, rec in enumerate(con_raw, start=1):
        url_path = clean_text(rec.get('orderurlpath') or '')
        if url_path:
            full_url = urljoin(ECOURTS_BASE_URL + '/hcservices/', url_path) if not url_path.startswith('http') else url_path
            order_rows.append([
                str(idx),
                clean_text(rec.get('case_no') or ''),
                '',  # judge
                '',  # order date
                full_url,
            ])
    if order_rows:
        tables.append(_make_table(
            'Orders',
            ['Order No.', 'Case No.', 'Judge', 'Order Date', 'PDF Link'],
            order_rows,
        ))

    return {
        'tables': tables,
        'summary_fields': summary,
        'cnr_number': cnr_out,
        'case_number': case_num_out,
    }



def parse_ecourts_case_history(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    """Parse eCourts case history HTML into structured sections using heading→table mapping.
    Returns None if the response does not look like a case history page."""

    has_filing = any(
        clean_text(td.get_text()) == 'Filing Number'
        for td in soup.find_all('td')
    )
    if not has_filing:
        return None

    tables: List[Dict[str, Any]] = []
    summary: Dict[str, str] = {}
    cnr_out = ''
    case_num_out = ''

    # ── helpers ──────────────────────────────────────────────────────────────

    def _heading_text(tag: Any) -> str:
        return clean_text(tag.get_text(' ', strip=True)) if tag else ''

    def _table_headers(html_table: Any) -> List[str]:
        header_row = html_table.find('tr')
        if not header_row:
            return []
        ths = header_row.find_all('th')
        if ths:
            return [clean_text(th.get_text(' ', strip=True)) for th in ths]
        return []

    def _table_rows(html_table: Any, skip_header: bool = True) -> List[List[str]]:
        rows: List[List[str]] = []
        all_trs = html_table.find_all('tr')
        start = 1 if skip_header and _table_headers(html_table) else 0
        for tr in all_trs[start:]:
            cells = tr.find_all('td')
            row = [clean_text(c.get_text(' ', strip=True)) for c in cells]
            if any(row):
                rows.append(row)
        return rows

    def _flat_4col_to_2col(html_table: Any) -> List[List[str]]:
        """Convert th td th td rows into [[label, value], [label, value]] pairs."""
        result: List[List[str]] = []
        for tr in html_table.find_all('tr'):
            cells = tr.find_all(['th', 'td'])
            vals = [clean_text(c.get_text(' ', strip=True)) for c in cells]
            vals = [v for v in vals if v]
            if len(vals) >= 4:
                result.append([vals[0], vals[1]])
                result.append([vals[2], vals[3]])
            elif len(vals) == 2:
                result.append(vals)
            elif len(vals) == 1:
                result.append([vals[0], ''])
        return [r for r in result if any(r)]

    # ── build a heading → next-table map ─────────────────────────────────────
    # Walk the DOM in order; each heading sets the label for the following table.
    # We process sections in order as they appear in the HTML.
    processed_table_ids: set = set()

    section_order = [
        'Case Details',
        'Case Status',
        'Petitioner and Advocate',
        'Respondent and Advocate',
        'Acts',
        'Category Details',
        'Sub Matters',
        'Linked Cases',
        'History of Case Hearing',
        'Orders',
        'Document Details',
        'OBJECTION',
    ]

    heading_to_table: Dict[str, Any] = {}
    current_heading = ''
    for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'table']):
        if el.name in ('h1', 'h2', 'h3', 'h4'):
            txt = _heading_text(el)
            if txt:
                current_heading = txt
        elif el.name == 'table':
            if current_heading and current_heading not in heading_to_table:
                heading_to_table[current_heading] = el

    # ── 1. Case Details ───────────────────────────────────────────────────────
    case_det_table = heading_to_table.get('Case Details')
    if case_det_table is not None:
        rows2col = _flat_4col_to_2col(case_det_table)
        processed_table_ids.add(id(case_det_table))
        for kv in rows2col:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
                if 'cnr' in kv[0].lower():
                    cnr_out = kv[1]
                elif 'registration number' in kv[0].lower() and not case_num_out:
                    case_num_out = kv[1]
                elif 'filing number' in kv[0].lower() and not case_num_out:
                    case_num_out = kv[1]
        tables.append(_make_table('Case Details', ['Field', 'Value'], rows2col))

    # ── 2. Case Status ────────────────────────────────────────────────────────
    case_status_table = heading_to_table.get('Case Status')
    if case_status_table is not None:
        rows2col = _flat_4col_to_2col(case_status_table)
        processed_table_ids.add(id(case_status_table))
        for kv in rows2col:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
        tables.append(_make_table('Case Status', ['Field', 'Value'], rows2col))

    # ── 3. Parties (spans) ───────────────────────────────────────────────────
    pet_span = soup.find('span', class_='Petitioner_Advocate_table')
    res_span = soup.find('span', class_='Respondent_Advocate_table')
    party_rows: List[List[str]] = []

    if pet_span:
        lines = [ln.strip() for ln in pet_span.get_text('\n').splitlines() if ln.strip()]
        current_name = ''
        current_adv = ''
        for ln in lines:
            if re.match(r'^\d+\)', ln):
                if current_name:
                    party_rows.append(['Petitioner', current_name, current_adv])
                current_name = re.sub(r'^\d+\)\s*', '', ln).strip()
                current_adv = ''
            elif 'advocate-' in ln.lower():
                current_adv = re.sub(r'(?i)advocate-\s*', '', ln).strip()
        if current_name:
            party_rows.append(['Petitioner', current_name, current_adv])

    if res_span:
        lines = [ln.strip() for ln in res_span.get_text('\n').splitlines() if ln.strip()]
        current_name = ''
        current_adv = ''
        for ln in lines:
            if re.match(r'^\d+\)', ln):
                if current_name:
                    party_rows.append(['Respondent', current_name, current_adv])
                current_name = re.sub(r'^\d+\)\s*', '', ln).strip()
                current_adv = ''
            elif 'advocate-' in ln.lower():
                current_adv = re.sub(r'(?i)advocate-\s*', '', ln).strip()
        if current_name:
            party_rows.append(['Respondent', current_name, current_adv])

    if party_rows:
        tables.append(_make_table('Parties', ['Role', 'Name', 'Advocate'], party_rows))
        # Fill summary from first petitioner / respondent
        pets = [r for r in party_rows if r[0] == 'Petitioner']
        ress = [r for r in party_rows if r[0] == 'Respondent']
        if pets:
            summary['Petitioner'] = pets[0][1]
            if pets[0][2]:
                summary['Petitioner Advocate'] = pets[0][2]
        if ress:
            summary['Respondent'] = ress[0][1]
            if ress[0][2]:
                summary['Respondent Advocate'] = ress[0][2]

    # ── 4. Acts / Applicable Laws ─────────────────────────────────────────────
    acts_table = heading_to_table.get('Acts')
    if acts_table is not None:
        hdrs = _table_headers(acts_table)
        act_rows = _table_rows(acts_table, skip_header=bool(hdrs))
        processed_table_ids.add(id(acts_table))
        if act_rows:
            tables.append(_make_table('Acts / Applicable Laws', hdrs or ['Act', 'Section'], act_rows))

    # ── 5. Category Details ───────────────────────────────────────────────────
    cat_table = heading_to_table.get('Category Details')
    if cat_table is not None:
        cat_rows = _flat_4col_to_2col(cat_table)
        processed_table_ids.add(id(cat_table))
        for kv in cat_rows:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
        if cat_rows:
            tables.append(_make_table('Category Details', ['Field', 'Value'], cat_rows))

    # ── 6. Sub Matters ────────────────────────────────────────────────────────
    sub_table = heading_to_table.get('Sub Matters')
    if sub_table is not None:
        sub_rows = _flat_4col_to_2col(sub_table)
        processed_table_ids.add(id(sub_table))
        if sub_rows:
            tables.append(_make_table('Sub Matters', ['Field', 'Value'], sub_rows))

    # ── 7. Linked Cases ───────────────────────────────────────────────────────
    linked_table = heading_to_table.get('Linked Cases')
    if linked_table is not None:
        hdrs = _table_headers(linked_table)
        linked_rows = _table_rows(linked_table, skip_header=bool(hdrs))
        processed_table_ids.add(id(linked_table))
        # Filter out rows that are just section labels like ['IA Details']
        linked_rows = [r for r in linked_rows if len(r) >= 2 and r[1].strip()]
        if linked_rows:
            tables.append(_make_table('Linked Cases', hdrs or ['Filing Number', 'Case Number'], linked_rows))

    # ── 8. History of Case Hearing ────────────────────────────────────────────
    hearing_table = heading_to_table.get('History of Case Hearing')
    if hearing_table is not None:
        hdrs = _table_headers(hearing_table)
        h_rows: List[List[str]] = []
        stop_markers = {'orders', 'order number', 'order no', 'order on'}
        for tr in hearing_table.find_all('tr')[1 if hdrs else 0:]:
            cells = tr.find_all('td')
            if not cells:
                continue
            row = [clean_text(c.get_text(' ', strip=True)) for c in cells]
            if not any(row):
                continue
            if row[0].lower().strip() in stop_markers:
                break
            h_rows.append(row)
        processed_table_ids.add(id(hearing_table))
        if h_rows:
            tables.append(_make_table(
                'History of Case Hearing',
                hdrs or ['Cause List Type', 'Judge', 'Business On Date', 'Hearing Date', 'Purpose of Hearing'],
                h_rows,
            ))

    # ── 9. Orders ─────────────────────────────────────────────────────────────
    orders_table = heading_to_table.get('Orders')
    if orders_table is not None:
        order_rows: List[List[str]] = []
        for tr in orders_table.find_all('tr'):
            cells = tr.find_all(['th', 'td'])
            if not cells:
                continue
            row_text = [clean_text(c.get_text(' ', strip=True)) for c in cells]
            if not any(row_text):
                continue
            first_lower = row_text[0].lower().strip()
            if first_lower in ('order number', 'order no', 'sl. no', 'sl.no', '#'):
                continue  # skip header row
            # Resolve PDF link for this row's anchor
            pdf_url = ''
            for a in tr.find_all('a', href=True):
                href = str(a.get('href', ''))
                if 'display_pdf' in href or 'pdf' in href.lower():
                    pdf_url = urljoin(ECOURTS_BASE_URL + '/hcservices/', href)
                    break
            order_row = (row_text + ['', '', '', ''])[:4] + [pdf_url]
            order_rows.append(order_row)
        processed_table_ids.add(id(orders_table))
        if order_rows:
            tables.append(_make_table(
                'Orders',
                ['Order No.', 'Case No.', 'Judge', 'Order Date', 'PDF Link'],
                order_rows,
            ))

    # ── 10. Document Details ──────────────────────────────────────────────────
    doc_table = heading_to_table.get('Document Details')
    if doc_table is not None:
        hdrs = _table_headers(doc_table)
        doc_rows = _table_rows(doc_table, skip_header=bool(hdrs))
        processed_table_ids.add(id(doc_table))
        if doc_rows:
            tables.append(_make_table(
                'Document Details',
                hdrs or ['Sl. No.', 'Document No.', 'Date of Receiving', 'Filed by', 'Advocate', 'Document Filed'],
                doc_rows,
            ))

    # ── 11. Scrutiny / Objections ─────────────────────────────────────────────
    obj_table = heading_to_table.get('OBJECTION')
    if obj_table is not None:
        hdrs = _table_headers(obj_table)
        scrut_rows: List[List[str]] = []
        all_trs = obj_table.find_all('tr')
        # First data row may also be a pseudo-header
        start_idx = 1 if hdrs else 0
        for tr in all_trs[start_idx:]:
            cells = tr.find_all(['td', 'th'])
            row = [clean_text(c.get_text(' ', strip=True)) for c in cells]
            if not any(row):
                continue
            if not hdrs and any(kw in ' '.join(row).lower() for kw in ['scrutiny', 'objection compliance', 'receipt date']):
                hdrs = row
                continue
            scrut_rows.append(row)
        processed_table_ids.add(id(obj_table))
        if scrut_rows:
            tables.append(_make_table(
                'Scrutiny / Objections',
                hdrs or ['Sl.No.', 'Scrutiny Date', 'Objection', 'Compliance Date', 'Receipt Date'],
                scrut_rows,
            ))

    return {
        'tables': tables,
        'summary_fields': summary,
        'cnr_number': cnr_out,
        'case_number': case_num_out,
    }



def build_case_details_response(
    *,
    search_type: str,
    cnr_number: str,
    case_number: str,
    html: str,
) -> Dict[str, Any]:
    # ── JSON path: case-number search returns {"con": [...]} ─────────────────
    body = html.strip()
    if body.startswith('{') or body.startswith('['):
        parsed_json = parse_ecourts_case_number_json(body, case_number)
        if parsed_json:
            resolved_cnr = parsed_json['cnr_number'] or cnr_number
            resolved_case = parsed_json['case_number'] or case_number
            return {
                'success': True,
                'searchType': search_type,
                'cnr_number': resolved_cnr,
                'case_number': resolved_case,
                'tables': parsed_json['tables'],
                'links': [],
                'summary_fields': parsed_json['summary_fields'],
                'text': '',
                'raw_html': html,
            }

    # ── HTML path: CNR search returns full case history page ─────────────────
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()

    parsed = parse_ecourts_case_history(soup)

    if parsed:
        resolved_cnr = parsed['cnr_number'] or cnr_number
        resolved_case = parsed['case_number'] or case_number
        return {
            'success': True,
            'searchType': search_type,
            'cnr_number': resolved_cnr,
            'case_number': resolved_case,
            'tables': parsed['tables'],
            'links': extract_links_from_soup(soup),
            'summary_fields': parsed['summary_fields'],
            'text': soup.get_text('\n', strip=True),
            'raw_html': html,
        }

    # ── Fallback: generic extraction (e.g. unknown eCourts page format) ───────
    return {
        'success': True,
        'searchType': search_type,
        'cnr_number': cnr_number,
        'case_number': case_number,
        'text': soup.get_text('\n', strip=True),
        'tables': extract_tables_from_soup(soup),
        'links': extract_links_from_soup(soup),
        'summary_fields': extract_summary_fields(soup),
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


def _create_hc_captcha_challenge(case_number: str) -> Dict[str, Any]:
    """Download captcha directly from ecourtindiaHC securimage endpoint."""
    session = _ecourts_session()
    try:
        img_resp = session.get(
            HC_CAPTCHA_URL,
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Referer': HC_BASE_URL + '/',
            },
            timeout=ECOURTS_REQUEST_TIMEOUT,
        )
        img_resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to download captcha image.') from exc

    mime_type = img_resp.headers.get('Content-Type') or 'image/png'
    image_b64 = base64.b64encode(img_resp.content).decode('ascii')
    token = store_captcha_session(session)
    return {
        'success': False,
        'requiresCaptcha': True,
        'message': 'Captcha required for case number search.',
        'caseNumber': case_number,
        'captchaToken': token,
        'captchaImage': f'data:{mime_type};base64,{image_b64}',
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

    # ── 1. CNR lookup: call eCourts history API directly ──────────────────────
    if cnr_number:
        try:
            response = _ecourts_session().get(
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
                timeout=ECOURTS_REQUEST_TIMEOUT,
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

    # ── 2. Case number without captcha → return captcha challenge ─────────────
    if not request.captcha:
        return _create_hc_captcha_challenge(case_number)

    # ── 3. Case number + captcha → query case_no_qry, then fetch history ──────
    parsed_case_number = parse_case_number(case_number)
    if not parsed_case_number:
        return {
            'success': False,
            'message': 'Unable to parse the case number. Expected format: TYPE/NUMBER/YEAR (e.g. WP/4232/2024).',
        }

    case_type_text, case_no, case_year = parsed_case_number
    case_type_code = CASE_TYPE_MAPPING.get(case_type_text)
    print(f'[case-details] original={case_number!r} parsed_type={case_type_text!r} ecourts_code={case_type_code!r} no={case_no} year={case_year}')
    if not case_type_code:
        print(f'[case-details] CASE_TYPE_MAPPING_NOT_FOUND: original={case_number!r} parsed_type={case_type_text!r}')
        return {
            'success': False,
            'error': 'CASE_TYPE_MAPPING_NOT_FOUND',
            'caseNumber': case_number,
            'parsedCaseType': case_type_text,
            'parsedCaseNo': case_no,
            'parsedYear': case_year,
            'message': f'Case type "{case_type_text}" is not yet configured for eCourts lookup. Please add it to CASE_TYPE_MAPPING in the backend.',
        }

    captcha_token = clean_text(request.captcha_token)
    captcha_session = pop_captcha_session(captcha_token) if captcha_token else None
    if not captcha_session:
        return _create_hc_captcha_challenge(case_number)

    # Step A: POST to case_no_qry.php
    try:
        qry_resp = captcha_session.post(
            HC_CASE_NO_QUERY_URL,
            data={
                'action_code': 'showRecords',
                'state_code': '10',
                'dist_code': '1',
                'case_type': case_type_code,
                'case_no': case_no,
                'rgyear': case_year,
                'caseNoType': 'new',
                'displayOldCaseNo': 'NO',
                'captcha': clean_text(request.captcha),
                'court_code': '1',
            },
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Origin': HC_BASE_URL,
                'Referer': HC_BASE_URL + '/',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            timeout=ECOURTS_REQUEST_TIMEOUT,
        )
        qry_resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to query case details from eCourts.') from exc

    qry_body = qry_resp.text.strip()

    if has_invalid_captcha(qry_body):
        return _create_hc_captcha_challenge(case_number)

    # Step B: Parse JSON to extract cino, token, case_no
    try:
        qry_json = json.loads(qry_body)
    except (json.JSONDecodeError, ValueError):
        # Not JSON — treat as HTML response directly
        return build_case_details_response(
            search_type='CASE_NUMBER',
            cnr_number='',
            case_number=case_number,
            html=qry_body,
        )

    con = qry_json.get('con', '')
    if not con or con == 'Invalid Captcha' or qry_json.get('Error'):
        if has_invalid_captcha(str(con)):
            return _create_hc_captcha_challenge(case_number)
        return {'success': False, 'message': 'No records found for this case number.'}

    if isinstance(con, str):
        try:
            con = json.loads(con)
        except (json.JSONDecodeError, ValueError):
            pass

    if not isinstance(con, list) or not con:
        return {'success': False, 'message': 'No records found for this case number.'}

    first_rec = con[0]
    cino = clean_text(first_rec.get('cino') or '')
    history_token = clean_text(first_rec.get('token') or '')
    rec_case_no = clean_text(first_rec.get('case_no') or case_no)

    if not cino:
        # No cino — fall back to JSON-based response
        return build_case_details_response(
            search_type='CASE_NUMBER',
            cnr_number='',
            case_number=case_number,
            html=qry_body,
        )

    # Step C: Fetch full case history using cino + token
    try:
        hist_resp = captcha_session.post(
            HC_HISTORY_URL,
            data={
                'court_code': '1',
                'state_code': '10',
                'dist_code': '1',
                'case_no': rec_case_no,
                'cino': cino,
                'token': history_token,
                'appFlag': '',
            },
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Origin': HC_BASE_URL,
                'Referer': HC_BASE_URL + '/',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            timeout=ECOURTS_REQUEST_TIMEOUT,
        )
        hist_resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail='Unable to fetch case history from eCourts.') from exc

    # Step D: Parse and return structured JSON
    return build_case_details_response(
        search_type='CASE_NUMBER',
        cnr_number=cino,
        case_number=case_number,
        html=hist_resp.text,
    )


@app.post('/api/lookup-cnr')
def post_lookup_cnr(request: LookupCnrRequest) -> Dict[str, Any]:
    """Auto-solve captcha and return the CNR for a given case number.

    Retries up to 3 times when ddddocr misreads the captcha.
    """
    case_number = clean_text(request.case_number)
    if not case_number:
        raise HTTPException(status_code=400, detail='case_number is required.')

    parsed = parse_case_number(case_number)
    if not parsed:
        return {'success': False, 'cnr_number': None, 'message': f'Unable to parse case number: {case_number}'}

    case_type_text, case_no, case_year = parsed

    # Prefer numeric code (returns tilde-delimited; faster to parse for CNR).
    # Fall back to string code (returns JSON with cino field).
    case_type_code = HC_CASE_TYPE_NUMERIC.get(case_type_text) or CASE_TYPE_MAPPING.get(case_type_text)
    if not case_type_code:
        return {
            'success': False,
            'cnr_number': None,
            'message': f'Case type "{case_type_text}" is not configured for eCourts lookup.',
        }

    max_retries = 3
    for attempt in range(max_retries):
        session, captcha_text = _auto_solve_captcha_hc()
        print(f'[lookup-cnr] attempt={attempt + 1} case={case_number!r} captcha_ocr={captcha_text!r}')

        try:
            qry_resp = session.post(
                HC_CASE_NO_QUERY_URL,
                data={
                    'action_code': 'showRecords',
                    'state_code': '10',
                    'dist_code': '1',
                    'case_type': case_type_code,
                    'case_no': case_no,
                    'rgyear': case_year,
                    'caseNoType': 'new',
                    'displayOldCaseNo': 'NO',
                    'captcha': captcha_text,
                    'court_code': '1',
                },
                headers={
                    'User-Agent': 'Mozilla/5.0',
                    'Origin': HC_BASE_URL,
                    'Referer': HC_BASE_URL + '/',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
                timeout=ECOURTS_REQUEST_TIMEOUT,
            )
            qry_resp.raise_for_status()
        except requests.RequestException as exc:
            if attempt == max_retries - 1:
                raise HTTPException(status_code=502, detail=f'Unable to query eCourts: {exc}') from exc
            continue

        qry_body = qry_resp.text.strip()
        print(f'[lookup-cnr] response preview: {qry_body[:120]!r}')

        if has_invalid_captcha(qry_body):
            print(f'[lookup-cnr] captcha rejected, retrying...')
            continue

        # JSON path (string code e.g. WP_C): {"con": [{"cino": "HCMA...", ...}]}
        try:
            qry_json = json.loads(qry_body)
        except (json.JSONDecodeError, ValueError):
            qry_json = None

        if qry_json is not None:
            con = qry_json.get('con', '')
            if not con or con == 'Invalid Captcha' or qry_json.get('Error'):
                continue
            if isinstance(con, str):
                try:
                    con = json.loads(con)
                except (json.JSONDecodeError, ValueError):
                    pass
            if isinstance(con, list) and con:
                cino = clean_text(con[0].get('cino') or '')
                if cino:
                    print(f'[lookup-cnr] found CNR={cino!r} via JSON path')
                    return {'success': True, 'cnr_number': cino, 'case_number': case_number}
            return {'success': False, 'cnr_number': None, 'message': 'No records found for this case number.'}

        # Tilde-delimited path (numeric code): field0~case_no~parties~CNR~...##
        first_record = qry_body.split('##')[0]
        parts = first_record.split('~')
        if len(parts) >= 4:
            cino = parts[3].strip()
            if cino:
                print(f'[lookup-cnr] found CNR={cino!r} via tilde path')
                return {'success': True, 'cnr_number': cino, 'case_number': case_number}

        return {'success': False, 'cnr_number': None, 'message': 'Unexpected response format from eCourts.'}

    return {'success': False, 'cnr_number': None, 'message': f'Captcha failed after {max_retries} attempts.'}


from fastapi.responses import StreamingResponse
import urllib.parse


@app.get('/api/proxy-pdf')
def get_proxy_pdf(url: str) -> Any:
    """Proxy an eCourts PDF URL.

    Fetches the URL with proper eCourts headers. If the server returns a real
    PDF, streams it to the browser so it renders inline. If it returns HTML
    (e.g. "Orders is not uploaded"), raises a 404 with the extracted message.
    """
    # Basic safety: only allow eCourts / MHC domains
    parsed_url = urllib.parse.urlparse(url)
    allowed_hosts = {'hcservices.ecourts.gov.in', 'mhc.tn.gov.in'}
    if parsed_url.netloc not in allowed_hosts:
        raise HTTPException(status_code=400, detail='URL not allowed.')

    try:
        resp = requests.get(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://hcservices.ecourts.gov.in/hcservices/',
                'Accept': 'application/pdf,*/*',
            },
            verify=False,
            timeout=(10, 60),
            stream=True,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f'Unable to fetch PDF: {exc}') from exc

    content_type = resp.headers.get('content-type', '')

    # If eCourts returned HTML it means the PDF isn't uploaded yet
    if 'text/html' in content_type or 'text/plain' in content_type:
        html_body = resp.content.decode('utf-8', errors='replace').strip()
        # Strip tags to get the plain error message
        from bs4 import BeautifulSoup as _BS
        plain = _BS(html_body, 'html.parser').get_text(' ', strip=True)
        raise HTTPException(status_code=404, detail=plain or 'PDF not available for this case.')

    # Stream the PDF back
    def _iter():
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                yield chunk

    filename = urllib.parse.unquote(url.rsplit('filename=', 1)[-1].split('&')[0]) if 'filename=' in url else 'order.pdf'
    filename_safe = filename.replace('/', '_').replace('\\', '_')
    return StreamingResponse(
        _iter(),
        media_type='application/pdf',
        headers={'Content-Disposition': f'inline; filename="{filename_safe}.pdf"'},
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


# ── Notifications ──────────────────────────────────────────────────────────────

class NotificationRecipientPayload(BaseModel):
    recipient_id: str
    send_email: bool = False
    send_sms: bool = False
    send_whatsapp: bool = False


class SendCaseAlertRequest(BaseModel):
    case_id: str
    cause_date: Optional[str] = None
    subject: str
    message: str
    recipients: List[NotificationRecipientPayload]


def _sb_get(path: str) -> Any:
    """GET from Supabase REST API using service role key."""
    url = f'{settings.SUPABASE_URL}/rest/v1/{path}'
    resp = requests.get(url, headers=_SB_HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _sb_post(path: str, payload: Any) -> Any:
    """POST to Supabase REST API."""
    url = f'{settings.SUPABASE_URL}/rest/v1/{path}'
    headers = {**_SB_HEADERS, 'Prefer': 'return=minimal'}
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp


def _send_email_resend(to_email: str, subject: str, body: str) -> Dict[str, Any]:
    """Send email via Resend. Returns {ok, error}."""
    resend_key = os.environ.get('RESEND_API_KEY', '')
    from_addr = os.environ.get('RESEND_FROM', 'Litigo <notifications@litigo.in>')
    if not resend_key:
        return {'ok': False, 'error': 'RESEND_API_KEY not configured.'}
    try:
        resp = requests.post(
            'https://api.resend.com/emails',
            headers={'Authorization': f'Bearer {resend_key}', 'Content-Type': 'application/json'},
            json={'from': from_addr, 'to': [to_email], 'subject': subject, 'text': body},
            timeout=20,
        )
        if resp.ok:
            return {'ok': True, 'data': resp.json()}
        return {'ok': False, 'error': resp.text}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


@app.post('/api/notifications/send-case-alert')
def send_case_alert(request: SendCaseAlertRequest) -> Dict[str, Any]:
    if not request.recipients:
        raise HTTPException(status_code=400, detail='No recipients specified.')

    # Load recipient details from Supabase
    recipient_ids = [r.recipient_id for r in request.recipients]
    id_filter = ','.join(f'"{rid}"' for rid in recipient_ids)
    try:
        recs_raw = _sb_get(f'case_notification_recipients?id=in.({",".join(recipient_ids)})')
        recs: Dict[str, Any] = {r['id']: r for r in recs_raw}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'Failed to load recipients: {exc}') from exc

    now = datetime.utcnow().isoformat()
    sent = 0
    failed = 0
    logs: List[Dict[str, Any]] = []

    for p in request.recipients:
        rec = recs.get(p.recipient_id)
        if not rec:
            continue

        # ── Email ──────────────────────────────────────────────────────────────
        if p.send_email and rec.get('email'):
            result = _send_email_resend(rec['email'], request.subject, request.message)
            status = 'sent' if result['ok'] else 'failed'
            if result['ok']:
                sent += 1
            else:
                failed += 1
            logs.append({
                'case_id': request.case_id,
                'cause_date': request.cause_date,
                'organization_id': rec.get('organization_id'),
                'notification_type': 'email',
                'recipient_name': rec.get('recipient_name'),
                'recipient_role': rec.get('recipient_role'),
                'recipient_email': rec['email'],
                'subject': request.subject,
                'message': request.message,
                'status': status,
                'provider': 'resend',
                'provider_response': result,
                'sent_at': now,
                'created_at': now,
            })

        # ── SMS (stub) ─────────────────────────────────────────────────────────
        if p.send_sms and rec.get('mobile_number'):
            logs.append({
                'case_id': request.case_id,
                'cause_date': request.cause_date,
                'organization_id': rec.get('organization_id'),
                'notification_type': 'sms',
                'recipient_name': rec.get('recipient_name'),
                'recipient_mobile': rec['mobile_number'],
                'subject': request.subject,
                'message': request.message,
                'status': 'pending',
                'provider': 'msg91',
                'provider_response': {'note': 'SMS not configured yet.'},
                'sent_at': now,
                'created_at': now,
            })

        # ── WhatsApp (stub) ────────────────────────────────────────────────────
        if p.send_whatsapp and rec.get('whatsapp_number'):
            logs.append({
                'case_id': request.case_id,
                'cause_date': request.cause_date,
                'organization_id': rec.get('organization_id'),
                'notification_type': 'whatsapp',
                'recipient_name': rec.get('recipient_name'),
                'recipient_whatsapp': rec['whatsapp_number'],
                'subject': request.subject,
                'message': request.message,
                'status': 'pending',
                'provider': 'wati',
                'provider_response': {'note': 'WhatsApp not configured yet.'},
                'sent_at': now,
                'created_at': now,
            })

    # Persist logs
    if logs:
        try:
            _sb_post('notification_logs', logs)
        except Exception as exc:
            print(f'[notifications] Failed to write logs: {exc}')

    return {'success': True, 'sent': sent, 'failed': failed, 'logs': logs}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8001)
