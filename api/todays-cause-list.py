"""Vercel serverless function: GET /api/todays-cause-list

Downloads and parses today's Madras High Court cause list XML.
Returns a JSON array of cause list records (same shape as backend/app.py).
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Set, Tuple

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        today = date.today()
        cause_date_str = today.isoformat()
        date_for_url = today.strftime('%d%m%Y')
        xml_url = MHC_XML_BASE.format(date=date_for_url)

        print(f'[cause-list] Timestamp: {datetime.utcnow().isoformat()}')
        print(f'[cause-list] Downloading XML: {xml_url}')

        try:
            xml_resp = requests.get(xml_url, timeout=(10, 30), verify=False)
            xml_resp.raise_for_status()
            print(f'[cause-list] XML Download Status: {xml_resp.status_code}')
        except requests.RequestException as exc:
            self._json({'detail': f"Today's cause list XML is not available: {exc}"}, 503)
            return

        try:
            parsed_rows = _parse_mhc_xml(xml_resp.content, cause_date_str, xml_url)
        except ET.ParseError as exc:
            preview = xml_resp.content[:200].decode('utf-8', errors='replace')
            self._json({
                'detail': (
                    f'Cause list XML is malformed or not yet published '
                    f'(ParseError: {exc}). Response preview: {preview}'
                ),
            }, 502)
            return
        except Exception as exc:
            self._json({'detail': f'Failed to parse cause list XML: {exc}'}, 502)
            return

        if not parsed_rows:
            self._json({'detail': "No records found in today's cause list XML."}, 404)
            return

        print(f'[cause-list] Parsed Rows: {len(parsed_rows)}')
        print(f'[cause-list] Returned Rows: {len(parsed_rows)}')

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
