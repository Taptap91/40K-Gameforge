/* RulesForge · battle/tracker.js
 * The battle tracker, shown after "Begin Battle": the round, the phase of whoever's turn it is, and each player's
 * score (Battle Ready 10VP + Primary + Secondary), Primary and Secondary trackers, and Command Points.
 * When the two phones are synced, every change shows on both.
 *
 * The app's menu bar is hidden here; instead two buttons along the bottom open each player's army (yours to the left,
 * your opponent's to the right; swipe to move between them). Tapping a unit shows its datasheet as it's equipped.
 */
import { esc, openSheet, state, store } from "../js/core.js?v=8.8";
import { factionStyle } from "../js/factions.js?v=8.8";
import { armyData, evaluateList } from "../js/army.js?v=8.8";
import { armyRuleParts, datasheetDetailsHTML, factionArmyRules, panelHTML, statsHTML, weaponGridHTML } from "../js/datasheets.js?v=8.8";
import { effectiveRules } from "../js/rules-doc.js?v=8.8";
import { buffsFor, weaponBase } from "../js/loadout.js?v=8.8";
import { richHTML } from "../js/text.js?v=8.8";

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
  const player = p => ({ name: p.name || "", faction: p.faction || "", battleReady: !!p.battleReady, primary: 0, secondary: 0, cp: 0, army: p.army || "", priMission: p.mission || "", priScores: [], secs: [] });
  B = { active: true, started: Date.now(), updated: Date.now(), round: 1, phase: 0, turn: firstTurn === "opponent" ? "opponent" : "you", first: firstTurn === "opponent" ? "opponent" : "you", me: player(me), them: player(them), events: [] };
  pane = "tracker"; sheet = null;
  save();
  return B;
}
/** The same battle seen from the other phone: "me" and "them" swap, and so does whose turn it is. */
const mirror = b => b && { ...b, me: b.them, them: b.me, turn: FLIP[b.turn], first: FLIP[b.first], events: (b.events || []).map(e => ({ ...e, by: FLIP[e.by] || e.by })) };

const score = p => (p.battleReady ? 10 : 0) + (+p.primary || 0) + (+p.secondary || 0);
const pad = n => String(n).padStart(2, "0");
/* A faction's brighter colour, so a very dark faction (Black Templars) still shows its score clearly. */
const lum = hex => { const v = parseInt(String(hex).slice(1), 16) || 0; return ((v >> 16) & 255) * .299 + ((v >> 8) & 255) * .587 + (v & 255) * .114; };
const bright = st => lum(st.c1) >= lum(st.c2) || lum(st.c1) > 90 ? st.c1 : st.c2;

/* ---------- missions and the event log: the data ---------- */
/** Takes back what an event did (a Command Point change, a stratagem's use, a score, a secondary drawn or removed). */
function undoEffect(b, ev) {
  const u = ev.undo; if (!u) return;
  const p = b[ev.by === "you" ? "me" : "them"]; if (!p) return;
  if (u.t === "cp") {
    p.cp = Math.max(0, p.cp - u.d);
    if (u.key && p.used?.sig === u.sig) p.used.keys = p.used.keys.filter(k => k !== u.key);
  } else if (u.t === "score") {
    if (u.kind === "pri") {
      const i = p.priScores.findIndex(r => r.round === u.round);
      if (!u.had) { if (i >= 0) p.priScores.splice(i, 1); }
      else if (i >= 0) { p.priScores[i].checks = u.checks; p.priScores[i].vp = u.vp; }
    } else {
      const s = p.secs.find(x => x.name === u.name);
      if (s) { s.checks = u.checks; s.vp = u.vp; s.round = u.prevRound; }
    }
  } else if (u.t === "add") {
    const i = p.secs.findIndex(x => x.name === u.name); if (i >= 0) p.secs.splice(i, 1);
  } else if (u.t === "remove") {
    p.secs.push({ ...u.mission });
  }
}
/* Older battles may lack these fields; they're filled in before anything is drawn or changed. */
function ensure(b) {
  if (!b) return;
  b.events ||= [];
  for (const p of [b.me, b.them]) if (p) { p.secs ||= []; p.priScores ||= []; }
}
/* The VP totals are worked out from the scores, so they can't drift from the scores that were recorded. */
function recalc(b) {
  for (const p of [b.me, b.them]) {
    p.primary = p.priScores.reduce((a, r) => a + (+r.vp || 0), 0);
    p.secondary = p.secs.reduce((a, s) => a + (+s.vp || 0), 0);
  }
}
const missionPack = () => state.docs.filter(d => d.kind === "missions").sort((a, b) => b.importedAt - a.importedAt)[0]?.structured?.missionPack;
/* The pack's limit per battle round for Primary and for Secondary Missions (15VP in the printed pack). */
const capPerRound = () => +String(missionPack()?.limits?.[0]?.perRound || "").match(/\d+/)?.[0] || 15;
const primaryCard = name => (name ? missionPack()?.primaries?.find(m => m.name === name) || null : null);
/* A scoring line's VP as printed ("5VP", or "5VP / 10VP" for a Fixed and a Tactical value). The score counted is the first number. */
const vpText = v => (v && typeof v === "object" ? Object.values(v).filter(Boolean).join(" / ") : String(v || ""));
const vpValue = v => { const s = v && typeof v === "object" ? (v.tactical ?? v.fixed ?? Object.values(v)[0] ?? "") : v; const n = /\d+/.exec(String(s || "")); return n ? +n[0] : 0; };
/** Every scoring line of a mission, in order (the index is its checkbox). */
const scoringRows = card => (card?.scoring || []).flatMap(b => b.rows.map(r => ({ round: b.round, text: r.text, vp: vpText(r.vp), n: vpValue(r.vp) })));
/** VP already scored this round for Primary ("pri") or for the Secondary Missions ("sec"). */
const gainedThisRound = (p, kind) => (kind === "pri" ? (p.priScores.find(r => r.round === B.round)?.vp || 0) : p.secs.filter(s => s.round === B.round).reduce((a, s) => a + (+s.vp || 0), 0));
function logEv(b, by, ev) {
  b.events ||= [];
  b.events.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), round: b.round, by, struck: false, ...ev });
}
const TRASH = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PENCIL = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
/** The strip under the header: whose turn it is and the phase bar. Compact, it keeps only the active phase, beside the turn. */
function stickHTML(compact) {
  const active = B.turn === "you" ? B.me : B.them, st = factionStyle(active.faction || "");
  const whose = B.turn === "you" ? (B.me.name ? `${B.me.name}’s` : "Your") : `${B.them.name || "Opponent"}’s`;
  return `<div class="bt-stick${compact ? " compact" : ""}">
    <div class="bt-turn">${esc(whose)} turn</div>
    <div class="bt-phases" style="--c1:${st.c1};--c2:${st.c2}" role="tablist" aria-label="Phase">${PHASES.map(([full, short], i) => `<button type="button" role="tab" aria-selected="${i === B.phase}" class="${i === B.phase ? "on" : ""}" data-bt-phase="${i}" title="${full} phase"><span class="full">${full}</span><span class="short">${short}</span></button>`).join("")}</div>
  </div>`;
}
/** Two screens: the first (Next Phase and the two columns) and the second (the boxes), with a small gap between. */
function trackerHTML(armies) {
  return `<div class="bt-tracker">
    <section class="bt-s1">
      <button type="button" class="bt-nextphase" data-bt-next>Next Phase <span aria-hidden="true">→</span></button>
      <div class="bt-cols">${column(B.me, "me", "You")}${column(B.them, "them", "Opponent")}</div>
    </section>
    <div class="bt-gap" aria-hidden="true"></div>
    <section class="bt-s2">${missionsHTML()}${boxesHTML(armies)}</section>
    <div class="bt-gap" aria-hidden="true"></div>
    <section class="bt-s3">${logHTML()}</section>
  </div>`;
}
/** One mission's scoring lines, read from the pack: each round's heading, then its lines and their VP. */
function missionDetail(name, card) {
  if (!name) return `<p class="bt-hint">Not chosen yet. Set the Force Dispositions in setup.</p>`;
  if (!card) return `<div class="bt-mname">${esc(name)}</div><p class="bt-hint">Add the mission pack in Library to see how it scores.</p>`;
  return `<div class="bt-mname">${esc(name)}</div>` + card.scoring.map(b => `<div class="bt-mround"><span>${esc(b.round)}</span>${b.cap ? `<em>${esc(b.cap)}</em>` : ""}</div>${b.rows.map(r => `<div class="bt-mline"><span>${esc(r.text)}</span><b>${esc(vpText(r.vp))}</b></div>`).join("")}`).join("");
}
/** The Primary and Secondary boxes above the Stratagems: each is a box like the others, and its details open inside it. */
const ARROW = `<svg class="bt-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function missionsHTML() {
  const me = B.me, them = B.them;
  const box = (id, label, meta, body) => {
    const open = openBoxes.has(id);
    return `<section class="bt-box bt-mbox${open ? " open" : ""}">
      <button type="button" class="bt-boxhead bt-mhead" data-bt-mhead="${id}" aria-expanded="${open}"><b>${label}</b><span class="bt-count">${meta}</span>${ARROW}</button>
      ${open ? `<div class="bt-boxbody bt-mbody">${body}</div>` : ""}
    </section>`;
  };
  const priBody = `<div class="bt-mh"><b>${esc(me.name || "You")}’s Primary Missions</b><button type="button" class="bt-scorebtn" data-bt-score>Score</button></div>
      <hr class="bt-hr">
      ${missionDetail(me.priMission, primaryCard(me.priMission))}
      <div class="bt-mh bt-mh2"><b>${esc(them.name || "Opponent")}’s Primary Mission</b></div>
      <hr class="bt-hr">
      ${missionDetail(them.priMission, primaryCard(them.priMission))}`;
  const rows = me.secs.map((s, i) => `<div class="bt-sec${s.vp > 0 ? " done" : ""}">
      <button type="button" class="bt-secname" data-bt-secscore="${i}">${esc(s.name)}</button>
      ${s.vp > 0
        ? `<span class="bt-secvp">${s.vp} VP</span><button type="button" class="bt-iconbtn" data-bt-secscore="${i}" aria-label="Change the score for ${esc(s.name)}">${PENCIL}</button>`
        : `<button type="button" class="bt-iconbtn" data-bt-secdel="${i}" aria-label="Remove ${esc(s.name)}">${TRASH}</button>`}
    </div>`).join("");
  const secBody = `<div class="bt-mh"><b>${esc(me.name || "You")}’s Secondary Missions</b></div>
      <hr class="bt-hr">
      ${rows || `<p class="bt-hint">No Secondary Missions yet.</p>`}
      <button type="button" class="btn bt-addsec" data-bt-secadd>Add Secondary Mission</button>`;
  return `<div class="bt-mpair">${box("pri", "Primary", `${me.primary} VP`, priBody)}${box("sec", "Secondary", `${me.secs.length}`, secBody)}</div>`;
}
/** The Event Log, newest first. End Battle sits at its bottom: it isn't a snap stop, and it scrolls with the log. */
function logHTML() {
  const rows = [...(B.events || [])].reverse().map(e => {
    const p = e.by === "you" ? B.me : B.them, col = bright(factionStyle(p.faction || ""));
    return `<div class="bt-ev${e.struck ? " struck" : ""}" style="--fc:${col}">
      <span class="bt-evr">R${e.round}</span>
      ${e.badge ? `<span class="bt-evbadge ${e.tone || ""}">${esc(e.badge)}</span>` : ""}
      <span class="bt-evtext">${esc(e.text)}</span>
      ${e.struck ? "" : `<button type="button" class="bt-iconbtn" data-bt-evdel="${esc(e.id)}" aria-label="Remove this event and undo what it did">${TRASH}</button>`}
    </div>`;
  }).join("");
  return `<div class="bt-logh"><h2>Event Log</h2></div>
    <div class="bt-logl">${rows || `<p class="bt-hint">Nothing yet. Command Points, stratagems and scoring appear here as they happen.</p>`}</div>
    <button type="button" class="btn bt-end" data-bt-end>End Battle</button>`;
}

/** The strip sits under the header when it's full, and inside the header bar once the second screen is showing.
   When it moves, the turn and phase bar slide from where they were, and the screens follow the header's new height. */
/** The visible height of the tracker pane: the second screen is exactly that tall, so the scroll ends once it is showing. */
let viewWatch = null;
function fitView(pane) { if (pane) pane.style.setProperty("--view", pane.clientHeight + "px"); }
function watchView(pane) {
  fitView(pane);
  viewWatch ||= new ResizeObserver(() => fitView(document.querySelector('.bt-pane[data-pane="tracker"]')));
  viewWatch.disconnect(); viewWatch.observe(pane);
}
const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function mountStick(compact, animate = false) {
  const host = document.querySelector("#battleHost"), header = document.querySelector("#view-battle > header");
  const pane = document.querySelector('.bt-pane[data-pane="tracker"]');
  const old = document.querySelector("#view-battle .bt-stick");
  const before = animate && old ? [...old.querySelectorAll(".bt-turn, .bt-phases")].map(el => el.getBoundingClientRect()) : null;
  const paneTop = animate && pane ? pane.getBoundingClientRect().top : null;
  const keepTop = pane ? pane.scrollTop : 0;
  document.querySelectorAll("#view-battle .bt-stick").forEach(el => el.remove());
  if (!B?.active || !host || !header) return;
  const tpl = document.createElement("template"); tpl.innerHTML = stickHTML(compact);
  const el = tpl.content.firstElementChild;
  if (compact) header.append(el); else host.prepend(el);
  fitView(pane);
  // The pane's height changed under the scroll: put the position back (the browser may have clamped it).
  if (pane && pane.scrollTop !== keepTop) pane.scrollTop = keepTop;
  if (!animate || reduceMotion()) return;
  const ms = 220, ease = "cubic-bezier(.2,.7,.2,1)";
  if (before) [...el.querySelectorAll(".bt-turn, .bt-phases")].forEach((node, n) => {
    const a = before[n], b = node.getBoundingClientRect();
    if (!a) return;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: ms, easing: ease });
  });
  if (pane && paneTop != null) {
    const dy = paneTop - pane.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) pane.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: ms, easing: ease });
  }
}
function setCompact(on) {
  const el = document.querySelector("#view-battle .bt-stick");
  if (!!el?.classList.contains("compact") !== on) mountStick(on, true);
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
  ensure(B);
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
    <footer class="bt-footer">
      <nav class="bt-armynav" aria-label="Armies">${navBtn("me", B.me)}${navBtn("them", B.them)}</nav>
    </footer>`;
  // The header reads "Round N" while the battle is on.
  const title = document.querySelector("#view-battle h1"); if (title) title.textContent = `Round ${B.round}`;
  // Compact once the scroll is past the middle of the way to the second screen (decided from where the pane was left).
  const tp = host.querySelector('.bt-pane[data-pane="tracker"]');
  const compact = !!tp && pane === "tracker" && keep[1] > (tp.querySelector(".bt-s1").offsetHeight + tp.querySelector(".bt-gap").offsetHeight) / 2;
  mountStick(compact);
  if (tp) watchView(tp);
  host.querySelectorAll(".bt-pane").forEach((el, k) => { if (keep[k] != null) el.scrollTop = keep[k]; });
  // The nearest section top is where the screen rests.
  if (tp) { const st = sectionStarts(tp); restPos = st.reduce((b, v) => (Math.abs(v - (keep[1] || 0)) < Math.abs(b - (keep[1] || 0)) ? v : b), st[0] ?? 0); }
}
function showPane(next, host) {
  if (!PANES.includes(next)) return;
  pane = next; sheet = null; renderTracker(host);
  host.querySelector(`.bt-pane[data-pane="${next}"]`)?.scrollTo(0, 0);
}

/** Applies a change, saves it and sends it to the other phone (seen from their side). */
function change(fn, host) {
  ensure(B); fn(B); recalc(B); B.updated = Date.now(); save(); renderTracker(host);
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
  const name = lastStrats.me.find(x => x.key === key)?.name || "a stratagem";
  change(b => {
    if (cost > b.me.cp) return;
    const sg = sigOf(b);
    if (b.me.used?.sig !== sg) b.me.used = { sig: sg, keys: [] };
    if (!b.me.used.keys.includes(key)) b.me.used.keys.push(key);
    b.me.cp -= cost;
    if (cost > 0) logEv(b, "you", { badge: `-${cost}`, tone: "cp-minus", text: `Spent on ${name}`, undo: { t: "cp", d: -cost, key, sig: sg } });
  }, host);
}
/** Points for a mission, from the boxes ticked. Up to the round's limit; what was counted is what's recorded. */
function openScoreSheet(kind, host, idx) {
  const p = B.me, sec = kind === "sec" ? p.secs[idx] : null;
  if (kind === "sec" && !sec) return;
  const name = kind === "pri" ? p.priMission : sec.name;
  const rows = scoringRows(kind === "pri" ? primaryCard(p.priMission) : missionPack()?.secondaries?.find(m => m.name === sec.name));
  const rec = kind === "pri" ? p.priScores.find(r => r.round === B.round) : sec;
  const checked = new Set(rec?.checks || []);
  const cap = capPerRound();
  const own = rec?.round === B.round ? rec.vp || 0 : 0;
  const other = gainedThisRound(p, kind) - own;   // VP this round from the rest of the same kind
  const sumOf = set => [...set].reduce((a, i) => a + (rows[i]?.n || 0), 0);
  const counted = () => Math.min(sumOf(checked), Math.max(0, cap - other));
  const d = openSheet(`<div class="sheet-head"><h2>${esc(name || "Score")}</h2>
      <p>Tick each way ${kind === "pri" ? "the Primary Mission" : "this Secondary Mission"} was scored this round. ${cap} VP is the most that counts for each of Primary and Secondary in one round.</p></div>
    <div class="sheet-body bt-scorelist">${rows.length ? rows.map((r, i) => `<label class="bt-scorerow"><input type="checkbox" data-k="${i}" ${checked.has(i) ? "checked" : ""}><span><i>${esc(r.round)}</i>${esc(r.text)}</span><b>${r.n} VP</b></label>`).join("") : `<p class="bt-hint">No scoring is printed for this mission in the mission pack.</p>`}</div>
    <p class="bt-scoretot" aria-live="polite"></p>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-accept ${rows.length ? "" : "disabled"}>Accept</button></div>`);
  const tot = d.querySelector(".bt-scoretot");
  const show = () => { const raw = sumOf(checked), c = counted(); tot.textContent = `${c} VP this round${c < raw ? ` (counts ${c} of ${raw}: the round's limit is ${cap})` : ""}`; };
  show();
  d.onchange = e => { const k = +e.target.dataset.k; if (Number.isNaN(k)) return; e.target.checked ? checked.add(k) : checked.delete(k); show(); };
  d.onclick = e => {
    if (!e.target.closest("[data-accept]") || e.target.closest("[disabled]")) return;
    const vp = counted(), keys = [...checked].sort((a, b) => a - b);
    d.close();
    change(b => {
      const pl = b.me;
      let undo;
      if (kind === "pri") {
        let r = pl.priScores.find(x => x.round === b.round);
        undo = { t: "score", kind, name, round: b.round, had: !!r, checks: r?.checks || [], vp: r?.vp || 0 };
        if (!r) pl.priScores.push(r = { round: b.round, checks: [], vp: 0 });
        r.checks = keys; r.vp = vp;
      } else {
        const s = pl.secs[idx]; if (!s) return;
        undo = { t: "score", kind, name: s.name, round: s.round, checks: s.checks || [], vp: s.vp || 0, prevRound: s.round };
        s.checks = keys; s.vp = vp; s.round = b.round;
      }
      const prev = undo.vp;
      if (vp !== prev) logEv(b, "you", { badge: `${vp - prev > 0 ? "+" : ""}${vp - prev} VP`, tone: "vp", text: `${name} (${kind === "pri" ? "Primary" : "Secondary"})`, undo });
    }, host);
  };
}
/** Taking a Secondary Mission off the list asks first. Cancel does nothing. */
function openRemoveSheet(idx, host) {
  const s = B.me.secs[idx]; if (!s) return;
  const d = openSheet(`<div class="sheet-head"><h2>Remove Secondary Mission?</h2><p>${esc(s.name)} comes off your list of Secondary Missions.</p></div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-accept>Accept</button></div>`);
  d.onclick = e => {
    if (!e.target.closest("[data-accept]")) return;
    d.close();
    change(b => { const [gone] = b.me.secs.splice(idx, 1); if (gone) logEv(b, "you", { badge: "Removed", tone: "sec", text: gone.name, undo: { t: "remove", mission: { ...gone } } }); }, host);
  };
}
/** The Secondary Missions in the pack that aren't on the list yet. */
function openAddSheet(host) {
  const all = missionPack()?.secondaries || [];
  const have = new Set(B.me.secs.map(s => s.name));
  const left = all.filter(m => !have.has(m.name));
  const d = openSheet(`<div class="sheet-head"><h2>Add a Secondary Mission</h2><p>From the mission pack in your Library.</p></div>
    <div class="sheet-body bt-addlist">${left.length ? left.map(m => `<button type="button" class="bt-addrow" data-add="${esc(m.name)}"><b>${esc(m.name)}</b><span>Add</span></button>`).join("") : `<p class="bt-hint">${all.length ? "Every Secondary Mission in the pack is already on your list." : "Add a mission pack PDF in Library to choose Secondary Missions here."}</p>`}</div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button></div>`, true);
  d.onclick = e => {
    const row = e.target.closest("[data-add]"); if (!row) return;
    const name = row.dataset.add;
    d.close();
    change(b => { b.me.secs.push({ name, checks: [], vp: 0, round: b.round }); logEv(b, "you", { badge: "New", tone: "sec", text: `Drew ${name}`, undo: { t: "add", name } }); }, host);
  };
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
  if (cp && !cp.disabled) {
    const who = cp.dataset.btCp, d = +cp.dataset.d, name = who === "me" ? B.me.name || "You" : B.them.name || "Opponent";
    change(b => {
      const p = b[who], before = p.cp;
      p.cp = Math.max(0, p.cp + d);
      const delta = p.cp - before;
      if (delta) logEv(b, who === "me" ? "you" : "opponent", { badge: delta > 0 ? "+1" : "-1", tone: delta > 0 ? "cp-plus" : "cp-minus", text: `${delta > 0 ? "Gained" : "Spent"} a Command Point (${name})`, undo: { t: "cp", d: delta } });
    }, host);
    return true;
  }
  // The two army buttons: tapping the one that's open goes back to the tracker.
  const nb = t.closest("[data-bt-pane]");
  if (nb) { showPane(pane === nb.dataset.btPane ? "tracker" : nb.dataset.btPane, host); return true; }
  // The boxes under the columns: open and close, expand a stratagem's text, or use it.
  const use = t.closest("[data-bt-use]");
  if (use) { useStratagem(use.dataset.btUse, host); return true; }
  // The Primary and Secondary boxes, their Score buttons, and the Secondary Missions' rows.
  const mh = t.closest("[data-bt-mhead]");
  if (mh) { toggleIn(openBoxes, mh.dataset.btMhead); renderTracker(host); return true; }
  if (t.closest("[data-bt-score]")) { openScoreSheet("pri", host); return true; }
  const ss = t.closest("[data-bt-secscore]");
  if (ss) { openScoreSheet("sec", host, +ss.dataset.btSecscore); return true; }
  const sd = t.closest("[data-bt-secdel]");
  if (sd) { openRemoveSheet(+sd.dataset.btSecdel, host); return true; }
  if (t.closest("[data-bt-secadd]")) { openAddSheet(host); return true; }
  const evd = t.closest("[data-bt-evdel]");
  if (evd) { change(b => { const e = (b.events || []).find(x => x.id === evd.dataset.btEvdel); if (e && !e.struck) { undoEffect(b, e); e.struck = true; } }, host); return true; }
  const box = t.closest("[data-bt-box]");
  if (box) { toggleIn(openBoxes, box.dataset.btBox); renderTracker(host); return true; }
  const srow = t.closest("[data-bt-strat]");
  if (srow) { toggleIn(openStrats, srow.dataset.btStrat); renderTracker(host); return true; }
  const u = t.closest("[data-bt-unit]");
  if (u) { sheet = { side: u.dataset.side, id: u.dataset.btUnit }; renderTracker(host); host.querySelector(`.bt-pane[data-pane="${u.dataset.side}"]`)?.scrollTo(0, 0); return true; }
  if (t.closest("[data-bt-dsback]")) { sheet = null; renderTracker(host); return true; }
  return false;
}
/* Snapping in the tracker. Each section's top is a stop. A firm wheel notch, swipe or flick moves on to the next section
   (going up, to the top of the section being read). A weaker scroll settles back to the top of the section it started from.
   A section taller than the screen is read by scrolling: nothing snaps inside it until its far edge (going down), and going
   up it snaps to the top only on a firm move. The browser keeps the momentum; a snap starts only once scrolling has ended. */
const SNAP_NEAR = 40, SNAP_PAUSE = 20, SNAP_TIME = 180, WHEEL_PX = 40, FLICK_PX = 60, FLICK_SPEED = 0.35, STRONG_PX = 120;
const HAS_SCROLLEND = "onscrollend" in window;
let snapTimer = 0, snapping = false, snapId = 0, snapDir = 1, lastScroll = 0, restPos = 0;

/** The top of each section, in the pane's scroll coordinates. */
function sectionStarts(pane) {
  const pr = pane.getBoundingClientRect(), cur = pane.scrollTop;
  return [...pane.querySelectorAll(".bt-tracker > section")].map(s => s.getBoundingClientRect().top - pr.top + cur);
}
/** The bottom of each section, in the same coordinates. */
function sectionEnds(pane) {
  const pr = pane.getBoundingClientRect(), cur = pane.scrollTop;
  return [...pane.querySelectorAll(".bt-tracker > section")].map(s => s.getBoundingClientRect().bottom - pr.top + cur);
}
/** Moves the tracker to a section top. `flick` (+1 down, -1 up) and `force` (how firm the move was, in px) come from a gesture. */
function snapTo(pane, flick = 0, force = 0) {
  if (!B?.active || snapping) return false;
  const starts = sectionStarts(pane), ends = sectionEnds(pane);
  if (!starts.length) return false;
  const cur = pane.scrollTop, view = pane.clientHeight;
  const G = pane.querySelector(".bt-gap")?.offsetHeight || 0;
  const dir = flick || snapDir;
  let i = 0; starts.forEach((v, j) => { if (v <= cur + 1) i = j; });   // the section the screen's top is in
  const top = starts[i], end = ends[i], tall = end - top > view + 1;
  const nxt = starts[i + 1] ?? null, prv = i > 0 ? starts[i - 1] : null;
  if (tall && dir > 0 && cur < end - view - 1) return false;                         // reading it downward
  if (tall && dir < 0 && cur > top + 1 && !(flick && force >= STRONG_PX)) return false;   // reading it upward
  let target;
  if (tall && dir < 0 && cur > top + 1) target = top;          // a firm move up through a tall section: to its top
  else if (flick) target = dir > 0 ? nxt : (cur > top + 1 ? top : prv);
  else if (dir > 0) {
    if (nxt == null) return false;                              // the last section: scroll freely
    if (tall) { if (cur - (end - view) < SNAP_NEAR) return false; target = nxt; }
    else target = cur - top >= Math.max(SNAP_NEAR, Math.min(nxt - top, nxt - view - top)) ? nxt : top;
  } else {
    if (nxt == null) return false;
    // Up: back to the section the screen came from, unless it has been scrolled past firmly; then up to this section's top.
    target = nxt - cur >= Math.max(SNAP_NEAR, G) ? top : nxt;
  }
  if (target == null) return false;
  restPos = target;
  // The second section (and any below it) moves the strip up into the header.
  const second = starts[1];
  setCompact(second != null && target >= second - 1);
  if (Math.abs(target - cur) < 2) return false;
  snapping = true; const id = ++snapId;
  pane.scrollTo({ top: target, behavior: "smooth" });
  const done = () => { if (id === snapId) snapping = false; };
  pane.addEventListener("scrollend", done, { once: true });
  setTimeout(done, SNAP_TIME * 4);   // for browsers without scrollend
  return true;
}
function wireTrackerSnap(host) {
  const isTracker = el => el?.closest?.('.bt-pane[data-pane="tracker"]') || null;
  // The direction of the scroll (kept up to date even during a snap, so the next scroll reads its own direction).
  host.addEventListener("scroll", e => {
    const pane = e.target;
    if (!pane.classList?.contains("bt-pane") || pane.dataset.pane !== "tracker") return;
    if (pane.scrollTop !== lastScroll) { if (!snapping) snapDir = pane.scrollTop > lastScroll ? 1 : -1; lastScroll = pane.scrollTop; }
    if (snapping || HAS_SCROLLEND) return;
    clearTimeout(snapTimer); snapTimer = setTimeout(() => snapTo(pane), SNAP_PAUSE);
  }, { capture: true, passive: true });
  // Settled: the scroll has ended, after any momentum.
  host.addEventListener("scrollend", e => { const pane = e.target; if (pane?.dataset?.pane === "tracker") snapTo(pane); }, { capture: true, passive: true });
  // A firm wheel scroll (a notch, or enough trackpad movement) goes on to the next section. The wheel waits while a snap moves.
  let acc = 0, last = 0;
  host.addEventListener("wheel", e => {
    const pane = isTracker(e.target);
    if (!pane || !B?.active) return;
    const now = performance.now(); if (now - last > 120) acc = 0; last = now;
    if (snapping) { e.preventDefault(); acc = 0; return; }
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    // Movement counts while it keeps coming: a mouse notch is one step, a trackpad flick is many small ones close together.
    acc += e.deltaY;
    if (Math.abs(acc) < WHEEL_PX) return;
    const dir = Math.sign(acc), force = Math.abs(acc); acc = 0;
    clearTimeout(snapTimer);
    if (snapTo(pane, dir, force)) e.preventDefault();
  }, { capture: true, passive: false });
  // A quick, firm swipe up or down goes on to the next section.
  let tp = null, tx = 0, ty = 0, tt = 0;
  host.addEventListener("touchstart", e => { tp = isTracker(e.target); const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = performance.now(); }, { passive: true, capture: true });
  host.addEventListener("touchend", e => {
    const pane = tp; tp = null;
    if (!pane || !B?.active) return;
    const t = e.changedTouches[0], dy = ty - t.clientY, dx = tx - t.clientX, dt = Math.max(1, performance.now() - tt);
    if (Math.abs(dy) < FLICK_PX || Math.abs(dy) < Math.abs(dx) * 1.5 || Math.abs(dy) / dt < FLICK_SPEED) return;
    clearTimeout(snapTimer); snapTo(pane, Math.sign(dy), Math.abs(dy));
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
function endTracker() {
  if (B) { B.active = false; save(); }
  document.body.classList.remove("bt-fullscreen"); pane = "tracker"; sheet = null;
  document.querySelectorAll("#view-battle .bt-stick").forEach(el => el.remove());
  const title = document.querySelector("#view-battle h1"); if (title) title.textContent = "Battle";
}
const currentBattle = () => B;

export { currentBattle, endTracker, handleTrackerClick, receiveBattle, renderTracker, setTrackerSend, startTracker, trackerActive, mirror, wireTrackerSwipes };
