/* RulesForge · rules-doc.js
 * Core Rules and rules updates (FAQs, errata, Balance Dataslates) as numbered rule sections,
 * their Excel workbook, which version is newest, and the rules currently in force.
 */
import { state } from "./core.js?v=8.78";
import { dropPageFurniture } from "./faction-parser.js?v=8.78";
import { mostCommonSize, readingLines } from "./pdf-reader.js?v=8.78";
import { cleanGlyphs, normName, stripRich, titleCase } from "./text.js?v=8.78";

const SECTION_NUM = /^\d{2}\.\d{2}(?:\.\d{2})?$/;
/** Used until a Core Rules file says otherwise (Core Rules 25.03). */
const DEFAULT_BATTLE_SIZES = [
  { name: "Incursion", points: 1000, dp: 2, enh: 2, units: 2 },
  { name: "Strike Force", points: 2000, dp: 3, enh: 4, units: 3 },
];

/* ---------- Which version is newest ---------- */

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function parseDate(s) {
  s = String(s || "").trim();
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return Date.UTC(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]);
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return Date.UTC(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]);
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return Date.UTC(+m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), 1);
  m = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    const [mo, d] = a > 12 ? [b, a] : [a, b];   // month first unless that's impossible
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return Date.UTC(y, mo - 1, d);
  }
  return null;
}

/** Version and date printed in a document ("Version 1.2", "Updated 4 November 2026"), else from its file name. */
function detectEdition(text, ...names) {
  const all = [String(text || "").slice(0, 6000), ...names].join("\n");
  const v = all.match(/\b(?:version|ver\.?)\s*:?\s*(\d+(?:\.\d+){0,2})\b/i) || all.match(/(?:^|[\s_(-])v(\d+(?:\.\d+){1,2})\b/i);
  let date = null;
  const labelled = all.match(/\b(?:last updated|updated|effective(?: from)?|published|revised|date)\s*:?\s*([^\n]{4,40})/i);
  if (labelled) date = parseDate(labelled[1]);
  if (date == null) {
    for (const line of all.split("\n")) { date = parseDate(line); if (date != null) break; }
  }
  return { version: v ? v[1] : "", date };
}

const versionParts = v => String(v || "").split(".").map(n => +n || 0);
/** Sorts oldest first: by date, then version number, then when it was added. */
function compareEditions(a, b) {
  const da = a.edition?.date ?? null, db = b.edition?.date ?? null;
  if (da != null && db != null && da !== db) return da - db;
  const va = versionParts(a.edition?.version), vb = versionParts(b.edition?.version);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
  return (a.importedAt || 0) - (b.importedAt || 0);
}
const editionLabel = ed => [ed?.version ? `v${ed.version}` : "", ed?.date != null ? new Date(ed.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : ""].filter(Boolean).join(" · ");

/* ---------- Reading a rules PDF ---------- */

/** Splits a rules PDF into its numbered sections ("DEEP STRIKE 24.09"), with chapters, sub-headings, bullets and tables kept. */
/** Heading keys: lower case letters only, without the "2." numbering, so "2. READY" and "Ready" match. */
const headingKey = s => String(s).split("|")[0].replace(/\s+\d*\s*AP\s*$/i, "").toLowerCase().replace(/^\s*[\d.•]+\s*/, "").replace(/[^a-z]/g, "");

/**
 * The "Contents" box: the text under the word Contents, read column by column (top to bottom, then left to right).
 * Large headings in the box are chapters; the lines under them are the entries. Stops at the next large heading or page end.
 */
function readContents(items, body) {
  const head = items.find(i => /^contents$/i.test(i.t.trim()));
  if (!head) return null;
  const pageTop = head.y - head.py;
  const pageBottom = pageTop + (head.ph || 0);
  const big = body * 1.8;
  const below = items.filter(i => i.y > head.y + 1 && i.y < pageBottom);
  const stop = Math.min(...below.filter(i => i.s >= big).map(i => i.y), pageBottom);
  const box = below.filter(i => i.y < stop && i.s < big);
  if (!box.length) return null;
  // Columns: split wherever the gap between left edges is wide (a column starts after a gap of 60pt or more).
  const xs = [...new Set(box.map(i => Math.round(i.x)))].sort((a, b) => a - b);
  const splits = [];
  for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > 60) splits.push(xs[k]);
  const columnOf = i => splits.filter(s => i.x >= s - 2).length;
  const entries = [];
  // The chapter carries across columns: a column can start with an entry under the chapter heading in the column before it.
  let chapter = "", lastBullet = "";
  const cols = [...new Set(box.map(columnOf))].sort((a, b) => a - b);
  for (const c of cols) {
    const colItems = box.filter(i => columnOf(i) === c).sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const it of colItems) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(it.y - last.y) <= 3) last.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let text = "";
      row.items.forEach((it, n) => {
        const gap = n ? it.x - (row.items[n - 1].x + (row.items[n - 1].w || 0)) : 0;
        text += (n && gap > 1.5 ? " " : "") + it.t.trim();
      });
      text = cleanGlyphs(text).replace(/\s+/g, " ").trim();
      const size = Math.max(...row.items.map(i => i.s));
      if (!text || text === "•") continue;
      if (size >= body * 1.2 && !/^•/.test(text)) {
        chapter = text; lastBullet = "";
        entries.push({ num: "", title: text, chapterOf: "", groupOf: "", key: headingKey(text), chapter: true });
        continue;
      }
      const bare = text.replace(/^•\s*/, "").trim();
      const m = bare.match(/^(\d{1,2})\s*\.?\s*(.+)$/);
      if (!m) {
        // A bullet such as "Shoot" or "Fight": its numbered steps below it are nested under it.
        lastBullet = bare;
        entries.push({ num: "", title: bare, chapterOf: chapter, groupOf: "", key: headingKey(text) });
        continue;
      }
      entries.push({ num: m[1], title: m[2].trim(), chapterOf: chapter, groupOf: lastBullet, key: headingKey(text) });
    }
  }
  // A chapter whose first subheading is "… Actions" (e.g. "Actions" with "Universal Actions" first) takes that name;
  // the subheading becomes the chapter box itself. The body is still matched on the original chapter heading.
  for (const ch of entries.filter(e => e.chapter)) {
    const first = entries.find(e => !e.chapter && !e.groupOf && e.chapterOf === ch.title);
    if (!first || first.title === ch.title || !/\bActions$/.test(first.title)) continue;
    const old = ch.title;
    ch.title = first.title;
    entries.splice(entries.indexOf(first), 1);
    entries.forEach(e => { if (e.chapterOf === old) e.chapterOf = ch.title; });
  }
  const boxItems = new Set([head, ...box]);
  return entries.length ? { entries, boxItems } : null;
}

/**
 * Finds the body lines that are contents headings. Chapters are read in order down the page. Inside a chapter, numbered
 * sub-headings are followed down the left half in order; when the sequence breaks, the search goes back to the chapter
 * header and reads the right half from the top. Unnumbered entries are matched the same way.
 */
function tocHeadings(lines, entries) {
  // The body is one column: each chapter's subheadings are found by reading straight down its lines, in contents order.
  const found = new Map();
  const keys = l => headingKey(l.text);
  let from = 0;
  const chapterLine = [];
  for (const ch of entries.filter(e => e.chapter)) {
    let at = -1;
    for (let i = from; i < lines.length; i++) if (keys(lines[i]) === ch.key) { at = i; break; }
    if (at < 0) continue;
    chapterLine.push({ at, e: ch });
    found.set(at, ch);
    from = at + 1;
  }
  chapterLine.forEach((ch, n) => {
    const endAt = n + 1 < chapterLine.length ? chapterLine[n + 1].at : lines.length;
    // Subheadings in order from the chapter heading down; a subheading that isn't found is skipped.
    let pos = ch.at + 1;
    for (const kid of entries.filter(e => !e.chapter && e.chapterOf === ch.e.title && !e.groupOf)) {
      let at = -1;
      for (let i = pos; i < endAt; i++) if (keys(lines[i]) === kid.key) { at = i; break; }
      if (at < 0) continue;
      found.set(at, kid);
      pos = at + 1;
      // Numbered steps under this bullet (e.g. Shoot 1-6, Fight 1-4) follow it in order.
      let sp = at + 1;
      for (const st of entries.filter(e => e.groupOf === kid.title && e.chapterOf === ch.e.title)) {
        let j = -1;
        for (let i = sp; i < endAt; i++) if (keys(lines[i]) === st.key) { j = i; break; }
        if (j < 0) continue;
        found.set(j, st);
        sp = j + 1;
      }
    }
  });
  return found;
}

/** The 40K parser first. Then the Contents box (Wahapedia style). Then Kill Team's numbered headings ("2. READY"), if still too few. */
function parseRulesPdfAuto(rawItems) {
  const strict = parseRulesPdf(rawItems);
  const toc = parseRulesPdf(rawItems, "toc");
  // The contents pass only wins when it finds more numbered rules: 40K contents list chapters without numbers.
  const numbered = r => r.sections.filter(s => s.num).length;
  let best = numbered(toc) > numbered(strict) ? toc : strict;
  if (best.sections.length >= 3) return best;
  const relaxed = parseRulesPdf(rawItems, "relaxed");
  return relaxed.sections.length > best.sections.length ? relaxed : best;
}

function parseRulesPdf(rawItems, mode = null) {
  let items = dropPageFurniture(rawItems);
  const body = mostCommonSize(items);
  const toc = mode === "toc" ? readContents(items, body) : null;
  if (toc) items = items.filter(i => !toc.boxItems.has(i));
  const lines = readingLines(items, 4);
  const headingAt = toc ? tocHeadings(lines, toc.entries) : new Map();
  const sections = [];
  let part = "", chapter = "", chapterNum = "", cur = null, skipping = false;
  const isUpperish = t => t === t.toUpperCase() && /[A-Z]{2}/.test(t);
  const start = (num, title, extra = {}) => {
    cur = { num, title, chapter: chapter ? `${chapterNum ? chapterNum + " " : ""}${chapter}` : "", part, lines: [], ...extra };
    sections.push(cur);
    skipping = false;
  };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const its = line.items;
    const first = its[0];
    const nums = its.filter(i => SECTION_NUM.test(i.t.trim()) && i.s >= body + 1.5);
    const words = its.filter(i => !SECTION_NUM.test(i.t.trim()) && !/^\d+CP$/i.test(i.t.trim()));
    const titleText = cleanGlyphs(words.map(i => i.t).join(" ")).trim();
    // Collapsed FAQ boxes ("FAQ", "FAQ / ERRATA", with or without the web page's Show button) hold no rules text.
    if (/^(FAQ|ERRATA)(\s*\/\s*(FAQ|ERRATA))?\s*(Show|Hide)?$/i.test(line.text.trim()) || /^(Show|Hide)$/i.test(line.text.trim())) { skipping = false; continue; }
    // A line that is one of the Contents entries, in contents order: it starts that rule under its contents chapter.
    const hit = headingAt.get(li);
    if (hit && hit.chapter) { chapter = hit.title; chapterNum = ""; part = ""; cur = null; continue; }
    if (hit) { chapter = hit.chapterOf || ""; chapterNum = ""; part = hit.groupOf || ""; start(hit.num, titleCase(hit.title).replace(/\s*\/\s*/g, " / ")); continue; }
    // Part and chapter titles (very large); a chapter has its number at the right ("CORE ABILITIES … 24").
    if (first.b && line.size >= body * 2.5 && isUpperish(titleText.replace(/\d+/g, ""))) {
      const n = its.find(i => /^\d{2}$/.test(i.t.trim()));
      const name = titleCase(cleanGlyphs(its.filter(i => i !== n).map(i => i.t).join(" ")).trim());
      if (!name || /^\d+$/.test(name)) continue;
      if (n) { chapter = name; chapterNum = n.t.trim(); }
      else if (line.size >= body * 3.6) { part = name; chapter = ""; chapterNum = ""; }
      else { chapter = name; chapterNum = ""; }
      cur = null;
      continue;
    }
    // Kill Team style ("2. READY"): an uppercase numbered heading. Only used by the Kill Team retry.
    if (mode === "relaxed" && !nums.length && /^\d{1,2}\.\s+[A-Z][A-Z'’\- ]{2,}$/.test(line.text.trim())) {
      start("", titleCase(line.text.trim().replace(/^\d{1,2}\.\s+/, "")));
      continue;
    }
    // A numbered rule: bold title with its number beside it.
    if (nums.length && first.b && first.s >= body + 1.5 && titleText && isUpperish(titleText)) {
      const cp = its.find(i => /^\d+CP$/i.test(i.t.trim()));
      start(nums[0].t.trim(), titleCase(titleText).replace(/\s*\/\s*/g, " / "), cp ? { cp: cp.t.trim().toUpperCase() } : {});
      continue;
    }
    // Bold headings without a number: "SEE ALSO" link boxes are skipped; others are sub-headings inside the rule.
    if (first.b && first.s >= body + 3 && its.every(i => i.b || i.s >= body + 3) && isUpperish(titleText)) {
      if (/^SEE ALSO$/i.test(titleText)) { skipping = true; continue; }
      if (!cur) start("", titleCase(titleText));
      else cur.lines.push({ heading: titleCase(titleText) });
      skipping = false;
      continue;
    }
    if (!cur) continue;
    if (skipping) { if (line.x > (cur.baseX ?? first.x) + 5 || its.some(i => SECTION_NUM.test(i.t.trim()))) continue; skipping = false; }
    if (/^(FAQ|ERRATA)\s*(Show|Hide)?$/i.test(line.text) || /^(Show|Hide)$/i.test(line.text)) continue;
    // Italic scene-setting text right under a heading isn't rules text.
    if (!cur.lines.some(l => !l.heading) && its.every(i => i.it)) continue;
    cur.baseX ??= first.x;
    cur.lines.push(line);
  }
  let out = sections.map(s => ({ num: s.num, title: s.title, chapter: s.chapter, part: s.part, ...(s.cp ? { cp: s.cp } : {}), ...linesToText(s.lines, s.baseX ?? 0, body) }))
    .filter(s => s.text || s.num);
  // A rule quoted inside another chapter ("LEADER 24.22" shown in Attached Units) keeps only its home copy.
  const home = s => s.chapter.startsWith(s.num.slice(0, 2) + " ");
  out = out.filter(s => !s.num || home(s) || !out.some(o => o !== s && o.num === s.num && home(o)));
  return { sections: out, battleSizes: findBattleSizes(lines) };
}

/** One line as formatted text: bold words as **bold**, widely spaced cells joined with " | ". */
function lineRich(line, body) {
  let out = "", lastEnd = null, bold = false;
  for (const i of line.items) {
    const t = cleanGlyphs(i.t);
    const gap = lastEnd == null ? 0 : i.x - lastEnd;
    const sep = lastEnd == null ? "" : gap > 22 ? " | " : " ";
    const b = i.b && i.s <= body + 2 && !SECTION_NUM.test(t.trim());
    if (b && !bold) { out += sep + "**"; bold = true; }
    else if (!b && bold) { out = out.replace(/\s+$/, "") + "**" + sep; bold = false; }
    else out += sep;
    out += t;
    lastEnd = i.x + (i.w || 0);
  }
  if (bold) out += "**";
  return out.replace(/\*\*\s*\*\*/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** Joins a section's lines into paragraphs, with indented lines as bullets. */
function linesToText(lines, baseX, body) {
  const paras = [];
  let prev = null;
  for (const l of lines) {
    if (l.heading) { paras.push({ kind: "h", text: l.heading }); prev = null; continue; }
    const rich = lineRich(l, body);
    if (!rich) continue;
    const indent = l.x > baseX + 10;
    const gap = prev ? l.y - prev.y : 0;
    const last = paras[paras.length - 1];
    const ended = last && /[.:!?]\**$/.test(last.text);
    const table = / \| /.test(rich);
    const newPara = !last || last.kind === "h" || table || last.kind === "t" || gap > prev.size * 1.9
      || (indent && (last.kind !== "b" || ended)) || (!indent && last.kind === "b");
    if (newPara) paras.push({ kind: table ? "t" : indent ? "b" : "p", text: rich });
    else last.text += (last.text.endsWith("-") && !last.text.endsWith(" -") ? "" : " ") + rich;
    prev = l;
  }
  const rich = paras.map(p => p.kind === "h" ? `**${p.text}**` : p.kind === "b" ? `• ${p.text}` : p.text).join("\n").replace(/\*\* \*\*/g, " ");
  return { text: stripRich(rich), rich };
}

/** The battle size table: "STRIKE FORCE | 2000 | 3 | 4 | 3". */
function findBattleSizes(lines) {
  const out = [];
  let head = null;
  for (const l of lines) {
    const cells = l.items.map(i => i.t.trim());
    if (/BATTLE SIZE/i.test(cells[0] || "") && cells.length >= 4) { head = l; continue; }
    if (cells.length < 5 || !/^[A-Za-z]/.test(cells[0]) || !cells.slice(1).every(c => /^\d+$/.test(c)) || +cells[1] < 200) continue;
    // Columns follow the header when there is one; otherwise Points, DP, Enhancements, Units.
    const col = re => { const i = head ? head.items.findIndex(h => re.test(h.t)) : -1; return i > 0 ? i : null; };
    const pick = (re, d) => +cells[Math.min(cells.length - 1, col(re) ?? d)];
    out.push({ name: titleCase(cleanGlyphs(cells[0])), points: pick(/points/i, 1), dp: pick(/detach|\bdp\b/i, 2), enh: pick(/enhanc/i, 3), units: pick(/unit/i, 4) });
  }
  return out;
}

/** Search passages from rules sections: one per section, long ones split at paragraphs. */
function sectionChunks(sections) {
  const chunks = [];
  for (const s of sections) {
    const head = `${s.num ? s.num + " " : ""}${s.title.toUpperCase()}${s.chapter ? ` (${s.chapter})` : ""}`;
    const paras = String(s.text || "").split("\n");
    let buf = "";
    const flush = () => { if (buf.trim()) chunks.push({ page: chunks.length + 1, text: `${head}\n${buf.trim()}`, cite: `${s.num ? s.num + " " : ""}${s.title}` }); buf = ""; };
    for (const p of paras) { if (buf && buf.length + p.length > 2400) flush(); buf += p + "\n"; }
    flush();
    if (!s.text) chunks.push({ page: chunks.length + 1, text: head, cite: `${s.num} ${s.title}` });
  }
  return chunks;
}

/* ---------- Excel ---------- */

/** A Collection workbook for a PDF added as its own Game Pack section (e.g. "Kill Team"): one row per parsed entry,
 *  and About names the section, which is the column the Game Pack files it under. Reads back with collectionFromWorkbook. */
function collectionToSheets(doc) {
  const W = (header, width) => ({ header, width });
  const ed = doc.edition || {};
  return [
    { name: "Entries", columns: [W("Category", 24), W("Name", 34), W("Tags", 24), W("Stats", 30), W("Text", 100)],
      rows: doc.structured.sections.map(s => [s.chapter || "General", s.title, "", "", s.text || ""]) },
    { name: "About", columns: [W("Field", 20), W("Value", 90)],
      rows: [["Kind", "Collection"], ["Title", doc.title], ["Section", doc.section], ["Version", ed.version || ""],
        ["Date", ed.date != null ? new Date(ed.date).toISOString().slice(0, 10) : ""], ["Made with", "RulesForge"]] },
  ];
}

const KIND_NAMES = { core: "Core Rules", updates: "Rules update", companion: "Event Companion" };
function rulesToSheets(doc) {
  const d = doc.structured, W = (header, width) => ({ header, width });
  const ed = doc.edition || {};
  return [
    { name: "Rules", columns: [W("Number", 10), W("Rule", 34), W("Chapter", 28), W("Part", 22), W("CP", 6), W("Rules", 100), W("Formatted", 20)],
      rows: d.sections.map(s => [s.num, s.title, s.chapter || "", s.part || "", s.cp || "", s.text, s.rich && s.rich !== s.text ? s.rich : ""]) },
    { name: "Battle sizes", columns: [W("Battle size", 18), W("Points", 10), W("Detachment points", 12), W("Enhancement limit", 12), W("Unit limit", 10)],
      rows: (d.battleSizes || []).map(b => [b.name, b.points, b.dp, b.enh, b.units]) },
    { name: "About", columns: [W("Field", 20), W("Value", 90)],
      rows: [["Kind", KIND_NAMES[doc.kind] || "Core Rules"], ["Title", doc.title], ["Version", ed.version || ""],
        ["Date", ed.date != null ? new Date(ed.date).toISOString().slice(0, 10) : ""], ["Made with", "RulesForge"],
        ["Editing", "Each row is one numbered rule. Fix text or add rows, then add this file in Library. For updates, a rule with the same Number (or the same Rule name) as the Core Rules replaces it; the newest Version/Date wins. Battle sizes set the list builder's limits."]] },
  ];
}

/** Reads a rules workbook back, or returns null when it isn't one. */
function rulesFromWorkbook(book) {
  const sheet = name => {
    const key = Object.keys(book).find(k => k.trim().toLowerCase() === name.toLowerCase());
    const rows = key ? book[key] : [];
    const head = (rows[0] || []).map(h => String(h || "").trim().toLowerCase());
    return rows.slice(1).filter(r => r && r.some(c => String(c ?? "").trim())).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "").replace(/\r\n?/g, "\n").trim()])));
  };
  const rows = sheet("Rules");
  if (!rows.length) return null;
  const about = Object.fromEntries(sheet("About").map(r => [String(r.field || "").toLowerCase(), r.value]));
  const num = s => { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; };
  const sections = rows.filter(r => r.rule || r.number).map(r => {
    const rich = r.formatted && (/\[datacard: /.test(r.formatted) || stripRich(r.formatted).replace(/\s+/g, " ") === String(r.rules).replace(/\s+/g, " ")) ? r.formatted : r.rules || "";
    return { num: r.number || "", title: r.rule || "", chapter: r.chapter || "", part: r.part || "", ...(r.cp ? { cp: r.cp } : {}), text: r.rules || "", rich };
  });
  const battleSizes = sheet("Battle sizes").filter(b => b["battle size"]).map(b => ({ name: b["battle size"], points: num(b.points), dp: num(b["detachment points"]), enh: num(b["enhancement limit"]), units: num(b["unit limit"]) }));
  const kind = /companion/i.test(about.kind || "") ? "companion" : /update|faq|errata|dataslate/i.test(about.kind || "") ? "updates" : "core";
  return { kind, title: about.title || "", edition: { version: about.version || "", date: about.date ? parseDate(about.date) : null }, structured: { sections, battleSizes } };
}

/** A Collection workbook: any game's reference entries (monsters, spells, units, items, cards…) as rows.
 *  Sheet "Entries": Category · Name · Tags · Stats (one "Name: value" per line) · Text. Sheet "About": Title, Section
 *  (what the Game Pack calls this column, e.g. "Bestiary"). Each entry becomes a section of the Core Rules viewer. */
function collectionFromWorkbook(book) {
  const sheet = name => {
    const key = Object.keys(book).find(k => k.trim().toLowerCase() === name.toLowerCase());
    const rows = key ? book[key] : [];
    const head = (rows[0] || []).map(h => String(h || "").trim().toLowerCase());
    return rows.slice(1).filter(r => r && r.some(c => String(c ?? "").trim())).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "").replace(/\r\n?/g, "\n").trim()])));
  };
  const rows = sheet("Entries").filter(r => r.name);
  if (!rows.length) return null;
  const about = Object.fromEntries(sheet("About").map(r => [String(r.field || "").toLowerCase(), r.value]));
  const sections = rows.map(r => {
    const stats = (r.stats || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l]; });
    const plain = [r.tags, ...stats.map(([k, v]) => k ? `${k}: ${v}` : v), (r.text || "").replace(/^[-*]\s+/gm, "• ")].filter(Boolean).join("\n");
    const text = (r.text || "").replace(/^[-*]\s+/gm, "• ");   // "- item" is a bullet too
    const rich = [r.tags, ...stats.map(([k, v]) => k ? `**${k}:** ${v}` : v), text].filter(Boolean).join("\n");
    return { num: "", title: r.name, chapter: r.category || "", part: "", text: plain, rich };
  });
  return { kind: "collection", title: about.title || "", section: about.section || "Reference", edition: { version: about.version || "", date: about.date ? parseDate(about.date) : null }, structured: { sections } };
}

/* ---------- The rules in force ---------- */

/** An Event Companion (Doubles, Teams, …) or a Collection (a bestiary, spell list, any game's reference tables): laid
 *  out like the Core Rules, but its entries are its own — never merged into them. */
const isReferenceDoc = d => (d.kind === "companion" || d.kind === "collection") && !!d.structured?.sections;
const isRulesDoc = d => (d.kind === "core" || d.kind === "updates") && d.structured?.sections;
let cache = { key: "", value: null };

/** Core Rules with every update laid over them, oldest to newest: a section with the same number
 *  (or, when unnumbered, the same name) in a newer document replaces the older one. */
function effectiveRules() {
  const docs = state.docs.filter(isRulesDoc);
  const key = docs.map(d => `${d.id}:${d.importedAt}:${d.edition?.date}:${d.edition?.version}`).join("|");
  if (cache.key === key && cache.value) return cache.value;
  const ordered = [...docs.filter(d => d.kind === "core").sort(compareEditions), ...docs.filter(d => d.kind === "updates").sort(compareEditions)];
  const byNum = new Map(), byTitle = new Map(), list = [];
  let battleSizes = null, sizesFrom = null;
  for (const doc of ordered) {
    const source = { docId: doc.id, title: doc.title, kind: doc.kind, edition: doc.edition || {} };
    for (const s of doc.structured.sections) {
      const t = normName(s.title.replace(/\(.*?\)/g, ""));
      // Only a different (newer) document replaces a rule; repeats inside one document are kept.
      let old = (s.num && byNum.get(s.num)) || (!s.num && t && byTitle.get(t)) || (doc.kind === "updates" && t && byTitle.get(t));
      if (old && old.source.docId === doc.id) old = null;
      const entry = { ...s, num: s.num || old?.num || "", source, replaces: old ? (old.replaces ? [...old.replaces, old.source] : [old.source]) : [] };
      if (old) list[list.indexOf(old)] = entry; else list.push(entry);
      if (entry.num && (!byNum.has(entry.num) || old)) byNum.set(entry.num, entry);
      if (t && (!byTitle.has(t) || old || byTitle.get(t).source.docId !== doc.id)) byTitle.set(t, entry);
    }
    if (doc.structured.battleSizes?.length) { battleSizes = doc.structured.battleSizes; sizesFrom = source; }
  }
  cache = { key, value: { sections: list, battleSizes: battleSizes || DEFAULT_BATTLE_SIZES, sizesFrom, docs: ordered } };
  return cache.value;
}

/** Battle sizes in force, smallest first. */
const battleSizes = () => effectiveRules().battleSizes.slice().sort((a, b) => a.points - b.points);

/** A core ability's rules text ("Deep Strike", "Deadly Demise 1", "Feel No Pain 5+"), if the Core Rules are loaded. */
function coreAbilityRule(name) {
  // The value after the name isn't part of it: "Scouts 6\"", "Feel No Pain 5+", "Deadly Demise D6+2", "Damaged 4".
  const key = normName(String(name).replace(/\[|\]/g, "").replace(/^(anti)[\s-]+.*$/i, "$1").replace(/\s+(d?\d+(\+\d+)?\+?"?|x)$/i, ""));
  if (!key) return null;
  const list = effectiveRules().sections.filter(s => /core abilit|weapon abilit/i.test(s.chapter || ""));
  return list.find(s => normName(s.title.replace(/\[|\]/g, "").replace(/\s+X$/i, "")) === key)
    || list.find(s => s.title.split("/").map(x => normName(x)).includes(key)) || null;
}

export { battleSizes, collectionFromWorkbook, collectionToSheets, compareEditions, coreAbilityRule, detectEdition, editionLabel, effectiveRules, isReferenceDoc, isRulesDoc, parseRulesPdf, parseRulesPdfAuto, rulesFromWorkbook, rulesToSheets, sectionChunks };
