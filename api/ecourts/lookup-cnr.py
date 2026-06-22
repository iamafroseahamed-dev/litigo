"""Vercel serverless: POST /api/ecourts/lookup-cnr

Step 1 of the two-step eCourts lookup.
Given a case_number (e.g. "WP/1234/2025"), resolves it to a CNR number.
Returns a captcha challenge first if required; once solved returns the CNR.

Request:  { case_number, captcha?, captcha_token? }
Response (captcha needed): { success: false, requiresCaptcha: true,
                             captchaImage, captchaToken, message, caseNumber }
Response (success):        { success: true, cnr_number, ecourts_case_no,
                             case_number }
"""
from __future__ import annotations

import base64
import json
import random
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
ECOURTS_ROOT_URL = f"{ECOURTS_BASE_URL}/"
ECOURTS_MAIN_URL = f"{ECOURTS_BASE_URL}/hcservices/main.php?v=1"
ECOURTS_CAPTCHA_URL = f"{ECOURTS_BASE_URL}/hcservices/securimage/securimage_show.php"
ECOURTS_CASE_URL = (
    f"{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords"
)
# Fallback map used only when the eCourts form does not expose the dropdown.
# Runtime codes are scraped from the <select> element on first request.
_CASE_TYPE_FALLBACK: Dict[str, str] = {"WP": "49"}
# Keep well within Vercel's 60 s maxDuration: (5 + 22) × 2 attempts = 54 s.
REQUEST_TIMEOUT = (5, 22)
CAPTCHA_TOKEN_TTL = timedelta(minutes=10)


def _session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0,
        status_forcelist=[429, 503, 504],
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
    """
    Three-step captcha setup following the eCourts discovery flow:
      1. GET root URL — captures HCSERVICES_SESSID / JSESSION cookies.
      2. GET main.php  — scrapes the case-type <select> dropdown.
      3. GET securimage_show.php?{random} — fetches the captcha image.
    """
    session = _session()

    # Step 1: establish session cookies (HCSERVICES_SESSID, JSESSION)
    try:
        session.get(
            ECOURTS_ROOT_URL,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=REQUEST_TIMEOUT,
        )
    except Exception:
        pass  # non-fatal — cookies may still arrive from main.php

    # Step 2: load main.php to scrape the case-type dropdown
    r = session.get(
        ECOURTS_MAIN_URL,
        headers={"User-Agent": "Mozilla/5.0", "Referer": ECOURTS_ROOT_URL},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    casetype_map: Dict[str, str] = {}
    ct_select = soup.find("select", attrs={"name": "case_type"})
    if ct_select:
        for opt in ct_select.find_all("option"):
            val = str(opt.get("value") or "").strip()
            if not val or val == "0":
                continue
            text = opt.get_text(strip=True)
            abbr = text.split("-")[0].split("(")[0].strip().upper()
            if abbr:
                casetype_map[abbr] = val

    # Step 3: fetch captcha image with a random cache-buster parameter
    rand_val = random.random()
    img_r = session.get(
        f"{ECOURTS_CAPTCHA_URL}?{rand_val}",
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
        "casetype_map": casetype_map,
        "expires": (datetime.utcnow() + CAPTCHA_TOKEN_TTL).isoformat(),
    }
    token = base64.b64encode(json.dumps(token_payload).encode()).decode("ascii")
    return {
        "captchaToken": token,
        "captchaImage": f"data:{mime};base64,{base64.b64encode(img_r.content).decode('ascii')}",
        "_casetype_map": casetype_map,  # internal — stripped before sending to client
    }


def _session_from_token(token: str) -> Tuple[requests.Session, Dict[str, str]]:
    """Decode a captcha token. Returns (session_with_cookies, casetype_map)."""
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
    return session, data.get("casetype_map", {})


def _extract_cnr_and_case_no(body: str) -> Optional[Dict[str, str]]:
    """Parse eCourts JSON response and return {cnr_number, ecourts_case_no} or None."""
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
    first = con[0]
    cnr      = _clean(first.get("cino") or first.get("cnr_number") or "")
    case_no  = _clean(first.get("case_no") or "")
    return {"cnr_number": cnr, "ecourts_case_no": case_no} if cnr else None


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

        def _load_captcha(msg: str) -> None:
            """Load a fresh captcha page and return the challenge (strips internal key)."""
            try:
                ch = _captcha_challenge()
                ch.pop("_casetype_map", None)  # internal key, never sent to client
                self._json({
                    "success": False,
                    "requiresCaptcha": True,
                    "message": msg,
                    "caseNumber": case_number,
                    **ch,
                })
            except Exception as exc:
                self._json({"success": False, "message": f"Unable to load captcha: {exc}"})

        # ── First call: no token yet ─────────────────────────────────────────
        if not captcha_token:
            try:
                ch = _captcha_challenge()
            except Exception as exc:
                return self._json({"success": False, "message": f"Unable to load captcha: {exc}"})
            casetype_map: Dict[str, str] = ch.pop("_casetype_map", {})
            code = casetype_map.get(case_type) or _CASE_TYPE_FALLBACK.get(case_type)
            if not code:
                return self._json({
                    "success": False,
                    "error": "CASE_TYPE_MAPPING_NOT_FOUND",
                    "parsedCaseType": case_type,
                    "message": (
                        f"Case type '{case_type}' was not found in the eCourts form. "
                        "Please verify the case number."
                    ),
                })
            return self._json({
                "success": False,
                "requiresCaptcha": True,
                "message": "Captcha required to resolve CNR from case number.",
                "caseNumber": case_number,
                **ch,
            })

        # ── Second call: captcha + token ─────────────────────────────────────
        if not captcha:
            return _load_captcha("Captcha is required.")

        try:
            session, casetype_map = _session_from_token(captcha_token)
        except ValueError:
            return _load_captcha("Captcha session expired. Please try again.")

        code = casetype_map.get(case_type) or _CASE_TYPE_FALLBACK.get(case_type)
        if not code:
            return self._json({
                "success": False,
                "error": "CASE_TYPE_MAPPING_NOT_FOUND",
                "parsedCaseType": case_type,
                "message": f"Case type '{case_type}' was not found in the eCourts form.",
            })

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
            return _load_captcha("Invalid captcha. Please try again.")

        discovered = _extract_cnr_and_case_no(resp.text)
        if not discovered or not discovered.get("cnr_number"):
            return self._json({
                "success": False,
                "message": (
                    "Case not found or CNR not returned by eCourts. "
                    "Please verify the case number."
                ),
            })

        self._json({
            "success":        True,
            "cnr_number":     discovered["cnr_number"],
            "ecourts_case_no": discovered.get("ecourts_case_no") or "",
            "case_number":    case_number,
        })

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
