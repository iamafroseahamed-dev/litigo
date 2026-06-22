import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

const ECOURTS_BASE_URL = "https://hcservices.ecourts.gov.in";
const ECOURTS_ROOT_URL = `${ECOURTS_BASE_URL}/`;
const ECOURTS_MAIN_URL = `${ECOURTS_BASE_URL}/hcservices/main.php?v=1`;
const ECOURTS_CAPTCHA_URL = `${ECOURTS_BASE_URL}/hcservices/securimage/securimage_show.php`;
const ECOURTS_SEARCH_URL = `${ECOURTS_BASE_URL}/hcservices/cases_qry/index_qry.php?action_code=showRecords`;
const ECOURTS_HISTORY_URL = `${ECOURTS_BASE_URL}/hcservices/cases_qry/o_civil_case_history.php`;

const REQUEST_TIMEOUT_MS = 25_000;
const CAPTCHA_TOKEN_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_HOURS = 24;

const CASE_TYPE_IDS: Record<string, string> = {
  WP: "49",
  WMP: "133",
  WA: "48",
  WAMP: "132",
  WPMP: "134",
  CRP: "15",
  CMP: "113",
  CMA: "2",
  HCP: "22",
  "CONT P": "9",
  OP: "119",
  OSA: "120",
};

type AnyRec = Record<string, unknown>;

type ParsedCaseNumber = {
  caseType: string;
  caseNo: string;
  caseYear: string;
};

type CaseDbRow = {
  id: string;
  case_number: string | null;
  cnr_number: string | null;
  ecourts_case_no: string | null;
  cnr_discovered_at: string | null;
  petitioner: string | null;
  respondent: string | null;
  case_details_json: AnyRec | null;
  case_details_last_fetched: string | null;
};

type CaptchaTokenPayload = {
  cookies: Array<{ name: string; value: string }>;
  expiresAt: number;
};

function clean(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function parseCaseNumber(caseNumber: string): ParsedCaseNumber | null {
  const cleaned = caseNumber.replace(/\s+/g, "").toUpperCase();
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length !== 3) return null;

  const rawType = parts[0].replace(/_/g, " ").replace(/\./g, " ").trim();
  const caseType = rawType.replace(/\s+/g, " ");
  const caseNo = parts[1].replace(/\D/g, "");
  const caseYear = parts[2].replace(/\D/g, "");

  if (!caseType || !caseNo || !caseYear) return null;
  return { caseType, caseNo, caseYear };
}

function resolveCaseTypeId(caseType: string): string | null {
  const upper = caseType.toUpperCase();
  if (CASE_TYPE_IDS[upper]) return CASE_TYPE_IDS[upper];
  const squeezed = upper.replace(/\s+/g, "");
  if (CASE_TYPE_IDS[squeezed]) return CASE_TYPE_IDS[squeezed];

  if (squeezed === "CONTP") return CASE_TYPE_IDS["CONT P"];
  return null;
}

function jsonResponse(body: AnyRec, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isCacheFresh(lastFetched: string | null | undefined): boolean {
  if (!lastFetched) return false;
  const ts = new Date(lastFetched).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < CACHE_TTL_HOURS * 60 * 60 * 1000;
}

function parseSetCookie(raw: string | null): Array<{ name: string; value: string }> {
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Array<{ name: string; value: string }> = [];
  for (const line of lines) {
    const firstPart = line.split(";")[0] ?? "";
    const eq = firstPart.indexOf("=");
    if (eq <= 0) continue;
    const name = firstPart.slice(0, eq).trim();
    const value = firstPart.slice(eq + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

function encodeCaptchaToken(payload: CaptchaTokenPayload): string {
  return btoa(JSON.stringify(payload));
}

function decodeCaptchaToken(token: string): CaptchaTokenPayload | null {
  try {
    const raw = atob(token);
    const parsed = JSON.parse(raw) as CaptchaTokenPayload;
    if (!Array.isArray(parsed.cookies) || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function cookieHeaderFromToken(token: string): string | null {
  const payload = decodeCaptchaToken(token);
  if (!payload) return null;
  if (Date.now() > payload.expiresAt) return null;

  const parts = payload.cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

async function readText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function titleToCamel(title: string): string {
  const words = clean(title)
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";
  const [first, ...rest] = words;
  return first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function extractSummaryFields(text: string): AnyRec {
  const out: AnyRec = {};
  const rows = text.split("\n").map((l) => clean(l)).filter(Boolean);

  for (const row of rows) {
    if (!row.includes(":")) continue;
    const idx = row.indexOf(":");
    const key = clean(row.slice(0, idx));
    const value = clean(row.slice(idx + 1));
    if (!key || !value) continue;
    const k = titleToCamel(key);
    if (k) out[k] = value;
  }

  return out;
}

function extractHearingHistory(text: string): Array<AnyRec> {
  const out: Array<AnyRec> = [];
  const lines = text.split("\n").map((l) => clean(l)).filter(Boolean);

  const dateRegex = /(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/;

  for (const line of lines) {
    if (!dateRegex.test(line)) continue;
    if (!/(hearing|purpose|stage|business|remarks|order)/i.test(line)) continue;

    const parts = line.split(/\s{2,}|\t+/).map((p) => clean(p)).filter(Boolean);
    if (parts.length < 2) continue;

    const date = parts.find((p) => dateRegex.test(p)) ?? "";
    const purpose = parts.length > 1 ? parts[1] : "";
    const stage = parts.length > 2 ? parts[2] : "";
    const remarks = parts.length > 3 ? parts.slice(3).join(" ") : "";

    out.push({ date, purpose, stage, remarks });
  }

  return out;
}

function extractOrders(text: string): Array<AnyRec> {
  const out: Array<AnyRec> = [];
  const lines = text.split("\n").map((l) => clean(l)).filter(Boolean);

  const pdfRegex = /(https?:\/\/\S+\.pdf\S*)/i;
  const dateRegex = /(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/;

  for (const line of lines) {
    if (!/(order|judgment|pdf|download)/i.test(line)) continue;

    const orderUrlMatch = line.match(pdfRegex);
    const orderUrl = orderUrlMatch ? orderUrlMatch[1] : "";

    const dateMatch = line.match(dateRegex);
    const orderDate = dateMatch ? dateMatch[1] : "";

    const orderType = /judgment/i.test(line)
      ? "Judgment"
      : /interim/i.test(line)
      ? "Interim Order"
      : "Order";

    const orderNumberMatch = line.match(/order\s*no\.?\s*[:\-]?\s*([A-Za-z0-9/.-]+)/i);
    const orderNumber = orderNumberMatch ? orderNumberMatch[1] : "";

    if (!orderDate && !orderUrl && !orderNumber) continue;

    out.push({ orderDate, orderNumber, orderType, orderUrl });
  }

  return out;
}

function normalizeCaseDetails(opts: {
  caseNumber: string;
  cnrNumber: string;
  ecourtsCaseNo: string;
  listing?: AnyRec | null;
  caseRow?: AnyRec | null;
  htmlText: string;
}): AnyRec {
  const summary = extractSummaryFields(opts.htmlText);
  const hearings = extractHearingHistory(opts.htmlText);
  const orders = extractOrders(opts.htmlText);

  const petitioner = clean(
    summary.petitioner ?? opts.listing?.petitioner ?? opts.caseRow?.petitioner,
  );
  const respondent = clean(
    summary.respondent ?? opts.listing?.respondent ?? opts.caseRow?.respondent,
  );
  const stage = clean(summary.stageOfCase ?? summary.caseStatus ?? opts.listing?.stage);

  const judge = clean(summary.coram ?? summary.judge ?? opts.listing?.judge_name);
  const courtHall = clean(summary.courtHall ?? summary.courtNo ?? opts.listing?.court_hall);
  const nextHearingDate = clean(summary.nextDate ?? summary.nextHearingDate);

  return {
    caseNumber: opts.caseNumber,
    cnrNumber: opts.cnrNumber,
    ecourtsCaseNo: opts.ecourtsCaseNo,
    caseStatus: clean(summary.caseStatus),
    stage,
    petitioner,
    respondent,
    judge,
    courtHall,
    nextHearingDate: nextHearingDate || null,
    hearingHistory: hearings,
    orders,
    summary,
    source: "hcservices.ecourts.gov.in",
    fetchedAt: new Date().toISOString(),
  };
}

async function ensureCaseColumns(supabase: ReturnType<typeof createClient>, caseId: string): Promise<void> {
  const patch: AnyRec = { updated_at: new Date().toISOString() };
  const { error } = await supabase.from("cases").update(patch).eq("id", caseId);
  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("ecourts_case_no") || msg.includes("column")) {
      throw new Error(
        "Missing DB column ecourts_case_no on cases. Add it via migration before using case-details discovery flow.",
      );
    }
  }
}

async function getCaseRow(
  supabase: ReturnType<typeof createClient>,
  payload: AnyRec,
): Promise<{ caseRow: CaseDbRow; listingRow: AnyRec | null }> {
  const caseId = clean(payload.caseId ?? payload.case_id);
  const listingId = clean(payload.listingId ?? payload.listing_id);
  const caseNumberFromPayload = clean(payload.caseNumber ?? payload.case_number).toUpperCase();

  let listingRow: AnyRec | null = null;

  if (listingId) {
    const { data, error } = await supabase
      .from("today_matched_listings")
      .select("id,case_id,case_number,petitioner,respondent,stage,judge_name,court_hall")
      .eq("id", listingId)
      .maybeSingle();
    if (!error && data) listingRow = data as AnyRec;
  }

  let query = supabase
    .from("cases")
    .select("id,case_number,cnr_number,ecourts_case_no,cnr_discovered_at,petitioner,respondent,case_details_json,case_details_last_fetched");

  if (caseId) {
    query = query.eq("id", caseId);
  } else if (listingRow?.case_id) {
    query = query.eq("id", String(listingRow.case_id));
  } else if (caseNumberFromPayload) {
    query = query.eq("case_number", caseNumberFromPayload);
  } else {
    throw new Error("caseId, listingId, or caseNumber is required");
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    throw new Error("Case not found in database");
  }

  return { caseRow: data as CaseDbRow, listingRow };
}

async function createCaptchaChallenge(): Promise<AnyRec> {
  const rootResp = await fetch(ECOURTS_ROOT_URL, {
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const rootSetCookie = rootResp.headers.get("set-cookie");

  const mainResp = await fetch(ECOURTS_MAIN_URL, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: ECOURTS_ROOT_URL,
      Cookie: parseSetCookie(rootSetCookie).map((c) => `${c.name}=${c.value}`).join("; "),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const mainSetCookie = mainResp.headers.get("set-cookie");

  const cookies = [
    ...parseSetCookie(rootSetCookie),
    ...parseSetCookie(mainSetCookie),
  ];
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const captchaResp = await fetch(`${ECOURTS_CAPTCHA_URL}?${Math.random()}`, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: ECOURTS_MAIN_URL,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieHeader,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!captchaResp.ok) {
    throw new Error(`Failed to fetch captcha image (${captchaResp.status})`);
  }

  const finalSetCookie = captchaResp.headers.get("set-cookie");
  const mergedCookies = [...cookies, ...parseSetCookie(finalSetCookie)];

  const imageBytes = new Uint8Array(await captchaResp.arrayBuffer());
  const binary = Array.from(imageBytes, (b) => String.fromCharCode(b)).join("");
  const imageB64 = btoa(binary);
  const mime = captchaResp.headers.get("content-type") ?? "image/png";

  const token = encodeCaptchaToken({
    cookies: mergedCookies,
    expiresAt: Date.now() + CAPTCHA_TOKEN_TTL_MS,
  });

  return {
    requiresCaptcha: true,
    message: "Captcha Required",
    captchaImage: `data:${mime};base64,${imageB64}`,
    captchaToken: token,
  };
}

async function searchCaseFromCaptcha(args: {
  caseNumber: string;
  captcha: string;
  captchaToken: string;
}): Promise<{ ecourtsCaseNo: string; cnrNumber: string }> {
  const parsed = parseCaseNumber(args.caseNumber);
  if (!parsed) {
    throw new Error("Unable to parse case number. Expected TYPE/NUMBER/YEAR.");
  }

  const caseTypeId = resolveCaseTypeId(parsed.caseType);
  if (!caseTypeId) {
    throw new Error(`Case type mapping not available for '${parsed.caseType}'.`);
  }

  const cookieHeader = cookieHeaderFromToken(args.captchaToken);
  if (!cookieHeader) {
    throw new Error("Captcha session expired. Please refresh captcha.");
  }

  const form = new URLSearchParams();
  form.set("court_code", "1");
  form.set("state_code", "10");
  form.set("court_complex_code", "1");
  form.set("caseStatusSearchType", "COcaseNumber");
  form.set("captcha", args.captcha);
  form.set("case_type_order", caseTypeId);
  form.set("case_no_order", parsed.caseNo);
  form.set("rgyearCaseOrder", parsed.caseYear);

  const resp = await fetch(ECOURTS_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      Origin: ECOURTS_BASE_URL,
      Referer: ECOURTS_MAIN_URL,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieHeader,
    },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const bodyText = await readText(resp);

  if (!resp.ok) {
    throw new Error(`eCourts search failed (${resp.status})`);
  }

  const lower = bodyText.toLowerCase();
  if (lower.includes("captcha") && (
    lower.includes("invalid") || lower.includes("incorrect") || lower.includes("wrong")
  )) {
    throw new Error("Invalid Captcha");
  }

  let parsedJson: AnyRec | AnyRec[] | null = null;
  try {
    parsedJson = JSON.parse(bodyText) as AnyRec | AnyRec[];
  } catch {
    parsedJson = null;
  }

  const records = Array.isArray(parsedJson)
    ? parsedJson
    : Array.isArray(parsedJson?.con)
    ? parsedJson.con as AnyRec[]
    : Array.isArray(parsedJson?.results)
    ? parsedJson.results as AnyRec[]
    : [];

  const first = records[0] ?? null;
  const ecourtsCaseNo = clean(first?.case_no ?? "");
  const cnrNumber = clean(first?.cino ?? first?.cnr_number ?? "").toUpperCase();

  if (!ecourtsCaseNo || !cnrNumber) {
    throw new Error("Case Not Found");
  }

  return { ecourtsCaseNo, cnrNumber };
}

async function fetchCaseHistory(args: {
  ecourtsCaseNo: string;
  cnrNumber: string;
}): Promise<string> {
  const form = new URLSearchParams();
  form.set("court_code", "1");
  form.set("state_code", "10");
  form.set("court_complex_code", "1");
  form.set("case_no", args.ecourtsCaseNo);
  form.set("cino", args.cnrNumber);
  form.set("appFlag", "");

  const resp = await fetch(ECOURTS_HISTORY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      Referer: ECOURTS_ROOT_URL,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const bodyText = await readText(resp);

  if (!resp.ok) {
    throw new Error(`Unable to retrieve case details (${resp.status})`);
  }

  const lower = bodyText.toLowerCase();
  if (
    lower.includes("no records found") ||
    lower.includes("case not found") ||
    lower.includes("invalid cnr")
  ) {
    throw new Error("Case Not Found");
  }

  if (clean(bodyText).length < 80) {
    throw new Error("Unable to retrieve case details");
  }

  return bodyText;
}

async function upsertDiscoveryAndCache(args: {
  supabase: ReturnType<typeof createClient>;
  caseId: string;
  listingId?: string | null;
  cnrNumber: string;
  ecourtsCaseNo: string;
  caseDetails: AnyRec;
}): Promise<void> {
  const now = new Date().toISOString();

  await args.supabase
    .from("cases")
    .update({
      cnr_number: args.cnrNumber,
      ecourts_case_no: args.ecourtsCaseNo,
      cnr_discovered_at: now,
      case_details_json: args.caseDetails,
      case_details_last_fetched: now,
      petitioner: clean(args.caseDetails.petitioner),
      respondent: clean(args.caseDetails.respondent),
      case_status: clean(args.caseDetails.caseStatus),
      next_hearing_date: clean(args.caseDetails.nextHearingDate) || null,
    })
    .eq("id", args.caseId);

  if (args.listingId) {
    await args.supabase
      .from("today_matched_listings")
      .update({
        case_details_json: args.caseDetails,
        case_details_last_fetched: now,
        cnr_number: args.cnrNumber,
        ecourts_case_no: args.ecourtsCaseNo,
      })
      .eq("id", args.listingId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  let body: AnyRec;
  try {
    body = await req.json() as AnyRec;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Server misconfiguration: missing Supabase credentials" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { caseRow, listingRow } = await getCaseRow(supabase, body);
    await ensureCaseColumns(supabase, caseRow.id);

    const caseNumber = clean(body.caseNumber ?? body.case_number ?? caseRow.case_number).toUpperCase();
    const captcha = clean(body.captcha);
    const captchaToken = clean(body.captchaToken ?? body.captcha_token);

    const hasDiscovery = !!clean(caseRow.cnr_number) && !!clean(caseRow.ecourts_case_no);

    // Optimization: If discovery fields already exist, skip captcha and fetch history directly.
    if (hasDiscovery) {
      if (caseRow.case_details_json && isCacheFresh(caseRow.case_details_last_fetched)) {
        return jsonResponse({
          success: true,
          cached: true,
          requiresCaptcha: false,
          caseDetails: caseRow.case_details_json,
        });
      }

      const historyHtml = await fetchCaseHistory({
        ecourtsCaseNo: clean(caseRow.ecourts_case_no),
        cnrNumber: clean(caseRow.cnr_number).toUpperCase(),
      });

      const details = normalizeCaseDetails({
        caseNumber: caseNumber || clean(caseRow.case_number),
        cnrNumber: clean(caseRow.cnr_number).toUpperCase(),
        ecourtsCaseNo: clean(caseRow.ecourts_case_no),
        listing: listingRow,
        caseRow,
        htmlText: historyHtml,
      });

      await upsertDiscoveryAndCache({
        supabase,
        caseId: caseRow.id,
        listingId: clean(listingRow?.id) || null,
        cnrNumber: clean(caseRow.cnr_number).toUpperCase(),
        ecourtsCaseNo: clean(caseRow.ecourts_case_no),
        caseDetails: details,
      });

      return jsonResponse({
        success: true,
        cached: false,
        requiresCaptcha: false,
        caseDetails: details,
      });
    }

    // First-time discovery: return captcha challenge when captcha is not submitted.
    if (!captcha || !captchaToken) {
      const challenge = await createCaptchaChallenge();
      return jsonResponse({
        success: false,
        requiresCaptcha: true,
        ...challenge,
      });
    }

    if (!caseNumber) {
      return jsonResponse({ success: false, error: "caseNumber is required" }, 400);
    }

    const discovered = await searchCaseFromCaptcha({
      caseNumber,
      captcha,
      captchaToken,
    });

    const historyHtml = await fetchCaseHistory({
      ecourtsCaseNo: discovered.ecourtsCaseNo,
      cnrNumber: discovered.cnrNumber,
    });

    const details = normalizeCaseDetails({
      caseNumber,
      cnrNumber: discovered.cnrNumber,
      ecourtsCaseNo: discovered.ecourtsCaseNo,
      listing: listingRow,
      caseRow,
      htmlText: historyHtml,
    });

    await upsertDiscoveryAndCache({
      supabase,
      caseId: caseRow.id,
      listingId: clean(listingRow?.id) || null,
      cnrNumber: discovered.cnrNumber,
      ecourtsCaseNo: discovered.ecourtsCaseNo,
      caseDetails: details,
    });

    return jsonResponse({
      success: true,
      requiresCaptcha: false,
      cached: false,
      caseDetails: details,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "Invalid Captcha") {
      try {
        const challenge = await createCaptchaChallenge();
        return jsonResponse({
          success: false,
          message,
          requiresCaptcha: true,
          ...challenge,
        });
      } catch {
        return jsonResponse({ success: false, error: message }, 400);
      }
    }

    if (message.includes("Case Not Found")) {
      return jsonResponse({ success: false, error: "Case Not Found" }, 200);
    }

    return jsonResponse({ success: false, error: message }, 400);
  }
});
