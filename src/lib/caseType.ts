/**
 * lib/caseType.ts — Derive a human-readable Case Type from a case number.
 *
 * The case number's leading token identifies the matter type, e.g.
 *   "WA/2356/2026"      → "Writ Appeal"
 *   "CRL OP/123/2025"   → "Criminal Original Petition"
 *   "WP(MD)/9/2026"     → "Writ Petition"
 *
 * The normalisation mirrors the Python backend's `_normalize_case_type`
 * (backend/app.py) so the frontend, the bulk importer and the eCourts sync all
 * agree on the same canonical key. The authoritative persistence is a database
 * trigger (migration 022) — this module powers immediate UI display, the manual
 * override field and the dashboard analytics.
 */

/** Canonical (separator-free, upper-case) prefix → friendly description. */
export const CASE_TYPE_LABELS: Record<string, string> = {
  // ── Writ ──────────────────────────────────────────────────────────────────
  WP: 'Writ Petition',
  WPCRL: 'Writ Petition (Criminal)',
  WA: 'Writ Appeal',
  WMP: 'Writ Miscellaneous Petition',
  WPMP: 'Writ Petition Miscellaneous Petition',
  WAMP: 'Writ Appeal Miscellaneous Petition',
  WVMP: 'Writ Vacate Miscellaneous Petition',
  PIL: 'Public Interest Litigation',
  // ── Civil ─────────────────────────────────────────────────────────────────
  CMA: 'Civil Miscellaneous Appeal',
  CMSA: 'Civil Miscellaneous Second Appeal',
  CMP: 'Civil Miscellaneous Petition',
  CRP: 'Civil Revision Petition',
  CS: 'Civil Suit',
  OS: 'Original Suit',
  AS: 'Appeal Suit',
  SA: 'Second Appeal',
  FA: 'First Appeal',
  RFA: 'Regular First Appeal',
  RSA: 'Regular Second Appeal',
  LPA: 'Letters Patent Appeal',
  OSA: 'Original Side Appeal',
  OP: 'Original Petition',
  OA: 'Original Application',
  IA: 'Interlocutory Application',
  EP: 'Election Petition',
  RC: 'Revision Case',
  MC: 'Miscellaneous Case',
  MP: 'Miscellaneous Petition',
  // ── Criminal ────────────────────────────────────────────────────────────
  CRLOP: 'Criminal Original Petition',
  CRLMP: 'Criminal Miscellaneous Petition',
  CRLMC: 'Criminal Miscellaneous Case',
  CRLA: 'Criminal Appeal',
  CRLRC: 'Criminal Revision Case',
  CRLRP: 'Criminal Revision Petition',
  CRLREF: 'Criminal Reference',
  CC: 'Criminal Complaint',
  BA: 'Bail Application',
  ABA: 'Anticipatory Bail Application',
  HCP: 'Habeas Corpus Petition',
  HCMP: 'Habeas Corpus Miscellaneous Petition',
  // ── Contempt ──────────────────────────────────────────────────────────────
  CONTP: 'Contempt Petition',
  CONTA: 'Contempt Appeal',
  // ── Tax ─────────────────────────────────────────────────────────────────
  TC: 'Tax Case',
  TCA: 'Tax Case Appeal',
  TCP: 'Tax Case Petition',
  TCR: 'Tax Case Reference',
};

/**
 * Canonicalise a raw case-type token: upper-case, drop parenthetical bench
 * codes (MD/MHC…), strip dots/spaces, and a trailing "NO".
 * Mirrors backend `_normalize_case_type`.
 */
export function normalizeCaseTypePrefix(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase();
  s = s.replace(/\([^)]*\)/g, '');   // WP(MD) → WP
  s = s.replace(/[.\s_-]/g, '');     // remove dots / spaces / underscores / hyphens
  s = s.replace(/NO$/, '');          // W.P.No → WPNO → WP
  return s.trim();
}

/** Extract the leading type token from a full case number. */
function extractPrefix(caseNumber: string | null | undefined): string {
  if (!caseNumber) return '';
  // Everything before the first "/" (covers "CRL OP/123/2026"); if there is no
  // slash, drop everything from the first digit onward ("WA2356" → "WA").
  let head = String(caseNumber).trim().split('/')[0] ?? '';
  head = head.replace(/\d.*$/, ' ');
  return normalizeCaseTypePrefix(head);
}

/**
 * Derive the friendly Case Type description from a case number.
 * Returns the mapped description, else the normalised prefix (so unknown types
 * still group meaningfully), else null when no prefix can be found.
 */
export function deriveCaseType(caseNumber: string | null | undefined): string | null {
  const prefix = extractPrefix(caseNumber);
  if (!prefix) return null;
  return CASE_TYPE_LABELS[prefix] ?? prefix;
}

/** All known case-type descriptions, sorted — handy for filter dropdowns. */
export const CASE_TYPE_OPTIONS: string[] = Array.from(
  new Set(Object.values(CASE_TYPE_LABELS)),
).sort((a, b) => a.localeCompare(b));
