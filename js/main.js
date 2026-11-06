/* RulesForge · main.js
 * Start-up, page switching and event wiring.
 */
import { AI, openAISheet, renderAIStatus } from "./ai.js?v=8.2";
import { $, $$, confirmSheet, DB, esc, KNOWN_FACTIONS, state, store, toast } from "./core.js?v=8.2";
import { exportDocToExcel } from "./excel.js?v=8.2";
import { addLibraryFiles, factionsInLibrary, isExcelFile, openLibraryMenu, openPointsSheet, renderLibrary } from "./library.js?v=8.2";
import * as core from "./core.js?v=8.2";
import { openLibrary, openStyleSheet, renderFactionsPage, wireFactionsPage } from "./factions.js?v=8.2";
import { renderListsPage, renderSaved, wireListBuilder } from "./list-editor.js?v=8.2";
import { ask, renderChat, renderScope, updateSendButton } from "./rules-chat.js?v=8.2";
import { buildIndex } from "./search.js?v=8.2";
import { openDataViewer } from "./viewer.js?v=8.2";
import { openMissionViewer } from "./mission-viewer.js?v=8.2";
import { askForAccountOnce, openPlayerSheet, renderBattlePage, wireBattlePage } from "../battle/battle.js?v=8.2";
import { fixApostrophes } from "./text.js?v=8.2";
import { groupArmyRules, tidyApostrophes } from "./faction-parser.js?v=8.2";
import { PACK_RULES_VERSION, loadFactionKit, packFaction, packTheme, sortDatasheetAbilities } from "./pack-rules.js?v=8.2";

function renderAll() {
  renderScope();
  renderLibrary();
  renderChat();
  renderSaved();
  renderAIStatus();
  if (!$("#view-factions").classList.contains("hidden")) renderFactionsPage();
  if (!$("#view-battle").classList.contains("hidden")) renderBattlePage();
  $("#factionList").innerHTML = [...new Set([...factionsInLibrary(), ...KNOWN_FACTIONS])].sort().map(f => `<option value="${esc(f)}">`).join("");
}

function showView(name) {
  const views = ["rules", "lists", "factions", "battle"];
  // Library now lives in Factions: the Factions home on phones and tablets, a panel on desktop.
  if (name === "library") { name = "factions"; setTimeout(() => openLibrary(), 0); }
  if (!views.includes(name)) name = "factions";
  for (const v of views) $("#view-" + v).classList.toggle("hidden", v !== name);
  if (name === "lists") renderListsPage();
  if (name === "factions") renderFactionsPage();
  if (name === "battle") renderBattlePage();
  $$(".nav-item").forEach(b => b.dataset.view === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  store.set("rf.view", name);
  if (name === "rules") setTimeout(() => $("#question").focus(), 0);
}function wireEvents() {
  $$(".nav-item[data-view]").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#aiStatusBtn").addEventListener("click", openAISheet);
  // Phones and tablets: the gear in the bottom bar opens settings, starting on the faction colours when there's a faction.
  $("#settingsBtn").addEventListener("click", () => openStyleSheet() || openAISheet());

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-close]")) $("#sheet").close();
    if (t.closest("[data-ai-setup]")) openAISheet();
    const tab = t.closest("[data-set-tab]");
    if (tab && !tab.classList.contains("on")) { if (tab.dataset.setTab === "ai") openAISheet(); else if (tab.dataset.setTab === "account") openPlayerSheet(); else if (!openStyleSheet()) toast("Add a faction in Library to set its colours."); }
    const go = t.closest("[data-go]");
    if (go) showView(go.dataset.go);
    const ex = t.closest("[data-example]");
    if (ex) ask(ex.dataset.example);
    const cite = t.closest(".cite");
    if (cite) {
      const bubble = cite.closest(".bubble");
      const sources = $(".sources", bubble);
      const src = sources && $(`.source[data-n="${cite.dataset.n}"]`, sources);
      if (src) {
        sources.open = true; src.open = true;
        src.classList.add("flash");
        setTimeout(() => src.classList.remove("flash"), 1200);
        src.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  });

  $("#sheet").addEventListener("click", e => { if (e.target === $("#sheet")) $("#sheet").close(); });

  // Rules chat
  const q = $("#question");
  q.addEventListener("input", () => {
    q.style.height = "auto";
    q.style.height = Math.min(q.scrollHeight, 160) + "px";
    updateSendButton();
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
  });
  $("#composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = q.value;
    if (!text.trim() || state.answering) return;
    q.value = ""; q.style.height = "auto";
    ask(text);
  });
  $("#clearChat").addEventListener("click", () => { state.messages = []; state.lastTurn = null; renderChat(); });
  $("#scopeSelect").addEventListener("change", e => { state.scope = e.target.value; });

  // Library
  const input = $("#fileInput");
  const pick = () => input.click();
  document.addEventListener("click", e => { if (e.target.closest("[data-lib-add]")) pick(); });
  input.addEventListener("change", () => {
    const files = [...input.files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf" || isExcelFile(f));
    input.value = "";
    if (files.length) addLibraryFiles(files);
  });
  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => {
    const files = [...e.dataTransfer.files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf" || isExcelFile(f));
    if (files.length) addLibraryFiles(files);
  });
  document.addEventListener("click", async e => {
    if (!e.target.closest(".lib-panel, .lb-menu")) return;
    const menu = e.target.closest("[data-lib-menu]");
    if (menu) return openLibraryMenu(menu);
    const mv = e.target.closest("[data-mission-view]");
    if (mv) return openMissionViewer(mv.dataset.missionView);
    const pts = e.target.closest("[data-points]");
    if (pts) return openPointsSheet(pts.dataset.points);
    const view = e.target.closest("[data-view-data]");
    if (view) return openDataViewer(view.dataset.viewData);
    const xl = e.target.closest("[data-excel]");
    if (xl) return exportDocToExcel(state.docs.find(d => d.id === xl.dataset.excel));
    const del = e.target.closest("[data-delete]");
    if (del) {
      const doc = state.docs.find(d => d.id === del.dataset.delete);
      if (!doc || !(await confirmSheet("Remove from library?", `“${doc.title}” and its points will be removed from this device.`, "Remove"))) return;
      await DB.del("docs", doc.id);
      state.docs = state.docs.filter(d => d !== doc);
      buildIndex();
      renderAll();
    }
  });

  // Lists
  wireListBuilder();
  wireFactionsPage();
  wireBattlePage();
}(async function init() {
  window.rfStarted = true;
  wireEvents();
  try {
    await DB.open();
    state.docs = await DB.all("docs");
    // Names imported before apostrophes were rejoined ("Nurgle ’ S Gift") are tidied as they load.
    for (const d of state.docs) {
      const st = d.structured;
      if (!st) continue;
      const fix = x => { if (x?.name) x.name = fixApostrophes(x.name); };
      [...(st.datasheets || []), ...(st.armyRules || []), ...(st.detachments || [])].forEach(fix);
      for (const det of st.detachments || []) [...(det.rules || []), ...(det.enhancements || []), ...(det.stratagems || [])].forEach(fix);
      for (const det of st.detachments || []) det.name = tidyApostrophes(det.name);   // "Emperor’S Chosen" → "Emperor’s Chosen"
      for (const ds of st.datasheets || []) (ds.abilities || []).forEach(fix);
      // Factions added before "[Name] Ability" rules were grouped under their army rule.
      if (st.armyRules) st.armyRules = groupArmyRules(st.armyRules);
      // Core vs faction abilities checked against the pack's army rules (faction pack ruleset, rule 11).
      if (st.datasheets) sortDatasheetAbilities(st);
    }
    // The app's faction kit (factions folder): colours now, symbols redrawn as soon as they've loaded.
    await loadFactionKit(() => renderAll());
    // Factions added before the faction pack ruleset get its official name and colours once, so they match everyone else's.
    for (const d of state.docs) {
      if (!d.structured?.datasheets || d.theme?.rules >= PACK_RULES_VERSION) continue;
      const f = packFaction({ datasheets: d.structured.datasheets, title: d.title, typed: d.faction });
      if (KNOWN_FACTIONS.includes(f)) d.faction = f;
      d.theme = { rules: PACK_RULES_VERSION, ...(await packTheme(d.faction, d.icon)) };
      try { await DB.put("docs", d); } catch {}
    }
    state.lists = await DB.all("lists");
    // Army lists name their detachments, so they get the same apostrophe tidy-up and still match.
    for (const l of state.lists) if (Array.isArray(l.detachments)) {
      const tidy = l.detachments.map(tidyApostrophes);
      if (tidy.some((n, i) => n !== l.detachments[i])) { l.detachments = tidy; try { await DB.put("lists", l); } catch {} }
    }
  } catch (err) {
    console.error(err);
    toast("Couldn't open browser storage — documents won't be saved.");
  }
  buildIndex();
  renderAll();
  showView(store.get("rf.view", "rules"));
  askForAccountOnce();   // the very first time the app is opened: Settings → Account, to add a username
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  AI.resume();
  // If the page and its script files come from different uploads, say so instead of quietly running old code.
  const pageVersion = document.querySelector('meta[name="rf-version"]')?.content;
  const scriptVersion = core.APP_VERSION || "older";
  if (pageVersion && pageVersion !== scriptVersion) {
    const bar = document.createElement("div");
    bar.className = "version-warn";
    bar.textContent = `Some RulesForge files are out of date (page ${pageVersion}, scripts ${scriptVersion}). Upload every file from the latest version to GitHub, then reload.`;
    document.body.prepend(bar);
  }
})();


export { renderAll };
