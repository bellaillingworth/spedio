/**
 * dashboard.js
 * ------------
 * Loads the current month's transactions from Supabase, renders the
 * summary stat cards, the teal hero bar chart, a recent-transactions
 * list, and the category breakdown (mini-cards + horizontal bars).
 */

import {
  CATEGORIES,
  fetchEarliestTransactionDate,
  fetchTransactionsInRange,
  formatCurrency,
  formatMonthLabel,
  isSupabaseConfigured,
  monthRange,
} from "./supabase-client.js";
import {
  buildDailySeries,
  renderCategoryBarChart,
  renderHeroDailyBars,
  summarizeByCategory,
} from "./charts.js";

/**
 * Inline SVG markup for a category icon, used in the mini-cards and
 * recent transactions list. Returning HTML strings keeps the JS simple
 * and avoids a tiny icon-library dependency.
 */
function categoryIcon(category) {
  const icons = {
    Food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v8a2 2 0 0 0 2 2h.5A2.5 2.5 0 0 1 8 14.5V22"/><path d="M21 2v20"/><path d="M17 2v8a4 4 0 0 0 4 4"/></svg>',
    Transport:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h2l1-5h12l1 5h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
    Social:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    Subscriptions:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    Shopping:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    Other:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  };
  return icons[category] || icons.Other;
}

/** Lowercased, used for CSS class suffixes. */
function classSuffix(category) {
  return (category || "Other").toLowerCase();
}

/** Update the four pastel stat cards at the top of the dashboard. */
function updateSummary(transactions, categoryTotals, dailySeries) {
  const total = transactions.reduce(
    (s, t) => s + (Number(t.amount) || 0),
    0
  );
  const top = categoryTotals[0];
  const today = new Date();
  const daysElapsed = Math.max(1, today.getDate());
  const avg = total / daysElapsed;

  document.getElementById("stat-total").textContent = formatCurrency(total);
  document.getElementById("stat-category").textContent = top ? top.category : "—";
  document.getElementById("stat-category-meta").textContent = top
    ? `${formatCurrency(top.total)} spent`
    : "Add an expense to see this";
  document.getElementById("stat-count").textContent = String(transactions.length);
  document.getElementById("stat-avg").textContent = formatCurrency(avg);

  document.getElementById("hero-total").textContent = formatCurrency(total);
  document.getElementById("hero-delta").textContent = `${transactions.length} txns`;
  document.getElementById("hero-range-label").textContent = `${dailySeries.length} days`;
}

/**
 * Render the recent transactions list (latest 6). Falls back to a
 * friendly empty state if the month has no activity yet.
 */
function renderRecent(transactions) {
  const list = document.getElementById("recent-list");
  list.innerHTML = "";

  if (transactions.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "No transactions yet. Add one from Add Expense or Upload.";
    list.appendChild(li);
    return;
  }

  const sorted = [...transactions].sort((a, b) => {
    if (a.transaction_date === b.transaction_date) {
      return (b.created_at || "").localeCompare(a.created_at || "");
    }
    return b.transaction_date.localeCompare(a.transaction_date);
  });

  const recent = sorted.slice(0, 6);
  recent.forEach((t) => {
    const li = document.createElement("li");
    li.className = "txn-list__item";

    const icon = document.createElement("span");
    icon.className = `txn-icon txn-icon--${classSuffix(t.category)}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = categoryIcon(t.category);
    li.appendChild(icon);

    const body = document.createElement("div");
    body.className = "txn-body";
    const title = document.createElement("p");
    title.className = "txn-body__title";
    title.textContent = t.description?.trim() || t.category;
    const subtitle = document.createElement("p");
    subtitle.className = "txn-body__subtitle";
    const dateLabel = new Date(
      `${t.transaction_date}T00:00:00`
    ).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    subtitle.textContent = `${t.category} · ${dateLabel}`;
    body.append(title, subtitle);
    li.appendChild(body);

    const amt = document.createElement("span");
    amt.className = "txn-amount";
    amt.textContent = `-${formatCurrency(Number(t.amount) || 0)}`;
    li.appendChild(amt);

    list.appendChild(li);
  });
}

/**
 * Render the pastel mini-cards with a total for each of the six
 * categories. Missing categories still render (with $0) so the grid
 * stays a consistent shape.
 */
function renderCategoryGrid(categoryTotals) {
  const grid = document.getElementById("category-grid");
  grid.innerHTML = "";
  const totalsByCat = new Map(categoryTotals.map((c) => [c.category, c.total]));

  CATEGORIES.forEach((cat) => {
    const total = totalsByCat.get(cat) || 0;
    const card = document.createElement("div");
    card.className = `cat-card cat-card--${classSuffix(cat)}`;
    card.innerHTML = `
      <span class="cat-card__icon" aria-hidden="true">${categoryIcon(cat)}</span>
      <div>
        <p class="cat-card__label">${cat}</p>
        <p class="cat-card__value">${formatCurrency(total)}</p>
      </div>
    `;
    grid.appendChild(card);
  });
}

async function init() {
  const now = new Date();
  const { startISO, endISO } = monthRange(now);

  document.getElementById(
    "current-month-label"
  ).textContent = `${formatMonthLabel(now)} · here's your spending at a glance.`;

  if (!isSupabaseConfigured) {
    document.getElementById("config-warning").classList.remove("hidden");
    renderCategoryGrid([]);
    renderRecent([]);
    return;
  }

  const { data: transactions, error } = await fetchTransactionsInRange(
    startISO,
    endISO
  );

  if (error) {
    const el = document.getElementById("load-error");
    el.textContent =
      "We couldn't load your transactions. Please check your connection and try again.";
    el.classList.remove("hidden");
    return;
  }

  const categoryTotals = summarizeByCategory(transactions);
  const dailySeries = buildDailySeries(
    transactions,
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  // If the current month is empty but older data exists, point the
  // user at History so uploaded statements from past months aren't
  // invisible.
  if (transactions.length === 0) {
    const { data: earliest } = await fetchEarliestTransactionDate();
    if (earliest) {
      const earliestMonth = earliest.slice(0, 7);
      const banner = document.getElementById("load-error");
      banner.classList.remove("message--error");
      banner.classList.add("message--info");
      banner.innerHTML = `
        Nothing logged for ${formatMonthLabel(now)} yet.
        Your earliest transaction is dated
        ${new Date(`${earliest}T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}.
        <a href="/history.html?month=${earliestMonth}">View it in History &rarr;</a>
      `;
      banner.classList.remove("hidden");
    }
  }

  updateSummary(transactions, categoryTotals, dailySeries);
  renderRecent(transactions);
  renderCategoryGrid(categoryTotals);

  renderHeroDailyBars(
    document.getElementById("hero-chart"),
    dailySeries,
    {
      ariaLabel: `Daily spending for ${formatMonthLabel(now)}`,
      highlightDate: now,
    }
  );

  renderCategoryBarChart(
    document.getElementById("bar-chart"),
    categoryTotals,
    { ariaLabel: `Spending by category for ${formatMonthLabel(now)}` }
  );
}

init();
