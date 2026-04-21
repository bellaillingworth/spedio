/**
 * manual-entry.js
 * ---------------
 * Powers the Manual Entry screen: validates and submits the expense
 * form, then refreshes the list of manual entries for the current
 * month so the user sees the new row appear immediately.
 */

import {
  fetchTransactionsInRange,
  formatCurrency,
  insertManualTransaction,
  isSupabaseConfigured,
  monthRange,
  toISODate,
} from "./supabase-client.js";

const els = {
  form: document.getElementById("entry-form"),
  date: document.getElementById("input-date"),
  category: document.getElementById("input-category"),
  description: document.getElementById("input-description"),
  amount: document.getElementById("input-amount"),
  submitBtn: document.getElementById("submit-btn"),
  error: document.getElementById("form-error"),
  success: document.getElementById("form-success"),
  dateError: document.getElementById("date-error"),
  amountError: document.getElementById("amount-error"),
  configWarning: document.getElementById("config-warning"),
  logBody: document.getElementById("log-body"),
  logSummary: document.getElementById("log-summary"),
};

if (!isSupabaseConfigured) {
  els.configWarning.classList.remove("hidden");
}

// Default the date input to today.
els.date.value = toISODate(new Date());

/**
 * Show a single inline field error with an accessible description.
 */
function setFieldError(node, message) {
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function showFormError(message) {
  els.error.textContent = message;
  els.error.classList.remove("hidden");
}

function clearMessages() {
  els.error.classList.add("hidden");
  els.error.textContent = "";
  els.success.classList.add("hidden");
  els.success.textContent = "";
  setFieldError(els.dateError, null);
  setFieldError(els.amountError, null);
}

/**
 * Validate the form values and return an entry object or null.
 */
function readForm() {
  let ok = true;
  const transaction_date = els.date.value;
  if (!transaction_date) {
    setFieldError(els.dateError, "Please select a date.");
    ok = false;
  }

  const amountRaw = els.amount.value;
  const amount = Number(amountRaw);
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
    setFieldError(els.amountError, "Enter a positive amount greater than zero.");
    ok = false;
  }

  if (!ok) return null;

  return {
    transaction_date,
    category: els.category.value,
    description: els.description.value.trim(),
    amount: Math.round(amount * 100) / 100,
  };
}

/**
 * Re-render the current-month log of manual transactions.
 */
async function refreshLog() {
  if (!isSupabaseConfigured) {
    els.logBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          Connect Supabase to see your recent entries here.
        </td>
      </tr>`;
    els.logSummary.textContent = "";
    return;
  }

  const { startISO, endISO } = monthRange(new Date());
  const { data, error } = await fetchTransactionsInRange(startISO, endISO);

  if (error) {
    els.logBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          Couldn't load recent entries. Please refresh.
        </td>
      </tr>`;
    els.logSummary.textContent = "";
    return;
  }

  const manual = data.filter((t) => t.source === "manual");
  manual.sort((a, b) => {
    if (a.transaction_date === b.transaction_date) {
      return (b.created_at || "").localeCompare(a.created_at || "");
    }
    return b.transaction_date.localeCompare(a.transaction_date);
  });

  if (manual.length === 0) {
    els.logBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">
          No manual entries this month yet. Add your first expense above.
        </td>
      </tr>`;
    els.logSummary.textContent = "";
    return;
  }

  els.logBody.innerHTML = "";
  manual.forEach((t) => {
    const tr = document.createElement("tr");
    const cells = [
      t.transaction_date,
      t.category,
      t.description || "—",
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    const amtTd = document.createElement("td");
    amtTd.className = "num";
    amtTd.textContent = formatCurrency(t.amount);
    tr.appendChild(amtTd);
    els.logBody.appendChild(tr);
  });

  const total = manual.reduce((s, t) => s + Number(t.amount || 0), 0);
  els.logSummary.textContent = `${manual.length} entries · total ${formatCurrency(total)}`;
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();

  const entry = readForm();
  if (!entry) {
    showFormError("Please fix the highlighted fields.");
    return;
  }

  if (!isSupabaseConfigured) {
    showFormError("Supabase isn't configured, so entries can't be saved.");
    return;
  }

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "Saving…";
  const { error } = await insertManualTransaction(entry);
  els.submitBtn.disabled = false;
  els.submitBtn.textContent = "Save expense";

  if (error) {
    showFormError("We couldn't save that expense. Please try again.");
    return;
  }

  els.success.textContent = `Saved ${formatCurrency(entry.amount)} to ${entry.category}.`;
  els.success.classList.remove("hidden");

  els.description.value = "";
  els.amount.value = "";
  els.date.value = toISODate(new Date());
  els.description.focus();

  refreshLog();
});

els.form.addEventListener("reset", () => {
  clearMessages();
  setTimeout(() => {
    els.date.value = toISODate(new Date());
  }, 0);
});

refreshLog();
