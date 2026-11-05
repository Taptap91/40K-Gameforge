/* RulesForge · main.js
 * Start-up, page switching and event wiring.
 */
import { AI, openAISheet, renderAIStatus } from "./ai.js?v=5.3";
import { $, $$, APP_VERSION, confirmSheet, DB, esc, KNOWN_FACTIONS, state, store, toast } from "./core.js?v=5.3";
import { exportDocToExcel } from "./excel.js?v=5.3";
import { addLibraryFiles, factionsInLibrary, isExcelFile, openPointsSheet, renderLibrary } from "./library.js?v=5.3";
import { renderListsPage, renderSaved, wireListBuilder } from "./list-editor.js?v=5.3";
import { ask, renderChat, renderScope, updateSendButton } from "./rules-chat.js?v=5.3";
import { buildIndex } from "./search.js?v=5.3";
import { openDataViewer } from "./viewer.js?v=5.3";

function renderAll() {
  renderScope();
  renderLibrary();
  renderChat();
  renderSaved();
  renderAIStatus();
  $("#factionList").innerHTML = [...new Set([...factionsInLibrary(), ...KNOWN_FACTIONS])].sort().map(f => `<option value="${esc(f)}">`).join("");
}

function showView(name) {
  if (!["rules", "lists", "library"].includes(name)) name = "library"; // the old Get Data page now lives in Library
  for (const v of ["rules", "lists", "library"]) $("#view-" + v).classList.toggle("hidden", v !== name);
  if (name === "lists") renderListsPage();
  $$(".nav-item").forEach(b => b.dataset.view === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  store.set("rf.view", name);
  if (name === "rules") setTimeout(() => $("#question").focus(), 0);
}function wireEvents() {
  $$(".nav-item").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#aiStatusBtn").addEventListener("click", openAISheet);

  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-close]")) $("#sheet").close();
    if (t.closest("[data-ai-setup]")) openAISheet();
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
  $("#addPdfBtn").addEventListener("click", pick);
  $("#dropzone").addEventListener("click", pick);
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
  $("#docList").addEventListener("click", async e => {
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
}(async function init() {
  wireEvents();
  try {
    await DB.open();
    state.docs = await DB.all("docs");
    state.lists = await DB.all("lists");
  } catch (err) {
    console.error(err);
    toast("Couldn't open browser storage — documents won't be saved.");
  }
  buildIndex();
  renderAll();
  showView(store.get("rf.view", "rules"));
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  AI.resume();
  // If the page and its script files come from different uploads, say so instead of quietly running old code.
  const pageVersion = document.querySelector('meta[name="rf-version"]')?.content;
  if (pageVersion && pageVersion !== APP_VERSION) {
    const bar = document.createElement("div");
    bar.className = "version-warn";
    bar.textContent = `Some RulesForge files are out of date (page ${pageVersion}, scripts ${APP_VERSION}). Upload every file from the latest version to GitHub, then reload.`;
    document.body.prepend(bar);
  }
})();


export { renderAll };
