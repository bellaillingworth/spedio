/**
 * charts.js
 * ---------
 * Reusable, responsive D3 chart components used across the Dashboard
 * and History screens. Each function mounts into a container element
 * (the `.chart-container` wrapper), attaches a ResizeObserver for
 * responsiveness, and returns a teardown function for cleanup.
 *
 * All charts:
 *   - Use D3 v7 (loaded via CDN in the HTML pages).
 *   - Set role="img" and an accessible label for screen readers.
 *   - Include an optional tooltip element shared via CSS.
 */

import { CATEGORY_COLORS, formatCurrency } from "./supabase-client.js";

/**
 * Resolve the CSS variable name inside `var(--foo)` to its runtime value,
 * so that chart colors stay in sync with the design system.
 */
function resolveColor(cssVarString) {
  if (!cssVarString || !cssVarString.startsWith("var(")) return cssVarString;
  const name = cssVarString.slice(4, -1).trim();
  const val = getComputedStyle(document.documentElement).getPropertyValue(name);
  return val.trim() || "#0b6e8c";
}

/**
 * Ensure the container has a tooltip element we can reuse.
 */
function ensureTooltip(container) {
  let tip = container.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.setAttribute("role", "tooltip");
    container.appendChild(tip);
  }
  return tip;
}

/**
 * Clear any previous chart contents (SVG + legend) but keep the tooltip.
 */
function clearContainer(container) {
  Array.from(container.children).forEach((child) => {
    if (!child.classList.contains("chart-tooltip")) child.remove();
  });
}

/**
 * Render an "empty state" message into the chart container.
 */
function renderEmpty(container, message) {
  clearContainer(container);
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;
  container.appendChild(div);
}

/**
 * Attach a ResizeObserver that calls `draw` when the container resizes.
 * Returns a cleanup function.
 */
function attachResponsive(container, draw) {
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  return () => ro.disconnect();
}

/* ==========================================================================
 * Hero daily bar chart — cream bars on teal hero card
 * ========================================================================== */

/**
 * Render the dashboard's hero chart: vertical bars showing total spend
 * per day, designed to sit on top of the teal hero card. Uses cream
 * bars with an optional highlighted (striped) bar for today.
 *
 * @param {HTMLElement} container
 * @param {Array<{date:Date, total:number}>} data
 * @param {{ariaLabel?:string, highlightDate?:Date}} [opts]
 */
export function renderHeroDailyBars(container, data, opts = {}) {
  if (!data || data.length === 0) {
    renderEmpty(container, "No spending to display yet.");
    return () => {};
  }

  const tooltip = ensureTooltip(container);
  const todayKey = opts.highlightDate
    ? opts.highlightDate.toDateString()
    : new Date().toDateString();

  const draw = () => {
    clearContainer(container);

    const width = container.clientWidth || 320;
    const height = Math.max(220, Math.min(280, width * 0.55));
    const margin = { top: 16, right: 8, bottom: 28, left: 36 };

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", opts.ariaLabel || "Daily spending bar chart");

    // Pattern for the "today" diagonal-stripe highlight
    const defs = svg.append("defs");
    const pattern = defs
      .append("pattern")
      .attr("id", "hero-stripe")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternTransform", "rotate(45)");
    pattern
      .append("rect")
      .attr("width", 6)
      .attr("height", 6)
      .attr("fill", "var(--color-hero-bar)");
    pattern
      .append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 6)
      .attr("stroke", "rgba(15, 107, 91, 0.55)")
      .attr("stroke-width", 3);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.date))
      .range([margin.left, width - margin.right])
      .padding(0.35);

    const yMax = d3.max(data, (d) => d.total) || 1;
    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Soft horizontal grid lines
    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .attr("color", "rgba(255,255,255,0.25)")
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-(width - margin.left - margin.right))
          .tickFormat("")
      )
      .call((g) => g.select(".domain").remove())
      .selectAll("line")
      .attr("stroke-opacity", 0.5);

    // Y axis (value labels)
    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .attr("color", "rgba(255,255,255,0.82)")
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((v) => `$${d3.format("~s")(v)}`)
      )
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll("line").remove())
      .selectAll("text")
      .style("font-size", "0.75rem");

    // X axis (day labels — abbreviated)
    const tickInterval = Math.max(1, Math.ceil(data.length / 10));
    svg
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .attr("color", "rgba(255,255,255,0.82)")
      .call(
        d3
          .axisBottom(x)
          .tickValues(data.filter((_, i) => i % tickInterval === 0).map((d) => d.date))
          .tickFormat(d3.timeFormat("%-d"))
          .tickSize(0)
          .tickPadding(8)
      )
      .call((g) => g.select(".domain").remove())
      .selectAll("text")
      .style("font-size", "0.75rem");

    // Bars
    svg
      .append("g")
      .selectAll("rect")
      .data(data)
      .join("rect")
      .attr("x", (d) => x(d.date))
      .attr("y", (d) => y(d.total))
      .attr("width", x.bandwidth())
      .attr("height", (d) => Math.max(0, y(0) - y(d.total)))
      .attr("rx", 4)
      .attr("fill", (d) =>
        d.date.toDateString() === todayKey
          ? "url(#hero-stripe)"
          : "var(--color-hero-bar)"
      )
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr(
        "aria-label",
        (d) =>
          `${d.date.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}: ${formatCurrency(d.total)}`
      )
      .on("mousemove", (event, d) => {
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        tooltip.innerHTML = `<strong>${d.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("mouseleave", () => tooltip.classList.remove("is-visible"))
      .on("focus", function (event, d) {
        const bar = this.getBoundingClientRect();
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${bar.left - rect.left}px`;
        tooltip.style.top = `${bar.top - rect.top - 40}px`;
        tooltip.innerHTML = `<strong>${d.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("blur", () => tooltip.classList.remove("is-visible"));
  };

  return attachResponsive(container, draw);
}

/* ==========================================================================
 * Bar chart — spending by category
 * ========================================================================== */

/**
 * Render a horizontal bar chart of total spend by category.
 * @param {HTMLElement} container - .chart-container element
 * @param {Array<{category:string, total:number}>} data
 * @param {{ariaLabel?:string}} [opts]
 */
export function renderCategoryBarChart(container, data, opts = {}) {
  if (!data || data.length === 0) {
    renderEmpty(container, "No spending to display for this month yet.");
    return () => {};
  }

  const tooltip = ensureTooltip(container);

  const draw = () => {
    clearContainer(container);

    const width = container.clientWidth || 320;
    const rowHeight = 36;
    const margin = { top: 16, right: 24, bottom: 28, left: 120 };
    const height = margin.top + margin.bottom + data.length * rowHeight;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", opts.ariaLabel || "Spending by category bar chart");

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.total) || 1])
      .nice()
      .range([margin.left, width - margin.right]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.category))
      .range([margin.top, height - margin.bottom])
      .padding(0.25);

    // X axis (currency)
    svg
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .attr("color", "var(--color-text-muted)")
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.max(2, Math.floor(width / 110)))
          .tickFormat((v) => `$${d3.format("~s")(v)}`)
      )
      .call((g) => g.select(".domain").remove());

    // Y axis (categories)
    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .attr("color", "var(--color-text)")
      .call(d3.axisLeft(y).tickSize(0).tickPadding(8))
      .call((g) => g.select(".domain").remove())
      .selectAll("text")
      .style("font-size", "0.875rem");

    // Bars
    svg
      .append("g")
      .selectAll("rect")
      .data(data)
      .join("rect")
      .attr("x", x(0))
      .attr("y", (d) => y(d.category))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d.total) - x(0))
      .attr("rx", 4)
      .attr("fill", (d) => resolveColor(CATEGORY_COLORS[d.category] || "var(--color-primary)"))
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", (d) => `${d.category}: ${formatCurrency(d.total)}`)
      .on("mousemove", (event, d) => {
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        tooltip.innerHTML = `<strong>${d.category}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("mouseleave", () => tooltip.classList.remove("is-visible"))
      .on("focus", function (event, d) {
        const bar = this.getBoundingClientRect();
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${bar.right - rect.left + 8}px`;
        tooltip.style.top = `${bar.top - rect.top}px`;
        tooltip.innerHTML = `<strong>${d.category}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("blur", () => tooltip.classList.remove("is-visible"));

    // Value labels at the end of each bar
    svg
      .append("g")
      .selectAll("text")
      .data(data)
      .join("text")
      .attr("x", (d) => x(d.total) + 6)
      .attr("y", (d) => y(d.category) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("fill", "var(--color-text)")
      .style("font-size", "0.8125rem")
      .style("font-variant-numeric", "tabular-nums")
      .text((d) => formatCurrency(d.total));
  };

  return attachResponsive(container, draw);
}

/* ==========================================================================
 * Line chart — daily spending trend
 * ========================================================================== */

/**
 * Render a line chart of daily spending totals across a month.
 * @param {HTMLElement} container
 * @param {Array<{date:Date, total:number}>} data - already filled for every day in the month
 * @param {{ariaLabel?:string}} [opts]
 */
export function renderDailyLineChart(container, data, opts = {}) {
  if (!data || data.length === 0) {
    renderEmpty(container, "No daily spending data yet.");
    return () => {};
  }

  const tooltip = ensureTooltip(container);

  const draw = () => {
    clearContainer(container);

    const width = container.clientWidth || 320;
    const height = 300;
    const margin = { top: 16, right: 24, bottom: 36, left: 56 };

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", opts.ariaLabel || "Daily spending line chart");

    const x = d3
      .scaleTime()
      .domain(d3.extent(data, (d) => d.date))
      .range([margin.left, width - margin.right]);

    const yMax = d3.max(data, (d) => d.total) || 1;
    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Grid lines
    svg
      .append("g")
      .attr("color", "var(--color-border)")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-(width - margin.left - margin.right))
          .tickFormat("")
      )
      .call((g) => g.select(".domain").remove())
      .selectAll("line")
      .attr("stroke-opacity", 0.5);

    // Axes
    svg
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .attr("color", "var(--color-text-muted)")
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.max(3, Math.floor(width / 90)))
          .tickFormat(d3.timeFormat("%b %-d"))
      );

    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .attr("color", "var(--color-text-muted)")
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((v) => `$${d3.format("~s")(v)}`)
      )
      .call((g) => g.select(".domain").remove());

    // Area
    const area = d3
      .area()
      .x((d) => x(d.date))
      .y0(y(0))
      .y1((d) => y(d.total))
      .curve(d3.curveMonotoneX);

    svg
      .append("path")
      .datum(data)
      .attr("fill", resolveColor("var(--color-primary)"))
      .attr("fill-opacity", 0.12)
      .attr("d", area);

    // Line
    const line = d3
      .line()
      .x((d) => x(d.date))
      .y((d) => y(d.total))
      .curve(d3.curveMonotoneX);

    svg
      .append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", resolveColor("var(--color-primary)"))
      .attr("stroke-width", 2.25)
      .attr("stroke-linejoin", "round")
      .attr("d", line);

    // Points
    svg
      .append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => x(d.date))
      .attr("cy", (d) => y(d.total))
      .attr("r", 3.5)
      .attr("fill", resolveColor("var(--color-primary)"))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.25)
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr(
        "aria-label",
        (d) =>
          `${d.date.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}: ${formatCurrency(d.total)}`
      )
      .on("mousemove", (event, d) => {
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        tooltip.innerHTML = `<strong>${d.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("mouseleave", () => tooltip.classList.remove("is-visible"))
      .on("focus", function (event, d) {
        const pt = this.getBoundingClientRect();
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${pt.right - rect.left + 8}px`;
        tooltip.style.top = `${pt.top - rect.top - 8}px`;
        tooltip.innerHTML = `<strong>${d.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}</strong><br>${formatCurrency(d.total)}`;
      })
      .on("blur", () => tooltip.classList.remove("is-visible"));
  };

  return attachResponsive(container, draw);
}

/* ==========================================================================
 * Donut chart — spending breakdown by category
 * ========================================================================== */

/**
 * Render a donut chart with category breakdown + a matching legend.
 * @param {HTMLElement} container
 * @param {HTMLElement|null} legendContainer
 * @param {Array<{category:string, total:number}>} data
 * @param {{ariaLabel?:string}} [opts]
 */
export function renderCategoryDonutChart(container, legendContainer, data, opts = {}) {
  if (!data || data.length === 0) {
    renderEmpty(container, "No category breakdown available.");
    if (legendContainer) legendContainer.innerHTML = "";
    return () => {};
  }

  const tooltip = ensureTooltip(container);
  const totalSum = d3.sum(data, (d) => d.total);

  const draw = () => {
    clearContainer(container);

    const width = container.clientWidth || 320;
    const height = Math.max(260, Math.min(360, width));
    const radius = Math.min(width, height) / 2;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", opts.ariaLabel || "Spending breakdown donut chart");

    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    const pie = d3
      .pie()
      .value((d) => d.total)
      .sort(null);

    const arc = d3
      .arc()
      .innerRadius(radius * 0.6)
      .outerRadius(radius * 0.95);

    g.selectAll("path")
      .data(pie(data))
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) =>
        resolveColor(CATEGORY_COLORS[d.data.category] || "var(--color-primary)")
      )
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr(
        "aria-label",
        (d) =>
          `${d.data.category}: ${formatCurrency(d.data.total)} (${Math.round(
            (d.data.total / totalSum) * 100
          )}%)`
      )
      .on("mousemove", (event, d) => {
        const rect = container.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${event.clientX - rect.left + 12}px`;
        tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        const pct = ((d.data.total / totalSum) * 100).toFixed(1);
        tooltip.innerHTML = `<strong>${d.data.category}</strong><br>${formatCurrency(
          d.data.total
        )} (${pct}%)`;
      })
      .on("mouseleave", () => tooltip.classList.remove("is-visible"))
      .on("focus", function (event, d) {
        const rect = container.getBoundingClientRect();
        const box = this.getBoundingClientRect();
        tooltip.classList.add("is-visible");
        tooltip.style.left = `${box.right - rect.left + 8}px`;
        tooltip.style.top = `${box.top - rect.top}px`;
        const pct = ((d.data.total / totalSum) * 100).toFixed(1);
        tooltip.innerHTML = `<strong>${d.data.category}</strong><br>${formatCurrency(
          d.data.total
        )} (${pct}%)`;
      })
      .on("blur", () => tooltip.classList.remove("is-visible"));

    // Center label
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.1em")
      .attr("fill", "var(--color-text-muted)")
      .style("font-size", "0.8125rem")
      .text("Total");

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.2em")
      .attr("fill", "var(--color-text)")
      .style("font-size", "1.125rem")
      .style("font-weight", "700")
      .text(formatCurrency(totalSum));
  };

  // Build legend once (doesn't need to redraw on resize)
  if (legendContainer) {
    legendContainer.innerHTML = "";
    data.forEach((d) => {
      const item = document.createElement("span");
      item.className = "chart-legend__item";
      const swatch = document.createElement("span");
      swatch.className = "chart-legend__swatch";
      swatch.style.backgroundColor = resolveColor(
        CATEGORY_COLORS[d.category] || "var(--color-primary)"
      );
      swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      const pct = totalSum > 0 ? ((d.total / totalSum) * 100).toFixed(0) : 0;
      label.textContent = `${d.category} — ${formatCurrency(d.total)} (${pct}%)`;
      item.append(swatch, label);
      legendContainer.append(item);
    });
  }

  return attachResponsive(container, draw);
}

/* ==========================================================================
 * Data helpers shared by charts
 * ========================================================================== */

/**
 * Group transactions by category and return { category, total } sorted desc.
 */
export function summarizeByCategory(transactions) {
  const totals = d3.rollup(
    transactions,
    (v) => d3.sum(v, (t) => Number(t.amount) || 0),
    (t) => t.category || "Other"
  );
  return Array.from(totals, ([category, total]) => ({ category, total })).sort(
    (a, b) => b.total - a.total
  );
}

/**
 * Build a daily totals series covering every day in [startDate, endDate]
 * (endDate is exclusive). Missing days are filled with 0.
 *
 * @param {Array<{transaction_date:string, amount:number|string}>} transactions
 * @param {Date} startDate
 * @param {Date} endDate exclusive
 * @returns {Array<{date:Date, total:number}>}
 */
export function buildDailySeries(transactions, startDate, endDate) {
  const byDay = new Map();
  transactions.forEach((t) => {
    const key = t.transaction_date;
    byDay.set(key, (byDay.get(key) || 0) + (Number(t.amount) || 0));
  });

  const result = [];
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    result.push({ date: new Date(cursor), total: byDay.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
