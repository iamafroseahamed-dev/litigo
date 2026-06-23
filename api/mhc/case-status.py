"""Vercel serverless function: POST /api/mhc/case-status

Calls the Madras High Court viewstatus endpoint directly.
Returns JSON with order details + ready-to-use pdf_url.

Payload: { "case_number": "WP/1141/2025" }
"""
from __future__ import annotations

import json
import re
import warnings
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple

import requests

# Suppress SSL warnings without requiring urllib3 as a top-level import
warnings.filterwarnings('ignore', message='Unverified HTTPS request')

MHC_VIEWSTATUS = 'https://www.mhc.tn.gov.in/judis/index.php/casestatus/viewstatus'
MHC_VIEWPDF    = 'https://www.mhc.tn.gov.in/judis/index.php/casestatus/viewpdf'


def _parse(case_number: str) -> Optional[Tuple[str, str, str]]:
    """'WP/1141/2025' → ('WP', '1141', '2025')"""
    cleaned = re.sub(r'\s+', '/', case_number.strip()).upper()
    parts   = [p.strip() for p in cleaned.split('/') if p.strip()]
    if len(parts) < 3:
        return None
    ct  = re.sub(r'[^A-Z]', '', parts[0])
    cno = re.sub(r'\D', '', parts[1])
    yr  = re.sub(r'\D', '', parts[2])
    return (ct, cno, yr) if ct and cno and yr else None


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            self._handle()
        except Exception as exc:
            self._json({'success': False, 'message': f'Unexpected error: {exc}'}, 500)

    def _handle(self) -> None:
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._json({'success': False, 'message': 'Invalid JSON body.'}, 400)
            return

        case_number = (body.get('case_number') or '').strip()
        if not case_number:
            self._json({'success': False, 'message': 'case_number is required.'}, 400)
            return

        parsed = _parse(case_number)
        if not parsed:
            self._json({
                'success': False,
                'message': f'Cannot parse "{case_number}". Expected format: TYPE/NUMBER/YEAR',
            }, 400)
            return

        casetype, cno, cyear = parsed

        try:
            resp = requests.post(
                MHC_VIEWSTATUS,
                data={'cno': cno, 'cyear': cyear, 'reportable': 'A', 'casetype': casetype},
                headers={
                    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer':         'https://www.mhc.tn.gov.in/',
                    'Origin':          'https://www.mhc.tn.gov.in',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept':          'application/json, text/javascript, */*; q=0.01',
                    'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
                },
                timeout=(15, 25),
                verify=False,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.Timeout:
            self._json({'success': False, 'message': 'MHC server did not respond in time. Please try again.'}, 504)
            return
        except requests.exceptions.ConnectionError:
            self._json({'success': False, 'message': 'Could not reach the MHC server. Please try again later.'}, 503)
            return
        except requests.RequestException as exc:
            self._json({'success': False, 'message': f'MHC request failed: {exc}'}, 503)
            return
        except Exception as exc:
            self._json({'success': False, 'message': f'Failed to parse MHC response: {exc}'}, 502)
            return

        # Enrich each row with a ready-to-use pdf_url
        rows: List[Dict[str, Any]] = data.get('main_tb') or []
        for row in rows:
            fn = (row.get('filename') or '').strip()
            row['pdf_url'] = f'{MHC_VIEWPDF}/{fn}' if fn else None

        self._json({
            'success': True,
            'case_number': case_number,
            'main_cnt': data.get('main_cnt'),
            'orders': rows,
        })

    def _json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: Any) -> None:
        pass
