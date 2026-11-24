"use strict";

window.Page = {
  render(data) {
    const info = data.agents;
    const named = info.agents.filter(agent => agent.name).length;
    const credits = info.identified_credits;
    UI.metricGrid("agents-kpis", data.source, [
      { label: tr("Agent çalışması"), value: info.agents.length, note: tr("{count} isimli kayıt", { count: UI.format(named) }) },
      { label: tr("Agent kullanım olayı"), value: info.identified_events, note: tr("Agent kimliği bulunan") },
      { label: tr("Agent AI kredisi"), value: credits.credits, digits: 9,
        note: `${UI.format(credits.credit_count)} / ${UI.format(info.identified_events)}${tr(" ölçüm")}${credits.credit_count < info.identified_events ? tr(" · kısmi") : ""}` },
      { label: tr("Kimliği olmayan olay"), value: info.unidentified_events, note: tr("Ana agent varsayılmaz") },
    ]);
    const warning = document.getElementById("agents-warning");
    const notices = [...info.warnings];
    if (info.missing_logs) notices.push(tr("{count} oturumun agent olay dosyası yok; isim ve başlatma kayıtları eksik olabilir.", { count: UI.format(info.missing_logs) }));
    warning.hidden = notices.length === 0;
    warning.textContent = notices.join(" ");
    UI.table("agents-list", [
      { label: "Agent", value: row => row.name || tr("İsim mevcut değil"), kind: "KAYIT" },
      { label: tr("Başlangıç"), value: row => UI.time(row.started_at), kind: "KAYIT" },
      { label: tr("Son durum"), value: "status", kind: "KAYIT" },
      { label: tr("Kullanılan modeller"), value: row => row.models.join(", "), kind: "KAYIT" },
      { label: tr("Olay"), value: row => UI.format(row.events), kind: "HESAPLANMIŞ" },
      { label: tr("Giriş token"), value: row => UI.format(row.input), kind: "HESAPLANMIŞ" },
      { label: tr("Çıkış token"), value: row => UI.format(row.output), kind: "HESAPLANMIŞ" },
      { label: tr("Cache okuma"), value: row => UI.format(row.cache_read), kind: "HESAPLANMIŞ" },
      { label: tr("Cache yazma"), value: row => UI.format(row.cache_write), kind: "HESAPLANMIŞ" },
      { label: tr("Akıl yürütme"), value: row => UI.format(row.reasoning), kind: "HESAPLANMIŞ" },
      { label: tr("AI kredisi"), value: row => UI.format(row.credits, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Kredi ölçümü"), value: row => `${UI.format(row.credit_count)} / ${UI.format(row.events)}`, kind: "HESAPLANMIŞ" },
      { label: tr("Agent kimliği"), value: "agent_id", kind: "KAYIT", idLabel: tr("Agent kimliği") },
      { label: tr("Oturum"), value: "session_id", kind: "KAYIT", sessionId: true },
    ], info.agents, { source: data.source });
    UI.table("agents-coverage", [
      { label: tr("Olay grubu"), value: "label" },
      { label: tr("Olay"), value: row => UI.format(row.events), kind: "HESAPLANMIŞ" },
      { label: tr("AI kredisi"), value: row => UI.format(row.credits.credits, 9), kind: "HESAPLANMIŞ" },
      { label: tr("Kredi ölçümü"), value: row => `${UI.format(row.credits.credit_count)} / ${UI.format(row.events)}`, kind: "HESAPLANMIŞ" },
    ], [
      { label: tr("Agent kimliği olan"), events: info.identified_events, credits: info.identified_credits },
      { label: tr("Agent kimliği olmayan"), events: info.unidentified_events, credits: info.unidentified_credits },
    ], { source: data.source });
  },
};
