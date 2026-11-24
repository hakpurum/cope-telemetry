"use strict";

const chartTabs = [...document.querySelectorAll(".overview-chart-tabs [role=tab]")];
function selectChartTab(selected) {
  chartTabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  });
}
chartTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectChartTab(tab));
  tab.addEventListener("keydown", event => {
    let target;
    if (event.key === "ArrowRight") target = chartTabs[(index + 1) % chartTabs.length];
    else if (event.key === "ArrowLeft") target = chartTabs[(index - 1 + chartTabs.length) % chartTabs.length];
    else if (event.key === "Home") target = chartTabs[0];
    else if (event.key === "End") target = chartTabs[chartTabs.length - 1];
    else return;
    event.preventDefault();
    selectChartTab(target);
    target.focus();
  });
});

window.Page = {
  render(data) {
    const t = data.totals;
    UI.metricGrid("overview-kpis", data.source, [
      { label: tr("AI kredisi"), value: t.aiu, digits: 9, note: `${UI.format(t.aiu_count)} / ${UI.format(t.events)}${tr(" ölçüm")}${t.aiu_count < t.events ? tr(" · kısmi") : ""}` },
      { label: tr("Giriş token"), value: t.input, note: tr("Olay toplamı") },
      { label: tr("Çıkış token"), value: t.output, note: tr("Olay toplamı") },
      { label: tr("Oturum"), value: data.sessions.length, note: tr("Eşleşen oturumlar") },
    ]);
    UI.chart("overview-trend", data.daily, [{ key: "input", label: tr("Giriş token") }, { key: "output", label: tr("Çıkış token") }], { columns: true });
    UI.chart("overview-credit-trend", data.daily, [{ key: "credits", label: tr("AI kredisi") }], {
      scaleFloor: 0, points: true, timeScale: true,
      axisFormat: value => value > 0 && value < 0.001 ? (window.locale === "tr-TR" ? value.toExponential(1).replace(".", ",") : value.toExponential(1)) :
        value >= 1000 ? UI.compact(value) : UI.format(value, 3),
    });
    UI.table("overview-credit-coverage", [
      { label: tr("Gün"), value: "day" },
      { label: tr("AI kredisi"), value: row => UI.format(row.credits, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Ölçüm kapsamı"), value: row => `${UI.format(row.credit_count)} / ${UI.format(row.events)}${row.credit_count > 0 && row.credit_count < row.events ? tr(" · kısmi") : ""}`, kind: "HESAPLANMIŞ" },
    ], data.daily, { source: data.source });
    UI.bars("overview-models", data.models.map(row => ({ label: row.model, value: row.events })));
    UI.table("overview-tokens", [
      { label: tr("Ölçüm"), value: "label" }, { label: "Token", value: row => UI.format(row.value), kind: "HESAPLANMIŞ" },
    ], [
      { label: tr("Giriş"), value: t.input }, { label: tr("Çıkış"), value: t.output },
      { label: tr("Cache okuma"), value: t.cache_read }, { label: tr("Cache yazma"), value: t.cache_write },
      { label: tr("Akıl yürütme"), value: t.reasoning },
    ], { source: data.source });
    UI.table("overview-sessions", [
      { label: tr("Oturum"), value: "id", sessionId: true }, { label: tr("Yerel klasör"), value: "cwd" }, { label: "Repo", value: row => row.repository || tr("Repo yok") },
      { label: tr("Güncelleme"), value: row => UI.time(row.updated_at), kind: "KAYIT" },
    ], data.sessions.slice(0, 6), { source: data.source });
  },
};
