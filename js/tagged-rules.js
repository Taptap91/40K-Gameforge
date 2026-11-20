/* RulesForge · js/tagged-rules.js
 * Reads a PDF that PDF Studio has tagged (see readPdf's RF: annotations). The tags say where things are, so this
 * doesn't guess headings from font sizes:
 *   h1–h4 flags sit on the first word of a heading. The text on that line is the heading, and its level sets the nesting.
 *   para boxes and the body text beside them are the body; a line counts as body unless it sits in the Contents box or an image box.
 *   img boxes mark an image. The image itself is cropped to its real placed bounds (see exportTagImages), and its file name is
 *   written into the text where it sits, as "[image: name.png]".
 *   toc boxes are the Contents box (one for the whole contents, or one per column, or both). Its text isn't body text, and its
 *   entries become headings: a line in the body that matches an entry exactly, and has no flag, is opened as a chapter (H2) or a
 *   sub-heading (H3), by the entry's size, boldness or indent in the contents. Flags always win over the contents.
 * Output has the same shape as parseRulesPdfAuto, so rulesToSheets can write it as a normal rules workbook. */
import { dropPageFurniture } from "./faction-parser.js";
import { cardLine, cardPlain } from "./text.js?v=8.81";

// H1 = a section, H2 = a rule inside it, H3 = a sub-heading inside the text. The PDF title comes from file metadata, so it is never a heading.
// Internal depths start at 2 so the section logic below is unchanged.
const LEVELS = { h1: 2, h2: 3, h3: 4 };
const safeName = s => String(s || "rules").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "rules";

/** Lines of text on each page, top to bottom, in the same coordinates the tags use. */
/** A line's text with its formatting marked: **bold**, *italic*, {c:#rrggbb|coloured text} and [icon: images/icon-N.png]
 *  where a small picture sits in the text. "" when the line has none of these. */
function richOf(runs, noBold) {
  const out = [];
  runs.forEach(r => {
    const t = r.t.trim(); if (!t) return;
    const b = !noBold && r.b, mark = r.icon != null ? `[icon: images/icon-${r.icon}.png]` : "";
    const last = out[out.length - 1];
    if (last && last.b === b && last.i === r.i && last.col === r.col) last.t += mark + (r.close ? "" : " ") + t;
    else out.push({ t, b, i: r.i, col: r.col, join: mark + (r.close ? "" : " "), mark });
  });
  if (!out.some(o => o.b || o.i || o.col || o.mark || /\[icon: /.test(o.t))) return "";
  return out.map((o, k) => {
    const m = o.b && o.i ? "***" : o.b ? "**" : o.i ? "*" : "";
    const body = o.col ? `{c:${o.col}|${o.t}}` : o.t;
    return (k ? o.join : "") + m + body + m;
  }).join("");
}

function taggedLines(pages, icons = []) {
  const items = dropPageFurniture(pages.flatMap(p => p.items.map(i => ({ ...i, page: p.number, t: i.bu ? "• " + i.t : i.t }))));   // a bullet drawn as a dot becomes a bullet mark
  const lines = [];
  const iconIndex = png => { let k = icons.indexOf(png); if (k < 0) k = icons.push(png) - 1; return k; };
  items.forEach(it => {
    if (!it.t || !it.t.trim() || it.x + (it.w || 0) < 0) return;   // text placed outside the page is not content
    const x1 = it.x + (it.w || 0);
    const same = lines.find(l => l.page === it.page && Math.abs(l.py - it.py) < 2 && it.x - l.x1 < Math.max(30, 3 * (it.s || 10)) && it.x >= l.x0 - 2);
    if (same) {
      same.text += (same.text && !/\s$/.test(same.text) && !(it.ic && it.icTouch) ? " " : "") + it.t.trim();   // text touching an inline icon closes up to the word before it
      const icon = it.ic && it.icPng ? iconIndex(it.icPng) : undefined;
      same.x1 = Math.max(same.x1, x1);
      same.size = Math.max(same.size, it.s || 0);
      const touch = !!(it.ic && it.icTouch), prev = same.runs[same.runs.length - 1];
      // letters touching a skull (Agent[skull]s) carry the styling of the word before it
      const inh = touch && prev && /^[A-Za-z]+$/.test(it.t.trim()) ? { b: prev.b, i: prev.i, col: prev.col } : { b: !!it.b, i: !!it.it, col: it.col };
      same.chars.push({ n: it.t.length, b: inh.b, i: inh.i }); same.runs.push({ t: it.t, b: inh.b, i: inh.i, close: touch, icon, col: inh.col });
    } else lines.push({ page: it.page, py: it.py, x0: it.x, x1, size: it.s || 0, text: it.t.trim(), chars: [{ n: it.t.length, b: !!it.b, i: !!it.it }], runs: [{ t: it.t, b: !!it.b, i: !!it.it, col: it.col }] });
  });
  lines.forEach(l => {
    const total = l.chars.reduce((n, c) => n + c.n, 0), bold = l.chars.reduce((n, c) => n + (c.b ? c.n : 0), 0);
    l.bold = total > 0 && bold / total > 0.6;
    l.italic = total > 0 && l.chars.reduce((n, c) => n + (c.i ? c.n : 0), 0) / total > 0.8;
    l.cx = (l.x0 + l.x1) / 2; l.cy = l.py + l.size * 0.5;
  });
  lines.sort((a, b) => a.page - b.page || a.py - b.py || a.x0 - b.x0);
  // page furniture: the same line (digits aside) in the same place on many pages is a running header or footer, not content
  const nPages = new Set(lines.map(l => l.page)).size;
  if (nPages >= 4) {
    const ph = new Map(pages.map(p => [p.number, p.ph || 792]));
    const key = l => l.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, "") + "@" + Math.round((l.py / ph.get(l.page)) * 60);
    const seen = new Map();
    lines.forEach(l => { const k = key(l); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(l.page); });
    return lines.filter(l => seen.get(key(l)).size < Math.max(3, nPages * 0.35));
  }
  return lines;
}

const inside = (pt, b) => b.page === pt.page && pt.cx >= b.x0 - 5 && pt.cx <= b.x1 + 5 && pt.cy >= b.y0 - 2 && pt.cy <= b.y1 + 2;   // boxes are read with 5pt of slack left and right, 2pt above and below

/** Which line each heading flag sits on. A flag marks the start of its line, so the nearest line to the right and below it wins. */
function headingLines(lines, flags) {
  const heads = new Map(), missed = [];
  flags.forEach(f => {
    const level = LEVELS[f.k];
    if (!level) return;
    let best = null, score = Infinity;
    lines.forEach(l => {
      if (l.page !== f.page || l.bold === undefined) return;
      const dy = Math.abs(l.py - f.y0), dx = l.x0 - f.x0;
      if (dy > Math.max(16, l.size * 1.3) || dx < -10 || dx > 60) return;
      const s = dy + Math.abs(dx) * 0.2;
      if (s < score && !heads.has(l)) { best = l; score = s; }
    });
    if (best && /^\d{1,2}$/.test(best.text.trim())) {
      // a circled number (a numbered callout): the text beside it is the heading, so it comes out bold
      const near = lines.filter(l => l !== best && l.page === best.page && !heads.has(l) && Math.abs(l.py - best.py) < 0.9 * Math.max(l.size, best.size) && l.x0 > best.x1 - 2 && l.x0 - best.x1 < 70);
      if (near.length) { near.sort((a, b) => a.x0 - b.x0); const o = near[0]; best.text = best.text.trim() + ". " + o.text; best.x1 = Math.max(best.x1, o.x1); o.ignore = true; }
    }
    if (best) heads.set(best, level); else missed.push(f);
  });
  return { heads, missed };
}

const normTitle = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Entries of the Contents box(es), read from the raw text items so a multi-column contents page is read column by column.
 *  Returns Map(normalised title -> level). A whole-contents box that contains column boxes is only a wrapper; its columns are read. */
function tocEntries(pages, tocBoxes) {
  const out = new Map();
  if (!tocBoxes.length) return out;
  const contains = (a, b) => a !== b && a.page === b.page && b.x0 >= a.x0 - 2 && b.x1 <= a.x1 + 2 && b.y0 >= a.y0 - 2 && b.y1 <= a.y1 + 2;
  const cols = tocBoxes.filter(b => !tocBoxes.some(o => contains(b, o))).sort((a, b) => a.page - b.page || a.x0 - b.x0 || a.y0 - b.y0);
  const taken = new Set(), rows = [];
  cols.forEach(c => {
    const page = pages.find(p => p.number === c.page);
    if (!page) return;
    const its = page.items.filter(it => it.t && it.t.trim() && !taken.has(it) &&
      inside({ page: c.page, cx: it.x + (it.w || 0) / 2, cy: it.py + (it.s || 0) * 0.5 }, c));
    its.forEach(it => taken.add(it));
    const lines = [];
    its.sort((a, b) => a.py - b.py || a.x - b.x).forEach(it => {
      const l = lines.find(q => Math.abs(q.py - it.py) < 2 && it.x - q.x1 < Math.max(30, 3 * (it.s || 10)));
      if (l) { l.x1 = it.x + (it.w || 0); l.text += (/\s$/.test(l.text) ? "" : " ") + it.t.trim(); l.size = Math.max(l.size, it.s || 0); l.bold = l.bold || !!it.b; }
      else lines.push({ py: it.py, x0: it.x, x1: it.x + (it.w || 0), size: it.s || 0, bold: !!it.b, text: it.t.trim() });
    });
    const minX = lines.length ? Math.min(...lines.map(l => l.x0)) : 0;
    lines.forEach(l => rows.push({ ...l, indent: l.x0 - minX > 8, col: c }));
  });
  // drop dot leaders and page numbers at the end of an entry
  rows.forEach(r => { r.title = r.text.replace(/[\s.\u00b7\u2026_-]*\d+\s*$/, "").trim(); r.key = normTitle(r.title); });
  const entries = rows.filter(r => r.key.length >= 3 && r.key !== "contents");
  if (!entries.length) return out;
  const sizes = entries.map(e => e.size), hi = Math.max(...sizes), lo = Math.min(...sizes);
  const bolds = entries.filter(e => e.bold).length;
  // indent ranks are worked out inside each column, so a second column doesn't push its headings down a level
  entries.forEach(e => {
    const colRows = entries.filter(o => o.col === e.col);
    const xs = []; colRows.map(o => o.x0).sort((p, q) => p - q).forEach(x => { if (!xs.length || x - xs[xs.length - 1].max > 7) xs.push({ min: x, max: x }); else xs[xs.length - 1].max = x; });
    const rank = xs.findIndex(g => e.x0 >= g.min - 1 && e.x0 <= g.max + 1);
    e.level = xs.length > 1 ? 2 + Math.min(2, rank) : hi - lo >= 1 ? (e.size >= hi - 0.5 ? 2 : 3) : bolds && bolds < entries.length ? (e.bold ? 2 : 3) : 2;
  });
  entries.forEach(e => { if (!out.has(e.key)) out.set(e.key, e.level); });
  return out;
}

/** Image boxes, in reading order, each with the file name the converter will give its PNG. */
function imageBoxes(tags, title) {
  const boxes = tags.filter(t => t.k === "img" && t.shape === "box").sort((a, b) => a.page - b.page || a.y0 - b.y0);
  const perPage = {};
  return boxes.map(b => {
    perPage[b.page] = (perPage[b.page] || 0) + 1;
    return { ...b, name: `images/${safeName(title)}-p${b.page}-${perPage[b.page]}.png` };
  });
}


/** Kill Team datacards. PDF Studio's Kill Team style tags each part of a card as a box with a role (title, flavour, stat-label, stat-value,
 *  head-atk…, weapon, weapon-wr, ability, ability-name, keywords, base). Each card becomes one rule: its name is the heading and its
 *  body is one "[datacard: …]" line the app draws as a card. */
function buildCards(pages, lines, roleTags) {
  const boxes = roleTags.filter(t => t.shape === "box");
  const titles = boxes.filter(t => t.role === "title").sort((a, b) => a.page - b.page || a.y0 - b.y0);
  const page = n => pages.find(p => p.number === n);
  const itemsIn = (n, b) => (page(n)?.items || []).filter(it => it.t && it.t.trim() && inside({ page: n, cx: it.x + (it.w || 0) / 2, cy: it.py - (it.s || 0) * 0.3 }, b));
  const textOf = its => {
    const rows = [];
    its.slice().sort((a, b) => a.py - b.py || a.x - b.x).forEach(it => { const r = rows.find(r => Math.abs(r.py - it.py) < 2.5); if (r) r.its.push(it); else rows.push({ py: it.py, its: [it] }); });
    return rows.map(r => r.its.sort((a, b) => a.x - b.x).map(i => i.t.trim()).join(" ")).join(" ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+/g, " ").trim();
  };
  const cx = b => (b.x0 + b.x1) / 2, cy = b => (b.y0 + b.y1) / 2;
  const out = [];
  titles.forEach((tt, i) => {
    const next = titles.slice(i + 1).find(o => o.page === tt.page);
    const mine = boxes.filter(t => t.page === tt.page && t.y0 >= tt.y0 - 40 && (!next || t.y0 < next.y0 - 40) && t !== tt);
    const by = role => mine.filter(t => t.role === role).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const one = role => by(role)[0];
    const txt = b => (b ? textOf(itemsIn(tt.page, b)) : "");
    const card = { tpl: "killteam", name: textOf(itemsIn(tt.page, tt)), type: by("type").map(txt).filter(Boolean).join(" · "), flavour: txt(one("flavour")), stats: [], weapons: [], abilities: [], keywords: "", hot: "", base: "" };
    // stats: each label with the value under it
    const vals = by("stat-value");
    by("stat-label").sort((a, b) => a.x0 - b.x0).forEach(l => {
      const v = vals.filter(v => Math.abs(cx(v) - cx(l)) < 50 && v.y0 >= l.y0).sort((a, b) => a.y0 - b.y0)[0];
      card.stats.push([txt(l), txt(v) || "-"]);
    });
    // weapons: name, ATK, HIT, DMG from the row box by column; special rules from the WR box beside it
    const hd = k => one("head-" + k), atkH = hd("atk");
    const wrs = by("weapon-wr");
    by("weapon").forEach(w => {
      const wrBox = wrs.find(x => x.y1 >= w.y0 - 4 && x.y0 <= w.y1 + 4);
      const its = itemsIn(tt.page, w).filter(it => !(wrBox && inside({ page: tt.page, cx: it.x + (it.w || 0) / 2, cy: it.py - (it.s || 0) * 0.3 }, wrBox)));
      const cols = { n: [], a: [], h: [], d: [] }, heads = ["a", "h", "d"].map(k => [k, hd({ a: "atk", h: "hit", d: "dmg" }[k])]).filter(([, h]) => h);
      its.forEach(it => {
        const c = it.x + (it.w || 0) / 2;
        if (!heads.length || it.x + (it.w || 0) < heads[0][1].x0 - 6) { cols.n.push(it); return; }
        const near = heads.reduce((m, h) => (Math.abs(cx(h[1]) - c) < Math.abs(cx(m[1]) - c) ? h : m));
        cols[near[0]].push(it);
      });
      const n = textOf(cols.n);
      if (n) card.weapons.push({ n, a: textOf(cols.a), h: textOf(cols.h), d: textOf(cols.d), w: wrBox ? txt(wrBox) : "" });
    });
    // abilities: "Name: rule text"
    const names = by("ability-name");
    by("ability").forEach(ab => {
      const nb = names.find(n => cx(n) >= ab.x0 && cx(n) <= ab.x1 && cy(n) >= ab.y0 && cy(n) <= ab.y1);
      const its = itemsIn(tt.page, ab).filter(it => !(nb && inside({ page: tt.page, cx: it.x + (it.w || 0) / 2, cy: it.py - (it.s || 0) * 0.3 }, nb)));
      const name = nb ? txt(nb).replace(/:\s*$/, "") : "";
      card.abilities.push({ n: name, t: textOf(its).replace(/^:\s*/, "") });
    });
    const kw = one("keywords");
    if (kw) {
      card.keywords = txt(kw);
      const hot = lines.filter(l => l.page === tt.page && inside(l, kw)).map(l => richOf(l.runs, true)).join(" ").match(/\{c:#[0-9a-fA-F]{6}\|([^}]*)\}/);
      if (hot) card.hot = hot[1].replace(/[\s,]+$/, "").trim();
    }
    card.base = txt(one("base"));
    out.push({ card, tt, boxes: mine.concat(tt) });
  });
  return out;
}

const pageBy0 = (pages, n) => pages.find(p => p.number === n);

/** Turns tagged pages into rules sections. Returns { sections, battleSizes, images, missed }. */
function taggedRules(pages, tagsIn, title = "") {
  const roleTags = tagsIn.filter(t => t.role);   // the parts of Kill Team datacards: read apart from the ordinary tags
  let tags = tagsIn.filter(t => !t.role);
  const icons = [];
  const allLines = taggedLines(pages, icons);
  // the site's navigation bar across the very top of page 1 is ignored unless something there is tagged as a heading
  const lines = allLines.filter(l => {
    const p = pageBy0(pages, l.page);
    return !(l.page === pages[0].number && p && p.ph && l.py < p.ph * 0.06 && !tags.some(t => LEVELS[t.k] && t.page === l.page && t.y0 < p.ph * 0.08));
  });
  const pageBy = new Map(pages.map(p => [p.number, p]));
  // Wahapedia's small hexagon icons (bottom right) are never images worth exporting
  tags = tags.filter(t => {
    const p = pageBy.get(t.page);
    if (t.k !== "img" || t.shape !== "box" || !p || !p.pw) return true;
    return !((t.x1 - t.x0) < p.pw * 0.12 && (t.y1 - t.y0) < p.ph * 0.1 && t.x0 > p.pw * 0.78 && t.y0 > p.ph * 0.75);
  });
  // datacards: their text is read into the card, so those lines are not body text
  const cards = roleTags.length ? buildCards(pages, lines, roleTags) : [];
  if (cards.length) lines.forEach(l => { if (cards.some(c => c.boxes.some(b => inside(l, b)) || (() => {   // a line across a title and its type sits in neither box: it counts when it lies within the card's extent
    const bs = c.boxes.filter(b => b.page === l.page); if (!bs.length) return false;
    const x0 = Math.min(...bs.map(b => b.x0)) - 6, x1 = Math.max(...bs.map(b => b.x1)) + 6, y0 = Math.min(...bs.map(b => b.y0)) - 2, y1 = Math.max(...bs.map(b => b.y1)) + 2;
    return l.x0 >= x0 && l.x1 <= x1 && l.py >= y0 && l.py <= y1;
  })())) l.ignore = true; });
  const flags = tags.filter(t => t.shape === "flag");
  const paraBoxes = tags.filter(t => t.k === "para" && t.shape === "box");
  const skipBoxes = tags.filter(t => (t.k === "toc" || t.k === "img") && t.shape === "box");
  const images = imageBoxes(tags, title);
  const { heads, missed } = headingLines(lines, flags);
  // on the Contents page, only the Contents counts: the book's name, "Books" and the little blocks around it are ignored
  const tocWhole = tags.filter(t => t.k === "toc" && t.shape === "box").sort((a, b) => a.page - b.page || a.y0 - b.y0)[0];
  const tocAll = tags.filter(t => t.k === "toc" && t.shape === "box");
  if (tocWhole) {
    // before the first chapter heading, only the Contents counts (book name, intro text and a Books table are ignored); after it, it is all body
    const fi = lines.findIndex(l => heads.has(l) && heads.get(l) >= 2);
    lines.forEach((l, i) => { if (l.page === tocWhole.page && !heads.has(l) && !tocAll.some(b => inside(l, b)) && (fi < 0 || i < fi)) l.ignore = true; });
  }
  // Headings drawn as boxes: the text inside the box is the heading, and the box's first line carries it
  const skipLines = new Set();
  tags.filter(t => LEVELS[t.k] && t.shape === "box").forEach(b => {
    const ls = lines.filter(l => inside(l, b));
    if (!ls.length) return;
    ls[0].text = ls.map(l => l.text).join(" ");
    ls.slice(1).forEach(l => skipLines.add(l));
    heads.set(ls[0], LEVELS[b.k]);
  });
  // Section boxes: a section with no heading tag inside takes its top line as the heading, one level under its parent section
  const secs = tags.filter(t => t.k === "sec" && t.shape === "box");
  secs.forEach(sb => {
    if (sb.link && secs.some(o => o !== sb && o.link === sb.link && o.page < sb.page)) return;   // the piece on a later page continues the section, it does not start one
    const ls = lines.filter(l => inside(l, sb) && !skipLines.has(l));
    if (!ls.length || ls.some(l => heads.has(l))) return;
    const depth = secs.filter(o => o !== sb && o.page === sb.page && o.x0 <= sb.x0 + 2 && o.x1 >= sb.x1 - 2 && o.y0 <= sb.y0 + 2 && o.y1 >= sb.y1 - 2).length;
    heads.set(ls[0], Math.min(4, 2 + depth));
  });
  // Contents entries: the first unflagged body line that matches an entry becomes that chapter / sub-heading
  const toc = tocEntries(pages, tags.filter(t => t.k === "toc" && t.shape === "box")), usedToc = new Set();
  heads.forEach((_, l) => usedToc.add(normTitle(l.text)));   // an entry that already has a flag is not matched a second time
  if (toc.size) lines.forEach(l => {
    if (heads.has(l) || skipBoxes.some(b => inside(l, b)) || /[.;:,]$/.test(l.text.trim())) return;
    const key = normTitle(l.text);
    if (toc.has(key) && !usedToc.has(key)) { usedToc.add(key); heads.set(l, toc.get(key)); }
  });

  // One walk in reading order: headings open sections, body lines and image placeholders go into the open one.
  const events = [];
  // the smallest paragraph box holding a line (1-based), 0 when none
  const smallest = (boxes, l) => { let best = 0, area = Infinity; boxes.forEach((b, i) => { const a = (b.x1 - b.x0) * (b.y1 - b.y0); if (inside(l, b) && a < area) { best = b.link ? "L" + b.link : i + 1; area = a; } }); return best; };
  // when most of the book's text is set in a bold face, bold says nothing, so it is not marked
  const boldHeavy = lines.length > 0 && lines.filter(l => l.bold).length > lines.length * 0.5;
  lines.forEach(l => {
    if (skipLines.has(l) || l.ignore) return;
    if (heads.has(l)) events.push({ kind: "head", level: heads.get(l), text: l.text, page: l.page, cy: l.py, x0: l.x0, x1: l.x1, size: l.size });
    else if (!skipBoxes.some(b => inside(l, b))) events.push({ kind: "body", text: l.text, page: l.page, cy: l.py, x0: l.x0, x1: l.x1, size: l.size, rich: richOf(l.runs, boldHeavy), italic: l.italic, pbox: smallest(paraBoxes, l), para: paraBoxes.some(b => inside(l, b)) });
  });
  cards.forEach(({ card, tt }) => {
    if (!card.name) return;
    events.push({ kind: "head", level: 3, text: card.name, page: tt.page, cy: tt.y0, x0: tt.x0, x1: tt.x1, size: 14 });
    events.push({ kind: "body", card: true, text: cardPlain(card), rich: cardLine(card), page: tt.page, cy: tt.y0 + 0.5, x0: tt.x0, x1: tt.x1, size: 10, italic: false, pbox: 0 });
  });
  images.forEach(im => events.push({ kind: "image", name: im.name, page: im.page, cy: im.y0, ix0: im.x0, ix1: im.x1, iy1: im.y1 }));
  events.sort((a, b) => a.page - b.page || a.cy - b.cy || (a.kind === "head" ? -1 : 0));
  // Rows read left to right: a number or heading that sits on the same row as its label (a callout "1" beside "Type of operative")
  // comes first when it is the one on the left, even if its text sits a few points lower or higher on the page.
  const sz = e => e.size || 10, short = e => e.kind === "head" || (e.kind === "body" && e.text.trim().length <= 4);
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i + 1 < events.length; i++) {
    const a = events[i], b = events[i + 1];
    if (a.page !== b.page || a.x0 === undefined || b.x0 === undefined || a.kind === "image" || b.kind === "image") continue;
    if (Math.abs(a.cy - b.cy) < 0.9 * Math.max(sz(a), sz(b)) && b.x0 < a.x0 && b.x1 <= a.x0 + 4 && (short(a) || short(b)) && a.x0 - b.x1 < 150) { events[i] = b; events[i + 1] = a; }
  }

  // Numbered callouts: a lone number (usually in a circle) with its text beside it, numbered 1, 2, 3 in turn, is a bold numbered item.
  {
    const cand = [];
    events.forEach((e, i) => {
      if (e.kind !== "body" || !/^\d{1,2}$/.test(e.text.trim())) return;
      const o = events[i + 1];
      if (!o || o.kind !== "body" || o.page !== e.page || Math.abs(o.cy - e.cy) > 0.9 * Math.max(sz(o), sz(e)) || !(o.x0 > e.x1 - 2) || o.x0 - e.x1 > 70 || /^\d{1,2}$/.test(o.text.trim()) || o.text.trim().length < 2) return;
      cand.push({ i, n: +e.text.trim() });
    });
    const keep = new Set();
    for (let k = 0; k < cand.length; k++) {
      if (cand[k + 1] && cand[k + 1].n === cand[k].n + 1 || cand[k - 1] && cand[k - 1].n === cand[k].n - 1) keep.add(cand[k].i);
    }
    const drop = new Set();
    keep.forEach(i => {
      const e = events[i], o = events[i + 1];
      e.kind = "head"; e.level = 4; e.text = e.text.trim() + ". " + o.text.trim(); e.x1 = Math.max(e.x1, o.x1); e.rich = "";
      drop.add(o);
    });
    if (drop.size) events.splice(0, events.length, ...events.filter(e => !drop.has(e)));
  }

  // Group boxes: whatever sits inside one belongs together. Its text is kept in one run (nothing from outside is read in between),
  // labels and paragraphs never cross its edge, and the smallest box that holds an item is the item's group.
  const groups = tags.filter(t => t.k === "grp" && t.shape === "box").map(b => ({ b, area: (b.x1 - b.x0) * (b.y1 - b.y0) })).sort((a, c) => a.area - c.area);
  if (groups.length) {
    // An item belongs to a group when any part of it lies inside the box's bounds (not only when it sits wholly inside, or its centre does).
    // When it touches several, the group that holds the larger share of it wins; a tie goes to the smaller box.
    events.forEach(e => {
      const ex0 = e.kind === "image" ? e.ix0 : e.x0, ex1 = e.kind === "image" ? e.ix1 : e.x1;
      const ey0 = e.kind === "image" ? Math.min(e.cy, e.iy1 ?? e.cy) : e.cy - (e.size || 10) / 2, ey1 = e.kind === "image" ? Math.max(e.cy, e.iy1 ?? e.cy) : e.cy + (e.size || 10) / 2;
      const w = Math.max(ex1 - ex0, 1), h = Math.max(ey1 - ey0, 1);
      let gi = -1, best = 0;
      groups.forEach((g, i) => {
        if (g.b.page !== e.page) return;
        const ow = Math.min(ex1, g.b.x1) - Math.max(ex0, g.b.x0), oh = Math.min(ey1, g.b.y1) - Math.max(ey0, g.b.y0);
        if (ow <= 0 || oh <= 0) return;
        const share = (ow * oh) / (w * h);
        if (share > best + 1e-6) { best = share; gi = i; }   // groups are sorted smallest first, so a tie keeps the smaller box
      });
      if (gi >= 0) e.grp = groups[gi].b.link ? "L" + groups[gi].b.link : gi + 1;   // pieces of a box that runs across pages are one group
    });
    // A short heading flag inside a group ("Q:", "1", "Note") is a label for the text beside it, not a heading of its own.
    events.forEach(e => { if (e.grp && e.kind === "head" && e.text.trim().length <= 6) { e.kind = "body"; e.glabel = true; e.rich = ""; e.italic = false; } });
    const placed = new Set(), ordered = [];
    events.forEach(e => {
      if (!e.grp) { ordered.push(e); return; }
      if (placed.has(e.grp)) return;
      placed.add(e.grp);
      ordered.push(...events.filter(x => x.grp === e.grp));   // already in reading order
    });
    events.splice(0, events.length, ...ordered);
  }
  const sameGrp = (a, b) => (a.grp || 0) === (b.grp || 0);

  // A "Q:" / "A:" label that stands alone is joined to the first line of the block of text beside it.
  events.forEach(L => {
    if (L.kind !== "body" || !(L.glabel || /^[QA]:$/.test(L.text.trim())) || L.gone) return;
    const near = events.filter(e => e.kind === "body" && !e.gone && e !== L && e.page === L.page && sameGrp(e, L) && e.x0 >= L.x1 - 2 && e.x0 <= L.x1 + 30 && Math.abs(e.cy - L.cy) < 2.2 * sz(L));
    if (!near.length) return;
    let top = near.reduce((a, b) => (Math.abs(b.cy - L.cy) < Math.abs(a.cy - L.cy) ? b : a));
    for (;;) {   // up to the first line of that block
      const above = events.filter(e => e.kind === "body" && !e.gone && e.page === L.page && sameGrp(e, L) && Math.abs(e.x0 - top.x0) < 4 && e.cy < top.cy && top.cy - e.cy < 1.5 * sz(top) && !/^[QA]:/.test(top.text));
      if (!above.length) break;
      top = above.reduce((a, b) => (b.cy > a.cy ? b : a));
    }
    if (top.rich || L.rich) top.rich = `${L.rich || L.text.trim()} ${top.rich || top.text}`;
    top.text = `${L.text.trim()} ${top.text}`;
    L.gone = true;
  });
  for (let i = events.length - 1; i >= 0; i--) if (events[i].gone) events.splice(i, 1);

  // A "Q:" / "A:" label can sit beside the second line of its answer (it is centred on the block). It belongs at the start of
  // the answer: the label is moved up to the first line of the block of text just above it.
  events.forEach((e, i) => {
    const m = e.kind === "body" && /^([QA]):\s+(\S.*)$/.exec(e.text);
    if (!m || i === 0) return;
    const k = i - 1, up = events[k];
    if (up.kind !== "body" || !sameGrp(up, e) || /[.?!:;)]\s*$/.test(up.text) || up.page !== e.page || !(up.x0 > e.x0 + 8) || !(e.cy - up.cy < 1.8 * sz(up))) return;
    let top = k;
    while (top > 0 && events[top - 1].kind === "body" && events[top - 1].page === e.page && Math.abs(events[top - 1].x0 - up.x0) < 4 && events[top].cy - events[top - 1].cy < 1.5 * sz(up)) top--;
    const t = events[top];
    // the label keeps its own formatting (colour) when it has any
    const lab = e.rich && /^(\**)(\{c:#[0-9a-f]{6}\|[QA]:\})\1\s*/.exec(e.rich);
    t.text = `${m[1]}: ${t.text}`; if (t.rich || lab) t.rich = `${lab ? lab[0].trim() : m[1] + ":"} ${t.rich || t.text.slice(m[1].length + 2)}`;
    e.x0 = up.x0; e.text = m[2]; if (e.rich) e.rich = lab ? e.rich.slice(lab[0].length) : e.rich.replace(/^\**\s*[QA]:\s*\**\s*/, "");
  });

  // H1 = a section (its own box in the app), H2 = a rule nested under it, H3 = a sub-heading inside the text above.
  // A section's own text is whatever sits between its heading and its first H2. The heading that repeats the document's
  // own title (or text before any heading) is called "Introduction".
  const clean = raw => {
    const m = /^(\d+)\s*\.\s*(\S.*)$/.exec(raw);
    let t = (m ? m[2] : raw).replace(/\s+\d+\s*(ap|cp)$/i, "");
    if (!/[a-z]/.test(t)) t = t.toLowerCase().replace(/(^|[\s(\-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    return { num: m ? m[1] : "", title: t };
  };
  const sameName = (a, b) => normTitle(a) && normTitle(a) === normTitle(b);
  const rows = [];
  let chap = null, rule = null;
  const newChap = raw => {
    const c = clean(raw);
    const name = !raw || sameName(c.title, title) ? "Introduction" : c.title;
    rule = null;
    const again = name === "Introduction" && rows.find(r => r.chapter === name && r.title === name);   // text before the title heading and the title heading itself are one Introduction
    if (again) { chap = again; if (again.pre && again.lines.map(l => l.t).join(" ").length < 60) again.lines = []; again.pre = false; return; }   // a few stray words above the title are page chrome (dates, numbers)
    chap = { num: c.num, title: name, chapter: name, lines: [] }; rows.push(chap);
  };
  // A group holding one picture and some text is shown side by side: the picture on the left, the text to its right.
  const sides = new Map();
  events.forEach(e => { if (e.grp) { if (!sides.has(e.grp)) sides.set(e.grp, []); sides.get(e.grp).push(e); } });
  sides.forEach((m, k) => {
    const imgs = m.filter(e => e.kind === "image");
    if (imgs.length !== 1 || m.length < 2 || m.some(e => e.kind === "head")) { sides.delete(k); return; }
    // Side by side only for a short note: up to 4 lines to the right of the picture and level with it. Long text, or text above or below it, keeps its order.
    const im = imgs[0], txt = m.filter(e => e.kind !== "image");
    const level = txt.every(e => e.x0 >= im.ix0 + (im.ix1 - im.ix0) * 0.5 && e.cy >= im.cy - 14 && e.cy <= (im.iy1 || im.cy) + 14);
    if (!level || txt.length > 4 || txt.reduce((n, e) => n + e.text.length, 0) > 420) { sides.delete(k); return; }
    m.side = { img: imgs[0], first: m[0], last: m[m.length - 1] };
  });
  events.forEach(e => {
    if (e.kind === "head") {
      if (e.level === 2) newChap(e.text);
      else if (e.level === 3) { const c = clean(e.text); rule = { num: c.num, title: c.title, chapter: chap ? chap.title : "", lines: [] }; rows.push(rule); }
      else (rule || chap || (newChap(""), chap)).lines.push({ t: (clean(e.text).num ? clean(e.text).num + ". " : "") + clean(e.text).title, b: true });
    } else {
      const to = rule || chap || (newChap(""), chap.pre = true, chap);
      const sd = e.grp && sides.get(e.grp) && sides.get(e.grp).side;
      if (sd) {
        if (e === sd.first) to.lines.push({ t: `[side: ${sd.img.name}]`, r: "", b: false, g: null });
        if (e.kind !== "image") to.lines.push({ t: e.text, r: e.rich, b: false, g: e });
        if (e === sd.last) to.lines.push({ t: "[/side]", r: "", b: false, g: null });
        return;
      }
      to.lines.push({ t: e.kind === "image" ? `[image: ${e.name}]` : e.text, r: e.kind === "image" ? "" : e.rich, b: false, g: e.kind === "image" ? null : e });
    }
  });
  // The widest line in each column of each page: a line much shorter than that ends its paragraph.
  const widest = new Map(), colKey = g => g.page + ":" + Math.round(g.x0 / 40);
  rows.forEach(r => r.lines.forEach(l => { if (l.g) widest.set(colKey(l.g), Math.max(widest.get(colKey(l.g)) || 0, l.g.x1 - l.g.x0)); }));
  rows.forEach(r => { r.lines = paragraphs(r.lines, widest, colKey); });
  const out = rows
    .map(r => {
      const text = r.lines.map(l => l.t).join("\n");
      // a line whose bold/italic marks do not pair up (a run that crosses a paragraph break) loses them, so no stray asterisk shows
      const balanced = line => { const open = new Set(); (line.match(/\*{1,3}/g) || []).forEach(t => { if (open.has(t)) open.delete(t); else open.add(t); }); return open.size ? line.replace(/\*+/g, "") : line; };
      const rich = r.lines.some(l => l.b || l.r) ? r.lines.map(l => balanced(l.b ? `**${l.t}**` : l.r || l.t)).join("\n") : "";
      return { num: r.num, title: r.title, chapter: r.chapter, part: "", cp: "", text, rich };
    })
    .filter(r => r.text.trim());
  return { sections: out, battleSizes: [], images, icons: icons.map((png, k) => ({ name: `images/icon-${k}.png`, png })), missed: missed.length };
}

const BULLET = /^[•◦▪▫■□●○◆◇‣⁃∙·]\s*/;
const ENDS = /[.!?:;)"”’]$/;

/** The PDF's lines become paragraphs: lines are joined while the text runs on, and a new paragraph starts after a short last
 *  line, a gap, a colon, an indent change or a bullet. Short one-line items after a line ending in ":" become a bullet list. */
function paragraphs(lines, widest, colKey) {
  const out = []; let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  const join = (c, l) => {
    const glue = /-$/.test(c.t) && !/ -$/.test(c.t) ? "" : " ";
    if (c.r || l.r) c.r = ((c.r || c.t) + glue + (l.r || l.t)).replace(/(?<!\*)(\*{1,3}) \1(?!\*)(?=\S)/g, " ");   // one run of bold or italic across a line break
    c.t += glue + l.t;
  };
  const joins = (p, l) => {
    const a = p.last.g, b = l.g;
    if ((a.grp || 0) !== (b.grp || 0)) return false;               // never across a group box
    if (a.grp && a.pbox && a.pbox === b.pbox) return true;          // inside a group, one paragraph box is one paragraph
    if (a.pbox && a.pbox === b.pbox && /^L/.test(String(a.pbox))) return true;   // one paragraph box drawn across a page break is one paragraph
    if (a.page !== b.page) return !ENDS.test(p.t);
    const gap = b.py - a.py;
    if (gap < -2) return !ENDS.test(p.t);                          // jumped up: the next column
    if (gap > 1.7 * Math.max(a.size, b.size)) return false;        // a visible gap
    if (Math.abs(a.size - b.size) > 1.2) return false;
    if (!!a.italic !== !!b.italic) return false;               // an italic note stands apart from what is before it
    if (b.x0 < p.first.g.x0 - 10 && p.n > 1) return false;       // outdent (the second line of a paragraph may sit left of an indented first line)
    if (/:$/.test(p.t)) return false;
    const full = a.x1 - a.x0 >= 0.85 * (widest.get(colKey(a)) || 0);
    if (!full && ENDS.test(p.t)) return false;                    // a short last line ending a sentence
    return true;
  };
  lines.forEach(l => {
    if (!l.g || l.b || l.g.card) { flush(); out.push(l); return; }
    const m = BULLET.exec(l.t);
    if (m) { flush(); cur = { t: "• " + l.t.slice(m[0].length), r: l.r ? "• " + l.r.replace(/^\**\s*[•◦▪▫■□●○◆◇‣⁃∙·]\s*/, "") : "", b: false, last: l, first: l, n: 1, bullet: true }; return; }
    if (cur && !cur.bullet && joins(cur, l)) { join(cur, l); cur.last = l; cur.n++; return; }
    if (cur && cur.bullet && l.g.x0 > cur.first.g.x0 + 4 && joins(cur, l)) { join(cur, l); cur.last = l; cur.n++; return; }   // a bullet's wrapped line
    flush(); cur = { t: l.t, r: l.r || "", b: false, last: l, first: l, n: 1 };
  });
  flush();
  // one-line items right after a line ending in ":" are a list
  for (let i = 0; i < out.length; i++) {
    if (!out[i].g && out[i].last && /:$/.test(out[i].t) && !/^(Q|A):/.test(out[i].t)) {
      let j = i + 1; while (j < out.length && out[j].last && out[j].n <= 3 && out[j].t.length < 130 && !out[j].bullet && !/^(Q|A):/.test(out[j].t)) j++;
      if (j - i - 1 >= 2) for (let k = i + 1; k < j; k++) { out[k].t = "• " + out[k].t; if (out[k].r) out[k].r = "• " + out[k].r; }
    }
  }
  return out.map(o => ({ t: o.t, b: o.b, r: o.r || "" }));
}

/** Crops every image box from the page to the image's real placed bounds, trimmed of blank margins, as PNG. */
async function exportTagImages(doc, images, pdfjs) {
  const OPS = pdfjs.OPS, out = [];
  const byPage = new Map();
  images.forEach(im => { if (!byPage.has(im.page)) byPage.set(im.page, []); byPage.get(im.page).push(im); });
  for (const [pageNo, list] of byPage) {
    const page = await doc.getPage(pageNo);
    const ol = await page.getOperatorList();
    const placed = placements(ol, OPS);
    const view = page.view;
    for (const im of list) {
      // The box is only a hint: use the placement that overlaps it most.
      const box = { x0: im.x0 + view[0], x1: im.x1 + view[0], y0: view[3] - im.y1, y1: view[3] - im.y0 };
      let best = null, bestScore = 0;
      placed.forEach(p => { const s = iou(p, box); if (s > bestScore) { bestScore = s; best = p; } });
      // The picture's own bounds and the drawn box are merged: a box drawn bigger than the raster (art or labels around it) is respected
      const r = best && bestScore > 0.2 ? { x0: Math.min(best.x0, box.x0), x1: Math.max(best.x1, box.x1), y0: Math.min(best.y0, box.y0), y1: Math.max(best.y1, box.y1) } : box;
      // Only this image's area is drawn (a very tall page can't be drawn whole): the scale is lowered if the crop is huge.
      const S = Math.min(3, 5000 / Math.max(r.x1 - r.x0, r.y1 - r.y0, 1));
      const vp = page.getViewport({ scale: S });
      const G = 0;   // the tagged box already carries its own padding
      const sx = Math.max(0, Math.ceil((r.x0 - view[0]) * S) - G + 1), sy = Math.max(0, Math.ceil((view[3] - r.y1) * S) - G + 1);   // starts inside the first whole pixel: a half-covered pixel at the edge would be a faint line of page colour
      const sw = Math.min(Math.ceil(vp.width) - sx, Math.floor((r.x1 - r.x0) * S) + 2 * G - 2), sh = Math.min(Math.ceil(vp.height) - sy, Math.floor((r.y1 - r.y0) * S) + 2 * G - 2);
      if (sw < 4 || sh < 4) continue;
      const canvas = document.createElement("canvas"); canvas.width = sw; canvas.height = sh;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff"; g.fillRect(0, 0, sw, sh);
      await page.render({ canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, -sx, -sy], annotationMode: 0 }).promise;   // annotations off: the tag boxes are not drawn into the picture
      const trimmed = trimBlank(g.getImageData(0, 0, sw, sh), sw, sh);
      // no extra border: the box itself carries the padding
      const PAD = 0;
      const c = document.createElement("canvas"); c.width = trimmed.w + PAD * 2; c.height = trimmed.h + PAD * 2;
      const cg = c.getContext("2d"); cg.fillStyle = "#fff"; cg.fillRect(0, 0, c.width, c.height);
      cg.putImageData(trimmed.data, PAD, PAD);
      const blob = await new Promise(res => c.toBlob(res, "image/png"));
      out.push({ name: im.name, blob });
    }
  }
  return out;
}

/** Bounds of every image the page places, in PDF coordinates (matrix math on the operator list). */
function placements(ol, OPS) {
  const stack = []; let ctm = [1, 0, 0, 1, 0, 0]; const out = [];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  ol.fnArray.forEach((fn, j) => {
    const a = ol.argsArray[j];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(a, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(a[0], ctm); }   // pictures inside a form sit in the form's own coordinates
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  });
  return out.filter(b => b.x1 - b.x0 > 2 && b.y1 - b.y0 > 2);
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy, union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 0 ? inter / union : 0;
}

/** Trims blank (white or fully transparent) margins off a crop, but only when that keeps most of the area. */
function trimBlank(img, w, h) {
  const d = img.data; let x0 = w, x1 = -1, y0 = h, y1 = -1;
  // the page's own background colour (the commonest colour on the outer ring) is what gets trimmed, white or not
  const ring = new Map(), at = (x, y) => (y * w + x) * 4;
  const see = (x, y) => { const i = at(x, y), k = (d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3); const r = ring.get(k) || { n: 0, r: d[i], g: d[i + 1], b: d[i + 2] }; r.n++; ring.set(k, r); };
  for (let x = 0; x < w; x++) { see(x, 0); see(x, h - 1); }
  for (let y = 0; y < h; y++) { see(0, y); see(w - 1, y); }
  const bg = [...ring.values()].sort((a, b) => b.n - a.n)[0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const ink = d[i + 3] > 8 && (Math.abs(d[i] - bg.r) > 22 || Math.abs(d[i + 1] - bg.g) > 22 || Math.abs(d[i + 2] - bg.b) > 22);
    if (ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { w, h, data: img };
  const pad = 0;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  let cropped = img, cw = w, ch = h;
  if (nw * nh < w * h) {
    cropped = new ImageData(nw, nh); cw = nw; ch = nh;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const si = ((y + y0) * w + (x + x0)) * 4, di = (y * nw + x) * 4;
      cropped.data[di] = d[si]; cropped.data[di + 1] = d[si + 1]; cropped.data[di + 2] = d[si + 2]; cropped.data[di + 3] = d[si + 3];
    }
  }
  // A shaped icon (a cone, a badge) sits on the page colour: when nearly all of its outer ring is page colour, the page colour joined to the edge is made see-through, so no rectangle shows around it.
  const c = cropped.data, near = i => Math.abs(c[i] - bg.r) <= 20 && Math.abs(c[i + 1] - bg.g) <= 20 && Math.abs(c[i + 2] - bg.b) <= 20;
  let ringN = 0, ringBg = 0;
  for (let x = 0; x < cw; x++) for (const y of [0, ch - 1]) { ringN++; if (near((y * cw + x) * 4)) ringBg++; }
  for (let y = 1; y < ch - 1; y++) for (const x of [0, cw - 1]) { ringN++; if (near((y * cw + x) * 4)) ringBg++; }
  if (ringN && ringBg / ringN >= 0.8) {
    const seen = new Uint8Array(cw * ch), stack = [];
    const push = (x, y) => { const k = y * cw + x; if (!seen[k] && near(k * 4)) { seen[k] = 1; stack.push(k); } };
    for (let x = 0; x < cw; x++) { push(x, 0); push(x, ch - 1); }
    for (let y = 0; y < ch; y++) { push(0, y); push(cw - 1, y); }
    while (stack.length) {
      const k = stack.pop(), x = k % cw, y = (k / cw) | 0;
      c[k * 4 + 3] = 0;
      if (x > 0) push(x - 1, y); if (x < cw - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < ch - 1) push(x, y + 1);
    }
    // The anti-aliased fringe along the icon's edge is a blend of the page colour and the icon: two pixels are peeled off so no pale outline is left.
    for (let pass = 0; pass < 2; pass++) {
      const kill = [];
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        if (c[(y * cw + x) * 4 + 3] === 0) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || c[(ny * cw + nx) * 4 + 3] === 0) { edge = true; break; }
        }
        if (edge) kill.push((y * cw + x) * 4 + 3);
      }
      kill.forEach(i => { c[i] = 0; });
    }
  }
  return { w: cw, h: ch, data: cropped };
}

export { taggedRules, exportTagImages };
