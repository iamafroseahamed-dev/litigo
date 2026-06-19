"""Vercel serverless: POST /api/match-todays-listings

Matching + eCourts hearing history enrichment pipeline:

  1. Find the most recent cause_date in daily_cause_list (IST-safe).
  2. Read all active cases from the cases table.
  3. Match daily_cause_list rows against cases by:
       a. CNR number (exact, case-insensitive)
       b. Normalised case number (TYPE/NUMBER/YEAR with leading-zero stripping)
  4. For every match that has a CNR number, call the eCourts case-history
     API (no captcha — uses CNR directly) and parse:
       - Hearing history (up to 10 rows stored as JSONB)
       - Next hearing date
       - Latest case status / stage
       - Latest hearing date + remarks
     Enrichment runs in parallel (max 5 workers) within a 45-second wall-clock
     budget so the function stays inside Vercel\'s 60-second maxDuration.
     If eCourts fails for a case, the basic match record is still saved.
  5. Upsert enriched records into today_matched_listings using
     merge-duplicates on (listed_date, case_id, daily_cause_list_id).
     Historical records for OTHER dates are never deleted.
  6. Return { success, match_date, cause_list_count, cases_count,
              matched_count, enriched_count }.

CNR discovery (for cases without a CNR) is a separate user-triggered flow
via /api/ecourts/lookup-cnr — it is never called here.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

# ── Config ─────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
IST          = timezone(timedelta(hours=5, minutes=30))
PAGE_SIZE    = 1000
BATCH_SIZE   = 500

ECOURTS_URL    = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/o_civil_case_history.php'
ECOURTS_TIMEOUT   = (5, 20)   # (connect, read) seconds per request
ECOURTS_WORKERS   = 5         # max concurrent eCourts calls
ECOURTS_BUDGET_S  = 45        # wall-clock seconds for all enrichment

# Columns that definitely exist in the table (used as fallback in safe-upsert).
BASE_COLS = frozenset({
    'listed_date', 'match_date',
    'case_id', 'daily_cause_list_id',
    'case_number', 'cnr_number', 'court_hall', 'item_number',
    'judge_name', 'stage', 'petitioner', 'respondent',
    'match_type', 'match_status', 'notification_status',
    'cnr_status',
})


# ── Supabase helpers ───────────────────────────────────────────────────────────

def _sb_headers(prefer: str = 'return=minimal') -> Dict[str, str]:
    return {
        'apikey':        SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type':  'application/json',
        'Prefer':        prefer,
    }


def _get_all(table: str, params: Dict[str, str]) -> List[Dict]:
    rows: List[Dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f'{SUPABASE_URL}/rest/v1/{table}',
            headers={**_sb_headers('count=none'), 'Range-Unit': 'items',
                     'Range': f'{offset}-{offset + PAGE_SIZE - 1}'},
            params=params, timeout=30,
        )
        resp.raise_for_status()
        chunk = resp.json()
        if not isinstance(chunk, list) or not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


# ── Latest available cause date ────────────────────────────────────────────────

def _latest_cause_date(up_to: str) -> Optional[str]:
    resp = requests.get(
        f'{SUPABASE_URL}/rest/v1/daily_cause_list',
        headers=_sb_headers('count=none'),
        params={
            'select': 'cause_date', 'cause_date': f'lte.{up_to}',
            'order': 'cause_date.desc', 'limit': '1',
        },
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json()
    if isinstance(rows, list) and rows:
        return rows[0]['cause_date']
    return None


# ── Safe batch upsert ──────────────────────────────────────────────────────────

def _safe_upsert_batch(batch: List[Dict]) -> int:
    ON_CONFLICT = 'listed_date,case_id,daily_cause_list_id'

    def _post(rows: List[Dict], upsert: bool) -> requests.Response:
        prefer = 'resolution=merge-duplicates,return=minimal' if upsert else 'return=minimal'
        params = {'on_conflict': ON_CONFLICT} if upsert else {}
        return requests.post(
            f'{SUPABASE_URL}/rest/v1/today_matched_listings',
            headers={**_sb_headers(), 'Prefer': prefer},
            params=params, json=rows, timeout=30,
        )

    r = _post(batch, upsert=True)
    if r.ok:
        return len(batch)

    ct  = r.headers.get('content-type', '')
    err = r.json() if 'json' in ct else {}
    if not isinstance(err, dict):
        err = {}
    code = err.get('code', '')
    msg  = err.get('message', '')

    if code == '42703':
        print('[match] WARNING: missing columns; falling back to base-only insert.')
        base_batch = [{k: v for k, v in row.items() if k in BASE_COLS} for row in batch]
        r2 = _post(base_batch, upsert=True)
        return len(base_batch) if r2.ok else 0

    if code == 'PGRST204':
        m = re.search(r"find the '(\w+)' column", msg)
        if m:
            missing = m.group(1)
            print(f'[match] Column {missing!r} missing — stripping and retrying.')
            stripped = [{k: v for k, v in row.items() if k != missing} for row in batch]
            use_upsert = missing != 'listed_date'
            r2 = _post(stripped, upsert=use_upsert)
            if r2.ok:
                return len(stripped)
            # One more pass for a second missing column
            ct2  = r2.headers.get('content-type', '')
            err2 = r2.json() if 'json' in ct2 else {}
            if isinstance(err2, dict) and err2.get('code') == 'PGRST204':
                m2 = re.search(r"find the '(\w+)' column", err2.get('message', ''))
                if m2:
                    missing2 = m2.group(1)
                    stripped2 = [{k: v for k, v in row.items()
                                  if k not in (missing, missing2)} for row in stripped]
                    r3 = _post(stripped2, upsert=(missing2 != 'listed_date' and use_upsert))
                    if r3.ok:
                        return len(stripped2)
            print(f'[match] Retry failed: {r2.status_code} {r2.text[:200]}')
            return 0

    print(f'[match] Upsert error {r.status_code}: {err or r.text[:200]}')
    return 0


# ── Case-number normalisation ──────────────────────────────────────────────────

def normalize_case_number(s: Optional[str]) -> str:
    if not s:
        return ''
    try:
        import unicodedata
        s = unicodedata.normalize('NFKC', str(s))
    except Exception:
        pass
    s = s.upper().strip()
    s = re.sub(r'(?<=[A-Z])\.(?=[A-Z(])', '', s)
    s = re.sub(r'(?<=\))\.', '', s)
    s = re.sub(r'\.', ' ', s)
    s = re.sub(r'\bNO\b', '', s)
    s = re.sub(r'\bNUMBER\b', '', s)
    s = re.sub(r'\bOF\b', '/', s)
    s = re.sub(r'\s+', ' ', s).strip()
    parts = [p.strip() for p in re.split(r'\s*/\s*|\s+', s) if p.strip()]
    if len(parts) >= 3:
        ct   = parts[0]
        cn   = re.sub(r'\D', '', parts[1]).lstrip('0') or '0'
        cy   = re.sub(r'\D', '', parts[2])
        if ct and cn and re.match(r'^\d{2,4}$', cy):
            return f'{ct}/{cn}/{cy}'
    return re.sub(r'[^A-Z0-9]', '', s)


def _norm(s: Optional[str]) -> str:
    return normalize_case_number(s)


# ── Date parsing ───────────────────────────────────────────────────────────────

_MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
           'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}


def _parse_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    if not s or s in ('\u2014', '-', 'NA', 'N/A', 'NULL', 'null', '0'):
        return None
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    m = re.match(r'^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', s)
    if m:
        return f'{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}'
    m = re.match(r'^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$', s)
    if m:
        mon = _MONTHS.get(m.group(2).lower())
        if mon:
            return f'{m.group(3)}-{str(mon).zfill(2)}-{m.group(1).zfill(2)}'
    # "21st July 2026" style
    m = re.match(r'^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$', s, re.I)
    if m:
        mon = _MONTHS.get(m.group(2).lower()[:3])
        if mon:
            return f'{m.group(3)}-{str(mon).zfill(2)}-{m.group(1).zfill(2)}'
    return None


# ── eCourts HTML parser ────────────────────────────────────────────────────────

def _clean(v: Any) -> str:
    return ' '.join(str(v or '').split()).strip()


def _heading_table_map(soup: BeautifulSoup) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    current = ''
    for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'table']):
        if el.name in ('h1', 'h2', 'h3', 'h4'):
            t = _clean(el.get_text(' ', strip=True))
            if t:
                current = t
        elif el.name == 'table' and current and current not in result:
            result[current] = el
    return result


def _kv_pairs(tbl: Any) -> Dict[str, str]:
    """Extract key-value pairs from a 2-col or 4-col table."""
    pairs: Dict[str, str] = {}
    for tr in tbl.find_all('tr'):
        cells = tr.find_all(['th', 'td'])
        vals  = [_clean(c.get_text(' ', strip=True)) for c in cells]
        vals  = [v for v in vals if v]
        if len(vals) >= 4:
            pairs[vals[0]] = vals[1]
            pairs[vals[2]] = vals[3]
        elif len(vals) == 2:
            pairs[vals[0]] = vals[1]
    return pairs


def _parse_ecourts_html(html: str) -> Optional[Dict[str, Any]]:
    """
    Parse eCourts case-history HTML and return enrichment fields, or None.

    Returned dict keys (all optional):
      next_hearing_date, latest_case_status, latest_stage,
      latest_hearing_date, latest_hearing_remarks,
      hearing_history (JSON string of List[{date,business,stage,remarks}])
    """
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()

    plain = soup.get_text('\n', strip=True).lower()
    if any(p in plain for p in [
        'no records found', 'no record found', 'case not found',
        'invalid cnr', 'cnr not found', 'no data found', 'record not found',
    ]):
        return {'_not_found': True}

    if len(plain.strip()) < 80:
        return None

    result: Dict[str, Any] = {}
    hmap = _heading_table_map(soup)

    # ── Case Details + Case Status → next date, stage ─────────────────────────
    for key, tbl in hmap.items():
        kl = key.lower()
        if 'case details' not in kl and 'case status' not in kl:
            continue
        for k, v in _kv_pairs(tbl).items():
            kk = k.lower()
            if not v or v.lower() in ('0', 'null', 'none', 'na', '\u2014'):
                continue
            if ('next' in kk and 'hearing' in kk) or ('next' in kk and 'date' in kk):
                d = _parse_date(v)
                if d:
                    result.setdefault('next_hearing_date', d)
            elif 'stage' in kk and 'case' not in kk:
                result.setdefault('latest_stage', v)
            elif 'stage of case' in kk or ('status' in kk and 'case' in kk):
                result.setdefault('latest_case_status', v)

    # ── History of Case Hearing ────────────────────────────────────────────────
    hkey = next(
        (k for k in hmap if 'history' in k.lower() and 'hearing' in k.lower()), None
    )
    if hkey:
        htbl = hmap[hkey]
        first_tr = htbl.find('tr')
        header_cells = first_tr.find_all(['th', 'td']) if first_tr else []
        headers = [_clean(c.get_text(' ', strip=True)).lower() for c in header_cells]

        def _col_idx(*kws: str) -> int:
            for kw in kws:
                for i, h in enumerate(headers):
                    if kw in h:
                        return i
            return -1

        # MHC columns: [CauseListType, Judge, BusinessOnDate, HearingDate, Purpose]
        date_col    = _col_idx('hearing date', 'date')
        biz_col     = _col_idx('purpose', 'business')
        stage_col   = _col_idx('cause list type', 'stage')
        remarks_col = _col_idx('remarks', 'remark')

        if date_col    == -1: date_col    = min(3, max(0, len(headers) - 1))
        if biz_col     == -1: biz_col     = min(4, max(0, len(headers) - 1))
        if stage_col   == -1: stage_col   = 0

        def _cell(row: List[str], idx: int) -> str:
            return row[idx] if 0 <= idx < len(row) else ''

        hearings: List[Dict[str, str]] = []
        skip_set = {'orders', 'order number', 'order no', 'order on'}
        all_trs  = htbl.find_all('tr')
        for tr in all_trs[1 if headers else 0:]:
            cells = tr.find_all('td')
            if not cells:
                continue
            row = [_clean(c.get_text(' ', strip=True)) for c in cells]
            if not any(row):
                continue
            if row[0].lower().strip() in skip_set:
                break
            date_raw = _cell(row, date_col)
            hearings.append({
                'date':    _parse_date(date_raw) or date_raw,
                'business': _cell(row, biz_col),
                'stage':   _cell(row, stage_col),
                'remarks': _cell(row, remarks_col) if remarks_col >= 0 else '',
            })

        if hearings:
            result['hearing_history'] = json.dumps(hearings[:10])
            latest = hearings[0]
            if latest.get('date'):
                result['latest_hearing_date'] = _parse_date(latest['date']) or latest['date']
            result.setdefault('latest_hearing_remarks', latest.get('business', ''))
            result.setdefault('latest_stage', latest.get('stage', ''))

    return result if result else None


# ── Per-match eCourts enrichment ───────────────────────────────────────────────

def _enrich_match(match: Dict) -> Dict:
    cnr     = (match.get('cnr_number') or '').strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    if not cnr:
        match['ecourts_sync_status'] = 'no_cnr'
        match['ecourts_synced_at']   = now_iso
        return match

    try:
        resp = requests.get(
            ECOURTS_URL,
            params={
                'state_code':           '10',
                'dist_code':            '1',
                'court_code':           '1',
                'caseStatusSearchType': 'CNRNumber',
                'cino':                 cnr,
                'national_court_code':  'HCMA01',
            },
            headers={
                'User-Agent':       'Mozilla/5.0',
                'Referer':          'https://hcservices.ecourts.gov.in/',
                'X-Requested-With': 'XMLHttpRequest',
            },
            timeout=ECOURTS_TIMEOUT,
        )
        if not resp.ok:
            match['ecourts_sync_status'] = 'failed'
            match['ecourts_error']       = f'HTTP {resp.status_code}'
            match['ecourts_synced_at']   = now_iso
            return match

        parsed = _parse_ecourts_html(resp.text)
        if parsed is None:
            match['ecourts_sync_status'] = 'failed'
        elif parsed.pop('_not_found', False):
            match['ecourts_sync_status'] = 'not_found'
        else:
            match.update(parsed)
            match['ecourts_sync_status'] = 'done'
            match['ecourts_error'] = None

        match['ecourts_synced_at'] = now_iso
        return match

    except Exception as exc:
        match['ecourts_sync_status'] = 'failed'
        match['ecourts_error']       = str(exc)[:200]
        match['ecourts_synced_at']   = now_iso
        return match


# ── Parallel enrichment with wall-clock budget ─────────────────────────────────

def _enrich_all(matches: List[Dict]) -> Tuple[List[Dict], int]:
    if not matches:
        return [], 0

    no_cnr   = [m for m in matches if not (m.get('cnr_number') or '').strip()]
    to_fetch = [m for m in matches if (m.get('cnr_number') or '').strip()]

    now_iso = datetime.now(timezone.utc).isoformat()
    for m in no_cnr:
        m['ecourts_sync_status'] = 'no_cnr'
        m['ecourts_synced_at']   = now_iso

    if not to_fetch:
        return no_cnr, 0

    enriched:   List[Dict] = list(no_cnr)
    done_count  = 0
    deadline    = time.monotonic() + ECOURTS_BUDGET_S

    executor = ThreadPoolExecutor(max_workers=ECOURTS_WORKERS)
    pending: Dict[Any, Dict] = {executor.submit(_enrich_match, m): m for m in to_fetch}

    try:
        while pending and time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            done, _   = wait(list(pending.keys()), timeout=remaining,
                              return_when=FIRST_COMPLETED)
            for f in done:
                m = pending.pop(f)
                try:
                    result = f.result()
                    enriched.append(result)
                    if result.get('ecourts_sync_status') == 'done':
                        done_count += 1
                except Exception as exc:
                    m['ecourts_sync_status'] = 'failed'
                    m['ecourts_error']       = str(exc)[:200]
                    m['ecourts_synced_at']   = datetime.now(timezone.utc).isoformat()
                    enriched.append(m)

        # Budget exhausted — mark remaining as pending
        for f, m in pending.items():
            f.cancel()
            m['ecourts_sync_status'] = 'pending'
            enriched.append(m)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    return enriched, done_count


# ── Automatic notifications ────────────────────────────────────────────────────
# Phase 1: Email via MailerSend.  Phase 2: Twilio SMS.  Phase 3: Twilio WhatsApp.

MAILERSEND_URL = 'https://api.mailersend.com/v1/email'


def _build_messages(match: Dict, recipient_name: str) -> Tuple[str, str, str, str]:
    """Return (email_subject, email_body, sms_body, whatsapp_body)."""
    cn    = match.get('case_number') or '\u2014'
    cnr   = match.get('cnr_number')  or '\u2014'
    date  = match.get('listed_date') or '\u2014'
    hall  = match.get('court_hall')  or '\u2014'
    item  = match.get('item_number') or '\u2014'
    judge = match.get('judge_name')  or '\u2014'
    pet   = match.get('petitioner')  or '\u2014'
    resp  = match.get('respondent')  or '\u2014'
    stage = match.get('stage')       or '\u2014'

    email_subject = f'Litigo Alert \u2013 Case Listed Today: {cn}'
    email_body = (
        f'Dear {recipient_name},\n\n'
        f'A tracked case has been listed in the court cause list.\n\n'
        f'Case Number: {cn}\n'
        f'CNR Number: {cnr}\n'
        f'Listed Date: {date}\n'
        f'Court Hall: {hall}\n'
        f'Item Number: {item}\n'
        f'Judge: {judge}\n'
        f'Petitioner: {pet}\n'
        f'Respondent: {resp}\n'
        f'Stage: {stage}\n\n'
        f'Please login to Litigo for complete details.\n\n'
        f'Regards,\nLitigo'
    )
    sms_body = (
        f'Litigo Alert\n'
        f'Case: {cn}\n'
        f'Listed Date: {date}\n'
        f'Court Hall: {hall}\n'
        f'Item No: {item}\n'
        f'Judge: {judge}\n'
        f'Please login to Litigo for details.'
    )
    wa_body = (
        f'\u2696\ufe0f Litigo Alert\n\n'
        f'A tracked case has been listed.\n\n'
        f'Case Number:\n{cn}\n\n'
        f'CNR Number:\n{cnr}\n\n'
        f'Listed Date:\n{date}\n\n'
        f'Court Hall:\n{hall}\n\n'
        f'Item Number:\n{item}\n\n'
        f'Judge:\n{judge}\n\n'
        f'Please login to Litigo for details.'
    )
    return email_subject, email_body, sms_body, wa_body


def _send_email(to: str, subject: str, body: str) -> Dict[str, Any]:
    """Send email via MailerSend."""
    api_key   = os.environ.get('MAILERSEND_API_KEY', '')
    from_addr = os.environ.get('EMAIL_FROM', 'notifications@litigo.in')
    from_name = os.environ.get('EMAIL_FROM_NAME', 'Litigo')
    if not api_key:
        return {'ok': False, 'error': 'MAILERSEND_API_KEY not set'}
    try:
        payload = {
            'from':     {'email': from_addr, 'name': from_name},
            'to':       [{'email': to}],
            'subject':  subject,
            'text':     body,
        }
        r = requests.post(
            MAILERSEND_URL,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type':  'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            json=payload,
            timeout=(5, 15),
        )
        resp = {}
        try:
            resp = r.json() if r.text else {}
        except Exception:
            resp = {'raw': r.text[:200]}
        return {'ok': r.ok, 'status_code': r.status_code, 'response': resp}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def _send_sms_twilio(to: str, body: str) -> Dict[str, Any]:
    """Send SMS via Twilio. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    and TWILIO_SMS_FROM (a purchased Twilio number, e.g. +15005550006).
    Trial accounts can only send to verified recipient numbers."""
    sid   = os.environ.get('TWILIO_ACCOUNT_SID', '')
    token = os.environ.get('TWILIO_AUTH_TOKEN', '')
    from_ = os.environ.get('TWILIO_SMS_FROM', '')
    if not sid or not token or not from_:
        return {'ok': False, 'error': 'TWILIO_SMS_FROM not configured'}
    try:
        r = requests.post(
            f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
            auth=(sid, token),
            data={'From': from_, 'To': to, 'Body': body},
            timeout=(5, 15),
        )
        resp = {}
        try:
            resp = r.json()
        except Exception:
            resp = {'raw': r.text[:200]}
        return {'ok': r.ok, 'status_code': r.status_code, 'response': resp}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def _send_whatsapp_twilio(to: str, body: str) -> Dict[str, Any]:
    """Send WhatsApp via Twilio. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    and TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886 for the sandbox)."""
    sid   = os.environ.get('TWILIO_ACCOUNT_SID', '')
    token = os.environ.get('TWILIO_AUTH_TOKEN', '')
    from_ = os.environ.get('TWILIO_WHATSAPP_FROM', '')
    if not sid or not token or not from_:
        return {'ok': False, 'error': 'TWILIO_WHATSAPP_FROM not configured'}
    wa_to = f'whatsapp:{to}' if not to.startswith('whatsapp:') else to
    try:
        r = requests.post(
            f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
            auth=(sid, token),
            data={'From': from_, 'To': wa_to, 'Body': body},
            timeout=(5, 15),
        )
        resp = {}
        try:
            resp = r.json()
        except Exception:
            resp = {'raw': r.text[:200]}
        return {'ok': r.ok, 'status_code': r.status_code, 'response': resp}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def _notify_listings(listed_date: str) -> None:
    """
    Send notifications for all today_matched_listings where notification_status = 'pending'.
    Called after a successful upsert.  Never raises \u2014 notification failures must not
    break the matching job.
    """
    try:
        # Get pending listings for today
        pending = _get_all('today_matched_listings', {
            'select': ('id,case_number,cnr_number,listed_date,court_hall,'
                       'item_number,judge_name,petitioner,respondent,stage'),
            'listed_date':         f'eq.{listed_date}',
            'notification_status': 'eq.pending',
        })
        if not pending:
            print(f'[notify] No pending listings for {listed_date}')
            return

        # Get active recipients
        recipients = _get_all('system_notification_recipients', {
            'select': ('id,name,email,mobile_number,whatsapp_number,'
                       'notify_email,notify_sms,notify_whatsapp'),
            'active': 'eq.true',
        })

        now_iso = datetime.now(timezone.utc).isoformat()

        if not recipients:
            # Mark all pending as no_recipients
            requests.patch(
                f'{SUPABASE_URL}/rest/v1/today_matched_listings',
                headers=_sb_headers(),
                params={'listed_date': f'eq.{listed_date}', 'notification_status': 'eq.pending'},
                json={'notification_status': 'no_recipients', 'notification_sent_at': now_iso},
                timeout=15,
            )
            print(f'[notify] No active recipients \u2014 marked {len(pending)} listings as no_recipients')
            return

        for match in pending:
            sent = 0
            failed = 0
            delivery_logs: List[Dict] = []

            for rec in recipients:
                email_subj, email_body, sms_body, wa_body = _build_messages(match, rec.get('name', ''))

                # ── Email ──────────────────────────────────────────────────────
                if rec.get('notify_email') and rec.get('email'):
                    result = _send_email(rec['email'], email_subj, email_body)
                    ok = result.get('ok', False)
                    delivery_logs.append({
                        'matched_listing_id': match['id'],
                        'recipient_id':       rec['id'],
                        'recipient_name':     rec.get('name', ''),
                        'channel':            'email',
                        'recipient_address':  rec['email'],
                        'subject':            email_subj,
                        'message':            email_body,
                        'status':             'sent' if ok else 'failed',
                        'provider':           'mailersend',
                        'provider_response':  result.get('response'),
                        'error_message':      result.get('error') if not ok else None,
                        'sent_at':            now_iso if ok else None,
                    })
                    if ok:
                        sent += 1
                    else:
                        failed += 1
                        print(f'[notify] Email failed for {rec.get("email")}: {result.get("error") or result.get("status_code")}')

                # ── SMS ────────────────────────────────────────────────────────
                if rec.get('notify_sms') and rec.get('mobile_number'):
                    result = _send_sms_twilio(rec['mobile_number'], sms_body)
                    ok = result.get('ok', False)
                    delivery_logs.append({
                        'matched_listing_id': match['id'],
                        'recipient_id':       rec['id'],
                        'recipient_name':     rec.get('name', ''),
                        'channel':            'sms',
                        'recipient_address':  rec['mobile_number'],
                        'subject':            None,
                        'message':            sms_body,
                        'status':             'sent' if ok else 'failed',
                        'provider':           'twilio',
                        'provider_response':  result.get('response'),
                        'error_message':      result.get('error') if not ok else None,
                        'sent_at':            now_iso if ok else None,
                    })
                    if ok:
                        sent += 1
                    else:
                        failed += 1

                # ── WhatsApp ───────────────────────────────────────────────────
                if rec.get('notify_whatsapp') and rec.get('whatsapp_number'):
                    result = _send_whatsapp_twilio(rec['whatsapp_number'], wa_body)
                    ok = result.get('ok', False)
                    delivery_logs.append({
                        'matched_listing_id': match['id'],
                        'recipient_id':       rec['id'],
                        'recipient_name':     rec.get('name', ''),
                        'channel':            'whatsapp',
                        'recipient_address':  rec['whatsapp_number'],
                        'subject':            None,
                        'message':            wa_body,
                        'status':             'sent' if ok else 'failed',
                        'provider':           'twilio',
                        'provider_response':  result.get('response'),
                        'error_message':      result.get('error') if not ok else None,
                        'sent_at':            now_iso if ok else None,
                    })
                    if ok:
                        sent += 1
                    else:
                        failed += 1

            # Insert delivery logs (fire-and-forget)
            if delivery_logs:
                try:
                    requests.post(
                        f'{SUPABASE_URL}/rest/v1/notification_delivery_logs',
                        headers=_sb_headers(),
                        json=delivery_logs,
                        timeout=15,
                    )
                except Exception:
                    pass

            # Determine final notification_status
            if sent > 0 and failed == 0:
                notif_status = 'notified'
            elif sent > 0 and failed > 0:
                notif_status = 'partial'
            elif failed > 0:
                notif_status = 'failed'
            else:
                notif_status = 'no_recipients'

            requests.patch(
                f'{SUPABASE_URL}/rest/v1/today_matched_listings',
                headers=_sb_headers(),
                params={'id': f'eq.{match["id"]}'},
                json={
                    'notification_status': notif_status,
                    'notification_sent_at': now_iso,
                    'notification_count':   sent,
                },
                timeout=15,
            )
            print(f'[notify] {match.get("case_number")} \u2192 {notif_status} (sent={sent}, failed={failed})')

    except Exception as exc:
        print(f'[notify] ERROR (non-fatal): {exc}')


# ── Vercel handler ─────────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            return self._json(
                {'success': False, 'message': 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.'},
                500,
            )

        today_ist = datetime.now(IST).date().isoformat()
        today     = _latest_cause_date(today_ist)
        if not today:
            return self._json({
                'success': True, 'match_date': today_ist,
                'cause_list_count': 0, 'cases_count': 0,
                'matched_count': 0, 'enriched_count': 0,
                'message': 'No cause list data available in the database.',
            })
        print(f'[match] Using cause_date={today!r} (IST date={today_ist!r})')

        try:
            # 1. Cause list for this date
            cause_list = _get_all('daily_cause_list', {
                'select': ('id,case_number,cnr_number,court_hall,item_number,'
                           'judge_name,last_hearing_or_stage,petitioner,respondent'),
                'cause_date': f'eq.{today}',
                'order':      'court_hall.asc,item_number.asc',
            })

            if not cause_list:
                return self._json({
                    'success': True, 'match_date': today,
                    'cause_list_count': 0, 'cases_count': 0,
                    'matched_count': 0, 'enriched_count': 0,
                    'message': f'No cause list data found for {today}.',
                })

            # 2. All active tracked cases
            cases = _get_all('cases', {
                'select': 'id,organization_id,case_number,cnr_number',
                'active': 'eq.true',
            })

            # 3. Build cause list lookup maps
            cl_by_cnr:  Dict[str, Dict] = {}
            cl_by_norm: Dict[str, Dict] = {}
            for cl in cause_list:
                raw_cnr = (cl.get('cnr_number') or '').strip()
                if raw_cnr:
                    cl_by_cnr[raw_cnr.lower()] = cl
                norm_cn = normalize_case_number(cl.get('case_number') or '')
                if norm_cn:
                    cl_by_norm[norm_cn] = cl

            # 4. Match each case against the cause list
            base_matches: List[Dict] = []
            seen: set = set()

            for c in cases:
                matched_cl: Optional[Dict] = None
                match_type = 'case_number'
                case_cnr   = (c.get('cnr_number') or '').strip()

                if case_cnr and case_cnr.lower() in cl_by_cnr:
                    matched_cl = cl_by_cnr[case_cnr.lower()]
                    match_type = 'cnr'

                if not matched_cl:
                    norm_c = normalize_case_number(c.get('case_number') or '')
                    if norm_c and norm_c in cl_by_norm:
                        matched_cl = cl_by_norm[norm_c]
                    elif norm_c:
                        print(
                            f'[match] NO MATCH: '
                            f'case={c.get("case_number")!r} norm={norm_c!r} '
                            f'cnr={case_cnr!r}'
                        )

                if not matched_cl:
                    continue

                pair = (c['id'], matched_cl['id'])
                if pair in seen:
                    continue
                seen.add(pair)

                cl_norm = normalize_case_number(matched_cl.get('case_number') or '')
                c_norm  = normalize_case_number(c.get('case_number') or '')
                print(
                    f'[match] MATCH ({match_type}): '
                    f'CL={matched_cl.get("case_number")!r}({cl_norm}) | '
                    f'CASE={c.get("case_number")!r}({c_norm}) | CNR={case_cnr!r}'
                )

                item_raw = matched_cl.get('item_number')
                base_matches.append({
                    'listed_date':         today,
                    'match_date':          today,
                    'case_id':             c['id'],
                    'daily_cause_list_id': matched_cl['id'],
                    'case_number':         matched_cl.get('case_number'),
                    'cnr_number':          case_cnr or None,
                    'court_hall':          matched_cl.get('court_hall'),
                    'item_number':         str(item_raw).strip() if item_raw is not None else None,
                    'judge_name':          matched_cl.get('judge_name'),
                    'stage':               matched_cl.get('last_hearing_or_stage'),
                    'petitioner':          matched_cl.get('petitioner'),
                    'respondent':          matched_cl.get('respondent'),
                    'match_type':          match_type,
                    'match_status':        'matched',
                    'notification_status': 'pending',
                    'cnr_status':          'discovered' if case_cnr else 'not_discovered',
                    'ecourts_sync_status': 'pending',
                })

            # 5. Enrich matches with eCourts hearing history
            enriched_matches, enriched_count = _enrich_all(base_matches)

            # 6. Upsert all records (historical records on other dates are untouched)
            inserted = 0
            for i in range(0, len(enriched_matches), BATCH_SIZE):
                inserted += _safe_upsert_batch(enriched_matches[i:i + BATCH_SIZE])

            # 7. Send automatic notifications for newly matched listings (non-blocking)
            if inserted > 0:
                _notify_listings(today)

            self._json({
                'success':          True,
                'match_date':       today,
                'cause_list_count': len(cause_list),
                'cases_count':      len(cases),
                'matched_count':    inserted,
                'enriched_count':   enriched_count,
            })

        except Exception as exc:
            self._json({'success': False, 'message': str(exc)}, 500)

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
