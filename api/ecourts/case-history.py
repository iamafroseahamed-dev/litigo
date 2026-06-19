"""Vercel serverless: POST /api/ecourts/case-history

Step 2 of the two-step eCourts lookup.
Given a CNR number, fetches and returns the full case history from eCourts.

  Step 1: POST /api/ecourts/lookup-cnr   { case_number } → { cnr_number }
  Step 2: POST /api/ecourts/case-history { cnr_number  } → full history

Request:  { cnr_number: "MHCMA01234567890" }
Response: { success, searchType, cnr_number, case_number, tables,
            links, summary_fields, text }
"""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ECOURTS_BASE_URL = "https://hcservices.ecourts.gov.in"
ECOURTS_CNR_URL = (
    f"{ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php"
)
REQUEST_TIMEOUT = (10, 50)


# ── Session ────────────────────────────────────────────────────────────────────

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


# ── Table helpers ──────────────────────────────────────────────────────────────

def _make_table(title: str, headers: List[str], rows: List[List[str]]) -> Dict[str, Any]:
    col_count = max([len(headers)] + [len(r) for r in rows], default=0)
    return {"title": title, "headers": headers, "rows": rows, "columnCount": col_count}


def _table_title(table: Any, index: int) -> str:
    caption = table.find("caption")
    if caption:
        t = _clean(caption.get_text(" ", strip=True))
        if t:
            return t
    prev = table.find_previous(["h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "p"])
    if prev:
        t = _clean(prev.get_text(" ", strip=True))
        if t and len(t) <= 120:
            return t
    return f"Table {index}"


def _extract_tables(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    tables = []
    for index, table in enumerate(soup.find_all("table"), start=1):
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
        col_count = max([len(headers)] + [len(r) for r in rows])
        tables.append({
            "title": _table_title(table, index),
            "headers": headers,
            "rows": rows,
            "columnCount": col_count,
        })
    return tables


def _extract_links(soup: BeautifulSoup) -> List[Dict[str, str]]:
    links = []
    seen: set = set()
    for a in soup.find_all("a", href=True):
        href = urljoin(ECOURTS_BASE_URL + "/", str(a.get("href") or "").strip())
        text = _clean(a.get_text(" ", strip=True)) or href
        if (text, href) not in seen and href:
            seen.add((text, href))
            links.append({"text": text, "href": href})
    return links


def _extract_summary_fields(soup: BeautifulSoup) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) == 2:
                key = _clean(cells[0].get_text(" ", strip=True))
                val = _clean(cells[1].get_text(" ", strip=True))
                if key and val and 2 < len(key) <= 80 and val != key:
                    fields[key] = val
    return fields


# ── Case history HTML parser ──────────────────────────────────────────────────

def _parse_case_history(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    """Parse the eCourts case-history HTML response into structured data."""
    has_filing = any(_clean(td.get_text()) == "Filing Number" for td in soup.find_all("td"))
    if not has_filing:
        return None

    tables: List[Dict[str, Any]] = []
    summary: Dict[str, str] = {}
    cnr_out = ""
    case_num_out = ""

    def _heading_text(tag: Any) -> str:
        return _clean(tag.get_text(" ", strip=True)) if tag else ""

    def _hdrs(html_table: Any) -> List[str]:
        row = html_table.find("tr")
        if not row:
            return []
        ths = row.find_all("th")
        return [_clean(th.get_text(" ", strip=True)) for th in ths] if ths else []

    def _rows(html_table: Any, skip_header: bool = True) -> List[List[str]]:
        all_trs = html_table.find_all("tr")
        start = 1 if skip_header and _hdrs(html_table) else 0
        result: List[List[str]] = []
        for tr in all_trs[start:]:
            cells = tr.find_all("td")
            row = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if any(row):
                result.append(row)
        return result

    def _flat4to2(html_table: Any) -> List[List[str]]:
        result: List[List[str]] = []
        for tr in html_table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            vals = [v for v in [_clean(c.get_text(" ", strip=True)) for c in cells] if v]
            if len(vals) >= 4:
                result.extend([[vals[0], vals[1]], [vals[2], vals[3]]])
            elif len(vals) == 2:
                result.append(vals)
            elif len(vals) == 1:
                result.append([vals[0], ""])
        return [r for r in result if any(r)]

    # Build heading → table map
    heading_map: Dict[str, Any] = {}
    current_heading = ""
    for el in soup.find_all(["h1", "h2", "h3", "h4", "table"]):
        if el.name in ("h1", "h2", "h3", "h4"):
            txt = _heading_text(el)
            if txt:
                current_heading = txt
        elif el.name == "table":
            if current_heading and current_heading not in heading_map:
                heading_map[current_heading] = el

    # Case Details
    if "Case Details" in heading_map:
        rows2col = _flat4to2(heading_map["Case Details"])
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
    if "Case Status" in heading_map:
        rows2col = _flat4to2(heading_map["Case Status"])
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
    if "Acts" in heading_map:
        h = _hdrs(heading_map["Acts"])
        act_rows = _rows(heading_map["Acts"], skip_header=bool(h))
        if act_rows:
            tables.append(_make_table("Acts / Applicable Laws", h or ["Act", "Section"], act_rows))

    # Category Details
    if "Category Details" in heading_map:
        cat_rows = _flat4to2(heading_map["Category Details"])
        for kv in cat_rows:
            if len(kv) == 2 and kv[0] and kv[1]:
                summary[kv[0]] = kv[1]
        if cat_rows:
            tables.append(_make_table("Category Details", ["Field", "Value"], cat_rows))

    # Sub Matters
    if "Sub Matters" in heading_map:
        sub_rows = _flat4to2(heading_map["Sub Matters"])
        if sub_rows:
            tables.append(_make_table("Sub Matters", ["Field", "Value"], sub_rows))

    # Linked Cases
    if "Linked Cases" in heading_map:
        h = _hdrs(heading_map["Linked Cases"])
        linked_rows = _rows(heading_map["Linked Cases"], skip_header=bool(h))
        linked_rows = [r for r in linked_rows if len(r) >= 2 and r[1].strip()]
        if linked_rows:
            tables.append(_make_table("Linked Cases", h or ["Filing Number", "Case Number"], linked_rows))

    # History of Case Hearing
    if "History of Case Hearing" in heading_map:
        hearing_table = heading_map["History of Case Hearing"]
        h = _hdrs(hearing_table)
        h_rows: List[List[str]] = []
        stop_markers = {"orders", "order number", "order no", "order on"}
        for tr in hearing_table.find_all("tr")[1 if h else 0:]:
            cells = tr.find_all("td")
            if not cells:
                continue
            row = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if not any(row):
                continue
            if row[0].lower().strip() in stop_markers:
                break
            h_rows.append(row)
        if h_rows:
            tables.append(_make_table(
                "History of Case Hearing",
                h or ["Cause List Type", "Judge", "Business On Date", "Hearing Date", "Purpose of Hearing"],
                h_rows,
            ))

    # Orders
    if "Orders" in heading_map:
        order_rows: List[List[str]] = []
        for tr in heading_map["Orders"].find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            row_text = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if not any(row_text):
                continue
            if row_text[0].lower().strip() in ("order number", "order no", "sl. no", "sl.no", "#"):
                continue
            pdf_url = ""
            for a in tr.find_all("a", href=True):
                href = str(a.get("href", ""))
                if "display_pdf" in href or "pdf" in href.lower():
                    pdf_url = urljoin(ECOURTS_BASE_URL + "/hcservices/", href)
                    break
            order_rows.append((row_text + ["", "", "", ""])[:4] + [pdf_url])
        if order_rows:
            tables.append(_make_table(
                "Orders",
                ["Order No.", "Case No.", "Judge", "Order Date", "PDF Link"],
                order_rows,
            ))

    # Document Details
    if "Document Details" in heading_map:
        h = _hdrs(heading_map["Document Details"])
        doc_rows = _rows(heading_map["Document Details"], skip_header=bool(h))
        if doc_rows:
            tables.append(_make_table(
                "Document Details",
                h or ["Sl. No.", "Document No.", "Date of Receiving", "Filed by", "Advocate", "Document Filed"],
                doc_rows,
            ))

    # Scrutiny / Objections
    if "OBJECTION" in heading_map:
        obj_table = heading_map["OBJECTION"]
        h = _hdrs(obj_table)
        scrut_rows: List[List[str]] = []
        for tr in obj_table.find_all("tr")[1 if h else 0:]:
            cells = tr.find_all(["td", "th"])
            row = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if not any(row):
                continue
            if not h and any(kw in " ".join(row).lower() for kw in ["scrutiny", "objection compliance", "receipt date"]):
                h = row
                continue
            scrut_rows.append(row)
        if scrut_rows:
            tables.append(_make_table(
                "Scrutiny / Objections",
                h or ["Sl.No.", "Scrutiny Date", "Objection", "Compliance Date", "Receipt Date"],
                scrut_rows,
            ))

    return {
        "tables": tables,
        "summary_fields": summary,
        "cnr_number": cnr_out,
        "case_number": case_num_out,
    }


def _build_response(cnr_number: str, html: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    parsed = _parse_case_history(soup)
    if parsed:
        return {
            "success": True,
            "searchType": "CNR",
            "cnr_number": parsed["cnr_number"] or cnr_number,
            "case_number": parsed["case_number"],
            "tables": parsed["tables"],
            "links": _extract_links(soup),
            "summary_fields": parsed["summary_fields"],
            "text": soup.get_text("\n", strip=True),
            "raw_html": html,
        }
    return {
        "success": True,
        "searchType": "CNR",
        "cnr_number": cnr_number,
        "case_number": "",
        "text": soup.get_text("\n", strip=True),
        "tables": _extract_tables(soup),
        "links": _extract_links(soup),
        "summary_fields": _extract_summary_fields(soup),
        "raw_html": html,
    }


# ── Vercel handler ─────────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        try:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            data = json.loads(body)
        except Exception:
            return self._json({"success": False, "message": "Invalid request body."}, 400)

        cnr_number = _clean(data.get("cnr_number") or "").upper()
        if not cnr_number:
            return self._json({"success": False, "message": "cnr_number is required."}, 400)

        try:
            resp = _session().get(
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
            return self._json({"success": False, "message": f"eCourts did not respond: {exc}"})

        self._json(_build_response(cnr_number, resp.text))

    def _json(self, data: Dict[str, Any], status: int = 200) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_: Any) -> None:
        pass
