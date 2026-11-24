"use strict";

window.UI = (() => {
  const pages = new Map();
  const integer = new Intl.NumberFormat(window.locale, { maximumFractionDigits: 0 });
  const svgNS = "http://www.w3.org/2000/svg";

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function format(value, digits = 0) {
    return value === null || value === undefined ? tr("Mevcut değil") :
      (digits ? new Intl.NumberFormat(window.locale, { maximumFractionDigits: digits }) : integer).format(value);
  }
  function compact(value) {
    if (value === null || value === undefined) return tr("Mevcut değil");
    return new Intl.NumberFormat(window.locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  function percent(value, digits = 1) {
    const number = format(value, digits);
    return window.locale === "en-US" ? `${number}%` : `%${number}`;
  }
  function time(value) {
    if (!value) return tr("Mevcut değil");
    const parsed = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(window.locale);
  }
  function provenance(source, kind, value) {
    if (value === null || value === undefined) return tr("MEVCUT DEĞİL");
    if (kind === "KAYIT") return tr(source === "demo" ? "DEMO · ÖRNEK KAYIT" : "GERÇEK");
    return `${source === "demo" ? "DEMO · " : ""}${tr(kind)}`;
  }
  function metricGrid(id, source, metrics) {
    const root = document.getElementById(id);
    root.replaceChildren();
    metrics.forEach(({ label, value, note = "", kind = "HESAPLANMIŞ", digits = 0, unit = "" }) => {
      const card = node("article", "metric-card");
      card.append(node("div", "metric-label", label));
      card.append(node("div", "metric-value", value === null || value === undefined ? "—" : `${format(value, digits)}${unit}`));
      const bottom = node("div", "metric-bottom");
      const badge = node("span", `provenance${value === null || value === undefined ? " missing" : ""}`, provenance(source, kind, value));
      bottom.append(node("span", "", note), badge);
      card.append(bottom);
      root.append(card);
    });
  }
  function empty(root, message = tr("Seçili filtrelerde kayıt yok.")) {
    root.replaceChildren(node("p", "empty-state", message));
  }
  function table(id, columns, rows, { onRow, size = 5, source = "live" } = {}) {
    const root = document.getElementById(id);
    root.replaceChildren();
    if (!rows.length) return empty(root);
    const page = Math.min(pages.get(id) || 0, Math.ceil(rows.length / size) - 1);
    pages.set(id, page);
    const wrap = node("div", "table-wrap");
    const tableElement = node("table", "data-table");
    const head = node("thead");
    const headings = node("tr");
    columns.forEach(col => {
      const th = node("th");
      th.append(node("span", "", col.label));
      if (col.kind) th.append(node("span", "column-kind", ` · ${provenance(source, col.kind, 1)}`));
      headings.append(th);
    });
    head.append(headings);
    const body = node("tbody");
    rows.slice(page * size, (page + 1) * size).forEach(row => {
      const tableRow = node("tr", onRow ? "clickable" : "");
      if (onRow) {
        tableRow.tabIndex = 0;
        tableRow.addEventListener("click", () => onRow(row));
        tableRow.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRow(row); } });
      }
      columns.forEach(col => {
        const value = typeof col.value === "function" ? col.value(row) : row[col.value];
        const missing = value === null || value === undefined || value === "";
        const cell = node("td");
        if ((col.sessionId || col.idLabel) && !missing) {
          const icon = node("span", "id-info-icon", "ⓘ");
          icon.title = String(value);
          icon.setAttribute("role", "img");
          icon.setAttribute("aria-label", `${col.idLabel || tr("Oturum kimliği")}: ${value}`);
          icon.tabIndex = 0;
          cell.append(icon);
        } else {
          cell.textContent = missing ? tr("Mevcut değil") : String(value);
        }
        tableRow.append(cell);
      });
      body.append(tableRow);
    });
    tableElement.append(head, body);
    wrap.append(tableElement);
    root.append(wrap);
    if (rows.length > size) {
      const pager = node("div", "pager");
      const previous = node("button", "", tr("← Önceki"));
      const next = node("button", "", tr("Sonraki →"));
      previous.disabled = page === 0;
      next.disabled = (page + 1) * size >= rows.length;
      previous.addEventListener("click", () => { pages.set(id, page - 1); table(id, columns, rows, { onRow, size, source }); });
      next.addEventListener("click", () => { pages.set(id, page + 1); table(id, columns, rows, { onRow, size, source }); });
      pager.append(previous, node("span", "", `${page + 1} / ${Math.ceil(rows.length / size)} · ${format(rows.length)} ${tr("kayıt")}`), next);
      root.append(pager);
    }
  }
  function bars(id, items) {
    const root = document.getElementById(id);
    root.replaceChildren();
    if (!items.length) return empty(root);
    const max = Math.max(...items.map(item => item.value), 1);
    items.forEach(item => {
      const row = node("div", "bar-row");
      const title = node("div", "bar-title");
      title.append(node("span", "", item.label || tr("Mevcut değil")), node("span", "", format(item.value)));
      const track = node("div", "bar-track");
      const fill = node("div", "bar-fill");
      fill.style.width = `${100 * item.value / max}%`;
      track.append(fill); row.append(title, track); root.append(row);
    });
  }
  function chart(id, rows, series, { scaleFloor = 1, axisFormat = compact, points = false, timeScale = false, columns = false } = {}) {
    const root = document.getElementById(id);
    const previousScroll = columns ? root.querySelector(".chart-scroll") : null;
    const scrollLeft = previousScroll ? previousScroll.scrollLeft : 0;
    const focusedDay = columns && root.contains(document.activeElement) ? document.activeElement.dataset.day : null;
    root.replaceChildren();
    if (!rows.length || !rows.some(row => series.some(item => row[item.key] !== null && row[item.key] !== undefined))) return empty(root, tr("Grafik için ölçüm yok."));
    const svg = document.createElementNS(svgNS, "svg");
    const width = columns ? Math.max(640, 58 + rows.length * 76) : 640;
    svg.setAttribute("viewBox", `0 0 ${width} 180`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", columns ? "group" : "img");
    svg.setAttribute("aria-label", series.map(item => item.label).join(tr(" ve ")) + tr(" grafiği"));
    const max = Math.max(scaleFloor, ...rows.flatMap(row => series.map(item => row[item.key] ?? 0))) || 1;
    const firstDay = timeScale ? Date.parse(`${rows[0].day}T00:00:00Z`) : 0;
    const lastDay = timeScale ? Date.parse(`${rows[rows.length - 1].day}T00:00:00Z`) : 0;
    const xPosition = (row, i) => rows.length === 1 ? 339 :
      48 + 582 * (timeScale && lastDay > firstDay
        ? (Date.parse(`${row.day}T00:00:00Z`) - firstDay) / (lastDay - firstDay)
        : i / (rows.length - 1));
    for (let i = 0; i < 4; i++) {
      const y = 10 + i * 45;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "48"); line.setAttribute("x2", width - 10); line.setAttribute("y1", y); line.setAttribute("y2", y);
      line.setAttribute("class", "chart-grid"); svg.append(line);
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", "0"); label.setAttribute("y", y + 4); label.setAttribute("class", "chart-label");
      label.textContent = axisFormat(max * (1 - i / 3)); svg.append(label);
    }
    const positionTooltip = (group, tooltip) => {
      const bounds = group.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2 - root.getBoundingClientRect().left;
      tooltip.style.left = `${Math.max(0, Math.min(root.clientWidth - tooltip.offsetWidth, x - tooltip.offsetWidth / 2))}px`;
    };
    if (columns) {
      const groupWidth = (width - 58) / rows.length;
      const barWidth = Math.min(20, groupWidth * 0.7 / series.length);
      const tooltip = node("div", "chart-tooltip");
      tooltip.setAttribute("role", "tooltip");
      tooltip.hidden = true;
      rows.forEach((row, i) => {
        const center = 48 + groupWidth * (i + 0.5);
        const group = document.createElementNS(svgNS, "g");
        group.setAttribute("class", "chart-column-group");
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "img");
        group.dataset.day = row.day;
        group.setAttribute("aria-label", `${row.day} · ${series.map(item => `${item.label}: ${format(row[item.key])}`).join(" · ")}`);
        series.forEach((item, index) => {
          const value = row[item.key];
          if (value === null || value === undefined) return;
          const bar = document.createElementNS(svgNS, "rect");
          const height = value / max * 135;
          bar.setAttribute("x", center + (index - series.length / 2) * barWidth);
          bar.setAttribute("y", 145 - height);
          bar.setAttribute("width", barWidth);
          bar.setAttribute("height", height);
          bar.setAttribute("fill", index ? "var(--blue)" : "var(--cyan)");
          group.append(bar);
        });
        const target = document.createElementNS(svgNS, "rect");
        target.setAttribute("x", center - groupWidth / 2);
        target.setAttribute("y", "10");
        target.setAttribute("width", groupWidth);
        target.setAttribute("height", "135");
        target.setAttribute("class", "chart-column-target");
        group.append(target);
        const showTooltip = () => {
          tooltip.replaceChildren(node("strong", "chart-tooltip-date", row.day));
          series.forEach((item, index) => {
            const line = node("div", "chart-tooltip-row");
            const label = node("span", "chart-tooltip-label");
            const dot = node("span", "legend-dot");
            dot.style.background = index ? "var(--blue)" : "var(--cyan)";
            label.append(dot, document.createTextNode(item.label));
            line.append(label, node("strong", "", format(row[item.key])));
            tooltip.append(line);
          });
          tooltip.hidden = false;
          positionTooltip(group, tooltip);
        };
        group.addEventListener("mouseenter", showTooltip);
        group.addEventListener("focus", showTooltip);
        group.addEventListener("mouseleave", () => { if (document.activeElement !== group) tooltip.hidden = true; });
        group.addEventListener("blur", () => { if (!group.matches(":hover")) tooltip.hidden = true; });
        group.addEventListener("keydown", event => { if (event.key === "Escape") tooltip.hidden = true; });
        svg.append(group);
        const label = document.createElementNS(svgNS, "text");
        label.setAttribute("x", center); label.setAttribute("y", "173"); label.setAttribute("class", "chart-label");
        label.setAttribute("text-anchor", "middle"); label.textContent = row.day; svg.append(label);
      });
      root.append(tooltip);
    } else series.forEach((item, index) => {
      const path = document.createElementNS(svgNS, "path");
      let move = true;
      let d = "";
      rows.forEach((row, i) => {
        const value = row[item.key];
        if (value === null || value === undefined) { move = true; return; }
        const x = xPosition(row, i);
        const y = 145 - value / max * 135;
        d += `${move ? "M" : "L"}${x},${y} `;
        move = false;
        if (rows.length === 1) d += `l 0.1,0`;
      });
      path.setAttribute("d", d); path.setAttribute("class", index ? "chart-line-b" : "chart-line-a"); svg.append(path);
      if (points) rows.forEach((row, i) => {
        const value = row[item.key];
        if (value === null || value === undefined) return;
        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", xPosition(row, i));
        circle.setAttribute("cy", 145 - value / max * 135);
        circle.setAttribute("r", "3");
        circle.setAttribute("fill", index ? "var(--blue)" : "var(--cyan)");
        svg.append(circle);
      });
    });
    if (columns) {
      svg.style.minWidth = `${width}px`;
      const scroll = node("div", "chart-scroll");
      scroll.append(svg);
      root.append(scroll);
      scroll.scrollLeft = scrollLeft;
      scroll.addEventListener("scroll", () => {
        const tooltip = root.querySelector(".chart-tooltip");
        const active = svg.contains(document.activeElement) ? document.activeElement : null;
        if (active && !tooltip.hidden) positionTooltip(active, tooltip);
        else tooltip.hidden = true;
      });
      if (focusedDay) {
        const focusedGroup = [...svg.querySelectorAll(".chart-column-group")].find(group => group.dataset.day === focusedDay);
        if (focusedGroup) focusedGroup.focus({ preventScroll: true });
      }
    } else {
      [0, rows.length - 1].forEach((index, i) => {
        const label = document.createElementNS(svgNS, "text");
        label.setAttribute("x", i ? "630" : "48"); label.setAttribute("y", "173"); label.setAttribute("class", "chart-label");
        label.setAttribute("text-anchor", i ? "end" : "start"); label.textContent = rows[index].day; svg.append(label);
      });
      root.append(svg);
    }
    const legend = node("div", "chart-legend");
    series.forEach((item, index) => {
      const text = node("span");
      const dot = node("span", "legend-dot"); dot.style.background = index ? "var(--blue)" : "var(--cyan)";
      text.append(dot, document.createTextNode(item.label)); legend.append(text);
    });
    root.append(legend);
  }
  return { node, format, compact, percent, time, provenance, metricGrid, empty, table, bars, chart };
})();
