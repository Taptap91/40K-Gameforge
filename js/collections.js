/* RulesForge · collections.js
 * The Collection page: a panel on the left with the user's collections (one per downloaded Game Pack) and an
 * "Add Collection" button. Adding one opens a pop-up that asks which downloaded Game Pack it's for.
 * Collections are saved on this device only.
 */
import { $, esc, openSheet, state, store } from "./core.js?v=8.68";

const KEY = "rf.collections";
let selectedId = null;

const collections = () => store.get(KEY, []) || [];
const saveCollections = list => store.set(KEY, list);

/** The Game Packs the user has downloaded, one entry per pack (taken from the documents it installed). */
function downloadedPacks() {
  const byId = new Map();
  for (const d of state.docs) {
    const p = d.pack;
    if (!p?.bundleId || byId.has(p.bundleId)) continue;
    byId.set(p.bundleId, { id: p.bundleId, title: p.bundleTitle || p.bundleId });
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function renderCollections() {
  const list = collections();
  if (selectedId && !list.some(c => c.id === selectedId)) selectedId = null;
  $("#collPanel").innerHTML = `
    <div class="coll-panel-head">Collections</div>
    <div class="coll-list">${list.length
      ? list.map(c => `<button type="button" class="coll-item${c.id === selectedId ? " on" : ""}" data-coll="${esc(c.id)}">${esc(c.title)}</button>`).join("")
      : `<p class="bt-hint">No collections yet.</p>`}</div>
    <button type="button" class="btn primary coll-add" id="addCollection">Add Collection</button>`;
  const cur = list.find(c => c.id === selectedId);
  $("#collMain").innerHTML = cur
    ? `<h2 class="coll-title">${esc(cur.title)}</h2><p class="bt-hint">Units are coming soon.</p>`
    : `<p class="bt-hint">Add a collection, or pick one on the left.</p>`;
}

function openAddCollection() {
  const packs = downloadedPacks();
  const has = packs.length > 0;
  const d = openSheet(`
    <div class="sheet-head"><h2>Add Collection</h2><p>${has ? "Choose the Game Pack this collection is for." : "No Game Packs downloaded yet. Download one from Game Packs first."}</p></div>
    <div class="sheet-body">
      <label class="coll-field">Game Pack
        <select class="select" id="collPack" ${has ? "" : "disabled"}>${packs.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}</select>
      </label>
    </div>
    <div class="sheet-foot coll-foot">
      <button class="btn" type="button" id="collCancel" style="background:var(--red);border-color:var(--red);color:#fff">Cancel</button>
      <button class="btn primary" type="button" id="collConfirm" ${has ? "" : "disabled"}>Confirm</button>
    </div>`);
  d.querySelector("#collCancel").onclick = () => d.close();
  d.querySelector("#collConfirm").onclick = () => {
    const pack = packs.find(p => p.id === d.querySelector("#collPack").value);
    if (!pack) return;
    const item = { id: "c" + Date.now().toString(36), bundleId: pack.id, title: pack.title };
    saveCollections([...collections(), item]);
    selectedId = item.id;
    d.close();
    renderCollections();
  };
}

export function wireCollections() {
  $("#collPanel").addEventListener("click", e => {
    if (e.target.closest("#addCollection")) return openAddCollection();
    const item = e.target.closest("[data-coll]");
    if (item) { selectedId = item.dataset.coll; renderCollections(); }
  });
}
