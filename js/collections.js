/* RulesForge · collections.js
 * The Collection page: a panel on the left with one collapsible header per downloaded Game (e.g. "Warhammer 40K"),
 * an edition under it (e.g. "11th Edition"), and under that the collections for that edition, with a
 * "New Collection" button. New Collection asks which faction of that edition to collect.
 * Collections are saved on this device only.
 */
import { $, esc, openSheet, state, store, toast } from "./core.js?v=8.69";

const KEY = "rf.collections";
let selectedId = null;
const closed = new Set();   // "g:<game>" and "e:<edition id>" headers the user has folded away

const collections = () => store.get(KEY, []) || [];
const saveCollections = list => store.set(KEY, list);

/** Downloaded Game Packs as game → editions. Each downloaded pack is one edition, and its factions come from the
 *  faction documents it installed. */
function library() {
  const games = new Map();
  for (const d of state.docs) {
    const p = d.pack;
    if (!p?.bundleId) continue;
    const game = p.game || p.bundleTitle || "Game";
    const edition = p.editionTag || p.bundleTitle || p.bundleId;
    if (!games.has(game)) games.set(game, new Map());
    const eds = games.get(game);
    if (!eds.has(p.bundleId)) eds.set(p.bundleId, { id: p.bundleId, game, edition, factions: new Set() });
    if (d.faction) eds.get(p.bundleId).factions.add(d.faction);
  }
  return [...games.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([game, eds]) => ({ game, editions: [...eds.values()].map(e => ({ ...e, factions: [...e.factions].sort() })) }));
}

function editionHTML(e) {
  const items = collections().filter(c => c.bundleId === e.id);
  return `<details class="coll-ed" data-ed="${esc(e.id)}" ${closed.has("e:" + e.id) ? "" : "open"}>
    <summary>${esc(e.edition)}</summary>
    <div class="coll-list">${items.length
      ? items.map(c => `<button type="button" class="coll-item${c.id === selectedId ? " on" : ""}" data-coll="${esc(c.id)}">${esc(c.faction)}</button>`).join("")
      : `<p class="bt-hint">No collections yet.</p>`}</div>
    <button type="button" class="btn primary coll-add" data-newcoll="${esc(e.id)}">New Collection</button>
  </details>`;
}

export function renderCollections() {
  const lib = library();
  const list = collections();
  if (selectedId && !list.some(c => c.id === selectedId)) selectedId = null;
  if (!lib.length) {
    $("#collPanel").innerHTML = `<div class="coll-panel-head">Collections</div><p class="bt-hint">Download a Game Pack to start a collection for that game.</p>`;
  } else {
    $("#collPanel").innerHTML = `<div class="coll-panel-head">Collections</div>` + lib.map(g => `
      <details class="coll-game" data-game="${esc(g.game)}" ${closed.has("g:" + g.game) ? "" : "open"}>
        <summary>${esc(g.game)}</summary>
        ${g.editions.map(editionHTML).join("")}
      </details>`).join("");
  }
  const cur = list.find(c => c.id === selectedId);
  $("#collMain").innerHTML = cur
    ? `<h2 class="coll-title">${esc(cur.faction)}</h2><p class="bt-hint">${esc(cur.game)} · ${esc(cur.edition)}. Units are coming soon.</p>`
    : `<p class="bt-hint">${lib.length ? "Pick a collection on the left, or start a New Collection under an edition." : "Download a Game Pack to start a collection."}</p>`;
}

function openNewCollection(bundleId) {
  const ed = library().flatMap(g => g.editions).find(e => e.id === bundleId);
  if (!ed) return;
  const has = ed.factions.length > 0;
  const d = openSheet(`
    <div class="sheet-head"><h2>New Collection</h2><p>${has ? `${esc(ed.game)} · ${esc(ed.edition)}` : "This Game Pack has no factions yet."}</p></div>
    <div class="sheet-body">
      <label class="coll-field">Faction
        <select class="select" id="collFaction" ${has ? "" : "disabled"}>${ed.factions.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}</select>
      </label>
    </div>
    <div class="sheet-foot coll-foot">
      <button class="btn" type="button" id="collCancel" style="background:var(--red);border-color:var(--red);color:#fff">Cancel</button>
      <button class="btn primary" type="button" id="collConfirm" ${has ? "" : "disabled"}>Confirm</button>
    </div>`);
  d.querySelector("#collCancel").onclick = () => d.close();
  d.querySelector("#collConfirm").onclick = () => {
    const faction = d.querySelector("#collFaction").value;
    const existing = collections().find(c => c.bundleId === ed.id && c.faction === faction);
    d.close();
    if (existing) { selectedId = existing.id; toast(`${faction} is already in your collections`); renderCollections(); return; }
    const item = { id: "c" + Date.now().toString(36), bundleId: ed.id, game: ed.game, edition: ed.edition, faction };
    saveCollections([...collections(), item]);
    selectedId = item.id;
    renderCollections();
  };
}

export function wireCollections() {
  const panel = $("#collPanel");
  // Remember which headers are folded, so re-rendering doesn't open them again.
  panel.addEventListener("toggle", e => {
    const d = e.target;
    const key = d.classList.contains("coll-game") ? "g:" + d.dataset.game : d.classList.contains("coll-ed") ? "e:" + d.dataset.ed : null;
    if (!key) return;
    if (d.open) closed.delete(key); else closed.add(key);
  }, true);
  panel.addEventListener("click", e => {
    const add = e.target.closest("[data-newcoll]");
    if (add) return openNewCollection(add.dataset.newcoll);
    const item = e.target.closest("[data-coll]");
    if (item) { selectedId = item.dataset.coll; renderCollections(); }
  });
}
