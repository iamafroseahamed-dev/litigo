"""Vercel serverless function: POST /api/ecourts/case-details

Mirrors the equivalent FastAPI endpoint in backend/app.py but uses a
stateless captcha scheme: instead of storing requests.Session objects in an
in-memory dict (which doesn't survive across serverless invocations), the
session cookies are base64-encoded JSON and returned as the captchaToken.
When the user submits their captcha answer the token is decoded, the cookies
are restored into a fresh Session, and the POST is made.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ── Constants ──────────────────────────────────────────────────────────────────

ECOURTS_BASE_URL = "https://hcservices.ecourts.gov.in"
ECOURTS_MAIN_URL = f"{ECOURTS_BASE_URL}/hcservices/main.php?v=1"
ECOURTS_CNR_URL = f"{ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php"
ECOURTS_CASE_NUMBER_URL = (
    f"{ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords"
)
CASE_TYPE_MAPPING: Dict[str, str] = {"WP": "49"}
# Keep well within Vercel's 60 s maxDuration.
# Captcha flow makes two eCourts requests; worst-case with 1 retry:
#   2 requests × (5 + 22) s × 2 attempts = 108 s — trim reads to 20 s:
#   2 × (5 + 20) × 2 = 100 s — acceptable given captcha step is one request.
# Single CNR request: (5 + 22) × 2 = 54 s.
REQUEST_TIMEOUT = (5, 22)  # (connect_timeout, read_timeout) in seconds
CAPTCHA_TOKEN_TTL = timedelta(minutes=10)


def _ecourts_session() -> requests.Session:
    """Return a Session with retry-on-network-error behaviour."""
    session = requests.Session()
    retry = Retry(
        total=1,
        backoff_factor=0,
        status_forcelist=[429, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

# ── Helpers ────────────────────────────────────────────────────────────────────


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def parse_case_number(case_number: str) -> Optional[Tuple[str, str, str]]:
    cleaned = clean_text(case_number).replace(" ", "")
    parts = [p for p in cleaned.split("/") if p]
    if len(parts) != 3:
        return None
    case_type = parts[0].upper()
    case_no = re.sub(r"\D", "", parts[1])
    case_year = re.sub(r"\D", "", parts[2])
    if not case_type or not case_no or not case_year:
        return None
    return case_type, case_no, case_year


def has_invalid_captcha(html: str) -> bool:
    lowered = html.lower()
    if "captcha" not in lowered:
        return False
    return any(
        m in lowered
        for m in [
            "invalid captcha",
            "incorrect captcha",
            "captcha does not match",
            "enter captcha",
            "wrong captcha",
        ]
    )


# ── Captcha (stateless) ────────────────────────────────────────────────────────


def create_captcha_challenge() -> Dict[str, Any]:
    """Fetch the eCourts captcha image; return image data-URI + cookie token."""
    session = _ecourts_session()
    page_resp = session.get(
        ECOURTS_MAIN_URL,
        headers={"User-Agent": "Mozilla/5.0", "Referer": ECOURTS_BASE_URL + "/"},
        timeout=REQUEST_TIMEOUT,
    )
    page_resp.raise_for_status()

    soup = BeautifulSoup(page_resp.text, "html.parser")
    captcha_img = soup.find("img", id="captcha_image")
    if not captcha_img or not captcha_img.get("src"):
        raise ValueError("Unable to find captcha image on eCourts page.")

    captcha_url = urljoin(page_resp.url, str(captcha_img["src"]))
    img_resp = session.get(
        captcha_url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": ECOURTS_MAIN_URL,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=REQUEST_TIMEOUT,
    )
    img_resp.raise_for_status()

    mime = img_resp.headers.get("Content-Type") or "image/png"
    image_b64 = base64.b64encode(img_resp.content).decode("ascii")

    # Encode cookies into a stateless token so no server-side state is needed.
    # Use a list of dicts instead of dict(session.cookies) to avoid
    # CookieConflictError when the server sets multiple cookies with the same
    # name (e.g. JSESSIONID on different paths).
    cookies_list = [
        {"name": c.name, "value": c.value, "domain": c.domain or "", "path": c.path or "/"}
        for c in session.cookies
    ]
    token_payload = {
        "cookies": cookies_list,
        "expires": (datetime.utcnow() + CAPTCHA_TOKEN_TTL).isoformat(),
    }
    token = base64.b64encode(json.dumps(token_payload).encode()).decode("ascii")
    return {"captchaToken": token, "captchaImage": f"data:{mime};base64,{image_b64}"}


def session_from_token(captcha_token: str) -> requests.Session:
    """Reconstruct a Session with cookies decoded from a stateless captcha token."""
    try:
        token_data = json.loads(base64.b64decode(captcha_token).decode())
    except Exception as exc:
        raise ValueError("Invalid captcha token.") from exc

    expires_str = token_data.get("expires", "")
    try:
        expires = datetime.fromisoformat(expires_str)
    except ValueError as exc:
        raise ValueError("Captcha token has no valid expiry.") from exc

    if datetime.utcnow() > expires:
        raise ValueError("Captcha token has expired.")

    session = _ecourts_session()
    cookies = token_data.get("cookies", [])
    if isinstance(cookies, dict):
        # backward-compat: old tokens stored cookies as a plain dict
        session.cookies.update(cookies)
    else:
        for c in cookies:
            session.cookies.set(
                c["name"], c["value"],
                domain=c.get("domain") or "",
                path=c.get("path") or "/",
            )
    return session


# ── HTML parsing (mirrors backend/app.py) ─────────────────────────────────────


def _make_table(title: str, headers: List[str], rows: List[List[str]]) -> Dict[str, Any]:
    col_count = max([len(headers)] + [len(r) for r in rows], default=0)
    return {"title": title, "headers": headers, "rows": rows, "columnCount": col_count}


def get_table_title(table: Any, index: int) -> str:
    caption = table.find("caption")
    if caption:
        t = clean_text(caption.get_text(" ", strip=True))
        if t:
            return t
    previous = table.find_previous(["h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "p"])
    if previous:
        t = clean_text(previous.get_text(" ", strip=True))
        if t and len(t) <= 120:
            return t
    return f"Table {index}"


def extract_tables_from_soup(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    for index, table in enumerate(soup.find_all("table"), start=1):
        headers: List[str] = []
        rows: List[List[str]] = []
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            row = [clean_text(cell.get_text(" ", strip=True)) for cell in cells]
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
        column_count = max([len(headers)] + [len(r) for r in rows])
        tables.append(
            {
                "title": get_table_title(table, index),
                "headers": headers,
                "rows": rows,
                "columnCount": column_count,
            }
        )
    return tables


def extract_links_from_soup(soup: BeautifulSoup) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    seen: set = set()
    for anchor in soup.find_all("a", href=True):
        href = urljoin(ECOURTS_BASE_URL + "/", str(anchor.get("href") or "").strip())
        text = clean_text(anchor.get_text(" ", strip=True)) or href
        key = (text, href)
        if not href or key in seen:
            continue
        seen.add(key)
        links.append({"text": text, "href": href})
    return links


def extract_summary_fields(soup: BeautifulSoup) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) == 2:
                key = clean_text(cells[0].get_text(" ", strip=True))
                value = clean_text(cells[1].get_text(" ", strip=True))
                if key and value and 2 < len(key) <= 80 and value != key:
                    fields[key] = value
    return fields


def parse_ecourts_case_number_json(body: str, fallback_case_number: str) -> Optional[Dict[str, Any]]:
    try:
        root = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(root, dict):
        return None

    con_raw = root.get("con")
    if con_raw in ("Invalid Captcha", "", None) or not con_raw:
        return None
    if root.get("Error"):
        return None

    if isinstance(con_raw, str):
        try:
            con_raw = json.loads(con_raw)
        except (json.JSONDecodeError, ValueError):
            return None
    if not isinstance(con_raw, list) or not con_raw:
        return None

    tables: List[Dict[str, Any]] = []
    summary: Dict[str, str] = {}
    cnr_out = ""
    case_num_out = ""

    FIELD_LABELS = {
        "cino": "CNR Number",
        "case_no": "Case Number",
        "pet_name": "Petitioner",
        "res_name": "Respondent",
        "court_name": "Court",
        "judge_name": "Judge",
        "next_date": "Next Hearing Date",
        "next_purpose": "Next Hearing Purpose",
        "case_type": "Case Type",
        "case_year": "Year",
        "filing_no": "Filing Number",
        "reg_no": "Registration Number",
        "reg_date": "Registration Date",
        "filing_date": "Filing Date",
        "decision_date": "Decision Date",
        "disp_nature": "Nature of Disposal",
        "case_status": "Case Status",
        "coram": "Judge/Coram",
        "bench_type": "Bench Type",
    }

    first = con_raw[0]
    cnr_out = clean_text(first.get("cino") or first.get("cnr_number") or "")
    case_num_out = clean_text(first.get("case_no") or fallback_case_number)

    summary_rows: List[List[str]] = []
    for key, label in FIELD_LABELS.items():
        val = clean_text(first.get(key) or "")
        if not val or val in ("0", "null", "None"):
            continue
        summary_rows.append([label, val])
        summary[label] = val

    if summary_rows:
        tables.append(_make_table("Case Summary", ["Field", "Value"], summary_rows))

    if len(con_raw) > 1:
        list_rows: List[List[str]] = []
        for rec in con_raw:
            list_rows.append(
                [
                    clean_text(rec.get("case_no") or ""),
                    clean_text(rec.get("pet_name") or ""),
                    clean_text(rec.get("res_name") or ""),
                    clean_text(rec.get("court_name") or ""),
                    clean_text(rec.get("next_date") or ""),
                ]
            )
        tables.append(
            _make_table(
                "Matching Cases",
                ["Case Number", "Petitioner", "Respondent", "Court", "Next Hearing"],
                list_rows,
            )
        )

    order_rows: List[List[str]] = []
    for idx, rec in enumerate(con_raw, start=1):
        url_path = clean_text(rec.get("orderurlpath") or "")
        if url_path:
            full_url = (
                urljoin(ECOURTS_BASE_URL + "/hcservices/", url_path)
                if not url_path.startswith("http")
                else url_path
            )
            order_rows.append([str(idx), clean_text(rec.get("case_no") or ""), "", "", full_url])
    if order_rows:
        tables.append(
            _make_table(
                "Orders",
                ["Order No.", "Case No.", "Judge", "Order Date", "PDF Link"],
                order_rows,
            )
        )

    return {
        "tables": tables,
        "summary_fields": summary,
        "cnr_number": cnr_out,
        "case_number": case_num_out,
    }


def parse_ecourts_case_history(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    has_filing = any(
        clean_text(td.get_text()) == "Filing Number" for td in soup.find_all("td")
    )
    if not has_filing:
        return None

    tables: List[Dict[str, Any]] = []
    summary: Dict[str, str] = {}
    cnr_out = ""
    case_num_out = ""

    def _heading_text(tag: Any) -> str:
        return clean_text(tag.get_text(" ", strip=True)) if tag else ""

    def _table_headers(html_table: Any) -> List[str]:
        header_row = html_table.find("tr")
        if not header_row:
            return []
        ths = header_row.find_all("th")
        if ths:
            return [clean_text(th.get_text(" ", strip=True)) for th in ths]
        return []

    def _table_rows(html_table: Any, skip_header: bool = True) -> List[List[str]]:
        rows: List[List[str]] = []
        all_trs = html_table.find_all("tr")
        start = 1 if skip_header and _table_headers(html_table) else 0
        for tr in all_trs[start:]:
            cells = tr.find_all("td")
            row = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            if any(row):
                rows.append(row)
        return rows

    def _flat_4col_to_2col(html_table: Any) -> List[List[str]]:
        result: List[List[str]] = []
        for tr in html_table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            vals = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            vals = [v for v in vals if v]
            if len(vals) >= 4:
                result.append([vals[0], vals[1]])
                result.append([vals[2], vals[3]])
            elif len(vals) == 2:
                result.append(vals)
            elif len(vals) == 1:
                result.append([vals[0], ""])
        return [r for r in result if any(r)]

    heading_to_table: Dict[str, Any] = {}
    current_heading = ""
    for el in soup.find_all(["h1", "h2", "h3", "h4", "table"]):
        if el.name in ("h1", "h2", "h3", "h4"):
            txt = _heading_text(el)
            if txt:
                current_heading = txt
        elif el.name == "table":
            if current_heading and current_heading not in heading_to_table:
                heading_to_table[current_heading] = el

    # Case Details
    case_det_table = heading_to_table.get("Case Details")
    if case_det_table is not None:
        rows2col = _flat_4col_to_2col(case_det_table)
        for kv in rows2col:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
                if "cnr" in kv[0].lower():
                    cnr_out = kv[1]
                elif "registration number" in kv[0].lower() and not case_num_out:
                    case_num_out = kv[1]
                elif "filing number" in kv[0].lower() and not case_num_out:
                    case_num_out = kv[1]
        tables.append(_make_table("Case Details", ["Field", "Value"], rows2col))

    # Case Status
    case_status_table = heading_to_table.get("Case Status")
    if case_status_table is not None:
        rows2col = _flat_4col_to_2col(case_status_table)
        for kv in rows2col:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
        tables.append(_make_table("Case Status", ["Field", "Value"], rows2col))

    # Parties
    pet_span = soup.find("span", class_="Petitioner_Advocate_table")
    res_span = soup.find("span", class_="Respondent_Advocate_table")
    party_rows: List[List[str]] = []

    for role, span in (("Petitioner", pet_span), ("Respondent", res_span)):
        if not span:
            continue
        lines = [ln.strip() for ln in span.get_text("\n").splitlines() if ln.strip()]
        current_name = ""
        current_adv = ""
        for ln in lines:
            if re.match(r"^\d+\)", ln):
                if current_name:
                    party_rows.append([role, current_name, current_adv])
                current_name = re.sub(r"^\d+\)\s*", "", ln).strip()
                current_adv = ""
            elif "advocate-" in ln.lower():
                current_adv = re.sub(r"(?i)advocate-\s*", "", ln).strip()
        if current_name:
            party_rows.append([role, current_name, current_adv])

    if party_rows:
        tables.append(_make_table("Parties", ["Role", "Name", "Advocate"], party_rows))
        pets = [r for r in party_rows if r[0] == "Petitioner"]
        ress = [r for r in party_rows if r[0] == "Respondent"]
        if pets:
            summary["Petitioner"] = pets[0][1]
            if pets[0][2]:
                summary["Petitioner Advocate"] = pets[0][2]
        if ress:
            summary["Respondent"] = ress[0][1]
            if ress[0][2]:
                summary["Respondent Advocate"] = ress[0][2]

    # Acts
    acts_table = heading_to_table.get("Acts")
    if acts_table is not None:
        hdrs = _table_headers(acts_table)
        act_rows = _table_rows(acts_table, skip_header=bool(hdrs))
        if act_rows:
            tables.append(_make_table("Acts / Applicable Laws", hdrs or ["Act", "Section"], act_rows))

    # Category Details
    cat_table = heading_to_table.get("Category Details")
    if cat_table is not None:
        cat_rows = _flat_4col_to_2col(cat_table)
        for kv in cat_rows:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
        if cat_rows:
            tables.append(_make_table("Category Details", ["Field", "Value"], cat_rows))

    # Sub Matters
    sub_table = heading_to_table.get("Sub Matters")
    if sub_table is not None:
        sub_rows = _flat_4col_to_2col(sub_table)
        if sub_rows:
            tables.append(_make_table("Sub Matters", ["Field", "Value"], sub_rows))

    # Linked Cases
    linked_table = heading_to_table.get("Linked Cases")
    if linked_table is not None:
        hdrs = _table_headers(linked_table)
        linked_rows = _table_rows(linked_table, skip_header=bool(hdrs))
        linked_rows = [r for r in linked_rows if len(r) >= 2 and r[1].strip()]
        if linked_rows:
            tables.append(_make_table("Linked Cases", hdrs or ["Filing Number", "Case Number"], linked_rows))

    # History of Case Hearing
    hearing_table = heading_to_table.get("History of Case Hearing")
    if hearing_table is not None:
        hdrs = _table_headers(hearing_table)
        h_rows: List[List[str]] = []
        stop_markers = {"orders", "order number", "order no", "order on"}
        for tr in hearing_table.find_all("tr")[1 if hdrs else 0 :]:
            cells = tr.find_all("td")
            if not cells:
                continue
            row = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            if not any(row):
                continue
            if row[0].lower().strip() in stop_markers:
                break
            h_rows.append(row)
        if h_rows:
            tables.append(
                _make_table(
                    "History of Case Hearing",
                    hdrs or ["Cause List Type", "Judge", "Business On Date", "Hearing Date", "Purpose of Hearing"],
                    h_rows,
                )
            )

    # Orders
    orders_table = heading_to_table.get("Orders")
    if orders_table is not None:
        order_rows: List[List[str]] = []
        for tr in orders_table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            row_text = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            if not any(row_text):
                continue
            first_lower = row_text[0].lower().strip()
            if first_lower in ("order number", "order no", "sl. no", "sl.no", "#"):
                continue
            pdf_url = ""
            for a in tr.find_all("a", href=True):
                href = str(a.get("href", ""))
                if "display_pdf" in href or "pdf" in href.lower():
                    pdf_url = urljoin(ECOURTS_BASE_URL + "/hcservices/", href)
                    break
            order_rows.append((row_text + ["", "", "", ""])[:4] + [pdf_url])
        if order_rows:
            tables.append(
                _make_table(
                    "Orders",
                    ["Order No.", "Case No.", "Judge", "Order Date", "PDF Link"],
                    order_rows,
                )
            )

    # Document Details
    doc_table = heading_to_table.get("Document Details")
    if doc_table is not None:
        hdrs = _table_headers(doc_table)
        doc_rows = _table_rows(doc_table, skip_header=bool(hdrs))
        if doc_rows:
            tables.append(
                _make_table(
                    "Document Details",
                    hdrs or ["Sl. No.", "Document No.", "Date of Receiving", "Filed by", "Advocate", "Document Filed"],
                    doc_rows,
                )
            )

    # Scrutiny / Objections
    obj_table = heading_to_table.get("OBJECTION")
    if obj_table is not None:
        hdrs = _table_headers(obj_table)
        scrut_rows: List[List[str]] = []
        all_trs = obj_table.find_all("tr")
        start_idx = 1 if hdrs else 0
        for tr in all_trs[start_idx:]:
            cells = tr.find_all(["td", "th"])
            row = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            if not any(row):
                continue
            if not hdrs and any(kw in " ".join(row).lower() for kw in ["scrutiny", "objection compliance", "receipt date"]):
                hdrs = row
                continue
            scrut_rows.append(row)
        if scrut_rows:
            tables.append(
                _make_table(
                    "Scrutiny / Objections",
                    hdrs or ["Sl.No.", "Scrutiny Date", "Objection", "Compliance Date", "Receipt Date"],
                    scrut_rows,
                )
            )

    return {
        "tables": tables,
        "summary_fields": summary,
        "cnr_number": cnr_out,
        "case_number": case_num_out,
    }


def build_case_details_response(
    *,
    search_type: str,
    cnr_number: str,
    case_number: str,
    html: str,
) -> Dict[str, Any]:
    body = html.strip()
    if body.startswith("{") or body.startswith("["):
        parsed_json = parse_ecourts_case_number_json(body, case_number)
        if parsed_json:
            return {
                "success": True,
                "searchType": search_type,
                "cnr_number": parsed_json["cnr_number"] or cnr_number,
                "case_number": parsed_json["case_number"] or case_number,
                "tables": parsed_json["tables"],
                "links": [],
                "summary_fields": parsed_json["summary_fields"],
                "text": "",
                "raw_html": html,
            }

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    parsed = parse_ecourts_case_history(soup)
    if parsed:
        return {
            "success": True,
            "searchType": search_type,
            "cnr_number": parsed["cnr_number"] or cnr_number,
            "case_number": parsed["case_number"] or case_number,
            "tables": parsed["tables"],
            "links": extract_links_from_soup(soup),
            "summary_fields": parsed["summary_fields"],
            "text": soup.get_text("\n", strip=True),
            "raw_html": html,
        }

    return {
        "success": True,
        "searchType": search_type,
        "cnr_number": cnr_number,
        "case_number": case_number,
        "text": soup.get_text("\n", strip=True),
        "tables": extract_tables_from_soup(soup),
        "links": extract_links_from_soup(soup),
        "summary_fields": extract_summary_fields(soup),
        "raw_html": html,
    }


def build_requires_captcha_response(case_number: str, message: str) -> Dict[str, Any]:
    try:
        challenge = create_captcha_challenge()
    except Exception as exc:
        return {"success": False, "message": f"Unable to load captcha: {exc}"}
    return {
        "success": False,
        "requiresCaptcha": True,
        "message": message,
        "caseNumber": case_number,
        **challenge,
    }


# ── Request handler ────────────────────────────────────────────────────────────


def handle_request(
    cnr_number: str,
    case_number: str,
    captcha: str,
    captcha_token: str,
) -> Dict[str, Any]:
    if cnr_number:
        try:
            resp = _ecourts_session().get(
                ECOURTS_CNR_URL,
                params={
                    "state_code": "10",
                    "dist_code": "1",
                    "court_code": "1",
                    "caseStatusSearchType": "CNRNumber",
                    "cino": cnr_number,
                    "national_court_code": "HCMA01",
                },
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": ECOURTS_BASE_URL + "/",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            return {"success": False, "message": f"eCourts did not respond in time. Please try again. ({exc})"}
        return build_case_details_response(
            search_type="CNR",
            cnr_number=cnr_number,
            case_number=case_number,
            html=resp.text,
        )

    if not case_number:
        return {"success": False, "message": "Either cnr_number or case_number is required."}

    if not captcha:
        return build_requires_captcha_response(
            case_number,
            "CNR number is not available. Captcha is required for case number search.",
        )

    parsed = parse_case_number(case_number)
    if not parsed:
        return {"success": False, "message": "Unable to parse the case number for eCourts lookup."}

    case_type_text, case_no, case_year = parsed
    case_type_code = CASE_TYPE_MAPPING.get(case_type_text)
    if not case_type_code:
        return {"success": False, "message": f"Case type mapping not available for '{case_type_text}'."}

    if not captcha_token:
        return build_requires_captcha_response(
            case_number,
            "Captcha session is missing. Please enter the new captcha and try again.",
        )

    try:
        session = session_from_token(captcha_token)
    except ValueError:
        return build_requires_captcha_response(
            case_number,
            "Captcha session expired. Please enter the new captcha and try again.",
        )

    try:
        resp = session.post(
            ECOURTS_CASE_NUMBER_URL,
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
        return {"success": False, "message": f"eCourts did not respond in time. Please try again. ({exc})"}

    if has_invalid_captcha(resp.text):
        return build_requires_captcha_response(case_number, "Invalid captcha. Please try again.")

    return build_case_details_response(
        search_type="CASE_NUMBER",
        cnr_number="",
        case_number=case_number,
        html=resp.text,
    )


# ── Vercel handler ─────────────────────────────────────────────────────────────


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
        except Exception:
            self._json({"success": False, "message": "Invalid request body."}, 400)
            return

        cnr_number = clean_text(data.get("cnr_number") or "").upper()
        case_number = clean_text(data.get("case_number") or "").upper()
        captcha = clean_text(data.get("captcha") or "")
        captcha_token = clean_text(data.get("captcha_token") or "")

        try:
            result = handle_request(cnr_number, case_number, captcha, captcha_token)
        except Exception as exc:
            result = {"success": False, "message": str(exc)}

        self._json(result)

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: Any) -> None:  # suppress default access logs
        pass
