/* RulesForge · battle/tracker.js
 * The battle tracker, shown after "Begin Battle": the round, the phase of whoever's turn it is, and each player's
 * score (Battle Ready 10VP + Primary + Secondary), Primary and Secondary trackers, and Command Points.
 * When the two phones are synced, every change shows on both.
 *
 * The app's menu bar is hidden here; instead two buttons along the bottom open each player's army (yours to the left,
 * your opponent's to the right; swipe to move between them). Tapping a unit shows its datasheet as it's equipped.
 */
import { $, esc, openSheet, state, store } from "../js/core.js?v=8.48";
import { factionStyle } from "../js/factions.js?v=8.48";
import { armyData, evaluateList } from "../js/army.js?v=8.48";
import { armyRuleParts, datasheetDetailsHTML, factionArmyRules, modStat, panelHTML } from "../js/datasheets.js?v=8.48";
import { effectiveRules } from "../js/rules-doc.js?v=8.48";
import { buffsFor, loadoutOf, weaponBase } from "../js/loadout.js?v=8.48";
import { capWords, keywordList, richHTML } from "../js/text.js?v=8.48";

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
  B = { active: true, started: Date.now(), updated: Date.now(), round: 1, phase: 0, turn: firstTurn === "opponent" ? "opponent" : "you", first: firstTurn === "opponent" ? "opponent" : "you", secondariesStyle: me.secondariesStyle || "tactical", me: player(me), them: player(them), events: [] };
  pane = "tracker"; sheet = null;
  grantPhaseCP(B);
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
    if (u.key && u.forever && p.usedForever) p.usedForever = p.usedForever.filter(k => k !== u.key);
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
/* C6: the style chosen for Secondary Missions in Battle Setup ("tactical" or "fixed"), used for Primary too — Battle
 *  Setup has only the one Fixed/Tactical toggle. A scoring line marked for only one of the two doesn't apply to a
 *  battle played the other way; a line with both values, or a plain value, applies either way. */
const scoreStyle = () => (B?.secondariesStyle === "fixed" ? "fixed" : "tactical");
const vpApplies = (v, style) => !(v && typeof v === "object") || v[style] !== undefined;
const vpValue = (v, style = scoreStyle()) => { const s = v && typeof v === "object" ? (v[style] ?? v.tactical ?? v.fixed ?? Object.values(v)[0] ?? "") : v; const n = /\d+/.exec(String(s || "")); return n ? +n[0] : 0; };
/** Every scoring line of a mission, in order (the index is its checkbox). A line from a CUMULATIVE block (e.g.
 *  "2VP per success, up to a max of 5VP") is scored by a repeat count rather than a single checkbox, capped at
 *  the block's own printed cap when there is one. */
const scoringRows = card => {
  const style = scoreStyle();
  return (card?.scoring || []).flatMap(b => {
    const blockCap = b.cap ? +String(b.cap).match(/\d+/)?.[0] || null : null;
    return b.rows.filter(r => vpApplies(r.vp, style)).map(r => ({ round: b.round, text: r.text, vp: vpText(r.vp), n: vpValue(r.vp, style), cumulative: !!b.cumulative, blockCap }));
  });
};
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
/* Once-per-battle stratagems (X3/C3) stay marked used for the rest of the battle, in a ledger that doesn't reset each phase. */
const usedForever = p => p?.usedForever || [];
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
/* X3 / C3: "RESTRICTIONS: … more than once per battle." (not "… per battle round") marks a stratagem as usable once
   in the whole battle, not just once per phase; Insane Bravery is one example, shared by every army. */
const ONCE_PER_BATTLE_RE = /\bmore than once per battle\b(?!\s*round)/i;
function strategyList(side, army) {
  const dets = army ? army.data.detachments.filter(d => (army.list.detachments || []).includes(d.name)) : [];
  const all = [...coreStratagems(), ...dets.flatMap(d => (d.det.stratagems || []).map(s => ({ ...s, group: d.name })))];
  return all.map(s => {
    const text = s.rich || s.text || "";
    return {
      owner: side, name: s.name, group: s.group,
      // The key marks a stratagem as used: the same on both phones, whichever side they're seen from. The id is for this screen.
      key: `${s.group}|${s.name}`, id: `${side}|${s.group}|${s.name}`,
      cp: String(s.cp || "").replace(/(\d+)\s*CP/gi, "$1 CP"), costs: costsOf(s.cp).length ? costsOf(s.cp) : [0],
      body: text.replace(/^\**CORE STRATAGEM\**\s*/i, ""), timing: timingOf(text), onceOnly: ONCE_PER_BATTLE_RE.test(text),
    };
  });
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
  const used = usedKeys(p).includes(s.key) || (s.onceOnly && usedForever(p).includes(s.key));
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
/* ---------- X2: army-rule choices made at a set time ---------- */
/* An army rule that opens "At the start of your Command phase…", "At the start of the battle round…" or
 *  "…the Declare Battle Formations step…" and asks you to select or choose one of its listed options. */
function timedArmyRules(armyRules) {
  const tops = (armyRules || []).filter(r => !r.partOf);
  return tops.map(r => {
    const text = r.text || r.rich || "";
    // Only the rule's opening sentence decides this: Martial Ka'tah also mentions "select" later, for a different,
    // per-unit, repeatable choice, not a single once-a-phase army-wide pick like a Combat Doctrine or a Plague.
    const lead = (text.match(/^[^.]*\./) || [text])[0];
    const timing = /^at the start of your command phase/i.test(lead) ? "command"
      : /^at the start of the battle round/i.test(lead) ? "round"
      : /\bdeclare battle formations step\b/i.test(lead) ? "pregame" : null;
    if (!timing || !/\b(select|choose)\b/i.test(lead)) return null;
    const options = armyRuleParts(r, armyRules);
    return { rule: r, timing, onceOnly: ONCE_PER_BATTLE_RE.test(text), options };
  }).filter(Boolean);
}
/* The signature that marks a choice as "made for now": a fresh choice is needed again once this changes. */
function choiceSig(b, timing) {
  if (timing === "command") return `${b.round}.${b.turn === b.first ? 0 : 1}`;
  if (timing === "round") return String(b.round);
  return "pregame";
}
/** X2 is a pop-up, shown automatically regardless of which pane/section is on screen, not a box tucked into
 *  Section 2 — so a due choice is never missed just because the player hasn't scrolled to it. */
function dueArmyChoices(army) {
  if (!army) return [];
  return timedArmyRules(army.armyRules)
    .filter(e => e.timing !== "command" || B.turn === "you")
    .map(entry => {
      const sig = choiceSig(B, entry.timing);
      const made = B.me.armyChoices?.[entry.rule.name];
      if (made?.sig === sig) return null;   // already chosen for now
      return { entry, sig };
    }).filter(Boolean);
}
/** Remembers which rules were already shown-and-dismissed for their current signature, so closing the pop-up
 *  (Cancel or Confirm) doesn't make it pop straight back up on the very next render. */
let achoiceDismissed = {};
/** Tapping an option only selects it (toggled on, nothing saved yet); Confirm is what actually applies
 *  whichever option is selected for each rule, and Cancel applies nothing. Re-opening (including manually,
 *  from the Army Rules box) starts with whatever is already chosen for now pre-selected. */
function openArmyChoiceSheet(host, due) {
  const picked = {};
  for (const { entry, sig } of due) {
    const current = B.me.armyChoices?.[entry.rule.name];
    if (current?.sig === sig) picked[entry.rule.name] = current.choice;
  }
  const render = () => due.map(({ entry }) => {
    const { rule, onceOnly, options } = entry;
    const opts = options.length ? options : [{ name: rule.name }];
    const sel = picked[rule.name];
    const btns = opts.map(o => {
      const on = sel === o.name;
      const used = onceOnly && !on && (B.me.armyChoicesUsed || []).includes(`${rule.name}|${o.name}`);
      return `<button type="button" class="btn${on ? " lb-on" : ""}" data-achoice-pick="${esc(rule.name)}|${esc(o.name)}" ${used ? "disabled" : ""}>${esc(o.name)}${used ? " (used)" : ""}</button>`;
    }).join("");
    return `<div class="bt-rule"><b>${esc(rule.name)}</b><div class="fv-rich">${richHTML(rule.rich || rule.text)}</div><div class="bt-achoicebtns">${btns}</div></div>`;
  }).join("");
  const d = openSheet(`<div class="sheet-head"><h2>Army Choice</h2><p>Select an option for each rule below, then Confirm.</p></div>
    <div class="sheet-body" id="achoiceBody">${render()}</div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-accept>Confirm</button></div>`, true, "bt-pop");
  const refresh = () => { d.querySelector("#achoiceBody").innerHTML = render(); };
  d.addEventListener("close", () => { due.forEach(({ entry, sig }) => { achoiceDismissed[entry.rule.name] = sig; }); renderTracker(host); }, { once: true });
  d.onclick = e => {
    const pick = e.target.closest("[data-achoice-pick]");
    if (pick && !pick.disabled) {
      const [ruleName, choice] = pick.dataset.achoicePick.split("|");
      picked[ruleName] = picked[ruleName] === choice ? null : choice;
      refresh();
      return;
    }
    if (e.target.closest("[data-cancel]")) { d.close(); return; }
    if (!e.target.closest("[data-accept]")) return;
    const picks = Object.entries(picked).filter(([, choice]) => choice);
    d.close();
    if (!picks.length) return;   // nothing selected: Confirm with no pick applies nothing, same as Cancel
    change(b => {
      for (const [ruleName, choice] of picks) {
        const entry = due.find(x => x.entry.rule.name === ruleName)?.entry;
        if (!entry) continue;
        const sig = choiceSig(b, entry.timing);
        b.me.armyChoices ||= {}; b.me.armyChoices[ruleName] = { sig, choice };
        if (entry.onceOnly) { b.me.armyChoicesUsed ||= []; const key = `${ruleName}|${choice}`; if (!b.me.armyChoicesUsed.includes(key)) b.me.armyChoicesUsed.push(key); }
        logEv(b, "you", { text: `Chose ${choice} for ${ruleName}` });
      }
    }, host);
  };
}
/** The Army Rules box's own "Choose…" button on a rule — lets the player make (or change) that rule's choice
 *  any time, including after cancelling the automatic pop-up without picking anything. */
function openArmyChoiceFor(host, ruleName) {
  const army = armyOf("me");
  const entry = army && timedArmyRules(army.armyRules).find(e => e.rule.name === ruleName);
  if (!entry) return;
  openArmyChoiceSheet(host, [{ entry, sig: choiceSig(B, entry.timing) }]);
}
function maybeOpenArmyChoicePrompt(host) {
  const due = dueArmyChoices(armyOf("me")).filter(d => achoiceDismissed[d.entry.rule.name] !== d.sig);
  if (!due.length) return;
  if ($("#sheet")?.open) return;
  openArmyChoiceSheet(host, due);
}

/* ---------- C2: battle-shock ---------- */
const unitAlive = (b, x) => Math.max(0, (x.models || 0) - ((b.destroyed || {})[x.id] || 0));
/** Units that need a battle-shock roll: at half (or fewer) of their starting models, but not destroyed outright. */
function battleShockList(side, army) {
  if (!army) return [];
  return army.r.entries.filter(x => x.unit).filter(x => {
    const alive = unitAlive(B, x);
    return alive > 0 && x.models > 0 && alive <= x.models / 2;
  });
}
/** The signature a battle-shock prompt was shown for: once per side's own Command phase. */
const shockDueSig = b => `${b.round}.${b.turn === b.first ? 0 : 1}`;
let shockPromptSig = null;
function openBattleShockSheet(host, units) {
  const rowHTML = x => {
    const shocked = !!(B.me.shocked || {})[x.id];
    const ld = x.unit.ds.profiles?.[0]?.LD || "";
    return `<div class="bt-shockrow${shocked ? " done" : ""}" data-shock-row="${esc(x.id)}">
      <div class="bt-shocktext"><b>${esc(nameOf(x))}</b><span>Ld ${esc(ld)}${shocked ? " · Battle-shocked" : ""}</span></div>
      <div class="bt-shockbtns"><button type="button" class="btn${!shocked ? " on" : ""}" data-shock-pass="${esc(x.id)}">Pass</button><button type="button" class="btn danger${shocked ? " on" : ""}" data-shock-fail="${esc(x.id)}">Fail</button></div>
    </div>`;
  };
  const d = openSheet(`<div class="sheet-head"><h2>Battle-shock</h2><p>These units are at half strength (or fewer models) this Command phase. Roll for each before continuing.</p></div>
    <div class="sheet-body bt-shocklist" id="shockBody">${units.map(rowHTML).join("")}</div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-close>Confirm</button></div>`, false, "bt-pop");
  d.addEventListener("close", () => renderTracker(host), { once: true });
  d.onclick = e => {
    const pass = e.target.closest("[data-shock-pass]"), fail = e.target.closest("[data-shock-fail]");
    if (!pass && !fail) return;
    const id = pass ? pass.dataset.shockPass : fail.dataset.shockFail;
    const x = units.find(u => u.id === id);
    change(b => {
      b.me.shocked ||= {};
      if (fail) b.me.shocked[id] = true; else delete b.me.shocked[id];
      logEv(b, "you", fail
        ? { badge: "Shocked", tone: "cp-minus", text: `${x ? nameOf(x) : "A unit"} failed its battle-shock roll` }
        : { text: `${x ? nameOf(x) : "A unit"} passed its battle-shock roll` });
    }, host);
    const row = d.querySelector(`[data-shock-row="${id.replace(/"/g, "")}"]`);
    if (row) row.outerHTML = rowHTML(x);
  };
}
/** Auto-fires once per own Command phase when any unit qualifies; narrower than the old box (no longer
 *  re-shown just because a unit is already marked battle-shocked). */
function maybeOpenShockPrompt(host) {
  if (B.phase !== 0 || B.turn !== "you") return;
  const sig = shockDueSig(B);
  if (shockPromptSig === sig) return;
  const units = battleShockList("me", armyOf("me"));
  if (!units.length) return;
  if ($("#sheet")?.open) return;
  shockPromptSig = sig;
  openBattleShockSheet(host, units);
}

/* ---------- X4 / X7: reminder pop-ups for timed rules that have nothing to choose ---------- */
/* X4 is scoped to rules that affect the whole army (not a single unit); X7 is scoped to a rule tied to a
 *  specific Phase/Round/Turn, whichever unit it belongs to. Both just remind — there's no choice to make, so
 *  the player applies the rule themselves and the pop-up is dismissed with Cancel or Confirm alike. "command" =
 *  your own Command phase, every round; "round" = the start of every battle round; "round1" = the start of the
 *  first battle round only. */
const REMINDER_RULES = [
  { match: /assemblage of might/i, timing: "command", label: "Assemblage of Might" },       // X4 — Adeptus Custodes
  { match: /plaguesurge/i, timing: "command", label: "Plaguesurge" },                        // X4 — Death Guard
  { match: /priority quarry/i, timing: "round1", label: "Priority Quarry" },                 // X7 — Adeptus Custodes
  { match: /miasmic bombardment/i, timing: "round", label: "Miasmic Bombardment" },          // X7 — Death Guard
  { match: /forward assault warsuit/i, timing: "round1", label: "Forward Assault Warsuit" }, // X7 — Dark Angels
];
function reminderDue(timing) {
  if (timing === "command") return B.phase === 0 && B.turn === "you";
  if (timing === "round") return B.phase === 0 && B.turn === B.first;
  if (timing === "round1") return B.round === 1 && B.phase === 0 && B.turn === B.first;
  return false;
}
const reminderSig = timing => (timing === "command" ? `${B.round}.${B.turn === B.first ? 0 : 1}` : String(B.round));
/** Every piece of rules text your own army could have a reminder match against: army rules, the chosen
 *  detachment's rules, and every unit's datasheet abilities (a reminder isn't limited to army-wide rules — X7
 *  has none of that restriction, only X4 does, and X4's own candidates already happen to be army/detachment
 *  rules rather than datasheet abilities). */
function reminderSources(army) {
  if (!army) return [];
  const out = (army.armyRules || []).map(r => ({ name: r.name, text: r.text || r.rich || "" }));
  for (const d of army.data.detachments.filter(d => (army.list.detachments || []).includes(d.name))) {
    for (const r of d.det.rules || []) out.push({ name: r.name, text: r.text || r.rich || "" });
  }
  for (const x of army.r.entries) {
    for (const a of x.unit?.ds?.abilities || []) out.push({ name: a.name, text: a.text || a.rich || "" });
  }
  return out;
}
let reminderDismissed = {};   // label -> signature already shown-and-closed, so it won't pop straight back up
function dueReminders(army) {
  const sources = reminderSources(army), due = [];
  for (const rule of REMINDER_RULES) {
    if (!reminderDue(rule.timing)) continue;
    const src = sources.find(s => rule.match.test(s.name) || rule.match.test(s.text));
    if (!src) continue;   // this army doesn't have the rule at all
    const sig = reminderSig(rule.timing);
    if (reminderDismissed[rule.label] === sig) continue;
    due.push({ rule, src, sig });
  }
  return due;
}
function openReminderSheet(host, due) {
  const body = due.map(({ rule, src }) => `<div class="bt-rule"><b>${esc(rule.label)}</b><div class="fv-rich">${richHTML(src.text)}</div></div>`).join("");
  const d = openSheet(`<div class="sheet-head"><h2>${due.length > 1 ? "Reminders" : "Reminder"}</h2><p>${due.length > 1 ? "These rules apply now." : "This rule applies now."}</p></div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-close>Confirm</button></div>`, true, "bt-pop");
  d.addEventListener("close", () => { due.forEach(({ rule, sig }) => { reminderDismissed[rule.label] = sig; }); renderTracker(host); }, { once: true });
}
function maybeOpenReminderPrompt(host) {
  const due = dueReminders(armyOf("me"));
  if (!due.length) return;
  if ($("#sheet")?.open) return;
  openReminderSheet(host, due);
}

function boxesHTML(armies) {
  const mine = lastStrats.me.filter(inWindow), theirs = lastStrats.them.filter(inWindow);
  const usable = mine.filter(s => !usedKeys(B.me).includes(s.key) && B.me.cp >= s.costs[0]).length;
  const phase = PHASE_NAMES[B.phase];
  const stratBody = mine.length ? mine.map(s => stratRow(s, B.me, true)).join("") : `<p class="bt-hint">No stratagem of yours can be used in the ${phase} phase.</p>`;
  const theirBody = theirs.length ? theirs.map(s => stratRow(s, B.them, false)).join("") : `<p class="bt-hint">Your opponent can't use a stratagem in the ${phase} phase.</p>`;
  const army = armies.me;
  const armyRules = army?.armyRules || [];
  const tops = armyRules.filter(r => !r.partOf);
  const choosable = armyRules.length ? timedArmyRules(armyRules) : [];
  const armyBody = tops.length
    ? tops.map(r => {
      const entry = choosable.find(e => e.rule.name === r.name);
      let chooseBtn = "";
      if (entry) {
        const sig = choiceSig(B, entry.timing);
        const current = B.me.armyChoices?.[r.name];
        const active = current?.sig === sig ? current.choice : null;
        chooseBtn = `<button type="button" class="btn bt-achoicebtn" data-bt-achoice-open="${esc(r.name)}">${active ? `Change choice (${esc(active)})` : "Choose…"}</button>`;
      }
      return ruleBlock(r.name, r.rich || r.text) + chooseBtn + armyRuleParts(r, armyRules).map(p => `<div class="bt-rule bt-sub"><b>${esc(p.name)}</b><div class="fv-rich">${richHTML(p.rich || p.text)}</div></div>`).join("");
    }).join("")
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
    <section class="bt-s2"><button type="button" class="bt-nextphase bt-nextphase2" data-bt-next>Next Phase <span aria-hidden="true">→</span></button>${missionsHTML()}${boxesHTML(armies)}</section>
    <div class="bt-gap" aria-hidden="true"></div>
    <section class="bt-s3">${logHTML()}</section>
  </div>`;
}
/** One mission's scoring lines, read from the pack: each round's heading, then its lines and their VP. */
function missionDetail(name, card) {
  if (!name) return `<p class="bt-hint">Not chosen yet. Set the Force Dispositions in setup.</p>`;
  if (!card) return `<div class="bt-mname">${esc(name)}</div><p class="bt-hint">Add the mission pack in Library to see how it scores.</p>`;
  const style = scoreStyle();
  return `<div class="bt-mname">${esc(name)}</div>` + card.scoring.map(b => `<div class="bt-mround"><span>${esc(b.round)}</span>${b.cap ? `<em>${esc(b.cap)}</em>` : ""}</div>${b.rows.filter(r => vpApplies(r.vp, style)).map(r => `<div class="bt-mline"><span>${esc(r.text)}</span><b>${esc(vpText(r.vp))}</b></div>`).join("")}`).join("");
}
/** The Primary and Secondary boxes above the Stratagems: each is a box like the others, and its details open inside it. */
const ARROW = `<svg class="bt-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function missionsHTML() {
  const me = B.me, them = B.them;
  // The two headers share the first row, one in each column. An open box drops from its header as a narrow stem
  // (one gap tall), then runs the full width below both headers, so its text reflows full width.
  const head = (id, label, meta, col) => {
    const open = openBoxes.has(id);
    return `<button type="button" class="bt-boxhead bt-mhead${open ? " open" : ""}" style="grid-column:${col}" data-bt-mhead="${id}" aria-expanded="${open}"><b>${label}</b><span class="bt-count">${meta}</span>${ARROW}</button>`;
  };
  const body = (id, html) => openBoxes.has(id) ? `<div class="bt-boxbody bt-mbody ${id}" style="grid-column:1 / -1">${html}</div>` : "";
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
  return `<div class="bt-mpair">${head("pri", "Primary", `${me.primary} VP`, 1)}${head("sec", "Secondary", `${me.secs.length}`, 2)}${body("pri", priBody)}${body("sec", secBody)}</div>`;
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
    <div class="bt-endrow"><button type="button" class="btn bt-pause" data-bt-pause>Leave Battle</button><button type="button" class="btn bt-end" data-bt-end>End Battle</button></div>`;
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
/* Phone and tablet: once past section one, the Next Phase button at the top of section 2 sits a standard gap under the header. */
function alignSectionTop(compact, pane) {
  if (!pane) return;
  pane.style.marginTop = compact && matchMedia("(max-width: 1279px)").matches ? "16px" : "";
}
function mountStick(compact, animate = false) {
  const host = document.querySelector("#battleHost"), header = document.querySelector("#view-battle > header");
  const pane = document.querySelector('.bt-pane[data-pane="tracker"]');
  const old = document.querySelector("#view-battle .bt-stick");
  const before = animate && old ? [...old.querySelectorAll(".bt-turn, .bt-phases")].map(el => el.getBoundingClientRect()) : null;
  const paneTop = animate && pane ? pane.getBoundingClientRect().top : null;
  const htRect = animate ? document.querySelector("#view-battle > header .bt-hturn")?.getBoundingClientRect() : null;
  const keepTop = pane ? pane.scrollTop : 0;
  document.querySelectorAll("#view-battle .bt-stick").forEach(el => el.remove());
  if (!B?.active || !host || !header) return;
  const tpl = document.createElement("template"); tpl.innerHTML = stickHTML(compact);
  const el = tpl.content.firstElementChild;
  if (compact) header.append(el); else host.prepend(el);
  alignSectionTop(compact, pane);
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
  const htNow = header.querySelector(".bt-hturn");
  if (htRect && htNow && matchMedia("(min-width: 1280px)").matches) {
    const dx = htRect.left - htNow.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.5) htNow.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: ms, easing: ease });
  }
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

/** Wound pips for a model: W of them, the wounds greying out from the right. Still used inside the full
 *  datasheet (battleDatasheet), where a weapon-loadout group has its own per-model wound tracking. */
function pipsHTML(W, lost) {
  return Array.from({ length: W }, (_, k) => `<span class="bt-hp-box${k >= W - lost ? " dead" : ""}"></span>`).join("");
}
/** The unit card's model count, in place of the old health boxes: how many models of this entry are left,
 *  out of how many it started with — this entry's own count only, not combined with any attached unit. */
function modelCountHTML(x) {
  return `<span class="bt-mcount">${unitAlive(B, x)}/${x.models || 0}</span>`;
}
function armyHTML(side, army = armyOf(side)) {
  const p = side === "me" ? B.me : B.them, st = factionStyle(p.faction || "");
  // Viewing one unit's datasheet: the back control is a small icon button inside the faction-coloured head
  // itself, rather than a separate line of text under it, with the head's own content re-centred to fit it.
  const x = sheet?.side === side ? army?.r.entries.find(e => e.id === sheet.id) : null;
  const showingDs = !!x?.unit;
  const back = showingDs ? `<button type="button" class="bt-dsback" data-bt-dsback aria-label="Back to ${esc(army?.list.name || "the army list")}">‹</button>` : "";
  const head = `<div class="bt-armyhead${showingDs ? " bt-armyhead-ds" : ""}" style="--c1:${st.c1};--c2:${st.c2}">${back}${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<div><b>${esc(p.name || (side === "me" ? "You" : "Opponent"))}</b><span>${esc(army?.list.name || p.army || "")}${army ? ` · ${army.r.total} pts` : ""}</span></div></div>`;
  if (!army) return head + `<div class="bt-hint">${side === "me" ? "Your army list isn't on this device." : "Sync with your opponent before the battle to see their army here."}</div>`;
  if (showingDs) return head + battleDatasheet(x, army, side);
  // A→Z, no categories. Every unit has its own full box; the units it is attached to or that are attached to it sit
  // beneath it at reduced size (a leader under its unit, a unit under its leader), each with its own pips.
  const entries = army.r.entries.filter(e => e.unit);
  const byId = new Map(entries.map(e => [e.id, e]));
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  const top = [...entries].sort(byName);
  // The warlord is marked on the list's own unit; the evaluated entries may not carry the flag.
  const wlId = entries.find(e => e.warlord)?.id ?? army.list.units?.find(e => e.warlord)?.id;
  const related = x => {
    const kids = entries.filter(c => c.attachTo === x.id);
    const host = x.attachTo ? byId.get(x.attachTo) : null;
    return [...kids, ...(host ? [host] : [])].sort(byName);
  };
  const card = x => {
    const isWl = x.warlord || x.id === wlId;
    const tags = [x.enh ? `<span class="lb-tag enh">${esc(x.enh)}</span>` : "", x.upg ? `<span class="lb-tag upg">${esc(x.upg)}</span>` : ""].join("");
    return `<div class="bt-unitwrap"><button type="button" class="bt-unit" data-bt-unit="${esc(x.id)}" data-side="${side}">
        <span class="bt-unit-top"><span class="bt-namewrap"><b>${esc(nameOf(x))}</b>${isWl ? `<span class="bt-wl">Warlord</span>` : ""}</span><span>${x.total} pts</span>${modelCountHTML(x)}</span>
        <span class="bt-unit-row"><span class="bt-unit-left">${x.label ? `<span class="bt-unit-orig">${esc(x.unit.name)}</span>` : ""}
        <span class="bt-unit-meta">${x.models} model${x.models === 1 ? "" : "s"}</span>${tags ? `<span class="lb-ctags">${tags}</span>` : ""}</span></span></button>
      ${related(x).map(c => `<button type="button" class="bt-unit bt-attached" data-bt-unit="${esc(c.id)}" data-side="${side}"><span aria-hidden="true">↳</span> <b>${esc(nameOf(c))}</b><span>${c.total} pts</span>${modelCountHTML(c)}</button>`).join("")}</div>`;
  };
  return head + `<div class="bt-units">${top.map(card).join("")}</div>`;
}

/** The unit as it is carried, one row per distinct loadout: the plain model, then each extra-weapon variant, then leaders
 *  on their own. A variant is named "Model - Weapon"; a leader keeps its own name. */
function rowsOf(x) {
  const rows = [];
  const groups = loadoutOf(x);
  // Plain models first, leaders last; within a group, each distinct loadout is one row (the plain one first).
  for (const g of [...groups.filter(g => !g.leader), ...groups.filter(g => g.leader)]) {
    const sigs = new Map();
    for (const s of g.models) { const k = s.join("|"); if (!sigs.has(k)) sigs.set(k, { weapons: s, n: 0 }); sigs.get(k).n++; }
    const extrasOf = sg => g.leader ? [] : sg.weapons.filter(w => !g.defaults.includes(w));
    const sorted = [...sigs.values()].sort((a, b) => extrasOf(a).length - extrasOf(b).length);
    for (const sg of sorted) {
      const ex = extrasOf(sg);
      rows.push({ name: ex.length ? `${g.name} - ${ex.map(capWords).join(" + ")}` : g.name, n: sg.n, weapons: sg.weapons, pri: g.leader ? 2 : ex.length ? 1 : 0 });
    }
  }
  if (!rows.length) rows.push({ name: nameOf(x), n: x.models || 0, weapons: [...new Set((x.unit.ds.weapons || []).map(w => weaponBase(w.name)))] });
  return rows;
}
/** Destroyed models per row. Kept per row once set; otherwise filled from the unit's total in row order. */
function splitDestroyed(b, x, rows) {
  const D = Math.min((b.destroyed || {})[x.id] || 0, x.models || 0), saved = (b.destroyedG || {})[x.id];
  if (saved?.length === rows.length && saved.reduce((s, v, i) => s + Math.min(v, rows[i].n), 0) === D) return rows.map((r, i) => Math.min(saved[i], r.n));
  let left = D;
  return rows.map(r => { const k = Math.min(left, r.n); left -= k; return k; });
}
/** A unit's datasheet for the battle: its profile, only the wargear it has, and its abilities. No options, no leader lists. */
/* C15: "Damaged X" (Core Ability 24.39) — while a model's remaining wounds are at or below X, it's damaged. The app
 *  shows the datasheet's own wording for what that does, worked out live from its current wounds, so it appears and
 *  disappears automatically as the model is wounded or healed back up. No state is stored for it. */
function damagedInfo(ds) {
  const ab = (ds.abilities || []).find(a => /^damaged\s+(\d+)\b/i.test(a.name || ""));
  const n = ab && +ab.name.match(/\d+/)[0];
  return Number.isFinite(n) ? { n, text: ab.text || ab.rich || "" } : null;
}
/* X2: the weapon-ability keywords a chosen army rule option currently grants, and to which weapon type. */
function activeChoiceOptions(side, army) {
  const p = B[side];
  if (!p?.armyChoices || !army) return [];
  const tops = (army.armyRules || []).filter(r => !r.partOf);
  const out = [];
  for (const [ruleName, rec] of Object.entries(p.armyChoices)) {
    const entry = timedArmyRules(army.armyRules).find(e => e.rule.name === ruleName);
    if (!entry || choiceSig(B, entry.timing) !== rec.sig) continue;
    const rule = tops.find(r => r.name === ruleName);
    const opt = entry.options.find(o => o.name === rec.choice) || (rec.choice === ruleName ? rule : null);
    if (opt) out.push({ rule: ruleName, name: opt.name, text: opt.text || opt.rich || "" });
  }
  return out;
}
function activeChoiceKeywords(side, army) {
  return activeChoiceOptions(side, army).flatMap(o => {
    const kws = [...o.text.matchAll(/\[([A-Z][A-Z \-]*\d*)\]/g)].map(m => `[${m[1]}]`);
    const type = /ranged attacks/i.test(o.text) ? "Ranged" : /melee attacks/i.test(o.text) ? "Melee" : null;
    return kws.map(kw => ({ type, kw }));
  });
}
function battleDatasheet(x, army, side) {
  const ds = x.unit.ds, buffs = buffsFor(x, army.r), W = Math.min(Math.max(1, +(ds.profiles?.[0]?.W) || 1), 12);
  const dmg = damagedInfo(ds);
  const choiceOpts = activeChoiceOptions(side, army);
  const choiceKws = activeChoiceKeywords(side, army);
  const counts = new Map();
  for (const g of x.loadout || []) for (const [w, n] of Object.entries(g.counts || {})) if (n > 0) counts.set(w, (counts.get(w) || 0) + n);
  const rows = rowsOf(x), dg = splitDestroyed(B, x, rows);
  const taken = [x.enh, x.upg].filter(Boolean).map(n => army.r.enhPool?.find(e => e.name === n)).filter(Boolean);
  // A profile's stat, with any attached-character buff worked in (as on the list).
  const statOf = (p, k, stat) => {
    const bs = stat ? buffs.filter(b => b.stat === stat && (!b.type || b.type === p.type)) : [];
    return { v: bs.reduce((acc, b) => modStat(acc, b.delta, b.stat), p[k]), buffed: bs.length > 0 };
  };
  const profileHTML = p => {
    const melee = p.type === "Melee";
    const cells = [["Range", "range", null], ["A", "A", "A"], [melee ? "WS" : "BS", "skill", null], ["S", "S", "S"], ["AP", "AP", "AP"], ["D", "D", "D"]];
    const extraKws = choiceKws.filter(c => !c.type || c.type === p.type).map(c => c.kw);
    const kws = [...keywordList(p.tags), ...extraKws];
    return `<div class="bt-wpn"><div class="bt-wpn-name">${esc(capWords(p.name))}</div>
      <div class="bt-wstats">${cells.map(([l, k, stat]) => { const s = statOf(p, k, stat); return `<span><small>${esc(l)}</small><b class="${s.buffed ? "lb-buffed" : ""}">${esc(s.v ?? "")}</b></span>`; }).join("")}</div>
      ${kws.length ? `<div class="bt-wkw">${kws.map(k => `<span class="fv-kw">${esc(k)}</span>`).join("")}</div>` : ""}</div>`;
  };
  let start = 0;
  const rowHTML = (r, ri) => {
    const alive = r.n - dg[ri], front = start + dg[ri];
    start += r.n;
    const lost = alive > 0 ? (B.wounds || {})[`${x.id}|${front}`] || 0 : 0;
    const pips = alive > 0 ? pipsHTML(W, lost) : "";
    const profiles = (ds.weapons || []).filter(w => r.weapons.includes(weaponBase(w.name)));
    const isDamaged = !!dmg && alive > 0 && (W - lost) <= dmg.n;
    return `<section class="bt-grp${alive ? "" : " done"}${isDamaged ? " damaged" : ""}">
      <div class="bt-grp-head"><b class="bt-grp-name">${esc(r.name)}</b>${isDamaged ? `<span class="bt-tag bt-dmgtag" title="${esc(dmg.text)}">Damaged</span>` : ""}<span class="bt-hp bt-grp-pips" data-bt-wound="${esc(x.id)}|${ri}|${sheet?.side}" title="Tap to wound this model">${pips}</span>
        <span class="bt-grp-count"><button type="button" class="bt-cnt" data-bt-gset="${esc(x.id)}|${ri}|1" aria-label="Destroy one" ${alive ? "" : "disabled"}>−</button><span class="bt-cnt-n">${alive}</span><button type="button" class="bt-cnt" data-bt-gset="${esc(x.id)}|${ri}|-1" aria-label="Revive one" ${dg[ri] ? "" : "disabled"}>+</button></span></div>
      ${isDamaged ? `<p class="bt-hint bt-dmghint">${esc(dmg.text)}</p>` : ""}
      ${profiles.map(profileHTML).join("")}
    </section>`;
  };
  const groupsHTML = rows.map(rowHTML).join("");
  // Stat lines: one per distinct statline in the datasheet, in the same style as a weapon profile (no name, no keywords).
  const seen = new Set();
  const statLines = (ds.profiles || []).filter(p => { const k = [p.M, p.T, p.SV, p.W, p.LD, p.OC].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  const statHTML = statLines.map(p => `<div class="bt-wpn bt-statline"><div class="bt-wstats">${[["M", p.M], ["T", p.T], ["Sv", p.SV], ["W", p.W], ["Ld", p.LD], ["OC", p.OC]].map(([l, v]) => `<span><small>${esc(l)}</small><b>${esc(v ?? "")}</b></span>`).join("")}</div></div>`).join("");
  return `<div class="bt-ds">
    <div class="bt-ds-head"><h3>${esc(nameOf(x))}</h3>${x.label ? `<div class="bt-unit-orig">${esc(x.unit.name)}</div>` : ""}<div class="bt-unit-meta">${x.models} model${x.models === 1 ? "" : "s"} · ${x.total} pts${x.warlord ? " · Warlord" : ""}</div></div>
    ${statHTML}
    <div class="bt-grps">${groupsHTML}</div>
    ${taken.map(e => panelHTML(`${e.upgrade ? "Upgrade" : "Enhancement"} · ${esc(e.name)}`, `<div class="fv-rich">${richHTML(e.rich || e.text)}</div>`)).join("")}
    ${choiceOpts.map(o => panelHTML(`Army Choice · ${esc(o.name)}`, `<div class="fv-rich">${richHTML(o.text)}</div>`)).join("")}
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
  const navBtn = (side, p) => { const st = factionStyle(p.faction || ""); return `<button type="button" class="bt-navbtn${pane === side ? " on" : ""}" data-bt-pane="${side}" style="--c1:${st.c1};--c2:${st.c2}">${st.img ? `<img class="bt-navmark" src="${esc(st.img)}" alt="">` : ""}<span class="bt-navtxt"><b>${esc(p.name || (side === "me" ? "You" : "Opponent"))}</b><span>${esc((side === "me" ? armies.me?.list.name : armies.them?.list?.name) || p.army || "Army")}</span></span></button>`; };
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
  const title = document.querySelector("#view-battle h1");
  if (title) {
    const act = B.turn === "you" ? B.me : B.them, rst = factionStyle(act.faction || "");
    title.innerHTML = `<button type="button" class="bt-round" data-bt-round style="--c1:${rst.c1};--c2:${rst.c2}" aria-haspopup="dialog"><span class="bt-rn">Round ${B.round}</span><span class="bt-rph">${esc(PHASES[B.phase][0])}</span></button>`;
  }
  // Compact once the scroll is past the middle of the way to the second screen (decided from where the pane was left).
  const tp = host.querySelector('.bt-pane[data-pane="tracker"]');
  // On a phone or tablet, an army list on screen takes the header strip the same way as sections past the first.
  // Wide screens: the turn sits in the header box beside Round #, whatever section is showing.
  const hdr = document.querySelector("#view-battle > header.toolbar");
  if (hdr) {
    let ht = hdr.querySelector(".bt-hturn");
    if (!ht) { ht = document.createElement("div"); ht.className = "bt-hturn"; hdr.insertBefore(ht, hdr.querySelector("#battleTools")); }
    const who = B.turn === "you" ? (B.me.name ? `${B.me.name}’s` : "Your") : `${B.them.name || "Opponent"}’s`;
    ht.textContent = `${who} turn`;
  }
  const compact = pane !== "tracker" || (!!tp && keep[1] > (tp.querySelector(".bt-s1").offsetHeight + tp.querySelector(".bt-gap").offsetHeight) / 2);
  mountStick(compact);
  if (tp) watchView(tp);
  host.querySelectorAll(".bt-pane").forEach((el, k) => { if (keep[k] != null) el.scrollTop = keep[k]; });
  // C2 and X2 are pop-ups that appear on their own, whichever pane/section is on screen, rather than a box
  // that has to be scrolled to. Checked last, after the pane is drawn, and only one at a time.
  maybeOpenArmyChoicePrompt(host);
  maybeOpenShockPrompt(host);
  maybeOpenReminderPrompt(host);
}
/** Round choice: five boxes the same width, a double gap, then Cancel. Sits over a blurred screen, not the whole of it. */
function openRoundPicker(host) {
  document.querySelectorAll(".bt-rpick").forEach(x => x.remove());   // only one picker can be open
  const rst = factionStyle((B.turn === "you" ? B.me : B.them).faction || "");
  const el = document.createElement("div");
  el.className = "bt-rpick"; el.style.cssText = `--c1:${rst.c1};--c2:${rst.c2}`;
  el.innerHTML = `<div class="bt-rscrim" data-rclose></div>
    <div class="bt-rpanel" role="dialog" aria-modal="true" aria-label="Choose the round">
      <h3>Round</h3>
      <div class="bt-rlist">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="bt-rbox${n === B.round ? " on" : ""}" data-round="${n}">Round ${n}</button>`).join("")}</div>
      <button type="button" class="bt-rcancel" data-rclose>Cancel</button>
    </div>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  el.addEventListener("click", e => {
    const r = e.target.closest("[data-round]");
    if (r) { const n = +r.dataset.round; close(); if (n !== B.round) change(b => { b.round = n; grantPhaseCP(b); }, host); return; }
    if (e.target.closest("[data-rclose]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(el);
  el.querySelector(".bt-rbox.on, .bt-rbox")?.focus();
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
  if (b.phase < PHASES.length - 1) { b.phase++; }
  else {
    // End phase done: the other player's turn; once both have had a turn, the next battle round.
    b.phase = 0;
    b.turn = FLIP[b.turn];
    if (b.turn === b.first) b.round++;
  }
  grantPhaseCP(b);
}
/* ---------- C1 / X1: Command Points gained automatically ---------- */
/* Both players gain 1 Core CP every Command phase (Core Rules 08.02) — once per player turn, so twice a round each.
   A Warlord with a "gain 1CP" battle-round ability (e.g. Aquila Commander, Transhuman Strategist) adds one more,
   once per battle round, for whichever side has it. Both are logged so they can be undone like any other CP change. */
const WARLORD_CP_RE = /start of the battle round,?\s*if a model with this ability is your\s*warlord,?\s*gain\s*1\s*cp/i;
function cpGain(b, side, amount, why) {
  const p = b[side]; if (!p) return;
  p.cp = Math.max(0, p.cp + amount);
  logEv(b, side === "me" ? "you" : "opponent", { badge: amount > 0 ? `+${amount}` : String(amount), tone: amount > 0 ? "cp-plus" : "cp-minus", text: `${amount > 0 ? "Gained" : "Spent"} a Command Point (${why}) — ${p.name || (side === "me" ? "You" : "Opponent")}`, undo: { t: "cp", d: amount } });
}
function warlordAbilityText(side) {
  const army = armyOf(side);
  if (!army) return "";
  const wlId = army.r.entries.find(e => e.warlord)?.id ?? army.list.units?.find(e => e.warlord)?.id;
  const x = wlId && army.r.entries.find(e => e.id === wlId);
  return (x?.unit?.ds?.abilities || []).map(a => `${a.text || ""} ${a.rich || ""}`).join(" \n ");
}
function grantPhaseCP(b) {
  // C1: both players gain 1 CP every Command phase, including the very first one.
  if (b.phase === 0) {
    const sig = `${b.round}.${b.turn === b.first ? 0 : 1}`;
    if (b.cpSig !== sig) {
      b.cpSig = sig;
      cpGain(b, "me", 1, "Command phase");
      cpGain(b, "them", 1, "Command phase");
    }
  }
  // X1: a Warlord ability that grants 1 CP at the start of the battle round (once per round, per side that has it).
  const rsig = String(b.round);
  b.wlSig ||= {};
  for (const side of ["me", "them"]) {
    if (b.wlSig[side] === rsig) continue;
    b.wlSig[side] = rsig;
    if (WARLORD_CP_RE.test(warlordAbilityText(side))) cpGain(b, side, 1, "Warlord ability");
  }
}

/** Spends Command Points on one of your stratagems and marks it used for this phase (and for the rest of the
 *  battle, if it's a once-per-battle stratagem like Insane Bravery). */
function spend(key, cost, host) {
  const strat = lastStrats.me.find(x => x.key === key);
  const name = strat?.name || "a stratagem";
  change(b => {
    if (cost > b.me.cp) return;
    const sg = sigOf(b);
    if (b.me.used?.sig !== sg) b.me.used = { sig: sg, keys: [] };
    if (!b.me.used.keys.includes(key)) b.me.used.keys.push(key);
    const forever = !!strat?.onceOnly;
    if (forever) { b.me.usedForever ||= []; if (!b.me.usedForever.includes(key)) b.me.usedForever.push(key); }
    b.me.cp -= cost;
    if (cost > 0) logEv(b, "you", { badge: `-${cost}`, tone: "cp-minus", text: `Spent on ${name}`, undo: { t: "cp", d: -cost, key, sig: sg, forever } });
  }, host);
}
/** Points for a mission, from the boxes ticked (or counted, for a CUMULATIVE line). Up to the round's limit;
 *  what was counted is what's recorded. */
/* C6: every scorable mission in one pop-up, with checkboxes the player can tick directly — no separate menu
 *  step. Shown automatically at the two points scoring is checked (end of the Command phase, end of your turn),
 *  and reused by the manual Score buttons on the Primary/Secondary boxes for just the one mission tapped. */
function missionBlocks() {
  const p = B.me, blocks = [];
  if (p.priMission) blocks.push({ kind: "pri", idx: null, name: p.priMission, rows: scoringRows(primaryCard(p.priMission)), rec: p.priScores.find(r => r.round === B.round) });
  p.secs.forEach((s, i) => blocks.push({ kind: "sec", idx: i, name: s.name, rows: scoringRows(missionPack()?.secondaries?.find(m => m.name === s.name)), rec: s }));
  return blocks;
}
/** Local tick/count state for one mission's rows while its pop-up is open. */
function scoreState(rows, rec) {
  if (!rec || rec.round !== B.round) return { checked: new Set(), counts: {} };
  return { checked: new Set((rec.checks || []).filter(i => !rows[i]?.cumulative)), counts: { ...(rec.counts || {}) } };
}
const scoreSum = (rows, state) => rows.reduce((a, r, i) => a + (r.cumulative ? (state.counts[i] || 0) * r.n : (state.checked.has(i) ? r.n : 0)), 0);
function scoreRowHTML(r, i, state) {
  if (r.cumulative) {
    const n = state.counts[i] || 0, atCap = r.blockCap != null && (n + 1) * r.n > r.blockCap;
    return `<div class="bt-scorerow bt-scorerow-cum"><span><i>${esc(r.round)}</i>${esc(r.text)}</span>
      <span class="bt-scorestep"><button type="button" class="btn" data-k-dec="${i}" ${n <= 0 ? "disabled" : ""}>−</button><b>${n}</b><button type="button" class="btn" data-k-inc="${i}" ${atCap ? "disabled" : ""}>+</button></span>
      <b>${n * r.n} VP</b></div>`;
  }
  return `<label class="bt-scorerow"><input type="checkbox" data-k="${i}" ${state.checked.has(i) ? "checked" : ""}><span><i>${esc(r.round)}</i>${esc(r.text)}</span><b>${r.n} VP</b></label>`;
}
/** `only` scopes the pop-up to one mission (the manual Score buttons); `timing` marks it as the automatic
 *  end-of-phase nudge, which advances to the next phase once the pop-up closes, however it was closed. */
function openScorePopup(host, { timing, only } = {}) {
  let blocks = missionBlocks();
  if (only) blocks = blocks.filter(b => b.kind === only.kind && b.idx === only.idx);
  if (!blocks.length) { if (timing) change(nextPhase, host); return; }
  const cap = capPerRound();
  const states = blocks.map(b => scoreState(b.rows, b.rec));
  const when = timing === "command" ? "the end of this Command phase" : timing === "turn" ? "the end of your turn" : null;
  const render = () => {
    let secOther = 0;
    return blocks.map((b, bi) => {
      const rows = b.rows, state = states[bi], raw = scoreSum(rows, state);
      let counted;
      if (b.kind === "pri") counted = Math.min(raw, cap);
      else { counted = Math.max(0, Math.min(raw, cap - secOther)); secOther += counted; }
      return `<div class="bt-scoreblock" data-block="${bi}">
        <h3>${esc(b.name)} <span class="bt-hint">(${b.kind === "pri" ? "Primary" : "Secondary"})</span></h3>
        ${rows.length ? rows.map((r, i) => scoreRowHTML(r, i, state)).join("") : `<p class="bt-hint">No scoring is printed for this mission in the mission pack.</p>`}
        <p class="bt-scoretot" aria-live="polite">${counted} VP this round${counted < raw ? ` (counts ${counted} of ${raw}: the round's limit is ${cap})` : ""}</p>
      </div>`;
    }).join("");
  };
  const d = openSheet(`<div class="sheet-head"><h2>Score missions?</h2>${when ? `<p>Check whether you scored at ${when} before moving on.</p>` : ""}</div>
    <div class="sheet-body bt-scorelist" id="scoreBody">${render()}</div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-accept>Confirm</button></div>`, true, "bt-pop");
  const refresh = () => { d.querySelector("#scoreBody").innerHTML = render(); };
  d.addEventListener("close", () => { if (timing) change(nextPhase, host); }, { once: true });
  d.onchange = e => {
    const k = +e.target.dataset.k; if (Number.isNaN(k)) return;
    const bi = +e.target.closest("[data-block]").dataset.block;
    e.target.checked ? states[bi].checked.add(k) : states[bi].checked.delete(k);
    refresh();
  };
  d.onclick = e => {
    const dec = e.target.closest("[data-k-dec]"), inc = e.target.closest("[data-k-inc]");
    if ((dec || inc) && !(dec || inc).disabled) {
      const bi = +(dec || inc).closest("[data-block]").dataset.block;
      const i = +(dec ? dec.dataset.kDec : inc.dataset.kInc);
      const state = states[bi], r = blocks[bi].rows[i];
      let n = state.counts[i] || 0;
      if (dec) n = Math.max(0, n - 1);
      else if (r.blockCap == null || (n + 1) * r.n <= r.blockCap) n += 1;
      state.counts[i] = n;
      refresh();
      return;
    }
    if (e.target.closest("[data-cancel]")) { d.close(); return; }
    if (!e.target.closest("[data-accept]")) return;
    change(b => {
      const pl = b.me;
      let secOther = 0;
      blocks.forEach((blk, bi) => {
        const rows = blk.rows, state = states[bi], raw = scoreSum(rows, state);
        let vp;
        if (blk.kind === "pri") vp = Math.min(raw, cap);
        else { vp = Math.max(0, Math.min(raw, cap - secOther)); secOther += vp; }
        const checks = [...state.checked].sort((x, y) => x - y), counts = { ...state.counts };
        if (blk.kind === "pri") {
          let r = pl.priScores.find(x => x.round === b.round);
          const prev = r?.vp || 0;
          if (!r) pl.priScores.push(r = { round: b.round, checks: [], counts: {}, vp: 0 });
          r.checks = checks; r.counts = counts; r.vp = vp;
          if (vp !== prev) logEv(b, "you", { badge: `${vp - prev > 0 ? "+" : ""}${vp - prev} VP`, tone: "vp", text: `${blk.name} (Primary)`, undo: { t: "score", kind: "pri", name: blk.name, round: b.round, had: true, checks: r.checks, counts: r.counts, vp: prev } });
        } else {
          const s = pl.secs[blk.idx]; if (!s) return;
          const prev = s.round === b.round ? (s.vp || 0) : 0;
          const undo = { t: "score", kind: "sec", name: s.name, round: s.round, checks: s.checks || [], counts: s.counts || {}, vp: s.vp || 0, prevRound: s.round };
          s.checks = checks; s.counts = counts; s.vp = vp; s.round = b.round;
          if (vp !== prev) logEv(b, "you", { badge: `${vp - prev > 0 ? "+" : ""}${vp - prev} VP`, tone: "vp", text: `${s.name} (Secondary)`, undo });
        }
      });
    }, host);
    d.close();
  };
}
/** Next Phase: on your own turn, a scoring nudge appears first at the end of the Command phase and the end of your turn. */
function advancePhase(host) {
  if (B.turn === "you" && B.phase === 0) { openScorePopup(host, { timing: "command" }); return; }
  if (B.turn === "you" && B.phase === PHASES.length - 1) { openScorePopup(host, { timing: "turn" }); return; }
  change(nextPhase, host);
}
/** Taking a Secondary Mission off the list asks first. Cancel does nothing. */
function openRemoveSheet(idx, host) {
  const s = B.me.secs[idx]; if (!s) return;
  const d = openSheet(`<div class="sheet-head"><h2>Remove Secondary Mission?</h2><p>${esc(s.name)} comes off your list of Secondary Missions.</p></div>
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-accept>Accept</button></div>`, false, "bt-pop");
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
    <div class="sheet-foot"><button class="btn bt-cancel" type="button" data-close>Cancel</button></div>`, true, "bt-pop");
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
    <div class="sheet-foot"><button class="btn" type="button" data-close>Cancel</button></div>`, false, "bt-pop");
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
  if (!s || usedKeys(B.me).includes(key) || (s.onceOnly && usedForever(B.me).includes(key)) || B.me.cp < s.costs[0]) return;
  if (s.costs.length > 1) openSpendSheet(s, host);
  else spend(key, s.costs[0], host);
}
const toggleIn = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));

/** The tracker's buttons inside the Battle view. */
function handleTrackerClick(e, host) {
  if (!B?.active) return false;
  const t = e.target;
  if (t.closest("[data-bt-next]")) { advancePhase(host); return true; }
  // The phase in the header bar (past section one) takes you back to the top section.
  if (t.closest(".bt-stick.compact .bt-phases")) { if (pane !== "tracker") showPane("tracker", host); const tp = host.querySelector('.bt-pane[data-pane="tracker"]'); if (tp) glideTo(tp, 0); return true; }
  if (t.closest("[data-bt-round]")) { openRoundPicker(host); return true; }
  const ph = t.closest("[data-bt-phase]");
  if (ph) { change(b => { b.phase = +ph.dataset.btPhase; grantPhaseCP(b); }, host); return true; }
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
  // X2 (army-rule choices) and C2 (battle-shock) are now pop-ups, opened automatically from renderTracker
  // and handled by their own dialog, not by clicks in the tracker pane.
  // The Primary and Secondary boxes, their Score buttons, and the Secondary Missions' rows.
  const mh = t.closest("[data-bt-mhead]");
  if (mh) {   // one of the two is open at a time: their stems would cross
    const id = mh.dataset.btMhead, was = openBoxes.has(id);
    openBoxes.delete("pri"); openBoxes.delete("sec");
    if (!was) openBoxes.add(id);
    renderTracker(host); return true;
  }
  if (t.closest("[data-bt-score]")) { openScorePopup(host, { only: { kind: "pri", idx: null } }); return true; }
  const ss = t.closest("[data-bt-secscore]");
  if (ss) { openScorePopup(host, { only: { kind: "sec", idx: +ss.dataset.btSecscore } }); return true; }
  const sd = t.closest("[data-bt-secdel]");
  if (sd) { openRemoveSheet(+sd.dataset.btSecdel, host); return true; }
  if (t.closest("[data-bt-secadd]")) { openAddSheet(host); return true; }
  const evd = t.closest("[data-bt-evdel]");
  if (evd) { change(b => { const e = (b.events || []).find(x => x.id === evd.dataset.btEvdel); if (e && !e.struck) { undoEffect(b, e); e.struck = true; } }, host); return true; }
  const box = t.closest("[data-bt-box]");
  if (box) { toggleIn(openBoxes, box.dataset.btBox); renderTracker(host); return true; }
  const srow = t.closest("[data-bt-strat]");
  if (srow) { toggleIn(openStrats, srow.dataset.btStrat); renderTracker(host); return true; }
  const gs = t.closest("[data-bt-gset]");
  if (gs) {
    const [id, r, d] = gs.dataset.btGset.split("|"), ri = +r, delta = +d;
    const x = sheet && armyOf(sheet.side)?.r.entries.find(e => e.id === id);
    if (x) change(b => {
      const rows = rowsOf(x), dg = splitDestroyed(b, x, rows);
      dg[ri] = Math.max(0, Math.min(rows[ri].n, dg[ri] + delta));
      b.destroyedG ||= {}; b.destroyedG[id] = dg;
      b.destroyed ||= {}; b.destroyed[id] = dg.reduce((s, v) => s + v, 0);
    }, host);
    return true;
  }
  // Tapping a row's pips wounds its front model; the pip greys from the right. A model with no pips left is destroyed,
  // and the next model in the row takes the wounds.
  const wb = t.closest("[data-bt-wound]");
  if (wb) {
    const [id, ri, side] = wb.dataset.btWound.split("|"), r = +ri;
    const x = armyOf(side)?.r.entries.find(e => e.id === id);
    if (x) change(b => {
      const rows = rowsOf(x), dg = splitDestroyed(b, x, rows);
      let start = 0;
      for (let i = 0; i < r; i++) start += rows[i].n;
      const key = `${id}|${start + dg[r]}`, W = Math.min(Math.max(1, +(x.unit.ds.profiles?.[0]?.W) || 1), 12);
      b.wounds ||= {};
      const lost = (b.wounds[key] || 0) + 1;
      if (lost >= W) {
        b.wounds[key] = 0;
        dg[r] = Math.min(rows[r].n, dg[r] + 1);
        b.destroyedG ||= {}; b.destroyedG[id] = dg;
        b.destroyed ||= {}; b.destroyed[id] = dg.reduce((s, v) => s + v, 0);
      } else b.wounds[key] = lost;
    }, host);
    return true;
  }
  const u = t.closest("[data-bt-unit]");
  if (u) { sheet = { side: u.dataset.side, id: u.dataset.btUnit }; renderTracker(host); host.querySelector(`.bt-pane[data-pane="${u.dataset.side}"]`)?.scrollTo(0, 0); return true; }
  if (t.closest("[data-bt-dsback]")) { sheet = null; renderTracker(host); return true; }
  const ach = t.closest("[data-bt-achoice-open]");
  if (ach) { openArmyChoiceFor(host, ach.dataset.btAchoiceOpen); return true; }
  return false;
}
/* Scrolling in the tracker is steered here, and answers at once. The first movement of a gesture decides what it does:
   - Inside a section taller than the screen, the screen scrolls with the wheel or finger until the section's far edge
     (or its top, going up). A gesture that reaches an edge stops there.
   - At an edge, or in a section that fits the screen, the gesture goes straight to the next section (down) or the one
     above (up), and glides exactly to its top. Any further movement from the same gesture, including momentum, is ignored,
     so it can't overshoot.
   A new gesture (after a short pause, or a new touch) starts from where the screen is. */
const GAP = 150, SNAP_TIME = 170, MIN_WHEEL = 2, MIN_TOUCH = 6;
let glide = null, gest = null, lastEv = 0;

/** The top of each section, in the pane's scroll coordinates. */
function sectionStarts(pane) {
  const pr = pane.getBoundingClientRect(), cur = pane.scrollTop;
  return [...pane.querySelectorAll(".bt-tracker > section")].map(s => s.getBoundingClientRect().top - pr.top + cur);
}
/** Each section's top and bottom, in the same coordinates, and the screen's height. */
function tLayout(pane) {
  const pr = pane.getBoundingClientRect(), cur = pane.scrollTop;
  const secs = [...pane.querySelectorAll(".bt-tracker > section")].map(s => { const r = s.getBoundingClientRect(); return { top: r.top - pr.top + cur, end: r.bottom - pr.top + cur }; });
  return { secs, view: pane.clientHeight };
}
const secAt = (secs, p) => { let i = 0; secs.forEach((s, j) => { if (s.top <= p + 1) i = j; }); return i; };

/** Glides exactly to a stop. Input is ignored while it runs. */
function glideTo(pane, index) {
  const from = pane.scrollTop;
  // The header changes first (section 2 and beyond use the compact strip), and that changes the view's height and
  // where each section sits. So the stop is measured after that change, not before it.
  setCompact(index >= 1);
  const target = sectionStarts(pane)[index];
  if (Math.abs(target - from) < 1) { glide = null; return; }
  const g = glide = { pane, from, to: target, t0: performance.now() };
  const step = now => {
    if (glide !== g) return;
    const k = Math.min(1, (now - g.t0) / SNAP_TIME), e = 1 - Math.pow(1 - k, 3);
    pane.scrollTop = from + (target - from) * e;
    if (k < 1) requestAnimationFrame(step);
    else {
      glide = null;
      // The header's size may have settled since the stop was measured: land exactly on the section's top.
      const t = sectionStarts(pane)[index];
      if (Math.abs(t - pane.scrollTop) >= 1) { pane.scrollTop = t; }
    }
  };
  requestAnimationFrame(step);
}
/** A glide in progress is finished at once, so a new gesture starts from its stop. */
function finishGlide() { if (glide) { glide.pane.scrollTop = glide.to; glide = null; } }

/** What a movement in direction `dir` (+1 down, -1 up) does from where the screen is now. */
function beginMove(pane, dir) {
  const { secs, view } = tLayout(pane), pos = pane.scrollTop, s = secs[secAt(secs, pos)];
  const tall = s && s.end - s.top > view + 1;
  if (tall && dir > 0 && pos < s.end - view - 1) return { mode: "free" };
  if (tall && dir < 0 && pos > s.top + 1) return { mode: "free" };
  const tops = secs.map(x => x.top);
  const index = dir > 0 ? tops.findIndex(t => t > pos + 1) : tops.reduce((a, t, k) => (t < pos - 1 ? k : a), -1);
  return index < 0 ? { mode: "done" } : { mode: "snap", index };
}
/** Scrolls a tall section by a movement, within its own top and far edge. Returns "edge" once it reaches one. */
function freeMove(pane, dy) {
  const { secs, view } = tLayout(pane), pos = pane.scrollTop, s = secs[secAt(secs, pos)];
  const lo = s.top, hi = s.end - view;
  const next = Math.min(Math.max(pos + dy, lo), hi);
  pane.scrollTop = next;
  return (dy > 0 && next >= hi - 1) || (dy < 0 && next <= lo + 1) ? "edge" : "moving";
}
/** The gesture's first movement decides it; the rest of the gesture follows that decision. */
function gestureMove(pane, dy, total) {
  if (gest.mode === "idle") {
    if (Math.abs(total) < (gest.touch ? MIN_TOUCH : MIN_WHEEL)) return;
    const m = beginMove(pane, Math.sign(total));
    gest.mode = m.mode;
    if (m.mode === "snap") glideTo(pane, m.index);
    else if (m.mode === "free" && freeMove(pane, dy) === "edge") gest.mode = "done";
    return;
  }
  if (gest.mode === "free" && freeMove(pane, dy) === "edge") gest.mode = "done";
}
function wireTrackerSnap(host) {
  const isTracker = el => el?.closest?.('.bt-pane[data-pane="tracker"]') || null;
  // Wheel: the tracker moves only by these rules, never by the browser's own scrolling.
  host.addEventListener("wheel", e => {
    const pane = isTracker(e.target);
    if (!pane || !B?.active) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    const now = performance.now(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!gest || gest.touch || now - lastEv > GAP) { finishGlide(); gest = { mode: "idle", total: 0, touch: false }; }
    lastEv = now;
    gest.total += dy;
    gestureMove(pane, dy, gest.total);
  }, { capture: true, passive: false });
  // Wide screens: the army columns scroll themselves only when they are long enough to need it; otherwise a wheel over them moves the tracker.
  host.addEventListener("wheel", e => {
    if (!matchMedia("(min-width: 1280px)").matches) return;
    const side = e.target?.closest?.('.bt-pane[data-pane="me"], .bt-pane[data-pane="them"]');
    if (!side) return;
    e.preventDefault();
    if (side.scrollHeight > side.clientHeight + 1) { side.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; return; }
    const tp = host.querySelector('.bt-pane[data-pane="tracker"]');
    tp?.dispatchEvent(new WheelEvent("wheel", { deltaY: e.deltaY, deltaX: e.deltaX, deltaMode: e.deltaMode, bubbles: true, cancelable: true }));
  }, { capture: true, passive: false });
  // Touch: a tall section follows the finger; anything else goes to the next stop as soon as the finger has moved.
  host.addEventListener("touchstart", e => {
    const pane = isTracker(e.target);
    finishGlide();
    gest = pane && B?.active ? { mode: "idle", pane, y0: e.touches[0].clientY, last: e.touches[0].clientY, touch: true, total: 0 } : null;
  }, { passive: true, capture: true });
  host.addEventListener("touchmove", e => {
    if (!gest?.touch) return;
    e.preventDefault();
    const y = e.touches[0].clientY, dy = gest.last - y;
    gest.last = y; gest.total = gest.y0 - y;
    gestureMove(gest.pane, dy, gest.total);
  }, { passive: false, capture: true });
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
/* ---------- finished battles: the record kept on the Battle screen ----------
   result: "you" = you conceded (a loss for you) · "opponent" = your opponent conceded (a loss for them) · "none" = ended at the current scores. */
const RECORDS_KEY = "rf.battles";
const FLIP_RESULT = { you: "opponent", opponent: "you", none: "none" };
/** Ends the battle in progress, saves its record, and tells the other phone. Returns the record. */
function finishBattle(result) {
  if (!B?.active) return null;
  const side = p => ({ name: p.name || "", faction: p.faction || "", score: score(p) });
  const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: Date.now(), started: B.started || Date.now(), round: B.round, result, you: side(B.me), opponent: side(B.them) };
  store.set(RECORDS_KEY, [rec, ...store.get(RECORDS_KEY, [])]);
  sendToPeer({ ended: rec });
  endTracker();
  return rec;
}
/** The other phone ended the battle: keep the same record, seen from this side, and close the tracker. */
function receiveEnded(rec) {
  if (!rec?.id) return false;
  const have = store.get(RECORDS_KEY, []);
  if (!have.some(r => r.id === rec.id)) store.set(RECORDS_KEY, [{ ...rec, result: FLIP_RESULT[rec.result] || "none", you: rec.opponent, opponent: rec.you }, ...have]);
  if (B?.active) endTracker();
  return true;
}

/* ---------- paused battles: set aside on this device, and picked up again where they were left ---------- */
const PAUSED_KEY = "rf.pausedBattles";
const pausedBattles = () => store.get(PAUSED_KEY, []);
/** Sets the battle in progress aside (with its armies) and closes the tracker. Returns false if there is nothing to pause. */
function pauseTracker() {
  if (!B?.active) return false;
  const copy = JSON.parse(JSON.stringify(B));
  store.set(PAUSED_KEY, [{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), saved: Date.now(), battle: copy, armies: JSON.parse(JSON.stringify(A)) }, ...pausedBattles()]);
  endTracker();
  return true;
}
/** Brings a paused battle back as the battle in progress. Does nothing while another battle is open. */
function resumeBattle(id) {
  const list = pausedBattles(), entry = list.find(e => e.id === id);
  if (!entry || B?.active) return false;
  A = entry.armies || { me: null, them: null }; saveArmies();
  B = entry.battle; B.active = true; B.updated = Date.now(); ensure(B); save();
  pane = "tracker"; sheet = null;
  store.set(PAUSED_KEY, list.filter(e => e.id !== id));
  return true;
}
const discardPaused = id => store.set(PAUSED_KEY, pausedBattles().filter(e => e.id !== id));

const currentBattle = () => B;

export { currentBattle, discardPaused, finishBattle, receiveEnded, pauseTracker, pausedBattles, resumeBattle, handleTrackerClick, receiveBattle, renderTracker, setTrackerSend, startTracker, trackerActive, wireTrackerSwipes };
