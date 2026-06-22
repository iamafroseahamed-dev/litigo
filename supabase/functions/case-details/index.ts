import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ECOURTS_API_BASE = Deno.env.get("ECOURTS_API_BASE_URL") ?? "";
const ECOURTS_API_KEY = Deno.env.get("ECOURTS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CACHE_TTL_HOURS = 24;
const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

// ── Madras High Court scope ───────────────────────────────────────────────────
// This application is exclusively for Madras High Court litigation monitoring.
const COURT_TYPE = "HIGH_COURT";
const HIGH_COURT_CODE = "HCMA01";
const STATE_CODE = "TN";

// Madras High Court case-type → eCourts case category.
const CASE_TYPE_MAP: Record<string, string> = {
  WP: "WRIT",
  WMP: "WRIT",
  WA: "WRIT",
  HCP: "CRIMINAL",
  CMA: "CIVIL",
  CMP: "CIVIL",
  CRP: "REVISION",
  CONTP: "CONTEMPT",
  OP: "CIVIL",
  OSA: "APPEAL",
};

// Normalize eCourts stage values to a consistent set used across all modules
// (daily_cause_list.stage_name, cases.case_status, today_matched_listings.stage).
const STAGE_MAP: Record<string, string> = {
  FOR_ADMISSION: "For Admission",
  PART_HEARD: "Part Heard",
  FOR_ORDERS: "For Orders",
  FOR_JUDGMENT: "For Judgment",
  DISPOSED: "Disposed",
  PENDING: "Pending",
};

function mapCaseCategory(caseType: string): string {
  return CASE_TYPE_MAP[caseType.trim().toUpperCase()] ?? "OTHER";
}

function normalizeStage(stage: string | null | undefined): string {
  if (!stage) return "";
  const key = stage.trim().toUpperCase().replace(/\s+/g, "_");
  return STAGE_MAP[key] ?? stage.trim();
}

function isMadrasHighCourtCnr(cnr: string): boolean {
  return cnr.trim().toUpperCase().startsWith(HIGH_COURT_CODE);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface EcourtsCase {
  cino: string;
  case_no: string;
  case_type: string;
  reg_no: string;
  reg_year: string;
  filing_no?: string;
  filing_date?: string;
  reg_date?: string;
  court_name?: string;
  court_no?: string;
  state_name?: string;
  dist_name?: string;
  case_status?: string;
  disposal_date?: string;
  disposal_nature?: string;
  next_hearing_date?: string;
  petitioner?: string[];
  respondent?: string[];
  pet_adv?: string[];
  res_adv?: string[];
  judges?: string[];
  judge?: string[];
  hearing_history?: Array<{
    hearing_date: string;
    purpose: string;
    business_date?: string;
    remarks?: string;
  }>;
  orders?: Array<{
    order_date: string;
    order_no?: string;
    order_type?: string;
    order_url?: string;
  }>;
  acts?: string[];
}

interface SearchResult {
  cino: string;
  case_no: string;
  case_type?: string;
  petitioner?: string;
  respondent?: string;
}

function isCacheFresh(lastFetched: string | null): boolean {
  if (!lastFetched) return false;
  const ts = new Date(lastFetched).getTime();
  if (isNaN(ts)) return false;
  return Date.now() - ts < CACHE_TTL_HOURS * 60 * 60 * 1000;
}

function parseCaseNumber(caseNumber: string): { type: string; number: string; year: string } | null {
  const cleaned = caseNumber.replace(/\s+/g, "").toUpperCase();
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length !== 3) return null;
  const type = parts[0];
  const num = parts[1].replace(/\D/g, "");
  const year = parts[2].replace(/\D/g, "");
  if (!type || !num || !year) return null;
  return { type, number: num, year };
}

async function fetchCaseByDnr(cnr: string): Promise<{ data: EcourtsCase | null; status: number; body: string; url: string }> {
  const url = `${ECOURTS_API_BASE}/api/partner/case/${encodeURIComponent(cnr)}`;
  console.log("[eCourts] GET", url);
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${ECOURTS_API_KEY}`,
      "Accept": "application/json",
    },
  });
  const body = await resp.text();
  console.log("[eCourts] Response status:", resp.status);
  console.log("[eCourts] Response body:", body.slice(0, 1000));
  if (!resp.ok) return { data: null, status: resp.status, body, url };
  try {
    return { data: JSON.parse(body) as EcourtsCase, status: resp.status, body, url };
  } catch {
    return { data: null, status: resp.status, body, url };
  }
}

async function searchCase(caseNumber: string): Promise<{ result: SearchResult | null; status: number; body: string; url: string }> {
  const parsed = parseCaseNumber(caseNumber);
  if (!parsed) return { result: null, status: 0, body: "Failed to parse case number", url: "" };

  const url = `${ECOURTS_API_BASE}/api/partner/search`;
  const payload = {
    case_type: parsed.type,
    case_number: parsed.number,
    year: parsed.year,
    state_code: "33",
    court_code: "1",
  };
  console.log("[eCourts] POST", url, JSON.stringify(payload));
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ECOURTS_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await resp.text();
  console.log("[eCourts] Search status:", resp.status);
  console.log("[eCourts] Search body:", body.slice(0, 1000));
  if (!resp.ok) return { result: null, status: resp.status, body, url };
  try {
    const data = JSON.parse(body);
    const results: SearchResult[] = Array.isArray(data) ? data : data?.results ?? data?.con ?? [];
    return { result: results.length > 0 ? results[0] : null, status: resp.status, body, url };
  } catch {
    return { result: null, status: resp.status, body, url };
  }
}

function buildCaseDetails(ecCase: EcourtsCase, caseTypeHint?: string) {
  const caseType = (caseTypeHint ?? ecCase.case_type ?? "").toUpperCase();
  const caseCategory = mapCaseCategory(caseType);

  const orders = (ecCase.orders ?? []).map((o) => ({
    orderDate: o.order_date ?? "",
    orderNumber: o.order_no ?? "",
    orderType: o.order_type ?? "",
    orderUrl: o.order_url ?? "",
  }));
  const judgmentCount = orders.filter((o) => /JUDG/i.test(o.orderType)).length;

  const hearingHistory = (ecCase.hearing_history ?? []).map((h) => ({
    date: h.hearing_date ?? "",
    purpose: h.purpose ?? "",
    businessDate: h.business_date ?? "",
    remarks: h.remarks ?? "",
  }));

  const judges = ecCase.judges ?? ecCase.judge ?? [];

  return {
    caseNumber: ecCase.case_no ?? `${ecCase.case_type}/${ecCase.reg_no}/${ecCase.reg_year}`,
    cnrNumber: ecCase.cino ?? "",
    courtType: COURT_TYPE,
    highCourtCode: HIGH_COURT_CODE,
    stateCode: STATE_CODE,
    courtName: ecCase.court_name ?? "Madras High Court",
    district: ecCase.dist_name ?? null,
    caseCategory,
    caseStatus: normalizeStage(ecCase.case_status),
    nextHearingDate: ecCase.next_hearing_date ?? null,
    petitioners: ecCase.petitioner ?? [],
    respondents: ecCase.respondent ?? [],
    petitionerAdvocates: ecCase.pet_adv ?? [],
    respondentAdvocates: ecCase.res_adv ?? [],
    judges,
    hearingHistory,
    hearingCount: hearingHistory.length,
    orders,
    orderCount: orders.length,
    judgmentCount,
    filingDate: ecCase.filing_date ?? null,
    registrationDate: ecCase.reg_date ?? null,
    disposalDate: ecCase.disposal_date ?? null,
    disposalNature: ecCase.disposal_nature ?? null,
    acts: ecCase.acts ?? [],
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Step 1 — Parse body safely
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error("[case-details] JSON parse error:", msg);
    return jsonResponse({
      success: false,
      error: "Invalid JSON body",
      detail: msg,
      received: null,
    });
  }

  console.log("[case-details] REQUEST", JSON.stringify(body, null, 2));

  // Accept both camelCase and snake_case field names
  const caseId = String(body.caseId ?? body.case_id ?? "").trim();
  const caseNumber = String(body.caseNumber ?? body.case_number ?? "").trim();
  const cnrNumber = String(body.cnrNumber ?? body.cnr_number ?? "").trim();

  const received = { caseId, caseNumber, cnrNumber };
  console.log("[case-details] Resolved params:", JSON.stringify(received));

  // Step 2 — Validate
  if (!caseId && !caseNumber) {
    return jsonResponse({
      success: false,
      error: "caseId or caseNumber is required",
      received,
    });
  }

  // Step 3 — Check env vars
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[case-details] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse({
      success: false,
      error: "Server misconfiguration: missing Supabase credentials",
      received,
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Step 4 — Lookup case in database
  let caseRow: Record<string, unknown> | null = null;
  let dbError: string | null = null;

  if (caseId) {
    console.log("[case-details] Looking up case by id:", caseId);
    const { data, error } = await supabase
      .from("cases")
      .select("id, cnr_number, case_number, case_details_json, case_details_last_fetched, petitioner, respondent, case_status, next_hearing_date")
      .eq("id", caseId)
      .single();
    caseRow = data;
    if (error) dbError = error.message;
  } else {
    console.log("[case-details] Looking up case by case_number:", caseNumber);
    const { data, error } = await supabase
      .from("cases")
      .select("id, cnr_number, case_number, case_details_json, case_details_last_fetched, petitioner, respondent, case_status, next_hearing_date")
      .eq("case_number", caseNumber)
      .single();
    caseRow = data;
    if (error) dbError = error.message;
  }

  console.log("[case-details] DB result:", caseRow ? `found id=${caseRow.id}` : "not found", dbError ?? "");

  if (!caseRow) {
    return jsonResponse({
      success: false,
      error: "Case not found in database",
      detail: dbError,
      received,
    });
  }

  // Step 5 — Check cache (24 hours)
  const cachedDetails = caseRow.case_details_json as Record<string, unknown> | null;
  const lastFetched = caseRow.case_details_last_fetched as string | null;
  if (cachedDetails && isCacheFresh(lastFetched)) {
    console.log("[case-details] Serving from cache (fetched:", lastFetched, ")");
    return jsonResponse({ success: true, cached: true, caseDetails: cachedDetails });
  }

  // Step 6 — Resolve CNR
  let cnr = String(caseRow.cnr_number ?? cnrNumber ?? "").trim();
  const effectiveCaseNumber = caseNumber || String(caseRow.case_number ?? "");
  console.log("[case-details] CNR:", cnr || "(empty)", "| caseNumber:", effectiveCaseNumber);

  if (!cnr) {
    if (!effectiveCaseNumber) {
      return jsonResponse({
        success: false,
        error: "No CNR number and no case number available to search eCourtsIndia",
        received,
        caseRow: { id: caseRow.id, cnr_number: caseRow.cnr_number, case_number: caseRow.case_number },
      });
    }

    console.log("[case-details] Searching eCourtsIndia for:", effectiveCaseNumber);
    const search = await searchCase(effectiveCaseNumber);

    if (!search.result || !search.result.cino) {
      return jsonResponse({
        success: false,
        error: "Case not found in eCourtsIndia search",
        detail: `Search API returned status ${search.status}`,
        searchUrl: search.url,
        searchResponse: search.body.slice(0, 500),
        received,
      });
    }

    cnr = search.result.cino;
    console.log("[case-details] Discovered CNR:", cnr);

    await supabase
      .from("cases")
      .update({ cnr_number: cnr, cnr_discovered_at: new Date().toISOString() })
      .eq("id", caseRow.id);
  }

  // Step 6b — Enforce Madras High Court scope (CNR must start with HCMA01)
  if (!isMadrasHighCourtCnr(cnr)) {
    console.warn("[case-details] Rejected non-Madras-HC CNR:", cnr);
    return jsonResponse({
      success: false,
      error: "Only Madras High Court cases are supported.",
      detail: `CNR ${cnr} is not a ${HIGH_COURT_CODE} (${COURT_TYPE}/${STATE_CODE}) case.`,
      received,
    });
  }

  // Step 7 — Fetch case details from eCourtsIndia
  if (!ECOURTS_API_BASE || !ECOURTS_API_KEY) {
    return jsonResponse({
      success: false,
      error: "Server misconfiguration: missing ECOURTS_API_BASE_URL or ECOURTS_API_KEY",
      received,
    });
  }

  const ecResult = await fetchCaseByDnr(cnr);

  if (!ecResult.data) {
    return jsonResponse({
      success: false,
      error: "eCourtsIndia API request failed",
      detail: `GET ${ecResult.url} returned status ${ecResult.status}`,
      apiResponse: ecResult.body.slice(0, 500),
      cnr,
      received,
    });
  }

  // Step 8 — Build response and save
  const caseTypeHint = parseCaseNumber(effectiveCaseNumber)?.type ?? ecResult.data.case_type ?? "";
  const caseDetails = buildCaseDetails(ecResult.data, caseTypeHint);
  const now = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("cases")
    .update({
      case_details_json: caseDetails,
      case_details_last_fetched: now,
      case_details_last_synced: now,
      case_category: caseDetails.caseCategory,
      case_status: caseDetails.caseStatus || caseRow.case_status,
      petitioner: ecResult.data.petitioner?.join(", ") || caseRow.petitioner,
      respondent: ecResult.data.respondent?.join(", ") || caseRow.respondent,
      next_hearing_date: ecResult.data.next_hearing_date || caseRow.next_hearing_date,
    })
    .eq("id", caseRow.id);

  if (updateErr) {
    console.warn("[case-details] DB update failed:", updateErr.message);
  }

  console.log("[case-details] Success — returning case details for CNR:", cnr);
  return jsonResponse({ success: true, cached: false, caseDetails });
});
