/* RulesForge · battle/tracker.js
 * The battle tracker, shown after "Begin Battle": the round, the phase of whoever's turn it is, and each player's
 * score (Battle Ready 10VP + Primary + Secondary), Primary and Secondary trackers, and Command Points.
 * When the two phones are synced, every change shows on both.
 *
 * The app's menu bar is hidden here; instead two buttons along the bottom open each player's army (yours to the left,
 * your opponent's to the right; swipe to move between them). Tapping a unit shows its datasheet as it's equipped.
 */
import { esc, openSheet, state, store } from "../js/core.js?v=8.5";
import { factionStyle } from "../js/factions.js?v=8.5";
import { armyData, evaluateList } from "../js/army.js?v=8.5";
import { armyRuleParts, datasheetDetailsHTML, factionArmyRules, panelHTML, statsHTML, weaponGridHTML } from "../js/datasheets.js?v=8.5";
import { effectiveRules } from "../js/rules-doc.js?v=8.5";
import { buffsFor, weaponBase } from "../js/loadout.js?v=8.5";
import { richHTML } from "../js/text.js?v=8.5";

const PHASES = [["Command", "CMD"], ["Movement", "MOVE"], ["Shooting", "SHO"], ["Charge", "CHG"], ["Fight", "FGT"], ["End", "END"]];
const MAX = 45;
const FLIP = { you: "opponent", opponent: "you" };
const PANES = ["me", "tracker", "them"];

let B = store.get("rf.currentBattle", null);
/* The two armies (kept on this phone only): your list's id, and your opponent's list with their faction's rules. */
let A = store.get("rf.battleArmies", { me: null, them: null });
let sendToPeer = () => {};
let pane = "tracker", sheet = null;   // which screen, and the unit whose datasheet is open there ({ side, id })
const save = () => store.set("rf.currentBattle", B);
const saveArmies = () => { try { localStorage.setItem("rf.battleArmies", JSON.stringify(A)); } catch { /* the opponent's rules stay in memory only */ } };

/** A new battle from the finished setup. */
function newBattle({ me, them, firstTurn }) {
  const player = p => ({ name: p.name || "", faction: p.faction || "", battleReady: !!p.battleReady, primary: 0, secondary: 0, cp: 0, army: p.army || "" });
  B = { active: true, started: Date.now(), updated: Date.now(), round: 1, phase: 0, turn: firstTurn === "opponent" ? "opponent" : "you", first: firstTurn === "opponent" ? "opponent" : "you", me: player(me), them: player(them) };
  pane = "tracker"; sheet = null;
  save();
  return B;
}
/** The same battle seen from the other phone: "me" and "them" swap, and so does whose turn it is. */
const mirror = b => b && { ...b, me: b.them, them: b.me, turn: FLIP[b.turn], first: FLIP[b.first] };

const score = p => (p.battleReady ? 10 : 0) + (+p.primary || 0) + (+p.secondary || 0);
const pad = n => String(n).padStart(2, "0");
/* A faction's brighter colour, so a very dark faction (Black Templars) still shows its score clearly. */
const lum = hex => { const v = parseInt(String(hex).slice(1), 16) || 0; return ((v >> 16) & 255) * .299 + ((v >> 8) & 255) * .587 + (v & 255) * .114; };
const bright = st => lum(st.c1) >= lum(st.c2) || lum(st.c1) > 90 ? st.c1 : st.c2;

/* ---------- stratagems, army rules and detachment rules ---------- */
/* Which boxes under the tracker are open, and which stratagems are expanded (on this phone only). */
const openBoxes = new Set(), openStrats = new Set();
let lastStrats = { me: [], them: [] };   // the lists as last drawn, so a tap finds its stratagem

/* The turn-and-phase a stratagem can be used in. Read from its first clause: "Your Charge phase" (own turn),
   "Your opponent's Shooting phase" (the other player's turn), "Any phase" (either). A phase named without a
   qualifier ("the Fight phase") can be used in either turn. Without a WHEN line, it can be used in any phase. */
const PHASE_NAMES = PHASES.map(p => p[0]);
function timingOf(text) {
  const when = /WHEN:\s*([^\n]*)/i.exec(String(text || ""))?.[1];
  if (!when) return [{ phase: "*", turn: "either" }];
  const clause = when.split(/[,;]/)[0];
  if (/\bany phase\b/i.test(clause)) return [{ phase: "*", turn: "either" }];
  const out = [];
  for (const piece of clause.split(/\s+or\s+|\s+and\s+/i)) {
    const phase = PHASE_NAMES.find(n => new RegExp(`\\b${n}\\s+(?:phase|step)\\b`, "i").test(piece));
    if (!phase) continue;
    out.push({ phase, turn: /opponent/i.test(piece) ? "opponent" : /\byour\b/i.test(piece) ? "own" : "either" });
  }
  return out.length ? out : [{ phase: "*", turn: "either" }];
}
const costsOf = cp => [...new Set([...String(cp || "").matchAll(/\d+/g)].map(m => +m[0]))].sort((a, b) => a - b);
/* Usage resets with each phase: the key is the round, whose turn (first player or not) and phase. The first player is
   the same on both phones, so a stratagem used here shows as used on the other phone too. */
const sigOf = b => `${b.round}.${b.turn === b.first ? 0 : 1}.${b.phase}`;
const usedKeys = p => (p?.used?.sig === sigOf(B) ? p.used.keys : []);
/* Can this stratagem be used now? Its owner's own turn, or the other player's, and the current phase. */
function inWindow(s) {
  const phase = PHASE_NAMES[B.phase];
  const ownerTurn = s.owner === "me" ? B.turn === "you" : B.turn === "opponent";
  return s.timing.some(e => (e.phase === "*" || e.phase === phase) && (e.turn === "either" || (e.turn === "own") === ownerTurn));
}

/** Core stratagems (the Core Rules' Stratagems chapter, when they're in the Library) and the army's detachment stratagems. */
function coreStratagems() {
  return effectiveRules().sections
    .filter(s => /stratagem/i.test(s.chapter || "") && /\d/.test(String(s.cp || "")))
    .map(s => ({ name: s.title, cp: s.cp, text: s.text, rich: s.rich, group: "Core" }));
}
function strategyList(side, army) {
  const dets = army ? army.data.detachments.filter(d => (army.list.detachments || []).includes(d.name)) : [];
  const all = [...coreStratagems(), ...dets.flatMap(d => (d.det.stratagems || []).map(s => ({ ...s, group: d.name })))];
  return all.map(s => ({
    owner: side, name: s.name, group: s.group,
    // The key marks a stratagem as used: the same on both phones, whichever side they're seen from. The id is for this screen.
    key: `${s.group}|${s.name}`, id: `${side}|${s.group}|${s.name}`,
    cp: String(s.cp || "").replace(/(\d+)\s*CP/gi, "$1 CP"), costs: costsOf(s.cp).length ? costsOf(s.cp) : [0],
    body: (s.rich || s.text || "").replace(/^\**CORE STRATAGEM\**\s*/i, ""), timing: timingOf(s.text || s.rich),
  }));
}

/* ---------- the tracker ---------- */
function column(p, who, fallback) {
  const st = factionStyle(p.faction || "");
  return `<div class="bt-col" style="--fc:${bright(st)};--c1:${st.c1};--c2:${st.c2}">
    <div class="bt-card">
      <div class="bt-pname">${esc(p.name || fallback)}</div>
      <div class="bt-vp"><b>${pad(score(p))}</b><span>VP</span></div>
      <div class="bt-tlabel">Primary</div><div class="bt-track">${pad(p.primary)}<span>/${MAX}</span></div>
      <div class="bt-tlabel">Secondary</div><div class="bt-track">${pad(p.secondary)}<span>/${MAX}</span></div>
    </div>
    <div class="bt-tlabel">Command Points</div><div class="bt-track bt-cp">${p.cp}<span> CP</span></div>
    <div class="bt-cpbtns"><button type="button" class="bt-cpbtn" data-bt-cp="${who}" data-d="-1" aria-label="One fewer Command Point for ${esc(p.name || fallback)}" ${p.cp <= 0 ? "disabled" : ""}>−</button><button type="button" class="bt-cpbtn" data-bt-cp="${who}" data-d="1" aria-label="One more Command Point for ${esc(p.name || fallback)}">+</button></div>
    <div class="bt-ready ${p.battleReady ? "yes" : "no"}">${p.battleReady ? "✓" : "✕"} Battle-Ready +10VP</div>
  </div>`;
}
/** One stratagem: its name and cost on the left, a Use button on the right (for your own). A tap on the row opens its text. */
function stratRow(s, p, mine) {
  const used = usedKeys(p).includes(s.key);
  const can = mine && !used && p.cp >= s.costs[0];
  return `<div class="bt-strat${mine && !can ? " dim" : ""}${used ? " used" : ""}">
    <div class="bt-srow" data-bt-strat="${esc(s.id)}" role="button" tabindex="0" aria-expanded="${openStrats.has(s.id)}">
      <div class="bt-stext"><b>${esc(s.name)}</b><span>${esc(s.cp)} · ${esc(s.group)}</span></div>
      ${mine ? `<button type="button" class="bt-use" data-bt-use="${esc(s.key)}" ${can ? "" : "disabled"}>${used ? "Used" : "Use"}</button>` : used ? `<span class="bt-tag">Used</span>` : ""}
    </div>
    ${openStrats.has(s.id) ? `<div class="bt-sdetail fv-rich">${richHTML(s.body)}</div>` : ""}
  </div>`;
}
/** A box that opens and closes; its header is always there. */
function boxHTML(id, title, count, body) {
  const open = openBoxes.has(id);
  return `<section class="bt-box${open ? " open" : ""}">
    <button type="button" class="bt-boxhead" data-bt-box="${id}" aria-expanded="${open}"><b>${esc(title)}</b>${count ? `<span class="bt-count">${esc(count)}</span>` : ""}<span class="bt-chev" aria-hidden="true">⌄</span></button>
    ${open ? `<div class="bt-boxbody">${body}</div>` : ""}
  </section>`;
}
const ruleBlock = (name, text) => `<div class="bt-rule"><b>${esc(name)}</b><div class="fv-rich">${richHTML(text)}</div></div>`;
/** The boxes under the two columns: Stratagems (yours, usable now), Opponent's Stratagems, Army Rules, Detachment Rules. */
function boxesHTML(armies) {
  const mine = lastStrats.me.filter(inWindow), theirs = lastStrats.them.filter(inWindow);
  const usable = mine.filter(s => !usedKeys(B.me).includes(s.key) && B.me.cp >= s.costs[0]).length;
  const phase = PHASE_NAMES[B.phase];
  const stratBody = mine.length ? mine.map(s => stratRow(s, B.me, true)).join("") : `<p class="bt-hint">No stratagem of yours can be used in the ${phase} phase.</p>`;
  const theirBody = theirs.length ? theirs.map(s => stratRow(s, B.them, false)).join("") : `<p class="bt-hint">Your opponent can't use a stratagem in the ${phase} phase.</p>`;
  const army = armies.me;
  const armyRules = army?.armyRules || [];
  const tops = armyRules.filter(r => !r.partOf);
  const armyBody = tops.length
    ? tops.map(r => ruleBlock(r.name, r.rich || r.text) + armyRuleParts(r, armyRules).map(p => `<div class="bt-rule bt-sub"><b>${esc(p.name)}</b><div class="fv-rich">${richHTML(p.rich || p.text)}</div></div>`).join("")).join("")
    : `<p class="bt-hint">${army ? "This army's rules aren't in the Library." : "Your army list isn't on this device."}</p>`;
  const dets = army ? army.data.detachments.filter(d => (army.list.detachments || []).includes(d.name)) : [];
  const detBody = dets.length
    ? dets.map(d => `<div class="bt-det"><h4>${esc(d.name)}</h4>${d.det.description ? `<div class="fv-rich">${richHTML(d.det.description)}</div>` : ""}${(d.det.rules || []).map(r => ruleBlock(r.name, r.rich || r.text)).join("")}</div>`).join("")
    : `<p class="bt-hint">${army ? "No detachment is chosen in this list." : "Your army list isn't on this device."}</p>`;
  return `<div class="bt-boxes">
    ${boxHTML("strat", "Stratagems", `${usable} usable`, stratBody)}
    ${boxHTML("theirs", "Opponent’s Stratagems", theirs.length ? `${theirs.length}` : "", theirBody)}
    ${boxHTML("army", "Army Rules", "", armyBody)}
    ${boxHTML("det", "Detachment Rules", "", detBody)}
  </div>`;
}
function trackerHTML(armies) {
  const active = B.turn === "you" ? B.me : B.them, st = factionStyle(active.faction || "");
  const whose = B.turn === "you" ? (B.me.name ? `${B.me.name}’s` : "Your") : `${B.them.name || "Opponent"}’s`;
  return `<div class="bt-tracker">
    <div class="bt-head"><h2 class="bt-round">Round ${B.round}</h2><div class="bt-turn">${esc(whose)} turn</div></div>
    <div class="bt-phases" style="--c1:${st.c1};--c2:${st.c2}" role="tablist" aria-label="Phase">${PHASES.map(([full, short], i) => `<button type="button" role="tab" aria-selected="${i === B.phase}" class="${i === B.phase ? "on" : ""}" data-bt-phase="${i}" title="${full} phase"><span class="full">${full}</span><span class="short">${short}</span></button>`).join("")}</div>
    <button type="button" class="bt-nextphase" data-bt-next>Next Phase <span aria-hidden="true">→</span></button>
    <div class="bt-cols">${column(B.me, "me", "You")}${column(B.them, "them", "Opponent")}</div>
    ${boxesHTML(armies)}
  </div>`;
}

/* ---------- the armies ---------- */
/** An army's list, its units worked out, and its faction's army rules: yours from your library, your opponent's from sync. */
function armyOf(side) {
  if (side === "me") {
    const list = state.lists.find(l => l.id === A.me?.listId);
    if (!list) return null;
    const data = armyData(list.faction);
    return { list, data, r: evaluateList(list, data), armyRules: factionArmyRules(list.faction) };
  }
  const list = A.them?.list, rules = A.them?.rules;
  if (!list) return null;
  const docs = rules?.structured ? [{ faction: list.faction, structured: rules.structured }] : null;
  const data = armyData(list.faction, docs || undefined);
  return { list, data, r: evaluateList({ ...list, detachments: list.detachments || [], units: list.units || [] }, data), armyRules: rules?.structured?.armyRules || factionArmyRules(list.faction) };
}
const nameOf = x => x.label || x.unit?.name || x.key;

function armyHTML(side, army = armyOf(side)) {
  const p = side === "me" ? B.me : B.them, st = factionStyle(p.faction || "");
  const head = `<div class="bt-armyhead" style="--c1:${st.c1};--c2:${st.c2}">${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<div><b>${esc(p.name || (side === "me" ? "You" : "Opponent"))}</b><span>${esc(army?.list.name || p.army || "")}${army ? ` · ${army.r.total} pts` : ""}</span></div></div>`;
  if (!army) return head + `<div class="bt-hint">${side === "me" ? "Your army list isn't on this device." : "Sync with your opponent before the battle to see their army here."}</div>`;
  if (sheet?.side === side) {
    const x = army.r.entries.find(e => e.id === sheet.id);
    if (x?.unit) return head + `<button type="button" class="btn bt-dsback" data-bt-dsback>‹ ${esc(army.list.name)}</button>` + battleDatasheet(x, army);
  }
  // A→Z, no categories; a unit's attached leaders and supporters sit under it in smaller boxes.
  const entries = army.r.entries.filter(e => e.unit);
  const hosted = new Set(entries.filter(e => e.attachTo && entries.some(h => h.id === e.attachTo)).map(e => e.id));
  const top = entries.filter(e => !hosted.has(e.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const card = x => {
    const kids = entries.filter(c => c.attachTo === x.id).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const tags = [x.warlord ? `<span class="lb-tag">Warlord</span>` : "", x.enh ? `<span class="lb-tag enh">${esc(x.enh)}</span>` : "", x.upg ? `<span class="lb-tag upg">${esc(x.upg)}</span>` : ""].join("");
    return `<div class="bt-unitwrap"><button type="button" class="bt-unit" data-bt-unit="${esc(x.id)}" data-side="${side}">
        <span class="bt-unit-top"><b>${esc(nameOf(x))}</b><span>${x.total} pts</span></span>
        ${x.label ? `<span class="bt-unit-orig">${esc(x.unit.name)}</span>` : ""}
        <span class="bt-unit-meta">${x.models} model${x.models === 1 ? "" : "s"}</span>${tags ? `<span class="lb-ctags">${tags}</span>` : ""}</button>
      ${kids.map(c => `<button type="button" class="bt-unit bt-attached" data-bt-unit="${esc(c.id)}" data-side="${side}"><span aria-hidden="true">↳</span> <b>${esc(nameOf(c))}</b><span>${c.total} pts</span></button>`).join("")}</div>`;
  };
  return head + `<div class="bt-units">${top.map(card).join("")}</div>`;
}

/** A unit's datasheet for the battle: its profile, only the wargear it has, and its abilities. No options, no leader lists. */
function battleDatasheet(x, army) {
  const ds = x.unit.ds, buffs = buffsFor(x, army.r);
  const counts = new Map();
  for (const g of x.loadout || []) for (const [w, n] of Object.entries(g.counts || {})) if (n > 0) counts.set(w, (counts.get(w) || 0) + n);
  const equipped = (ds.weapons || []).filter(w => counts.has(weaponBase(w.name)));
  const byType = t => equipped.filter(w => w.type === t);
  const weaponsPanel = (t, label) => byType(t).length ? panelHTML(label, `<div class="bt-carried">${[...new Set(byType(t).map(w => weaponBase(w.name)))].map(b => `<span>${counts.get(b)}× ${esc(b)}</span>`).join("")}</div>${weaponGridHTML(byType(t), t, buffs)}`) : "";
  const taken = [x.enh, x.upg].filter(Boolean).map(n => army.r.enhPool?.find(e => e.name === n)).filter(Boolean);
  return `<div class="bt-ds">
    <div class="bt-ds-head"><h3>${esc(nameOf(x))}</h3>${x.label ? `<div class="bt-unit-orig">${esc(x.unit.name)}</div>` : ""}<div class="bt-unit-meta">${x.models} model${x.models === 1 ? "" : "s"} · ${x.total} pts${x.warlord ? " · Warlord" : ""}</div></div>
    ${statsHTML(ds)}
    ${weaponsPanel("Ranged", "Ranged weapons")}${weaponsPanel("Melee", "Melee weapons")}
    ${taken.map(e => panelHTML(`${e.upgrade ? "Upgrade" : "Enhancement"} · ${esc(e.name)}`, `<div class="fv-rich">${richHTML(e.rich || e.text)}</div>`)).join("")}
    ${datasheetDetailsHTML(ds, army.armyRules, { battle: true, equipped: [...counts.keys()] })}
  </div>`;
}

/* ---------- the screen ---------- */
function renderTracker(host) {
  if (!B) return;
  document.body.classList.add("bt-fullscreen");   // the app's menu bar is hidden during a battle
  const i = PANES.indexOf(pane);
  const armies = { me: armyOf("me"), them: armyOf("them") };
  lastStrats = { me: strategyList("me", armies.me), them: strategyList("them", armies.them) };
  const navBtn = (side, p) => { const st = factionStyle(p.faction || ""); return `<button type="button" class="bt-navbtn${pane === side ? " on" : ""}" data-bt-pane="${side}" style="--c1:${st.c1};--c2:${st.c2}"><b>${esc(p.name || (side === "me" ? "You" : "Opponent"))}</b><span>${esc((side === "me" ? armies.me?.list.name : armies.them?.list?.name) || p.army || "Army")}</span></button>`; };
  const keep = [...host.querySelectorAll(".bt-pane")].map(el => el.scrollTop);
  host.innerHTML = `<div class="bt-shell" style="--i:${i}">
      <div class="bt-pane" data-pane="me">${armyHTML("me", armies.me)}</div>
      <div class="bt-pane" data-pane="tracker">${trackerHTML(armies)}</div>
      <div class="bt-pane" data-pane="them">${armyHTML("them", armies.them)}</div>
    </div>
    <nav class="bt-armynav" aria-label="Armies">${navBtn("me", B.me)}${navBtn("them", B.them)}</nav>`;
  host.querySelectorAll(".bt-pane").forEach((el, k) => { if (keep[k] != null) el.scrollTop = keep[k]; });
}
function showPane(next, host) {
  if (!PANES.includes(next)) return;
  pane = next; sheet = null; renderTracker(host);
  host.querySelector(`.bt-pane[data-pane="${next}"]`)?.scrollTo(0, 0);
}

/** Applies a change, saves it and sends it to the other phone (seen from their side). */
function change(fn, host) {
  fn(B); B.updated = Date.now(); save(); renderTracker(host);
  sendToPeer({ battle: B });   // sent as seen from this phone; the other phone flips it
}
function nextPhase(b) {
  if (b.phase < PHASES.length - 1) { b.phase++; return; }
  // End phase done: the other player's turn; once both have had a turn, the next battle round.
  b.phase = 0;
  b.turn = FLIP[b.turn];
  if (b.turn === b.first) b.round++;
}

/** Spends Command Points on one of your stratagems and marks it used for this phase. */
function spend(key, cost, host) {
  change(b => {
    if (cost > b.me.cp) return;
    const sg = sigOf(b);
    if (b.me.used?.sig !== sg) b.me.used = { sig: sg, keys: [] };
    if (!b.me.used.keys.includes(key)) b.me.used.keys.push(key);
    b.me.cp -= cost;
  }, host);
}
/** A stratagem with two costs: a pop-up asks how many Command Points to spend. */
function openSpendSheet(s, host) {
  const d = openSheet(`<div class="sheet-head"><h2>${esc(s.name)}</h2><p>How many Command Points do you want to spend on this stratagem?</p></div>
    <div class="sheet-body bt-spend">${s.costs.map(c => `<button type="button" class="btn bt-spendbtn" data-spend="${c}" ${c > B.me.cp ? "disabled" : ""}>${c} CP</button>`).join("")}</div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Cancel</button></div>`);
  d.onclick = e => {
    const b = e.target.closest("[data-spend]");
    if (!b || b.disabled) return;
    d.close();
    spend(s.key, +b.dataset.spend, host);
  };
}
/** The Use button: greyed out (no action) when it's already used this phase or the Command Points don't cover it. */
function useStratagem(key, host) {
  const s = lastStrats.me.find(x => x.key === key);
  if (!s || usedKeys(B.me).includes(key) || B.me.cp < s.costs[0]) return;
  if (s.costs.length > 1) openSpendSheet(s, host);
  else spend(key, s.costs[0], host);
}
const toggleIn = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));

/** The tracker's buttons inside the Battle view. */
function handleTrackerClick(e, host) {
  if (!B?.active) return false;
  const t = e.target;
  if (t.closest("[data-bt-next]")) { change(nextPhase, host); return true; }
  const ph = t.closest("[data-bt-phase]");
  if (ph) { change(b => { b.phase = +ph.dataset.btPhase; }, host); return true; }
  const cp = t.closest("[data-bt-cp]");
  if (cp && !cp.disabled) { change(b => { const p = b[cp.dataset.btCp]; p.cp = Math.max(0, p.cp + +cp.dataset.d); }, host); return true; }
  // The two army buttons: tapping the one that's open goes back to the tracker.
  const nb = t.closest("[data-bt-pane]");
  if (nb) { showPane(pane === nb.dataset.btPane ? "tracker" : nb.dataset.btPane, host); return true; }
  // The boxes under the columns: open and close, expand a stratagem's text, or use it.
  const use = t.closest("[data-bt-use]");
  if (use) { useStratagem(use.dataset.btUse, host); return true; }
  const box = t.closest("[data-bt-box]");
  if (box) { toggleIn(openBoxes, box.dataset.btBox); renderTracker(host); return true; }
  const srow = t.closest("[data-bt-strat]");
  if (srow) { toggleIn(openStrats, srow.dataset.btStrat); renderTracker(host); return true; }
  const u = t.closest("[data-bt-unit]");
  if (u) { sheet = { side: u.dataset.side, id: u.dataset.btUnit }; renderTracker(host); host.querySelector(`.bt-pane[data-pane="${u.dataset.side}"]`)?.scrollTo(0, 0); return true; }
  if (t.closest("[data-bt-dsback]")) { sheet = null; renderTracker(host); return true; }
  return false;
}
/* Snapping in the tracker: the top section and each box's top are rest points. After a scroll, the page settles on one:
   a nearby rest point, or in the direction of the scroll. A firm wheel notch or swipe moves on to the next section at
   once. While a box is open and taller than the screen, the scroll is free until the box's bottom edge is on screen. */
const SNAP_NEAR = 40, SNAP_PAUSE = 50, SNAP_TIME = 260, WHEEL_PX = 40, FLICK_PX = 60, FLICK_SPEED = 0.35;
let snapTimer = 0, snapping = false, snapDir = 1, lastScroll = 0;
/** Moves the tracker to a rest point. `flick` (+1 down, -1 up) asks for the next section in that direction. */
function snapTo(pane, flick = 0) {
  if (!B?.active || snapping) return false;
  const cur = pane.scrollTop, view = pane.clientHeight, max = Math.max(0, pane.scrollHeight - view);
  const pr = pane.getBoundingClientRect();
  const boxes = [...pane.querySelectorAll(".bt-box")].map(el => { const r = el.getBoundingClientRect(); return { top: r.top - pr.top + cur, bottom: r.bottom - pr.top + cur }; });
  const rest = [0, ...boxes.map(b => b.top), max].map(v => Math.min(max, Math.max(0, v)));
  const i = boxes.reduce((k, b, j) => (b.top <= cur + 1 ? j : k), -1);
  const inTall = i >= 0 && boxes[i].bottom > cur + view;
  let target;
  if (flick) {
    if (inTall) return false;
    target = flick > 0 ? rest.find(v => v > cur + 1) : [...rest].reverse().find(v => v < cur - 1);
    if (target == null) return false;
  } else {
    const near = rest.reduce((best, v) => (Math.abs(v - cur) < Math.abs(best - cur) ? v : best), rest[0]);
    if (Math.abs(near - cur) <= SNAP_NEAR) target = near;
    else {
      if (inTall) return false;
      target = snapDir > 0 ? rest.find(v => v > cur + 1) : [...rest].reverse().find(v => v < cur - 1);
      if (target == null) target = snapDir > 0 ? max : 0;
    }
  }
  if (Math.abs(target - cur) < 2) return false;
  snapping = true;
  pane.scrollTo({ top: target, behavior: "smooth" });
  setTimeout(() => { snapping = false; }, SNAP_TIME);
  return true;
}
function wireTrackerSnap(host) {
  const isTracker = el => el?.closest?.('.bt-pane[data-pane="tracker"]') || null;
  // Settling after any scroll (scrollbar, keyboard, or a slow drag).
  host.addEventListener("scroll", e => {
    const pane = e.target;
    if (!pane.classList?.contains("bt-pane") || pane.dataset.pane !== "tracker") return;
    // The direction is kept up to date even during a snap, so the next scroll reads its own direction.
    if (pane.scrollTop !== lastScroll) { if (!snapping) snapDir = pane.scrollTop > lastScroll ? 1 : -1; lastScroll = pane.scrollTop; }
    if (snapping) return;
    clearTimeout(snapTimer); snapTimer = setTimeout(() => snapTo(pane), SNAP_PAUSE);
  }, { capture: true, passive: true });
  // A firm wheel scroll (a notch, or enough trackpad movement) goes on to the next section.
  let acc = 0, last = 0;
  host.addEventListener("wheel", e => {
    const pane = isTracker(e.target);
    if (!pane || !B?.active) return;
    if (snapping) { e.preventDefault(); return; }
    // Movement counts while it keeps coming: a mouse notch is one step, a trackpad flick is many small ones close together.
    const now = performance.now(); if (now - last > 120) acc = 0; last = now;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    acc += e.deltaY;
    if (Math.abs(acc) < WHEEL_PX) return;
    const dir = Math.sign(acc); acc = 0;
    clearTimeout(snapTimer);
    if (snapTo(pane, dir)) e.preventDefault();
  }, { capture: true, passive: false });
  // A quick, firm swipe up or down goes on to the next section.
  let tp = null, tx = 0, ty = 0, tt = 0;
  host.addEventListener("touchstart", e => { tp = isTracker(e.target); const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = performance.now(); }, { passive: true, capture: true });
  host.addEventListener("touchend", e => {
    const pane = tp; tp = null;
    if (!pane || !B?.active) return;
    const t = e.changedTouches[0], dy = ty - t.clientY, dx = tx - t.clientX, dt = Math.max(1, performance.now() - tt);
    if (Math.abs(dy) < FLICK_PX || Math.abs(dy) < Math.abs(dx) * 1.5 || Math.abs(dy) / dt < FLICK_SPEED) return;
    clearTimeout(snapTimer); snapTo(pane, Math.sign(dy));
  }, { passive: true, capture: true });
}

/** Swipe right for the screen to the left (your army), left for the screen to the right (your opponent's). */
function wireTrackerSwipes(host) {
  wireTrackerSnap(host);
  let x0 = null, y0 = 0;
  host.addEventListener("touchstart", e => { if (!B?.active || e.target.closest(".bt-phases, .fv-weapons, .mc-tablewrap")) { x0 = null; return; } const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  host.addEventListener("touchend", e => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0); x0 = null;
    if (Math.abs(dx) < 70 || dy > Math.abs(dx) * 0.6) return;
    showPane(PANES[Math.max(0, Math.min(2, PANES.indexOf(pane) + (dx > 0 ? -1 : 1)))], host);
  }, { passive: true });
}

const trackerActive = () => !!B?.active;
function startTracker(opts, send, armies) {
  sendToPeer = send || sendToPeer;
  A = { me: armies?.me || null, them: armies?.them || null }; saveArmies();
  newBattle(opts); return B;
}
function setTrackerSend(send) { sendToPeer = send; }
/** The other phone's view of the battle arrives: take it on, flipped to this side. */
function receiveBattle(b, host, armies) {
  if (armies && !B?.active) { A = { me: armies.me || A.me, them: armies.them || A.them }; saveArmies(); }
  // After a reconnect both phones send their battle: the most recently changed one wins.
  if (B?.active && b.updated && B.updated && b.updated < B.updated) { sendToPeer({ battle: B }); return; }
  B = mirror(b); B.active = true; save(); if (host?.classList.contains("bt-on")) renderTracker(host);
}
function endTracker() { if (B) { B.active = false; save(); } document.body.classList.remove("bt-fullscreen"); pane = "tracker"; sheet = null; }
const currentBattle = () => B;

export { currentBattle, endTracker, handleTrackerClick, receiveBattle, renderTracker, setTrackerSend, startTracker, trackerActive, mirror, wireTrackerSwipes };
