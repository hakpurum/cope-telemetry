"use strict";

window.Page = {
  render(data) {
    const t = data.totals;
    UI.metricGrid("usage-kpis", data.source, [
      { label: tr("Giriş token"), value: t.input, note: `${UI.format(t.input_tokens_count)} / ${UI.format(t.events)}${tr(" ölçüm")}` },
      { label: tr("Çıkış token"), value: t.output, note: `${UI.format(t.output_tokens_count)} / ${UI.format(t.events)}${tr(" ölçüm")}` },
      { label: tr("Cache okuma token"), value: t.cache_read, note: `${UI.format(t.cache_read_tokens_count)} / ${UI.format(t.events)}${tr(" ölçüm")}` },
      { label: tr("AI kredisi"), value: t.aiu, digits: 9, note: `${UI.format(t.aiu_count)} / ${UI.format(t.events)}${tr(" ölçüm")}${t.aiu_count < t.events ? tr(" · kısmi") : ""}` },
      { label: tr("Cache yazma token"), value: t.cache_write, note: `${UI.format(t.cache_write_tokens_count)} / ${UI.format(t.events)}${tr(" ölçüm")}` },
      { label: tr("Akıl yürütme token"), value: t.reasoning, note: `${UI.format(t.reasoning_tokens_count)} / ${UI.format(t.events)}${tr(" ölçüm")}` },
      { label: tr("Kullanım olayı"), value: t.events, note: tr("Seçili dönem") },
      { label: tr("Fatura tutarı"), value: null, note: tr("Kaynakta yok") },
    ]);
    UI.chart("usage-trend", data.daily, [{ key: "input", label: tr("Giriş token") }, { key: "output", label: tr("Çıkış token") }], { columns: true });
    UI.table("usage-models", [
      { label: "Model", value: "model" },
      { label: tr("Olay"), value: row => UI.format(row.events), kind: "HESAPLANMIŞ" },
      { label: tr("Giriş"), value: row => UI.format(row.input), kind: "HESAPLANMIŞ" },
      { label: tr("Çıkış"), value: row => UI.format(row.output), kind: "HESAPLANMIŞ" },
      { label: tr("AI kredisi"), value: row => UI.format(row.credits, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Kredi ölçümü"), value: row => `${UI.format(row.credit_count)} / ${UI.format(row.events)}`, kind: "HESAPLANMIŞ" },
    ], data.models, { source: data.source });
    UI.table("usage-events", [
      { label: tr("Zaman"), value: row => UI.time(row.created_at), kind: "KAYIT" },
      { label: tr("Oturum"), value: "session_id", sessionId: true }, { label: "Model", value: "model" },
      { label: tr("Tur"), value: "turn_index", kind: "KAYIT" },
      { label: tr("Başlatan"), value: "initiator", kind: "KAYIT" },
      { label: "Copilot model", value: "copilot_usage_model", kind: "KAYIT" },
      { label: tr("Giriş"), value: row => UI.format(row.input_tokens), kind: "KAYIT" },
      { label: tr("Çıkış"), value: row => UI.format(row.output_tokens), kind: "KAYIT" },
      { label: tr("Cache okuma"), value: row => UI.format(row.cache_read_tokens), kind: "KAYIT" },
      { label: tr("Cache yazma"), value: row => UI.format(row.cache_write_tokens), kind: "KAYIT" },
      { label: "Reasoning", value: row => UI.format(row.reasoning_tokens), kind: "KAYIT" },
      { label: tr("AI kredisi"), value: row => UI.format(row.total_nano_aiu == null ? null : row.total_nano_aiu / 1e9, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Agent kimliği"), value: "agent_id", kind: "KAYIT", idLabel: tr("Agent kimliği") },
      { label: tr("Süre (ms)"), value: row => UI.format(row.duration_ms), kind: "KAYIT" },
      { label: tr("İlk token (ms)"), value: row => UI.format(row.time_to_first_token_ms), kind: "KAYIT" },
      { label: tr("Çıkış ilk token (ms)"), value: row => UI.format(row.output_ttft_ms, 2), kind: "KAYIT" },
      { label: tr("Token arası (ms)"), value: row => UI.format(row.inter_token_latency_ms, 2), kind: "KAYIT" },
      { label: tr("Akıl yürütme düzeyi"), value: "reasoning_effort", kind: "KAYIT" },
      { label: tr("Çarpan"), value: row => UI.format(row.request_multiplier, 3), kind: "KAYIT" },
      { label: "API endpoint", value: "api_endpoint", kind: "KAYIT" },
      { label: tr("İçerik filtresi"), value: "content_filter_triggered", kind: "KAYIT" },
      { label: tr("Bitiş nedeni"), value: "finish_reason", kind: "KAYIT" },
    ], data.events, { source: data.source });
  },
};
