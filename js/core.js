/* RulesForge · core.js
 * Shared basics: the page helpers ($, esc, toast), settings storage, the browser database, app state, document kinds and pop-up sheets.
 */
const KINDS = {
  core:    { label: "Core Rules", desc: "The main rulebook", icon: "book" },
  faction: { label: "Faction rules", desc: "Codex, Index or faction pack", icon: "shield" },
  points:  { label: "Points", desc: "Munitorum Field Manual", icon: "hash" },
  updates: { label: "Updates", desc: "FAQ, Balance Dataslate, mission pack", icon: "clock" },
};
const ICONS = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/>',
  shield: '<path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-4z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const KNOWN_FACTIONS = [
  "Adepta Sororitas", "Adeptus Custodes", "Adeptus Mechanicus", "Astra Militarum",
  "Black Templars", "Blood Angels", "Dark Angels", "Deathwatch", "Grey Knights",
  "Imperial Agents", "Imperial Knights", "Space Marines", "Space Wolves",
  "Chaos Daemons", "Chaos Knights", "Chaos Space Marines", "Death Guard",
  "Emperor's Children", "Thousand Sons", "World Eaters",
  "Aeldari", "Drukhari", "Genestealer Cults", "Leagues of Votann",
  "Necrons", "Orks", "T'au Empire", "Tyranids",
];const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("rulesforge", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("docs", { keyPath: "id" });
        db.createObjectStore("lists", { keyPath: "id" });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(storeName, mode);
      const result = fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => reject(t.error);
    });
  },
  all(s) { return this.tx(s, "readonly", st => st.getAll()); },
  put(s, v) { return this.tx(s, "readwrite", st => st.put(v)); },
  del(s, id) { return this.tx(s, "readwrite", st => st.delete(id)); },
};const state = {
  docs: [],
  lists: [],
  index: null,
  scope: "auto",
  messages: [],
  answering: false,
  building: false,
  points: store.get("rf.points", 2000),
};/** The app's own confirmation window (browser pop-ups are blocked in some places). Resolves true or false. */
function confirmSheet(title, message, actionLabel) {
  return new Promise(resolve => {
    const d = openSheet(`
      <div class="sheet-head"><h2>${esc(title)}</h2><p>${esc(message)}</p></div>
      <div class="sheet-foot">
        <button class="btn" type="button" id="confirmNo">Cancel</button>
        <button class="btn primary" type="button" id="confirmYes" style="background:var(--red)">${esc(actionLabel)}</button>
      </div>`);
    let answered = false;
    const finish = v => { if (answered) return; answered = true; if (d.open) d.close(); resolve(v); };
    $("#confirmYes").onclick = () => finish(true);
    $("#confirmNo").onclick = () => finish(false);
    d.addEventListener("close", () => finish(false), { once: true });
  });
}

function openSheet(html, wide = false) {
  const d = $("#sheet");
  d.className = wide ? "wide" : "";
  d.innerHTML = `<div class="sheet">${html}</div>`;
  if (!d.open) d.showModal();
  return d;
}

const formatGB = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

function askText(title, label, value) {
  return new Promise(resolve => {
    const d = openSheet(`
      <div class="sheet-head"><h2>${esc(title)}</h2></div>
      <div class="sheet-body"><div class="field"><label for="askInput">${esc(label)}</label><input class="input" id="askInput" value="${esc(value)}"></div></div>
      <div class="sheet-foot"><button class="btn" type="button" id="askNo">Cancel</button><button class="btn primary" type="button" id="askYes">Save</button></div>`);
    let done = false;
    const finish = v => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    $("#askYes").onclick = () => finish($("#askInput").value.trim() || null);
    $("#askNo").onclick = () => finish(null);
    $("#askInput").onkeydown = e => { if (e.key === "Enter") $("#askYes").click(); };
    d.addEventListener("close", () => finish(null), { once: true });
    setTimeout(() => $("#askInput")?.select(), 30);
  });
}

/** Must match <meta name="rf-version"> in index.html; a mismatch means some files on the site are out of date. */
const APP_VERSION = "7.1";

export { $, $$, APP_VERSION, askText, confirmSheet, DB, esc, formatGB, icon, KINDS, KNOWN_FACTIONS, openSheet, state, store, toast, uid };
