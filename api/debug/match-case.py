"""Vercel serverless: GET /api/debug/match-case?case_number=WA/1141/2025

Diagnostic endpoint — never called from the frontend UI.
Returns normalisation details and whether the supplied case number would
match anything in today's cause list and/or the cases table.

Response shape:
{
  "input":             "WA/1141/2025",
  "normalizedInput":   "WA/1141/2025",
  "causeListMatches":  [ { "original", "normalized", "court_hall", ... } ],
  "caseTableMatches":  [ { "original", "normalized", "id", "cnr_number" } ],
  "wouldMatch":        true,
  "matchDate":         "2026-06-20"
}
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs

import requests

# ── Shared config ──────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
IST          = timezone(timedelta(hours=5, minutes=30))
PAGE_SIZE    = 1000


def _sb_headers() -> Dict[str, str]:
    return {
        'apikey':        SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type':  'application/json',
        'Prefer':        'count=none',
    }


def _get_all(table: str, params: Dict[str, str]) -> List[Dict]:
    rows: List[Dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f'{SUPABASE_URL}/rest/v1/{table}',
            headers={**_sb_headers(), 'Range-Unit': 'items',
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


# ── Normalisation (duplicated from match-todays-listings.py) ──────────────────

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
        case_type = parts[0]
        case_no   = re.sub(r'\D', '', parts[1]).lstrip('0') or '0'
        case_year = re.sub(r'\D', '', parts[2])
        if case_type and case_no and re.match(r'^\d{2,4}$', case_year):
            return f'{case_type}/{case_no}/{case_year}'
    return re.sub(r'[^A-Z0-9]', '', s)


# ── Handler ────────────────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed    = urlparse(self.path)
        qs        = parse_qs(parsed.query)
        raw_input = (qs.get('case_number') or [''])[0].strip()

        if not raw_input:
            return self._json(
                {'error': 'Provide ?case_number=TYPE/NUMBER/YEAR in the URL.'},
                400,
            )

        if not SUPABASE_URL or not SUPABASE_KEY:
            return self._json({'error': 'Supabase credentials not configured.'}, 503)

        today          = datetime.now(IST).date().isoformat()
        normalized_in  = normalize_case_number(raw_input)

        try:
            # Today's cause list
            cause_list = _get_all('daily_cause_list', {
                'select':     'id,case_number,cnr_number,court_hall,item_number,judge_name',
                'cause_date': f'eq.{today}',
            })

            # All active cases
            cases = _get_all('cases', {
                'select': 'id,case_number,cnr_number,organization_id',
                'active': 'eq.true',
            })
        except Exception as exc:
            return self._json({'error': f'Supabase error: {exc}'}, 502)

        # Find cause list rows that would match
        cl_matches: List[Dict] = []
        for cl in cause_list:
            norm_cl = normalize_case_number(cl.get('case_number') or '')
            if norm_cl == normalized_in:
                cl_matches.append({
                    'original':   cl.get('case_number'),
                    'normalized': norm_cl,
                    'cnr_number': cl.get('cnr_number'),
                    'court_hall': cl.get('court_hall'),
                    'item_number': cl.get('item_number'),
                    'judge_name': cl.get('judge_name'),
                })

        # Find cases that would match
        case_matches: List[Dict] = []
        for c in cases:
            norm_c = normalize_case_number(c.get('case_number') or '')
            if norm_c == normalized_in:
                case_matches.append({
                    'id':         c.get('id'),
                    'original':   c.get('case_number'),
                    'normalized': norm_c,
                    'cnr_number': c.get('cnr_number'),
                })

        # Sample of what other cause list normalizations look like
        cl_sample = [
            {'original': cl.get('case_number'),
             'normalized': normalize_case_number(cl.get('case_number') or '')}
            for cl in cause_list[:20]
        ]

        self._json({
            'input':            raw_input,
            'normalizedInput':  normalized_in,
            'matchDate':        today,
            'causeListTotal':   len(cause_list),
            'casesTotal':       len(cases),
            'causeListMatches': cl_matches,
            'caseTableMatches': case_matches,
            'wouldMatch':       bool(cl_matches and case_matches),
            'causeListSample':  cl_sample,
        })

    def _json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
