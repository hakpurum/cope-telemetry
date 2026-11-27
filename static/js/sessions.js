"use strict";

window.Page = {
  render(data) {
    UI.metricGrid("sessions-kpis", data.source, [
      { label: tr("Eşleşen oturum"), value: data.sessions.length, note: tr("Seçili dönem") },
      { label: tr("Kullanım olayı"), value: data.totals.events, note: tr("Seçili oturumlar") },
      { label: tr("Giriş token"), value: data.totals.input, note: tr("Olay toplamı") },
      { label: tr("Çıkış token"), value: data.totals.output, note: tr("Olay toplamı") },
    ]);
    UI.table("sessions-list", [
      { label: tr("Oturum"), value: "id", sessionId: true },
      { label: tr("Kullanılan modeller"), value: row => row.models?.join(", ") || tr("Mevcut değil") },
      { label: tr("Yerel klasör"), value: "cwd" },
      { label: "Repo", value: row => row.repository || tr("Repo yok") }, { label: "Branch", value: "branch" },
      { label: tr("Oluşturulma"), value: row => UI.time(row.created_at), kind: "KAYIT" },
      { label: tr("Güncelleme"), value: row => UI.time(row.updated_at), kind: "KAYIT" },
    ], data.sessions, { source: data.source, onRow: row => App.selectSession(row.id) });
  },
  renderDetails(data, visible) {
    const root = document.getElementById("session-detail");
    root.replaceChildren();
    if (!data) return UI.empty(root, tr("Ayrıntıları görmek için oturum seçin."));
    const header = UI.node("div", "detail-header");
    header.append(UI.node("span", "detail-caption", `${UI.provenance(App.source, "KAYIT", 1)} · ${tr("{messages} mesaj / {files} dosya / {commands} komut", { messages: UI.format(data.messages.length), files: UI.format(data.files.length), commands: UI.format(data.commands.length) })}`));
    header.append(UI.node("span", "detail-caption", `${tr("Kullanılan modeller")}: ${data.models?.join(", ") || tr("Mevcut değil")}`));
    const actions = UI.node("div", "detail-actions");
    const back = UI.node("button", "details-toggle", tr("← Oturum listesine dön"));
    back.type = "button"; back.addEventListener("click", () => App.selectSession(""));
    const toggle = UI.node("button", "details-toggle", tr(visible ? "İçeriği gizle" : "İçeriği göster"));
    toggle.type = "button"; toggle.addEventListener("click", App.toggleContent);
    actions.append(back, toggle);
    header.append(actions); root.append(header);
    const metrics = UI.node("div", "metric-grid detail-metrics");
    metrics.id = "session-credit-metrics";
    root.append(metrics);
    const totals = App.data.totals;
    const full = data.session_credits;
    const coverage = (count, events) => `${UI.format(count)} / ${UI.format(events)}${tr(" ölçüm")}${count < events ? tr(" · kısmi") : ""}`;
    UI.metricGrid(metrics.id, App.source, [
      { label: tr("Oturumun tamamı · AI kredisi"), value: full.credits, digits: 9, note: coverage(full.credit_count, full.events) },
      { label: tr("Seçili dönem ve model · AI kredisi"), value: totals.aiu, digits: 9, note: coverage(totals.aiu_count, totals.events) },
    ]);
    const addSection = (label, rows, describe) => {
      const section = UI.node("section", "detail-section");
      section.append(UI.node("h3", "", label));
      if (!rows.length) section.append(UI.node("p", "detail-caption", tr("Seçili dönemde kayıt yok.")));
      rows.forEach(row => section.append(UI.node("pre", "detail-text", describe(row))));
      root.append(section);
    };
    addSection(tr("Mesajlar"), data.messages, row => `${UI.time(row.timestamp)} · #${row.turn_index}` +
      (visible ? `\n${tr("Kullanıcı")}: ${row.user_message ?? tr("Mevcut değil")}\n${tr("Asistan")}: ${row.assistant_response ?? tr("Mevcut değil")}` : ""));
    addSection(tr("Dosyalar"), data.files, row => `${UI.time(row.first_seen_at)} · ${row.tool_name || tr("Mevcut değil")}\n${row.file_path}`);
    addSection(tr("Komut olayları"), data.commands, row => `${UI.time(row.created_at)} · ${row.event_type || tr("Mevcut değil")} · ${tr("çıkış")}: ${row.exit_code ?? tr("Mevcut değil")}` +
      (visible ? `\n${tr("Komut")}: ${row.command ?? tr("Mevcut değil")}\n${tr("Çıktı")}: ${row.output ?? tr("Mevcut değil")}` : ""));
  },
};
