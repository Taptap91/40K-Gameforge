/* RulesForge · library.js
 * Library page: adding PDFs and Excel workbooks, the document list, and the points editor.
 */
import { $, $$, DB, esc, icon, KINDS, KNOWN_FACTIONS, openPopMenu, openSheet, state, toast, uid } from "./core.js?v=8.42";
import { factionStyle } from "./factions.js?v=8.42";
import { looksLikeMissionPack, missionChunks, parseMissionPack } from "./mission-parser.js?v=8.42";
import { structuredToLibrary } from "./datasheets.js?v=8.42";
import { buildXlsx, readXlsx, structuredFromWorkbook, structuredToSheets } from "./excel.js?v=8.42";
import { dropPageFurniture, extractPoints, factionRichness, parseFactionPdf, parsePrintedFactionPdf, armyRulesFromLayout, groupArmyRules, mergeArmyRules } from "./faction-parser.js?v=8.42";
import { renderAll } from "./main.js?v=8.42";
import { chunkPages, readPdf } from "./pdf-reader.js?v=8.42";
import { detectEdition, editionLabel, effectiveRules, isRulesDoc, parseRulesPdf, rulesFromWorkbook, rulesToSheets, sectionChunks } from "./rules-doc.js?v=8.42";
import { buildIndex, detectFactions, factionMatches } from "./search.js?v=8.42";
import { applyPackRules, canonicalFaction, packFaction, packTheme, sortDatasheetAbilities } from "./pack-rules.js?v=8.42";

/** How many datasheets make a PDF a faction pack whatever type was picked (rulebooks print a few examples). */
const PACK_MIN_DATASHEETS = 5;

async function importFiles(files, pickedKind, faction) {
  const box = $("#importProgress"), errBox = $("#importError");
  box.classList.remove("hidden");
  errBox.classList.add("hidden");
  const errors = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let kind = pickedKind;
    try {
      if (isExcelFile(f)) { await importExcelFile(f, faction); continue; }
      const { title, pageCount, pages, bookIcons } = await readPdf(f, (n, total) => {
        $("#importText").textContent = `Reading ${f.name} (${i + 1} of ${files.length}) — page ${n} of ${total}`;
        $("#importBar").style.width = `${Math.round(((i + n / total) / files.length) * 100)}%`;
      });
      if (!pages.length) throw new Error("no selectable text (scanned PDFs need OCR first)");
      // A Chapter Approved mission pack (whatever type was picked) becomes its cards: missions, deployments, twists.
      if (looksLikeMissionPack(pages)) {
        $("#importText").textContent = `Reading the mission cards in ${f.name}…`;
        await new Promise(r => setTimeout(r, 30));
        const pack = await parseMissionPack(pages, title);
        const doc = { id: uid(), title: pack.name, kind: "missions", faction: "", pageCount, importedAt: Date.now(), edition: detectEdition(pages.slice(0, 2).map(p => p.text).join("\n"), title, f.name), format: "structured", structured: { missionPack: pack }, chunks: missionChunks(pack), points: [] };
        // A newer copy of the same pack replaces the old one.
        for (const old of state.docs.filter(d => d.kind === "missions" && d.title.trim().toLowerCase() === doc.title.trim().toLowerCase())) { await DB.del("docs", old.id); state.docs = state.docs.filter(d => d !== old); }
        await DB.put("docs", doc); state.docs.push(doc);
        continue;
      }
      // Untagged faction PDFs are tagged from their title or file name ("Dark_Angels_Codex…" → Dark Angels).
      const edition = detectEdition(pages.slice(0, 2).map(p => p.text).join("\n"), title, f.name);
      // Datasheet-style faction PDFs become compact structured records instead of raw page text.
      let structured = null;
      {
        $("#importText").textContent = `Converting ${f.name} into datasheets and detachments…`;
        await new Promise(r => setTimeout(r, 30));
        const all = dropPageFurniture(pages.flatMap(p => p.items));
        // Two readers: one for normal letter/A4 pages, one for very tall single-page exports. Keep whichever read more.
        const printed = parsePrintedFactionPdf(all), tall = parseFactionPdf(all);
        // The letter/A4 reader keeps more detail (bold text, leaders, Unique tags), so it wins unless it clearly read less.
        const data = factionRichness(printed) >= factionRichness(tall) * 0.9 ? printed : tall;
        // The faction's "Army Rules" section is also read straight from the page layout, so no army rule is missed.
        // "[Name] Ability" rules (Custodes ka’tahs) are kept as parts of the army rule they belong to.
        data.armyRules = groupArmyRules(mergeArmyRules(data.armyRules, armyRulesFromLayout(all)));
        sortDatasheetAbilities(data);   // faction pack ruleset, rule 11
        if (data.datasheets.length >= 2 || data.detachments.length >= 1) structured = data;
        // Faction pack ruleset, rule 1: a PDF full of datasheets is a faction pack, whatever type was picked when it was added.
        if (data.datasheets.length >= PACK_MIN_DATASHEETS) kind = "faction";
        else if (kind === "core") structured = null;
      }
      // Core Rules and updates become numbered rule sections, saved through an Excel workbook like faction packs.
      if (kind === "core" || kind === "updates") {   // (a faction pack picked as one of these has already become "faction")
        $("#importText").textContent = `Converting ${f.name} into rule sections…`;
        await new Promise(r => setTimeout(r, 30));
        const parsed = parseRulesPdf(pages.flatMap(p => p.items));
        if (parsed.sections.length >= 3) {
          const draft = { kind, title, edition, structured: parsed };
          const back = rulesFromWorkbook(await readXlsx(await (await buildXlsx(rulesToSheets(draft))).arrayBuffer()));
          await replaceRulesDoc({ id: uid(), title, kind, pageCount, importedAt: Date.now(), format: "structured", source: "excel", edition, structured: back.structured, chunks: sectionChunks(back.structured.sections) });
          continue;
        }
      }
      let docFaction = faction;
      if (!docFaction && (kind === "faction" || structured)) docFaction = detectFactions(`${title} ${f.name.replace(/[_\-.]+/g, " ")}`)[0] || "";
      docFaction = canonicalFaction(docFaction) || docFaction;   // "DA", "Dark Angels Faction Pack" → Dark Angels
      let doc;
      if (structured) {
        // The PDF becomes an Excel workbook, and the faction is built from that workbook (the PDF isn't kept).
        $("#importText").textContent = `Creating the Excel file for ${f.name}…`;
        const xlsx = await buildXlsx(structuredToSheets(structured, docFaction));
        const fromExcel = structuredFromWorkbook(await readXlsx(await xlsx.arrayBuffer()));
        delete fromExcel.faction; delete fromExcel.theme;
        const lib = structuredToLibrary(fromExcel, docFaction);
        doc = { id: uid(), title, kind: kind === "points" ? "points" : "faction", faction: docFaction, pageCount, importedAt: Date.now(), edition, format: "structured", source: "excel", structured: fromExcel, chunks: lib.chunks, points: lib.points };
        // Faction pack ruleset, rules 2–4: the faction's official name, symbol and colours, decided by the pack itself.
        await applyPackRules(doc, { bookIcons, fileName: f.name, typed: faction });
        if (doc.faction !== docFaction) { const again = structuredToLibrary(fromExcel, doc.faction); doc.chunks = again.chunks; doc.points = again.points; }
      } else {
        const points = kind === "core" ? [] : extractPoints(pages).map(p => docFaction ? { ...p, section: docFaction } : p);
        doc = { id: uid(), title, kind, faction: docFaction, pageCount, importedAt: Date.now(), edition, chunks: chunkPages(pages), points };
      }
      for (const p of pages) delete p.items;   // positions aren't stored
      if (structured) await replaceFaction(doc);
      else { await DB.put("docs", doc); state.docs.push(doc); }
    } catch (err) {
      errors.push(`${f.name}: ${err.message || err}`);
    }
  }
  box.classList.add("hidden");
  if (errors.length) { errBox.textContent = "Couldn't import " + errors.join("; "); errBox.classList.remove("hidden"); }
  buildIndex();
  renderAll();
  if (!errors.length && !$("#toast").classList.contains("show")) toast(files.length === 1 ? "PDF added" : `${files.length} PDFs added`);
}

const isExcelFile = f => /\.xlsx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Adds a faction from an Excel workbook (one RulesForge made, possibly edited by you). */
async function importExcelFile(f, faction) {
  $("#importText").textContent = `Reading ${f.name}…`;
  $("#importBar").style.width = "40%";
  const buffer = await f.arrayBuffer();
  const book = await readXlsx(buffer);
  // A rules workbook (Core Rules or an update) rather than faction data.
  const rules = rulesFromWorkbook(book);
  if (rules) {
    const title = rules.title || f.name.replace(/\.xlsx$/i, "").replace(/[_]+/g, " ").trim();
    return replaceRulesDoc({ id: uid(), title, kind: rules.kind, pageCount: 0, importedAt: Date.now(), format: "structured", source: "excel", edition: rules.edition, structured: rules.structured, chunks: sectionChunks(rules.structured.sections) }, f.name);
  }
  const data = sortDatasheetAbilities(structuredFromWorkbook(book));
  // Faction pack ruleset, rules 2 and 7: the same faction name, symbol and colours as the PDF the workbook came from.
  const docFaction = packFaction({ datasheets: data.datasheets, title: data.faction, fileName: f.name, typed: faction });
  const theme = data.theme; delete data.faction; delete data.theme;
  const title = f.name.replace(/\.xlsx$/i, "").replace(/[_]+/g, " ").trim();
  const lib = structuredToLibrary(data, docFaction);
  const doc = { id: uid(), title, kind: "faction", faction: docFaction, pageCount: 0, importedAt: Date.now(), format: "structured", source: "excel", structured: data, chunks: lib.chunks, points: lib.points };
  if (theme?.icon) doc.icon = theme.icon;
  const worked = await packTheme(docFaction, doc.icon);
  // A faction that isn't built in and has no coloured symbol keeps the colours its workbook was made with.
  doc.theme = { rules: 1, ...(worked.from === "name" && theme?.c1 ? { c1: theme.c1, c2: theme.c2 || worked.c2, from: "workbook" } : worked) };
  await replaceFaction(doc, f.name);
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

function factionsInLibrary() {
  const set = new Set();
  for (const d of state.docs) {
    if (d.faction) set.add(d.faction);
    for (const p of d.points || []) if (KNOWN_FACTIONS.includes(p.section)) set.add(p.section);
  }
  return [...set].sort();
}/* The library: each faction's PDF as a box in its colours with its symbol (tap to open the faction), then the Core Rules,
   points and updates. ⋮ on a box: View data · Points · Download Excel · Remove. */
const KEBAB = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>`;
const libKebab = d => `<button type="button" class="lib-kebab" data-lib-menu="${d.id}" data-menu-key="d:${d.id}" title="More" aria-label="More options for ${esc(d.title)}" aria-haspopup="menu">${KEBAB}</button>`;
function renderLibrary() {
  const host = $("#docList");
  if (!host) return;
  if (!state.docs.length) {
    host.innerHTML = `<div class="empty">Nothing here yet. Add the Core Rules first, then your faction's rules and the latest points.</div>`;
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
    kind === "faction" || kind === "points" ? `<button type="button" role="menuitem" data-points="${d.id}">Points</button>` : "",
    d.structured ? `<button type="button" role="menuitem" data-excel="${d.id}">Download Excel</button>` : "",
    `<button type="button" role="menuitem" class="danger" data-delete="${d.id}">Remove</button>`].join(""));
}

function docMeta(d) {
  const ed = editionLabel(d.edition);
  if (isRulesDoc(d)) return [`${d.structured.sections.length} rule sections`, d.structured.battleSizes?.length ? `${d.structured.battleSizes.length} battle sizes` : "", "Excel", ed];
  return [d.faction, d.source === "wahapedia" ? `${d.pageCount} datasheets · Wahapedia${d.updated ? " " + d.updated.slice(0, 10) : ""}`
    : d.structured?.datasheets ? `${d.structured.datasheets.length} datasheets · ${d.structured.detachments.length} detachments · ${d.structured.armyRules.filter(r => !r.partOf).length} army rules${d.source === "excel" ? " · Excel" : ""}`
    : `${d.pageCount} pages`, d.points?.length ? `${d.points.length} points entries` : "", ed].filter(Boolean);
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

/** Excel workbooks go straight in (RulesForge workbooks say what they are); PDFs ask what they are. */
async function addLibraryFiles(files) {
  const excel = files.filter(isExcelFile), pdfs = files.filter(f => !isExcelFile(f));
  if (excel.length) await importFiles(excel, "faction", "");
  if (pdfs.length) openImportSheet(pdfs);
}

function openImportSheet(files) {
  openSheet(`
    <div class="sheet-head">
      <h2>What ${files.length === 1 ? "is this PDF" : `are these ${files.length} PDFs`}?</h2>
      <p>${files.map(f => esc(f.name)).join(", ")}</p>
    </div>
    <div class="sheet-body">
      ${Object.entries(KINDS).map(([k, v], i) => `<label class="choice"><input type="radio" name="kind" value="${k}" ${k === (state.preferKind || "core") ? "checked" : ""}><span><strong>${esc(v.label)}</strong><span>${esc(v.desc)}</span></span></label>`).join("")}
      <div class="field" id="factionField" style="display:none">
        <label for="importFaction">Faction</label>
        <input class="input" id="importFaction" list="factionList" placeholder="Optional">
        <span class="hint" id="factionHint"></span>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn" type="button" data-close>Cancel</button>
      <button class="btn primary" type="button" id="importGo">Add</button>
    </div>`);
  const update = () => {
    const k = $('input[name="kind"]:checked').value;
    $("#factionField").style.display = k === "core" ? "none" : "";
    $("#factionHint").textContent = k === "points"
      ? "If this covers every faction (like the full Munitorum Field Manual), leave it blank — faction headings are found automatically."
      : "Tagging a faction lets you limit searches and army lists to it.";
  };
  state.preferKind = null;
  $$('input[name="kind"]').forEach(r => r.addEventListener("change", update));
  update();
  $("#importGo").onclick = () => {
    const kind = $('input[name="kind"]:checked').value;
    const faction = kind === "core" ? "" : $("#importFaction").value.trim();
    $("#sheet").close();
    importFiles(files, kind, faction);
  };
}

function openPointsSheet(docId) {
  const doc = state.docs.find(d => d.id === docId);
  if (!doc) return;
  const rows = doc.points.map(p => ({ ...p }));
  const rowHTML = p => `<tr data-id="${p.id}">
      <td><input class="input" data-f="name" value="${esc(p.name)}"></td>
      <td><input class="input" data-f="models" type="number" min="0" value="${p.models}" ${p.enh ? "disabled" : ""}></td>
      <td><input class="input" data-f="points" type="number" min="0" step="5" value="${p.points}"></td>
      <td style="text-align:center"><input type="checkbox" data-f="enh" ${p.enh ? "checked" : ""}></td>
      <td><input class="input" data-f="section" value="${esc(p.section)}"></td>
      <td><button class="btn plain danger" data-remove-row type="button" aria-label="Remove">✕</button></td>
    </tr>`;
  openSheet(`
    <div class="sheet-head">
      <h2>Points · ${esc(doc.title)}</h2>
      <p>Read automatically from the PDF. Fix anything that looks wrong — the list builder uses these exact numbers.</p>
    </div>
    <div class="sheet-body">
      <input class="input" id="pointsFilter" placeholder="Filter by unit or faction">
      <div style="overflow:auto">
        <table class="points">
          <thead><tr><th>Name</th><th>Models</th><th>Points</th><th>Enh.</th><th>Faction / section</th><th></th></tr></thead>
          <tbody id="pointsBody">${rows.map(rowHTML).join("")}</tbody>
        </table>
      </div>
      ${rows.length ? "" : `<div class="empty">No points were found in this document.</div>`}
    </div>
    <div class="sheet-foot">
      <button class="btn" type="button" id="addRow" style="margin-right:auto">Add row</button>
      <button class="btn" type="button" data-close>Cancel</button>
      <button class="btn primary" type="button" id="savePoints">Save</button>
    </div>`, true);

  const body = $("#pointsBody");
  $("#pointsFilter").oninput = e => {
    const q = e.target.value.toLowerCase();
    $$("tr", body).forEach(tr => {
      const name = $('[data-f="name"]', tr).value.toLowerCase(), sec = $('[data-f="section"]', tr).value.toLowerCase();
      tr.style.display = !q || name.includes(q) || sec.includes(q) ? "" : "none";
    });
  };
  body.addEventListener("click", e => { if (e.target.closest("[data-remove-row]")) e.target.closest("tr").remove(); });
  body.addEventListener("change", e => {
    if (e.target.dataset.f === "enh") $('[data-f="models"]', e.target.closest("tr")).disabled = e.target.checked;
  });
  $("#addRow").onclick = () => {
    body.insertAdjacentHTML("afterbegin", rowHTML({ id: uid(), name: "", models: 1, points: 0, enh: false, section: doc.faction || "" }));
    $('[data-f="name"]', body).focus();
  };
  $("#savePoints").onclick = async () => {
    doc.points = $$("tr", body).map(tr => ({
      id: tr.dataset.id,
      name: $('[data-f="name"]', tr).value.trim(),
      models: $('[data-f="enh"]', tr).checked ? 0 : parseInt($('[data-f="models"]', tr).value, 10) || 0,
      points: parseInt($('[data-f="points"]', tr).value, 10) || 0,
      enh: $('[data-f="enh"]', tr).checked,
      section: $('[data-f="section"]', tr).value.trim(),
      page: 0,
    })).filter(p => p.name);
    await DB.put("docs", doc);
    $("#sheet").close();
    renderAll();
    toast("Points saved");
  };
}

export { addLibraryFiles, factionsInLibrary, isExcelFile, openLibraryMenu, openPointsSheet, renderLibrary };
