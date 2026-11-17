/* RulesForge · packs.js
 * Game Packs: a catalog of ready-made rules/faction data, built by volunteers and downloaded straight into
 * the Library — no PDF, no AI parsing wait, no in-app upload. Each catalog entry is a bundle (e.g.
 * "Warhammer 40K - 11th Edition") made up of several components — Core Rules, updates, mission packs, and
 * every faction — and downloading it installs every component in one go. A volunteer contributes a
 * component by pushing a PDF to packs/incoming/ on GitHub (see packs/incoming/README.md); a GitHub Actions
 * workflow converts it into the .xlsx this module downloads and slots into the right bundle. This module
 * only handles the browsing/downloading side, once a bundle is already published in packs/index.json.
 */
import { $, esc, icon, openSheet, state, toast } from "./core.js?v=8.72";
import { importWorkbookBuffer } from "./library.js?v=8.72";
import { renderAll } from "./main.js?v=8.72";

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
 *  the Library (so the sheet can say "Installed" / "Update" instead of just "Download" every time). `have`
 *  maps each installed component's key to the version the user has, so an update can tell a missing
 *  component (never installed) apart from a changed one (installed but out of date) and leave an
 *  up-to-date component untouched. */
function bundleStatus(bundle) {
  const installed = state.docs.filter(d => d.pack?.bundleId === bundle.id);
  const have = new Map(installed.map(d => [d.pack.componentKey, d.pack.version]));
  if (!installed.length) return { have: false, update: false, haveMap: have };
  const update = bundle.components.some(c => have.get(componentKey(c)) !== (c.version || ""));
  return { have: true, update, haveMap: have };
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
  // Nothing installed yet: a plain download, same as "update" (every component is new). Already installed
  // and current: offer a full "Re-download" that replaces every file. Already installed with something
  // stale: "Update" touches only what's missing or changed, leaving up-to-date files alone.
  const mode = !have ? "update" : update ? "update" : "redownload";
  const label = !have ? "Download" : update ? "Update" : "Re-download";
  return `<div class="pk-row" role="button" tabindex="0" data-pk-id="${esc(bundle.id)}" data-pk-get="${esc(bundle.id)}" data-pk-mode="${mode}">
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
  // Always fetch fresh (bypassing any cached copy, in memory or in the browser's HTTP cache) rather than
  // reusing whatever was loaded earlier in the session — a volunteer's new or updated file on GitHub
  // should show up next time this sheet opens, not only after a full page reload.
  const bundles = await loadCatalog(true);
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
    await downloadPack(bundle, row, body, row.dataset.pkMode === "redownload" ? "redownload" : "update");
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

/** mode "redownload" replaces every component in the bundle, same as a first-time download. mode "update"
 *  only fetches components that are missing or whose catalog version differs from what's installed —
 *  anything already matching the catalog is left alone (and not even fetched). */
async function downloadPack(bundle, row, body, mode = "update") {
  row?.classList.add("busy");
  const chip = row?.querySelector(".pk-get") || { textContent: "" };   // opened from a Game Pack's menu there's no row to show progress on
  const { haveMap } = bundleStatus(bundle);
  const toFetch = mode === "redownload" ? bundle.components
    : bundle.components.filter(c => haveMap.get(componentKey(c)) !== (c.version || ""));
  const skipped = bundle.components.length - toFetch.length;
  if (!toFetch.length) {
    row?.classList.remove("busy");
    toast(`${bundle.title} is already up to date`);
    return;
  }
  const total = toFetch.length;
  const failures = [];
  for (let i = 0; i < total; i++) {
    const c = toFetch[i];
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
  const installedCount = total - failures.length;
  const skippedNote = skipped ? ` (${skipped} already up to date)` : "";
  toast(failures.length ? `${bundle.title}: installed ${installedCount} of ${total}${skippedNote} (${failures.length} couldn't be installed)`
    : mode === "update" ? `${bundle.title}: updated ${installedCount} file${installedCount === 1 ? "" : "s"}${skippedNote}`
    : `${bundle.title} added to your Library`);
  const freshRow = body?.querySelector(`[data-pk-id="${CSS.escape(bundle.id)}"]`);
  if (freshRow) freshRow.outerHTML = packRow(bundle);
}

/** For a Game Pack's menu: looks the bundle up in the live catalog and says whether it has files the
 *  user doesn't have yet (or newer versions of ones they do). null when the catalog can't be reached. */
async function checkBundle(bundleId) {
  const bundles = await loadCatalog(true);
  const bundle = bundles?.find(b => b.id === bundleId);
  return bundle ? { bundle, update: bundleStatus(bundle).update } : null;
}

/** Menu action: "Update" fetches only what's new or changed, "Re-download" replaces every file. */
async function refreshBundle(bundleId) {
  toast("Checking for the latest files…");
  const found = await checkBundle(bundleId);
  if (!found) { toast(`Couldn't reach the Game Pack catalog${loadError ? ` (${loadError})` : ""}. Check your connection and try again.`); return; }
  await downloadPack(found.bundle, null, null, found.update ? "update" : "redownload");
}

export { checkBundle, openPacksSheet, refreshBundle };
