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
 *   2. Scan the header area for the statement period (start + end
 *      dates) so we know which calendar year every row belongs to —
 *      most statements print transactions as just "MM/DD" and may
 *      wrap from December into January.
 *   3. Scan each line for a `date ... amount` pattern. If one is
 *      found, we treat the middle portion as the description and
 *      assign each MM/DD the correct year from the statement period.
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
 * (one per reconstructed line), plus a best-guess statement period
 * and year.
 *
 * @param {File} file
 * @returns {Promise<{lines: string[], year: number, period: {start: Date, end: Date}|null}>}
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

  const period = findStatementPeriod(lines);

  // Fall back to a plain-year match so callers that only want a year
  // still get something reasonable when no period is detectable.
  let year;
  if (period) {
    // Prefer the end year — closing month is what banks label the
    // statement with, and most transactions are dated near the end.
    year = period.end.getFullYear();
  } else {
    const joined = lines.join(" ");
    const yearMatch = joined.match(/\b(20\d{2})\b/);
    year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  }

  return { lines, year, period };
}

/* ==========================================================================
 * Statement period detection
 *
 * Transactions inside a bank statement are usually printed as just
 * "MM/DD" with no year, because the year is already implied by the
 * statement header. To get the year right — especially for statements
 * that wrap from December into January — we look for the statement
 * period near the top of the document and use that as the source of
 * truth.
 * ========================================================================== */

const MONTH_NAMES = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function makeDate(year, month0, day) {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month0) ||
    !Number.isFinite(day) ||
    year < 1970 ||
    month0 < 0 ||
    month0 > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const d = new Date(year, month0, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function expandYear(yy) {
  const n = Number(yy);
  if (!Number.isFinite(n)) return null;
  if (String(yy).length === 2) return (n > 50 ? 1900 : 2000) + n;
  return n;
}

function parseNumericDate(mm, dd, yy) {
  const year = expandYear(yy);
  if (year == null) return null;
  return makeDate(year, Number(mm) - 1, Number(dd));
}

function parseMonthNameDate(monthName, day, year) {
  const m = MONTH_NAMES[String(monthName).toLowerCase()];
  if (m == null) return null;
  return makeDate(Number(year), m, Number(day));
}

/**
 * Try a list of patterns against the PDF text and return the first
 * {start, end} pair we can confidently extract. Returns null when no
 * recognizable statement period is found.
 */
function findStatementPeriod(lines) {
  const joined = lines.join(" ").replace(/\s+/g, " ");

  // MM/DD/YYYY - MM/DD/YYYY  (also handles "to" / "through" / en/em dash)
  const numericRange = joined.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s*(?:[-–—]|to|through|thru)\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i
  );
  if (numericRange) {
    const s = parseNumericDate(numericRange[1], numericRange[2], numericRange[3]);
    const e = parseNumericDate(numericRange[4], numericRange[5], numericRange[6]);
    if (s && e && e >= s) return { start: s, end: e };
  }

  // "December 15, 2024 - January 14, 2025"
  const monthRange = joined.match(
    /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\s*(?:[-–—]|to|through|thru)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (monthRange) {
    const s = parseMonthNameDate(monthRange[1], monthRange[2], monthRange[3]);
    const e = parseMonthNameDate(monthRange[4], monthRange[5], monthRange[6]);
    if (s && e && e >= s) return { start: s, end: e };
  }

  // "Dec 15 - Jan 14, 2025" (only the end date carries the year)
  const shortRange = joined.match(
    /([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*(?:[-–—]|to|through|thru)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (shortRange) {
    const endYear = Number(shortRange[5]);
    const e = parseMonthNameDate(shortRange[3], shortRange[4], endYear);
    let s = parseMonthNameDate(shortRange[1], shortRange[2], endYear);
    if (s && e && s > e) {
      // e.g. "Dec 15 - Jan 14, 2025" → start was actually 2024.
      s = parseMonthNameDate(shortRange[1], shortRange[2], endYear - 1);
    }
    if (s && e && e >= s) return { start: s, end: e };
  }

  // "Closing Date: 01/14/2025" / "Statement Date January 14, 2025"
  const closingNumeric = joined.match(
    /(?:closing|ending|statement|period\s+ending)\s+date[:\s]+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i
  );
  if (closingNumeric) {
    const end = parseNumericDate(
      closingNumeric[1],
      closingNumeric[2],
      closingNumeric[3]
    );
    if (end) return periodFromEnd(end);
  }

  const closingNamed = joined.match(
    /(?:closing|ending|statement|period\s+ending)\s+date[:\s]+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (closingNamed) {
    const end = parseMonthNameDate(
      closingNamed[1],
      closingNamed[2],
      closingNamed[3]
    );
    if (end) return periodFromEnd(end);
  }

  // "January 2025 Statement" / "Statement for January 2025"
  const monthYear = joined.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
  );
  if (monthYear) {
    const m = MONTH_NAMES[monthYear[1].toLowerCase()];
    const y = Number(monthYear[2]);
    const start = makeDate(y, m, 1);
    const end = makeDate(y, m + 1, 0); // last day of month
    if (start && end) return { start, end };
  }

  return null;
}

/**
 * Given only a closing / statement date, assume a ~31-day window
 * ending on it. Used when the statement prints one date but no
 * explicit opening date.
 */
function periodFromEnd(endDate) {
  const start = new Date(endDate);
  start.setDate(start.getDate() - 31);
  return { start, end: endDate };
}

/**
 * Pick the most plausible year for a bare MM/DD, given a known
 * statement period. If either the start or end year makes the date
 * land inside the period, use that one. Otherwise fall back to the
 * closest-looking year (late months → start year, early months →
 * end year for year-crossing statements).
 */
function pickYearFromPeriod(month1, day, period) {
  const startYear = period.start.getFullYear();
  const endYear = period.end.getFullYear();
  const candidates = startYear === endYear ? [startYear] : [startYear, endYear];

  const startMs = new Date(
    period.start.getFullYear(),
    period.start.getMonth(),
    period.start.getDate()
  ).getTime();
  const endMs = new Date(
    period.end.getFullYear(),
    period.end.getMonth(),
    period.end.getDate()
  ).getTime();

  for (const y of candidates) {
    const dt = makeDate(y, month1 - 1, day);
    if (!dt) continue;
    const t = dt.getTime();
    if (t >= startMs && t <= endMs) return y;
  }

  if (startYear === endYear) return startYear;

  // Period crosses a year boundary but the MM/DD doesn't land
  // cleanly inside it (e.g. a pending row dated a few days late).
  // Use the start month as the pivot: everything from startMonth
  // onward belongs to startYear, earlier months to endYear.
  return month1 >= period.start.getMonth() + 1 ? startYear : endYear;
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
 * Normalize a date string to YYYY-MM-DD. When the line itself
 * supplies a year we trust it; otherwise we ask the statement period
 * which year this MM/DD belongs to, and only fall back to the plain
 * fallbackYear if no period was detected.
 */
function normalizeDate(mm, dd, yyMaybe, fallbackYear, period) {
  const monthNum = Number(mm);
  const dayNum = Number(dd);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;

  let year;
  if (yyMaybe) {
    year = expandYear(yyMaybe);
  } else if (period) {
    year = pickYearFromPeriod(monthNum, dayNum, period);
  } else {
    year = Number(fallbackYear) || new Date().getFullYear();
  }

  if (!Number.isFinite(year) || year < 1970) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(
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
 * @param {number | {year?: number, period?: {start: Date, end: Date}|null}} yearOrContext
 *   Either a fallback year (back-compat) or a context object with the
 *   statement period so bare MM/DD rows can be assigned the correct
 *   year.
 * @returns {{rows: Array<{transaction_date:string, description:string, amount:number, category:string, isLikelyCredit:boolean}>, skipped:number}}
 */
export function parsePdfLines(lines, yearOrContext) {
  const context =
    typeof yearOrContext === "number" || yearOrContext == null
      ? { year: yearOrContext, period: null }
      : yearOrContext;
  const fallbackYear = context.year || new Date().getFullYear();
  const period = context.period || null;

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
    const transaction_date = normalizeDate(
      mm,
      dd,
      yyMaybe,
      fallbackYear,
      period
    );
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
