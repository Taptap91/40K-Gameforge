/* RulesForge · pdf-reader.js
 * Reads a PDF's text with positions, using pdf.js (loaded only when a PDF is added).
 */
import { cleanGlyphs, isWebFurniture, normalize, scrubWeb } from "./text.js?v=8.13";

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
  const pages = [], bookIcons = [];
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
    // Detachments: the Force Disposition symbol printed beside "1DP" is a picture; it's recognised by its colour.
    if (items.some(i => /^\d+\s*DP$/i.test(i.t))) { try { await dispositionIcons(page, items, pageHeight); } catch {} }
    // The "Books" table on a faction's first pages has a small icon beside each book's name; keep those icons.
    if (n <= 3 && items.some(i => /^books$/i.test(i.t))) {
      try { bookIcons.push(...await bookTableIcons(page, items, pageHeight)); } catch {}
    }
    const cleaned = normalize(text.split("\n").map(l => scrubWeb(l)).filter(l => !isWebFurniture(l)).join("\n"));
    // Mission packs: pages with a Deployment card are also kept as a picture (the card is a map), for the import only.
    let image = null, scale = 0;
    if (/^DEPLOYMENT CARD$/m.test(cleaned)) {
      try {
        scale = 2; const vp = page.getViewport({ scale });
        const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        image = c.toDataURL("image/png");
      } catch { image = null; }
    }
    if (cleaned) pages.push({ number: n, text: cleaned, items, top: offset, ph: pageHeight, image, scale });
    offset += pageHeight + 20;
    onPage(n, pdf.numPages);
  }
  let title = file.name.replace(/\.pdf$/i, "");
  try {
    const meta = await pdf.getMetadata();
    if (meta?.info?.Title?.trim()) title = meta.info.Title.trim();
  } catch {}
  return { title, pageCount: pdf.numPages, pages, bookIcons };
}

/** Small images in a page's "Books" table, each paired with the name printed to its right: [{ name, image }]. */
async function bookTableIcons(page, items, pageHeight) {
  const ops = await page.getOperatorList(), OPS = pdfjs.OPS;
  const books = items.find(i => /^books$/i.test(i.t));
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [], found = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k], args = ops.argsArray[k];
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.paintImageXObject) {
      const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3]);
      const left = Math.min(m[4], m[4] + m[0]), top = pageHeight - Math.max(m[5], m[5] + m[3]);
      // Icon-sized (not photos or page backgrounds) and below the "Books" heading.
      if (w > 4 && w < 40 && h > 4 && h < 40 && top > books.py - 4) found.push({ id: args[0], left, right: left + w, mid: top + h / 2 });
    }
  }
  const out = [];
  for (const ic of found) {
    // The book's name: the nearest text to the right of the icon, on the same row.
    const name = items.filter(i => i.x >= ic.right - 1 && i.x - ic.right < 30 && Math.abs((i.py - i.s * 0.35) - ic.mid) < 8)
      .sort((a, b) => a.x - b.x)[0];
    if (!name || out.some(o => o.name === name.t)) continue;
    const img = await new Promise(res => {
      const objs = ic.id.startsWith("g_") ? page.commonObjs : page.objs;
      try { objs.has(ic.id) ? res(objs.get(ic.id)) : objs.get(ic.id, res); } catch { res(null); }
      setTimeout(() => res(null), 3000);
    });
    const image = img && iconToPng(img);
    if (image) out.push({ name: name.t, image });
  }
  return out;
}

/* The five Force Disposition symbols by colour: Take and Hold (green), Purge the Foe (red), Disruption (blue),
   Reconnaissance (teal), Priority Assets (gold). */
function dispositionByColour(img) {
  const w = img.width || img.bitmap?.width, h = img.height || img.bitmap?.height;
  if (!w || !h) return "";
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const px = g.createImageData(w, h), d = img.data, o = px.data, n = w * h;
    if (d.length >= n * 4) o.set(d.subarray ? d.subarray(0, n * 4) : d.slice(0, n * 4));
    else if (d.length >= n * 3) for (let i = 0; i < n; i++) { o[i * 4] = d[i * 3]; o[i * 4 + 1] = d[i * 3 + 1]; o[i * 4 + 2] = d[i * 3 + 2]; o[i * 4 + 3] = 255; }
    else return "";
    g.putImageData(px, 0, 0);
  } else return "";
  const d = g.getImageData(0, 0, w, h).data, bins = {};
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (a < 128 || mx - mn < 40 || mx < 60) continue;   // only clearly coloured pixels (not the white emblem or shadows)
    let hue = mx === r ? ((gg - b) / (mx - mn)) * 60 : mx === gg ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - gg) / (mx - mn)) * 60;
    if (hue < 0) hue += 360;
    const fd = hue < 22 || hue >= 330 ? "Purge the Foe" : hue < 65 ? "Priority Assets" : hue < 155 ? "Take and Hold" : hue < 185 ? "Reconnaissance" : hue < 270 ? "Disruption" : "";
    if (fd) bins[fd] = (bins[fd] || 0) + 1;
  }
  const best = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 12 ? best[0] : "";
}
/** Marks each detachment's "1DP" with the Force Disposition symbol(s) just left of it (item.fd = [names]). */
async function dispositionIcons(page, items, pageHeight) {
  const dps = items.filter(i => /^\d+\s*DP$/i.test(i.t));
  const ops = await page.getOperatorList(), OPS = pdfjs.OPS;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k], args = ops.argsArray[k];
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.paintImageXObject) {
      const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3]);
      if (w < 6 || w > 50 || h < 6 || h > 50) continue;
      const left = Math.min(m[4], m[4] + m[0]), right = left + w, mid = pageHeight - Math.max(m[5], m[5] + m[3]) + h / 2;
      // Icon-sized, ending just left of a "1DP" on the same row.
      const dp = dps.find(i => Math.abs((i.py - i.s * 0.35) - mid) < Math.max(10, h * 0.6) && i.x - right > -4 && i.x - right < 40);
      if (!dp) continue;
      const img = await new Promise(res => {
        const objs = String(args[0]).startsWith("g_") ? page.commonObjs : page.objs;
        try { objs.has(args[0]) ? res(objs.get(args[0])) : objs.get(args[0], res); } catch { res(null); }
        setTimeout(() => res(null), 3000);
      });
      const fd = img && dispositionByColour(img);
      if (fd) (dp.fd ||= []).includes(fd) || dp.fd.push(fd);
    }
  }
}

/** A decoded PDF image as a 96px PNG (scaled up smoothly; transparency kept). */
function iconToPng(img) {
  const w = img.width || img.bitmap?.width, h = img.height || img.bitmap?.height;
  if (!w || !h) return "";
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const sc = src.getContext("2d");
  if (img.bitmap) sc.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const px = sc.createImageData(w, h), d = img.data, o = px.data, n = w * h;
    if (d.length >= n * 4) o.set(d.subarray ? d.subarray(0, n * 4) : d.slice(0, n * 4));
    else if (d.length >= n * 3) for (let i = 0; i < n; i++) { o[i * 4] = d[i * 3]; o[i * 4 + 1] = d[i * 3 + 1]; o[i * 4 + 2] = d[i * 3 + 2]; o[i * 4 + 3] = 255; }
    else return "";
    sc.putImageData(px, 0, 0);
  } else return "";
  const k = 96 / Math.max(w, h), out = document.createElement("canvas");
  out.width = Math.round(w * k); out.height = Math.round(h * k);
  const oc = out.getContext("2d");
  oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = "high";
  oc.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export { chunkPages, mostCommonSize, readingLines, readPdf };
