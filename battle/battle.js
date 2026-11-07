/* RulesForge · battle/battle.js
 * The Battle screen: "Start Battle", and the record of previous battles (newest first).
 * A record keeps both players' names as they were when the battle was played: your player name (Settings → Player)
 * and, when two devices are synced, your opponent's. Without a name, "You" and "Opponent" are shown.
 */
import { $, esc, openSheet, settingsTabsHTML, store, toast } from "../js/core.js?v=8.16";
import { factionStyle } from "../js/factions.js?v=8.16";
import { renderSetup, resumeSetup, wireSetup } from "./setup.js?v=8.16";

/* A battle record:
   { id, date: ms, you: { name, faction, score }, opponent: { name, faction, score }, ...more to come with the battle itself } */
const battles = () => store.get("rf.battles", []).slice().sort((a, b) => b.date - a.date);
const playerName = () => String(store.get("rf.playerName", "") || "").trim();

const SWORDS = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 17.5 21 6V3h-3L6.5 14.5"/><path d="m11 19-6-6M8 16l-4 4M5 21l-2-2"/></svg>`;
const CROWN = `<svg class="bt-crown" viewBox="0 0 24 24" width="26" height="20" aria-label="Winner"><path d="M3 18 2 7l5.5 4L12 4l4.5 7L22 7l-1 11z" fill="#ffcc4d" stroke="#b8860b" stroke-width="1.2" stroke-linejoin="round"/><rect x="3" y="19" width="18" height="2.4" rx="1" fill="#ffcc4d"/></svg>`;
const ddmmyyyy = ms => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };

function recordHTML(b) {
  const y = b.you || {}, o = b.opponent || {}, ys = +y.score || 0, os = +o.score || 0;
  const win = ys > os ? "you" : os > ys ? "opp" : "draw";
  const sy = factionStyle(y.faction || ""), so = factionStyle(o.faction || "");
  const side = (p, st, cls) => `<div class="bt-side ${cls}">${st.img ? `<img src="${esc(st.img)}" alt="">` : ""}<div class="bt-fname">${esc(p.faction || "Unknown faction")}</div></div>`;
  const score = (n, label, won) => `<div class="bt-score${won ? " won" : ""}">${won ? CROWN : ""}<b>${n}</b><small>${esc(label)}</small></div>`;
  return `<div class="bt-match">
    <div class="bt-mtop"><span class="bt-date">${ddmmyyyy(b.date)}</span><span class="bt-res ${win}">${win === "you" ? "Victory" : win === "opp" ? "Defeat" : "Draw"}</span></div>
    <div class="bt-mrow" style="--y1:${sy.c1};--y2:${sy.c2};--o1:${so.c1};--o2:${so.c2}">
      ${side(y, sy, "you")}
      <div class="bt-mid">${score(ys, y.name || playerName() || "You", win === "you")}<div class="bt-dash">–</div>${score(os, o.name || "Opponent", win === "opp")}</div>
      ${side(o, so, "opp")}
    </div>
  </div>`;
}

function renderBattlePage() {
  const host = $("#battleHost");
  if (!host) return;
  if (host.classList.contains("bs-on") || resumeSetup()) return renderSetup();   // setting up a battle
  const list = battles();
  host.innerHTML = `<button type="button" class="bt-start" data-bt-start>${SWORDS}Start Battle</button>
    ${list.length ? `<div class="bt-label">Previous battles · ${list.length}</div>${list.map(recordHTML).join("")}`
      : `<div class="empty">No battles yet. Start one to keep score, and it'll be recorded here.</div>`}`;
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
