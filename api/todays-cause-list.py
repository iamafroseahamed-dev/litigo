"""Vercel serverless function: GET /api/todays-cause-list

Fast path  → read today's rows from Supabase (sub-second).
Slow path  → download XML from MHC, store in Supabase, return rows.
             Only runs once per day (first request) or after a forced refresh
             (?refresh=1 query parameter).
"""
from __future__ import annotations

import json
import os
import xml.etree.ElementTree as ET
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Set, Tuple
from urllib.parse import parse_qs, urlparse

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Supabase config ────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get(
    'SUPABASE_URL',
    'https://iyohifpzsqjxcrgrtsza.supabase.co',
)
SUPABASE_KEY = os.environ.get(
    'SUPABASE_SERVICE_ROLE_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5b2hpZnB6c3FqeGNyZ3J0c3phIiwicm9sZSI6'
    'InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU4OTQ1MiwiZXhwIjoyMDk3MTY1NDUyfQ.'
    'BLz5-PeIc5TTjSAiYuWxnGgJYrVnqjh0RYwdirJn_50',
)
_SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}
SB_TIMEOUT  = 30
BATCH_SIZE  = 500
MHC_XML_BASE = (
    'https://mhc.tn.gov.in/judis/clists/clists-madras/causelists/xml/cause_{date}.xml'
)


# ── Supabase helpers ───────────────────────────────────────────────────────────

def _sb_fetch_today(cause_date: str) -> List[Dict[str, Any]]:
    url = (
        f'{SUPABASE_URL}/rest/v1/daily_cause_list'
        f'?cause_date=eq.{cause_date}'
        '&court_name=eq.Madras%20High%20Court'
        '&bench=eq.Chennai'
        '&order=court_hall.asc,item_number.asc'
        '&limit=10000'
    )
    resp = requests.get(url, headers=_SB_HEADERS, timeout=SB_TIMEOUT)
    resp.raise_for_status()
    return resp.json() or []


def _sb_delete_today(cause_date: str) -> None:
    url = (
        f'{SUPABASE_URL}/rest/v1/daily_cause_list'
        f'?cause_date=eq.{cause_date}'
        '&court_name=eq.Madras%20High%20Court'
        '&bench=eq.Chennai'
    )
    resp = requests.delete(url, headers=_SB_HEADERS, timeout=SB_TIMEOUT)
    resp.raise_for_status()


def _sb_insert(rows: List[Dict[str, Any]]) -> None:
    url = f'{SUPABASE_URL}/rest/v1/daily_cause_list'
    headers = {**_SB_HEADERS, 'Prefer': 'return=minimal'}
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        resp = requests.post(url, headers=headers, json=batch, timeout=SB_TIMEOUT)
        resp.raise_for_status()


# ── XML parser ─────────────────────────────────────────────────────────────────


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


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        today      = date.today()
        cause_date = today.isoformat()
        qs         = parse_qs(urlparse(self.path).query)
        force      = qs.get('refresh', ['0'])[0] == '1'

        print(f'[cause-list] {datetime.utcnow().isoformat()} | date={cause_date} | force={force}')

        # ── Fast path: Supabase ────────────────────────────────────────────────
        if not force:
            try:
                rows = _sb_fetch_today(cause_date)
                if rows:
                    print(f'[cause-list] Supabase hit: {len(rows)} rows')
                    self._json(rows)
                    return
                print('[cause-list] Supabase miss — fetching from MHC')
            except Exception as exc:
                print(f'[cause-list] Supabase read failed ({exc}) — falling back to MHC')
        else:
            print('[cause-list] Force refresh — skipping Supabase cache')

        # ── Slow path: download XML from MHC ──────────────────────────────────
        xml_url = MHC_XML_BASE.format(date=today.strftime('%d%m%Y'))
        print(f'[cause-list] Downloading: {xml_url}')

        try:
            xml_resp = requests.get(xml_url, timeout=(10, 55), verify=False)
            xml_resp.raise_for_status()
            print(f'[cause-list] HTTP {xml_resp.status_code}')
        except requests.exceptions.Timeout as exc:
            self._json({'detail': f"MHC XML timed out: {exc}"}, 504)
            return
        except requests.RequestException as exc:
            self._json({'detail': f"MHC XML unavailable: {exc}"}, 503)
            return

        try:
            parsed_rows = _parse_mhc_xml(xml_resp.content, cause_date, xml_url)
        except ET.ParseError as exc:
            preview = xml_resp.content[:200].decode('utf-8', errors='replace')
            self._json({'detail': f'XML malformed: {exc} | preview: {preview}'}, 502)
            return
        except Exception as exc:
            self._json({'detail': f'XML parse error: {exc}'}, 502)
            return

        if not parsed_rows:
            self._json({'detail': "No records found in today's cause list."}, 404)
            return

        print(f'[cause-list] Parsed {len(parsed_rows)} rows — storing in Supabase')

        # ── Store in Supabase (errors are non-fatal) ──────────────────────────
        try:
            if force:
                _sb_delete_today(cause_date)
            _sb_insert(parsed_rows)
            print('[cause-list] Supabase write OK')
        except Exception as exc:
            print(f'[cause-list] Supabase write failed ({exc}) — returning data anyway')

        self._json(parsed_rows)

    def _json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: Any) -> None:  # suppress default access logs
        pass
