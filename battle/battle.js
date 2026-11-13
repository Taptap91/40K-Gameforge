/* RulesForge · battle/battle.js
 * The Battle screen: "Start Battle", and the record of previous battles (newest first).
 * A record keeps both players' names as they were when the battle was played: your player name (Settings → Player)
 * and, when two devices are synced, your opponent's. Without a name, "You" and "Opponent" are shown.
 */
import { $, esc, openSheet, settingsTabsHTML, store, toast } from "../js/core.js?v=8.39";
import { factionStyle } from "../js/factions.js?v=8.39";
import { renderSetup, resumeSetup, wireSetup } from "./setup.js?v=8.39";
import { pausedBattles } from "./tracker.js?v=8.39";

/* A battle record:
   { id, date: ms, you: { name, faction, score }, opponent: { name, faction, score }, ...more to come with the battle itself } */
const battles = () => store.get("rf.battles", []).slice().sort((a, b) => b.date - a.date);
const playerName = () => String(store.get("rf.playerName", "") || "").trim();

const SWORDS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 17.5 21 6V3h-3L6.5 14.5"/><path d="m11 19-6-6M8 16l-4 4M5 21l-2-2"/></svg>`;
const CROWN = `<svg class="bt-rcrown" viewBox="0 0 24 24" width="22" height="18" aria-label="Higher score"><path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11z" fill="#ffcc4d" stroke="#b8860b" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="19" width="18" height="2.4" rx="1" fill="#ffcc4d"/></svg>`;
const ddmmyyyy = ms => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };

/** The scoreboard shared by finished battles and battles in progress: you on the left, your opponent on the right,
 *  names on the outside, scores inside, the faction under each name. Each outer third is in that player's faction colours,
 *  fading into the app's colours through the middle. `crown` is "you", "opp" or "" (the higher score). */
function boardHTML(y, o, crown) {
  const sy = factionStyle(y.faction || ""), so = factionStyle(o.faction || "");
  const mark = st => (st.img ? `<img class="bt-rmark" src="${esc(st.img)}" alt="">` : `<span class="bt-rmark"></span>`);
  const side = (p, cls, who) => `<div class="bt-rname ${cls}"><span class="bt-rcslot">${crown === who ? CROWN : ""}</span><b>${esc(p.name || (who === "you" ? "You" : "Opponent"))}</b><small>${esc(p.faction || "Unknown faction")}</small></div>`;
  return `<div class="bt-rrow" style="--y1:${sy.c1};--y2:${sy.c2};--o1:${so.c1};--o2:${so.c2}">
    ${mark(sy)}${side(y, "l", "you")}<div class="bt-rscore">${+y.score || 0}</div><div class="bt-rdash">–</div><div class="bt-rscore">${+o.score || 0}</div>${side(o, "r", "opp")}${mark(so)}
  </div>`;
}

function recordHTML(b) {
  const y = { ...(b.you || {}), name: (b.you || {}).name || playerName() }, o = b.opponent || {}, ys = +y.score || 0, os = +o.score || 0;
  // "none" = ended at the current scores: nobody is marked as the loser, and no crown is given.
  const result = b.result || "none";
  const tag = result === "opponent" ? ["you", "Victory"] : result === "you" ? ["opp", "Defeat"] : ["draw", "Ended at current scores"];
  const crown = result === "none" ? "" : ys > os ? "you" : os > ys ? "opp" : "";
  return `<div class="bt-match"><div class="bt-mtop"><span class="bt-date">${ddmmyyyy(b.date)}</span><span class="bt-res ${tag[0]}" title="${result === "opponent" ? esc((o.name || "Your opponent") + " conceded") : result === "you" ? "You conceded" : "Ended at the current scores"}">${tag[1]}</span></div>${boardHTML(y, o, crown)}</div>`;
}

/** A player's VP in a battle set aside, worked out from what was scored (Battle Ready 10 + Primary + Secondary), so it always shows. */
const sumVP = rows => (rows || []).reduce((n, r) => n + (+r.vp || 0), 0);
const pausedVP = p => (p.battleReady ? 10 : 0) + (p.priScores ? sumVP(p.priScores) : +p.primary || 0) + (p.secs ? sumVP(p.secs) : +p.secondary || 0);

/** A battle set aside with Leave Battle: the same scoreboard, with Resume and Delete under it. */
function pausedHTML(e) {
  const b = e.battle || {}, me = b.me || {}, them = b.them || {};
  return `<div class="bt-match"><div class="bt-mtop"><span class="bt-date">Paused ${ddmmyyyy(e.saved)}</span><span class="bt-res draw">Round ${+b.round || 1}</span></div>
    ${boardHTML({ name: me.name, faction: me.faction, score: pausedVP(me) }, { name: them.name, faction: them.faction, score: pausedVP(them) }, "")}
    <div class="bt-pbtns"><button type="button" class="btn primary bt-presume" data-bt-resume="${esc(e.id)}">Resume Battle</button><button type="button" class="btn bt-pdel" data-bt-discard="${esc(e.id)}" aria-label="Delete this paused battle">Delete</button></div></div>`;
}

/** Win and defeat rates over every battle on record (a win is your opponent conceding, a defeat is you conceding),
 *  the faction you won with most often, and the faction you lost to most often. */
function statsHTML(list) {
  const total = list.length, won = list.filter(b => b.result === "opponent"), lost = list.filter(b => b.result === "you");
  const top = arr => { const n = {}; arr.forEach(f => { if (f) n[f] = (n[f] || 0) + 1; }); return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"; };
  const pct = n => (total ? Math.round((n / total) * 100) : 0) + "%";
  const tile = (label, value, cls = "") => `<div class="bt-stat ${cls}"><small>${label}</small><b>${esc(value)}</b></div>`;
  return `<div class="bt-label">Stats</div><div class="bt-stats">
    ${tile("Win Rate", pct(won.length), "good")}${tile("Defeat Rate", pct(lost.length), "bad")}
    ${tile("Top Winning Faction", top(won.map(b => b.you?.faction)))}${tile("Nemesis Faction", top(lost.map(b => b.opponent?.faction)))}
  </div>`;
}

function renderBattlePage() {
  const host = $("#battleHost");
  if (!host) return;
  if (host.classList.contains("bs-on") || resumeSetup()) return renderSetup();   // setting up a battle
  const list = battles();
  const paused = pausedBattles();
  host.innerHTML = `<button type="button" class="bt-start" data-bt-start>${SWORDS}New Battle</button>
    ${paused.length ? `<div class="bt-label">In progress · ${paused.length}</div>${paused.map(pausedHTML).join("")}` : ""}
    ${list.length ? `<div class="bt-label">Previous battles · ${list.length}</div>${list.map(recordHTML).join("")}` : ""}
    ${statsHTML(list)}`;
}

/** Settings → Account: your username, shown on battle records instead of “You” and shared with your opponent when you sync.
 *  The first time the app is opened this screen opens by itself (once; "Not now" skips it). */
function openPlayerSheet(first = false) {
  store.set("rf.accountAsked", true);
  const d = openSheet(`${first ? "" : settingsTabsHTML("account")}
    <div class="sheet-head"><h2>${first ? "Welcome to RulesForge" : "Account"}</h2><p>${first ? "Add a username to get started. " : ""}Your username is shown on your battle records instead of “You”, and shared with your opponent when you sync for a battle. You can change it any time in Settings → Account.</p></div>
    <div class="sheet-body"><div class="field"><label for="playerName">Username</label>
      <input class="input" id="playerName" maxlength="24" autocomplete="nickname" placeholder="Your name" value="${esc(playerName())}"></div></div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>${first ? "Not now" : "Cancel"}</button><button class="btn primary" type="button" id="playerSave">Save</button></div>`);
  const save = () => { const v = $("#playerName").value.trim(); store.set("rf.playerName", v); d.close(); renderBattlePage(); toast(v ? `Username saved: ${v}` : "Username removed"); };
  $("#playerSave").onclick = save;
  $("#playerName").onkeydown = e => { if (e.key === "Enter") save(); };
  if (first) setTimeout(() => $("#playerName")?.focus(), 50);
}
/** Opens the Account screen the very first time the app is used. */
const askForAccountOnce = () => { if (!store.get("rf.accountAsked", false) && !playerName()) openPlayerSheet(true); };

function wireBattlePage() {
  wireSetup(renderBattlePage);
}

export { askForAccountOnce, battles, openPlayerSheet, playerName, renderBattlePage, wireBattlePage };
