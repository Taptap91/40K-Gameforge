/* RulesForge · pdf-reader.js
 * Reads a PDF's text with positions, using pdf.js (loaded only when a PDF is added).
 */
import { cleanGlyphs, isWebFurniture, normalize, scrubWeb } from "./text.js?v=5.6";

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

function chunkPages(pages, target = 900, overlap = 160) {
  const out = [];
  for (const page of pages) {
    let buffer = "";
    for (const line of page.text.split("\n")) {
      if (buffer && buffer.length + line.length + 1 > target) {
        out.push({ page: page.number, text: buffer });
        let tail = buffer.slice(-overlap);
        const sp = tail.indexOf(" ");
        if (sp >= 0) tail = tail.slice(sp + 1);
        buffer = tail;
      }
      buffer += buffer ? "\n" + line : line;
    }
    if (buffer.trim().length > 40) out.push({ page: page.number, text: buffer });
  }
  return out;
}
const mostCommonSize = items => {
  const c = new Map();
  for (const i of items) { const k = Math.round(i.s * 2) / 2; c.set(k, (c.get(k) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || 13;
};

/** Groups items into visual lines (same height on the page), left to right. */
function readingLines(items, tol = 6) {
  const lines = [];
  for (const it of items.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (last && it.y - last.y <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = cleanGlyphs(l.items.map(i => i.t).join(" "));
    l.size = Math.max(...l.items.map(i => i.s));
    l.x = l.items[0].x;
    l.right = Math.max(...l.items.map(i => i.x + (i.w || 0)));
  }
  return lines.filter(l => l.text);
}let pdfjs = null;
async function readPdf(file, onPage) {
  if (!pdfjs) {
    pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  const fontInfo = new Map();   // font id → { b: bold, i: italic }, looked up once per font
  let offset = 0;   // pages are laid end to end, so layouts that cross page breaks still line up
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const pageHeight = (page.view[3] - page.view[1]) || 792;
    const pageWidth = (page.view[2] - page.view[0]) || 612;
    // Bold and italic come from the font names; fonts load the first time a page uses them.
    const unknownFonts = [...new Set(content.items.map(i => i.fontName).filter(f => f && !fontInfo.has(f)))];
    if (unknownFonts.length) {
      try { await page.getOperatorList(); } catch {}
      for (const f of unknownFonts) {
        let info = { b: false, i: false };
        try {
          if (page.commonObjs.has(f)) {
            const font = page.commonObjs.get(f);
            const name = String(font?.name || "");
            info = { b: /bold|black|heavy|semibold|demibold/i.test(name) || !!font?.bold || !!font?.black, i: /italic|oblique/i.test(name) || !!font?.italic };
          }
        } catch {}
        fontInfo.set(f, info);
      }
    }
    let text = "", lastY = null;
    // Positions are kept (only during import) for layouts where points sit beside their labels.
    const items = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      // Links, site names, print dates/times and page counters are left out (release dates of updates are kept).
      const str = scrubWeb(item.str);
      const webJunk = !str || isWebFurniture(str) && (/^\d/.test(str) || /history/i.test(str) || item.transform[4] > pageWidth * 0.7);
      if (item.str.trim() && webJunk) continue;
      if (str) {
        const x = item.transform[4], w = item.width || 0, s = Math.hypot(item.transform[2], item.transform[3]) || item.height || 0;
        const last = items[items.length - 1];
        const gap = last ? x - (last.x + last.w) : Infinity;
        // Rejoin fragments that sit side by side on the same line ("1" + "model" → "1 model").
        const top = offset + pageHeight - y;
        const fi = fontInfo.get(item.fontName) || { b: false, i: false };
        if (last && last.f === item.fontName && Math.abs(last.y - top) < 1.5 && gap > -1 && gap < Math.max(3, last.s * 0.6)) {
          last.t = last.t + (gap > last.s * 0.15 ? " " : "") + str;
          last.w = x + w - last.x;
        } else {
          items.push({ t: str, x, y: top, s, w, f: item.fontName, b: fi.b, it: fi.i, py: pageHeight - y, ph: pageHeight, pw: pageWidth });
        }
      }
      if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith("\n")) text += "\n";
      else if (text && !text.endsWith("\n") && !text.endsWith(" ") && item.str && !item.str.startsWith(" ")) text += " ";
      text += item.str.trim() ? str : item.str;
      if (item.hasEOL) text += "\n";
      lastY = y;
    }
    const cleaned = normalize(text.split("\n").map(l => scrubWeb(l)).filter(l => !isWebFurniture(l)).join("\n"));
    if (cleaned) pages.push({ number: n, text: cleaned, items });
    offset += pageHeight + 20;
    onPage(n, pdf.numPages);
  }
  let title = file.name.replace(/\.pdf$/i, "");
  try {
    const meta = await pdf.getMetadata();
    if (meta?.info?.Title?.trim()) title = meta.info.Title.trim();
  } catch {}
  return { title, pageCount: pdf.numPages, pages };
}

export { chunkPages, mostCommonSize, readingLines, readPdf };
