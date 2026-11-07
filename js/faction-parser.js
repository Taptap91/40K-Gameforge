/* RulesForge · faction-parser.js
 * Turns faction pack text into datasheets, detachments, army rules and points. Two readers: normal letter/A4 pages, and very tall single-page exports.
 */
import { KNOWN_FACTIONS, uid } from "./core.js?v=8.9";
import { mostCommonSize, readingLines } from "./pdf-reader.js?v=8.9";
import { cleanGlyphs, isStatValue, isUpperText, joinParagraphs, letterCount, normName, stripRich, titleCase, upperKeywords } from "./text.js?v=8.9";

/** Reads Munitorum Field Manual–style tables: "5 models ..... 80 pts", "Enhancement ..... 25 pts". */
function parsePoints(pages) {
  const RX = {
    modelsPts: /^(\d+)\s*models?\b.*?(\d+)\s*(?:pts|points)\b/i,
    modelsOnly: /^(\d+)\s*models?[\s.…]*$/i,
    ptsOnly: /^[\s.…]*\+?(\d+)\s*(?:pts|points)\s*$/i,
    namedPts: /^([A-Za-z'][A-Za-z'\-\s,:&]{2,60}?)[\s.…]+\+?(\d+)\s*(?:pts|points)\b/i,
  };
  const factionByKey = new Map(KNOWN_FACTIONS.map(f => [normName(f), f]));
  const tidy = s => {
    const t = s.replace(/^[\s.…:]+|[\s.…:]+$/g, "");
    return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : t;
  };
  const results = [];
  const seen = new Set();
  const add = e => {
    const key = [e.name, e.models, e.points, e.enh, e.section].join("|");
    if (!seen.has(key)) { seen.add(key); results.push({ id: uid(), ...e }); }
  };
  let faction = null, candidate = null, pendingModels = null;

  for (const page of pages) {
    const lines = page.text.split("\n").map(l => l.trim()).filter(Boolean);
    const heading = (lines[0] || "").slice(0, 80);
    for (const line of lines) {
      const section = faction || heading;
      const f = factionByKey.get(normName(line));
      if (f) { faction = f; candidate = null; continue; }
      let m;
      if ((m = line.match(RX.modelsPts)) && candidate) {
        add({ name: candidate, models: +m[1], points: +m[2], enh: false, section, page: page.number });
        pendingModels = null; continue;
      }
      if ((m = line.match(RX.modelsOnly))) { pendingModels = +m[1]; continue; }
      if ((m = line.match(RX.ptsOnly))) {
        if (pendingModels && candidate) add({ name: candidate, models: pendingModels, points: +m[1], enh: false, section, page: page.number });
        pendingModels = null; continue;
      }
      if ((m = line.match(RX.namedPts))) {
        const name = tidy(m[1]);
        if (!/^models?\b/i.test(name)) add({ name, models: 0, points: +m[2], enh: true, section, page: page.number });
        continue;
      }
      if (line.length >= 3 && line.length <= 60 && !/\d/.test(line)) { candidate = tidy(line); pendingModels = null; }
    }
  }
  return results;
}

/**
 * Reads points by position on the page, for datasheet-style PDFs (e.g. Wahapedia exports) where
 *   - each datasheet title sits on a line ending in its base size: "CAPTAIN IN GRAVIS ARMOUR (⌀40mm)",
 *   - "YOUR UNIT COSTS" is followed by rows of "5 models" with the points to the right on the same row,
 *   - an "ENHANCEMENTS" section lists names with their points to the right.
 * Items: { t: text, x, y: top-down position, s: font size }.
 */
function parsePositionedPoints(pages) {
  const results = [];
  const letters = s => (s.match(/[A-Za-z]/g) || []).length;
  const isStat = s => /^(\d+["+]?|-|\d+\+|D\d|\d*D\d+(\+\d+)?)$/.test(s);
  const tidy = t => {
    t = t.replace(/\s+/g, " ").trim();
    return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s\-(])(\w)/g, (m, a, b) => a + b.toUpperCase()) : t;
  };
  let title = null;
  let carried = null;   // a "YOUR UNIT COSTS" heading at the very bottom of the previous page

  for (const page of pages) {
    const items = (page.items || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    if (!items.length) continue;
    const sameRow = (a, b, tol = 7) => Math.abs(a.y - b.y) <= tol;
    const events = [];
    const top = items[0].y, bottom = items[items.length - 1].y;

    // A costs block split by a page break: its rows are at the top of this page.
    if (carried) {
      const rows = [];
      for (const m of items.filter(w => w.y < top + 120 && Math.abs(w.x - carried.x) < 60)) {
        const mm = m.t.match(/^(\d+)\s*models?$/i);
        const cost = mm && items.find(w => sameRow(w, m) && w.x - m.x > 100 && w.x - m.x < 450 && /^\d{1,4}$/.test(w.t));
        if (cost) rows.push({ models: +mm[1], points: +cost.t, later: carried.later });
      }
      if (rows.length) events.push({ y: top - 1, type: "costs", rows });
      carried = null;
    }

    // 1. Datasheet titles: the line directly above the stat header "M T SV W LD OC".
    //    Any base size in brackets after the name, like "(⌀40mm)", is dropped.
    const headers = items.filter(w => /^M(\s+T\s+SV\s+W\s+LD\s+OC)?$/.test(w.t) &&
      (/OC$/.test(w.t) || items.some(o => o.t === "OC" && sameRow(o, w, 4) && o.x > w.x && o.x - w.x < 300)));
    for (const hdr of headers) {
      const above = items.filter(w => w.y < hdr.y - 4 && w.y > hdr.y - 80 && w.x > hdr.x - 40 && w.x < hdr.x + 520);
      if (!above.length) continue;
      const lineY = Math.max(...above.map(w => w.y));
      let line = above.filter(w => Math.abs(w.y - lineY) <= 10).sort((a, b) => a.x - b.x);
      const paren = line.findIndex(w => w.t.includes("("));
      if (paren >= 0) {
        const parenItem = line[paren];
        const head = parenItem.t.split("(")[0].trim();
        line = line.slice(0, paren);
        if (head) line.push({ ...parenItem, t: head });
      }
      line = line.filter(w => w.t !== "⌀");
      // Rows of a multi-profile unit start with stats (6" 5 3+ …) — those aren't titles.
      if (!line.length || line.some(w => isStat(w.t)) || letters(line[0].t) < 3) continue;
      events.push({ y: hdr.y, type: "title", name: tidy(line.map(w => w.t).join(" ")) });
    }

    // 2. "YOUR UNIT COSTS" blocks: rows of "N models" with the cost to their right.
    //    11th edition can have two: "YOUR 1ST TO 2ND UNITS COST" and "YOUR 3RD+ UNIT COSTS".
    for (const h of items.filter(w => COST_HEADING.test(w.t))) {
      const later = /3RD|THIRD/i.test(h.t);
      const column = items.filter(w => w.y > h.y + 2 && w.y < h.y + 160 && Math.abs(w.x - h.x) < 60);
      const stop = column.find(w => letters(w.t) >= 3 && !/^\d+\s*models?$/i.test(w.t));
      const end = stop ? stop.y - 1 : h.y + 160;
      const rows = [];
      for (const m of column) {
        const mm = m.t.match(/^(\d+)\s*models?$/i);
        if (!mm || m.y > end) continue;
        const cost = items.find(w => sameRow(w, m) && w.x - m.x > 100 && w.x - m.x < 450 && /^\d{1,4}$/.test(w.t));
        if (cost) rows.push({ models: +mm[1], points: +cost.t, later });
      }
      if (rows.length) events.push({ y: h.y, type: "costs", rows });
      else if (bottom - h.y < 60) carried = { x: h.x, later };
    }

    // 3. "ENHANCEMENTS" sections: a name with its points to the right, until the next heading in that column.
    for (const h of items.filter(w => /^ENHANCEMENTS$/i.test(w.t))) {
      const next = items.find(w => w.y > h.y + 5 && Math.abs(w.x - h.x) < 40 && w.s >= h.s - 0.5 && /[A-Z]{3}/.test(w.t));
      const end = next ? next.y : h.y + 900;
      for (const n of items) {
        if (n.y <= h.y || n.y >= end || !/^\d{1,3}$/.test(n.t) || n.x - h.x < 150 || n.x - h.x > 330) continue;
        const name = items.find(w => sameRow(w, n, 5) && Math.abs(w.x - h.x) < 20 && letters(w.t) >= 3);
        if (name) results.push({ name: name.t, models: 0, points: +n.t, enh: true, section: "", page: page.number });
      }
    }

    // Pair each cost block with the nearest title above it (titles carry over between pages).
    events.sort((a, b) => a.y - b.y);
    for (const e of events) {
      if (e.type === "title") { title = e.name; continue; }
      if (!title) continue;
      for (const r of e.rows) results.push({ name: title, models: r.models, points: r.points, later: r.later, enh: false, section: "", page: page.number });
    }
  }
  return mergeCostTiers(results);
}

const COST_HEADING = /YOUR\b.*\bCOSTS?\b/i;

/** Folds "3rd+ unit" prices into the matching first-tier entry as `later`. */
function mergeCostTiers(results) {
  const out = [], byKey = new Map();
  for (const r of results) {
    if (r.enh) { out.push(r); continue; }
    const key = normName(r.name) + "|" + r.models;
    let e = byKey.get(key);
    if (!e) { e = { ...r, later: undefined }; if (r.later) { e.points = undefined; } byKey.set(key, e); out.push(e); }
    if (r.later) e.later = r.points; else e.points = r.points;
  }
  return out.map(e => (e.points === undefined ? { ...e, points: e.later, later: undefined } : e)).map(e => {
    if (e.later === undefined || e.later === e.points) { const { later, ...rest } = e; return rest; }
    return e;
  });
}

/** Combines the position-based and text-based readers, dropping duplicates. */
function extractPoints(pages) {
  const positional = parsePositionedPoints(pages);
  const named = new Set(positional.map(p => normName(p.name)));
  const textual = parsePoints(pages).filter(p => !named.has(normName(p.name)));
  const seen = new Set(), out = [];
  for (const p of [...positional, ...textual]) {
    const key = [normName(p.name), p.models, p.points, p.enh].join("|");
    if (!seen.has(key)) { seen.add(key); out.push({ id: uid(), ...p }); }
  }
  return out;
}

/* Game modes left out of the converted data. */
/** Marks a sub-title line inside an army rule (e.g. one of Afflicted's Plagues). */
const SUBHEAD = "\u0001";
/** An army rule's text, with sub-titled parts as their own paragraphs (bold in the rich version). */
function armyRuleWithSubheads(e) {
  const blocks = [];
  // Web-page leftovers at the end of a rule ("FAQ / ERRATA Show") aren't rules text.
  e = { ...e, lines: e.lines.map(l => l.replace(/\s*\bFAQ\s*\/\s*ERRATA\b(\s*(Show|Hide)\b)?\s*$/i, "")).filter(l => l.trim() && !/^(Show|Hide)$/i.test(l.trim())) };
  for (const l of e.lines) {
    if (l.startsWith(SUBHEAD)) blocks.push({ head: l.slice(1), lines: [] });
    else (blocks[blocks.length - 1] || blocks[blocks.push({ head: "", lines: [] }) - 1]).lines.push(l);
  }
  if (!blocks.some(b => b.head)) return { name: e.name, text: joinParagraphs(e.lines) };
  const text = blocks.map(b => (b.head ? b.head + ": " : "") + joinParagraphs(b.lines)).join("\n\n");
  const rich = blocks.map(b => (b.head ? `**${b.head}:** ` : "") + joinParagraphs(b.lines)).join("\n\n");
  return { name: e.name, text, rich };
}

/** The faction's "Army Rules" section read straight from the page layout: from the largest "ARMY RULES" heading
 *  to the next heading as large, split into rules at their capitalised titles (FAQ/Errata skipped).
 *  It doesn't depend on how the rest of the pack is laid out, so it catches rules the main readers miss. */
function armyRulesFromLayout(items) {
  const heads = items.filter(i => /^ARMY\s+RULES?$/i.test(cleanGlyphs(i.t).trim()));
  if (!heads.length) return [];
  const big = Math.max(...heads.map(h => h.s));
  if (big < mostCommonSize(items) * 1.5) return [];   // only the small labels on datasheets, no section heading
  const head = heads.filter(h => h.s >= big - 0.5).sort((a, b) => a.y - b.y)[0];
  const after = items.filter(i => i.y > head.y + 2).sort((a, b) => a.y - b.y);
  const stop = after.find(i => i.s >= head.s - 0.5 && letterCount(i.t) >= 3);
  const region = after.filter(i => !stop || i.y < stop.y - 1);
  if (!region.length) return [];
  const body = mostCommonSize(region);
  // Page by page; on two-column pages, the left column is read before the right.
  const pages = new Map();
  for (const i of region) { const k = Math.round(i.y - (i.py ?? i.y)); if (!pages.has(k)) pages.set(k, []); pages.get(k).push(i); }
  const lines = [];
  for (const [, its] of [...pages].sort((a, b) => a[0] - b[0])) {
    const pw = its[0].pw || Math.max(...its.map(i => i.x + (i.w || 0)));
    const mid = pw * 0.48;
    const spanning = its.filter(i => i.x < mid - 5 && i.x + (i.w || 0) > mid + 5).length;
    const rightStarts = its.filter(i => i.x >= mid && i.x < pw * 0.62).length;
    const cols = spanning <= 2 && rightStarts >= 3 ? [its.filter(i => i.x < mid), its.filter(i => i.x >= mid)] : [its];
    for (const c of cols) lines.push(...readingLines(c));
  }
  // Rule titles: capitalised lines at the section's usual title size or larger (smaller capitals are sub-headings).
  const titleLike = l => isUpperText(l.text) && letterCount(l.text) >= 3 && l.items.every(i => i.s >= body + 3);
  const titleSize = mostCommonSize(lines.filter(titleLike).flatMap(l => l.items)) || body + 3;
  const rules = [];
  let cur = null;
  for (const l of lines) {
    const text = l.text.trim();
    if (!text || /^(Show|Hide)$/i.test(text)) continue;
    if (titleLike(l) && l.size >= titleSize - 0.5) {
      cur = /^(FAQ|ERRATA)\b/i.test(text) ? null : { name: titleCase(text), lines: [] };
      if (cur) rules.push(cur);
      continue;
    }
    if (!cur) continue;
    const sub = l.items.every(i => i.b && i.s >= body + 1.5) && letterCount(text) >= 3;
    cur.lines.push(sub ? SUBHEAD + text : text);
  }
  return rules.filter(r => r.lines.length).map(armyRuleWithSubheads);
}

/** Keeps the main reader's army rules and adds any the layout pass found that it missed. */
function mergeArmyRules(found, fromLayout) {
  if (!found?.length) return fromLayout;
  const key = n => normName(String(n).replace(/\(.*?\)/g, ""));
  const have = new Set(found.map(r => key(r.name)));
  return [...found, ...fromLayout.filter(r => !have.has(key(r.name)))];
}

/** Rules headed "[Name] Ability" (Conservai: "KA’TAH ABILITY") belong to the earlier army rule whose name has that
 *  name in it (Martial Ka’tah). They're kept as parts of it, so the army rules list stays short. Safe to run again. */
function groupArmyRules(rules) {
  const out = (rules || []).map(r => ({ ...r }));
  out.forEach((r, i) => {
    if (r.partOf || r.special) return;
    const first = stripRich(r.text || "").split("\n")[0].trim();
    const m = first.match(/^(.{2,40}?)\s+abilit(?:y|ies)$/i);
    if (!m) return;
    const want = " " + normName(m[1]) + " ";
    const parent = out.slice(0, i).reverse().find(p => !p.partOf && !p.special && (" " + normName(p.name) + " ").includes(want));
    if (!parent) return;
    r.partOf = parent.name;
    r.kind = titleCase(first.toUpperCase());
    r.text = (r.text || "").split("\n").slice(1).join("\n").trim();
    if (r.rich) {
      const [f, ...rest] = r.rich.split("\n");
      r.rich = ((f.match(/\*\*/g) || []).length % 2 ? "**" : "") + rest.join("\n");
    }
  });
  return out;
}

/** Drops browser print headers and footers (date, page title, web address, "2/39") that repeat at the top or bottom of most pages. */
/** A detachment's name: all the text on its title line, left to right, up to its Force Disposition symbol and DP cost
 *  (however many pieces the PDF split it into). Falls back to the title piece itself. */
/** Apostrophes in names: no space either side, and the letters after it stay lower case ("EMPEROR ’ S" → "Emperor’s").
 *  A one-letter start keeps its capital, as in N’Kari. */
const tidyApostrophes = name => String(name).replace(/(\w\w)\s*([’'])\s*([A-Za-z]+)/g, (m, a, q, b) => a + q + b.toLowerCase());
function detachmentName(title, dpItem, items) {
  if (!dpItem) return cleanGlyphs(title.t);
  const tol = Math.max(6, title.s * 0.45);
  // Words, and the punctuation between them: an apostrophe or hyphen can arrive as a piece of its own ("LORD", "’", "S").
  const punct = t => /^[’'‘\-–&]+$/.test(t.trim());
  const parts = items.filter(o => o !== dpItem && Math.abs(o.y - dpItem.y) <= tol && o.x < dpItem.x && !/^\d+\s*DP$/i.test(o.t)
    && (punct(o.t) || Math.abs(o.s - title.s) <= title.s * 0.3 && /[A-Za-z]/.test(o.t))).sort((a, b) => a.x - b.x);
  const name = cleanGlyphs(parts.map(o => o.t).join(" ")).replace(/\s+([’'])\s*/g, "$1");
  return name.length >= cleanGlyphs(title.t).length ? name : cleanGlyphs(title.t);
}

function dropPageFurniture(items) {
  const edge = i => i.ph && (i.py < 32 || i.py > i.ph - 32);
  const shape = i => cleanGlyphs(i.t).replace(/\d+/g, "#").trim();
  const pages = new Set(items.map(i => Math.round(i.y - i.py)));
  if (pages.size < 3) return items;
  const seen = new Map();
  for (const i of items) if (edge(i)) { const k = shape(i); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(Math.round(i.y - i.py)); }
  const repeated = new Set([...seen].filter(([, ps]) => ps.size >= Math.max(3, pages.size * 0.15)).map(([k]) => k));
  return repeated.size ? items.filter(i => !(edge(i) && repeated.has(shape(i)))) : items;
}

const EXCLUDED_GROUPS = /^(boarding actions|boarding strike|pilum strike team)\b/i;

function parseFactionPdfRaw(allItems) {
  const items = allItems.filter(i => i.t && i.t.trim()).map(i => ({ ...i, t: i.t.trim() }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const result = { datasheets: [], detachments: [], armyRules: [] };
  if (!items.length) return result;
  const sameRow = (a, b, tol = 7) => Math.abs(a.y - b.y) <= tol;
  const headers = items.filter(w => /^M(\s+T\s+SV\s+W\s+LD\s+OC)?$/.test(w.t) &&
    (/OC$/.test(w.t) || items.some(o => o.t === "OC" && sameRow(o, w, 4) && o.x > w.x && o.x - w.x < 300)));
  const anchors = [];
  for (const hdr of headers) {
    const above = items.filter(w => w.y < hdr.y - 4 && w.y > hdr.y - 80 && w.x > hdr.x - 40 && w.x < hdr.x + 520);
    if (!above.length) continue;
    const lineY = Math.max(...above.map(w => w.y));
    let line = above.filter(w => Math.abs(w.y - lineY) <= 10).sort((a, b) => a.x - b.x);
    const p = line.findIndex(w => w.t.includes("("));
    if (p >= 0) { const head = line[p].t.split("(")[0].trim(); const it = line[p]; line = line.slice(0, p); if (head) line.push({ ...it, t: head }); }
    line = line.filter(w => w.t !== "⌀");
    if (!line.length || line.some(w => isStatValue(w.t)) || letterCount(line[0].t) < 3) continue;
    const titleSize = Math.max(...line.map(w => w.s));
    const banner = items.filter(w => w.y < lineY - 4 && w.y > lineY - 160 && w.s > titleSize * 1.3 && letterCount(w.t) >= 3).pop();
    anchors.push({ name: titleCase(line.map(w => w.t).join(" ").replace(/\s+/g, " ").trim()), banner: banner ? cleanGlyphs(banner.t) : "", start: banner ? banner.y - 2 : lineY - 2, titleY: lineY, header: hdr });
  }
  const bigSize = Math.max(...items.map(i => i.s));
  const topHeadings = items.filter(i => i.s >= bigSize * 0.9 && letterCount(i.t) >= 3);
  const isDP = t => /^\d+\s*DP$/i.test(t);
  const sections = topHeadings.map(h => ({
    h, kind: items.some(o => isDP(o.t) && sameRow(o, h, 8) && o.x > h.x) ? "detachment" : /^ARMY RULES$/i.test(h.t) ? "army" : "other",
  }));

  // Region boundaries: every datasheet start and every top-level heading.
  const starts = [...anchors.map(a => a.start), ...topHeadings.map(h => h.y - 2)].sort((a, b) => a - b);
  const regionEnd = y => starts.find(s => s > y + 5) ?? Infinity;
  // A datasheet also ends at any major section heading (e.g. "LEGENDARY PROXIES" after the last one).
  const dsStops = [...starts, ...items.filter(i => i.s >= bigSize * 0.8 && letterCount(i.t) >= 3).map(i => i.y - 2)].sort((a, b) => a - b);
  for (const a of anchors) {
    const end = dsStops.find(s => s > a.titleY + 5) ?? Infinity;
    const region = items.filter(i => i.y >= a.start && i.y < end);
    const body = mostCommonSize(region);
    const rightHeads = region.filter(i => i.x > 450 && i.s >= body + 2.5 && isUpperText(i.t) && letterCount(i.t) >= 5);
    const split = rightHeads.length ? Math.min(...rightHeads.map(i => i.x)) - 12 : 555;
    const L = region.filter(i => i.x < split), R = region.filter(i => i.x >= split);
    const ds = { name: a.name, unitType: titleCase(a.banner), profiles: [], invuln: "", weapons: [], sections: [], keywords: "", factionKeywords: "", points: [], stratagems: [] };

    // Stat profiles under the header
    const hdrRow = region.filter(i => sameRow(i, a.header, 4)).sort((x, y) => x.x - y.x);
    const cols = {};
    for (const h of hdrRow) for (const k of h.t.split(/\s+/)) if (/^(M|T|SV|W|LD|OC)$/.test(k) && !cols[k]) cols[k] = h.x + (h.t.length > 2 ? h.t.indexOf(k) * 6 : 0);
    const weaponHeads = L.filter(i => /^(RANGED|MELEE) WEAPONS$/i.test(i.t)).sort((x, y) => x.y - y.y);
    const statsEnd = weaponHeads[0]?.y ?? a.header.y + 120;
    for (const line of readingLines(L.filter(i => i.y > a.header.y + 3 && i.y < statsEnd))) {
      if (!isStatValue(line.items[0].t)) {
        const inv = line.text.match(/IN(?:V(?:ULNERABLE)?)?\s*\.?\s*S(?:AVE|V)\s*:?\s*(\d\+)/i);
        if (inv) ds.invuln = inv[1];
        continue;
      }
      const prof = {};
      for (const [k, x] of Object.entries(cols)) {
        const near = line.items.filter(i => isStatValue(i.t) && Math.abs(i.x - x) < 28).sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x))[0];
        prof[k] = near ? near.t : "";
      }
      const nameBits = line.items.filter(i => !isStatValue(i.t) && i.x > (cols.OC ?? 300) + 15);
      prof.name = titleCase(cleanGlyphs(nameBits.map(i => i.t).join(" ").split("(")[0]));
      if (Object.values(prof).filter(Boolean).length >= 4) ds.profiles.push(prof);
    }

    // Weapons tables
    let weaponsEnd = statsEnd;
    weaponHeads.forEach((wh, idx) => {
      const type = /RANGED/i.test(wh.t) ? "Ranged" : "Melee";
      const hrow = L.filter(i => sameRow(i, wh, 4));
      const colX = {};
      for (const h of hrow) if (/^(RANGE|A|BS|WS|S|AP|D)$/.test(h.t)) colX[h.t === "WS" || h.t === "BS" ? "SKILL" : h.t] = h.x;
      const nextHead = L.find(i => i.y > wh.y + 5 && i.s >= body + 2.5 && isUpperText(i.t) && !hrow.includes(i));
      const blockEnd = Math.min(weaponHeads[idx + 1]?.y ?? Infinity, nextHead?.y ?? Infinity, end);
      const block = L.filter(i => i.y > wh.y + 4 && i.y < blockEnd);
      const rangeX = colX.RANGE ?? 356;
      const rows = block.filter(i => Math.abs(i.x - rangeX) < 30 && /^(\d+"|Melee|N\/A)$/i.test(i.t));
      const made = rows.map(r => {
        const val = k => {
          if (colX[k] === undefined) return "";
          const c = block.filter(i => sameRow(i, r, 6) && Math.abs(i.x - colX[k]) < 22).sort((p, q) => Math.abs(p.x - colX[k]) - Math.abs(q.x - colX[k]))[0];
          return c ? c.t : "";
        };
        const nameItems = block.filter(i => i.x < rangeX - 20 && i.y >= r.y - 16 && i.y <= r.y + 5 && /[a-z]/.test(i.t));
        let name = cleanGlyphs(nameItems.map(i => i.t).join(" "));
        const tags = [];
        const m = name.match(/^(.*?[a-z][^A-Z]*?)\s+((?:[A-Z][A-Z0-9+\-]*\s?)+)$/);
        if (m) { name = m[1].trim(); tags.push(m[2].trim()); }
        return { type, name, range: r.t, A: val("A"), skill: val("SKILL"), S: val("S"), AP: val("AP"), D: val("D"), tags, y: r.y };
      });
      // Weapon tags (RAPID FIRE 1, HEAVY…) sit near their weapon's row.
      for (const tag of block.filter(i => i.x < rangeX - 5 && isUpperText(i.t) && !/[a-z]/.test(i.t))) {
        const near = made.slice().sort((p, q) => Math.abs(p.y - tag.y) - Math.abs(q.y - tag.y))[0];
        if (near && Math.abs(near.y - tag.y) < 26) near.tags.push(cleanGlyphs(tag.t));
      }
      for (const w of made) { if (w.name) ds.weapons.push({ ...w, tags: w.tags.flatMap(t => t.split(/\s*,\s*/)).filter(Boolean).map(titleCase).join(", ") }); }
      if (rows.length) weaponsEnd = Math.max(weaponsEnd, Math.max(...rows.map(r => r.y)) + 20);
    });

    // Text sections in both columns
    const skip = t => COST_HEADING.test(t) || /^\d+\s*models?$/i.test(t) || /^\d{1,4}$/.test(t);
    for (const [col, minY] of [[L, weaponsEnd], [R, a.header.y]]) {
      let current = null;
      for (const line of readingLines(col.filter(i => i.y > minY))) {
        if (line.items.every(i => skip(i.t))) continue;
        const first = line.items[0];
        const kw = line.text.match(/^(FACTION KEYWORDS|KEYWORDS)\s*:\s*(.*)$/i);
        if (kw) { current = { heading: kw[1].toUpperCase(), lines: [kw[2]], rows: [] }; ds.sections.push(current); continue; }
        if (first.s >= body + 2.5 && isUpperText(first.t) && letterCount(first.t) >= 3) {
          const headItems = line.items.filter(i => i.s >= body + 2.5 && isUpperText(i.t));
          current = { heading: cleanGlyphs(headItems.map(i => i.t).join(" ")), lines: [], rows: [] };
          const rest = cleanGlyphs(line.items.filter(i => !headItems.includes(i) && !skip(i.t)).map(i => i.t).join(" "));
          if (rest) current.lines.push(rest);
          const restRow = line.items.filter(i => !headItems.includes(i)).map(i => cleanGlyphs(i.t)).filter(Boolean);
          if (restRow.length) current.rows.push(restRow);
          ds.sections.push(current);
          continue;
        }
        if (!current) { current = { heading: "NOTES", lines: [], rows: [] }; ds.sections.push(current); }
        current.lines.push(cleanGlyphs(line.items.filter(i => !skip(i.t)).map(i => i.t).join(" ")));
        current.rows.push(line.items.map(i => cleanGlyphs(i.t)).filter(Boolean));   // every piece on the row, numbers included
      }
    }
    // The unit's usable stratagems, grouped: "COMMAND RE-ROLL 1CP" followed by its group ("CORE", "GLADIUS TASK FORCE STRATAGEM", …).
    for (const sec of ds.sections.filter(x => x.heading === "STRATAGEMS")) {
      let pending = [];
      const flush = group => { for (const st of pending) ds.stratagems.push({ ...st, group }); pending = []; };
      for (const raw of sec.lines) {
        const line = raw.trim();
        let m = line.match(/^(.+?)\s+(\d+)\s*CP$/i);
        if (!m) { const r = line.match(/^(\d+)\s*CP\s+(.+)$/i); if (r) m = [r[0], r[2], r[1]]; }
        if (m) { pending.push({ name: titleCase(m[1].trim()), cp: +m[2] }); continue; }
        if (pending.length && letterCount(line) >= 3) {
          const group = /^CORE$/i.test(line) ? "Core" : titleCase(line.replace(/\s+STRATAGEM$/i, "").split(/\s+[–-]\s+/)[0].trim());
          flush(group);
        }
      }
      flush("Other");
    }
    const seenStrat = new Set();
    ds.stratagems = ds.stratagems.filter(st => {
      if (EXCLUDED_GROUPS.test(st.group)) return false;
      const k = st.group + "|" + st.name; if (seenStrat.has(k)) return false; seenStrat.add(k); return true;
    });
    ds.sections = ds.sections.filter(x => x.heading !== "STRATAGEMS");
    // The side panels: detachment abilities (names) and enhancements (name + points) usable by this unit.
    const noBadges = t => t.replace(/^(?:(?:C|BA|BS)\s+)+/, "").replace(/(?:\s+(?:C|BA|BS))+$/, "").trim();
    ds.detachmentAbilities = ds.sections.filter(x => /^DETACHMENT ABILIT/i.test(x.heading))
      .flatMap(x => x.rows.map(r => noBadges(r.filter(t => !/^\d+$/.test(t)).join(" "))))
      .filter((t, i, all) => letterCount(t) >= 3 && all.indexOf(t) === i);
    ds.enhancementOptions = ds.sections.filter(x => /^ENHANCEMENTS?$/i.test(x.heading)).flatMap(x => x.rows.map(r => {
      const pts = r.find(t => /^\d{1,3}$/.test(t));
      return { name: noBadges(r.filter(t => !/^\d{1,3}$/.test(t)).join(" ")), points: pts ? +pts : null };
    })).filter((e, i, all) => letterCount(e.name) >= 3 && all.findIndex(o => o.name === e.name) === i);
    ds.sections = ds.sections.filter(x => !/^DETACHMENT ABILIT|^ENHANCEMENTS?$/i.test(x.heading));
    ds.sections = ds.sections.map(s => ({ heading: s.heading, lines: s.lines.filter(Boolean), text: /LEADER|SUPPORT|LED BY/i.test(s.heading) ? s.lines.join(" · ") : joinParagraphs(s.lines) }))
      .filter(s => s.text && normName(s.heading) !== normName(ds.name));
    const pull = h => { const i = ds.sections.findIndex(s => s.heading === h); if (i < 0) return ""; const t = ds.sections[i].text; ds.sections.splice(i, 1); return t.replace(/\s*·\s*/g, " "); };
    ds.keywords = upperKeywords(pull("KEYWORDS"));
    ds.factionKeywords = upperKeywords(pull("FACTION KEYWORDS"));
    if (!ds.unitType && ds.keywords) {
      // No type banner on this datasheet: build it from the keywords, the way the banner reads ("Infantry Battleline").
      const kws = ds.keywords.split(/\s*,\s*/);
      const kinds = ["INFANTRY", "MOUNTED", "VEHICLE", "MONSTER", "BEAST", "SWARM", "FORTIFICATION"].filter(k => kws.includes(k));
      const roles = ["EPIC HERO", "CHARACTER", "BATTLELINE", "DEDICATED TRANSPORT", "TRANSPORT", "WALKER", "FLY"].filter(k => kws.includes(k));
      ds.unitType = titleCase([...kinds, ...roles.filter(r => !(r === "TRANSPORT" && roles.includes("DEDICATED TRANSPORT")))].join(" "));
    }
    result.datasheets.push(ds);
  }
  for (const sec of sections.filter(s => s.kind !== "other")) {
    const end = regionEnd(sec.h.y);
    const region = items.filter(i => i.y > sec.h.y + 4 && i.y < end);
    const sizes = [...new Set(region.map(i => Math.round(i.s)))].sort((a, b) => b - a);
    const body = mostCommonSize(region);
    const sectionSize = region.filter(i => /^(DETACHMENT RULES?|ENHANCEMENTS|STRATAGEMS)$/i.test(i.t)).map(i => i.s)[0] || bigSize * 0.85;
    // Entry names (rules, enhancements, stratagems): the most common large capitalised text that isn't a CP cost.
    const entrySize = mostCommonSize(region.filter(i => i.s < sectionSize - 2 && i.s >= body + 5 && isUpperText(i.t) && letterCount(i.t) >= 3 && !/^\d+\s*CP$/i.test(i.t))) || body + 7;
    const rightSection = region.filter(i => i.x > 300 && Math.abs(i.s - sectionSize) < 1 || i.x > 300 && Math.abs(i.s - entrySize) < 1);
    const split = rightSection.length ? Math.min(...rightSection.map(i => i.x)) - 10 : 460;

    const dpItem = items.find(o => isDP(o.t) && sameRow(o, sec.h, 8)), dp = dpItem?.t.replace(/\s+/g, "") || "";
    const det = { name: tidyApostrophes(titleCase(detachmentName(sec.h, dpItem, items))), dp, ...(dpItem?.fd?.length ? { dispositions: dpItem.fd } : {}), description: "", rules: [], enhancements: [], stratagems: [] };
    const entries = [], heads = [];
    [region.filter(i => i.x < split), region.filter(i => i.x >= split)].forEach((col, colIndex) => {
      let entry = null;
      for (const line of readingLines(col)) {
        const sectionItem = line.items.find(i => Math.abs(i.s - sectionSize) < 1 && isUpperText(i.t));
        // In the Army Rules section, large titles are rules themselves ("NURGLE'S GIFT (AURA)"), not section headings.
        if (sectionItem && sec.kind === "army" && !/^(FAQ|ERRATA)\b/i.test(sectionItem.t)) {
          entry = { y: line.y, col: colIndex, name: titleCase(cleanGlyphs(line.items.filter(i => Math.abs(i.s - sectionSize) < 1).map(i => i.t).join(" "))), points: null, cp: "", lines: [] };
          entries.push(entry);
          continue;
        }
        if (sectionItem) { heads.push({ y: line.y, col: colIndex, name: sectionItem.t.toUpperCase() }); entry = null; continue; }
        if (/^(ERRATA( Show)?|Show|Hide)$/i.test(line.text)) continue;
        const nameItems = line.items.filter(i => Math.abs(i.s - entrySize) < 1.2 && letterCount(i.t) >= 3 && !/^UPGRADE$/i.test(i.t.trim()) && !/^[.\s]+$/.test(i.t.replace(/\d|PTS/gi, "")));
        if (nameItems.length && !/^ERRATA$/i.test(nameItems[0].t)) {
          const dots = line.items.find(i => /\.\s*\./.test(i.t));
          const ptsItem = line.items.find(i => /^\d+\s*PTS$/i.test(i.t));
          const pts = ptsItem ? ptsItem.t.match(/(\d+)/) : dots ? dots.t.replace(/[^0-9A-Za-z]/g, "").match(/(\d+)PTS/i) : null;
          // The CP cost can sit a little below the name, in the same column.
          const cp = line.items.find(i => /^\d+\s*CP$/i.test(i.t)) ||
            col.find(i => /^\d+\s*CP$/i.test(i.t) && Math.abs(i.y - line.y) < 14 && i.x > line.items[0].x);
          entry = { y: line.y, col: colIndex, name: titleCase(cleanGlyphs(nameItems.map(i => i.t.replace(/[.\s]{3,}.*$/, "")).join(" "))), points: pts ? +pts[1] : null, cp: cp ? cp.t.replace(/\s+/g, "") : "", lines: [],
            upgrade: line.items.some(i => /^UPGRADE$/i.test(i.t.trim())) };
          entries.push(entry);
          continue;
        }
        const text = cleanGlyphs(line.items.filter(i => !/^\d+\s*CP$/i.test(i.t)).map(i => i.t).join(" "));
        if (!text) continue;
        // Army rules can have bold sub-titles in between body and title size (Afflicted's Plagues): keep them as sub-headings.
        if (entry && sec.kind === "army" && line.items.every(i => i.b && i.s >= body + 2 && i.s < entrySize - 1) && letterCount(text) >= 3) {
          entry.lines.push(SUBHEAD + text);
          continue;
        }
        if (entry) entry.lines.push(text.replace(/\s*ERRATA Show\s*$/i, ""));
        else if (sec.kind === "detachment") det.description += (det.description ? " " : "") + text;
      }
    });
    // An entry's section is the nearest heading above it: left-column entries use left headings;
    // right-column entries also use left headings, since full-width headings sit on the left.
    for (const e of entries) {
      const usable = heads.filter(h => h.y < e.y + 2 && (h.col === e.col || h.col === 0));
      usable.sort((p, q) => (q.y - p.y) || (Math.abs(q.y - p.y) < 10 ? (q.col === e.col) - (p.col === e.col) : 0));
      const top = usable[0];
      const tie = top && usable.find(h => Math.abs(h.y - top.y) < 10 && h.col === e.col);
      const heading = (tie || top)?.name || "";
      // The entry itself says what it is: stratagems carry a CP cost, enhancements carry points.
      e.section = sec.kind === "army" ? "ARMY RULES"
        : /^unique\b/i.test(e.name) ? "DETACHMENT RULES"
        : e.cp ? "STRATAGEMS"
        : e.points != null ? "ENHANCEMENTS"
        : /ENHANCEMENT/.test(heading) && heads.some(h => h.col === e.col && h.name === heading) ? "ENHANCEMENTS"
        : /STRATAGEM/.test(heading) ? "STRATAGEMS"
        : "DETACHMENT RULES";
    }
    for (const e of entries) {
      const text = joinParagraphs(e.lines);
      if (sec.kind === "army") { if (!/^(faq|errata)\b/i.test(e.name)) result.armyRules.push(armyRuleWithSubheads(e)); }
      else if (/ENHANCEMENT/.test(e.section)) det.enhancements.push({ name: e.name, points: e.points, text, ...(e.upgrade ? { upgrade: true } : {}) });
      else if (/STRATAGEM/.test(e.section)) det.stratagems.push({ name: e.name, cp: e.cp, text: text.includes("WHEN:") ? text.slice(text.indexOf("WHEN:")) : text });
      else if (/^unique\b/i.test(e.name)) det.unique = titleCase(cleanGlyphs((e.name.replace(/^unique\s*:?\s*/i, "") || text.split("\n")[0] || "").trim()));
      else det.rules.push({ name: e.name, text });
    }
    if (sec.kind === "detachment" && !EXCLUDED_GROUPS.test(det.name)) result.detachments.push(det);
  }

  // Points for each datasheet, using the position-based reader.
  const points = parsePositionedPoints([{ number: 1, items }]);
  for (const ds of result.datasheets) {
    const key = normName(ds.name);
    ds.points = points.filter(p => !p.enh && normName(p.name) === key).map(p => p.later ? { models: p.models, points: p.points, later: p.later } : { models: p.models, points: p.points })
      .filter((p, i, all) => all.findIndex(q => q.models === p.models) === i);
  }
  // Wahapedia repeats some datasheets (e.g. in different sections) — keep the most complete copy.
  const byName = new Map();
  for (const ds of result.datasheets) {
    const prev = byName.get(normName(ds.name));
    const score = d => d.weapons.length + d.sections.length + d.points.length;
    if (!prev || score(ds) > score(prev)) byName.set(normName(ds.name), ds);
  }
  result.datasheets = [...byName.values()];
  return result;
}/* Reads a Wahapedia faction page printed to PDF ("Save as PDF"): army rules, detachments and datasheets.
   Items: { t, x, y (top-down, whole document), s (size), b (bold), it (italic), py (y within page), ph (page height), pw (page width) }.
   Output has the same shape as parseFactionPdf, plus rich text (**bold**) for the viewer. */

const isKeywordish = t => /^\[?[A-Z0-9][A-Z0-9 '’\-+\/]*\]?$/.test(t) && letterCount(t) >= 2;

/** One visual line as rich text: bold runs become **…**, capitalised keywords become Title Case. */
function lineRich(items) {
  let rich = "", plain = "";
  for (const it of items) {
    let t = cleanGlyphs(it.t).replace(/(\s*\.\s*){4,}/g, " ").trim();
    if (!t) continue;
    if (isKeywordish(t) && (it.b || /^\[.*\]$/.test(t)) && !/^[A-Z]{1,3}$/.test(t)) t = titleCase(t.replace(/^\[|\]$/g, ""));
    const glue = !plain || /^[.,;:!?)\]’]/.test(t) || /[(\[‘]$/.test(plain) ? "" : " ";
    rich += glue + (it.b && letterCount(t) ? `**${t}**` : t);
    plain += glue + t;
  }
  return rich.replace(/\*\*(\s*)\*\*/g, "$1").trim();
}

/** Lines → paragraphs (\n between), bullets as "• ", labels like WHEN:/EFFECT: start new paragraphs. */
function linesToRich(lines, baseX) {
  if (!lines.length) return "";
  const gaps = [];
  for (let i = 1; i < lines.length; i++) { const g = lines[i].y - lines[i - 1].y; if (g > 3 && g < 30) gaps.push(g); }
  const lh = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 3)] : 13;
  const out = [];
  let prevY = null, prevLine = null;
  const colRight = Math.max(...lines.map(l => l.right || 0));
  for (const l of lines) {
    if (!l.text) continue;
    const indent = l.x - baseX > 8;
    const endedShort = prevLine && prevLine.right && colRight && prevLine.right < colRight - 6 * (prevLine.size || 10);
    const gap = prevY === null ? 0 : l.y - prevY;
    const prev = out[out.length - 1];
    const prevPlain = prev ? stripRich(prev) : "";
    const label = /^(\*\*)?(WHEN|TARGET|EFFECT|RESTRICTIONS?|ELIGIBLE IF|SET-UP DISTANCE|WHILE MOVING|AFTER MOVING|Restrictions|Example)\b[^:]{0,20}:/i.test(l.text);
    const startNew = !prev || label || gap > lh * 1.45 ||
      (indent && (!prev.startsWith("• ") || /[.:;!]$/.test(prevPlain) || endedShort)) || (!indent && prev.startsWith("• "));
    if (startNew) out.push((indent ? "• " : "") + l.text);
    else out[out.length - 1] = prev.replace(/-$/, "") + (prev.endsWith("-") ? "" : " ") + l.text;
    prevY = l.y;
    prevLine = l;
  }
  return tidyRich(out.join("\n"));
}
const tidyRich = s => s.replace(/\*\*(\s+)\*\*/g, "$1").replace(/\bInSv\b/g, "Invulnerable Save").replace(/\s+([.,;:])/g, "$1");

/** How much a reader got out of a faction PDF: complete datasheets count most. */
function factionRichness(d) {
  return d.datasheets.reduce((s, x) => s + (x.keywords ? 2 : 0) + (x.weapons.length ? 2 : 0) + (x.points.length ? 2 : 0) + (x.sections.length ? 1 : 0), 0)
    + d.detachments.reduce((s, x) => s + x.enhancements.length + x.stratagems.length + x.rules.length * 0.5, 0) * 0.5
    + d.armyRules.length * 0.5;
}

/** "CORE ABILITIES", "ARMY RULES" and "FACTION ABILITIES" are printed as labels on the left with their list on the right,
 *  centred on the label, so a two-line list starts a little above its label. Reading top to bottom would hand that first
 *  line to the label above ("Leader" + "Combat Doctrines"). Each list line is given to the label it sits beside instead. */
const SIDE_LABEL = /^(CORE ABILIT\w*|ARMY RULES?|FACTION ABILIT\w*)$/;
function sideLabelLists(sections) {
  const lineY = l => l.items.reduce((sum, i) => sum + i.y, 0) / l.items.length;
  const labels = sections.filter(s => SIDE_LABEL.test(s.heading) && s.y != null);
  if (!labels.length) return;
  // The list column starts to the right of the widest label; the labels' rows end at the next ordinary heading below them.
  const listX = Math.max(...labels.map(s => s.right)) + 2;
  const top = Math.min(...labels.map(s => s.y)) - 2 * labels[0].size;
  const lastLabel = Math.max(...labels.map(s => s.y));
  const next = sections.filter(s => !SIDE_LABEL.test(s.heading) && s.y != null && s.y > lastLabel && Math.abs(s.x - labels[0].x) < 40).sort((a, b) => a.y - b.y)[0];
  const bottom = next ? next.y - 1 : lastLabel + 3 * labels[0].size;
  const listLines = [];
  for (const s of sections) s.lines = s.lines.filter(l => {
    const y = lineY(l);
    if (l.x >= listX && y > top && y < bottom) { listLines.push(l); return false; }
    return true;
  });
  // Each label's centre is half a line below its top; a list line belongs to the label whose centre is nearest.
  const centre = s => s.y + s.size / 2;
  for (const l of listLines) {
    const y = lineY(l) + (l.items[0]?.s || 0) / 2;
    labels.slice().sort((a, b) => Math.abs(centre(a) - y) - Math.abs(centre(b) - y))[0].lines.push(l);
  }
  for (const s of labels) s.lines.sort((a, b) => lineY(a) - lineY(b));
}

function parsePrintedFactionPdfRaw(allItems) {
  const result = { datasheets: [], detachments: [], armyRules: [] };
  const items = allItems
    .filter(i => i.t && i.t.trim() && !(i.s < 8.8 && (i.py < 26 || i.py > (i.ph || 792) - 28)))   // page header/footer
    .map(i => ({ ...i, t: i.t.replace(/(\s*\.\s*){3,}/g, " ").trim() }))   // dot leaders ". . . . ."
    .filter(i => i.t)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (!items.length) return result;
  const body = mostCommonSize(items);
  const pw = items[0].pw || 612;
  const sameRow = (a, b, tol = 6) => Math.abs(a.y - b.y) <= tol;
  const lines = col => readingLines(col).map(l => ({ ...l, raw: l.text, text: lineRich(l.items), plain: stripRich(lineRich(l.items)) }));
  const isDP = t => /^\d+\s*DP$/i.test(t);
  const dpItems = items.filter(i => isDP(i.t));
  const detTitles = dpItems.map(dp => items.filter(o => sameRow(o, dp, 10) && o.x < dp.x && letterCount(o.t) >= 3).sort((a, b) => b.s - a.s)[0]).filter(Boolean);
  const titleSize = detTitles.length ? detTitles[0].s : Math.max(...items.map(i => i.s));
  const banners = items.filter(i => Math.abs(i.s - titleSize) < 1.2 && letterCount(i.t) >= 3 && !isDP(i.t));
  const sectionItems = items.filter(i => /^(DETACHMENT RULES?|ENHANCEMENTS|STRATAGEMS)$/i.test(i.t) && i.s > body + 6);
  const sectionSize = sectionItems.length ? sectionItems[0].s : titleSize * 0.85;
  const foreignSections = items.filter(i => Math.abs(i.s - sectionSize) < 1 && letterCount(i.t) >= 3 && !/^(DETACHMENT RULES?|ENHANCEMENTS|STRATAGEMS)$/i.test(i.t));
  const anchors = [];
  for (const m of items.filter(i => i.t === "M" || /^M\s+T\s+SV/.test(i.t))) {
    const row = items.filter(o => sameRow(o, m, 4) && o.x >= m.x - 2 && o.x - m.x < 260);
    const has = k => row.some(o => o.t === k || new RegExp(`\\b${k}\\b`).test(o.t));
    if (!(has("T") && has("SV") && has("OC"))) continue;
    const above = items.filter(o => o.y < m.y - 3 && o.y > m.y - 70 && o.x < m.x + 300 && letterCount(o.t) >= 3 && o.s > body + 3);
    if (!above.length) continue;
    const big = above.sort((a, b) => b.s - a.s)[0];
    let line = items.filter(o => sameRow(o, big, 8) && o.x >= big.x - 2 && o.x < big.x + 420).sort((a, b) => a.x - b.x);
    const p = line.findIndex(o => o.t.includes("("));
    if (p >= 0) { const head = line[p].t.split("(")[0].trim(); const it = line[p]; line = line.slice(0, p); if (head) line.push({ ...it, t: head }); }
    const name = titleCase(cleanGlyphs(line.filter(o => o.t !== "⌀" && !/mm\)?$/.test(o.t)).map(o => o.t).join(" ")).replace(/\s+/g, " ").trim());
    if (!name || isStatValue(name)) continue;
    if (anchors.length && Math.abs(anchors[anchors.length - 1].header.y - m.y) < 5) continue;
    anchors.push({ name, start: big.y - 3, titleY: big.y, header: m, headerRow: row });
  }

  // Datasheet group banners ("INFANTRY EPIC HERO") only count once datasheets begin.
  const firstGroupBannerMin = (anchors.length ? Math.min(...anchors.map(a => a.start)) : Infinity) - 900;
  const bounds = [...anchors.map(a => a.start), ...banners.map(b => b.y - 3), ...foreignSections.map(f => f.y - 3)].sort((a, b) => a - b);
  const nextBound = y => bounds.find(b => b > y + 4) ?? Infinity;
  const headingLike = (it, min = 1.6) => it.s >= body + min && isUpperText(cleanGlyphs(it.t)) && letterCount(it.t) >= 3;
  for (const a of anchors) {
    const end = nextBound(a.titleY);
    const region = items.filter(i => i.y >= a.start && i.y < end);
    const banner = banners.filter(b => b.y < a.start && !detTitles.includes(b) && !/^(ARMY RULES?|BOOKS)$/i.test(cleanGlyphs(b.t))).pop();
    const rightHeads = region.filter(i => i.x > pw * 0.5 && headingLike(i) && letterCount(i.t) >= 5);
    const split = rightHeads.length ? Math.min(...rightHeads.map(i => i.x)) - 6 : pw * 0.61;
    const L = region.filter(i => i.x < split), R = region.filter(i => i.x >= split);
    const ds = { name: a.name, unitType: "", profiles: [], invuln: "", weapons: [], sections: [], keywords: "", factionKeywords: "",
      points: [], stratagems: [], abilities: [], coreAbilities: [], armyRuleNames: [], leader: null, detachmentAbilities: [], enhancementOptions: [] };
    if (banner && banner.y > firstGroupBannerMin) ds.unitType = titleCase(cleanGlyphs(banner.t));

    // Stat lines
    const cols = {};
    for (const h of a.headerRow) for (const k of h.t.split(/\s+/)) if (/^(M|T|SV|W|LD|OC)$/.test(k) && cols[k] === undefined) cols[k] = h.x;
    const weaponHeads = L.filter(i => /^(RANGED|MELEE) WEAPONS$/i.test(cleanGlyphs(i.t))).sort((x, y) => x.y - y.y);
    const statsEnd = weaponHeads[0]?.y ?? a.header.y + 140;
    for (const line of readingLines(region.filter(i => i.y > a.header.y + 3 && i.y < statsEnd - 3 && i.x < split))) {
      const vals = line.items.filter(i => isStatValue(i.t));
      if (vals.length < 4) continue;
      const prof = {};
      for (const [k, x] of Object.entries(cols)) {
        const v = vals.filter(i => Math.abs(i.x - x) < 22).sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x))[0];
        prof[k] = v ? v.t : "";
      }
      const nameBits = line.items.filter(i => !isStatValue(i.t) && i.x > (cols.OC ?? 190) + 12 && letterCount(i.t) >= 2 && !/mm\)?$/.test(i.t) && i.t !== "⌀" && i.t !== "(");
      prof.name = titleCase(cleanGlyphs(nameBits.map(i => i.t).join(" ").split("(")[0]).trim());
      ds.profiles.push(prof);
    }
    const inv = region.find(i => /^IN(V(ULNERABLE)?)?\s*\.?\s*S(V|AVE)$/i.test(i.t) && i.y < statsEnd);
    if (inv) {
      const v = region.filter(i => /^\d\+$/.test(i.t) && Math.abs(i.y - inv.y) < 9 && i.x > inv.x && i.x - inv.x < 80).sort((p, q) => p.x - q.x)[0];
      if (v) ds.invuln = v.t;
    }

    // Weapons
    let weaponsEnd = statsEnd;
    weaponHeads.forEach((wh, idx) => {
      const type = /RANGED/i.test(wh.t) ? "Ranged" : "Melee";
      const hrow = L.filter(i => sameRow(i, wh, 4));
      const colX = {};
      for (const h of hrow) { const k = cleanGlyphs(h.t); if (/^(RANGE|A|BS|WS|S|AP|D)$/.test(k)) colX[k === "WS" || k === "BS" ? "SKILL" : k] = h.x; }
      const rangeX = colX.RANGE ?? 230;
      const nextHead = L.find(i => i.y > wh.y + 5 && headingLike(i) && !hrow.includes(i) && !/^(RANGE|A|BS|WS|S|AP|D)$/.test(i.t));
      const blockEnd = Math.min(weaponHeads[idx + 1]?.y ?? Infinity, nextHead?.y ?? Infinity, end);
      const block = L.filter(i => i.y > wh.y + 4 && i.y < blockEnd);
      const rows = block.filter(i => Math.abs(i.x - rangeX) < 26 && /^(\d+"|Melee|N\/A|-)$/i.test(i.t)).sort((p, q) => p.y - q.y);
      if (!rows.length) return;
      const made = rows.map(r => ({ type, r, names: [], tags: [] }));
      for (const it of block.filter(i => i.x < rangeX - 8)) {
        const t = cleanGlyphs(it.t);
        if (!t || letterCount(t) < 1) continue;
        const near = made.slice().sort((p, q) => Math.abs(p.r.y - it.y) - Math.abs(q.r.y - it.y))[0];
        if (Math.abs(near.r.y - it.y) > 22) continue;
        if (/[a-z]/.test(t)) near.names.push(it); else near.tags.push(titleCase(t.replace(/^\[|\]$/g, "")));
      }
      for (const w of made) {
        const val = k => {
          if (colX[k] === undefined) return "";
          const c = block.filter(i => sameRow(i, w.r, 6) && Math.abs(i.x - colX[k]) < 18).sort((p, q) => Math.abs(p.x - colX[k]) - Math.abs(q.x - colX[k]))[0];
          return c ? c.t : "";
        };
        const name = cleanGlyphs(w.names.sort((p, q) => p.y - q.y || p.x - q.x).map(i => i.t).join(" ")).replace(/\s+-\s*$/, "").replace(/\s+/g, " ");
        if (name) ds.weapons.push({ type, name, range: /melee/i.test(w.r.t) ? "Melee" : w.r.t, A: val("A"), skill: val("SKILL"), S: val("S"), AP: val("AP"), D: val("D"), tags: w.tags.join(", ") });
      }
      weaponsEnd = Math.max(weaponsEnd, rows[rows.length - 1].y + 14);
    });

    // Text sections in both columns
    const sections = [];
    const walk = (col, minY) => {
      let cur = null;
      for (const line of lines(col.filter(i => i.y > minY))) {
        const plain = line.plain;
        if (!plain || /^(C|BA|BS)$/.test(plain)) continue;
        const kw = plain.match(/^(FACTION KEYWORDS|KEYWORDS)\s*:\s*(.*)$/i);
        if (kw) { cur = { heading: kw[1].toUpperCase(), lines: [], x: line.x }; sections.push(cur); if (kw[2]) cur.lines.push({ ...line, text: kw[2], plain: kw[2] }); continue; }
        // "KEYWORDS – ALL MODELS: …; Ancient: …; Company Champion: …" — keywords that differ between the unit's models.
        if (/^KEYWORDS\s*[–—-]\s*ALL MODELS\s*:/i.test(plain)) { cur = { heading: "KEYWORDS", perModel: true, lines: [line], x: line.x }; sections.push(cur); continue; }
        if (COST_HEADING.test(plain)) { cur = { heading: "COSTS", lines: [], x: line.x, tier: /3RD|THIRD/i.test(plain) }; sections.push(cur); continue; }
        const first = line.items[0];
        if (headingLike(first)) {
          const head = line.items.filter(i => headingLike(i));
          cur = { heading: cleanGlyphs(head.map(i => i.t).join(" ")), lines: [], x: head[0].x, y: head[0].y,
            right: Math.max(...head.map(i => i.x + (i.w || 0))), size: head[0].s };
          sections.push(cur);
          const rest = line.items.filter(i => !head.includes(i));
          if (rest.length) cur.lines.push({ ...line, items: rest, x: rest[0].x, text: lineRich(rest), plain: stripRich(lineRich(rest)) });
          continue;
        }
        // Lines before the column's first heading are kept aside: one may be the first line of a label's list
        // (printed just above "CORE ABILITIES"); sideLabelLists places it, and anything left is dropped as before.
        if (!cur) { cur = { heading: "", lines: [], x: line.x, y: null }; sections.push(cur); }
        cur.lines.push(line);
      }
    };
    walk(L, weaponsEnd);
    // A label's list is centred on the label, so a three-line list starts above the stats row; read from a little higher.
    walk(R, a.header.y - 2 - 1.6 * body);
    sideLabelLists(sections);
    for (let k = sections.length - 1; k >= 0; k--) if (!sections[k].heading) {
      for (const l of sections[k].lines) { const t = stripRich(l.plain || "").trim(); if (t) (ds.unsorted ||= []).push(t); }
      sections.splice(k, 1);
    }

    const sec = re => sections.filter(s => re.test(s.heading));
    const plainLines = list => list.flatMap(s => s.lines.map(l => l.plain.trim())).filter(Boolean);
    const commaList = list => plainLines(list).join(" ").split(/\s*,\s*/).map(t => t.trim()).filter(Boolean);
    ds.coreAbilities = commaList(sec(/^CORE ABILIT/));
    ds.armyRuleNames = commaList(sec(/^ARMY RULES?$/));

    // Abilities, read by layout rather than punctuation (faction pack ruleset, rule 12):
    //  • an ability starts with bold text at the start of a paragraph (after the wider gap between abilities), or with
    //    a "Name:" line in packs that don't use bold names;
    //  • its name is the bold text from there, across lines, up to the colon, or up to where normal text begins;
    //    bold words after normal text has started (keywords like "readied") belong to the description;
    //  • a bold name with no colon that runs on past a closing bracket ends at the bracket;
    //  • an indented name is a wargear ability;
    //  • text that can't be placed is kept on the datasheet (ds.unsorted), never thrown away.
    for (const s of sec(/^(ABILITIES|FACTION ABILIT)/)) {
      const ls = s.lines, topOf = l => Math.min(...l.items.map(i => i.y));
      const gaps = ls.slice(1).map((l, k) => topOf(l) - topOf(ls[k])).filter(g => g > 0).sort((a, b) => a - b);
      const lineGap = gaps.length ? gaps[Math.floor((gaps.length - 1) / 3)] : body * 1.35;
      let cur = null, naming = null;
      const textOf = it => cleanGlyphs(it.t);
      // Reads a name from the start of `items`: bold text up to a colon, or up to the first normal text.
      const takeName = (items, boldNames) => {
        let name = "";
        for (let k = 0; k < items.length; k++) {
          const it = items[k], t = it.t;
          if (boldNames && !it.b) return { name, done: true, colon: false, rest: items.slice(k) };
          const c = t.indexOf(":");
          if (c >= 0) {
            const after = t.slice(c + 1);
            const rest = [...(after.trim() ? [{ ...it, t: after.replace(/^\s+/, ""), b: it.b && !boldNames ? it.b : false }] : []), ...items.slice(k + 1)];
            return { name: name + t.slice(0, c), done: true, colon: true, rest };
          }
          name += (name && !/\s$/.test(name) && !/^\s/.test(t) ? " " : "") + t;
        }
        return { name, done: false, colon: false, rest: [] };
      };
      const finish = (ab, r) => {
        ab.name = cleanGlyphs(ab.name).replace(/\s+/g, " ").trim();
        // No colon: a bold name that ran on past its closing bracket ends at the bracket.
        if (!r.colon) {
          const m = ab.name.match(/^(.*\))\s+(\S.*)$/);
          if (m && m[1].length >= 3) { ab.name = m[1]; ab.lines.unshift({ x: s.x, items: [], text: m[2], plain: m[2] }); }
        }
      };
      for (let k = 0; k < ls.length; k++) {
        const l = ls[k], items = l.items, gap = k ? topOf(l) - topOf(ls[k - 1]) : Infinity;
        if (naming) {                          // the name carries on from the line above
          const r = takeName(items, true);
          naming.name += " " + r.name;
          if (r.done || r.name.length > 140) {
            finish(naming, r);
            if (r.rest.length) naming.lines.push({ ...l, items: r.rest, x: s.x, text: lineRich(r.rest), plain: stripRich(lineRich(r.rest)) });
            naming = null;
          }
          continue;
        }
        const startsBold = items[0]?.b && letterCount(textOf(items[0])) >= 1;
        const colonLine = /^([A-Z][^:]{1,80}?(\([^)]*\))?):\s*(.*)$/.test(l.plain);
        const newPara = gap > lineGap * 1.3;
        const plainName = !items.some(i => i.b) && colonLine && (newPara || !cur);
        // Guards: a new ability never starts mid-sentence (the line above must have finished one), and a bold keyword
        // in capitals ("AIRCRAFT", "PSYKER", "BS") with no colon after it is part of the text, not a name.
        const prevText = k ? stripRich(ls[k - 1].plain || "").trim() : "";
        const sentenceDone = !cur || !prevText || /[.:!?)\]”"’']$/.test(prevText);
        const firstBold = []; for (const it of items) { if (!it.b) break; firstBold.push(textOf(it)); }
        const capsKeyword = isUpperText(firstBold.join(" ")) && !/:/.test(firstBold.join(" "));
        if (((startsBold && (newPara || !cur || colonLine)) || plainName) && sentenceDone && !capsKeyword) {
          const r = takeName(items, !plainName);
          cur = { name: r.name, wargear: l.x - s.x > 8, lines: [] };
          ds.abilities.push(cur);
          if (r.done) {
            finish(cur, r);
            if (r.rest.length) cur.lines.push({ ...l, items: r.rest, x: s.x, text: lineRich(r.rest), plain: stripRich(lineRich(r.rest)) });
          } else naming = cur;
          continue;
        }
        if (cur) cur.lines.push({ ...l, x: s.x });
        else (ds.unsorted ||= []).push(stripRich(l.plain || l.text || ""));
      }
      if (naming) finish(naming, { colon: false });
    }
    ds.abilities = ds.abilities.filter(ab => ab.name || ab.lines.length);
    for (const ab of ds.abilities) { ab.name = ab.name.replace(/\bInSv\b/g, "Invulnerable Save"); ab.rich = linesToRich(ab.lines, Math.min(...ab.lines.map(l => l.x), Infinity)); ab.text = stripRich(ab.rich); delete ab.lines; }
    // Unplaced text, tidied (faction pack ruleset, rule 13):
    //  • the standard reminder printed under multi-profile weapons ("Before selecting targets for this weapon, select one
    //    of its eligible profiles…") isn't kept — the profiles already show it;
    //  • a "Name: …" rule among the weapons about "this weapon" or "the bearer" is a wargear ability.
    if (ds.unsorted?.length) {
      const paras = [];
      for (const raw of ds.unsorted) {
        const t = String(raw).trim();
        if (/^[A-Z][\w’' -]{2,40}:\s/.test(t) && !/^KEYWORDS/i.test(t) || !paras.length) paras.push(t);
        else paras[paras.length - 1] += " " + t;
      }
      const keep = [];
      for (const p of paras) {
        if (/^Before selecting targets for this weapon, select one of its eligible profiles/i.test(p)) continue;
        if (/^\(?\s*⌀\s*[\d.]+\s*(x\s*[\d.]+\s*)?mm\s*\)?$/i.test(p)) continue;   // a stray base size
        const m = p.match(/^([A-Z][\w’' -]{2,40}):\s+(.+)$/);
        if (m && /\b(this weapon|the bearer)\b/i.test(m[2])) { ds.abilities.push({ name: m[1].trim(), wargear: true, text: m[2], rich: m[2] }); continue; }
        keep.push(p);
      }
      ds.unsorted = keep;
    }

    // Leader / support
    for (const s of sec(/^(LEADER|SUPPORT|LED BY|SUPPORTED BY)$/)) {
      const intro = [], units = [];
      for (const l of s.lines) {
        const words = l.items.filter(i => letterCount(i.t) >= 1);
        const isUnit = words.length && words.every(i => isKeywordish(cleanGlyphs(i.t)));
        (isUnit ? units : intro).push(stripRich(l.plain).replace(/^[•■▪]\s*/, ""));
      }
      ds.leader = ds.leader || [];
      ds.leader.push({ heading: titleCase(s.heading), intro: intro.join(" "), units: units.map(u => titleCase(u.toUpperCase())) });
    }

    // Costs
    for (const s of sec(/^COSTS$/)) for (const l of s.lines) {
      const m = l.plain.match(/^(\d+)\s*models?\b.*?(\d{1,4})\s*$/i);
      if (!m) continue;
      const models = +m[1], pts = +m[2];
      const e = ds.points.find(p => p.models === models);
      if (s.tier) { if (e) e.later = pts; else ds.points.push({ models, points: pts }); }
      else if (!e) ds.points.push({ models, points: pts });
    }

    // Unit stratagems, detachment abilities, enhancements
    for (const s of sec(/^STRATAGEMS$/)) {
      let pending = [];
      const flush = group => { for (const st of pending) ds.stratagems.push({ ...st, group }); pending = []; };
      for (const raw of plainLines([s])) {
        const line = raw.replace(/\s+(C|BA|BS)$/, "").trim();
        const m = line.match(/^(.+?)\s+(\d+)\s*CP$/i);
        if (m) { pending.push({ name: titleCase(m[1].trim()), cp: +m[2] }); continue; }
        if (pending.length && letterCount(line) >= 3) flush(/^CORE$/i.test(line) ? "Core" : titleCase(line.replace(/\s+STRATAGEM$/i, "").split(/\s+[–-]\s+/)[0].trim()));
      }
      flush("Other");
    }
    const seenStrat = new Set();
    ds.stratagems = ds.stratagems.filter(st => !EXCLUDED_GROUPS.test(st.group) && !seenStrat.has(st.group + st.name) && seenStrat.add(st.group + st.name));
    ds.detachmentAbilities = [...new Set(plainLines(sec(/^DETACHMENT ABILIT/)).map(t => t.replace(/\s+(C|BA|BS)$/, "")).filter(t => letterCount(t) >= 3))];
    ds.enhancementOptions = plainLines(sec(/^ENHANCEMENTS?$/)).map(t => {
      const m = t.match(/^(.*?)\s+(\d{1,3})$/);
      return { name: (m ? m[1] : t).replace(/\s+(C|BA|BS)$/, "").trim(), points: m ? +m[2] : null };
    }).filter(e => letterCount(e.name) >= 3);

    const perModel = sec(/^KEYWORDS$/).find(x => x.perModel);
    if (perModel) {
      // Model names are normal text ending in a colon; keywords are bold. The first group is "All models".
      const groups = []; let label = "", g = null;
      for (const it of perModel.lines.flatMap(l => l.items)) {
        const t = cleanGlyphs(it.t);
        if (!t || /^[;,]+$/.test(t)) continue;
        if (!it.b) {
          label = (label + " " + t).trim();
          if (/:\s*$/.test(label)) {
            const name = label.replace(/:\s*$/, "").replace(/^KEYWORDS\s*[–—-]\s*/i, "").trim();
            g = { model: /^ALL MODELS$/i.test(name) ? "All models" : name, keywords: [] }; groups.push(g); label = "";
          }
          continue;
        }
        if (!g) { g = { model: "All models", keywords: [] }; groups.push(g); }
        for (const k of t.split(/\s*;\s*/)) if (k.trim()) g.keywords.push(k.trim().toUpperCase());
      }
      ds.modelKeywords = groups.filter(x => x.keywords.length).map(x => ({ model: x.model, keywords: x.keywords.join(", ") }));
      // The unit's keywords are every keyword any of its models has, so one CHARACTER model makes it a Character unit.
      ds.keywords = [...new Set(ds.modelKeywords.flatMap(x => x.keywords.split(", ")))].join(", ");
    } else ds.keywords = upperKeywords(plainLines(sec(/^KEYWORDS$/)).join(" ").replace(/;/g, ","));
    ds.factionKeywords = upperKeywords(plainLines(sec(/^FACTION KEYWORDS$/)).join(" ").replace(/;/g, ","));
    if (!ds.unitType && ds.keywords) {
      const kws = ds.keywords.split(/\s*,\s*/);
      ds.unitType = titleCase(["INFANTRY", "MOUNTED", "VEHICLE", "MONSTER", "BEAST", "SWARM", "FORTIFICATION", "EPIC HERO", "CHARACTER", "BATTLELINE", "DEDICATED TRANSPORT"].filter(k => kws.includes(k)).join(" "));
    }

    // Plain sections for the Excel export and the AI (same shape as the older reader)
    const keep = (heading, list) => { const ls = list.filter(Boolean); if (ls.length) ds.sections.push({ heading, lines: ls, text: ls.join("\n") }); };
    keep("CORE ABILITIES", ds.coreAbilities.length ? [ds.coreAbilities.join(", ")] : []);
    keep("ARMY RULES", ds.armyRuleNames.length ? [ds.armyRuleNames.join(", ")] : []);
    keep("ABILITIES", ds.abilities.filter(x => !x.wargear).map(x => `${x.name}: ${x.text}`));
    keep("WARGEAR ABILITIES", ds.abilities.filter(x => x.wargear).map(x => `${x.name}: ${x.text}`));
    const skipHeads = /^(CORE ABILIT|ARMY RULES?$|ABILITIES|FACTION ABILIT|LEADER$|SUPPORT$|LED BY$|SUPPORTED BY$|COSTS$|STRATAGEMS$|DETACHMENT ABILIT|ENHANCEMENTS?$|KEYWORDS$|FACTION KEYWORDS$)/;
    for (const s of sections.filter(s => !skipHeads.test(s.heading))) {
      const rich = linesToRich(s.lines, s.lines.length ? Math.min(...s.lines.map(l => l.x)) : 0);
      if (!rich) continue;
      ds.sections.push({ heading: s.heading, lines: stripRich(rich).split("\n"), text: stripRich(rich), rich });
    }
    for (const l of ds.leader || []) keep(l.heading.toUpperCase(), [l.intro, ...l.units.map(u => u.toUpperCase())]);
    result.datasheets.push(ds);
  }
  // Keep the most complete copy of any repeated datasheet.
  const byName = new Map();
  for (const ds of result.datasheets) {
    const prev = byName.get(normName(ds.name));
    const score = d => d.weapons.length + d.abilities.length + d.points.length + d.sections.length;
    if (!prev || score(ds) > score(prev)) byName.set(normName(ds.name), ds);
  }
  result.datasheets = [...byName.values()];
  const firstDatasheet = anchors.length ? Math.min(...anchors.map(a => a.start)) : Infinity;
  const entrySizeOf = region => mostCommonSize(region.filter(i => i.s < sectionSize - 2 && i.s > body + 3 && isUpperText(cleanGlyphs(i.t)) && letterCount(i.t) >= 3 && !/^\d+\s*CP$/i.test(i.t))) || body + 5;
  const regionText = (entryLines, baseX) => {
    // Flavour text (the italic lines straight after the name) is kept apart from the rules; italic rules text later on stays in the rules.
    let i = 0;
    while (i < entryLines.length && entryLines[i].items.every(x => x.it)) i++;
    return { rich: linesToRich(entryLines.slice(i), baseX), flavour: cleanGlyphs(entryLines.slice(0, i).map(l => l.plain).join(" ")) };
  };
  for (const t of detTitles) {
    const end = Math.min(nextBound(t.y), firstDatasheet);
    const region = items.filter(i => i.y > t.y + 6 && i.y < end);
    if (EXCLUDED_GROUPS.test(cleanGlyphs(t.t))) continue;
    const entrySize = entrySizeOf(region);
    // "UNIQUE: TERMINATOR" sits just above the title: no two detachments in an army may share it.
    const uniqueItem = items.find(i => /^UNIQUE\s*:/i.test(i.t) && t.y - i.y > 0 && t.y - i.y < 60);
    const unique = uniqueItem ? titleCase(cleanGlyphs(uniqueItem.t.replace(/^UNIQUE\s*:\s*/i, "") || items.find(o => sameRow(o, uniqueItem, 4) && o.x > uniqueItem.x)?.t || "")) : "";
    const dpIt = dpItems.find(d => sameRow(d, t, 10));
    const det = { name: tidyApostrophes(titleCase(detachmentName(t, dpIt, items))), dp: (dpIt?.t || "").replace(/\s+/g, ""), ...(dpIt?.fd?.length ? { dispositions: dpIt.fd } : {}), unique, description: "", rules: [], enhancements: [], stratagems: [] };
    let section = "", entry = null;
    const entries = [];
    for (const line of lines(region)) {
      const first = line.items[0];
      if (Math.abs(first.s - sectionSize) < 1 && isUpperText(line.raw)) { section = line.raw.toUpperCase(); entry = null; continue; }
      if (Math.abs(first.s - entrySize) < 1.2 && isUpperText(cleanGlyphs(first.t)) && letterCount(first.t) >= 3) {
        if (/^(UNIQUE\b|ERRATA\b)/i.test(line.raw)) { entry = null; continue; }
        const pts = line.plain.match(/(\d+)\s*PTS\b/i), cp = line.plain.match(/(\d+)\s*CP\b/i);
        const name = titleCase(cleanGlyphs(line.items.filter(i => Math.abs(i.s - entrySize) < 1.2 && !/^UPGRADE$/i.test(i.t.trim())).map(i => i.t.replace(/(\s*\.\s*){3,}/g, " ")).join(" ")).replace(/\d+\s*(PTS|CP)\b/gi, "").replace(/\s+UPGRADE$/i, "").trim());
        entry = { section, name, points: pts ? +pts[1] : null, cp: cp ? +cp[1] : null, lines: [], x: null, upgrade: /\bUPGRADE\b/.test(line.raw || line.plain || "") };
        entries.push(entry);
        continue;
      }
      // The line under the detachment's name, before its first section ("PLAGUE MARINES ADVANCE INEXORABLY…"), is its description.
      if (!entry && !section && line.plain && !/^(UNIQUE\b|ERRATA|Show|Hide)/i.test(line.plain) && !isDP(line.plain)) { det.description += (det.description ? " " : "") + cleanGlyphs(line.plain); continue; }
      if (!entry) continue;
      if (/^(ERRATA|Show|Hide)$/i.test(line.plain)) continue;
      entry.lines.push(line);
    }
    if (isUpperText(det.description)) det.description = det.description.charAt(0) + det.description.slice(1).toLowerCase();
    for (const e of entries) {
      let ls = e.lines;
      let category = "", stratFlavour = "";
      if (/STRATAGEM/.test(e.section) || e.cp != null) {
        const catLine = ls.find(l => /STRATAGEM$/i.test(l.plain) && isUpperText(l.plain));
        if (catLine) category = titleCase(catLine.plain);
        const when = ls.findIndex(l => /^(WHEN|TARGET|EFFECT)\s*:/i.test(l.plain));
        // A stratagem's lore sits between its category line and WHEN:.
        if (when > 0) { stratFlavour = cleanGlyphs(ls.slice(0, when).filter(l => l !== catLine).map(l => l.plain).join(" ")); ls = ls.slice(when); }
        ls = ls.filter(l => l !== catLine);
      }
      const baseX = ls.length ? Math.min(...ls.map(l => l.x)) : 0;
      const { rich, flavour } = regionText(ls, baseX);
      const fl = stratFlavour || flavour;
      const out = { name: e.name, rich, text: stripRich(rich), ...(fl ? { flavour: fl } : {}) };
      if (/ENHANCEMENT/.test(e.section) || e.points != null) det.enhancements.push({ ...out, points: e.points, ...(e.upgrade ? { upgrade: true } : {}) });
      else if (/STRATAGEM/.test(e.section) || e.cp != null) det.stratagems.push({ ...out, cp: e.cp != null ? `${e.cp}CP` : "", category });
      else det.rules.push(out);
    }
    result.detachments.push(det);
  }
  const armyBanner = banners.find(b => /^ARMY RULES?$/i.test(cleanGlyphs(b.t)));
  const firstDet = detTitles.length ? Math.min(...detTitles.map(t => t.y)) : firstDatasheet;
  if (armyBanner) {
    const region = items.filter(i => i.y > armyBanner.y + 6 && i.y < Math.min(firstDet, nextBound(armyBanner.y)) - 3);
    const entrySize = entrySizeOf(region);
    let entry = null, skipping = false, special = false;
    const entries = [];
    for (const line of lines(region)) {
      const first = line.items[0];
      if (Math.abs(first.s - entrySize) < 1.2 && isUpperText(cleanGlyphs(first.t)) && letterCount(first.t) >= 3) {
        const name = titleCase(cleanGlyphs(line.items.filter(i => Math.abs(i.s - entrySize) < 1.2).map(i => i.t).join(" ")));
        const isMove = line.items.some(i => /^\d+\.\d+$/.test(i.t));
        if (/^SPECIAL MOVE TYPES?$/i.test(line.raw)) special = true;
        else if (!isMove) special = false;
        entry = { name, special: isMove && special, lines: [] };
        entries.push(entry);
        skipping = false;
        continue;
      }
      // A smaller mixed-case heading starts a side box (e.g. "Space Marine Chapters"), which is left out.
      if (first.s > body + 2 && first.s < entrySize - 0.8 && /[a-z]/.test(line.raw) && letterCount(line.raw) >= 5 && !/[.:]$/.test(line.raw)) { skipping = true; continue; }
      if (skipping || !entry) continue;
      if (first.s > body + 2 && isUpperText(line.raw)) { entry.lines.push({ ...line, text: `**${titleCase(line.raw)}**`, heading: true }); continue; }
      if (!entry.lines.length && line.items.every(i => i.it)) continue;   // flavour text under the heading
      entry.lines.push(line);
    }
    for (const e of entries) {
      const baseX = e.lines.length ? Math.min(...e.lines.map(l => l.x)) : 0;
      // Sub-headings always start a new paragraph.
      const parts = [];
      let buf = [];
      for (const l of e.lines) { if (l.heading) { if (buf.length) parts.push(linesToRich(buf, baseX)); parts.push(l.text); buf = []; } else buf.push(l); }
      if (buf.length) parts.push(linesToRich(buf, baseX));
      const rich = parts.filter(Boolean).join("\n");
      result.armyRules.push({ name: e.name, special: e.special, rich, text: stripRich(rich) });
    }
  }
  return result;
}

/** One detachment per name and DP cost: when a title line arrives as several pieces, the pieces can each start a
 *  "detachment"; they're merged, keeping every rule, enhancement and stratagem found. */
function mergeDuplicateDetachments(data) {
  const out = [], byKey = new Map();
  for (const d of data.detachments || []) {
    const k = `${d.name.toLowerCase()}|${d.dp}`, prev = byKey.get(k);
    if (!prev) { byKey.set(k, d); out.push(d); continue; }
    for (const f of ["rules", "enhancements", "stratagems"]) for (const e of d[f] || []) if (!prev[f].some(x => x.name === e.name)) prev[f].push(e);
    if (!prev.description && d.description) prev.description = d.description;
    if (!prev.unique && d.unique) prev.unique = d.unique;
    if (!prev.dispositions && d.dispositions) prev.dispositions = d.dispositions;
  }
  data.detachments = out;
  return data;
}
const parseFactionPdf = items => mergeDuplicateDetachments(parseFactionPdfRaw(items));
const parsePrintedFactionPdf = items => mergeDuplicateDetachments(parsePrintedFactionPdfRaw(items));

export { tidyApostrophes, armyRulesFromLayout, dropPageFurniture, groupArmyRules, mergeArmyRules, extractPoints, factionRichness, parseFactionPdf, parsePrintedFactionPdf };
