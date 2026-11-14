/* RulesForge · library.js
 * Library page: the document list — everything in it comes from a downloaded Game Pack (packs.js).
 */
import { DB, esc, icon, KINDS, KNOWN_FACTIONS, openPopMenu, state, toast, uid } from "./core.js?v=8.50";
import { factionStyle } from "./factions.js?v=8.50";
import { missionChunks, missionPackFromWorkbook } from "./mission-parser.js?v=8.50";
import { structuredToLibrary } from "./datasheets.js?v=8.50";
import { readXlsx, structuredFromWorkbook } from "./excel.js?v=8.50";
import { editionLabel, effectiveRules, isRulesDoc, rulesFromWorkbook, sectionChunks } from "./rules-doc.js?v=8.50";
import { factionMatches } from "./search.js?v=8.50";
import { packFaction, packTheme, sortDatasheetAbilities } from "./pack-rules.js?v=8.50";

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
}/* The library: a downloaded Game Pack collapses into a single box (tap to open its Rules/Mission Packs/
   Factions sections; ⋮ → Delete removes everything it installed). Anything not part of a Game Pack —
   pre-existing local data — still shows as its own box per document, the way the library has always
   worked: each faction's PDF in its colours with its symbol (tap to open the faction), then mission
   packs, then the Core Rules, points and updates. ⋮ on one of those: Remove. */
const KEBAB = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>`;
const libKebab = (key, title) => `<button type="button" class="lib-kebab" data-lib-menu="${esc(key)}" data-menu-key="d:${esc(key)}" title="More" aria-label="More options for ${esc(title)}" aria-haspopup="menu">${KEBAB}</button>`;
/** A quick count summary ("Core Rules · 2 Updates · 1 Mission Pack · 12 Factions") for a Game Pack's box. */
function docsSummary(docs) {
  const counts = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] || 0) + 1;
  const parts = [];
  if (counts.core) parts.push("Core Rules");
  if (counts.updates) parts.push(`${counts.updates} Update${counts.updates === 1 ? "" : "s"}`);
  if (counts.missions) parts.push(`${counts.missions} Mission Pack${counts.missions === 1 ? "" : "s"}`);
  if (counts.faction) parts.push(`${counts.faction} Faction${counts.faction === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
const bundleCard = (bundleId, title, docs) => `<div class="lib-card lib-bundle" role="button" tabindex="0" data-bundle-open="${esc(bundleId)}">
    <div class="lib-icon">${icon("book")}</div>
    <div class="lib-text"><div class="lib-name">${esc(title)}</div><div class="lib-meta">${esc(docsSummary(docs))}</div></div>${libKebab("bundle:" + bundleId, title)}</div>`;
const ADD_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;
const addTileHTML = `<button class="lib-addtile" type="button" data-lib-packs>${ADD_SVG}Click to add Game Pack</button>`;
/** The Library: the Game Packs page's home screen — every downloaded Game Pack, faction, mission pack and
 *  rules document, grouped the same way it always has been. Returns the HTML for the whole screen (the
 *  Game Packs page renders this straight into its content area, the same place a faction or mission pack does). */
function libraryHTML() {
  if (!state.docs.length) {
    return `<div class="lib-body"><div class="empty">Nothing here yet — download a Game Pack to begin.</div>${addTileHTML}<p class="hint">Everything in your Library comes from a Game Pack you've downloaded.</p></div>`;
  }
  const bundled = state.docs.filter(d => d.pack?.bundleId);
  const unbundled = state.docs.filter(d => !d.pack?.bundleId);
  const bundleGroups = new Map();
  for (const d of bundled) {
    const id = d.pack.bundleId;
    if (!bundleGroups.has(id)) bundleGroups.set(id, { title: d.pack.bundleTitle || id, docs: [] });
    bundleGroups.get(id).docs.push(d);
  }
  const bundlesHTML = bundleGroups.size ? `<div class="group-title">Game Packs</div><div class="lib-cards">${[...bundleGroups.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title)).map(([id, g]) => bundleCard(id, g.title, g.docs)).join("")}</div>` : "";

  const newest = (a, b) => b.importedAt - a.importedAt;
  const facs = unbundled.filter(d => d.kind === "faction").sort((a, b) => String(a.faction || a.title).localeCompare(String(b.faction || b.title)) || newest(a, b));
  const rest = ["core", "updates", "points"].flatMap(k => unbundled.filter(d => d.kind === k).sort(newest));
  const packs = unbundled.filter(d => d.kind === "missions").sort(newest);
  const packCard = d => {
    const m = d.structured?.missionPack || {}, n = k => (m[k] || []).length;
    const counts = [[n("primaries"), "primary"], [n("secondaries"), "secondary"], [n("deployments"), "deployment"], [n("twists"), "twist"]].filter(([c]) => c).map(([c, w]) => `${c} ${c === 1 ? w : { primary: "primaries", secondary: "secondaries" }[w] || w + "s"}`);
    return `<div class="lib-card lib-pack" role="button" tabindex="0" data-mission-open="${d.id}">
      <div class="lib-icon">${icon("flag")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.title)}</div><div class="lib-meta">${esc(counts.join(" · "))}</div>
        <div class="lib-meta2">${esc([n("dispositions") ? `${n("dispositions")} Force Dispositions` : "", n("faq") ? `${n("faq")} FAQs` : "", editionLabel(d.edition)].filter(Boolean).join(" · "))}</div></div>${libKebab(d.id, d.title)}</div>`;
  };
  const facCard = d => {
    const st = factionStyle(d.faction || ""), meta = docMeta(d).filter(x => x !== d.faction);
    const open = d.structured?.datasheets && d.faction ? ` role="button" tabindex="0" data-lib-open="${esc(d.faction)}"` : "";
    return `<div class="lib-card lib-fac${st.img ? " has-mark" : ""}"${open} style="--c1:${st.c1};--c2:${st.c2}">
      ${st.img ? `<img class="lib-mark" src="${esc(st.img)}" alt="">` : ""}
      <div class="lib-text"><div class="lib-name">${esc(d.faction || d.title)}</div><div class="lib-meta">${esc(meta.slice(0, 1).join(" · "))}</div>
        <div class="lib-meta2">${esc([d.title, ...meta.slice(1)].join(" · "))}</div></div>${libKebab(d.id, d.faction || d.title)}</div>`;
  };
  const docCard = d => `<div class="lib-card">
      <div class="lib-icon">${icon(KINDS[d.kind]?.icon || "book")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.kind === "core" ? "Core Rules" : d.title)}</div>
        <div class="lib-meta">${esc(d.kind === "core" ? d.title.replace(/^core rules\s*/i, "").replace(/^\[|\]$/g, "") || KINDS.core.desc : KINDS[d.kind]?.label || "")}</div>
        <div class="lib-meta2">${esc(docMeta(d).join(" · "))}</div>${isRulesDoc(d) ? rulesStatus(d) : ""}</div>${libKebab(d.id, d.title)}</div>`;
  const docList = bundlesHTML
    + (facs.length ? `<div class="group-title">Your factions · ${facs.length}</div><div class="lib-cards">${facs.map(facCard).join("")}</div>` : "")
    + (packs.length ? `<div class="group-title">Mission Packs</div><div class="lib-cards">${packs.map(packCard).join("")}</div>` : "")
    + (rest.length ? `<div class="group-title">Rules</div><div class="lib-cards">${rest.map(docCard).join("")}</div>` : "");
  return `<div class="lib-body"><div id="docList" class="stack">${docList}</div>${addTileHTML}<p class="hint">Everything in your Library comes from a Game Pack you've downloaded.</p></div>`;
}
/** The ⋮ menu for a box in the library: a Game Pack bundle gets just Delete (removes everything it
 *  installed); any other document gets Remove. */
function openLibraryMenu(btn) {
  const key = btn.dataset.libMenu;
  if (key.startsWith("bundle:")) {
    const bundleId = key.slice("bundle:".length);
    if (!state.docs.some(d => d.pack?.bundleId === bundleId)) return;
    return openPopMenu(btn, "d:" + key, `<button type="button" role="menuitem" class="danger" data-delete-bundle="${esc(bundleId)}">Delete</button>`);
  }
  const d = state.docs.find(x => x.id === key);
  if (!d) return;
  return openPopMenu(btn, "d:" + key, `<button type="button" role="menuitem" class="danger" data-delete="${esc(d.id)}">Remove</button>`);
}

/** Where a Game Pack download came from, shown in the Library the same way a PDF's page count or edition is. */
const packMeta = d => d.pack?.version ? `Pack · v${d.pack.version}` : "";

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

export { factionsInLibrary, importWorkbookBuffer, libraryHTML, openLibraryMenu };
