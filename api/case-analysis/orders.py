"""Vercel serverless function: POST /api/case-analysis/orders

Fetches the Madras High Court order list for a case and best-effort extracts a
short text excerpt from each order PDF. Designed to be called ONCE per case;
the frontend caches the result permanently in case_ai_analysis.parsed_orders so
orders are never downloaded or parsed again.

Payload: { "caseNumber": "WP/1141/2025", "limit": 8 }
Response: { "success": true, "orders": [ { order_date, order_type, judge, pdf_url, summary } ] }
"""
from __future__ import annotations

import io
import json
import re
import warnings
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple

import requests

warnings.filterwarnings('ignore', message='Unverified HTTPS request')

MHC_VIEWSTATUS = 'https://www.mhc.tn.gov.in/judis/index.php/casestatus/viewstatus'
MHC_VIEWPDF = 'https://www.mhc.tn.gov.in/judis/index.php/casestatus/viewpdf'

_BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.mhc.tn.gov.in/',
    'Origin': 'https://www.mhc.tn.gov.in',
}


def _parse(case_number: str) -> Optional[Tuple[str, str, str]]:
    s = (case_number or '').strip().upper()
    parts = [p.strip() for p in s.split('/') if p.strip()]
    if len(parts) < 3:
        parts = [p.strip() for p in re.sub(r'\s+', '/', s).split('/') if p.strip()]
    if len(parts) < 3:
        return None
    yr = re.sub(r'\D', '', parts[-1])
    cno = re.sub(r'\D', '', parts[-2])
    ct = re.sub(r'[^A-Z ]', '', '/'.join(parts[:-2])).strip()
    return (ct, cno, yr) if ct and cno and yr else None


def _extract_pdf_text(pdf_url: str, max_chars: int = 1200) -> str:
    """Best-effort PDF text extraction. Returns '' if the PDF is unreachable or
    is a scanned image with no embedded text."""
    try:
        from pypdf import PdfReader
    except Exception:
        return ''
    try:
        resp = requests.get(pdf_url, headers={**_BROWSER_HEADERS, 'Accept': 'application/pdf'}, timeout=(15, 30), verify=False)
        resp.raise_for_status()
        reader = PdfReader(io.BytesIO(resp.content))
        chunks: List[str] = []
        for page in reader.pages[:5]:
            try:
                chunks.append(page.extract_text() or '')
            except Exception:
                continue
        text = re.sub(r'\s+', ' ', ' '.join(chunks)).strip()
        return text[:max_chars]
    except Exception:
        return ''


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            self._handle()
        except Exception as exc:
            self._json({'success': False, 'message': f'Unexpected error: {exc}'}, 500)

    def _handle(self) -> None:
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            self._json({'success': False, 'message': 'Invalid JSON body.'}, 400)
            return

        case_number = str(body.get('caseNumber') or '').strip()
        if not case_number:
            self._json({'success': False, 'message': 'caseNumber is required.'}, 400)
            return

        try:
            limit = int(body.get('limit') or 8)
        except (TypeError, ValueError):
            limit = 8
        limit = max(1, min(limit, 12))

        parsed = _parse(case_number)
        if not parsed:
            # Not an MHC-style case number — nothing to fetch, but not an error.
            self._json({'success': True, 'orders': [], 'note': 'Case number is not in MHC TYPE/NUMBER/YEAR format.'})
            return

        casetype, cno, cyear = parsed
        try:
            resp = requests.post(
                MHC_VIEWSTATUS,
                data={'cno': cno, 'cyear': cyear, 'reportable': 'A', 'casetype': casetype},
                headers={
                    **_BROWSER_HEADERS,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
                timeout=(15, 25),
                verify=False,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.Timeout:
            self._json({'success': False, 'message': 'MHC server did not respond in time.'}, 504)
            return
        except requests.exceptions.ConnectionError:
            self._json({'success': False, 'message': 'Could not reach the MHC server.'}, 503)
            return
        except requests.RequestException as exc:
            self._json({'success': False, 'message': f'MHC request failed: {exc}'}, 503)
            return
        except Exception as exc:
            self._json({'success': False, 'message': f'Failed to parse MHC response: {exc}'}, 502)
            return

        rows: List[Dict[str, Any]] = data.get('main_tb') or []
        orders: List[Dict[str, Any]] = []
        for row in rows[:limit]:
            fn = str(row.get('filename') or '').strip()
            pdf_url = f'{MHC_VIEWPDF}/{fn}' if fn else None
            summary = _extract_pdf_text(pdf_url) if pdf_url else ''
            orders.append({
                'order_date': row.get('juddate') or row.get('orderdate') or None,
                'order_type': row.get('casetype_t') or row.get('ordertype') or None,
                'judge': row.get('jud1') or None,
                'pdf_url': pdf_url,
                'summary': summary or None,
            })

        self._json({'success': True, 'orders': orders, 'count': len(orders)})

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
