from __future__ import annotations

import base64
import json
import os
import random
import re
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ECOURTS_BASE_URL = "https://hcservices.ecourts.gov.in"
ECOURTS_ROOT_URL = f"{ECOURTS_BASE_URL}/"
ECOURTS_MAIN_URL = f"{ECOURTS_BASE_URL}/hcservices/main.php?v=1"
ECOURTS_CAPTCHA_URL = f"{ECOURTS_BASE_URL}/hcservices/securimage/securimage_show.php"
ECOURTS_SEARCH_URL = (
    f"{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords"
)
ECOURTS_HISTORY_URL = f"{ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

REQUEST_TIMEOUT = (5, 22)
CAPTCHA_TOKEN_TTL = timedelta(minutes=10)
CACHE_TTL_HOURS = 24
CASE_TYPE_FALLBACK: Dict[str, str] = {"WP": "49"}


def _sb_headers(prefer: str = "return=minimal") -> Dict[str, str]:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0,
        status_forcelist=[429, 503, 504],
        allowed_methods=["GET", "POST", "PATCH"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def _clean(v: Any) -> str:
    return " ".join(str(v or "").split()).strip()


def _parse_case_number(case_number: str) -> Optional[Tuple[str, str, str]]:
    cleaned = _clean(case_number).replace(" ", "")
    parts = [p for p in cleaned.split("/") if p]
    if len(parts) != 3:
        return None
    case_type = parts[0].upper()
    case_no = re.sub(r"\D", "", parts[1])
    case_year = re.sub(r"\D", "", parts[2])
    if not case_type or not case_no or not case_year:
        return None
    return case_type, case_no, case_year


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_cache_fresh(last_fetched: Optional[str]) -> bool:
    ts = _parse_time(last_fetched)
    if not ts:
        return False
    now_utc = datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (now_utc - ts) <= timedelta(hours=CACHE_TTL_HOURS)


def _parse_records_from_search_json(body: str) -> List[Dict[str, Any]]:
    try:
        root = json.loads(body)
    except Exception:
        return []
    if not isinstance(root, dict):
        return []
    con = root.get("con")
    if not con:
        return []
    if isinstance(con, str):
        try:
            con = json.loads(con)
        except Exception:
            return []
    if isinstance(con, list):
        return [r for r in con if isinstance(r, dict)]
    return []


def _is_bad_captcha(text: str) -> bool:
    lo = text.lower()
    if "captcha" not in lo:
        return False
    return any(
        w in lo
        for w in [
            "invalid captcha",
            "incorrect captcha",
            "captcha does not match",
            "enter captcha",
            "wrong captcha",
        ]
    )


def _build_case_details_payload(
    *,
    listing: Dict[str, Any],
    case_row: Dict[str, Any],
    summary_fields: Dict[str, str],
    hearing_history: List[Dict[str, str]],
    orders: List[Dict[str, str]],
    prayer: str,
) -> Dict[str, Any]:
    def first(*vals: Optional[str]) -> str:
        for v in vals:
            t = _clean(v)
            if t:
                return t
        return ""

    case_number = first(
        listing.get("case_number"),
        case_row.get("case_number"),
        summary_fields.get("Registration Number"),
        summary_fields.get("Case Number"),
    )
    cnr_number = first(
        case_row.get("cnr_number"),
        listing.get("cnr_number"),
        summary_fields.get("CNR Number"),
    )
    petitioner = first(
        listing.get("petitioner"),
        case_row.get("petitioner"),
        summary_fields.get("Petitioner"),
    )
    respondent = first(
        listing.get("respondent"),
        case_row.get("respondent"),
        summary_fields.get("Respondent"),
    )
    court_hall = first(
        listing.get("court_hall"),
        summary_fields.get("Court Hall"),
        summary_fields.get("Court"),
    )
    judge = first(
        listing.get("judge_name"),
        summary_fields.get("Coram"),
        summary_fields.get("Judge"),
    )
    stage_status = first(
        listing.get("stage"),
        summary_fields.get("Stage of Case"),
        summary_fields.get("Case Status"),
    )

    return {
        "caseNumber": case_number,
        "cnrNumber": cnr_number,
        "petitioner": petitioner,
        "respondent": respondent,
        "courtHall": court_hall,
        "judge": judge,
        "stageStatus": stage_status,
        "prayer": prayer,
        "hearingHistory": hearing_history,
        "orders": orders,
        "summary_fields": summary_fields,
    }


def _extract_prayer(summary_fields: Dict[str, str], text: str, case_row: Dict[str, Any]) -> str:
    from_summary = _clean(summary_fields.get("Prayer") or summary_fields.get("Prayer / Relief"))
    if from_summary:
        return from_summary
    from_case = _clean(case_row.get("prayer"))
    if from_case:
        return from_case

    m = re.search(r"prayer\s*[:\-]?\s*(.+?)(?:\n\s*\n|history of case hearing|orders|document details|$)", text, re.I | re.S)
    if m:
        return _clean(m.group(1))
    return ""


def _extract_hearing_history(tables: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    tbl = next((t for t in tables if "history of case hearing" in _clean(t.get("title")).lower()), None)
    if not tbl:
        return out

    headers = [_clean(h).lower() for h in (tbl.get("headers") or [])]
    rows = tbl.get("rows") or []

    def idx_for(*keys: str) -> int:
        for k in keys:
            for i, h in enumerate(headers):
                if k in h:
                    return i
        return -1

    date_i = idx_for("hearing date", "date")
    purpose_i = idx_for("purpose", "business")
    stage_i = idx_for("cause list type", "stage")
    remarks_i = idx_for("remarks", "remark")

    if date_i == -1:
        date_i = 3
    if purpose_i == -1:
        purpose_i = 4
    if stage_i == -1:
        stage_i = 0

    for r in rows:
        if not isinstance(r, list):
            continue
        getv = lambda i: _clean(r[i]) if 0 <= i < len(r) else ""
        date = getv(date_i)
        purpose = getv(purpose_i)
        stage = getv(stage_i)
        remarks = getv(remarks_i)
        if not any([date, purpose, stage, remarks]):
            continue
        out.append({
            "date": date,
            "purpose": purpose,
            "stage": stage,
            "remarks": remarks,
        })
    return out


def _extract_orders(tables: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    tbl = next((t for t in tables if _clean(t.get("title")).lower() == "orders"), None)
    if not tbl:
        return out

    headers = [_clean(h).lower() for h in (tbl.get("headers") or [])]
    rows = tbl.get("rows") or []

    def idx_for(*keys: str) -> int:
        for k in keys:
            for i, h in enumerate(headers):
                if k in h:
                    return i
        return -1

    date_i = idx_for("order date", "order on")
    number_i = idx_for("order no", "order number")
    type_i = idx_for("type", "order type")

    for r in rows:
        if not isinstance(r, list):
            continue
        getv = lambda i: _clean(r[i]) if 0 <= i < len(r) else ""
        order_date = getv(date_i)
        order_number = getv(number_i)
        order_type = getv(type_i)
        if not any([order_date, order_number, order_type]):
            continue
        out.append({
            "orderDate": order_date,
            "orderNumber": order_number,
            "orderType": order_type,
        })
    return out


def _supabase_get_listing_case(
    listing_id: str,
    case_id: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[str]]:
    try:
        params: Dict[str, str] = {
            "select": (
                "id,case_id,case_number,cnr_number,court_hall,judge_name,stage,"
                "petitioner,respondent,case_details_json,case_details_last_fetched"
            ),
            "limit": "1",
        }
        if listing_id:
            params["id"] = f"eq.{listing_id}"
        else:
            params["case_id"] = f"eq.{case_id}"
            params["order"] = "listed_date.desc,created_at.desc"

        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/today_matched_listings",
            headers=_sb_headers("count=none"),
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None, None, "Listing not found."
        listing = rows[0]

        actual_case_id = _clean(listing.get("case_id") or case_id)
        if not actual_case_id:
            return None, None, "Case details not found for this listing."

        case_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/cases",
            headers=_sb_headers("count=none"),
            params={
                "select": "id,case_number,cnr_number,ecourts_case_no,cnr_discovered_at,prayer,petitioner,respondent",
                "id": f"eq.{actual_case_id}",
                "limit": "1",
            },
            timeout=30,
        )
        case_resp.raise_for_status()
        case_rows = case_resp.json()
        case_row = case_rows[0] if isinstance(case_rows, list) and case_rows else None
        if not case_row:
            return None, None, "Case details not found for this listing."

        return listing, case_row, None
    except Exception as exc:
        return None, None, f"Unable to load listing details: {exc}"


def _patch_case(case_id: str, patch: Dict[str, Any]) -> Optional[str]:
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/cases",
            headers={**_sb_headers(), "Prefer": "return=minimal"},
            params={"id": f"eq.{case_id}"},
            data=json.dumps(patch),
            timeout=30,
        )
        r.raise_for_status()
        return None
    except Exception as exc:
        return f"Unable to update case record: {exc}"


def _patch_listing(listing_id: str, patch: Dict[str, Any]) -> Optional[str]:
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/today_matched_listings",
            headers={**_sb_headers(), "Prefer": "return=minimal"},
            params={"id": f"eq.{listing_id}"},
            data=json.dumps(patch),
            timeout=30,
        )
        r.raise_for_status()
        return None
    except Exception as exc:
        return f"Unable to update listing cache: {exc}"


def _captcha_challenge() -> Dict[str, Any]:
    s = _session()

    try:
        s.get(ECOURTS_ROOT_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=REQUEST_TIMEOUT)
    except Exception:
        pass

    page = s.get(
        ECOURTS_MAIN_URL,
        headers={"User-Agent": "Mozilla/5.0", "Referer": ECOURTS_ROOT_URL},
        timeout=REQUEST_TIMEOUT,
    )
    page.raise_for_status()

    casetype_map: Dict[str, str] = {}
    select_match = re.search(r"<select[^>]*name=[\"']case_type[\"'][^>]*>(.*?)</select>", page.text, re.I | re.S)
    if select_match:
        options_html = select_match.group(1)
        for val, txt in re.findall(r"<option\s+value=[\"']([^\"']+)[\"'][^>]*>(.*?)</option>", options_html, re.I | re.S):
            vv = _clean(val)
            if not vv or vv == "0":
                continue
            tt = _clean(re.sub(r"<[^>]+>", "", txt))
            abbr = tt.split("-")[0].split("(")[0].strip().upper()
            if abbr:
                casetype_map[abbr] = vv

    rand = random.random()
    img = s.get(
        f"{ECOURTS_CAPTCHA_URL}?{rand}",
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": ECOURTS_MAIN_URL,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=REQUEST_TIMEOUT,
    )
    img.raise_for_status()

    cookies_list = [
        {"name": c.name, "value": c.value, "domain": c.domain or "", "path": c.path or "/"}
        for c in s.cookies
    ]
    payload = {
        "cookies": cookies_list,
        "casetype_map": casetype_map,
        "expires": (datetime.utcnow() + CAPTCHA_TOKEN_TTL).isoformat(),
    }
    token = base64.b64encode(json.dumps(payload).encode()).decode("ascii")
    mime = img.headers.get("Content-Type") or "image/png"
    image_b64 = base64.b64encode(img.content).decode("ascii")

    return {
        "captchaToken": token,
        "captchaImage": f"data:{mime};base64,{image_b64}",
    }


def _session_from_token(token: str) -> Tuple[requests.Session, Dict[str, str]]:
    try:
        data = json.loads(base64.b64decode(token).decode())
    except Exception:
        raise ValueError("Invalid captcha token.")

    expires = _parse_time(data.get("expires"))
    if not expires:
        raise ValueError("Invalid token expiry.")
    now_utc = datetime.now(timezone.utc)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now_utc > expires:
        raise ValueError("Captcha token expired.")

    s = _session()
    cookies = data.get("cookies", [])
    if isinstance(cookies, dict):
        s.cookies.update(cookies)
    else:
        for c in cookies:
            s.cookies.set(c.get("name", ""), c.get("value", ""), domain=c.get("domain") or "", path=c.get("path") or "/")

    return s, data.get("casetype_map", {})


def _search_case(
    *,
    case_number: str,
    captcha: str,
    captcha_token: str,
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    parsed = _parse_case_number(case_number)
    if not parsed:
        return None, None, "Unable to parse case number. Expected TYPE/NUMBER/YEAR."
    case_type, case_no, case_year = parsed

    try:
        session, casetype_map = _session_from_token(captcha_token)
    except ValueError:
        return None, None, "Captcha session expired. Please try again."

    case_type_code = casetype_map.get(case_type) or CASE_TYPE_FALLBACK.get(case_type)
    if not case_type_code:
        return None, None, f"Case type mapping not available for '{case_type}'."

    try:
        resp = session.post(
            ECOURTS_SEARCH_URL,
            data={
                "action_code": "showRecords",
                "court_code": "1",
                "state_code": "10",
                "court_complex_code": "1",
                "caseStatusSearchType": "CScaseNumber",
                "captcha": captcha,
                "case_type": case_type_code,
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
        return None, None, "Unable to retrieve case details"

    if _is_bad_captcha(resp.text):
        return None, None, "Invalid Captcha"

    records = _parse_records_from_search_json(resp.text)
    if not records:
        return None, None, "Case Not Found"

    first = records[0]
    case_no_out = _clean(first.get("case_no") or "")
    cino_out = _clean(first.get("cino") or first.get("cnr_number") or "").upper()
    if not case_no_out or not cino_out:
        return None, None, "Case Not Found"

    return case_no_out, cino_out, None


def _extract_tables(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    tables: List[Dict[str, Any]] = []
    current_heading = ""
    heading_map: Dict[int, str] = {}

    for el in soup.find_all(["h1", "h2", "h3", "h4", "table"]):
        if el.name in ("h1", "h2", "h3", "h4"):
            t = _clean(el.get_text(" ", strip=True))
            if t:
                current_heading = t
        elif el.name == "table":
            heading_map[id(el)] = current_heading

    for i, table in enumerate(soup.find_all("table"), start=1):
        headers: List[str] = []
        rows: List[List[str]] = []
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            row = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if not any(row):
                continue
            if tr.find_all("th") and not tr.find_all("td") and not headers:
                headers = row
                continue
            rows.append(row)
        if not headers and not rows:
            continue
        if headers and not rows:
            rows = [headers]
            headers = []
        title = heading_map.get(id(table)) or f"Table {i}"
        tables.append({"title": title, "headers": headers, "rows": rows})
    return tables


def _extract_summary_fields(html: str) -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    out: Dict[str, str] = {}
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            vals = [_clean(c.get_text(" ", strip=True)) for c in cells]
            vals = [v for v in vals if v]
            if len(vals) >= 4:
                out[vals[0]] = vals[1]
                out[vals[2]] = vals[3]
            elif len(vals) == 2:
                out[vals[0]] = vals[1]
    return out


def _plain_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text("\n", strip=True)


def _fetch_history(cnr_number: str, ecourts_case_no: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        resp = _session().post(
            ECOURTS_HISTORY_URL,
            data={
                "court_code": "1",
                "state_code": "10",
                "court_complex_code": "1",
                "case_no": ecourts_case_no,
                "cino": cnr_number,
                "appFlag": "",
            },
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": ECOURTS_BASE_URL + "/",
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        return None, "Unable to retrieve case details"

    text = _plain_text(resp.text)
    lo = text.lower()
    if any(
        p in lo
        for p in [
            "no records found",
            "no record found",
            "case not found",
            "invalid cnr",
            "cnr not found",
            "no data found",
            "record not found",
        ]
    ):
        return None, "Case Not Found"

    parsed = {
        "success": True,
        "tables": _extract_tables(resp.text),
        "summary_fields": _extract_summary_fields(resp.text),
        "text": text,
    }
    if not parsed["tables"] and len(text.strip()) < 80:
        return None, "Unable to retrieve case details"
    return parsed, None


def _handle_case_details_flow(
    *,
    listing: Dict[str, Any],
    case_row: Dict[str, Any],
    case_number: str,
    captcha: str,
    captcha_token: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], Optional[Dict[str, Any]]]:
    listing_id = _clean(listing.get("id"))
    case_id = _clean(case_row.get("id"))

    # Serve cache if fresh.
    cached = listing.get("case_details_json")
    last_fetched = listing.get("case_details_last_fetched")
    if isinstance(cached, dict) and _is_cache_fresh(last_fetched):
        return cached, None, None

    cnr_number = _clean(case_row.get("cnr_number") or "").upper()
    ecourts_case_no = _clean(case_row.get("ecourts_case_no") or "")

    needs_discovery = not cnr_number or not ecourts_case_no
    if needs_discovery:
        effective_case_number = _clean(
            case_number
            or listing.get("case_number")
            or case_row.get("case_number")
        ).upper()
        if not effective_case_number:
            return None, "caseNumber is required for discovery.", None

        if not captcha or not captcha_token:
            challenge = _captcha_challenge()
            return None, "Captcha Required", {
                "requiresCaptcha": True,
                "message": "Captcha Required",
                **challenge,
            }

        discovered_case_no, discovered_cino, discover_err = _search_case(
            case_number=effective_case_number,
            captcha=captcha,
            captcha_token=captcha_token,
        )
        if discover_err:
            if discover_err == "Invalid Captcha":
                challenge = _captcha_challenge()
                return None, discover_err, {
                    "requiresCaptcha": True,
                    "message": "Invalid Captcha",
                    **challenge,
                }
            if discover_err == "Case Not Found":
                return None, "Case Not Found", None
            return None, discover_err, None

        cnr_number = discovered_cino or cnr_number
        ecourts_case_no = discovered_case_no or ecourts_case_no

        patch_err = _patch_case(
            case_id,
            {
                "cnr_number": cnr_number,
                "ecourts_case_no": ecourts_case_no,
                "cnr_discovered_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if patch_err:
            return None, patch_err, None

    parsed, fetch_err = _fetch_history(cnr_number, ecourts_case_no)
    if fetch_err or not parsed:
        return None, fetch_err or "Unable to retrieve case details", None

    tables = parsed.get("tables") or []
    summary_fields = parsed.get("summary_fields") or {}
    text = _clean(parsed.get("text") or "")
    hearing_history = _extract_hearing_history(tables)
    orders = _extract_orders(tables)
    prayer = _extract_prayer(summary_fields, text, case_row)

    payload = _build_case_details_payload(
        listing=listing,
        case_row=case_row,
        summary_fields=summary_fields,
        hearing_history=hearing_history,
        orders=orders,
        prayer=prayer,
    )

    _patch_listing(
        listing_id,
        {
            "case_details_json": payload,
            "case_details_last_fetched": datetime.now(timezone.utc).isoformat(),
        },
    )

    return payload, None, None


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            data = json.loads(body)
        except Exception:
            return self._json({"success": False, "message": "Invalid request body."}, 400)

        case_id = _clean(data.get("caseId") or "")
        listing_id = _clean(data.get("listingId") or "")
        case_number = _clean(data.get("caseNumber") or "").upper()
        captcha = _clean(data.get("captcha") or "")
        captcha_token = _clean(data.get("captchaToken") or data.get("captcha_token") or "")

        if not case_id:
            return self._json(
                {
                    "success": False,
                    "message": "caseId is required.",
                },
                400,
            )

        listing, case_row, load_err = _supabase_get_listing_case(listing_id, case_id)
        if load_err or not listing or not case_row:
            return self._json({"success": False, "message": load_err or "Listing not found."}, 404)

        if _clean(case_row.get("id")) != case_id:
            return self._json({"success": False, "message": "caseId does not match listing."}, 400)

        details, err, challenge = _handle_case_details_flow(
            listing=listing,
            case_row=case_row,
            case_number=case_number,
            captcha=captcha,
            captcha_token=captcha_token,
        )

        if challenge:
            return self._json({"success": False, **challenge}, 200)
        if err:
            return self._json({"success": False, "message": err}, 200)

        return self._json({"success": True, "caseDetails": details}, 200)

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
