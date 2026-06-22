import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ECOURTS_API_BASE = Deno.env.get("ECOURTS_API_BASE_URL") ?? "https://webapi.ecourtsindia.com";
const ECOURTS_API_KEY = Deno.env.get("ECOURTS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CACHE_TTL_HOURS = 24;
const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isCacheFresh(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  return ageMs < CACHE_TTL_HOURS * 60 * 60 * 1000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!ECOURTS_API_KEY) {
      return jsonResponse({ success: false, error: "Server is missing ECOURTS_API_KEY configuration." });
    }

    let payload: { cnr?: string; filename?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON body." });
    }

    const cnr = (payload.cnr ?? "").trim();
    const filename = (payload.filename ?? "").trim();

    if (!cnr || !filename) {
      return jsonResponse({
        success: false,
        error: "Both 'cnr' and 'filename' are required.",
        received: { cnr, filename },
      });
    }

    const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    // 1. Return cached order metadata if still fresh.
    if (supabase) {
      const { data: cached } = await supabase
        .from("case_orders_cache")
        .select("metadata, created_at")
        .eq("cnr", cnr)
        .eq("filename", filename)
        .maybeSingle();

      if (cached && isCacheFresh(cached.created_at) && cached.metadata) {
        const meta = cached.metadata as Record<string, unknown>;
        if (meta.downloadUrl) {
          return jsonResponse({
            success: true,
            cnr,
            filename,
            downloadUrl: meta.downloadUrl,
            downloadFilename: meta.downloadFilename ?? filename,
            cached: true,
          });
        }
      }
    }

    // 2. Fetch the order from the eCourts partner API (API key stays server-side).
    const url = `${ECOURTS_API_BASE.replace(/\/+$/, "")}/api/partner/case/${encodeURIComponent(cnr)}/order/${encodeURIComponent(filename)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ECOURTS_API_KEY}`,
        Accept: "application/json",
      },
    });

    const resText = await res.text();

    if (!res.ok) {
      return jsonResponse({
        success: false,
        error: `eCourts returned HTTP ${res.status}.`,
        detail: resText.slice(0, 500),
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(resText);
    } catch {
      return jsonResponse({
        success: false,
        error: "eCourts returned a non-JSON response.",
        detail: resText.slice(0, 500),
      });
    }

    const body = parsed?.data ?? parsed;
    const downloadUrl: string =
      body?.downloadUrl ?? body?.download_url ?? body?.url ?? body?.orderUrl ?? "";
    const downloadFilename: string =
      body?.downloadFilename ?? body?.download_filename ?? body?.filename ?? filename;

    if (!downloadUrl) {
      return jsonResponse({
        success: false,
        error: "eCourts response did not include a download URL.",
        detail: JSON.stringify(parsed).slice(0, 500),
      });
    }

    // 3. Cache the metadata for next time.
    if (supabase) {
      await supabase
        .from("case_orders_cache")
        .upsert(
          {
            cnr,
            filename,
            metadata: { downloadUrl, downloadFilename },
            created_at: new Date().toISOString(),
          },
          { onConflict: "cnr,filename" },
        );
    }

    return jsonResponse({
      success: true,
      cnr,
      filename,
      downloadUrl,
      downloadFilename,
      cached: false,
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err instanceof Error ? err.message : "Unexpected server error.",
    });
  }
});
