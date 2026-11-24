"use strict";

window.App = (() => {
  const ids = ["source", "start", "end", "model", "repo", "workspace", "session"];
  const controls = Object.fromEntries(ids.map(id => [id, document.getElementById(`${id}-filter`)]));
  const page = document.body.dataset.page;
  const errorBanner = document.getElementById("error-banner");
  const refreshControl = document.getElementById("refresh-interval");
  const refreshWarning = document.getElementById("refresh-warning");
  const refreshKey = "copilot-telemetry-refresh-seconds";
  let controller;
  let refreshTimer;
  let showContent = false;
  let currentData;

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function defaults() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return { source: "live", start: localDate(start), end: localDate(now), model: "", repo: "", workspace: "", session: "" };
  }
  function params() {
    const result = new URLSearchParams();
    ids.forEach(id => { if (controls[id].value) result.set(id, controls[id].value); });
    result.set("page", page);
    return result;
  }
  function updateUrl() {
    const query = params(); query.delete("page");
    history.replaceState(null, "", `${location.pathname}?${query}`);
    document.querySelectorAll(".sidebar a").forEach(link => {
      const url = new URL(link.href);
      url.search = query.toString(); link.href = url.toString();
    });
  }
  function setOptions(control, values, placeholder, label = value => value) {
    const previous = control.value;
    control.replaceChildren(new Option(placeholder, ""));
    values.forEach(value => control.add(new Option(label(value), value)));
    if (values.includes(previous)) control.value = previous;
    return !previous || control.value === previous;
  }
  function banner(source) {
    const element = document.getElementById("source-banner");
    element.classList.toggle("live", source === "live");
    element.textContent = source === "demo"
      ? tr("DEMO VERİLER — Tüm sayılar ve kayıtlar örnektir; gerçek kullanım değildir.")
      : tr("GERÇEK VERİLER — Yerel session-store.db salt okunur kullanılıyor. Hesaplanmış metrikler ayrıca etiketlenir.");
  }
  function error(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
    document.getElementById("refresh-status").textContent = tr("Yenileme başarısız");
    clearViews(tr("Veriler gösterilemiyor."));
  }
  function clearViews(message) {
    document.querySelectorAll(".metric-grid, .panel-body > div, [data-clear-view]").forEach(el => UI.empty(el, message));
  }
  async function getJSON(url, signal) {
    const response = await fetch(url, { signal, cache: "no-store" });
    let data;
    try { data = await response.json(); } catch { throw new Error(tr("Sunucu geçersiz yanıt verdi (HTTP {status}).", { status: response.status })); }
    if (!response.ok) throw new Error(data.error || tr("Sunucu hatası (HTTP {status}).", { status: response.status }));
    return data;
  }
  async function load() {
    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (!currentData || currentData.source !== controls.source.value) {
      document.getElementById("source-banner").textContent = tr("Seçili kaynak yükleniyor; önceki veriler gizlendi.");
      document.getElementById("source-banner").classList.remove("live");
      clearViews(tr("Veriler yükleniyor."));
    }
    updateUrl();
    try {
      const data = await getJSON(`/api/data?${params()}`, signal);
      const validModel = setOptions(controls.model, data.options.models, tr("Tüm modeller"));
      const validRepo = setOptions(controls.repo, data.options.repos, tr("Tüm repolar"));
      const validWorkspace = setOptions(controls.workspace, data.options.workspaces, tr("Tüm klasörler"));
      const validSession = setOptions(controls.session, data.options.sessions.map(row => row.id), tr("Tüm oturumlar"));
      if (!validModel || !validRepo || !validWorkspace || !validSession) { showContent = false; return load(); }
      updateUrl();
      currentData = data;
      banner(data.source);
      errorBanner.hidden = true;
      document.querySelectorAll("[data-provenance]").forEach(el => {
        el.textContent = tr(data.source === "demo" ? "DEMO · HESAPLANMIŞ / ÖRNEK KAYIT" : "HESAPLANMIŞ / GERÇEK");
      });
      window.Page.render(data);
      if (page === "sessions") await loadDetails(signal);
      document.getElementById("refresh-status").textContent = `${tr("Güncellendi")} ${new Date().toLocaleTimeString(window.locale)}`;
    } catch (problem) {
      if (problem.name !== "AbortError") error(problem.message);
    }
  }
  async function loadDetails(signal) {
    if (!controls.session.value) return window.Page.renderDetails(null, false);
    const query = params();
    query.set("content", showContent ? "1" : "0");
    const data = await getJSON(`/api/session/${encodeURIComponent(controls.session.value)}?${query}`, signal);
    window.Page.renderDetails(data, showContent);
  }
  function selectSession(id) {
    controls.session.value = id;
    showContent = false;
    if (page === "sessions") UI.empty(document.getElementById("session-detail"), tr("Oturum yükleniyor."));
    load();
  }
  function toggleContent() {
    showContent = !showContent;
    if (!showContent) UI.empty(document.getElementById("session-detail"), tr("İçerik gizlendi."));
    load();
  }
  function setRefreshInterval(save) {
    if (refreshTimer) clearInterval(refreshTimer);
    const seconds = Number(refreshControl.value);
    refreshTimer = seconds ? setInterval(() => { if (!document.hidden) load(); }, seconds * 1000) : null;
    document.getElementById("refresh-footer").textContent = seconds
      ? tr("{interval} aralıkla yenilenir", { interval: refreshControl.selectedOptions[0].textContent })
      : tr("Manuel yenileme");
    if (save) {
      try {
        localStorage.setItem(refreshKey, refreshControl.value);
        refreshWarning.hidden = true;
      } catch (problem) {
        if (!(problem instanceof DOMException)) throw problem;
        refreshWarning.textContent = tr("Yenileme tercihi tarayıcıya kaydedilemedi; seçim yalnızca bu sayfada geçerli.");
        refreshWarning.hidden = false;
      }
    }
  }
  function initialiseRefresh() {
    try {
      const saved = localStorage.getItem(refreshKey);
      if (saved !== null) {
        if ([...refreshControl.options].some(option => option.value === saved)) {
          refreshControl.value = saved;
        } else {
          refreshWarning.textContent = tr("Kaydedilmiş yenileme tercihi geçersiz; 5 saniye kullanılıyor.");
          refreshWarning.hidden = false;
        }
      }
    } catch (problem) {
      if (!(problem instanceof DOMException)) throw problem;
      refreshWarning.textContent = tr("Kaydedilmiş yenileme tercihi okunamadı; 5 saniye kullanılıyor.");
      refreshWarning.hidden = false;
    }
    setRefreshInterval(false);
    refreshControl.addEventListener("change", () => setRefreshInterval(true));
  }
  function initialise() {
    const query = new URLSearchParams(location.search);
    const initial = defaults();
    ids.forEach(id => {
      let value = query.get(id) ?? initial[id];
      if (id === "source" && !["demo", "live"].includes(value)) value = initial.source;
      if (["model", "repo", "workspace", "session"].includes(id) && value) controls[id].add(new Option(value, value));
      controls[id].value = value;
      controls[id].addEventListener("change", () => {
        if (id === "source") ["model", "repo", "workspace", "session"].forEach(name => { controls[name].value = ""; });
        if (["model", "repo", "workspace"].includes(id)) controls.session.value = "";
        showContent = false;
        if (page === "sessions") UI.empty(document.getElementById("session-detail"), tr("Oturum yükleniyor."));
        load();
      });
    });
    document.getElementById("refresh-button").addEventListener("click", load);
    document.getElementById("reset-filters").addEventListener("click", () => {
      Object.entries(defaults()).forEach(([id, value]) => { controls[id].value = value; });
      showContent = false;
      if (page === "sessions") UI.empty(document.getElementById("session-detail"), tr("Oturum yükleniyor."));
      load();
    });
    initialiseRefresh();
    const languageSelect = document.getElementById("language-select");
    languageSelect.addEventListener("change", () => {
      let saved = false;
      try {
        document.cookie = `cope-language=${languageSelect.value}; Max-Age=31536000; Path=/; SameSite=Lax`;
        saved = document.cookie.split("; ").includes(`cope-language=${languageSelect.value}`);
      } catch (problem) {
        if (!(problem instanceof DOMException)) throw problem;
      }
      if (!saved) {
        languageSelect.value = document.documentElement.lang;
        errorBanner.textContent = tr("Dil tercihi kaydedilemedi; tarayıcı çerezlerini kontrol edin.");
        errorBanner.hidden = false;
        return;
      }
      updateUrl();
      location.reload();
    });
    load();
  }
  document.addEventListener("DOMContentLoaded", initialise);
  return { selectSession, toggleContent, get source() { return controls.source.value; }, get data() { return currentData; } };
})();
