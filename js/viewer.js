/* RulesForge · viewer.js
 * Library → View: the faction viewer (datasheets, detachments, army rules).
 */
import { $, $$, esc, openSheet, state } from "./core.js?v=5.3";
import { DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, lowestPoints, panelHTML, statsHTML, tidyDatasheet, wargearOptionsHTML, weaponGridHTML } from "./datasheets.js?v=5.3";
import { keywordList, normName, richHTML } from "./text.js?v=5.3";

function openDataViewer(docId) {
  const doc = state.docs.find(d => d.id === docId);
  if (!doc?.structured) return;
  const d = doc.structured;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const row = (name, value, bodyHTML, opts = {}) => `
    <details class="fv-row${opts.sub ? " fv-sub" : ""}${opts.dim ? " fv-dim" : ""}" data-name="${esc(normName(name))}">
      <summary><span class="fv-name">${esc(name)}</span><span class="fv-val">${esc(value || "")}</span></summary>
      <div class="fv-body">${bodyHTML}</div>
    </details>`;
  const panel = (title, inner, extraClass = "") => panelHTML(esc(title), inner, extraClass);
  const weaponsPanel = (ds, type) => {
    const ws = ds.weapons.filter(w => w.type === type);
    return ws.length ? panelHTML("", weaponGridHTML(ws, type, [])) : "";
  };
  const datasheetHTML = ds => [statsHTML(ds), weaponsPanel(ds, "Ranged"), weaponsPanel(ds, "Melee"), wargearOptionsHTML(ds), datasheetDetailsHTML(ds, d.armyRules)].join("");

  // Datasheets, grouped by role, alphabetical within each group
  const groups = DATASHEET_GROUPS.map(([title]) => ({ title, items: [] }));
  for (const ds of d.datasheets) {
    tidyDatasheet(ds);
    const kws = keywordList(ds.keywords).map(k => k.toUpperCase());
    groups[DATASHEET_GROUPS.findIndex(([, test]) => test(kws))].items.push(ds);
  }
  const dsPane = groups.filter(g => g.items.length).map(g => `
    <div class="fv-group"><div class="fv-group-title">${esc(g.title)}</div><div class="fv-list">
      ${g.items.sort((a, b) => a.name.localeCompare(b.name)).map(ds => {
        const low = lowestPoints(ds);
        return row(ds.name, low != null ? `${low} points` : "", datasheetHTML(ds));
      }).join("")}
    </div></div>`).join("");

  // Detachments, alphabetical
  const detPane = `<div class="fv-group"><div class="fv-group-title">Detachments</div><div class="fv-list">${d.detachments.slice().sort((a, b) => a.name.localeCompare(b.name)).map(det => {
    const uq = detUnique(det);
    const dp = (det.dp ? det.dp.replace(/(\d+)\s*DP/i, "$1 DP") : "") + (uq ? ` · Unique: ${uq}` : "");
    const rivals = uq ? d.detachments.filter(o => o !== det && normName(detUnique(o)) === normName(uq)).map(o => o.name) : [];
    const inner = [
      uq ? `<div class="fv-unique"><b>Unique: ${esc(uq)}</b><span>${rivals.length ? `Can't be taken in the same army as ${esc(rivals.join(", "))}.` : "No other detachment in your army may share this tag."}</span></div>` : "",
      det.rules.some(r => !/^unique\b/i.test(r.name)) ? panel("Detachment Rules", det.rules.filter(r => !/^unique\b/i.test(r.name)).map(r => `<div class="fv-ab"><div class="fv-ab-name">${esc(r.name)}</div><div class="fv-rich">${richHTML(r.rich || r.text)}</div></div>`).join("")) : "",
      det.enhancements.length ? panel("Enhancements", `<div class="fv-sublist">${det.enhancements.map(e => row(e.name, e.points != null ? `${e.points} Points` : "", `<div class="fv-rich">${richHTML(e.rich || e.text)}</div>`, { sub: true })).join("")}</div>`) : "",
      det.stratagems.length ? panel("Stratagems", `<div class="fv-sublist">${det.stratagems.map(st => row(st.name, String(st.cp || "").replace(/(\d+)\s*CP/i, "$1 CP"), `<div class="fv-rich">${richHTML(st.rich || st.text)}</div>`, { sub: true })).join("")}</div>`) : "",
    ].join("");
    return row(det.name, dp, inner);
  }).join("")}</div></div>`;

  // Army rules: main rules first, special move rules after
  const main = d.armyRules.filter(r => !r.special), moves = d.armyRules.filter(r => r.special).sort((a, b) => a.name.localeCompare(b.name));
  const armyPane = `<div class="fv-group"><div class="fv-group-title">Army Rules</div><div class="fv-list">${[
    ...main.map(r => row(r.name, "", panel("", `<div class="fv-rich">${richHTML(r.rich || r.text)}</div>`))),
    ...moves.map(r => row(r.name, "Special Move Rule", panel("", `<div class="fv-rich">${richHTML(r.rich || r.text)}</div>`), { dim: true })),
  ].join("")}</div></div>`;

  const name = doc.faction || doc.title;
  openSheet(`
    <div class="fv">
      <div class="fv-head">
        <div>
          <div class="fv-title">${esc(name)}</div>
          <div class="fv-meta">${count(d.datasheets.length, "Datasheet", "Datasheets")}<i>•</i>${count(d.detachments.length, "Detachment", "Detachments")}<i>•</i>${count(d.armyRules.length, "Army Rule", "Army Rules")}</div>
        </div>
        <button class="fv-close" type="button" data-close aria-label="Close">✕</button>
      </div>
      <input class="input fv-filter" id="viewerFilter" placeholder="Filter by name…">
      <div class="segmented fv-tabs" id="viewerTabs">
        <button type="button" data-tab="ds" aria-pressed="true">Datasheets (${d.datasheets.length})</button>
        <button type="button" data-tab="det" aria-pressed="false">Detachments (${d.detachments.length})</button>
        <button type="button" data-tab="army" aria-pressed="false">Army Rules (${d.armyRules.length})</button>
      </div>
      <div class="fv-scroll">
        <div data-pane="ds">${dsPane}</div>
        <div data-pane="det" hidden>${detPane}</div>
        <div data-pane="army" hidden>${armyPane}</div>
        <div class="fv-empty" hidden>Nothing matches that name.</div>
      </div>
    </div>`, true);

  const sheet = $("#sheet");
  sheet.classList.add("fv-sheet");
  sheet.addEventListener("close", () => sheet.classList.remove("fv-sheet"), { once: true });

  // Accordion: opening a row closes any other open row at the same level.
  sheet.addEventListener("toggle", e => {
    const el = e.target;
    if (!el.matches?.("details.fv-row") || !el.open) return;
    const level = el.parentElement;
    for (const other of level.querySelectorAll(":scope > details.fv-row[open]")) if (other !== el) other.open = false;
    if (!el.classList.contains("fv-sub")) {
      for (const other of sheet.querySelectorAll("details.fv-row:not(.fv-sub)[open]")) if (other !== el) other.open = false;
    }
  }, true);

  const applyFilter = () => {
    const q = normName($("#viewerFilter").value);
    const pane = sheet.querySelector("[data-pane]:not([hidden])");
    let shown = 0;
    for (const group of pane.querySelectorAll(".fv-group")) {
      let any = 0;
      for (const r of group.querySelectorAll(":scope > .fv-list > details.fv-row")) {
        const hit = !q || r.dataset.name.includes(q);
        r.hidden = !hit;
        any += hit;
      }
      group.hidden = !any;
      shown += any;
    }
    sheet.querySelector(".fv-empty").hidden = shown > 0;
  };
  $$("#viewerTabs button").forEach(b => b.onclick = () => {
    $$("#viewerTabs button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $$("#sheet [data-pane]").forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
    applyFilter();
  });
  $("#viewerFilter").oninput = applyFilter;
}

export { openDataViewer };
