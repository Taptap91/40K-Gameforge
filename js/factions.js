/* RulesForge · factions.js
 * Factions page: a faction's army rules, detachments and units on the left (30%), the selected one in full on the right (70%).
 */
import { $, esc, state, store } from "./core.js?v=5.5";
import { armyData } from "./army.js?v=5.5";
import { DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, panelHTML, statsHTML, tidyDatasheet, wargearOptionsHTML, weaponGridHTML } from "./datasheets.js?v=5.5";
import { factionMatches } from "./search.js?v=5.5";
import { keywordList, normName, richHTML, softenCaps } from "./text.js?v=5.5";

const fUI = { faction: store.get("rf.faction", ""), sel: null, filter: "", open: false, collapsed: new Set() };
const isPhone = () => matchMedia("(max-width: 760px)").matches;
const factionDocs = f => state.docs.filter(d => d.structured?.datasheets && factionMatches(d.faction, f));
const factionNames = () => [...new Set(state.docs.filter(d => d.structured?.datasheets && d.faction).map(d => d.faction))].sort();

/** Everything shown for one faction, merged from its documents (the newest copy of a name wins). */
function factionContent(f) {
  const docs = factionDocs(f).sort((a, b) => b.importedAt - a.importedAt);
  const seen = new Set(), add = (list, x) => { const k = normName(x.name); if (!seen.has(list + k)) { seen.add(list + k); return true; } return false; };
  const armyRules = docs.flatMap(d => d.structured.armyRules || []).filter(r => add("a", r));
  const detachments = docs.flatMap(d => d.structured.detachments || []).filter(d => add("d", d)).sort((a, b) => a.name.localeCompare(b.name));
  const datasheets = docs.flatMap(d => d.structured.datasheets || []).filter(ds => add("u", ds)).map(tidyDatasheet);
  // Points as the list builder uses them (the newest Munitorum Field Manual wins over the pack).
  const priced = new Map(armyData(f).units.map(u => [u.key, u]));
  return { armyRules, detachments, datasheets, priced };
}

function renderFactionsPage() {
  const host = $("#factionsHost"), tools = $("#factionsToolbar");
  const names = factionNames();
  if (!names.length) {
    tools.innerHTML = "";
    host.innerHTML = `<div class="fp-empty">No factions yet. Add a faction pack PDF (or a RulesForge Excel file) in Library, and its army rules, detachments and units appear here.</div>`;
    return;
  }
  if (!names.some(n => n === fUI.faction)) fUI.faction = names[0];
  tools.innerHTML = names.length > 1
    ? `<select class="select" id="fpFaction" aria-label="Faction">${names.map(n => `<option ${n === fUI.faction ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : "";
  const c = factionContent(fUI.faction);
  if (!fUI.sel) fUI.sel = c.armyRules[0] ? { t: "army", k: normName(c.armyRules[0].name) } : c.detachments[0] ? { t: "det", k: normName(c.detachments[0].name) } : null;
  host.innerHTML = `<div class="fp-shell${fUI.open ? " show-detail" : ""}">
      <div class="fp-left">${leftHTML(c)}</div>
      <div class="fp-right" id="fpRight">${rightHTML(c)}</div>
    </div>`;
  applyFilter();
}

function leftHTML(c) {
  const item = (t, k, name, meta = "") => `<button type="button" class="fp-item${fUI.sel?.t === t && fUI.sel.k === k ? " on" : ""}" data-fp="${t}" data-k="${esc(k)}" data-name="${esc(normName(name))}">
      <span class="fp-iname">${esc(softenCaps(name))}</span>${meta ? `<span class="fp-imeta">${esc(meta)}</span>` : ""}</button>`;
  const group = (id, title, items) => items.length ? `<details class="fp-grp" data-grp="${esc(id)}" ${fUI.collapsed.has(id) ? "" : "open"}>
      <summary><span class="lb-grp-title">${esc(title)} · ${items.length}</span></summary><div class="fp-items">${items.join("")}</div></details>` : "";
  const groups = DATASHEET_GROUPS.map(([title]) => ({ title, items: [] }));
  for (const ds of c.datasheets) {
    const kws = keywordList(ds.keywords).map(k => k.toUpperCase());
    groups[DATASHEET_GROUPS.findIndex(([, test]) => test(kws))].items.push(ds);
  }
  const pts = ds => { const u = c.priced.get(normName(ds.name)); const o = u?.options || ds.points || []; return o.length ? `${Math.min(...o.map(p => p.points))} pts` : ""; };
  return `<input class="input fp-filter" id="fpFilter" placeholder="Filter by name…" value="${esc(fUI.filter)}">
    ${group("army", "Army Rules", c.armyRules.map(r => item("army", normName(r.name), r.name, r.special ? "Special move" : "")))}
    ${group("det", "Detachments", c.detachments.map(d => item("det", normName(d.name), d.name, [d.dp ? String(d.dp).replace(/(\d+)\s*DP/i, "$1 DP") : "", detUnique(d) ? `Unique: ${detUnique(d)}` : ""].filter(Boolean).join(" · "))))}
    ${groups.map(g => group(g.title, g.title, g.items.sort((a, b) => a.name.localeCompare(b.name)).map(ds => item("unit", normName(ds.name), ds.name, pts(ds))))).join("")}
    <div class="fp-none" hidden>Nothing matches that name.</div>`;
}

function rightHTML(c) {
  const s = fUI.sel;
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  if (!s) return `<div class="fp-empty">Choose an army rule, detachment or unit on the left.</div>`;
  if (s.t === "army") {
    const r = c.armyRules.find(x => normName(x.name) === s.k);
    if (!r) return "";
    return `${back}<div class="fp-head"><h2>${esc(softenCaps(r.name))}</h2><div class="fp-sub">Army Rule${r.special ? " · Special move" : ""} · ${esc(fUI.faction)}</div></div>
      ${panelHTML("", `<div class="fv-rich fv-army fp-text">${richHTML(r.rich || r.text)}</div>`)}`;
  }
  if (s.t === "det") {
    const d = c.detachments.find(x => normName(x.name) === s.k);
    if (!d) return "";
    const uq = detUnique(d);
    const rivals = uq ? c.detachments.filter(o => o !== d && normName(detUnique(o)) === normName(uq)).map(o => o.name) : [];
    const rules = d.rules.filter(r => !/^unique\b/i.test(r.name));
    const priced = armyData(fUI.faction).detachments.find(x => x.name === d.name);
    const enhPts = e => priced?.enhancements.find(x => x.name === e.name)?.points ?? e.points;
    const isUp = e => priced?.enhancements.find(x => x.name === e.name)?.upgrade;
    const ab = (name, meta, body) => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(name))}${meta ? `<span class="fv-ab-ref">${esc(meta)}</span>` : ""}</div><div class="fv-rich">${body}</div></div>`;
    return `${back}<div class="fp-head"><h2>${esc(d.name)}</h2><div class="fp-sub">Detachment · ${esc(String(d.dp || "").replace(/(\d+)\s*DP/i, "$1 DP"))}</div></div>
      ${uq ? `<div class="fv-unique"><b>Unique: ${esc(uq)}</b><span>${rivals.length ? `Can't be taken in the same army as ${esc(rivals.join(", "))}.` : "No other detachment in your army may share this tag."}</span></div>` : ""}
      ${d.description ? panelHTML("", `<div class="fv-rich fp-text">${richHTML(d.description)}</div>`) : ""}
      ${rules.length ? panelHTML("Detachment Rules", rules.map(r => ab(r.name, "", richHTML(r.rich || r.text))).join("")) : ""}
      ${d.enhancements.length ? panelHTML("Enhancements", d.enhancements.map(e => ab(e.name, [enhPts(e) != null ? `${enhPts(e)} pts` : "", isUp(e) ? "Upgrade" : ""].filter(Boolean).join(" · "), richHTML(e.rich || e.text))).join("")) : ""}
      ${d.stratagems.length ? panelHTML("Stratagems", d.stratagems.map(st => ab(st.name, [String(st.cp || "").replace(/(\d+)\s*CP/i, "$1 CP"), st.category].filter(Boolean).join(" · "), richHTML(st.rich || st.text))).join("")) : ""}`;
  }
  const ds = c.datasheets.find(x => normName(x.name) === s.k);
  if (!ds) return "";
  const u = c.priced.get(normName(ds.name));
  const opts = u?.options || ds.points || [];
  const weapons = type => { const ws = (ds.weapons || []).filter(w => w.type === type); return ws.length ? panelHTML("", weaponGridHTML(ws, type, [])) : ""; };
  return `${back}<div class="fp-head"><h2>${esc(ds.name)}</h2>
      <div class="fp-sub">${opts.map(o => `${o.models} model${o.models === 1 ? "" : "s"} – ${o.points} pts`).join(" · ") || "No points listed"}${u?.pointsFrom ? ` · points from ${esc(u.pointsFrom)}` : ""}</div></div>
    ${statsHTML(ds)}${weapons("Ranged")}${weapons("Melee")}${wargearOptionsHTML(ds)}${datasheetDetailsHTML(ds, c.armyRules)}`;
}

function applyFilter() {
  const q = normName(fUI.filter);
  let shown = 0;
  for (const g of document.querySelectorAll("#factionsHost .fp-grp")) {
    let any = 0;
    for (const b of g.querySelectorAll(".fp-item")) { const hit = !q || b.dataset.name.includes(q); b.hidden = !hit; any += hit; }
    g.hidden = !any;
    if (q && any) g.open = true;
    shown += any;
  }
  const none = document.querySelector("#factionsHost .fp-none");
  if (none) none.hidden = shown > 0;
}

function wireFactionsPage() {
  const view = $("#view-factions");
  view.addEventListener("click", e => {
    const it = e.target.closest("[data-fp]");
    if (it) {
      fUI.sel = { t: it.dataset.fp, k: it.dataset.k };
      fUI.open = isPhone();
      const left = view.querySelector(".fp-left"), keep = left?.scrollTop;
      renderFactionsPage();
      if (left) view.querySelector(".fp-left").scrollTop = keep;
      view.querySelector(".fp-right").scrollTop = 0;
      return;
    }
    if (e.target.closest("[data-fp-back]")) { fUI.open = false; renderFactionsPage(); }
  });
  view.addEventListener("change", e => {
    if (e.target.id === "fpFaction") { fUI.faction = e.target.value; store.set("rf.faction", fUI.faction); fUI.sel = null; fUI.open = false; renderFactionsPage(); }
  });
  view.addEventListener("input", e => { if (e.target.id === "fpFilter") { fUI.filter = e.target.value; applyFilter(); } });
  view.addEventListener("toggle", e => {
    const g = e.target.dataset?.grp;
    if (g && !fUI.filter) e.target.open ? fUI.collapsed.delete(g) : fUI.collapsed.add(g);
  }, true);
}

export { renderFactionsPage, wireFactionsPage };
