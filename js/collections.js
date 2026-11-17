/* RulesForge · collections.js
 * The Collection page: a panel on the left with one collapsible header per downloaded Game (e.g. "Warhammer 40K"),
 * an edition under it (e.g. "11th Edition"), and under that the collections for that edition, with a
 * "New Collection" button. Picking a collection opens it on the right: add units from that faction, and track
 * each unit's models as Sprue, Assembled and Painted. Collections are saved on this device only.
 */
import { $, confirmSheet, esc, openSheet, state, store, toast } from "./core.js?v=8.71";
import { factionStyle } from "./factions.js?v=8.71";

const KEY = "rf.collections";
let selectedId = null;
const closed = new Set();   // "g:<game>" and "e:<edition id>" headers the user has folded away

// Collections saved by an earlier build have no units list; give them an empty one so they still open.
const collections = () => (store.get(KEY, []) || []).map(c => ({ ...c, units: c.units || [] }));
const saveCollections = list => store.set(KEY, list);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Faction colours and symbol, as the list builder uses them. */
const colourVars = faction => {
  const st = factionStyle(faction);
  return `--c1:${st.c1};--c2:${st.c2}`;
};

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

/* ---------- Units: taken from the faction's datasheets in the Game Pack ---------- */

/** One entry per datasheet of this faction in this edition. Squad sizes and costs come from the datasheet's
 *  unit-cost rows: the smallest squad sets the price per model and the squad range. */
function unitsForFaction(bundleId, faction) {
  const out = new Map();
  for (const d of state.docs) {
    if (d.pack?.bundleId !== bundleId || d.faction !== faction) continue;
    for (const ds of d.structured?.datasheets || []) {
      const rows = (ds.points || []).filter(p => p.models > 0 && p.points >= 0).sort((a, b) => a.models - b.models);
      if (!rows.length || out.has(ds.name)) continue;
      const first = rows[0];
      out.set(ds.name, { n: ds.name, pts: first.points / first.models, rows: rows.map(r => ({ models: r.models, points: r.points })), min: first.models, max: rows[rows.length - 1].models });
    }
  }
  return [...out.values()].sort((a, b) => a.n.localeCompare(b.n));
}

const total = u => u.sprue + u.assembled + u.painted;
const usable = u => u.assembled + u.painted;
/** Points for a unit's models, priced from the Game Pack's unit-cost rows: as many of the largest squad as fit,
 *  then any leftover models at the smallest squad's per-model rate. Units added before rows were stored fall
 *  back to the per-model rate. */
function unitPts(u) {
  const n = total(u);
  if (!u.rows?.length) return n * u.pts;
  let left = n, cost = 0;
  for (const row of [...u.rows].sort((a, b) => b.models - a.models)) {
    const k = Math.floor(left / row.models);
    cost += k * row.points;
    left -= k * row.models;
  }
  return cost + left * u.pts;
}
const collPts = c => c.units.reduce((s, u) => s + unitPts(u), 0);
/** Squads available: A = usable models for full squads, B = usable models for minimum squads. */
function availText(u) {
  const A = Math.floor(usable(u) / u.max), B = Math.floor(usable(u) / u.min);
  if (B <= 1) return String(B);
  return A === B ? String(B) : `${A}–${B}`;
}
const ORDER = ["sprue", "assembled", "painted"];
function takeFromStage(u, n) { for (const k of ORDER) { const d = Math.min(n, u[k]); u[k] -= d; n -= d; if (!n) break; } }
function moveStage(u, k, dir) {
  if (dir === "fwd") {
    if (k === "assembled" && u.sprue > 0) { u.sprue--; u.assembled++; }
    else if (k === "painted") { if (u.sprue > 0) { u.sprue--; u.painted++; } else if (u.assembled > 0) { u.assembled--; u.painted++; } }
  } else {
    if (k === "assembled" && u.assembled > 0) { u.assembled--; u.sprue++; }
    else if (k === "painted" && u.painted > 0) { u.painted--; u.assembled++; }
  }
}
const canFwd = (u, k) => k === "assembled" ? u.sprue > 0 : k === "painted" ? (u.sprue > 0 || u.assembled > 0) : false;
const canBack = (u, k) => k === "assembled" ? u.assembled > 0 : k === "painted" ? u.painted > 0 : false;

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  one: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.6"/><path d="M7.5 21v-7a4.5 4.5 0 0 1 9 0v7"/></svg>',
  three: '<svg viewBox="0 0 24 24"><circle cx="6" cy="8" r="2"/><circle cx="12" cy="6.2" r="2.2"/><circle cx="18" cy="8" r="2"/><path d="M2.5 19v-3.5a3 3 0 0 1 6 0V19M9 19v-6.5a3.3 3.3 0 0 1 6 0V19M15.5 19v-3.5a3 3 0 0 1 6 0V19"/></svg>',
};

function unitHTML(u, faction) {
  const t = total(u);
  const stage = k => `<div class="cm-stage">
      <span class="cm-lbl">${k[0].toUpperCase() + k.slice(1)}</span>
      <button type="button" class="cm-ic" data-uid="${u.id}" data-stage="${k}" data-dir="back" title="Move one model back" ${canBack(u, k) ? "" : "disabled"}>${ICON.minus}</button>
      <span class="cm-n">${u[k]}</span>
      <button type="button" class="cm-ic" data-uid="${u.id}" data-stage="${k}" data-dir="fwd" title="Pull one model in: from Sprue first, then Assembled" ${canFwd(u, k) ? "" : "disabled"}>${ICON.plus}</button>
    </div>`;
  return `<div class="cm-unit" style="${colourVars(faction)}">
    <div class="cm-left">
      <div class="cm-head"><span class="cm-name">${esc(u.n)}</span><button type="button" class="btn plain danger cm-del" data-del="${u.id}">Remove unit</button></div>
      <div class="cm-meta">${unitPts(u)} pts · <b>${availText(u)}</b> squads available</div>
      <div class="cm-squad">
        <div class="cm-side">
          <button type="button" class="cm-ic cm-big" data-uid="${u.id}" data-act="add1" title="Add one model">${ICON.plus}${ICON.one}</button>
          <button type="button" class="cm-ic cm-big" data-uid="${u.id}" data-act="add3" title="Add a minimum squad (${u.min})">${ICON.plus}${ICON.three}</button>
        </div>
        <span class="cm-num">${t}</span>
        <div class="cm-side">
          <button type="button" class="cm-ic cm-big" data-uid="${u.id}" data-act="sub1" title="Remove one model" ${t === 0 ? "disabled" : ""}>${ICON.minus}${ICON.one}</button>
          <button type="button" class="cm-ic cm-big" data-uid="${u.id}" data-act="sub3" title="Remove a minimum squad (${u.min})" ${t === 0 ? "disabled" : ""}>${ICON.minus}${ICON.three}</button>
        </div>
      </div>
    </div>
    <div class="cm-srow">
      <button type="button" class="btn primary cm-allp" data-uid="${u.id}" data-act="allpainted" ${u.sprue + u.assembled === 0 ? "disabled" : ""}>All Painted</button>
      <div class="cm-stages">${stage("sprue")}${stage("assembled")}${stage("painted")}</div>
    </div>
  </div>`;
}

function collectionMainHTML(c) {
  const models = c.units.reduce((s, u) => s + total(u), 0);
  const sum = k => c.units.reduce((s, u) => s + u[k], 0);
  const pct = models ? Math.round(sum("painted") / models * 1000) / 10 : 0;
  const st = factionStyle(c.faction);
  return `
    <div class="cm-banner" style="${colourVars(c.faction)}">
      <div class="cm-banner-text">
        <h2 class="cm-banner-name">${esc(c.faction)}</h2>
        <div class="cm-banner-sub">${esc(c.game)} · ${esc(c.edition)}</div>
      </div>
      ${st.img ? `<img class="cm-banner-mark" src="${esc(st.img)}" alt="">` : ""}
    </div>
    <div class="cm-topbar">
      <button type="button" class="btn primary cm-addbtn" id="cmAddUnit" style="${colourVars(c.faction)};background:var(--c1);border-color:var(--c1)">Add unit</button>
    </div>
    <div class="cm-stats">
      <div class="cm-stat"><b>${collPts(c)}</b><span>Points</span></div>
      <div class="cm-stat"><b>${models}</b><span>Models</span></div>
    </div>
    <div class="cm-progress">
      <div class="cm-pbar"><div class="cm-pfill" style="width:${pct}%"></div></div>
      <div class="cm-plab"><span><b>${sum("sprue")}</b> on Sprue</span><span><b>${sum("assembled")}</b> Assembled</span><span><b>${sum("painted")}</b> Painted</span></div>
    </div>
    ${c.units.length ? c.units.map(u => unitHTML(u, c.faction)).join("") : `<p class="bt-hint">No units yet. Click “Add unit”.</p>`}
    <div class="cm-foot"><button type="button" class="btn plain danger" id="cmDelColl">Delete collection</button></div>`;
}

/* ---------- Panel ---------- */

function editionHTML(e) {
  const items = collections().filter(c => c.bundleId === e.id);
  return `<details class="coll-ed" data-ed="${esc(e.id)}" ${closed.has("e:" + e.id) ? "" : "open"}>
    <summary>${esc(e.edition)}</summary>
    <div class="coll-list">${items.length
      ? items.map(c => `<button type="button" class="coll-item${c.id === selectedId ? " on" : ""}" style="${colourVars(c.faction)}" data-coll="${esc(c.id)}">${esc(c.faction)}</button>`).join("")
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
    ? collectionMainHTML(cur)
    : `<p class="bt-hint">${lib.length ? "Pick a collection on the left, or start a New Collection under an edition." : "Download a Game Pack to start a collection."}</p>`;
}

/* ---------- Pop-ups ---------- */

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
    const item = { id: newId("c"), bundleId: ed.id, game: ed.game, edition: ed.edition, faction, units: [] };
    saveCollections([...collections(), item]);
    selectedId = item.id;
    renderCollections();
  };
}

function openAddUnit() {
  const c = collections().find(x => x.id === selectedId);
  if (!c) return;
  const units = unitsForFaction(c.bundleId, c.faction);
  const d = openSheet(`
    <div class="sheet-head"><h2>Add unit</h2><p>${esc(c.faction)} · ${esc(c.edition)}</p></div>
    <div class="sheet-body cm-addlist">${units.length
      ? units.map((u, i) => `<div class="cm-addrow">
          <div><div class="cm-name">${esc(u.n)}</div><div class="cm-meta">${u.rows.map(r => `${r.models} models ${r.points} pts`).join(" · ")}</div></div>
          <button type="button" class="cm-ic" data-add="${i}" data-m="1" title="Add one model">${ICON.one}</button>
          <button type="button" class="cm-ic" data-add="${i}" data-m="min" title="Add a minimum squad">${ICON.three}</button>
        </div>`).join("")
      : `<p class="bt-hint">No datasheets for this faction were found in the Game Pack.</p>`}</div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Done</button></div>`);
  // Set (not added) so opening this pop-up again doesn't stack a second handler and count each click twice.
  d.onclick = e => {
    const b = e.target.closest("[data-add]");
    if (!b) return;
    const x = units[+b.dataset.add];
    updateCollection(c.id, coll => {
      let u = coll.units.find(y => y.n === x.n);
      if (!u) { u = { id: newId("u"), n: x.n, pts: x.pts, rows: x.rows, min: x.min, max: x.max, sprue: 0, assembled: 0, painted: 0 }; coll.units.push(u); }
      u.sprue += b.dataset.m === "min" ? x.min : 1;
    });
  };
}

/** Applies a change to one collection, saves it, and redraws the panel and the page. */
function updateCollection(id, change) {
  const list = collections();
  const c = list.find(x => x.id === id);
  if (!c) return;
  change(c);
  saveCollections(list);
  renderCollections();
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

  const main = $("#collMain");
  main.addEventListener("click", async e => {
    const cur = selectedId;
    if (e.target.closest("#cmAddUnit")) return openAddUnit();
    if (e.target.closest("#cmDelColl")) {
      if (!(await confirmSheet("Delete this collection?", "Its units and counts are removed from this device.", "Delete"))) return;
      saveCollections(collections().filter(c => c.id !== cur));
      selectedId = null;
      return renderCollections();
    }
    const del = e.target.closest("[data-del]");
    if (del) return updateCollection(cur, c => { c.units = c.units.filter(u => u.id !== del.dataset.del); });
    const b = e.target.closest("button[data-uid]");
    if (!b || b.disabled) return;
    updateCollection(cur, c => {
      const u = c.units.find(x => x.id === b.dataset.uid);
      if (!u) return;
      const act = b.dataset.act;
      if (act === "add1") u.sprue++;
      if (act === "add3") u.sprue += u.min;
      if (act === "sub1") takeFromStage(u, 1);
      if (act === "sub3") takeFromStage(u, u.min);
      if (act === "allpainted") { u.painted += u.sprue + u.assembled; u.sprue = 0; u.assembled = 0; }
      if (b.dataset.stage) moveStage(u, b.dataset.stage, b.dataset.dir);
    });
  });
}
