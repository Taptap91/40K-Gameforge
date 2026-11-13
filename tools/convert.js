/* RulesForge · tools/convert.js
 * The volunteer-pack conversion engine used by the GitHub Actions pipeline (see
 * .github/workflows/convert-packs.yml and tools/pack-convert.mjs). It runs the exact same
 * PDF → structured data → Excel pipeline the app itself uses for "Add PDF" → "Download Excel"
 * (see js/library.js's importFiles), reusing those modules directly so a pack produced here is
 * byte-for-byte what a human would get doing it by hand in the app. This file only runs inside a
 * real browser (loaded by tools/convert-harness.html) because the PDF reader renders pages onto a
 * <canvas> to read glyph styling — there is no Node-only path for this.
 *
 * Mission packs (Chapter Approved–style mission decks) are supported too, through their own workbook
 * format in js/mission-parser.js (missionPackToSheets/missionPackFromWorkbook) — the deck doesn't fit
 * the row-per-record tables faction/rules data uses, so it's kept as JSON split across rows instead.
 */
// Side-effect-only import, kept first: js/excel.js and js/datasheets.js sit in a circular import
// (excel.js → datasheets.js → search.js → rules-chat.js → library.js → factions.js/excel.js). The app's
// own entry point (js/main.js) happens to unwind that cycle safely; this harness isn't that entry point,
// so without this it can hit a "Cannot access 'DATASHEET_GROUPS' before initialization" TDZ error. Importing
// factions.js first forces datasheets.js to finish initializing before anything here needs it.
import "../js/factions.js?v=8.50";
import { readPdf } from "../js/pdf-reader.js?v=8.50";
import { looksLikeMissionPack, missionPackToSheets, parseMissionPack } from "../js/mission-parser.js?v=8.50";
import { dropPageFurniture, factionRichness, parseFactionPdf, parsePrintedFactionPdf, armyRulesFromLayout, groupArmyRules, mergeArmyRules } from "../js/faction-parser.js?v=8.50";
import { detectEdition, parseRulesPdf, rulesToSheets } from "../js/rules-doc.js?v=8.50";
import { buildXlsx, structuredToSheets } from "../js/excel.js?v=8.50";
import { packFaction, sortDatasheetAbilities } from "../js/pack-rules.js?v=8.50";

const PACK_MIN_DATASHEETS = 5;

/** Converts one PDF (a File/Blob) into a pack .xlsx, mirroring js/library.js's importFiles for a single file.
 * `kind` is a hint ("core"/"updates"/"faction"/"points"), same as the picker shown by "Add PDF" —
 * a mission pack is detected automatically and the hint is ignored for it. */
async function convertPdf(file, { kind = "core", faction = "" } = {}) {
  const { title, pages } = await readPdf(file, () => {});
  if (!pages.length) throw new Error("no selectable text (scanned PDFs need OCR first)");
  if (looksLikeMissionPack(pages)) {
    const pack = await parseMissionPack(pages, title);
    const blob = await buildXlsx(missionPackToSheets(pack));
    return { kind: "missions", title: pack.name, edition: null, faction: "", blob };
  }

  const edition = detectEdition(pages.slice(0, 2).map(p => p.text).join("\n"), title, file.name);
  const all = dropPageFurniture(pages.flatMap(p => p.items));
  const printed = parsePrintedFactionPdf(all), tall = parseFactionPdf(all);
  const data = factionRichness(printed) >= factionRichness(tall) * 0.9 ? printed : tall;
  data.armyRules = groupArmyRules(mergeArmyRules(data.armyRules, armyRulesFromLayout(all)));
  sortDatasheetAbilities(data);
  let structured = null;
  if (data.datasheets.length >= 2 || data.detachments.length >= 1) structured = data;
  if (data.datasheets.length >= PACK_MIN_DATASHEETS) kind = "faction";
  else if (kind === "core") structured = null;

  if (kind === "core" || kind === "updates") {
    const parsed = parseRulesPdf(pages.flatMap(p => p.items));
    if (parsed.sections.length >= 3) {
      const blob = await buildXlsx(rulesToSheets({ kind, title, edition, structured: parsed }));
      return { kind, title, edition, faction: "", blob };
    }
  }
  if (structured) {
    const docFaction = packFaction({ datasheets: structured.datasheets, title, fileName: file.name, typed: faction });
    const blob = await buildXlsx(structuredToSheets(structured, docFaction));
    return { kind: "faction", title, edition, faction: docFaction, blob };
  }
  throw new Error("couldn't find enough datasheets or rule sections to make a pack from this PDF — is it the right file?");
}

/** btoa(String.fromCharCode(...bytes)) blows the call stack on anything but tiny files, so this chunks it. */
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

window.__convertPdf = async (base64, fileName, opts) => {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const file = new File([bytes], fileName, { type: "application/pdf" });
  const result = await convertPdf(file, opts);
  const xlsxBuffer = await result.blob.arrayBuffer();
  const xlsxBase64 = bytesToBase64(new Uint8Array(xlsxBuffer));
  return { kind: result.kind, title: result.title, edition: result.edition, faction: result.faction, xlsxBase64 };
};
