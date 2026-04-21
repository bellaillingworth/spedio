/**
 * supabase-client.js
 * ------------------
 * Initializes the Supabase JS client and exposes query helpers for the
 * `transactions` table. All async calls use try/catch and return a
 * consistent `{ data, error }` shape so callers never throw.
 *
 * Configuration:
 *   Edit `SUPABASE_URL` and `SUPABASE_ANON_KEY` below, OR set them at
 *   runtime via window.SPENDIO_CONFIG before this script loads:
 *
 *     <script>
 *       window.SPENDIO_CONFIG = {
 *         supabaseUrl: "https://xxxx.supabase.co",
 *         supabaseAnonKey: "ey..."
 *       };
 *     </script>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_SUPABASE_URL = "https://wxphkkzweompdlpyxfps.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "sb_publishable_lTCiR_fQGP7V3eI5gMcVwg_b16SIOgU";

const cfg = (typeof window !== "undefined" && window.SPENDIO_CONFIG) || {};
const SUPABASE_URL = cfg.supabaseUrl || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = cfg.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;

/**
 * The active Supabase client instance.
 * Exported so individual page scripts can issue custom queries if needed.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

/**
 * True once the user has configured real Supabase credentials.
 * Pages use this to show a helpful inline warning when the app is
 * running without a backend (e.g. local static preview).
 */
export const isSupabaseConfigured =
  SUPABASE_URL !== "YOUR_SUPABASE_URL" &&
  SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY" &&
  SUPABASE_URL.startsWith("http");

/**
 * Allowed spending categories. Used by the manual entry dropdown and
 * for validating uploaded rows.
 */
export const CATEGORIES = [
  "Food",
  "Transport",
  "Social",
  "Subscriptions",
  "Shopping",
  "Other",
];

/**
 * Map a category name to a CSS custom property for consistent colors
 * across all charts and legends.
 */
export const CATEGORY_COLORS = {
  Food: "var(--cat-food)",
  Transport: "var(--cat-transport)",
  Social: "var(--cat-social)",
  Subscriptions: "var(--cat-subscriptions)",
  Shopping: "var(--cat-shopping)",
  Other: "var(--cat-other)",
};

/**
 * Format a numeric amount as USD currency for display.
 * @param {number} value
 */
export function formatCurrency(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Return { startISO, endISO } strings (YYYY-MM-DD) covering the calendar
 * month that contains the given Date. `endISO` is the first day of the
 * following month, making it suitable for half-open range queries
 * (`>= start AND < end`).
 * @param {Date} date
 */
export function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { startISO: toISODate(start), endISO: toISODate(end) };
}

/**
 * Format a Date as YYYY-MM-DD in local time (avoids timezone shifts).
 * @param {Date} d
 */
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Human-readable month label like "April 2026".
 * @param {Date} d
 */
export function formatMonthLabel(d) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Fetch all transactions within the given date range (half-open).
 * @param {string} startISO inclusive (YYYY-MM-DD)
 * @param {string} endISO exclusive (YYYY-MM-DD)
 */
export async function fetchTransactionsInRange(startISO, endISO) {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, category, description, amount, source, created_at")
      .gte("transaction_date", startISO)
      .lt("transaction_date", endISO)
      .order("transaction_date", { ascending: true });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    console.error("fetchTransactionsInRange failed", err);
    return { data: [], error: err };
  }
}

/**
 * Fetch the earliest transaction_date on record. Used by the history
 * page to determine how far back the month selector can go.
 */
export async function fetchEarliestTransactionDate() {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_date")
      .order("transaction_date", { ascending: true })
      .limit(1);

    if (error) throw error;
    return { data: data?.[0]?.transaction_date || null, error: null };
  } catch (err) {
    console.error("fetchEarliestTransactionDate failed", err);
    return { data: null, error: err };
  }
}

/**
 * Insert a single manually entered transaction.
 * @param {{transaction_date:string, category:string, description:string, amount:number}} entry
 */
export async function insertManualTransaction(entry) {
  try {
    const payload = { ...entry, source: "manual" };
    const { data, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error("insertManualTransaction failed", err);
    return { data: null, error: err };
  }
}

/**
 * Bulk insert parsed transactions from an uploaded statement.
 * @param {Array<object>} rows
 */
export async function insertUploadedTransactions(rows) {
  try {
    const payload = rows.map((r) => ({ ...r, source: "upload" }));
    const { data, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select();

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    console.error("insertUploadedTransactions failed", err);
    return { data: null, error: err };
  }
}
