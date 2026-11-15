/* RulesForge · map-crop.js
 * Every battle map (a Game Pack's deployment cards, the terrain layouts in Battle setup) is cropped to the
 * board itself, so each one fills its frame the same way whether its picture carries rulers top and bottom,
 * left and right, or a name banner. The board is found from its dark outline: the first and last long dark
 * lines across and down the picture. Nothing is stretched. A picture marked data-board-crop is swapped for
 * its cropped copy the moment it has loaded.
 */
const DARK = 150, LINE = 0.35, MAX_OUT = 760;
const cache = new Map();

/** First and last rows (or columns) of the board's outline: a long dark line at least 3px thick. Thin dark
 *  lines (rulers, centre lines) are skipped, so they can't be mistaken for the board's edge. */
function span(counts, need) {
  const hits = []; for (let i = 0; i < counts.length; i++) if (counts[i] > need) hits.push(i);
  if (hits.length < 2) return null;
  const groups = []; let g = [hits[0], hits[0]];
  for (const i of hits.slice(1)) { if (i - g[1] > 3) { groups.push(g); g = [i, i]; } else g[1] = i; }
  groups.push(g);
  const thick = groups.filter(x => x[1] - x[0] >= 2);
  const use = thick.length >= 2 ? thick : groups;
  return [use[0][0], use[use.length - 1][1]];
}

function boardBox(img) {
  const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data, rows = new Int32Array(h), cols = new Int32Array(w);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) if (d[i] + d[i + 1] + d[i + 2] < DARK) { rows[y]++; cols[x]++; }
  const ys = span(rows, LINE * w), xs = span(cols, LINE * h);
  if (!xs || !ys || xs[1] - xs[0] < w * 0.4 || ys[1] - ys[0] < h * 0.4) return null;
  return { c, x: Math.max(0, xs[0] - 2), y: Math.max(0, ys[0] - 2), w: Math.min(w, xs[1] + 3) - Math.max(0, xs[0] - 2), h: Math.min(h, ys[1] + 3) - Math.max(0, ys[0] - 2) };
}

function crop(img) {
  const src = img.currentSrc || img.src;
  const done = url => { if (url) img.src = url; img.dataset.cropped = "1"; };
  if (cache.has(src)) return done(cache.get(src));
  try {
    const b = boardBox(img);
    if (!b) return done(null);
    const k = Math.min(1, MAX_OUT / b.w), out = document.createElement("canvas");
    out.width = Math.round(b.w * k); out.height = Math.round(b.h * k);
    out.getContext("2d").drawImage(b.c, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/jpeg", 0.92);
    cache.set(src, url); cache.set(url, url);
    done(url);
  } catch { done(null); }   // an unreadable picture just shows uncropped
}

function handle(img) {
  if (img.dataset.cropped) return;
  if (img.complete && img.naturalWidth) crop(img); else img.addEventListener("load", () => { if (!img.dataset.cropped) crop(img); }, { once: true });
}

if (typeof document !== "undefined") {
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.("img[data-board-crop]")) handle(n);
      n.querySelectorAll?.("img[data-board-crop]").forEach(handle);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
export {};
