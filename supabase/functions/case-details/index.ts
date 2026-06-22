import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ECOURTS_API_BASE = Deno.env.get("ECOURTS_API_BASE_URL") ?? "";
const ECOURTS_API_KEY = Deno.env.get("ECOURTS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CACHE_TTL_HOURS = 24;

interface RequestBody {
  case_id: string;
  case_number?: string;
  cnr_number?: string;
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

async function fetchCaseByDnr(cnr: string): Promise<EcourtsCase | null> {
  const url = `${ECOURTS_API_BASE}/api/partner/case/${encodeURIComponent(cnr)}`;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${ECOURTS_API_KEY}`,
      "Accept": "application/json",
    },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data as EcourtsCase;
}

async function searchCase(caseNumber: string): Promise<SearchResult | null> {
  const parsed = parseCaseNumber(caseNumber);
  if (!parsed) return null;

  const url = `${ECOURTS_API_BASE}/api/partner/search`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ECOURTS_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      case_type: parsed.type,
      case_number: parsed.number,
      year: parsed.year,
      state_code: "33",   // Tamil Nadu
      court_code: "1",    // Madras High Court
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  // API may return an array or object
  const results: SearchResult[] = Array.isArray(data) ? data : data?.results ?? data?.con ?? [];
  return results.length > 0 ? results[0] : null;
}

function buildCaseDetails(ecCase: EcourtsCase) {
  return {
    caseNumber: ecCase.case_no ?? `${ecCase.case_type}/${ecCase.reg_no}/${ecCase.reg_year}`,
    cnrNumber: ecCase.cino ?? "",
    courtName: ecCase.court_name ?? "Madras High Court",
    caseStatus: ecCase.case_status ?? "",
    nextHearingDate: ecCase.next_hearing_date ?? null,
    petitioners: ecCase.petitioner ?? [],
    respondents: ecCase.respondent ?? [],
    petitionerAdvocates: ecCase.pet_adv ?? [],
    respondentAdvocates: ecCase.res_adv ?? [],
    hearingHistory: (ecCase.hearing_history ?? []).map((h) => ({
      date: h.hearing_date ?? "",
      purpose: h.purpose ?? "",
      businessDate: h.business_date ?? "",
      remarks: h.remarks ?? "",
    })),
    orders: (ecCase.orders ?? []).map((o) => ({
      orderDate: o.order_date ?? "",
      orderNumber: o.order_no ?? "",
      orderType: o.order_type ?? "",
      orderUrl: o.order_url ?? "",
    })),
    filingDate: ecCase.filing_date ?? null,
    registrationDate: ecCase.reg_date ?? null,
    disposalDate: ecCase.disposal_date ?? null,
    disposalNature: ecCase.disposal_nature ?? null,
    acts: ecCase.acts ?? [],
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, message: "Method not allowed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: RequestBody = await req.json();
    const { case_id, case_number, cnr_number } = body;

    if (!case_id) {
      return new Response(
        JSON.stringify({ success: false, message: "case_id is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Initialize Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the case row
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, cnr_number, case_number, case_details_json, case_details_last_fetched, petitioner, respondent, case_status, next_hearing_date")
      .eq("id", case_id)
      .single();

    if (caseErr || !caseRow) {
      return new Response(
        JSON.stringify({ success: false, message: "Case not found in database." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check cache: serve cached results if fresh (24 hours)
    if (caseRow.case_details_json && isCacheFresh(caseRow.case_details_last_fetched)) {
      return new Response(
        JSON.stringify({ success: true, cached: true, caseDetails: caseRow.case_details_json }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine CNR
    let cnr = caseRow.cnr_number ?? cnr_number ?? "";
    const effectiveCaseNumber = case_number ?? caseRow.case_number ?? "";

    // If no CNR, search for it
    if (!cnr) {
      if (!effectiveCaseNumber) {
        return new Response(
          JSON.stringify({ success: false, message: "No CNR and no case number available for search." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const searchResult = await searchCase(effectiveCaseNumber);
      if (!searchResult || !searchResult.cino) {
        return new Response(
          JSON.stringify({ success: false, message: "Case not found in eCourtsIndia. Please verify the case number." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      cnr = searchResult.cino;

      // Save discovered CNR
      await supabase
        .from("cases")
        .update({ cnr_number: cnr, cnr_discovered_at: new Date().toISOString() })
        .eq("id", case_id);
    }

    // Fetch full case details from eCourtsIndia
    const ecCase = await fetchCaseByDnr(cnr);
    if (!ecCase) {
      return new Response(
        JSON.stringify({ success: false, message: "Unable to retrieve case details from eCourtsIndia." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build structured response
    const caseDetails = buildCaseDetails(ecCase);

    // Save full API response and update case fields
    const now = new Date().toISOString();
    await supabase
      .from("cases")
      .update({
        case_details_json: caseDetails,
        case_details_last_fetched: now,
        case_status: ecCase.case_status || caseRow.case_status,
        petitioner: ecCase.petitioner?.join(", ") || caseRow.petitioner,
        respondent: ecCase.respondent?.join(", ") || caseRow.respondent,
        next_hearing_date: ecCase.next_hearing_date || caseRow.next_hearing_date,
      })
      .eq("id", case_id);

    return new Response(
      JSON.stringify({ success: true, cached: false, caseDetails }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
