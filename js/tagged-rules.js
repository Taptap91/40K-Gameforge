/* RulesForge · js/tagged-rules.js
 * Reads a PDF that PDF Studio has tagged (see readPdf's RF: annotations). The tags say where things are, so this
 * doesn't guess headings from font sizes:
 *   h1–h4 flags sit on the first word of a heading. The text on that line is the heading, and its level sets the nesting.
 *   para boxes and the body text beside them are the body; a line counts as body unless it sits in the Contents box or an image box.
 *   img boxes mark an image. The image itself is cropped to its real placed bounds (see exportTagImages), and its file name is
 *   written into the text where it sits, as "[image: name.png]".
 *   toc boxes are the Contents box. The structure comes from the flags, so it's only used to skip its text.
 * Output has the same shape as parseRulesPdfAuto, so rulesToSheets can write it as a normal rules workbook. */
import { dropPageFurniture } from "./faction-parser.js";

const LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4 };
const safeName = s => String(s || "rules").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "rules";

/** Lines of text on each page, top to bottom, in the same coordinates the tags use. */
function taggedLines(pages) {
  const items = dropPageFurniture(pages.flatMap(p => p.items.map(i => ({ ...i, page: p.number }))));
  const lines = [];
  items.forEach(it => {
    if (!it.t || !it.t.trim()) return;
    const x1 = it.x + (it.w || 0);
    const same = lines.find(l => l.page === it.page && Math.abs(l.py - it.py) < 2 && Math.abs(l.x0 - it.x) < 600);
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
  return lines.sort((a, b) => a.page - b.page || a.py - b.py || a.x0 - b.x0);
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
      if (dy > 16 || dx < -10 || dx > 60) return;
      const s = dy + Math.abs(dx) * 0.2;
      if (s < score && !heads.has(l)) { best = l; score = s; }
    });
    if (best) heads.set(best, level); else missed.push(f);
  });
  return { heads, missed };
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

/** Turns tagged pages into rules sections. Returns { sections, battleSizes, images, missed }. */
function taggedRules(pages, tags, title = "") {
  const lines = taggedLines(pages);
  const flags = tags.filter(t => t.shape === "flag");
  const paraBoxes = tags.filter(t => t.k === "para" && t.shape === "box");
  const skipBoxes = tags.filter(t => (t.k === "toc" || t.k === "img") && t.shape === "box");
  const images = imageBoxes(tags, title);
  const { heads, missed } = headingLines(lines, flags);

  // One walk in reading order: headings open sections, body lines and image placeholders go into the open one.
  const events = [];
  lines.forEach(l => {
    if (heads.has(l)) events.push({ kind: "head", level: heads.get(l), text: l.text, page: l.page, cy: l.py });
    else if (!skipBoxes.some(b => inside(l, b))) events.push({ kind: "body", text: l.text, page: l.page, cy: l.py, para: paraBoxes.some(b => inside(l, b)) });
  });
  images.forEach(im => events.push({ kind: "image", name: im.name, page: im.page, cy: im.y0 }));
  events.sort((a, b) => a.page - b.page || a.cy - b.cy || (a.kind === "head" ? -1 : 0));

  const sections = [], last = {};
  let cur = null;
  const open = (title, level) => {
    const chapter = level > 1 ? last[1] || "" : "";
    // Part is the nearest heading one level up (H2 for H3, H3 or H2 for H4), never the heading itself.
    const part = level === 3 ? last[2] || "" : level === 4 ? last[3] || last[2] || "" : "";
    cur = { num: "", title, chapter, part, cp: "", lines: [], level };
    sections.push(cur);
  };
  events.forEach(e => {
    if (e.kind === "head") {
      last[e.level] = e.text;
      for (let l = e.level + 1; l <= 4; l++) delete last[l];
      open(e.text, e.level);
    } else {
      if (!cur) open(title || "Introduction", 1);
      if (e.kind === "image") cur.lines.push(`[image: ${e.name}]`);
      else cur.lines.push(e.text);
    }
  });
  const out = sections
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
    const view = page.view, S = 3;
    const canvas = document.createElement("canvas");
    const vp = page.getViewport({ scale: S });
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    for (const im of list) {
      // The box is only a hint: use the placement that overlaps it most.
      const box = { x0: im.x0 + view[0], x1: im.x1 + view[0], y0: view[3] - im.y1, y1: view[3] - im.y0 };
      let best = null, bestScore = 0;
      placed.forEach(p => { const s = iou(p, box); if (s > bestScore) { bestScore = s; best = p; } });
      const r = best && bestScore > 0.2 ? best : box;
      const sx = Math.max(0, Math.floor((r.x0 - view[0]) * S)), sy = Math.max(0, Math.floor((view[3] - r.y1) * S));
      const sw = Math.min(canvas.width - sx, Math.ceil((r.x1 - r.x0) * S)), sh = Math.min(canvas.height - sy, Math.ceil((r.y1 - r.y0) * S));
      if (sw < 4 || sh < 4) continue;
      const trimmed = trimBlank(g.getImageData(sx, sy, sw, sh), sw, sh);
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
