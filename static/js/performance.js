"use strict";

window.Page = {
  render(data) {
    const t = data.totals;
    UI.metricGrid("performance-kpis", data.source, [
      { label: tr("Ortalama istek süresi"), value: t.duration_avg, digits: 1, unit: " ms", note: `${UI.format(t.duration_count)}${tr(" ölçüm")}` },
      { label: tr("P95 istek süresi"), value: t.duration_p95, unit: " ms", note: `${UI.format(t.duration_count)}${tr(" ölçüm")}` },
      { label: tr("Ortalama ilk token"), value: t.ttft_avg, digits: 1, unit: " ms", note: `${UI.format(t.ttft_count)}${tr(" ölçüm")}` },
      { label: tr("P95 ilk token"), value: t.ttft_p95, unit: " ms", note: `${UI.format(t.ttft_count)}${tr(" ölçüm")}` },
    ]);
    UI.chart("performance-trend", data.daily, [{ key: "duration", label: tr("İstek süresi (ms)") }, { key: "ttft", label: tr("İlk token (ms)") }]);
    UI.bars("performance-finish", data.finish.map(row => ({ label: row.name, value: row.count })));
    UI.table("performance-models", [
      { label: "Model", value: "model" },
      { label: tr("Olay"), value: row => UI.format(row.events), kind: "HESAPLANMIŞ" },
      { label: tr("Ort. süre (ms)"), value: row => UI.format(row.duration_avg, 1), kind: "HESAPLANMIŞ" },
      { label: tr("Süre ölçümü"), value: row => UI.format(row.duration_count), kind: "HESAPLANMIŞ" },
      { label: tr("AI kredisi"), value: row => UI.format(row.credits, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Kredi ölçümü"), value: row => `${UI.format(row.credit_count)} / ${UI.format(row.events)}${row.credit_count > 0 && row.credit_count < row.events ? tr(" · kısmi") : ""}`, kind: "HESAPLANMIŞ" },
    ], data.models, { source: data.source });
  },
};
