/**
 * pdf-parser.js
 * -------------
 * Extracts spending transactions from a bank-statement PDF using
 * Mozilla's pdf.js (loaded lazily from a CDN on first use).
 *
 * Bank statements come in many layouts. Rather than trying to match a
 * specific bank's template, we:
 *   1. Pull out the visible text and reconstruct line order using the
 *      text items' y-coordinates (pdf.js returns items in no
 *      particular order, so we group by y and sort by x).
 *   2. Scan each line for a `date ... amount` pattern. If one is
 *      found, we treat the middle portion as the description.
 *   3. Infer a year from any 20YY string on the page (statement
 *      headers almost always include the statement year). If not
 *      found, fall back to the current year.
 *   4. Skip rows that look like deposits / payments received based on
 *      simple keyword heuristics; the user can also remove any row in
 *      the preview table before saving.
 *
 * The parser is intentionally conservative: if a line doesn't clearly
 * contain both a date and a dollar amount it is ignored. Users can
 * always fall back to CSV export.
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_SCRIPT =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
const PDFJS_WORKER =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

/** Cached promise so we only fetch pdf.js once per session. */
let pdfjsPromise = null;

/**
 * Lazily load pdf.js (UMD build) via a <script> tag. UMD keeps us off
 * the module-worker path, which has patchy support on some browsers.
 * Returns the global `pdfjsLib` namespace.
 */
async function loadPdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return window.pdfjsLib;
  }

  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-pdfjs]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.pdfjsLib));
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load pdf.js"))
        );
        return;
      }
      const script = document.createElement("script");
      script.src = PDFJS_SCRIPT;
      script.async = true;
      script.dataset.pdfjs = "1";
      script.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error("pdf.js loaded but pdfjsLib is missing"));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error("Failed to load pdf.js"));
      document.head.appendChild(script);
    });
  }
  return pdfjsPromise;
}

/**
 * Extract all visible text from a PDF file, grouped into lines that
 * preserve left-to-right reading order. Returns an array of strings
 * (one per reconstructed line), plus a best-guess year for the
 * statement.
 *
 * @param {File} file
 * @returns {Promise<{lines: string[], year: number}>}
 */
export async function extractPdfLines(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
    .promise;

  const lines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    // Group text items by their y coordinate (rounded to 1px) so we
    // can rebuild visual lines, then sort each line left-to-right.
    const rows = new Map();
    for (const item of content.items) {
      const str = item.str;
      if (!str || !str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str });
    }

    const orderedYs = Array.from(rows.keys()).sort((a, b) => b - a);
    for (const y of orderedYs) {
      const row = rows.get(y).sort((a, b) => a.x - b.x);
      const line = row
        .map((r) => r.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) lines.push(line);
    }
  }

  const joined = lines.join(" ");
  const yearMatch = joined.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  return { lines, year };
}

/* ==========================================================================
 * Line parsing
 * ========================================================================== */

// MM/DD, MM/DD/YY, MM/DD/YYYY, MM-DD-YYYY.
const DATE_RE = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;

// Matches a trailing dollar amount, allowing: optional $, optional
// negative sign or parentheses for negatives, thousands separators,
// optional two-decimal fractional part, optional trailing CR/DR.
const AMOUNT_RE =
  /(-?\$?\s?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?)\s*(CR|DR)?\s*$/i;

// Descriptions that usually represent credits rather than spending.
const CREDIT_HINTS = [
  "deposit",
  "payment received",
  "payment - thank you",
  "payment thank you",
  "ach credit",
  "credit memo",
  "interest paid",
  "refund",
  "reversal",
  "transfer from",
  "venmo cashout",
  "zelle from",
];

/**
 * Turn an extracted amount string into a signed number.
 * Returns null when the string doesn't parse.
 */
function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  let negative = false;

  if (s.endsWith("CR") || s.endsWith("cr")) {
    negative = true;
    s = s.slice(0, -2).trim();
  } else if (s.endsWith("DR") || s.endsWith("dr")) {
    s = s.slice(0, -2).trim();
  }

  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (negative ? -1 : 1) * n;
}

/**
 * Normalize a date string + fallback year to YYYY-MM-DD.
 */
function normalizeDate(mm, dd, yyMaybe, fallbackYear) {
  let yy = yyMaybe;
  if (!yy) yy = String(fallbackYear);
  else if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;

  const monthNum = Number(mm);
  const dayNum = Number(dd);
  if (
    monthNum < 1 ||
    monthNum > 12 ||
    dayNum < 1 ||
    dayNum > 31 ||
    Number(yy) < 1970
  ) {
    return null;
  }
  return `${yy}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(
    2,
    "0"
  )}`;
}

/**
 * Best-effort category inference. Mirrors the CSV parser so the user
 * gets the same suggestions regardless of source.
 */
function inferCategory(description) {
  const d = (description || "").toLowerCase();
  if (/(uber|lyft|metro|transit|gas|shell|chevron|parking|bart|mta|caltrain)/.test(d))
    return "Transport";
  if (/(netflix|spotify|hulu|prime|subscription|apple|icloud|youtube|disney|hbo|adobe)/.test(d))
    return "Subscriptions";
  if (/(bar|tavern|pub|club|concert|ticket|event|liquor)/.test(d)) return "Social";
  if (/(amazon|target|walmart|ebay|shop|store|mall|clothing|nordstrom|macys|costco)/.test(d))
    return "Shopping";
  if (
    /(starbucks|coffee|cafe|pizza|mcdonald|chipotle|restaurant|grocery|market|doordash|ubereats|grubhub|trader joe|whole foods|deli)/.test(
      d
    )
  )
    return "Food";
  return "Other";
}

function looksLikeCredit(description) {
  const d = (description || "").toLowerCase();
  return CREDIT_HINTS.some((hint) => d.includes(hint));
}

/**
 * Parse previously-extracted lines into candidate transactions.
 *
 * @param {string[]} lines
 * @param {number} year fallback year for lines missing one
 * @returns {{rows: Array<{transaction_date:string, description:string, amount:number, category:string, isLikelyCredit:boolean}>, skipped:number}}
 */
export function parsePdfLines(lines, year) {
  const rows = [];
  let skipped = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    const amountMatch = line.match(AMOUNT_RE);
    if (!amountMatch) continue;

    const [, mm, dd, yyMaybe] = dateMatch;
    const transaction_date = normalizeDate(mm, dd, yyMaybe, year);
    if (!transaction_date) {
      skipped++;
      continue;
    }

    const signedAmount = parseAmount(amountMatch[1] + (amountMatch[2] || ""));
    if (signedAmount == null || signedAmount === 0) {
      skipped++;
      continue;
    }

    let description = line
      .slice(dateMatch[0].length, line.length - amountMatch[0].length)
      .replace(/\s+/g, " ")
      .trim();

    // Many statements repeat a second "post date" directly after the
    // transaction date; strip it if present.
    description = description.replace(DATE_RE, "").trim();

    // Skip purely-numeric leftovers (balance columns, running totals).
    if (!description || /^[\d\s.,$-]+$/.test(description)) {
      skipped++;
      continue;
    }

    const isLikelyCredit = signedAmount < 0 || looksLikeCredit(description);

    rows.push({
      transaction_date,
      description,
      amount: Math.abs(signedAmount),
      category: inferCategory(description),
      isLikelyCredit,
    });
  }

  return { rows, skipped };
}
