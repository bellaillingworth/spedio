/**
 * upload.js
 * ---------
 * Handles the Upload Bank Statement screen for both CSV and PDF files.
 *
 *   - CSV: parsed here in the browser into `{date, description, amount}`
 *     rows, with forgiving column detection.
 *   - PDF: text extracted via pdf.js (see ./pdf-parser.js) then scanned
 *     for `date ... amount` patterns line by line.
 *
 * The preview table lets the user recategorize, edit descriptions, or
 * remove any row (useful for dropping deposits and credits) before
 * confirming the save.
 */

import {
  CATEGORIES,
  formatCurrency,
  insertUploadedTransactions,
  isSupabaseConfigured,
} from "./supabase-client.js";
import { extractPdfLines, parsePdfLines } from "./pdf-parser.js";

const els = {
  form: document.getElementById("upload-form"),
  fileInput: document.getElementById("file-input"),
  parseBtn: document.getElementById("parse-btn"),
  resetBtn: document.getElementById("reset-btn"),
  parseError: document.getElementById("parse-error"),
  saveSuccess: document.getElementById("save-success"),
  configWarning: document.getElementById("config-warning"),
  previewSection: document.getElementById("preview-section"),
  previewBody: document.getElementById("preview-body"),
  previewSummary: document.getElementById("preview-summary"),
  confirmBtn: document.getElementById("confirm-btn"),
  cancelBtn: document.getElementById("cancel-btn"),
};

/** Current parsed rows awaiting confirmation. */
let pendingRows = [];

if (!isSupabaseConfigured) {
  els.configWarning.classList.remove("hidden");
}

function showError(message) {
  els.parseError.textContent = message;
  els.parseError.classList.remove("hidden");
}

function clearMessages() {
  els.parseError.classList.add("hidden");
  els.parseError.textContent = "";
  els.saveSuccess.classList.add("hidden");
  els.saveSuccess.textContent = "";
}

/* ==========================================================================
 * CSV parsing (unchanged from before)
 * ========================================================================== */

function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) =>
    r.some((cell) => cell && cell.trim() !== "")
  );
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const dataRows = nonEmpty.slice(1).map((r) => r.map((cell) => cell.trim()));
  return { headers, rows: dataRows };
}

function detectColumns(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (patterns) =>
    lower.findIndex((h) => patterns.some((p) => h.includes(p)));

  let dateIdx = find(["date", "posted", "transaction date"]);
  let descIdx = find(["description", "merchant", "details", "memo", "name"]);
  let amountIdx = find(["amount", "debit", "value", "total"]);

  if (dateIdx === -1) dateIdx = 0;
  if (descIdx === -1) descIdx = Math.min(1, headers.length - 1);
  if (amountIdx === -1) amountIdx = headers.length - 1;

  return { dateIdx, descIdx, amountIdx };
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let [, a, b, y] = slash;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

function normalizeAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
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
  return (negative ? -1 : 1) * (Math.round(n * 100) / 100);
}

function inferCategory(description) {
  const d = (description || "").toLowerCase();
  if (/(uber|lyft|metro|transit|gas|shell|chevron|parking)/.test(d))
    return "Transport";
  if (/(netflix|spotify|hulu|prime|subscription|apple|icloud|youtube)/.test(d))
    return "Subscriptions";
  if (/(bar|tavern|pub|club|concert|ticket|event)/.test(d)) return "Social";
  if (/(amazon|target|walmart|ebay|shop|store|mall|clothing)/.test(d))
    return "Shopping";
  if (
    /(starbucks|coffee|cafe|pizza|mcdonald|chipotle|restaurant|grocery|market|eat)/.test(
      d
    )
  )
    return "Food";
  return "Other";
}

function buildPreviewRowsFromCSV(headers, dataRows) {
  const { dateIdx, descIdx, amountIdx } = detectColumns(headers);
  const out = [];
  let skipped = 0;

  dataRows.forEach((cells) => {
    const transaction_date = normalizeDate(cells[dateIdx]);
    const description = (cells[descIdx] || "").trim();
    const signedAmount = normalizeAmount(cells[amountIdx]);

    if (!transaction_date || signedAmount == null || signedAmount === 0) {
      skipped++;
      return;
    }

    out.push({
      transaction_date,
      description,
      amount: Math.abs(signedAmount),
      category: inferCategory(description),
      isLikelyCredit: signedAmount < 0, // in CSVs negatives are typically credits/refunds
    });
  });

  return { rows: out, skipped };
}

/* ==========================================================================
 * Preview table
 * ========================================================================== */

/**
 * Render parsed rows into the preview table. Each row is editable
 * (category + description) and removable via an X button. Likely
 * credits are pre-excluded (marked `include: false`) so totals don't
 * double-count deposits by default.
 */
function renderPreview(rows, skipped) {
  els.previewBody.innerHTML = "";

  rows.forEach((row, idx) => {
    // Default "include" toggle off for likely credits.
    if (row.include === undefined) {
      row.include = !row.isLikelyCredit;
    }
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const includeCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = row.include;
    checkbox.setAttribute("aria-label", `Include row ${idx + 1}`);
    checkbox.addEventListener("change", () => {
      row.include = checkbox.checked;
      tr.classList.toggle("row--excluded", !row.include);
      updatePreviewSummary();
    });
    includeCell.appendChild(checkbox);
    tr.appendChild(includeCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = row.transaction_date;
    tr.appendChild(dateCell);

    const catCell = document.createElement("td");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Category for row ${idx + 1}`);
    CATEGORIES.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === row.category) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      row.category = e.target.value;
    });
    catCell.appendChild(select);
    tr.appendChild(catCell);

    const descCell = document.createElement("td");
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.value = row.description || "";
    descInput.maxLength = 140;
    descInput.setAttribute("aria-label", `Description for row ${idx + 1}`);
    descInput.addEventListener("input", () => {
      row.description = descInput.value;
    });
    descCell.appendChild(descInput);
    tr.appendChild(descCell);

    const amtCell = document.createElement("td");
    amtCell.className = "num";
    amtCell.textContent = formatCurrency(row.amount);
    if (row.isLikelyCredit) {
      const hint = document.createElement("span");
      hint.className = "pill pill--category";
      hint.textContent = "Looks like a credit";
      amtCell.appendChild(document.createElement("br"));
      amtCell.appendChild(hint);
    }
    tr.appendChild(amtCell);

    const removeCell = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "icon-btn";
    removeBtn.setAttribute("aria-label", `Remove row ${idx + 1}`);
    removeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener("click", () => {
      pendingRows.splice(Number(tr.dataset.index), 1);
      renderPreview(pendingRows, skipped);
    });
    removeCell.appendChild(removeBtn);
    tr.appendChild(removeCell);

    if (!row.include) tr.classList.add("row--excluded");

    els.previewBody.appendChild(tr);
  });

  els.previewSection.classList.remove("hidden");
  updatePreviewSummary(skipped);
}

/** Recompute summary counts/totals based on currently-included rows. */
function updatePreviewSummary(skipped = 0) {
  const included = pendingRows.filter((r) => r.include);
  const total = included.reduce((s, r) => s + r.amount, 0);
  const parts = [
    `${included.length} selected of ${pendingRows.length}`,
    `total ${formatCurrency(total)}`,
  ];
  if (skipped > 0) {
    parts.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped`);
  }
  els.previewSummary.textContent = parts.join(" · ");
}

function resetPreview() {
  pendingRows = [];
  els.previewBody.innerHTML = "";
  els.previewSummary.textContent = "";
  els.previewSection.classList.add("hidden");
}

/* ==========================================================================
 * Form wiring
 * ========================================================================== */

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessages();
  resetPreview();

  const file = els.fileInput.files?.[0];
  if (!file) {
    showError("Please choose a CSV or PDF file to upload.");
    return;
  }

  const isCSV = /\.csv$/i.test(file.name) || file.type === "text/csv";
  const isPDF = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

  if (!isCSV && !isPDF) {
    showError("Unsupported file type. Please upload a .csv or .pdf file.");
    return;
  }

  const originalLabel = els.parseBtn.textContent;
  els.parseBtn.disabled = true;
  els.parseBtn.textContent = isPDF ? "Reading PDF…" : "Parsing…";

  try {
    let preview;
    let skipped;

    if (isCSV) {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0 || rows.length === 0) {
        showError("This CSV appears to be empty or malformed.");
        return;
      }
      const result = buildPreviewRowsFromCSV(headers, rows);
      preview = result.rows;
      skipped = result.skipped;
    } else {
      const { lines, year, period } = await extractPdfLines(file);
      if (lines.length === 0) {
        showError(
          "We couldn't read any text from this PDF. It may be a scanned image — try exporting a CSV from your bank instead."
        );
        return;
      }
      const result = parsePdfLines(lines, { year, period });
      preview = result.rows;
      skipped = result.skipped;
    }

    if (!preview || preview.length === 0) {
      showError(
        isPDF
          ? "We couldn't find any transaction-like rows in this PDF. If your statement is scanned rather than digital, export a CSV instead."
          : "We couldn't find any valid transactions. Make sure your file has date, description, and amount columns."
      );
      return;
    }

    pendingRows = preview;
    renderPreview(preview, skipped);
  } catch (err) {
    console.error(err);
    showError(
      isPDF
        ? "Something went wrong reading that PDF. Please try again or export a CSV."
        : "We couldn't read that file. Please try again."
    );
  } finally {
    els.parseBtn.disabled = false;
    els.parseBtn.textContent = originalLabel;
  }
});

els.resetBtn.addEventListener("click", () => {
  els.form.reset();
  clearMessages();
  resetPreview();
});

els.cancelBtn.addEventListener("click", () => {
  clearMessages();
  resetPreview();
});

els.confirmBtn.addEventListener("click", async () => {
  clearMessages();

  const toSave = pendingRows.filter((r) => r.include);
  if (toSave.length === 0) {
    showError("Select at least one row to save.");
    return;
  }

  if (!isSupabaseConfigured) {
    showError(
      "Supabase isn't configured, so transactions can't be saved. Add credentials first."
    );
    return;
  }

  const payload = toSave.map((r) => ({
    transaction_date: r.transaction_date,
    description: (r.description || "").trim(),
    amount: Math.round(r.amount * 100) / 100,
    category: r.category,
  }));

  els.confirmBtn.disabled = true;
  els.confirmBtn.textContent = "Saving…";
  const { data, error } = await insertUploadedTransactions(payload);
  els.confirmBtn.disabled = false;
  els.confirmBtn.textContent = "Save transactions";

  if (error) {
    showError(
      "Something went wrong saving your transactions. Please try again."
    );
    return;
  }

  const count = data?.length ?? payload.length;

  // Figure out which month(s) the saved rows span so we can send the
  // user straight to the right History view. Bank statements almost
  // always cover 1–2 calendar months.
  const months = new Set(
    payload.map((p) => (p.transaction_date || "").slice(0, 7))
  );
  const sortedMonths = Array.from(months).filter(Boolean).sort();

  els.saveSuccess.innerHTML = "";
  const summary = document.createElement("p");
  summary.className = "mt-0";
  summary.textContent = `Saved ${count} transaction${
    count === 1 ? "" : "s"
  }.`;
  els.saveSuccess.appendChild(summary);

  if (sortedMonths.length > 0) {
    const range = document.createElement("p");
    range.className = "mt-0";
    const first = monthLabelFromKey(sortedMonths[0]);
    const last = monthLabelFromKey(sortedMonths[sortedMonths.length - 1]);
    range.textContent =
      sortedMonths.length === 1
        ? `These expenses are dated in ${first}.`
        : `These expenses are dated from ${first} to ${last}.`;
    els.saveSuccess.appendChild(range);

    const links = document.createElement("p");
    links.className = "mt-0";
    sortedMonths.forEach((key, i) => {
      const a = document.createElement("a");
      a.href = `/history.html?month=${key}`;
      a.textContent = `View ${monthLabelFromKey(key)}`;
      links.appendChild(a);
      if (i < sortedMonths.length - 1) {
        links.appendChild(document.createTextNode(" · "));
      }
    });
    els.saveSuccess.appendChild(links);
  }

  els.saveSuccess.classList.remove("hidden");
  els.saveSuccess.scrollIntoView({ behavior: "smooth", block: "center" });
  els.form.reset();
  resetPreview();
});

/**
 * Format a "YYYY-MM" key as "April 2026".
 */
function monthLabelFromKey(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
