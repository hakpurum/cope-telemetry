"use strict";

const expandedCharts = new Set();

function trendGraph(id, rows, { key, countKey, totalKey, label, emptyMessage, percent = false }) {
  const root = document.getElementById(id);
  const previousScroll = root.querySelector(".trend-graph-scroll")?.scrollLeft || 0;
  const focusedDay = root.contains(document.activeElement) ? document.activeElement.dataset.day : null;
  root.replaceChildren();
  if (!rows.some(row => row[key] != null)) return UI.empty(root, emptyMessage);

  const ns = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attributes = {}) => {
    const element = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  };
  const width = Math.max(420, root.clientWidth, Math.min(4000, 100 + rows.length * 52));
  const left = 70, right = width - 55, top = 18, bottom = 205;
  const first = Date.parse(`${rows[0].day}T00:00:00Z`);
  const last = Date.parse(`${rows[rows.length - 1].day}T00:00:00Z`);
  const max = percent ? 100 : Math.max(...rows.map(row => row[key] ?? 0)) || 1;
  const x = row => first === last ? (left + right) / 2 :
    left + (Date.parse(`${row.day}T00:00:00Z`) - first) / (last - first) * (right - left);
  const y = value => bottom - value / max * (bottom - top);
  const digits = Math.min(9, Math.max(3, -Math.floor(Math.log10(max / 4))));
  const axis = value => percent ? UI.percent(value, 0) :
    value > 0 && value < 0.000001 ? (window.locale === "tr-TR" ? value.toExponential(1).replace(".", ",") : value.toExponential(1)) :
      value >= 10000 ? UI.compact(value) : UI.format(value, digits);
  const svg = svgNode("svg", { viewBox: `0 0 ${width} 245`, width, height: 245,
    role: "group", "aria-label": label });
  const defs = svgNode("defs");
  const gradientId = `${id}-gradient`;
  const gradient = svgNode("linearGradient", { id: gradientId, x1: "0", x2: "0", y1: "0", y2: "1" });
  gradient.append(svgNode("stop", { offset: "0%", "stop-color": "#4f6bed", "stop-opacity": ".24" }),
    svgNode("stop", { offset: "100%", "stop-color": "#4f6bed", "stop-opacity": ".02" }));
  defs.append(gradient); svg.append(defs);
  for (let i = 0; i <= 4; i++) {
    const value = max * (1 - i / 4);
    const pos = top + (bottom - top) * i / 4;
    svg.append(svgNode("line", { x1: left, x2: right, y1: pos, y2: pos, class: "trend-graph-grid" }));
    const axisLabel = svgNode("text", { x: left - 12, y: pos + 4, "text-anchor": "end", class: "trend-graph-axis" });
    axisLabel.textContent = axis(value); svg.append(axisLabel);
  }

  let segment = [];
  const drawSegment = () => {
    if (!segment.length) return;
    const path = segment.map((row, index) => `${index ? "L" : "M"}${x(row)},${y(row[key])}`).join(" ");
    if (segment.length > 1) {
      svg.append(svgNode("path", { d: `${path} L${x(segment[segment.length - 1])},${bottom} L${x(segment[0])},${bottom} Z`,
        fill: `url(#${gradientId})` }));
      svg.append(svgNode("path", { d: path, class: "trend-graph-line" }));
    }
    segment = [];
  };
  rows.forEach(row => {
    const previous = segment[segment.length - 1];
    if (row[key] == null || (previous && Date.parse(`${row.day}T00:00:00Z`) -
        Date.parse(`${previous.day}T00:00:00Z`) > 86400000)) drawSegment();
    if (row[key] != null) segment.push(row);
  });
  drawSegment();

  const tooltip = UI.node("div", "chart-tooltip trend-graph-tooltip");
  tooltip.id = `${id}-tooltip`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  const scroll = UI.node("div", "trend-graph-scroll");
  const yearInLabels = rows[0].day.slice(0, 4) !== rows[rows.length - 1].day.slice(0, 4);
  const dateLabel = new Intl.DateTimeFormat(window.locale, { day: "numeric", month: "short", timeZone: "UTC",
    ...(yearInLabels ? { year: "numeric" } : {}) });
  let lastLabelX = -Infinity;
  let activePoint, activeShow;
  const points = [];
  rows.forEach((row, index) => {
    const px = x(row);
    if (px - lastLabelX >= (yearInLabels ? 105 : 70)) {
      const dateText = svgNode("text", { x: px, y: 233, "text-anchor": "middle", class: "trend-graph-axis" });
      dateText.textContent = dateLabel.format(new Date(`${row.day}T00:00:00Z`));
      svg.append(dateText); lastLabelX = px;
    }
    const measured = row[countKey], total = row[totalKey];
    const coverage = `${UI.format(measured)} / ${UI.format(total)}${tr(" ölçüm")}${measured && measured < total ? tr(" · kısmi") : ""}`;
    const value = row[key] == null ? tr("Mevcut değil") : percent ? UI.percent(row[key]) : tr("{count} kredi", { count: UI.format(row[key], 9) });
    const group = svgNode("g", { class: "trend-graph-point", tabindex: "0", role: "img",
      "aria-label": `${row.day} · ${value} · ${coverage}`, "aria-describedby": tooltip.id });
    group.dataset.day = row.day;
    if (row[key] != null) group.append(svgNode("circle", { cx: px, cy: y(row[key]), r: 4, class: "trend-graph-dot" }));
    group.append(svgNode("rect", { x: px - 12, y: top, width: 24, height: bottom - top, class: "trend-graph-target" }));
    const show = () => {
      activePoint = group;
      activeShow = show;
      tooltip.replaceChildren(UI.node("strong", "chart-tooltip-date", row.day),
        UI.node("div", "trend-graph-tooltip-value", value), UI.node("div", "efficiency-note", coverage));
      tooltip.hidden = false;
      const offset = px - scroll.scrollLeft;
      tooltip.style.left = `${Math.max(0, Math.min(root.clientWidth - tooltip.offsetWidth, offset - tooltip.offsetWidth / 2))}px`;
    };
    group.addEventListener("mouseenter", show);
    group.addEventListener("click", show);
    group.addEventListener("focus", show);
    group.addEventListener("mouseleave", () => { if (document.activeElement !== group) tooltip.hidden = true; });
    group.addEventListener("blur", () => { if (!group.matches(":hover")) tooltip.hidden = true; });
    group.addEventListener("keydown", event => {
      if (event.key === "Escape") tooltip.hidden = true;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const next = index + (event.key === "ArrowRight" ? 1 : -1);
        if (points[next]) { event.preventDefault(); points[next].focus(); }
      }
    });
    points.push(group); svg.append(group);
  });
  scroll.append(svg);
  scroll.addEventListener("scroll", () => {
    if (activePoint === document.activeElement) activeShow();
    else tooltip.hidden = true;
  });
  root.append(tooltip, scroll);
  scroll.scrollLeft = previousScroll;
  if (focusedDay) points.find(point => point.dataset.day === focusedDay)?.focus({ preventScroll: true });
}

window.Page = {
  render(data) {
    const e = data.efficiency;
    const credit = value => UI.format(value, 9);
    const count = (measured, total) => `${UI.format(measured)} / ${UI.format(total)}${tr(" ölçüm")}${measured && measured < total ? tr(" · kısmi") : ""}`;
    const note = row => `${count(row.credit_count, row.events)} · ${tr("Ölçülen olay başına {credits} kredi", { credits: credit(row.credits_per_event) })}`;
    const durationNote = row => count(row.duration_count, row.events);
    const showMore = (root, id, groups) => {
      if (groups.length <= 8) return;
      const button = UI.node("button", "efficiency-more");
      button.type = "button";
      button.id = `${id}-more`;
      const update = () => {
        const expanded = expandedCharts.has(id);
        groups.forEach((group, index) => group.forEach(element => { element.hidden = index >= 8 && !expanded; }));
        button.textContent = expanded ? tr("Daha az göster") : tr("Tümünü göster ({count})", { count: UI.format(groups.length) });
        button.setAttribute("aria-expanded", String(expanded));
      };
      button.addEventListener("click", () => {
        if (expandedCharts.has(id)) expandedCharts.delete(id); else expandedCharts.add(id);
        update();
      });
      update(); root.append(button);
    };
    const bars = (id, rows, key, format, describe) => {
      const root = document.getElementById(id);
      const focused = document.activeElement?.id === `${id}-more`;
      root.replaceChildren();
      if (!rows.length) return UI.empty(root);
      const list = UI.node("div", "efficiency-bars");
      const groups = [];
      const values = rows.map(row => row[key]).filter(value => value !== null && value !== undefined);
      const max = Math.max(0, ...values);
      rows.forEach(row => {
        const value = row[key];
        const item = UI.node("div");
        const label = UI.node("div", "efficiency-bar-label");
        label.append(UI.node("span", "", row.label), UI.node("span", "", value == null ? tr("Mevcut değil") : format(value)));
        item.append(label, UI.node("p", "efficiency-bar-note", describe(row)));
        if (value != null) {
          const track = UI.node("div", "efficiency-bar-track");
          const fill = UI.node("div", "efficiency-bar-fill");
          fill.style.width = `${max ? Math.max(0, 100 * value / max) : 0}%`;
          track.append(fill); item.append(track);
        }
        list.append(item);
        groups.push([item]);
      });
      root.append(list);
      showMore(root, id, groups);
      if (focused) document.getElementById(`${id}-more`)?.focus({ preventScroll: true });
    };
    const creditBars = (id, rows, describe = note) => bars(id, rows, "credits", value => tr("{count} kredi", { count: credit(value) }), describe);
    const durationBars = (id, rows, key, order = 0) => {
      const sorted = order ? [...rows].sort((a, b) => a[key] == null ? (b[key] == null ? 0 : 1) : b[key] == null ? -1 : order * (a[key] - b[key])) : rows;
      bars(id, sorted, key, value => `${UI.format(value, 1)} ms`, durationNote);
    };

    creditBars("efficiency-models", e.models);
    creditBars("efficiency-agents", e.agents, row => `${note(row)} · ${tr("Kredi ölçümlü {runs} çalışma başına {credits} kredi", { runs: UI.format(row.measured_runs), credits: credit(row.credits_per_run) })}`);
    creditBars("efficiency-projects", e.projects);
    durationBars("efficiency-project-duration", e.projects, "duration_total", -1);
    durationBars("efficiency-model-duration", e.models, "duration_avg", 1);
    durationBars("efficiency-agent-duration", e.agents, "duration_avg", 1);

    const periodRow = (label, totals) => ({ label, credits: totals.aiu, credit_count: totals.aiu_count,
      events: totals.events, duration_avg: totals.duration_avg, duration_count: totals.duration_count });
    const current = periodRow(tr("Seçili dönem"), data.totals);
    const previous = e.previous;
    const periodRows = [current];
    if (previous) periodRows.push(periodRow(`${previous.start} – ${previous.end}`, previous.totals));
    bars("efficiency-period", periodRows, "credits", value => tr("{count} kredi", { count: credit(value) }), row => count(row.credit_count, row.events));
    bars("efficiency-period-events", periodRows, "events", value => tr("{count} olay", { count: UI.format(value) }), () => tr("Kullanım olayları"));
    durationBars("efficiency-period-duration", periodRows, "duration_avg");
    if (!previous) document.getElementById("efficiency-period").append(UI.node("p", "efficiency-note", tr("Önceki dönem desteklenen tarih aralığının dışında.")));

    const heatRoot = document.getElementById("efficiency-pairs");
    const heatFocused = document.activeElement?.id === "efficiency-pairs-more";
    heatRoot.replaceChildren();
    if (!e.pairs.length) UI.empty(heatRoot, tr("Agent ve model eşleşmesi bulunamadı."));
    else {
      const agents = e.agents.map(row => row.label).filter(label => e.pairs.some(row => row.label === label));
      const models = e.models.map(row => row.label).filter(label => e.pairs.some(row => row.model === label));
      const lookup = new Map(e.pairs.map(row => [JSON.stringify([row.label, row.model]), row]));
      const max = Math.max(0, ...e.pairs.map(row => row.credits ?? 0));
      const scroll = UI.node("div", "efficiency-heat-scroll");
      const grid = UI.node("div", "efficiency-heat");
      const groups = [];
      grid.style.gridTemplateColumns = `minmax(150px, 210px) repeat(${models.length}, minmax(125px, 1fr))`;
      grid.append(UI.node("div", "efficiency-heat-label", "Agent / Model"));
      models.forEach(model => grid.append(UI.node("div", "efficiency-heat-label", model)));
      agents.forEach(agent => {
        const label = UI.node("div", "efficiency-heat-label", agent);
        const group = [label];
        grid.append(label);
        models.forEach(model => {
          const row = lookup.get(JSON.stringify([agent, model]));
          const cell = UI.node("div", "efficiency-heat-cell");
          if (!row) cell.append(UI.node("span", "", tr("Kayıt yok")));
          else {
            if (row.credits != null && max) cell.style.backgroundColor = `rgba(79,107,237,${0.05 + 0.25 * row.credits / max})`;
            cell.append(UI.node("strong", "", row.credits == null ? tr("Mevcut değil") : tr("{count} kredi", { count: credit(row.credits) })),
              UI.node("small", "", count(row.credit_count, row.events)));
          }
          cell.setAttribute("aria-label", `${agent}, ${model}: ${cell.textContent}`);
          grid.append(cell);
          group.push(cell);
        });
        groups.push(group);
      });
      scroll.append(grid); heatRoot.append(scroll);
      showMore(heatRoot, "efficiency-pairs", groups);
      if (heatFocused) document.getElementById("efficiency-pairs-more")?.focus({ preventScroll: true });
    }

    trendGraph("efficiency-trend", e.daily, {
      key: "credits", countKey: "credit_count", totalKey: "events",
      label: tr("Günlük AI kredisi grafiği"), emptyMessage: tr("Grafik için kredi ölçümü yok."),
    });
    const peak = document.getElementById("efficiency-peak");
    peak.replaceChildren();
    const measuredDays = e.daily.filter(row => row.credits != null);
    if (measuredDays.length) {
      const highest = measuredDays.reduce((a, b) => b.credits > a.credits ? b : a);
      const others = measuredDays.filter(row => row !== highest);
      const otherAverage = others.reduce((sum, row) => sum + row.credits, 0) / others.length;
      const spike = measuredDays.length >= 3 && measuredDays.every(row => row.credit_count === row.events)
        && highest.credits > 0 && highest.credits >= 2 * otherAverage;
      peak.append(UI.node("p", "efficiency-note", `${tr(spike ? "Tüketim sıçraması" : "En yüksek ölçülen gün")}: ${highest.day} · ${tr("{count} kredi", { count: credit(highest.credits) })} · ${count(highest.credit_count, highest.events)}.${spike ? tr(" Diğer ölçülen günlerin ortalamasının en az 2 katı.") : ""}${tr(" Eksik günler ve kısmi ölçümler karşılaştırmayı etkileyebilir.")}`));
    }
    const cache = document.getElementById("efficiency-cache");
    cache.replaceChildren(UI.node("p", "efficiency-note", e.cache.ratio == null
      ? `${tr("Oran için uygun ölçüm yok")} · ${count(e.cache.count, e.cache.events)}`
      : `${tr("Seçili dönem: {ratio}", { ratio: UI.percent(e.cache.ratio) })} · ${count(e.cache.count, e.cache.events)}`));
    trendGraph("efficiency-cache-trend", e.daily, {
      key: "cache_ratio", countKey: "cache_count", totalKey: "cache_events",
      label: tr("Günlük cache okuma oranı grafiği"), emptyMessage: tr("Grafik için uygun cache ölçümü yok."), percent: true,
    });
    bars("efficiency-coverage", [
      { label: tr("Kredi"), value: e.credit_count },
      { label: tr("İstek süresi"), value: e.duration_count },
      { label: tr("Agent kimliği"), value: e.identified_events },
      { label: tr("Cache oranı için uygun"), value: e.cache.count },
    ], "value", value => count(value, e.total_events), () => tr("Seçili kullanım olayları"));

    const warning = document.getElementById("efficiency-warning");
    const warnings = [...e.warnings];
    if (e.missing_logs) warnings.unshift(tr("{count} oturumun agent olay günlüğü bulunamadı; agent isimleri eksik olabilir.", { count: UI.format(e.missing_logs) }));
    warning.hidden = !warnings.length;
    warning.textContent = warnings.join("\n");
  },
};
