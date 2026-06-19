"""Vercel serverless function: GET /api/todays-cause-list

Reads cause list data exclusively from Supabase.
Returns today's records or the most recent available date if today has none.

To populate the database, import the MHC cause list XML into the
daily_cause_list table in Supabase (e.g. via the Supabase dashboard
or a separate admin import script).
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List
from urllib.parse import urlparse

import requests

# ── Supabase credentials (set in Vercel: Settings → Environment Variables) ────
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

_COLS = (
    'cause_date,court_name,bench,court_hall,item_number,case_number,'
    'cnr_number,petitioner,respondent,party_names,judge_name,'
    'last_hearing_or_stage,counsel_name'
)
_TIMEOUT = 30


def _headers() -> dict:
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _fetch_date(cause_date: str) -> List[Dict[str, Any]]:
    """Return all rows for a specific cause_date (paginated)."""
    all_rows: List[Dict[str, Any]] = []
    page_size, offset = 1000, 0
    base = f'{SUPABASE_URL}/rest/v1/daily_cause_list'
    while True:
        url = (
            f'{base}?cause_date=eq.{cause_date}'
            '&court_name=eq.Madras%20High%20Court&bench=eq.Chennai'
            f'&select={_COLS}'
            '&order=court_hall.asc,item_number.asc'
            f'&limit={page_size}&offset={offset}'
        )
        resp = requests.get(url, headers=_headers(), timeout=_TIMEOUT)
        resp.raise_for_status()
        page = resp.json() or []
        all_rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return all_rows


def _latest_date(up_to: str):
    """Return the most recent cause_date in Supabase that is <= up_to."""
    url = (
        f'{SUPABASE_URL}/rest/v1/daily_cause_list'
        f'?cause_date=lte.{up_to}'
        '&court_name=eq.Madras%20High%20Court&bench=eq.Chennai'
        '&select=cause_date&order=cause_date.desc&limit=1'
    )
    resp = requests.get(url, headers=_headers(), timeout=_TIMEOUT)
    resp.raise_for_status()
    rows = resp.json() or []
    return rows[0]['cause_date'] if rows else None


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            self._json({
                'detail': (
                    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in '
                    'Vercel project settings -> Environment Variables.'
                )
            }, 503)
            return

        today = date.today().isoformat()
        print(f'[cause-list] {datetime.utcnow().isoformat()} | Supabase | date={today}')

        try:
            latest = _latest_date(today)
            if not latest:
                self._json({
                    'detail': (
                        'No cause list data found in the database. '
                        'Import data into the daily_cause_list table in Supabase.'
                    )
                }, 404)
                return

            rows = _fetch_date(latest)
            if not rows:
                self._json({'detail': 'No records found for the latest available date.'}, 404)
                return

            print(f'[cause-list] Returned {len(rows)} rows for {latest}')
            self._json(rows)

        except Exception as exc:
            print(f'[cause-list] Error: {exc}')
            self._json({'detail': f'Failed to read from database: {exc}'}, 503)

    def _json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: Any) -> None:
        pass
