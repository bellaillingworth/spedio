/**
 * history.js
 * ----------
 * Spending history screen. Lets the user pick any month between their
 * earliest recorded transaction and the current month, then renders
 * summary stats plus a donut + line chart for that month.
 */

import {
  fetchEarliestTransactionDate,
  fetchTransactionsInRange,
  formatCurrency,
  formatMonthLabel,
  isSupabaseConfigured,
  monthRange,
} from "./supabase-client.js";
import {
  buildDailySeries,
  renderCategoryDonutChart,
  renderDailyLineChart,
  summarizeByCategory,
} from "./charts.js";
import { trackEvent } from "./analytics.js";

/** Format the currently-selected month as "YYYY-MM" for analytics. */
function selectedMonthKey() {
  return `${selectedMonth.getFullYear()}-${String(
    selectedMonth.getMonth() + 1
  ).padStart(2, "0")}`;
}

const els = {
  prev: document.getElementById("prev-month"),
  next: document.getElementById("next-month"),
  label: document.getElementById("selected-month-label"),
  select: document.getElementById("month-select"),
  total: document.getElementById("stat-total"),
  avg: document.getElementById("stat-avg"),
  highest: document.getElementById("stat-highest"),
  donut: document.getElementById("donut-chart"),
  donutLegend: document.getElementById("donut-legend"),
  line: document.getElementById("line-chart"),
  configWarning: document.getElementById("config-warning"),
  loadError: document.getElementById("load-error"),
};

/** First-of-month Date the user is currently viewing. */
let selectedMonth = startOfMonth(new Date());
/** Earliest first-of-month Date the user can navigate to. */
let minMonth = startOfMonth(new Date());
/** Latest first-of-month (always "this month" — future months are hidden). */
let maxMonth = startOfMonth(new Date());

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Compare two "first of month" dates. Returns -1/0/1.
 */
function cmpMonth(a, b) {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() - b.getFullYear();
  return a.getMonth() - b.getMonth();
}

/**
 * Build the dropdown with one option per month between minMonth and maxMonth.
 */
function buildMonthOptions() {
  els.select.innerHTML = "";
  const months = [];
  const cursor = new Date(maxMonth);
  while (cmpMonth(cursor, minMonth) >= 0) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() - 1);
  }
  months.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    opt.textContent = formatMonthLabel(m);
    els.select.appendChild(opt);
  });
}

/**
 * Update the visible state (label, select value, button disabled states).
 */
function syncSelectorUI() {
  els.label.textContent = formatMonthLabel(selectedMonth);
  const value = `${selectedMonth.getFullYear()}-${String(
    selectedMonth.getMonth() + 1
  ).padStart(2, "0")}`;
  if (els.select.value !== value) els.select.value = value;
  els.prev.disabled = cmpMonth(selectedMonth, minMonth) <= 0;
  els.next.disabled = cmpMonth(selectedMonth, maxMonth) >= 0;
}

/**
 * Update the three summary stat cards.
 */
function updateStats(transactions, dailySeries) {
  const total = transactions.reduce(
    (s, t) => s + (Number(t.amount) || 0),
    0
  );
  const daysInMonth = dailySeries.length || 1;
  const avg = total / daysInMonth;

  let highest = null;
  dailySeries.forEach((d) => {
    if (!highest || d.total > highest.total) highest = d;
  });

  els.total.textContent = formatCurrency(total);
  els.avg.textContent = formatCurrency(avg);
  els.highest.textContent =
    highest && highest.total > 0
      ? `${highest.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })} · ${formatCurrency(highest.total)}`
      : "—";
}

/**
 * Load data for the currently selected month and redraw everything.
 */
async function loadSelectedMonth() {
  syncSelectorUI();
  els.loadError.classList.add("hidden");

  if (!isSupabaseConfigured) {
    return;
  }

  const { startISO, endISO } = monthRange(selectedMonth);
  const { data: transactions, error } = await fetchTransactionsInRange(
    startISO,
    endISO
  );

  if (error) {
    els.loadError.textContent =
      "We couldn't load history for this month. Please try again.";
    els.loadError.classList.remove("hidden");
    return;
  }

  const categoryTotals = summarizeByCategory(transactions);
  const dailySeries = buildDailySeries(
    transactions,
    new Date(selectedMonth),
    new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1)
  );

  updateStats(transactions, dailySeries);
  renderCategoryDonutChart(
    els.donut,
    els.donutLegend,
    categoryTotals,
    { ariaLabel: `Category breakdown for ${formatMonthLabel(selectedMonth)}` }
  );
  renderDailyLineChart(els.line, dailySeries, {
    ariaLabel: `Daily spending for ${formatMonthLabel(selectedMonth)}`,
  });
}

/**
 * One-time setup: determine month range and wire up controls.
 */
/**
 * Read a ?month=YYYY-MM query param and return a first-of-month Date,
 * or null if the param is missing or malformed. Used to deep-link
 * from the Upload success message to the right month.
 */
function monthFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("month");
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const [, y, m] = match;
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function init() {
  maxMonth = startOfMonth(new Date());
  selectedMonth = new Date(maxMonth);
  minMonth = new Date(maxMonth);
  minMonth.setMonth(minMonth.getMonth() - 11); // default: last 12 months

  if (!isSupabaseConfigured) {
    els.configWarning.classList.remove("hidden");
  } else {
    const { data: earliest } = await fetchEarliestTransactionDate();
    if (earliest) {
      const [y, m] = earliest.split("-").map(Number);
      const earliestMonth = new Date(y, m - 1, 1);
      if (cmpMonth(earliestMonth, minMonth) < 0) minMonth = earliestMonth;
    }
  }

  // Respect a ?month=YYYY-MM deep link if it's within the allowed range.
  const queried = monthFromQuery();
  if (queried && cmpMonth(queried, minMonth) >= 0 && cmpMonth(queried, maxMonth) <= 0) {
    selectedMonth = queried;
  }

  buildMonthOptions();

  els.prev.addEventListener("click", () => {
    const next = new Date(selectedMonth);
    next.setMonth(next.getMonth() - 1);
    if (cmpMonth(next, minMonth) < 0) return;
    selectedMonth = next;
    loadSelectedMonth();
    trackEvent("month_changed", { method: "prev", month: selectedMonthKey() });
  });

  els.next.addEventListener("click", () => {
    const next = new Date(selectedMonth);
    next.setMonth(next.getMonth() + 1);
    if (cmpMonth(next, maxMonth) > 0) return;
    selectedMonth = next;
    loadSelectedMonth();
    trackEvent("month_changed", { method: "next", month: selectedMonthKey() });
  });

  els.select.addEventListener("change", (e) => {
    const [y, m] = e.target.value.split("-").map(Number);
    selectedMonth = new Date(y, m - 1, 1);
    loadSelectedMonth();
    trackEvent("month_changed", { method: "select", month: selectedMonthKey() });
  });

  loadSelectedMonth();
}

init();
