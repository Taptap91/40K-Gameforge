/* RulesForge · text.js
 * Text clean-up and formatting: titles, keywords, rich text (**bold**) and simple Markdown.
 */
import { esc } from "./core.js?v=6.5";

function normalize(raw) {
  return raw
    .replace(/\r/g, "\n")
    .replace(/­/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}/* Reads a Wahapedia-style faction PDF (datasheets + detachments) into compact records.
   Works on positioned text from all pages laid end to end, so page breaks don't matter.
   Items: { t: text, x, y: top-down position across the whole document, s: font size }. */

const letterCount = s => (s.match(/[A-Za-z]/g) || []).length;
const isUpperText = s => letterCount(s) >= 2 && s === s.toUpperCase();
const isStatValue = s => /^(\d+["+]?|-|\d+\+|N\/A|\*|D\d+(\+\d+)?|\d*D\d+(\+\d+)?)$/i.test(s);
/** Rejoins apostrophes a PDF split off ("NURGLE ’ S GIFT" → "NURGLE’S GIFT", "Nurgle ’ S" → "Nurgle’s"). */
const fixApostrophes = s => String(s ?? "").replace(/(\p{L})(?:\s+(['’])\s*|(['’])\s+)(s|t|re|ve|ll|d|m)(?![\p{L}])/giu,
  (m, a, q1, q2, suf) => a + (q1 || q2) + (a === a.toUpperCase() && a !== a.toLowerCase() ? suf : suf.toLowerCase()))
  // "Ka’Tah" → "Ka’tah" (a capital after an apostrophe only follows a one-letter start, as in N’Kari).
  .replace(/(\p{L}{2,}['’])(\p{Lu})(\p{Ll}{2,})/gu, (m, a, b, c) => a + b.toLowerCase() + c);
const cleanGlyphs = s => fixApostrophes(s.replace(/[-⌘✦◆]/g, "").replace(/\s+/g, " ").trim());
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
const titleCase = s => (s = fixApostrophes(s)) === s.toUpperCase()
  ? s.toLowerCase().replace(/(^|[\s\-([])(\w+)/g, (m, a, w, i) => a + (i > 0 && a === " " && SMALL_WORDS.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
      .replace(/(?<![\w'’])(\w['’])([a-z])([a-z]{2,})/g, (m, a, b, c) => a + b.toUpperCase() + c)   // N’Kari, O’Brien
  : s;
/** Keyword lists: "INFANTRY; CHARACTER" → "INFANTRY, CHARACTER" (always capitals). */
const upperKeywords = s => String(s || "").split(/[;,]/).map(k => k.trim()).filter(Boolean).join(", ").toUpperCase();

/** Joins wrapped lines into paragraphs; "Name: …" lines and bullets start new ones. */
function joinParagraphs(lines) {
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const startsNew = !out.length || /^(WHEN|TARGET|EFFECT|RESTRICTIONS)\s*:/i.test(t) || /^[•■▪\-–]\s/.test(t) ||
      /^[A-Z][A-Za-z'’ ,()\-]{1,60}( \([^)]*\))?:\s/.test(t) || /^\d+\s+[A-Z]/.test(t) && out[out.length - 1].endsWith(".");
    if (startsNew) out.push(t);
    else out[out.length - 1] = out[out.length - 1].replace(/-$/, "") + (out[out.length - 1].endsWith("-") ? "" : " ") + t;
  }
  return out.join("\n");
}

/** Joins wrapped lines into separate items (bullet points, "1 Sergeant model", sentences). */
function itemize(lines) {
  const out = [];
  for (const raw of lines) {
    const bullet = /^[•■▪\-–]\s*/.test(raw);
    const t = raw.replace(/^[•■▪\-–]\s*/, "").trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    const startsNew = !prev || bullet || /[.:!]$/.test(prev) ||
      /^(\d+(-\d+)?\s|Every |This |For every |Any |Each |Up to |One |If |The |All )/.test(t);
    if (startsNew) out.push(t); else out[out.length - 1] = prev + " " + t;
  }
  return out;
}
const stripRich = s => String(s || "").replace(/\*\*/g, "");/** Rich text (**bold**, "• " bullets, \n paragraphs) → HTML. */
/** Keywords printed in capitals ("DEATH GUARD INFANTRY model only") shown with capital first letters ("Death Guard Infantry"). */
const KEEP_CAPS = new Set(["CP", "OC", "AP", "WS", "BS", "HQ", "VP", "DP", "FNP", "OK", "II", "III", "IV", "AM", "PM"]);
const softenCaps = s => fixApostrophes(s).replace(/(?<![\w’'])[A-Z][A-Z’'-]+(?:(?:\s+|\s*\/\s*)[A-Z][A-Z’'-]+)*(?![\w’'])/g,
  m => (!/\s|\//.test(m) && KEEP_CAPS.has(m)) ? m : m.split(/(\s*\/\s*)/).map(p => /^\s*\/\s*$/.test(p) ? p : titleCase(p).replace(/\b(Cp|Oc|Ap|Ws|Bs|Hq|Vp|Dp|Fnp)\b/g, w => w.toUpperCase())).join(""));

/** Weapon names with capital first letters: "Plague knife – strike" → "Plague Knife – Strike". */
const capWords = s => String(s ?? "").replace(/(^|[\s(\/–-])([a-z])([\w’']*)/g, (m, a, c, rest) => a + ((a === " " && SMALL_WORDS.has(c + rest)) ? c : c.toUpperCase()) + rest);

function richHTML(text) {
  const inline = t => esc(softenCaps(t).replace(/(\w) +([,.;:])(?=\s|$)/g, "$1$2")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let html = "", list = false;
  for (const line of String(text || "").split("\n").filter(l => l.trim())) {
    if (line.startsWith("• ")) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}
const keywordList = s => String(s || "").split(/\s*,\s*/).filter(Boolean);
const niceKeywords = s => keywordList(s).map(k => titleCase(k.toUpperCase())).sort((a, b) => a.localeCompare(b)).join(", ");const STOP = new Set("a an and are as at be but by can do does for from has have how i if in into is it its my of on or so that the their them then there this to was what when where which while who will with you your would could should".split(" "));
/* A light stemmer, so "shooting", "shoots" and "shoot" match, as do "advanced", "advancing" and "advance". */
function stem(w) {
  if (/^\d/.test(w)) return w;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  const cut = w.match(/^(.{3,}?)(ing|ed)$/);
  if (cut) { w = cut[1]; if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1); }
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}
function tokens(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}+]+/gu) || [])
    .filter(t => t.length >= 2 && !STOP.has(t))
    .map(stem);
}
function normName(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[(\d{1,2})\]/g, '<span class="cite" data-n="$1">$1</span>');
}
function md(text) {
  let out = "", list = null;
  for (const raw of esc(text).split("\n")) {
    const ul = raw.match(/^\s*[-*•]\s+(.*)/), ol = raw.match(/^\s*\d+[.)]\s+(.*)/);
    const type = ul ? "ul" : ol ? "ol" : null;
    if (type) {
      if (list !== type) { if (list) out += `</${list}>`; out += `<${type}>`; list = type; }
      out += `<li>${inlineMd((ul || ol)[1])}</li>`;
      continue;
    }
    if (list) { out += `</${list}>`; list = null; }
    if (!raw.trim()) continue;
    // Section headers: "## Title", a line that is entirely **bold**, or a short "Title:" line.
    const h = raw.match(/^#{1,4}\s+(.*)/) || raw.match(/^\s*\*\*([^*]+?)\*\*:?\s*$/) || raw.match(/^\s*([A-Z][^.!?\[\]]{2,50}):\s*$/);
    out += h ? `<h4 class="ans-h">${inlineMd(h[1].replace(/\*\*/g, "").replace(/:$/, ""))}</h4>` : `<p>${inlineMd(raw)}</p>`;
  }
  if (list) out += `</${list}>`;
  return out;
}


/* Website furniture in printed or exported PDFs: links, site names, the browser's print date and time, page counters.
 * Dates that say when an update was released ("Updated 01/10/2026", "October 2026") are kept. */
const RELEASE_LABEL = /(updated?|effective|published|release[sd]?|version|revised|errata|dataslate)\W{0,3}(\w+\W{0,3}){0,2}$/i;
function scrubWeb(s) {
  return String(s || "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|ru|io|co\.uk|info|app|gg|de|fr)\b(?:\/\S*)?/gi, " ")
    .replace(/\bwahapedia\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b,?(\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\.?M\b\.?)?)?/gi, (m, _t, at, all) =>
      RELEASE_LABEL.test(all.slice(Math.max(0, at - 40), at)) ? m.replace(/,?\s+\d{1,2}:\d{2}.*$/, "") : " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*[AP]\.?M\b\.?/gi, " ")
    .replace(/[ \t]{2,}/g, " ").trim();
}
/** True for a line that is only website furniture: a page counter ("12/92") or a web page's "Show History" button. */
const isWebFurniture = s => /^(\d+\s*\/\s*\d+|show history|show|hide)$/i.test(String(s || "").trim());

export { fixApostrophes, scrubWeb, isWebFurniture, capWords, cleanGlyphs, softenCaps, isStatValue, isUpperText, itemize, joinParagraphs, keywordList, letterCount, md, niceKeywords, normalize, normName, richHTML, stripRich, titleCase, tokens, upperKeywords };
