"use strict";

window.Page = {
  render(data) {
    const a = data.activity;
    UI.metricGrid("activity-kpis", data.source, [
      { label: tr("Dosya kaydı"), value: a.files.length, note: tr("İlk görülme tarihi") },
      { label: tr("Mesaj kaydı"), value: a.messages.length, note: tr("İçerik gizli") },
      { label: tr("Komut olayı"), value: a.commands.length, note: tr("Yalnızca kayıtlı olaylar") },
      { label: tr("Eşleşen oturum"), value: data.sessions.length, note: tr("Seçili filtreler") },
    ]);
    UI.table("activity-files", [
      { label: tr("Zaman"), value: row => UI.time(row.first_seen_at), kind: "KAYIT" },
      { label: tr("Dosya"), value: "file_path" }, { label: tr("Araç"), value: "tool_name" },
      { label: tr("Oturum"), value: "session_id", sessionId: true },
    ], a.files, { source: data.source });
    UI.table("activity-commands", [
      { label: tr("Zaman"), value: row => UI.time(row.created_at), kind: "KAYIT" },
      { label: tr("Olay"), value: "event_type" }, { label: tr("Çıkış kodu"), value: "exit_code", kind: "KAYIT" },
      { label: tr("Oturum"), value: "session_id", sessionId: true },
    ], a.commands, { source: data.source });
    UI.table("activity-messages", [
      { label: tr("Zaman"), value: row => UI.time(row.timestamp), kind: "KAYIT" },
      { label: tr("Tur"), value: "turn_index", kind: "KAYIT" }, { label: tr("Oturum"), value: "session_id", sessionId: true },
    ], a.messages, { source: data.source });
  },
};
