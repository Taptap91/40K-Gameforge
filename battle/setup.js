/* RulesForge · battle/setup.js
 * Battle setup, following the mission pack's sequence in five screens:
 *   1 Game Size · 2 Muster Armies · 3 Mission & Battlefield · 4 Attacker & Defender | Secondaries · 5 Deploy and Begin
 */
import { $, esc, openSheet, state, store, toast } from "../js/core.js?v=8.8";
import { factionStyle } from "../js/factions.js?v=8.8";
import { evaluateList } from "../js/army.js?v=8.8";
import { missionCard } from "../js/mission-viewer.js?v=8.8";
import { openSync } from "./sync.js?v=8.8";
import { currentBattle, endTracker, handleTrackerClick, mirror, receiveBattle, renderTracker, setTrackerSend, startTracker, trackerActive, wireTrackerSwipes } from "./tracker.js?v=8.8";
import { confirmSheet } from "../js/core.js?v=8.8";

const DISPOSITIONS = ["Take and Hold", "Purge the Foe", "Disruption", "Reconnaissance", "Priority Assets"];
/* "and" joins words from the same step of the mission pack's sequence; "&" joins two different steps. */
const STEPS = ["Game Size", "Muster Armies", "Mission & Battlefield", "Attacker and Defender & Secondaries", "Deploy & Begin"];
/* Choices both players share: a press on one phone shows on the other. Who-is-who choices are flipped for the other phone.
   The step each player is on is their own: both go through the setup at their own pace. */
const SHARED = ["size", "layout", "twist", "defender", "firstTurn"];
const LAYOUTS = ["A", "B", "C"];
/* A player who has pressed Ready waits this long for the other to press it, then Ready is taken back. */
const READY_WAIT = 5 * 60 * 1000;
let readyTimer = 0;
const FLIP = { you: "opponent", opponent: "you" };
const SIZES = [1000, 2000];

const fresh = () => ({ step: 1, size: 2000, listId: "", disposition: "", battleReady: false, layout: "A", twist: "", defender: "", secondaries: "tactical", realCards: false, firstTurn: "", myCode: "", peerCode: "", ready: false, readyAt: 0 });
let S = { ...fresh(), ...store.get("rf.battleSetup", {}) };
let opponent = store.get("rf.battleOpponent", null);   // { name, list, faction, disposition, battleReady } (+ their faction's rules, kept in memory)
let opponentRules = null;
let sync = null, layoutsData = null, link = "none";   // link: none · connected · lost
const save = () => { store.set("rf.battleSetup", S); store.set("rf.battleOpponent", opponent); };
const set = (patch, fromPeer = false) => {
  const wasReady = S.ready;
  S = { ...S, ...patch };
  // A different battle size (from either phone) clears a list of the wrong size.
  if ("size" in patch && myList() && +myList().points !== +S.size) { S.listId = ""; S.disposition = ""; }
  // Ready belongs to the last screen: leaving it, or changing the battle size, takes it back.
  if (((("step" in patch) && patch.step !== 5) || ("size" in patch)) && S.ready) { S.ready = false; S.readyAt = 0; }
  save();
  if (sync && !fromPeer) {
    if (["disposition", "listId", "battleReady"].some(k => k in patch) || wasReady !== S.ready) sync.send({ player: myPayload(false) });
    const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => SHARED.includes(k)).map(([k, v]) => [k, (k === "defender" || k === "firstTurn") ? FLIP[v] || v : v]));
    if (Object.keys(shared).length) sync.send({ shared });
  }
  // Moving the layout slides the maps along; anything else redraws the screen.
  if (Object.keys(patch).length === 1 && "layout" in patch && slideLayout(S.layout)) return;
  render();
  checkBegin();
};

const myList = () => state.lists.find(l => l.id === S.listId && l.version === 2);
const listsForSize = () => state.lists.filter(l => l.version === 2 && +l.points === +S.size);
const missionPack = () => state.docs.filter(d => d.kind === "missions").sort((a, b) => b.importedAt - a.importedAt)[0]?.structured?.missionPack;
const username = () => String(store.get("rf.playerName", "") || "").trim();

/** What this player sends when syncing: name, army list, its faction's rules and units, disposition, Battle Ready. */
function myPayload(full = true) {
  const list = myList();
  const p = { code: S.myCode, name: username(), list: list ? { name: list.name, faction: list.faction, points: list.points, detachments: list.detachments, units: list.units } : null, faction: list?.faction || "", disposition: S.disposition, battleReady: S.battleReady, ready: !!S.ready, readyAt: S.readyAt || 0 };
  if (full) p.shared = Object.fromEntries(SHARED.map(k => [k, S[k]]));
  if (full && trackerActive()) p.battle = currentBattle();
  if (full && list) {
    const doc = state.docs.filter(d => d.kind === "faction" && d.faction === list.faction && d.structured?.datasheets).sort((a, b) => b.importedAt - a.importedAt)[0];
    if (doc) p.rules = { title: doc.title, faction: doc.faction, structured: doc.structured, theme: doc.theme || null };
  }
  return p;
}
function receive(p, fullHello) {
  if (!p) return;
  // The battle tracker: the other phone began the battle, or changed something on it.
  if (p.battle) { receiveBattle(p.battle, $("#battleHost"), armies()); if (!fullHello) return render(); delete p.battle; }
  if (fullHello) {
    const again = !!opponent && S.peerCode === sync?.peerCode;
    opponentRules = p.rules || null; delete p.rules; opponent = { ...p };
    S.peerCode = sync?.peerCode || S.peerCode; save();
    toast(again ? `Reconnected with ${p.name || "your opponent"}` : `Synced with ${p.name || "your opponent"}`); closeSyncSheet();
    // The first time two phones meet, the one that entered the code takes on the other's shared choices.
    if (!again && p.shared) set(Object.fromEntries(Object.entries(p.shared).map(([k, v]) => [k, (k === "defender" || k === "firstTurn") ? FLIP[v] || v : v])), true);
  } else if (p.player) opponent = { ...(opponent || {}), ...p.player };
  else if (p.shared) return set(p.shared, true);
  save(); render(); checkBegin();
}

/* ---------- pieces ---------- */
const toggle = (key, options, value) => `<div class="bs-toggle" role="radiogroup" style="--n:${options.length}">${options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" class="${String(v) === String(value) ? "on" : ""}" data-bs-set="${key}" data-v="${esc(v)}">${l}</button>`).join("")}</div>`;
const section = (title, body) => `<section class="bs-section">${title ? `<h3>${title}</h3>` : ""}${body}</section>`;
const nextBtn = (label, step) => `<button type="button" class="bs-next" data-bs-step="${step}">${label} <span aria-hidden="true">→</span></button>`;

function armyBox(list, who) {
  if (!list) return `<button type="button" class="bs-army empty" data-bs-pick>${who === "me" ? `Choose your ${S.size} pts army list` : ""}<span class="bs-caret">▾</span></button>`;
  const st = factionStyle(list.faction), r = state.lists.includes(list) ? evaluateList(list) : null;
  return `<button type="button" class="bs-army" data-bs-pick style="--c1:${st.c1};--c2:${st.c2}">
    ${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<span class="bs-army-t"><b>${esc(list.name)}</b><span>${esc(list.faction)}${r ? ` · ${r.total} / ${list.points} pts` : ""}</span></span><span class="bs-caret">▾</span></button>`;
}

function screen1() {
  return section("", `<div class="bs-field"><label>Battle size</label>${toggle("size", SIZES.map(s => [s, `${s.toLocaleString()} pts`]), S.size)}</div>`) + nextBtn("Armies", 2);
}

function screen2() {
  const list = myList();
  // Only one Force Disposition available: it's chosen for you.
  if (list) { const av = dispositionsFor(list).list; if (av.length === 1 && S.disposition !== av[0]) { S.disposition = av[0]; save(); sync?.send({ player: myPayload(false) }); } else if (S.disposition && !av.includes(S.disposition)) { S.disposition = ""; save(); } }
  const dets = list?.detachments || [];
  const opp = opponent;
  return section("", `<div class="bs-user">${esc(username() || "You")}</div>
      ${armyBox(list, "me")}
      ${dets.length ? `<div class="bs-dets">${dets.map(d => `<span>${esc(d)}</span>`).join("")}</div>` : list ? `<div class="bs-hint">No detachment chosen in this list yet.</div>` : ""}
      ${list ? `<div class="bs-field"><label>Force Disposition</label>${dispositionsFor(list).list.length === 1 ? `<div class="bs-disp only on">${esc(dispositionsFor(list).list[0])}</div>` : `<div class="bs-disps">${dispositionsFor(list).list.map(d => `<button type="button" class="bs-disp${S.disposition === d ? " on" : ""}" data-bs-set="disposition" data-v="${esc(d)}">${esc(d)}</button>`).join("")}</div>`}
        ${dispositionsFor(list).known ? "" : `<div class="bs-hint">Which Force Dispositions these detachments allow isn't known yet, so all five are offered. Add this faction's PDF again (Factions → Library) to read them from its detachments.</div>`}</div>` : ""}
      <label class="bs-check"><input type="checkbox" data-bs-check="battleReady" ${S.battleReady ? "checked" : ""}><span><b>Battle Ready</b><small>Fully painted: +10VP</small></span></label>`)
    + section("Opponent", opp ? `<div class="bs-opp">
        <div class="bs-user">${esc(opp.name || "Opponent")}</div>${opp.list ? armyBoxStatic(opp.list) : ""}
        ${opp.list?.detachments?.length ? `<div class="bs-dets">${opp.list.detachments.map(d => `<span>${esc(d)}</span>`).join("")}</div>` : ""}
        <div class="bs-hint">${opp.disposition ? `Force Disposition: <b>${esc(opp.disposition)}</b>` : "Hasn't chosen a Force Disposition yet."}${opp.battleReady ? " · Battle Ready" : ""}</div></div>
        <button type="button" class="btn bs-sync-again" data-bs-sync>Sync again</button>`
      : `<button type="button" class="bs-sync" data-bs-sync>Sync with Opponent</button>`)
    + nextBtn("Mission & Battlefield", 3);
}
/** The Force Dispositions an army list can choose: those of its selected detachments (all five while that isn't known). */
function dispositionsFor(list) {
  const docs = state.docs.filter(d => d.kind === "faction" && d.faction === list.faction);
  const found = new Set();
  for (const name of list.detachments || []) for (const doc of docs) {
    const det = doc.structured?.detachments?.find(x => x.name === name);
    for (const fd of det?.dispositions || []) if (DISPOSITIONS.includes(fd)) found.add(fd);
  }
  return found.size ? { known: true, list: DISPOSITIONS.filter(d => found.has(d)) } : { known: false, list: DISPOSITIONS };
}
const armyBoxStatic = list => { const st = factionStyle(list.faction); return `<div class="bs-army static" style="--c1:${st.c1};--c2:${st.c2}">${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<span class="bs-army-t"><b>${esc(list.name)}</b><span>${esc(list.faction)} · ${list.points} pts</span></span></div>`; };

function primaryFor(mine, theirs) {
  const pack = missionPack();
  const name = pack?.dispositions.find(d => d.name === mine)?.missions.find(m => m.vs === theirs)?.mission;
  return { name, card: name ? pack.primaries.find(p => p.name === name) : null };
}
function layoutsFor(a, b) {
  if (!layoutsData) return null;
  const out = {};
  for (const l of layoutsData.layouts) for (const u of l.uses) if ((u.you === a && u.opponent === b) || (u.you === b && u.opponent === a)) out[u.layout] = l;
  return out;
}
function screen3() {
  const pack = missionPack(), mine = S.disposition, theirs = opponent?.disposition || S.oppDisposition || "";
  if (!pack) return section("", `<div class="bs-hint">Add a mission pack PDF in Factions → Library to see Primary Missions and Twists here.</div>`) + nextBtn("Attacker and Defender", 4);
  const need = !mine ? "Choose your Force Disposition on step 2." : !theirs ? "Sync with your opponent (step 2) to get their Force Disposition, or choose it here:" : "";
  const manual = mine && !opponent?.disposition ? `<div class="bs-disps">${DISPOSITIONS.map(d => `<button type="button" class="bs-disp${S.oppDisposition === d ? " on" : ""}" data-bs-set="oppDisposition" data-v="${esc(d)}">${esc(d)}</button>`).join("")}</div>` : "";
  let mission = "";
  if (mine && theirs) {
    const me = primaryFor(mine, theirs), them = primaryFor(theirs, mine);
    mission = `<div class="bs-pair"><span>${esc(mine)}</span><i>vs</i><span>${esc(theirs)}</span></div>
      ${me.card ? missionCard(me.card, "primary") : `<div class="bs-hint">Your Primary Mission: ${esc(me.name || "not found in the mission pack")}</div>`}
      ${them.name ? `<div class="bs-hint">${esc(opponent?.name || "Your opponent")}'s Primary Mission: <b>${esc(them.name)}</b></div>` : ""}`;
  }
  const lays = mine && theirs ? layoutsFor(mine, theirs) : null;
  const twist = pack.twists.find(t => t.name === S.twist);
  return section("Primary Mission", (need ? `<div class="bs-hint">${need}</div>` : "") + manual + mission)
    + (lays ? section("Battlefield", `${toggle("layout", LAYOUTS.map(k => [k, `Layout ${k}`]), S.layout)}
        <div class="bs-mapwin"><div class="bs-maptrack" style="transform:translateX(${-LAYOUTS.indexOf(S.layout) * 100}%)">${LAYOUTS.map(k => { const l = lays[k]; return `<div class="bs-mapslide">${l ? `<figure class="bs-map"><img src="battle/maps/${esc(l.image)}" alt="Layout ${k} terrain map"><figcaption>${esc(l.deployment)} · Layout ${k}</figcaption></figure>` : `<div class="bs-hint">No map for this layout.</div>`}</div>`; }).join("")}</div></div>`) : "")
    + section("Twist <small>(Optional)</small>", `<div class="bs-twistrow"><button type="button" class="btn" data-bs-twist-random>Draw Randomly</button>
        <select class="select bs-twistsel" data-bs-twist><option value="">No twist</option>${pack.twists.map(t => `<option ${t.name === S.twist ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        ${twist ? `<article class="mc mc-twist"><header><h3>${esc(twist.name)}</h3><span>Twist</span></header>${twist.flavour ? `<p class="mc-flavour">${esc(twist.flavour)}</p>` : ""}${twist.text.split("\n").map(p => `<p>${esc(p)}</p>`).join("")}${twist.note ? `<p class="mc-note"><b>Designer’s note:</b> ${esc(twist.note)}</p>` : ""}</article>` : ""}`)
    + nextBtn("Attacker and Defender", 4);
}

function screen4() {
  return section("", `<div class="bs-q">Who is the Defender?</div><div class="bs-hint">Each player rolls a D6, highest roll picks who is defender.<br>Defender deploys first.</div>
      ${toggle("defender", [["you", esc(username() || "You")], ["opponent", esc(opponent?.name || "Opponent")]], S.defender)}`)
    + section("Secondary Missions", `${toggle("secondaries", [["tactical", "Tactical"], ["fixed", "Fixed"]], S.secondaries)}
      <label class="bs-check"><input type="checkbox" data-bs-check="realCards" ${S.realCards ? "checked" : ""}><span><b>Draw with Real Cards</b></span></label>`)
    + nextBtn("Deploy & Begin", 5);
}

/** Step 5's Ready: each player presses it on their own phone; the battle begins once both have. */
function readyBlock() {
  const linked = !!opponent && !!S.peerCode, name = esc(opponent?.name || "your opponent");
  const status = !linked ? "Sync with your opponent (step 2) before you can be ready."
    : S.ready ? (opponent?.ready ? "Both ready — starting the battle…" : `Waiting for ${name} to press Ready…`)
    : (opponent?.ready ? `${name} is ready.` : `${name} hasn't pressed Ready yet.`);
  return `<div class="bs-ready"><div class="bs-hint">${status}</div>
    <button type="button" class="bs-begin${S.ready ? " on" : ""}" data-bs-ready ${linked && myList() ? "" : "disabled"}>${S.ready ? "Ready ✓ · tap to undo" : "Ready"}</button></div>`;
}
function screen5() {
  const steps = [["Declare Battle Formations", "Declare which units are starting the game in strategic reserve and Deep Strike."],
    ["Deploy Armies", "Starting with the player who was chosen to deploy first, alternate deploying units until none are left."],
    ["Determine who goes first", "Roll off with opponent, highest roll must go first."],
    ["Resolve Pre-Battle Rules", "Perform Scout movements and any other rules that occur before the first turn begins."]];
  return section("First Turn", `${toggle("firstTurn", [["you", esc(username() || "You")], ["opponent", esc(opponent?.name || "Opponent")]], S.firstTurn)}
      <div class="bs-hint">Each player rolls a D6, highest roll must go first.</div>`)
    + `<ol class="bs-seq">${steps.map(([h, t]) => `<li><h4>${h}</h4><p>${t}</p></li>`).join("")}</ol>
      ${readyBlock()}`;
}

/** Slides the maps to the layout chosen, in place, so the change animates (no redraw, no reload). */
function slideLayout(v) {
  const host = $("#battleHost"), track = host?.querySelector(".bs-maptrack"), i = LAYOUTS.indexOf(v);
  if (!track || i < 0) return false;
  track.style.transform = `translateX(${-i * 100}%)`;
  host.querySelectorAll("[data-bs-set=layout]").forEach(b => { const on = b.dataset.v === v; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  return true;
}

function render() {
  const host = $("#battleHost");
  if (!host || !host.classList.contains("bs-on")) return;
  if (trackerActive()) { clearTimeout(readyTimer); host.classList.add("bt-on"); renderTracker(host); tools(); return; }
  host.classList.remove("bt-on");
  const body = [screen1, screen2, screen3, screen4, screen5][S.step - 1]();
  host.innerHTML = `<div class="bs-topbar"><button type="button" class="bs-back" data-bs-back aria-label="Back">‹</button><div class="bs-steps" role="tablist" aria-label="Battle setup steps">${STEPS.map((t, i) => `<button type="button" role="tab" class="${S.step === i + 1 ? "on" : ""}${i + 1 < S.step ? " done" : ""}" aria-selected="${S.step === i + 1}" data-bs-step="${i + 1}" title="${esc(t)}">${i + 1}</button>`).join("")}</div></div>
    <h2 class="bs-title"><span>${S.step}.</span><span>${esc(STEPS[S.step - 1])}</span></h2>${body}`;
  tools();
  armReadyWait();
  if (!layoutsData) fetch("battle/maps/layouts.json").then(r => r.json()).then(j => { layoutsData = j; render(); }).catch(() => {});
}

/* ---------- the sync overlay ---------- */
let syncSheet = null;
function openSyncSheet() {
  if (!myList()) return toast("Choose your army list first.");
  startSync(false);
  closeSyncSheet(true);
  syncSheet = document.createElement("div");
  syncSheet.className = "bs-overlay";
  syncSheet.innerHTML = `<div class="bs-scrim" data-bs-sync-cancel></div><div class="bs-sheet" role="dialog" aria-label="Sync with opponent">
      <div class="bs-grab"></div><h3>Sync with Opponent</h3>
      <div class="bs-code-l">Your code</div><div class="bs-code">${sync.code.split("").map(c => `<span>${c}</span>`).join("")}</div>
      <div class="bs-hint">Your opponent enters this code, or enter theirs below.</div>
      <input class="input bs-code-in" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Opponent's code">
      <div class="bs-sync-status" aria-live="polite"></div>
      <button type="button" class="btn bs-cancel" data-bs-sync-cancel>Cancel</button></div>`;
  document.body.append(syncSheet);
  requestAnimationFrame(() => syncSheet.classList.add("open"));
  const inp = syncSheet.querySelector(".bs-code-in");
  inp.focus();   // ready to type the opponent's code
  inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (inp.value.length === 6) sync.connect(inp.value); });
  syncSheet.addEventListener("click", e => { if (e.target.closest("[data-bs-sync-cancel]")) closeSyncSheet(); });
}
function closeSyncSheet(now) {
  const el = syncSheet; syncSheet = null;
  if (!el) return;
  if (now) return el.remove();
  el.classList.remove("open"); setTimeout(() => el.remove(), 320);
}

function pickList() {
  const lists = listsForSize();
  const d = openSheet(`<div class="sheet-head"><h2>Your ${S.size.toLocaleString()} pts army</h2><p>${lists.length ? "Choose the army list you're playing." : `No ${S.size.toLocaleString()} pts lists yet. Make one in Army Lists, or change the battle size on step 1.`}</p></div>
    <div class="sheet-body bs-picklist">${lists.map(l => { const st = factionStyle(l.faction); return `<button type="button" class="bs-army${l.id === S.listId ? " sel" : ""}" data-list="${l.id}" style="--c1:${st.c1};--c2:${st.c2}">${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<span class="bs-army-t"><b>${esc(l.name)}</b><span>${esc(l.faction)}</span></span></button>`; }).join("")}</div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Close</button></div>`);
  d.querySelector(".bs-picklist").onclick = e => { const b = e.target.closest("[data-list]"); if (!b) return; d.close(); set({ listId: b.dataset.list, disposition: "" }); };
}

/** Back on the Battle screen after closing or refreshing the app mid-setup: carry on where you were
 *  (with Reconnect showing if you had synced with an opponent). */
const resumeSetup = () => { if (!S.active && !trackerActive()) return false; $("#battleHost").classList.add("bs-on"); return true; };

/* Top right: Reconnect (when the two phones have lost each other) and Cancel. */
function tools() {
  const el = $("#battleTools");
  if (!el) return;
  const lost = !!S.peerCode && link !== "connected";
  el.innerHTML = `${lost ? `<button type="button" class="btn bs-reconnect" data-bs-reconnect>⟳ Reconnect</button>` : S.peerCode ? `<span class="bs-linked" title="Connected to ${esc(opponent?.name || "your opponent")}">● Synced</span>` : ""}${trackerActive() ? "" : `<button type="button" class="btn" data-bs-exit>Cancel</button>`}`;
}
const STATUS_TEXT = { waiting: "Waiting for your opponent…", connecting: "Connecting…", connected: "Connected — swapping armies…", "not-found": "No one is waiting with that code.", offline: "Can't reach the internet: only another copy of RulesForge in this browser can pair.", lost: "Connection lost." };
function startSync(reconnect) {
  sync?.close();
  sync = openSync({ code: reconnect ? S.myCode : undefined, peerCode: reconnect ? S.peerCode : "", getPayload: () => myPayload(true), onPeer: p => receive(p, true), onUpdate: p => receive(p, false),
    onStatus: st => {
      const el = syncSheet?.querySelector(".bs-sync-status"); if (el) el.textContent = STATUS_TEXT[st] || "";
      const was = link;
      if (st === "connected") link = "connected"; else if (st === "lost") { link = "lost"; toast("Lost the connection to your opponent. Tap Reconnect."); }
      if (was !== link) tools();
    } });
  if (!reconnect) { S.myCode = sync.code; S.peerCode = ""; save(); }
  setTrackerSend(m => sync?.send(m));
  return sync;
}

/* Keeps the five-minute wait running while this player is Ready and the other isn't (it survives a redraw or reload). */
function armReadyWait() {
  clearTimeout(readyTimer); readyTimer = 0;
  if (!S.ready || opponent?.ready || !S.readyAt) return;
  readyTimer = setTimeout(() => {
    if (!S.ready || opponent?.ready) return;
    set({ ready: false, readyAt: 0 });
    toast(`${opponent?.name || "Your opponent"} didn't press Ready within 5 minutes. Press Ready again when they're set.`);
  }, Math.max(0, S.readyAt + READY_WAIT - Date.now()));
}
/* Both players have pressed Ready: whoever pressed second starts the battle, and the other phone takes it on when it arrives. */
function checkBegin() {
  if (trackerActive() || !S.ready || !opponent?.ready || !S.peerCode || !myList()) return;
  if ((S.readyAt || 0) < (opponent.readyAt || 0)) return;
  beginBattle();
}
function beginBattle() {
  const list = myList();
  // Each player's Primary Mission, from the two Force Dispositions (the same pairing the setup screen showed).
  const theirDisp = opponent?.disposition || S.oppDisposition || "";
  const myPrimary = S.disposition && theirDisp ? primaryFor(S.disposition, theirDisp).name : "";
  const theirPrimary = S.disposition && theirDisp ? primaryFor(theirDisp, S.disposition).name : "";
  const b = startTracker({ me: { name: username(), faction: list.faction, battleReady: S.battleReady, army: list.name, mission: myPrimary }, them: { name: opponent?.name || "", faction: opponent?.faction || opponent?.list?.faction || "", battleReady: !!opponent?.battleReady, army: opponent?.list?.name || "", mission: theirPrimary }, firstTurn: S.firstTurn || "you" }, m => sync?.send(m), armies());
  sync?.send({ battle: b });
  render();
}

function startSetup() {
  const host = $("#battleHost");
  S = { ...fresh(), size: S.size || 2000, active: true }; opponent = null; opponentRules = null; sync?.close(); sync = null; link = "none"; save();
  host.classList.add("bs-on"); render();
}
function exitSetup(renderHome) {
  S.active = false; save();
  $("#battleHost").classList.remove("bs-on"); $("#battleTools").innerHTML = ""; $("#view-battle h1").textContent = "Battle"; document.querySelectorAll("#view-battle .bt-stick").forEach(el => el.remove()); sync?.close(); sync = null; closeSyncSheet(true); renderHome();
}

/** The two armies for the battle screens: your list (by id) and your opponent's synced list with their faction's rules. */
const armies = () => ({ me: S.listId ? { listId: S.listId } : null, them: opponent?.list ? { list: opponent.list, rules: opponentRules } : null });

function wireSetup(renderHome) {
  const view = $("#view-battle");
  wireTrackerSwipes($("#battleHost"));
  view.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-bt-start]")) return startSetup();
    if (handleTrackerClick(e, $("#battleHost"))) return tools();
    if (t.closest("[data-bt-end]")) {
      confirmSheet("End this battle?", "The battle tracker closes on this device. (Saving the result to your battle records comes next.)", "End Battle").then(ok => { if (!ok) return; endTracker(); exitSetup(renderHome); });
      return;
    }
    if (t.closest("[data-bs-exit]")) return exitSetup(renderHome);
    // Reconnect: both phones listen on the codes they first connected with and look for each other again.
    if (t.closest("[data-bs-reconnect]")) { startSync(true); toast("Looking for your opponent…"); return; }
    if (t.closest("[data-bs-back]")) { if (S.step > 1) { set({ step: S.step - 1 }); view.querySelector(".scroll").scrollTop = 0; } else exitSetup(renderHome); return; }
    const st = t.closest("[data-bs-step]");
    if (st) { set({ step: +st.dataset.bsStep }); view.querySelector(".scroll").scrollTop = 0; return; }
    const sv = t.closest("[data-bs-set]");
    if (sv) { const k = sv.dataset.bsSet, v = sv.dataset.v; set({ [k]: k === "size" ? +v : v }); return; }
    if (t.closest("[data-bs-pick]")) return pickList();
    if (t.closest("[data-bs-sync]")) return openSyncSheet();
    if (t.closest("[data-bs-twist-random]")) {
      const tw = missionPack()?.twists || [];
      if (tw.length) { const r = crypto.getRandomValues(new Uint32Array(1))[0] % tw.length; set({ twist: tw[r].name }); toast(`Twist drawn: ${tw[r].name}`); }
      return;
    }
    if (t.closest("[data-bs-ready]")) {
      if (!opponent || !S.peerCode) return toast("Sync with your opponent first.");
      return set({ ready: !S.ready, readyAt: S.ready ? 0 : Date.now() });
    }
  });
  view.addEventListener("change", e => {
    const c = e.target.closest("[data-bs-check]"); if (c) set({ [c.dataset.bsCheck]: c.checked });
    if (e.target.matches("[data-bs-twist]")) set({ twist: e.target.value });
  });
}

export { render as renderSetup, resumeSetup, wireSetup };
