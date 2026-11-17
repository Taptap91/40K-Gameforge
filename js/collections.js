/* RulesForge · collections.js
 * The Collection page: a rail of downloaded Games (tablet and desktop), the editions and collections for the chosen
 * game beside it, with a "New Collection" button. On a phone the rail becomes a switcher above the bottom bar, and
 * the page swipes between games. Picking a collection opens it on the right: add units from that faction, and track
 * each unit's models as Sprue, Assembled and Painted. Collections are saved on this device only.
 */
import { $, confirmSheet, esc, openPopMenu, openSheet, state, store, toast } from "./core.js?v=8.74";
import { factionStyle } from "./factions.js?v=8.74";

const KEY = "rf.collections";
let selectedId = null;

// Collections saved by an earlier build have no units list; give them an empty one so they still open.
const collections = () => (store.get(KEY, []) || []).map(c => ({ ...c, units: c.units || [] }));
const saveCollections = list => store.set(KEY, list);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Faction colours and symbol, as the list builder uses them. */
const colourVars = faction => {
  const st = factionStyle(faction || "");
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
    <div class="cm-stats">
      <div class="cm-stat"><b>${collPts(c)}</b><span>Points</span></div>
      <div class="cm-stat"><b>${models}</b><span>Models</span></div>
      <button type="button" class="btn primary cm-addbtn" id="cmAddUnit" style="${colourVars(c.faction)};background:var(--c1);border-color:var(--c1)">Add unit</button>
      <button type="button" class="btn cm-kebab" data-cm-menu="${esc(c.id)}" title="More" aria-label="More options" aria-haspopup="menu"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg></button>
    </div>
    <div class="cm-progress">
      <div class="cm-pbar"><div class="cm-pfill" style="width:${pct}%"></div></div>
      <div class="cm-plab"><span><b>${sum("sprue")}</b> on Sprue</span><span><b>${sum("assembled")}</b> Assembled</span><span><b>${sum("painted")}</b> Painted</span></div>
    </div>
    ${c.units.length ? c.units.map(u => unitHTML(u, c.faction)).join("") : `<p class="bt-hint">No units yet. Click “Add unit”.</p>`}
    `;
}

/* ---------- Navigation: a game rail beside the editions and collections (tablet and desktop); on a phone, a switcher
   above the bottom bar, where the page also swipes between games ---------- */

const GAME_KEY = "rf.collGame";
let selGame = store.get(GAME_KEY, null);   // the game the navigation is showing
const selEd = new Map();                    // game -> the edition picked for it last
let switchOpen = false;                     // phone: the game list above the switcher is open
let railDrilled = false;                    // desktop and tablet: the rail shows one game's editions and collections
const phoneLayout = () => matchMedia("(max-width: 700px)").matches;

/** A short label for the tablet rail: the number in the name ("40K"), or the initials ("KT" for Kill Team). */
function shortName(game) {
  const num = game.match(/\d+\w*/);
  if (num) return num[0];
  const words = game.split(/\s+/).filter(w => !/^(of|the|and)$/i.test(w));
  return words.map(w => w[0]).join("").toUpperCase() || game.slice(0, 3);
}

/** The game and edition being shown. The first game is the default; the last game picked is remembered. */
function current(lib) {
  const g = lib.find(x => x.game === selGame) || lib[0];
  if (!g) return { g: null, ed: null };
  selGame = g.game;
  const ed = g.editions.find(e => e.id === selEd.get(g.game)) || g.editions[0];
  selEd.set(g.game, ed.id);
  return { g, ed };
}

function railHTML(lib, g) {
  return lib.map(x => `<button type="button" class="coll-rail-item${x === g ? " on" : ""}" data-game="${esc(x.game)}" title="${esc(x.game)}">
      <span class="rl-long">${esc(x.game)}</span><span class="rl-short">${esc(shortName(x.game))}</span>
    </button>`).join("") + `<button type="button" class="coll-rail-add" data-go="factions">+ Add game pack</button>`;
}

/** Desktop and tablet: one game's editions as a toggle, then its collections and New Collection, under a back arrow. */
function drillHTML(g, ed, list) {
  if (!g) return "";
  const items = list.filter(c => c.bundleId === ed.id);
  const toggle = g.editions.length > 1
    ? `<div class="coll-seg" role="group" aria-label="Edition">${g.editions.map(e => `<button type="button" class="${e === ed ? "on" : ""}" data-ed="${esc(e.id)}" aria-pressed="${e === ed}">${esc(e.edition.replace(/\s*edition$/i, ""))}</button>`).join("")}</div>`
    : `<div class="coll-edition">${esc(ed.edition)}</div>`;
  return `<div class="cr-head"><button type="button" class="cr-back" data-rail-back aria-label="Back to games">&#8592;</button><span class="cr-title rl-long">${esc(g.game)}</span><span class="cr-title rl-short">${esc(shortName(g.game))}</span></div>
    ${toggle}
    <div class="coll-list">${items.length
      ? items.map(c => `<button type="button" class="coll-item${c.id === selectedId ? " on" : ""}" style="${colourVars(c.faction)}" data-coll="${esc(c.id)}">${esc(c.faction)}</button>`).join("")
      : `<p class="bt-hint">No collections yet.</p>`}</div>
    <button type="button" class="btn primary coll-add" data-newcoll="${esc(ed.id)}">New Collection</button>`;
}

/** The editions for the game (as chips when there's more than one), then its collections and New Collection. */
function panelHTML(g, ed, list) {
  if (!g) return `<p class="bt-hint">Download a Game Pack to start a collection for that game.</p>`;
  const items = list.filter(c => c.bundleId === ed.id);
  const eds = g.editions.length > 1
    ? `<div class="coll-chips">${g.editions.map(e => `<button type="button" class="coll-chip${e === ed ? " on" : ""}" data-ed="${esc(e.id)}">${esc(e.edition)}</button>`).join("")}</div>`
    : `<div class="coll-edition">${esc(ed.edition)}</div>`;
  return `<div class="coll-panel-head">${esc(g.game)}</div>${eds}
    <div class="coll-list">${items.length
      ? items.map(c => `<button type="button" class="coll-item${c.id === selectedId ? " on" : ""}" style="${colourVars(c.faction)}" data-coll="${esc(c.id)}">${esc(c.faction)}</button>`).join("")
      : `<p class="bt-hint">No collections yet.</p>`}</div>
    <button type="button" class="btn primary coll-add" data-newcoll="${esc(ed.id)}">New Collection</button>`;
}

/** The phone switcher: arrows either side of the game name, with every game above it when the list is open. */
function switchHTML(lib, g) {
  if (!g) return "";
  const i = lib.indexOf(g);
  const opts = [...lib.filter(x => x !== g), g]
    .map(x => `<button type="button" class="cs-opt${x === g ? " cs-cur" : ""}" data-pick-game="${esc(x.game)}">${esc(x.game)}</button>`).join("");
  return `<div class="cs-list" ${switchOpen ? "" : "hidden"}>${opts}</div>
    <div class="cs-bar">
      <button type="button" class="cs-arrow" data-cs-step="-1" aria-label="Previous game" ${i <= 0 ? "disabled" : ""}>&#8249;</button>
      <button type="button" class="cs-name" data-cs-toggle aria-expanded="${switchOpen}">${esc(g.game)}</button>
      <button type="button" class="cs-arrow" data-cs-step="1" aria-label="Next game" ${i >= lib.length - 1 ? "disabled" : ""}>&#8250;</button>
    </div>`;
}

function renderSwitchOnly() {
  const lib = library();
  $("#collSwitch").innerHTML = switchHTML(lib, current(lib).g);
}

/** Hides the phone switcher below the screen, or brings it back. Closing it also folds the game list. */
function setSwitchHidden(on) {
  if (on && switchOpen) { switchOpen = false; renderSwitchOnly(); }
  $("#collSwitch").classList.toggle("cs-hidden", on);
}

function pickGame(game) {
  selGame = game;
  store.set(GAME_KEY, game);
  selectedId = null;
  switchOpen = false;
  renderCollections();
}

function stepGame(dir) {
  const lib = library();
  const i = lib.findIndex(x => x.game === selGame);
  if (i >= 0 && lib[i + dir]) pickGame(lib[i + dir].game);
}

export function renderCollections() {
  const lib = library();
  const list = collections();
  if (selectedId && !list.some(c => c.id === selectedId)) selectedId = null;
  const { g, ed } = current(lib);
  if (!g) switchOpen = false;
  // The rail's two parts are kept in the page, so sliding between them animates instead of snapping.
  $("#crGames").innerHTML = railHTML(lib, g);
  $("#crDrill").innerHTML = drillHTML(g, ed, list);
  $("#collRail").classList.toggle("cr-drilled", railDrilled && !!g);
  $("#crFloat").innerHTML = g ? `<span class="rl-long">${esc(g.game)}</span><span class="rl-short">${esc(shortName(g.game))}</span>` : "";
  placeRailTitle();
  $("#collPanel").innerHTML = panelHTML(g, ed, list);
  $("#collSwitch").innerHTML = switchHTML(lib, g);
  const cur = list.find(c => c.id === selectedId);
  $("#collMain").innerHTML = cur
    ? collectionMainHTML(cur)
    : `<p class="bt-hint">${lib.length ? "Pick a collection, or start a New Collection for this edition." : "Download a Game Pack to start a collection."}</p>`;
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

/** Moves the game name between its row in the game list and its place beside the back arrow. The name is one
 *  element, so it glides into the header instead of sliding away with the list. */
function placeRailTitle() {
  const f = document.getElementById("crFloat");
  if (!f || !f.innerHTML) return;
  const drilled = document.getElementById("collRail").classList.contains("cr-drilled");
  const visible = el => el && el.offsetParent !== null;
  const head = [...document.querySelectorAll("#crDrill .cr-title")].find(visible);
  const row = document.querySelector("#crGames .coll-rail-item.on");
  let box = null;
  if (drilled && head) box = { left: head.offsetLeft, top: head.offsetTop, width: head.offsetWidth, height: head.offsetHeight, pad: 0 };
  else if (!drilled && row) box = { left: row.offsetLeft, top: row.offsetTop, width: row.offsetWidth, height: row.offsetHeight, pad: parseFloat(getComputedStyle(row).paddingLeft) };
  if (!box) return;
  // The first placement is a jump, not a glide from the corner.
  const first = !f.style.top;
  if (first) f.style.transition = "none";
  Object.assign(f.style, { left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px", paddingLeft: box.pad + "px" });
  if (first) { void f.offsetHeight; f.style.transition = ""; }
}

/** Taps on the editions, collections and New Collection, from either the rail or the panel. */
function listClick(e) {
  const add = e.target.closest("[data-newcoll]");
  if (add) return openNewCollection(add.dataset.newcoll);
  const ed = e.target.closest("[data-ed]");
  if (ed) { selEd.set(selGame, ed.dataset.ed); selectedId = null; return renderCollections(); }
  const item = e.target.closest("[data-coll]");
  if (item) { selectedId = item.dataset.coll; renderCollections(); }
}

export function wireCollections() {
  window.addEventListener("resize", placeRailTitle);
  $("#collPanel").addEventListener("click", listClick);
  $("#collRail").addEventListener("click", e => {
    if (e.target.closest("[data-rail-back]")) { railDrilled = false; return renderCollections(); }
    const g = e.target.closest("[data-game]");
    if (g) { railDrilled = true; return pickGame(g.dataset.game); }
    listClick(e);
  });

  const view = $("#view-collection");
  // The phone switcher stops its own taps here, so the outside-tap check below never sees a button that was just redrawn.
  $("#collSwitch").addEventListener("click", e => {
    e.stopPropagation();
    const step = e.target.closest("[data-cs-step]");
    if (step) return stepGame(+step.dataset.csStep);
    if (e.target.closest("[data-cs-toggle]")) { switchOpen = !switchOpen; return renderSwitchOnly(); }
    const pick = e.target.closest("[data-pick-game]");
    if (pick) pickGame(pick.dataset.pickGame);
  });
  // On a phone, a swipe left or right changes game. Swipes that start in a row that scrolls sideways are left alone.
  let touch = null;
  view.addEventListener("touchstart", e => {
    const t = e.touches[0];
    touch = e.target.closest(".coll-list, .coll-chips, #collSwitch") ? null : { x: t.clientX, y: t.clientY };
  }, { passive: true });
  view.addEventListener("touchend", e => {
    if (!touch || !phoneLayout()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepGame(dx < 0 ? 1 : -1);
  }, { passive: true });
  // The phone switcher slides away while the page scrolls down, and returns on scrolling up or a tap on the bottom bar.
  let lastY = 0;
  view.addEventListener("scroll", e => {
    const y = e.target.scrollTop || 0;
    if (y > lastY + 6 && y > 40) setSwitchHidden(true);
    else if (y < lastY - 6) setSwitchHidden(false);
    lastY = y;
  }, true);
  $(".sidebar").addEventListener("click", () => setSwitchHidden(false));

  const main = $("#collMain");
  // The ⋮ menu is attached to the page, outside the main area, so its Delete button is handled here.
  view.addEventListener("click", async e => {
    if (switchOpen && !e.target.closest("#collSwitch")) { switchOpen = false; renderSwitchOnly(); }
    const del = e.target.closest("[data-cm-delete]");
    if (!del) return;
    const id = del.dataset.cmDelete;
    if (!(await confirmSheet("Delete this collection?", "Its units and counts are removed from this device.", "Delete"))) return;
    saveCollections(collections().filter(c => c.id !== id));
    if (selectedId === id) selectedId = null;
    renderCollections();
  });

  main.addEventListener("click", e => {
    const cur = selectedId;
    if (e.target.closest("#cmAddUnit")) return openAddUnit();
    const menu = e.target.closest("[data-cm-menu]");
    if (menu) return openPopMenu(menu, "cm:" + menu.dataset.cmMenu, `<button type="button" role="menuitem" class="danger" data-cm-delete="${esc(menu.dataset.cmMenu)}">Delete collection</button>`);
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
