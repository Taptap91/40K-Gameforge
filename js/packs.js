/* RulesForge · packs.js
 * Game Packs: a catalog of ready-made rules/faction data, built by volunteers and downloaded straight into
 * the Library — no PDF, no AI parsing wait, no in-app upload. Each catalog entry is a bundle (e.g.
 * "Warhammer 40K - 11th Edition") made up of several components — Core Rules, updates, mission packs, and
 * every faction — and downloading it installs every component in one go. A volunteer contributes a
 * component by pushing a PDF to packs/incoming/ on GitHub (see packs/incoming/README.md); a GitHub Actions
 * workflow converts it into the .xlsx this module downloads and slots into the right bundle. This module
 * only handles the browsing/downloading side, once a bundle is already published in packs/index.json.
 */
import { $, esc, icon, openSheet, state, toast } from "./core.js?v=8.51";
import { importWorkbookBuffer } from "./library.js?v=8.51";
import { renderAll } from "./main.js?v=8.51";

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

/** The same key tools/pack-convert.mjs uses to match a converted file to the component it replaces, so a
 *  doc installed from a component can be matched back against the catalog to check for updates. */
const componentKey = c => c.kind === "faction" ? `faction:${(c.faction || "").trim().toLowerCase()}` : c.kind === "core" ? "core" : `${c.kind}:${(c.title || "").trim().toLowerCase()}`;

/** Whether a bundle is installed, and whether any of its components has a newer version than what's in
 *  the Library (so the sheet can say "Installed" / "Update" instead of just "Download" every time). */
function bundleStatus(bundle) {
  const installed = state.docs.filter(d => d.pack?.bundleId === bundle.id);
  if (!installed.length) return { have: false, update: false };
  const have = new Map(installed.map(d => [d.pack.componentKey, d.pack.version]));
  const update = bundle.components.some(c => have.get(componentKey(c)) !== (c.version || ""));
  return { have: true, update };
}

function bundleSummary(components) {
  const counts = {};
  for (const c of components) counts[c.kind] = (counts[c.kind] || 0) + 1;
  const parts = [];
  if (counts.core) parts.push("Core Rules");
  if (counts.updates) parts.push(`${counts.updates} Update${counts.updates === 1 ? "" : "s"}`);
  if (counts.missions) parts.push(`${counts.missions} Mission Pack${counts.missions === 1 ? "" : "s"}`);
  if (counts.faction) parts.push(`${counts.faction} Faction${counts.faction === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function packRow(bundle) {
  const { have, update } = bundleStatus(bundle);
  const status = !have ? "" : update ? `<span class="pk-tag pk-tag-new">Update available</span>` : `<span class="pk-tag">Installed</span>`;
  const label = !have ? "Download" : update ? "Update" : "Re-download";
  return `<div class="pk-row" role="button" tabindex="0" data-pk-id="${esc(bundle.id)}" data-pk-get="${esc(bundle.id)}">
    <div class="pk-head">
      <div class="pk-icon">${icon("book")}</div>
      <div class="pk-text"><div class="pk-name">${esc(bundle.title)}${status}</div>
        <div class="pk-meta">${esc([bundle.editionTag, bundleSummary(bundle.components)].filter(Boolean).join(" · "))}</div></div>
      <div class="pk-get" aria-hidden="true">${label}</div>
    </div>
  </div>`;
}

function groupedHTML(bundles) {
  if (!bundles.length) return `<p class="bt-hint">No packs in the catalog yet.</p>`;
  const groups = new Map();
  for (const b of bundles) {
    const key = b.game || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  return [...groups.entries()].map(([title, list]) => `
    <div class="pk-group">
      <h3>${esc(title)}</h3>
      ${list.map(packRow).join("")}
    </div>`).join("");
}

async function openPacksSheet() {
  const d = openSheet(`
    <div class="sheet-head"><h2>Game Packs</h2><p>Ready-made rules and faction data, made by volunteers. Download one to add everything — Core Rules, updates, mission packs and every faction — straight to your Library.</p></div>
    <div class="sheet-body" id="packsBody"><p class="bt-hint">Loading the catalog…</p></div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Cancel</button></div>`, true, "pk-pop");
  const body = $("#packsBody");
  const bundles = await loadCatalog();
  if (!bundles) {
    body.innerHTML = `<p class="bt-hint">Couldn't load the pack catalog (${esc(loadError || "unknown error")}). Check your connection and try again.</p>
      <button type="button" class="btn" id="pkRetry">Try again</button>`;
    $("#pkRetry", body).onclick = async () => { body.innerHTML = `<p class="bt-hint">Loading the catalog…</p>`; const p = await loadCatalog(true); body.innerHTML = p ? groupedHTML(p) : `<p class="bt-hint">Still couldn't reach it.</p>`; };
    return;
  }
  body.innerHTML = groupedHTML(bundles);
  const activate = async row => {
    if (row.classList.contains("busy")) return;
    const bundle = bundles.find(b => b.id === row.dataset.pkGet);
    if (!bundle) return;
    await downloadPack(bundle, row, body);
    d.close();
  };
  d.onclick = e => { const row = e.target.closest("[data-pk-get]"); if (row) activate(row); };
  d.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-pk-get]");
    if (!row) return;
    e.preventDefault();
    activate(row);
  });
}

async function downloadPack(bundle, row, body) {
  row.classList.add("busy");
  const chip = row.querySelector(".pk-get");
  const total = bundle.components.length;
  const failures = [];
  for (let i = 0; i < total; i++) {
    const c = bundle.components[i];
    chip.textContent = `Downloading ${i + 1} of ${total}…`;
    try {
      const res = await fetch(PACKS_BASE + c.file);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = await res.arrayBuffer();
      chip.textContent = `Installing ${i + 1} of ${total}…`;
      await importWorkbookBuffer(buffer, c.file.split("/").pop(), {
        title: c.title,
        faction: c.kind === "faction" ? (c.faction || c.title) : "",
        pack: { bundleId: bundle.id, bundleTitle: bundle.title, componentKey: componentKey(c), version: c.version || "", game: bundle.game || "", editionTag: bundle.editionTag || "" },
      });
    } catch (err) {
      failures.push(`${c.title}: ${err.message || err}`);
    }
  }
  renderAll();
  toast(failures.length ? `${bundle.title}: installed ${total - failures.length} of ${total} (${failures.length} couldn't be installed)` : `${bundle.title} added to your Library`);
  const freshRow = body.querySelector(`[data-pk-id="${CSS.escape(bundle.id)}"]`);
  if (freshRow) freshRow.outerHTML = packRow(bundle);
}

export { openPacksSheet };
