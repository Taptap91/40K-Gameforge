/* RulesForge · library.js
 * Library page: the document list — everything in it comes from a downloaded Game Pack (packs.js).
 */
import { $, DB, esc, icon, KINDS, KNOWN_FACTIONS, openPopMenu, state, toast, uid } from "./core.js?v=8.47";
import { factionStyle } from "./factions.js?v=8.47";
import { missionChunks, missionPackFromWorkbook } from "./mission-parser.js?v=8.47";
import { structuredToLibrary } from "./datasheets.js?v=8.47";
import { readXlsx, structuredFromWorkbook } from "./excel.js?v=8.47";
import { editionLabel, effectiveRules, isRulesDoc, rulesFromWorkbook, sectionChunks } from "./rules-doc.js?v=8.47";
import { factionMatches } from "./search.js?v=8.47";
import { packFaction, packTheme, sortDatasheetAbilities } from "./pack-rules.js?v=8.47";

/** The shared half of importing a RulesForge workbook — every Game Pack download (packs.js) goes through
 *  this, since a pack is exactly the same .xlsx workbook this app's own data round-trips through.
 *  `meta.pack`, if given, is stamped onto the resulting doc so the Library can show where it came from and
 *  check for updates later. Returns the doc that was saved (a rules doc or a faction doc). */
async function importWorkbookBuffer(buffer, fileName, { faction = "", pack = null, title: titleOverride = "" } = {}) {
  const book = await readXlsx(buffer);
  const niceName = titleOverride || fileName.replace(/\.xlsx$/i, "").replace(/[_]+/g, " ").trim();
  // A mission pack workbook, rather than rules or faction data.
  const missionPack = missionPackFromWorkbook(book);
  if (missionPack) {
    const doc = { id: uid(), title: titleOverride || missionPack.name, kind: "missions", faction: "", pageCount: 0, importedAt: Date.now(), format: "structured", source: "excel", structured: { missionPack }, chunks: missionChunks(missionPack), points: [] };
    if (pack) doc.pack = pack;
    await replaceMissionPack(doc, fileName);
    return doc;
  }
  // A rules workbook (Core Rules or an update) rather than faction data.
  const rules = rulesFromWorkbook(book);
  if (rules) {
    const title = rules.title || niceName;
    const doc = { id: uid(), title, kind: rules.kind, pageCount: 0, importedAt: Date.now(), format: "structured", source: "excel", edition: rules.edition, structured: rules.structured, chunks: sectionChunks(rules.structured.sections) };
    if (pack) doc.pack = pack;
    await replaceRulesDoc(doc, fileName);
    return doc;
  }
  const data = sortDatasheetAbilities(structuredFromWorkbook(book));
  // Faction pack ruleset, rules 2 and 7: the same faction name, symbol and colours as the PDF the workbook came from.
  const docFaction = packFaction({ datasheets: data.datasheets, title: data.faction, fileName, typed: faction });
  const theme = data.theme; delete data.faction; delete data.theme;
  const title = niceName;
  const lib = structuredToLibrary(data, docFaction);
  const doc = { id: uid(), title, kind: "faction", faction: docFaction, pageCount: 0, importedAt: Date.now(), format: "structured", source: "excel", structured: data, chunks: lib.chunks, points: lib.points };
  if (theme?.icon) doc.icon = theme.icon;
  const worked = await packTheme(docFaction, doc.icon);
  // A faction that isn't built in and has no coloured symbol keeps the colours its workbook was made with.
  doc.theme = { rules: 1, ...(worked.from === "name" && theme?.c1 ? { c1: theme.c1, c2: theme.c2 || worked.c2, from: "workbook" } : worked) };
  if (pack) doc.pack = pack;
  await replaceFaction(doc, fileName);
  return doc;
}

/** Stores a rules document; the same document added again (same kind and title) replaces the earlier copy. */
async function replaceRulesDoc(doc, label = doc.title) {
  const same = state.docs.filter(d => d.kind === doc.kind && isRulesDoc(d) && d.title.trim().toLowerCase() === doc.title.trim().toLowerCase());
  await DB.put("docs", doc);
  state.docs.push(doc);
  for (const old of same) { await DB.del("docs", old.id); state.docs = state.docs.filter(d => d !== old); }
  if (same.length) toast(`Replaced the earlier copy of ${label}`);
}

/** Stores converted faction data, replacing any earlier data for the same faction so the newest import is the one used. */
async function replaceFaction(doc, label = doc.title) {
  const same = state.docs.filter(d => d.structured?.datasheets && doc.faction && factionMatches(d.faction, doc.faction));
  // Adding the faction again keeps the PDF's icon (when the new file has none) and your banner image.
  if (!doc.icon) { const old = same.find(d => d.icon); if (old) doc.icon = old.icon; }
  if (!doc.banner) { const old = same.find(d => d.banner); if (old) doc.banner = old.banner; }
  await DB.put("docs", doc);
  state.docs.push(doc);
  for (const old of same) { await DB.del("docs", old.id); state.docs = state.docs.filter(d => d !== old); }
  if (same.length) toast(`Replaced the earlier ${doc.faction} data with ${label}`);
}

/** Stores a mission pack; the same pack added again (same title) replaces the earlier copy. */
async function replaceMissionPack(doc, label = doc.title) {
  const same = state.docs.filter(d => d.kind === "missions" && d.title.trim().toLowerCase() === doc.title.trim().toLowerCase());
  await DB.put("docs", doc);
  state.docs.push(doc);
  for (const old of same) { await DB.del("docs", old.id); state.docs = state.docs.filter(d => d !== old); }
  if (same.length) toast(`Replaced the earlier copy of ${label}`);
}

function factionsInLibrary() {
  const set = new Set();
  for (const d of state.docs) {
    if (d.faction) set.add(d.faction);
    for (const p of d.points || []) if (KNOWN_FACTIONS.includes(p.section)) set.add(p.section);
  }
  return [...set].sort();
}/* The library: each faction's PDF as a box in its colours with its symbol (tap to open the faction), then the Core Rules,
   points and updates. ⋮ on a box: View data · Remove. */
const KEBAB = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>`;
const libKebab = d => `<button type="button" class="lib-kebab" data-lib-menu="${d.id}" data-menu-key="d:${d.id}" title="More" aria-label="More options for ${esc(d.title)}" aria-haspopup="menu">${KEBAB}</button>`;
function renderLibrary() {
  const host = $("#docList");
  if (!host) return;
  if (!state.docs.length) {
    host.innerHTML = `<div class="empty">Nothing here yet — download a Game Pack to begin.</div>`;
    return;
  }
  const newest = (a, b) => b.importedAt - a.importedAt;
  const facs = state.docs.filter(d => d.kind === "faction").sort((a, b) => String(a.faction || a.title).localeCompare(String(b.faction || b.title)) || newest(a, b));
  const rest = ["core", "updates", "points"].flatMap(k => state.docs.filter(d => d.kind === k).sort(newest));
  const packs = state.docs.filter(d => d.kind === "missions").sort(newest);
  const packCard = d => {
    const m = d.structured?.missionPack || {}, n = k => (m[k] || []).length;
    const counts = [[n("primaries"), "primary"], [n("secondaries"), "secondary"], [n("deployments"), "deployment"], [n("twists"), "twist"]].filter(([c]) => c).map(([c, w]) => `${c} ${c === 1 ? w : { primary: "primaries", secondary: "secondaries" }[w] || w + "s"}`);
    return `<div class="lib-card lib-pack" role="button" tabindex="0" data-mission-view="${d.id}">
      <div class="lib-icon">${icon("flag")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.title)}</div><div class="lib-meta">${esc(counts.join(" · "))}</div>
        <div class="lib-meta2">${esc([n("dispositions") ? `${n("dispositions")} Force Dispositions` : "", n("faq") ? `${n("faq")} FAQs` : "", editionLabel(d.edition)].filter(Boolean).join(" · "))}</div></div>${libKebab(d)}</div>`;
  };
  const facCard = d => {
    const st = factionStyle(d.faction || ""), meta = docMeta(d).filter(x => x !== d.faction);
    const open = d.structured?.datasheets && d.faction ? ` role="button" tabindex="0" data-lib-open="${esc(d.faction)}"` : "";
    return `<div class="lib-card lib-fac${st.img ? " has-mark" : ""}"${open} style="--c1:${st.c1};--c2:${st.c2}">
      ${st.img ? `<img class="lib-mark" src="${esc(st.img)}" alt="">` : ""}
      <div class="lib-text"><div class="lib-name">${esc(d.faction || d.title)}</div><div class="lib-meta">${esc(meta.slice(0, 1).join(" · "))}</div>
        <div class="lib-meta2">${esc([d.title, ...meta.slice(1)].join(" · "))}</div></div>${libKebab(d)}</div>`;
  };
  const docCard = d => `<div class="lib-card">
      <div class="lib-icon">${icon(KINDS[d.kind]?.icon || "book")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.kind === "core" ? "Core Rules" : d.title)}</div>
        <div class="lib-meta">${esc(d.kind === "core" ? d.title.replace(/^core rules\s*/i, "").replace(/^\[|\]$/g, "") || KINDS.core.desc : KINDS[d.kind]?.label || "")}</div>
        <div class="lib-meta2">${esc(docMeta(d).join(" · "))}</div>${isRulesDoc(d) ? rulesStatus(d) : ""}</div>${libKebab(d)}</div>`;
  host.innerHTML = (facs.length ? `<div class="group-title">Your factions · ${facs.length}</div><div class="lib-cards">${facs.map(facCard).join("")}</div>` : "")
    + (packs.length ? `<div class="group-title">Mission Packs</div><div class="lib-cards">${packs.map(packCard).join("")}</div>` : "")
    + (rest.length ? `<div class="group-title">Rules</div><div class="lib-cards">${rest.map(docCard).join("")}</div>` : "");
}
/** The ⋮ menu for a document in the library. */
function openLibraryMenu(btn) {
  const d = state.docs.find(x => x.id === btn.dataset.libMenu);
  if (!d) return;
  const kind = d.kind;
  openPopMenu(btn, "d:" + d.id, [
    d.structured?.datasheets ? `<button type="button" role="menuitem" data-view-data="${d.id}">View data</button>` : "",
    kind === "missions" ? `<button type="button" role="menuitem" data-mission-view="${d.id}">View cards</button>` : "",
    `<button type="button" role="menuitem" class="danger" data-delete="${d.id}">Remove</button>`].join(""));
}

/** Where a Game Pack download came from, shown in the Library the same way a PDF's page count or edition is. */
const packMeta = d => d.pack ? `Pack by ${d.pack.author}${d.pack.version ? ` · v${d.pack.version}` : ""}` : "";

function docMeta(d) {
  const ed = editionLabel(d.edition);
  if (isRulesDoc(d)) return [`${d.structured.sections.length} rule sections`, d.structured.battleSizes?.length ? `${d.structured.battleSizes.length} battle sizes` : "", "Excel", ed, packMeta(d)].filter(Boolean);
  return [d.faction, d.source === "wahapedia" ? `${d.pageCount} datasheets · Wahapedia${d.updated ? " " + d.updated.slice(0, 10) : ""}`
    : d.structured?.datasheets ? `${d.structured.datasheets.length} datasheets · ${d.structured.detachments.length} detachments · ${d.structured.armyRules.filter(r => !r.partOf).length} army rules${d.source === "excel" ? " · Excel" : ""}`
    : `${d.pageCount} pages`, d.points?.length ? `${d.points.length} points entries` : "", ed, packMeta(d)].filter(Boolean);
}

/** For rules documents: how many of its rules are in force, and what it replaced or what replaced it. */
function rulesStatus(d) {
  const eff = effectiveRules().sections;
  const live = eff.filter(s => s.source.docId === d.id);
  const replaced = live.filter(s => s.replaces.length).length;
  const lost = d.structured.sections.length - live.length;
  const bits = [d.kind === "updates" && replaced ? `Replaces ${replaced} earlier rule${replaced === 1 ? "" : "s"}` : "",
    lost > 0 ? `${lost} rule${lost === 1 ? "" : "s"} replaced by newer updates` : ""].filter(Boolean);
  return bits.length ? `<div class="meta lib-status">${esc(bits.join(" · "))}</div>` : "";
}

export { factionsInLibrary, importWorkbookBuffer, openLibraryMenu, renderLibrary };
