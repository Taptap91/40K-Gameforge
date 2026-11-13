/* RulesForge · packs.js
 * Game Packs: a catalog of ready-made rules/faction data, built by volunteers and downloaded straight into
 * the Library — no PDF, no AI parsing wait. A pack is exactly the same .xlsx workbook "Download Excel" already
 * produces for anything in your Library, so making one is: add your own PDF here once, ⋮ → Download Excel,
 * then contribute that file. This module only adds the browsing/downloading side of that loop.
 */
import { $, esc, icon, openSheet, state, toast } from "./core.js?v=8.46";
import { importWorkbookBuffer } from "./library.js?v=8.46";
import { renderAll } from "./main.js?v=8.46";

/** Where the catalog and its files live. A plain folder in the app's own repo for now — a volunteer packs
 *  this up and opens a pull request; nothing here needs a server. Point this at "main" once the game-packs
 *  branch is merged, so everyone's app reads the same, stable catalog. */
const PACKS_BASE = "https://raw.githubusercontent.com/Taptap91/40K-Gameforge/game-packs/packs/";
const PACKS_INDEX_URL = PACKS_BASE + "index.json";

let catalog = null;   // cached for the session once fetched
let loadError = null;

async function loadCatalog(force = false) {
  if (catalog && !force) return catalog;
  loadError = null;
  try {
    const res = await fetch(PACKS_INDEX_URL, { cache: force ? "reload" : "default" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    catalog = Array.isArray(json.packs) ? json.packs : [];
  } catch (err) {
    catalog = null;
    loadError = err.message || String(err);
  }
  return catalog;
}

/** The pack doc already in the Library for this pack id, if any (so the sheet can say "Installed" / "Update"
 *  instead of just "Download" every time). */
const installedFor = id => state.docs.find(d => d.pack?.id === id);

function packRow(entry) {
  const have = installedFor(entry.id);
  const newer = have && entry.version && have.pack.version !== entry.version;
  const status = !have ? "" : newer ? `<span class="pk-tag pk-tag-new">Update to v${esc(entry.version)}</span>` : `<span class="pk-tag">Installed</span>`;
  const label = !have ? "Download" : newer ? "Update" : "Re-download";
  return `<div class="pk-row" data-pk-id="${esc(entry.id)}">
    <div class="pk-head">
      <div class="pk-icon">${icon(entry.kind === "missions" ? "flag" : entry.kind === "faction" ? "shield" : "book")}</div>
      <div class="pk-name">${esc(entry.title)}${status}</div>
    </div>
    <div class="pk-meta">${esc([entry.editionTag, entry.version ? `v${entry.version}` : "", entry.sizeKB ? `${entry.sizeKB} KB` : ""].filter(Boolean).join(" · "))}</div>
    <div class="pk-meta2">${esc(entry.description || "")}</div>
    <div class="pk-by">Created by ${esc(entry.author || "a volunteer")}</div>
    <button type="button" class="btn pk-get" data-pk-get="${esc(entry.id)}">${label}</button>
  </div>`;
}

function groupedHTML(packs) {
  if (!packs.length) return `<p class="bt-hint">No packs in the catalog yet.</p>`;
  const groups = new Map();
  for (const p of packs) {
    const key = `${p.game || "Other"} · ${p.editionTag || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()].map(([title, list]) => `
    <div class="pk-group">
      <h3>${esc(title)}</h3>
      ${list.map(packRow).join("")}
    </div>`).join("");
}

async function openPacksSheet() {
  const d = openSheet(`
    <div class="sheet-head"><h2>Game Packs</h2><p>Ready-made rules and faction data, made by volunteers. Download one to add it straight to your Library.</p></div>
    <div class="sheet-body" id="packsBody"><p class="bt-hint">Loading the catalog…</p></div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Close</button></div>`, true, "pk-pop");
  const body = $("#packsBody");
  const packs = await loadCatalog();
  if (!packs) {
    body.innerHTML = `<p class="bt-hint">Couldn't load the pack catalog (${esc(loadError || "unknown error")}). Check your connection and try again.</p>
      <button type="button" class="btn" id="pkRetry">Try again</button>`;
    $("#pkRetry", body).onclick = async () => { body.innerHTML = `<p class="bt-hint">Loading the catalog…</p>`; const p = await loadCatalog(true); body.innerHTML = p ? groupedHTML(p) : `<p class="bt-hint">Still couldn't reach it.</p>`; };
    return;
  }
  body.innerHTML = groupedHTML(packs);
  d.onclick = async e => {
    const btn = e.target.closest("[data-pk-get]");
    if (!btn) return;
    const entry = packs.find(p => p.id === btn.dataset.pkGet);
    if (!entry) return;
    await downloadPack(entry, btn, body);
  };
}

async function downloadPack(entry, btn, body) {
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = "Downloading…";
  try {
    const res = await fetch(PACKS_BASE + entry.file);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    btn.textContent = "Installing…";
    await importWorkbookBuffer(buffer, entry.file.split("/").pop(), {
      title: entry.title,
      faction: entry.kind === "faction" ? (entry.faction || entry.title) : "",
      pack: { id: entry.id, version: entry.version || "", author: entry.author || "a volunteer", game: entry.game || "", editionTag: entry.editionTag || "" },
    });
    renderAll();
    toast(`${entry.title} added to your Library`);
    const row = body.querySelector(`[data-pk-id="${CSS.escape(entry.id)}"]`);
    if (row) row.outerHTML = packRow(entry);
  } catch (err) {
    toast(`Couldn't install ${entry.title}: ${err.message || err}`);
    btn.disabled = false; btn.textContent = was;
  }
}

export { openPacksSheet };
