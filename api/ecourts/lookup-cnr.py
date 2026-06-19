"""Vercel serverless: POST /api/ecourts/lookup-cnr

Step 1 of the two-step eCourts lookup.
Given a case_number (e.g. "WP/1234/2025"), resolves it to a CNR number.
Returns a captcha challenge first if required; once solved returns the CNR.

Request:  { case_number, captcha?, captcha_token? }
Response (captcha needed): { success: false, requiresCaptcha: true,
                             captchaImage, captchaToken, message, caseNumber }
Response (success):        { success: true, cnr_number, case_number }
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ECOURTS_BASE_URL = "https://hcservices.ecourts.gov.in"
ECOURTS_MAIN_URL = f"{ECOURTS_BASE_URL}/hcservices/main.php?v=1"
ECOURTS_CASE_URL = (
    f"{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords"
)
CASE_TYPE_MAPPING: Dict[str, str] = {"WP": "49"}
REQUEST_TIMEOUT = (10, 50)
CAPTCHA_TOKEN_TTL = timedelta(minutes=10)


def _session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=2,
        backoff_factor=1,
        status_forcelist=[429, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    return s


def _clean(v: Any) -> str:
    return " ".join(str(v or "").split()).strip()


def _parse_case_number(s: str) -> Optional[Tuple[str, str, str]]:
    cleaned = _clean(s).replace(" ", "")
    parts = [p for p in cleaned.split("/") if p]
    if len(parts) != 3:
        return None
    ct = parts[0].upper()
    cn = re.sub(r"\D", "", parts[1])
    cy = re.sub(r"\D", "", parts[2])
    return (ct, cn, cy) if ct and cn and cy else None


def _captcha_challenge() -> Dict[str, Any]:
    session = _session()
    r = session.get(
        ECOURTS_MAIN_URL,
        headers={"User-Agent": "Mozilla/5.0", "Referer": ECOURTS_BASE_URL + "/"},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    img_tag = soup.find("img", id="captcha_image")
    if not img_tag or not img_tag.get("src"):
        raise ValueError("Cannot find captcha image on eCourts page.")
    img_url = urljoin(r.url, str(img_tag["src"]))
    img_r = session.get(
        img_url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": ECOURTS_MAIN_URL,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=REQUEST_TIMEOUT,
    )
    img_r.raise_for_status()
    mime = img_r.headers.get("Content-Type") or "image/png"
    cookies_list = [
        {"name": c.name, "value": c.value, "domain": c.domain or "", "path": c.path or "/"}
        for c in session.cookies
    ]
    token_payload = {
        "cookies": cookies_list,
        "expires": (datetime.utcnow() + CAPTCHA_TOKEN_TTL).isoformat(),
    }
    token = base64.b64encode(json.dumps(token_payload).encode()).decode("ascii")
    return {
        "captchaToken": token,
        "captchaImage": f"data:{mime};base64,{base64.b64encode(img_r.content).decode('ascii')}",
    }


def _session_from_token(token: str) -> requests.Session:
    try:
        data = json.loads(base64.b64decode(token).decode())
    except Exception:
        raise ValueError("Invalid captcha token.")
    try:
        expires = datetime.fromisoformat(data.get("expires", "2000-01-01"))
    except ValueError:
        raise ValueError("Invalid token expiry.")
    if datetime.utcnow() > expires:
        raise ValueError("Captcha token expired.")
    session = _session()
    cookies = data.get("cookies", [])
    if isinstance(cookies, dict):
        session.cookies.update(cookies)
    else:
        for c in cookies:
            session.cookies.set(
                c["name"], c["value"],
                domain=c.get("domain") or "",
                path=c.get("path") or "/",
            )
    return session


def _extract_cnr(body: str) -> Optional[str]:
    try:
        root = json.loads(body)
    except Exception:
        return None
    if not isinstance(root, dict) or root.get("Error"):
        return None
    con = root.get("con")
    if not con:
        return None
    if isinstance(con, str):
        try:
            con = json.loads(con)
        except Exception:
            return None
    if not isinstance(con, list) or not con:
        return None
    cnr = _clean(con[0].get("cino") or con[0].get("cnr_number") or "")
    return cnr or None


def _is_bad_captcha(html: str) -> bool:
    lo = html.lower()
    return "captcha" in lo and any(
        w in lo
        for w in [
            "invalid captcha",
            "incorrect captcha",
            "captcha does not match",
            "enter captcha",
            "wrong captcha",
        ]
    )


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            data = json.loads(body)
        except Exception:
            return self._json({"success": False, "message": "Invalid request body."}, 400)

        case_number = _clean(data.get("case_number") or "").upper()
        captcha = _clean(data.get("captcha") or "")
        captcha_token = _clean(data.get("captcha_token") or "")

        if not case_number:
            return self._json({"success": False, "message": "case_number is required."}, 400)

        parsed = _parse_case_number(case_number)
        if not parsed:
            return self._json({
                "success": False,
                "message": (
                    f"Cannot parse case number '{case_number}'. "
                    "Expected format: TYPE/NUMBER/YEAR (e.g. WP/1234/2025)."
                ),
            })

        case_type, case_no, case_year = parsed
        code = CASE_TYPE_MAPPING.get(case_type)
        if not code:
            return self._json({
                "success": False,
                "error": "CASE_TYPE_MAPPING_NOT_FOUND",
                "parsedCaseType": case_type,
                "message": f"Case type '{case_type}' is not yet supported for CNR lookup.",
            })

        def _new_captcha(msg: str) -> None:
            try:
                ch = _captcha_challenge()
                self._json({
                    "success": False,
                    "requiresCaptcha": True,
                    "message": msg,
                    "caseNumber": case_number,
                    **ch,
                })
            except Exception as exc:
                self._json({"success": False, "message": f"Unable to load captcha: {exc}"})

        if not captcha:
            return _new_captcha("Captcha required to resolve CNR from case number.")

        if not captcha_token:
            return _new_captcha("Captcha session missing. Please enter the new captcha.")

        try:
            session = _session_from_token(captcha_token)
        except ValueError:
            return _new_captcha("Captcha session expired. Please try again.")

        try:
            resp = session.post(
                ECOURTS_CASE_URL,
                data={
                    "action_code": "showRecords",
                    "court_code": "1",
                    "state_code": "10",
                    "court_complex_code": "1",
                    "caseStatusSearchType": "CScaseNumber",
                    "captcha": captcha,
                    "case_type": code,
                    "case_no": case_no,
                    "rgyear": case_year,
                    "caseNoType": "new",
                    "displayOldCaseNo": "NO",
                },
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Origin": ECOURTS_BASE_URL,
                    "Referer": ECOURTS_MAIN_URL,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            return self._json({"success": False, "message": f"eCourts did not respond: {exc}"})

        if _is_bad_captcha(resp.text):
            return _new_captcha("Invalid captcha. Please try again.")

        cnr = _extract_cnr(resp.text)
        if not cnr:
            return self._json({
                "success": False,
                "message": (
                    "Case not found or CNR not returned by eCourts. "
                    "Please verify the case number."
                ),
            })

        self._json({"success": True, "cnr_number": cnr, "case_number": case_number})

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
