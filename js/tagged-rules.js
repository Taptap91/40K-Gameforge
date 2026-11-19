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

// H1 chapter, H2 rule, H3 step. The PDF title comes from file metadata, so it is never a heading.
// Internal depths start at 2 so the section logic below is unchanged.
const LEVELS = { h1: 2, h2: 3, h3: 4 };
const safeName = s => String(s || "rules").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "rules";

/** Lines of text on each page, top to bottom, in the same coordinates the tags use. */
function taggedLines(pages) {
  const items = dropPageFurniture(pages.flatMap(p => p.items.map(i => ({ ...i, page: p.number }))));
  const lines = [];
  items.forEach(it => {
    if (!it.t || !it.t.trim() || it.x + (it.w || 0) < 0) return;   // text placed outside the page is not content
    const x1 = it.x + (it.w || 0);
    const same = lines.find(l => l.page === it.page && Math.abs(l.py - it.py) < 2 && it.x - l.x1 < Math.max(30, 3 * (it.s || 10)) && it.x >= l.x0 - 2);
    if (same) {
      same.text += (same.text && !/\s$/.test(same.text) ? " " : "") + it.t.trim();
      same.x1 = Math.max(same.x1, x1);
      same.size = Math.max(same.size, it.s || 0);
      same.chars.push({ n: it.t.length, b: !!it.b });
    } else lines.push({ page: it.page, py: it.py, x0: it.x, x1, size: it.s || 0, text: it.t.trim(), chars: [{ n: it.t.length, b: !!it.b }] });
  });
  lines.forEach(l => {
    const total = l.chars.reduce((n, c) => n + c.n, 0), bold = l.chars.reduce((n, c) => n + (c.b ? c.n : 0), 0);
    l.bold = total > 0 && bold / total > 0.6;
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

const inside = (pt, b) => b.page === pt.page && pt.cx >= b.x0 - 2 && pt.cx <= b.x1 + 2 && pt.cy >= b.y0 - 2 && pt.cy <= b.y1 + 2;

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

const pageBy0 = (pages, n) => pages.find(p => p.number === n);

/** Turns tagged pages into rules sections. Returns { sections, battleSizes, images, missed }. */
function taggedRules(pages, tagsIn, title = "") {
  let tags = tagsIn;
  const allLines = taggedLines(pages);
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
  lines.forEach(l => {
    if (skipLines.has(l) || l.ignore) return;
    if (heads.has(l)) events.push({ kind: "head", level: heads.get(l), text: l.text, page: l.page, cy: l.py });
    else if (!skipBoxes.some(b => inside(l, b))) events.push({ kind: "body", text: l.text, page: l.page, cy: l.py, para: paraBoxes.some(b => inside(l, b)) });
  });
  images.forEach(im => events.push({ kind: "image", name: im.name, page: im.page, cy: im.y0 }));
  events.sort((a, b) => a.page - b.page || a.cy - b.cy || (a.kind === "head" ? -1 : 0));

  const sections = [], last = {};
  let cur = null;
  // "1.INITIATIVE" becomes number 1, title "Initiative"; SHOUTING titles are put into Title Case
  const clean = raw => {
    const m = /^(\d+)\s*\.\s*(\S.*)$/.exec(raw);
    let t = (m ? m[2] : raw).replace(/\s+\d+\s*(ap|cp)$/i, "");
    if (!/[a-z]/.test(t)) t = t.toLowerCase().replace(/(^|[\s(\-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    return { num: m ? m[1] : "", title: t };
  };
  const open = (title, level) => {
    // H1 is the document title. H2 is a chapter, H3 a rule inside it, H4 a step of the rule (its Part is that H3).
    const chapter = level >= 3 ? last[2] || last[1] || "" : "";
    const part = level === 4 ? last[3] || "" : "";
    const c = clean(title);
    cur = { num: c.num, title: c.title, chapter, part, cp: "", lines: [], level };
    sections.push(cur);
  };
  events.forEach(e => {
    if (e.kind === "head") {
      last[e.level] = clean(e.text).title;
      for (let l = e.level + 1; l <= 4; l++) delete last[l];
      open(e.text, e.level);
    } else {
      if (!cur) open(title || "Introduction", 1);
      if (e.kind === "image") cur.lines.push(`[image: ${e.name}]`);
      else cur.lines.push(e.text);
    }
  });
  // chapters (H2) and the title (H1) only group the rules under them; they are rows only when nothing sits below them
  // A heading is a row when it is an H3/H4, or an H2 with nothing deeper under it (some books only use one level of headings).
  sections.forEach((sec, i) => {
    sec.leaf = true;
    for (let j = i + 1; j < sections.length && sections[j].level > sec.level; j++) sec.leaf = false;
  });
  const deepRows = sections.filter(s => s.level >= 3 && s.lines.length).length;
  const flat = deepRows < 3;   // a book with only one or two levels of headings: its H2 headings are the rows
  const out = sections
    .filter(s => flat ? (s.level >= 2 && s.leaf) || s.level >= 3 : s.level >= 3)
    .map(s => ({ num: s.num, title: s.title, chapter: s.chapter, part: s.part, cp: "", text: s.lines.join("\n"), rich: "" }))
    .filter(s => s.text.trim());
  return { sections: out, battleSizes: [], images, missed: missed.length };
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
      const r = best && bestScore > 0.2 ? best : box;
      // Only this image's area is drawn (a very tall page can't be drawn whole): the scale is lowered if the crop is huge.
      const S = Math.min(3, 5000 / Math.max(r.x1 - r.x0, r.y1 - r.y0, 1));
      const vp = page.getViewport({ scale: S });
      const sx = Math.max(0, Math.floor((r.x0 - view[0]) * S)), sy = Math.max(0, Math.floor((view[3] - r.y1) * S));
      const sw = Math.min(Math.ceil(vp.width) - sx, Math.ceil((r.x1 - r.x0) * S)), sh = Math.min(Math.ceil(vp.height) - sy, Math.ceil((r.y1 - r.y0) * S));
      if (sw < 4 || sh < 4) continue;
      const canvas = document.createElement("canvas"); canvas.width = sw; canvas.height = sh;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff"; g.fillRect(0, 0, sw, sh);
      await page.render({ canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, -sx, -sy] }).promise;
      const trimmed = trimBlank(g.getImageData(0, 0, sw, sh), sw, sh);
      const c = document.createElement("canvas"); c.width = trimmed.w; c.height = trimmed.h;
      c.getContext("2d").putImageData(trimmed.data, 0, 0);
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const ink = d[i + 3] > 8 && (d[i] + d[i + 1] + d[i + 2]) / 3 < 242;
    if (ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { w, h, data: img };
  const pad = 3;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nw * nh > 0.85 * w * h) return { w, h, data: img };
  const cropped = new ImageData(nw, nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const si = ((y + y0) * w + (x + x0)) * 4, di = (y * nw + x) * 4;
    cropped.data[di] = d[si]; cropped.data[di + 1] = d[si + 1]; cropped.data[di + 2] = d[si + 2]; cropped.data[di + 3] = d[si + 3];
  }
  return { w: nw, h: nh, data: cropped };
}

export { taggedRules, exportTagImages };
