/* RulesForge · excel.js
 * The Excel workbook: writing it (compressed .xlsx), reading it back (ours or one saved by Excel/Numbers), and turning it into faction data.
 */
import { tidyApostrophes } from "./faction-parser.js?v=8.5";
import { formatGB, toast } from "./core.js?v=8.5";
import { detUnique, tidyDatasheet, viewerDatasheet } from "./datasheets.js?v=8.5";
import { rulesToSheets } from "./rules-doc.js?v=8.5";
import { keywordList, normName, stripRich, titleCase } from "./text.js?v=8.5";

/* A small built-in .xlsx writer (one sheet per table, bold header row), so no extra library is needed. */

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** Builds a .zip from [{ name, text }], deflate-compressed like Excel's own files (stored if the browser can't compress). */
async function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const canDeflate = typeof CompressionStream !== "undefined";
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    let body = data, method = 0;
    if (canDeflate) {
      try {
        const packed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
        if (packed.length < data.length) { body = packed; method = 8; }
      } catch { /* keep it stored */ }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, method, true);
    local.setUint32(14, crc, true); local.setUint32(18, body.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(10, method, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, body.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const xmlText = v => String(v ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, 32000)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** sheets: [{ name, columns: [{ header, width }], rows: [[…]] }] → .xlsx Blob */
async function buildXlsx(sheets) {
  const STYLE = { bold: 1, wrap: 2, mono: 3, title: 4, indent: 5, plain: 0, center: 6, boldCenter: 7 };
  const sheetXml = sh => {
    const rows = sh.noHeader ? sh.rows : [sh.columns.map(c => c.header), ...sh.rows];
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((cell, ci) => {
      const obj = cell !== null && typeof cell === "object" ? cell : null;
      const v = obj ? obj.v : cell;
      const styleIndex = obj?.st ? STYLE[obj.st] : (ri === 0 && !sh.noHeader) ? 1 : sh.columns[ci]?.mono ? 3 : 2;
      const ref = colName(ci) + (ri + 1), style = ` s="${styleIndex}"`;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === "") return "";
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const cols = `<cols>${sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("")}</cols>`;
    const pane = sh.noHeader ? "" : `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="${sh.noHeader ? 0 : 1}">${pane}</sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  };
  const files = [
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlText(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="10"/><name val="Consolas"/></font><font><b/><sz val="15"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf/><xf fontId="1" applyFont="1"/><xf applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="2" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="3" applyFont="1"/><xf applyAlignment="1"><alignment vertical="top" wrapText="1" indent="2"/></xf><xf applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf><xf fontId="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  return await zipFiles(files);
}

/** Lays structured faction data out as spreadsheet tables: a readable Datasheets sheet first,
 *  then one table per kind of data. The app rebuilds the faction from these tables. */
function structuredToSheets(data, faction, theme = null) {
  const YES = v => (v ? "Yes" : "");
  const lines = arr => (arr || []).join("\n");
  const rich = (r, t) => (r && stripRich(r) !== r ? r : "");   // keep formatting only where it adds bold text
  const unitRows = [], abilityRows = [], sectionRows = [], profileRows = [], stratRows = [], enhOptRows = [], unsortedRows = [];
  for (const ds of data.datasheets) {
    tidyDatasheet(ds);
    const v = viewerDatasheet(ds);
    const lead = h => v.leader.filter(l => h.test(l.heading)).flatMap(l => l.units);
    const kwOrder = k => keywordList(k).map(x => titleCase(x.toUpperCase())).join(", ");   // keep the datasheet's order
    unitRows.push([ds.name, ds.unitType || "", kwOrder(ds.keywords), kwOrder(ds.factionKeywords), ds.invuln || "",
      lines(ds.coreAbilities || v.ruleNames.filter(n => !(ds.armyRuleNames || []).includes(n))), lines(ds.armyRuleNames || []),
      // Keywords that differ between models, one line per model: "Ancient: ANCIENT, CHARACTER". Blank when all models share them.
      (ds.modelKeywords || []).map(m => `${m.model}: ${m.keywords}`).join("\n"),
      lead(/^leader$/i).length ? lines(lead(/^leader$/i)) : "", lines(lead(/^led by$/i)), lines(lead(/^support$/i)), lines(lead(/^supported by$/i)),
      lines(ds.detachmentAbilities),
      // Stratagems that apply to the unit, one per line: "Group | Name | CP"
      (ds.stratagems || []).map(st => [st.group || "", st.name, st.cp ?? ""].join(" | ")).join("\n")]);
    for (const p of ds.profiles || []) profileRows.push([ds.name, p.name || "", p.M, p.T, p.SV, p.W, p.LD, p.OC]);
    for (const a of v.abilities) abilityRows.push([ds.name, a.name, YES(a.wargear), stripRich(a.rich || a.text || ""), rich(a.rich)]);
    // "Lines as printed" only where they differ from the text split into lines (they matter for some packs' wargear lists).
    for (const s of ds.sections) {
      const printed = lines(s.lines);
      sectionRows.push([ds.name, s.heading, s.text || "", printed && printed !== String(s.text || "").split(/\n+/).map(t => t.trim()).filter(Boolean).join("\n") ? printed : "", rich(s.rich)]);
    }
    for (const e of ds.enhancementOptions || []) enhOptRows.push([ds.name, e.name, e.points ?? ""]);
    for (const t of ds.unsorted || []) unsortedRows.push([ds.name, t]);
  }
  const W = (header, width, extra = {}) => ({ header, width, ...extra });
  return [
    { name: "Units", columns: [W("Unit", 32), W("Unit type", 22), W("Keywords", 40), W("Faction keywords", 24), W("Invulnerable save", 10),
        W("Core abilities", 24), W("Army rules", 22), W("Model keywords", 40), W("Can lead", 30), W("Led by", 30), W("Can support", 26), W("Supported by", 26), W("Detachment abilities", 26), W("Stratagems", 40)],
      rows: unitRows },
    { name: "Profiles", columns: [W("Unit", 32), W("Model", 30), W("M", 6), W("T", 6), W("SV", 6), W("W", 6), W("LD", 6), W("OC", 6)], rows: profileRows },
    { name: "Weapons", columns: [W("Unit", 30), W("Type", 8), W("Weapon", 34), W("Range", 7), W("A", 6), W("BS/WS", 7), W("S", 5), W("AP", 5), W("D", 6), W("Keywords", 40)],
      rows: data.datasheets.flatMap(ds => ds.weapons.map(w => [ds.name, w.type, w.name, w.range, w.A, w.skill, w.S, w.AP, w.D, w.tags])) },
    { name: "Points", columns: [W("Unit", 32), W("Models", 8), W("Points", 8), W("3rd+ unit points", 16)],
      rows: data.datasheets.flatMap(ds => ds.points.map(x => [ds.name, x.models, x.points, x.later ?? ""])) },
    { name: "Abilities", columns: [W("Unit", 30), W("Ability", 32), W("Wargear ability", 10), W("Rules", 90), W("Formatted", 20)], rows: abilityRows },
    { name: "Unit sections", columns: [W("Unit", 30), W("Section", 26), W("Text", 90), W("Lines as printed", 60), W("Formatted", 20)], rows: sectionRows },
    { name: "Unit enhancements", columns: [W("Unit", 30), W("Enhancement", 34), W("Points", 8)], rows: enhOptRows },
    // Text the PDF reader couldn't place on a datasheet. Kept so nothing is lost; the app doesn't show it.
    { name: "Unsorted text", columns: [W("Unit", 30), W("Text", 100)], rows: unsortedRows },
    { name: "Detachments", columns: [W("Detachment", 30), W("Detachment points", 10), W("Force Disposition", 18), W("Unique keyword", 16), W("Can't be taken with", 34), W("Description", 50), W("Rules", 90)],
      rows: data.detachments.map(d => {
        // A Unique keyword stops two detachments that share it from being in the same army; blank when the pack gives none.
        const uq = detUnique(d);
        const rivals = uq ? data.detachments.filter(o => o !== d && normName(detUnique(o)) === normName(uq)).map(o => o.name).join(", ") : "";
        return [d.name, d.dp, (d.dispositions || []).join(", "), uq, rivals, d.description, d.rules.filter(r => !/^unique\b/i.test(r.name)).map(r => `${r.name}: ${r.text}`).join("\n\n")];
      }) },
    { name: "Detachment rules", columns: [W("Detachment", 30), W("Rule", 32), W("Rules", 90), W("Formatted", 20), W("Flavour text", 60)],
      rows: data.detachments.flatMap(d => d.rules.filter(r => !/^unique\b/i.test(r.name)).map(r => [d.name, r.name, r.text, rich(r.rich), r.flavour || ""])) },
    { name: "Enhancements", columns: [W("Detachment", 30), W("Enhancement", 34), W("Points", 8), W("Upgrade", 9), W("Rules", 90), W("Formatted", 20), W("Flavour text", 60)],
      rows: data.detachments.flatMap(d => d.enhancements.map(e => [d.name, e.name, e.points ?? "", e.upgrade === true ? "Yes" : e.upgrade === false ? "No" : "", e.text, rich(e.rich), e.flavour || ""])) },
    { name: "Stratagems", columns: [W("Detachment", 30), W("Stratagem", 32), W("CP", 6), W("Category", 18), W("Rules", 90), W("Formatted", 20), W("Flavour text", 60)],
      rows: data.detachments.flatMap(d => d.stratagems.map(s => [d.name, s.name, s.cp, s.category || "", s.text, rich(s.rich), s.flavour || ""])) },
    { name: "Army rules", columns: [W("Rule", 32), W("Special move", 10), W("Part of", 24), W("Type", 18), W("Rules", 100), W("Formatted", 20)],
      rows: data.armyRules.map(r => [r.name, YES(r.special), r.partOf || "", r.kind || "", r.text, rich(r.rich)]) },
    { name: "About", columns: [W("Field", 20), W("Value", 90)],
      rows: [["Faction", faction || ""],
        // The faction's theme (pack ruleset, rule 7), so the faction looks the same when this file is added.
        ...(theme?.c1 ? [["Colours", `${theme.c1}, ${theme.c2}`]] : []), ...(theme?.icon && theme.icon.length < 32000 ? [["Symbol", theme.icon]] : []),
        ["Created", new Date().toLocaleString()], ["Made with", "RulesForge"],
        ["Datasheets", data.datasheets.length], ["Detachments", data.detachments.length], ["Army rules", data.armyRules.length],
        ["Editing", "RulesForge builds the faction from these sheets. Fix a value (points, a weapon, a keyword, a Unique keyword) and add this file in Library to use your version. Lists in a cell are one item per line. Leave Formatted cells alone unless you also change the matching text."]] },
  ];
}/** Unzips an .xlsx: { path: Uint8Array }. Handles stored and deflated entries. */
async function unzipEntries(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("this isn't a valid Excel file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = {}, dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("this browser can't open compressed Excel files; update it and try again");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out[name] = new Uint8Array(await new Response(stream).arrayBuffer());
    }
  }
  return out;
}

/** Reads every sheet of an .xlsx into rows of strings: { "Sheet name": [[cell, …], …] }. */
async function readXlsx(buffer) {
  const files = await unzipEntries(buffer);
  const text = path => files[path] ? new TextDecoder().decode(files[path]) : "";
  const parse = xml => new DOMParser().parseFromString(xml, "application/xml");
  const all = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];
  const shared = all(parse(text("xl/sharedStrings.xml") || "<sst/>"), "si").map(si => all(si, "t").map(t => t.textContent).join(""));
  const rels = {};
  for (const r of all(parse(text("xl/_rels/workbook.xml.rels") || "<Relationships/>"), "Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
  const out = {};
  for (const sh of all(parse(text("xl/workbook.xml")), "sheet")) {
    const id = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let target = rels[id] || "";
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const doc = parse(text(target));
    const rows = [];
    for (const row of all(doc, "row")) {
      const r = (+row.getAttribute("r") || rows.length + 1) - 1;
      const cells = [];
      let next = 0;
      for (const c of all(row, "c")) {
        const ref = c.getAttribute("r");
        let col = next;
        if (ref) { col = 0; for (const ch of ref.replace(/\d+$/, "")) col = col * 26 + (ch.charCodeAt(0) - 64); col -= 1; }
        const t = c.getAttribute("t"), v = all(c, "v")[0]?.textContent ?? "";
        cells[col] = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? all(c, "t").map(x => x.textContent).join("") : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
        next = col + 1;
      }
      rows[r] = Array.from(cells, x => x ?? "");
    }
    out[sh.getAttribute("name")] = Array.from(rows, x => x || []);
  }
  return out;
}

/** Rebuilds the faction data the app uses from the workbook tables. */
function structuredFromWorkbook(book) {
  const sheet = name => {
    const key = Object.keys(book).find(k => k.trim().toLowerCase() === name.toLowerCase());
    const rows = key ? book[key] : [];
    const head = (rows[0] || []).map(h => String(h || "").trim().toLowerCase());
    return rows.slice(1).filter(r => r && r.some(c => String(c ?? "").trim())).map(r => {
      const o = {};
      head.forEach((h, i) => { if (h) o[h] = String(r[i] ?? "").replace(/\r\n?/g, "\n").trim(); });
      return o;
    });
  };
  const units = sheet("Units");
  if (!units.length) throw new Error("this Excel file has no Units sheet. Add the faction PDF instead, or use an Excel file made by RulesForge");
  const list = s => String(s || "").split(/\n+/).map(t => t.trim()).filter(Boolean);
  const num = s => { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : null; };
  const richOr = (formatted, plain) => (formatted && stripRich(formatted).replace(/\s+/g, " ") === String(plain).replace(/\s+/g, " ") ? formatted : plain);
  const byUnit = (rows, col = "unit") => { const m = new Map(); for (const r of rows) { const k = normName(r[col] || ""); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const profiles = byUnit(sheet("Profiles")), weapons = byUnit(sheet("Weapons")), points = byUnit(sheet("Points"));
  const abilities = byUnit(sheet("Abilities")), sections = byUnit(sheet("Unit sections"));
  const strats = byUnit(sheet("Unit stratagems")), enhOpts = byUnit(sheet("Unit enhancements")), unsorted = byUnit(sheet("Unsorted text"));
  const kwList = s => String(s || "").split(/\s*[,\n]\s*/).map(k => k.trim()).filter(Boolean).map(k => k.toUpperCase()).join(", ");
  const datasheets = units.filter(u => u.unit).map(u => {
    const k = normName(u.unit);
    const leader = [];
    const intro = { "Leader": "This model can be attached to the following units:", "Led by": "This unit can be led by the following units:", "Support": "This model can support the following units:", "Supported by": "This unit can be supported by the following units:" };
    for (const [col, heading] of [["can lead", "Leader"], ["led by", "Led by"], ["can support", "Support"], ["supported by", "Supported by"]]) {
      const names = list(u[col]);
      if (names.length) leader.push({ heading, intro: intro[heading], units: names });
    }
    return {
      name: u.unit, unitType: u["unit type"] || "",
      profiles: (profiles.get(k) || []).map(p => ({ name: p.model || "", M: p.m || "", T: p.t || "", SV: p.sv || "", W: p.w || "", LD: p.ld || "", OC: p.oc || "" })),
      invuln: u["invulnerable save"] || "",
      weapons: (weapons.get(k) || []).map(w => ({ type: /melee/i.test(w.type) ? "Melee" : "Ranged", name: w.weapon || "", range: w.range || "", A: w.a || "", skill: w["bs/ws"] || "", S: w.s || "", AP: w.ap || "", D: w.d || "", tags: w.keywords || "" })),
      sections: (sections.get(k) || []).map(s => ({ heading: s.section || "", text: s.text || "", lines: list(s["lines as printed"]).length ? list(s["lines as printed"]) : list(s.text), ...(s.formatted ? { rich: richOr(s.formatted, s.text) } : {}) })),
      keywords: kwList(u.keywords), factionKeywords: kwList(u["faction keywords"]),
      points: (points.get(k) || []).map(p => ({ models: num(p.models) || 1, points: num(p.points) || 0, ...(num(p["3rd+ unit points"]) ? { later: num(p["3rd+ unit points"]) } : {}) })),
      stratagems: u.stratagems
        ? list(u.stratagems).map(line => { const [group, name, cp] = line.split(/\s*\|\s*/); return { name: name || "", cp: num(cp) ?? cp ?? "", group: group || "" }; })
        : (strats.get(k) || []).map(s => ({ name: s.stratagem || "", cp: num(s.cp) ?? s.cp, group: s.group || "" })),
      abilities: (abilities.get(k) || []).map(a => ({ name: a.ability || "", text: a.rules || "", rich: richOr(a.formatted, a.rules || ""), wargear: /^(yes|true|y|1)$/i.test(a["wargear ability"] || "") })),
      coreAbilities: list(u["core abilities"]), armyRuleNames: list(u["army rules"]), leader,
      modelKeywords: String(u["model keywords"] || "").split("\n").map(l => l.match(/^([^:]+):\s*(.+)$/)).filter(Boolean).map(m => ({ model: m[1].trim(), keywords: kwList(m[2]) })),
      detachmentAbilities: list(u["detachment abilities"]),
      enhancementOptions: (enhOpts.get(k) || []).map(e => ({ name: e.enhancement || "", points: num(e.points) })),
      unsorted: (unsorted.get(k) || []).map(r => r.text).filter(Boolean),
    };
  });
  const detRules = byUnit(sheet("Detachment rules"), "detachment"), enhs = byUnit(sheet("Enhancements"), "detachment"), detStrats = byUnit(sheet("Stratagems"), "detachment");
  const detachments = sheet("Detachments").filter(d => d.detachment).map(d => {
    const k = normName(d.detachment);
    const fl = r => (r["flavour text"] || "").trim() ? { flavour: r["flavour text"].trim() } : {};
    let rules = (detRules.get(k) || []).map(r => ({ name: r.rule || "", text: r.rules || "", rich: richOr(r.formatted, r.rules || ""), ...fl(r) }));
    // Older files only have the combined Rules column: "Name: text" paragraphs.
    if (!rules.length && d.rules) rules = d.rules.split(/\n{2,}/).map(p => { const m = p.match(/^([^:\n]{2,80}):\s*([\s\S]*)$/); return m ? { name: m[1].trim(), text: m[2].trim() } : { name: "", text: p.trim() }; });
    return {
      name: tidyApostrophes(d.detachment), dp: String(d["detachment points"] || "").replace(/\s+/g, "") || "1DP",
      unique: (d["unique keyword"] || "").trim(), description: d.description || "", rules,
      ...(d["force disposition"] ? { dispositions: String(d["force disposition"]).split(/\s*,\s*/).filter(Boolean) } : {}),
      // "Upgrade" column: Yes/No; workbooks made before it existed leave it to the rules text.
      enhancements: (enhs.get(k) || []).map(e => ({ name: e.enhancement || "", points: num(e.points), text: e.rules || "", rich: richOr(e.formatted, e.rules || ""), ...fl(e),
        ...(/^(yes|true|y|1)$/i.test(e.upgrade || "") ? { upgrade: true } : /^(no|false|n|0)$/i.test(e.upgrade || "") ? { upgrade: false } : {}) })),
      stratagems: (detStrats.get(k) || []).map(s => ({ name: s.stratagem || "", cp: s.cp || "", category: s.category || "", text: s.rules || "", rich: richOr(s.formatted, s.rules || ""), ...fl(s) })),
      fromExcel: true,
    };
  });
  const armyRules = sheet("Army rules").filter(r => r.rule).map(r => ({ name: r.rule, special: /^(yes|true|y|1)$/i.test(r["special move"] || ""), text: r.rules || "", rich: richOr(r.formatted, r.rules || ""),
    ...(r["part of"] ? { partOf: r["part of"], kind: r.type || "" } : {}) }));
  const about = Object.fromEntries(sheet("About").map(r => [String(r.field || "").toLowerCase(), r.value]));
  const [c1, c2] = String(about.colours || "").match(/#[0-9a-f]{6}/gi) || [];
  const icon = /^data:image\//.test(about.symbol || "") ? about.symbol : "";
  return { datasheets, detachments, armyRules, faction: about.faction || "", theme: c1 || icon ? { c1, c2, icon } : null };
}

async function downloadBlob(blob, fileName) {
  // Inside the Claude preview, files are offered through its own save prompt.
  if (window.claude?.use) {
    const downloads = await window.claude.use("downloads").catch(() => null);
    if (downloads) {
      try { await downloads.save({ filename: fileName, data: blob }); return true; }
      catch (err) {
        if (err?.code !== "declined") toast("Couldn't save the file here — try it on your own site");
        return false;
      }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return true;
}

async function exportDocToExcel(doc) {
  // Built fresh from the stored data: rules documents (Core Rules, updates) or faction data.
  const rules = !doc.structured.datasheets;
  const blob = await buildXlsx(rules ? rulesToSheets(doc) : structuredToSheets(doc.structured, doc.faction, { ...(doc.theme || {}), icon: doc.icon }));
  const saved = await downloadBlob(blob, `${(rules ? doc.title : doc.faction || doc.title).replace(/[^\w\- ]+/g, "").trim() || "rules"} data.xlsx`);
  if (saved) toast(`Excel file saved (${formatGB(blob.size)})`);
}

export { buildXlsx, exportDocToExcel, readXlsx, structuredFromWorkbook, structuredToSheets };
