/* RulesForge · rules-viewer.js
 * Builds the content for a Core Rules or Updates document opened on its own: its numbered rules
 * grouped by chapter on the left, the selected one's full text on the right — the same left-list/
 * right-detail shell a faction or mission pack uses (factions.js calls into this).
 */
import { esc } from "./core.js?v=8.74";
import { richHTML, softenCaps } from "./text.js?v=8.74";

/** A section has no stable id of its own, so its number (or, when unnumbered, its title) stands in for one. */
const ruleKey = s => `${s.num || ""}|${s.title}`;

/** When a subsection's title repeats its own position as a leading "N. " (e.g. num "02.03", title
 *  "3. Abilities"), that numbering is redundant once the "##.##" number is already shown, so it's
 *  dropped for display only — `ruleKey` above still uses the untouched title, so selection state,
 *  which depends on it, is unaffected. */
const displayTitle = s => s.num ? s.title.replace(/^\d+\.\s*/, "") : s.title;

/** A section's heading: its number in its own, unbolded span, then a dash with a little extra
 *  breathing room either side, then the (bold) title. Shared by the left list and the right header. */
const ruleLabelHTML = s => s.num
  ? `<span class="fp-rulenum">${esc(s.num)}</span><span class="fp-ruledash"> - </span>${esc(softenCaps(displayTitle(s)))}`
  : esc(softenCaps(displayTitle(s)));

/** Sections grouped by chapter, keeping the document's own order. */
/** What a rule's search matches: its title, chapter and full text, without the pack's picture markers or colour/bold markup
 *  (so searching "image" or "side" doesn't light up every rule that has a picture). */
const MARKUP = /\[(?:image|side|icon): [^\]]*\]|\[\/side\]|\{c:#[0-9a-f]{6}\||[{}*]/gi;
function ruleSearchText(s) {
  return Object.entries(s || {}).filter(([k, v]) => typeof v === "string" && k !== "rich").map(([, v]) => v).join(" ").replace(MARKUP, " ").replace(/\s+/g, " ").toLowerCase();
}

function sectionsGrouped(doc) {
  const groups = [];
  const byChapter = new Map();
  for (const s of doc.structured.sections) {
    const key = s.chapter || "";
    if (!byChapter.has(key)) { const g = { chapter: key, items: [] }; byChapter.set(key, g); groups.push(g); }
    byChapter.get(key).items.push(s);
  }
  return groups;
}

/** The banner's big title is the Game Pack's own game name (kept large, so it's easy to tell which
 *  screen you're on at a glance) with its edition as a small line underneath, matching the kicker's
 *  style — both come from the pack's own metadata rather than the document's title text, which may
 *  be phrased however the PDF it was converted from happened to be titled. A document opened outside
 *  a Game Pack (so with no pack metadata) falls back to showing its own title instead. */
function rulesBannerHTML(doc) {
  const game = doc.kind === "companion" || doc.kind === "collection" ? doc.title : doc.pack?.game || doc.title;   // a companion is named for itself, not the game
  const edition = doc.pack?.game ? doc.pack.editionTag : "";
  return `<div class="fp-banner fp-rulesbanner"><div class="fp-banner-text"><button type="button" class="btn plain fp-homelink" data-fp-home>‹ Back</button><div class="fp-banner-kicker">${doc.kind === "core" ? "Core Rules" : doc.kind === "companion" ? "Event Companion" : doc.kind === "collection" ? doc.section || "Reference" : "Update"}</div>
    <div class="fp-banner-name">${esc(game)}</div>${edition ? `<div class="fp-banner-kicker">${esc(edition)}</div>` : ""}</div></div>`;
}

/** A section's own row (its heading repeated as a rule) carries the text that sits between the heading and its first sub-rule. */
const isChapterRow = s => !!s.chapter && s.title === s.chapter && !s.num;

/** openCh: the sections whose dropdown is open (null = just the one holding the selected rule). A section with sub-rules is a
 *  dropdown whose header is itself clickable (it shows the section's own text); one without is a plain item. */
function rulesLeftHTML(doc, selKey, openCh = null) {
  const groups = sectionsGrouped(doc);
  // data-search covers the rule's full text, not just its title, so a search finds a word buried in
  // the body even when the heading itself doesn't mention it.
  const item = s => `<button type="button" class="fp-item${ruleKey(s) === selKey ? " on" : ""}" data-fp-rule="${esc(ruleKey(s))}" data-fp-chapter="${esc(s.chapter || "")}" data-search="${esc(ruleSearchText(s))}">
    <span class="fp-iname">${esc(softenCaps(displayTitle(s)))}</span></button>`;
  return groups.map(g => {
    const head = g.items.find(isChapterRow), kids = g.items.filter(s => s !== head);
    if (!g.chapter) return `<div class="fp-items">${g.items.map(item).join("")}</div>`;
    if (head && !kids.length) return `<div class="fp-items">${item(head)}</div>`;
    const open = openCh ? openCh.has(g.chapter) : g.items.some(s => ruleKey(s) === selKey);
    const title = `<span class="lb-grp-title">${esc(softenCaps(g.chapter))}</span>`;
    const summary = head
      ? `<summary class="fp-grp-click" data-fp-sect="${esc(g.chapter)}" data-search="${esc(ruleSearchText(head))}">${title}</summary>`
      : `<summary>${title}</summary>`;
    return `<details class="fp-grp"${open ? " open" : ""}>${summary}<div class="fp-items">${kids.map(item).join("")}</div></details>`;
  }).join("") + `<div class="fp-empty fp-search-none" hidden>Nothing matches your search.</div>`;
}

/** Text with "[image: images/x.png]" placeholder lines: the pictures sit in the pack's own images folder on GitHub and are shown
 *  in place between the paragraphs around them. */
const IMG_BASE = "https://raw.githubusercontent.com/Taptap91/40K-Gameforge/multi_gamepack-v2/packs/";
function bodyHTML(text, bundleId, keepCaps) {
  const base = bundleId ? IMG_BASE + bundleId + "/" : "";
  const rich = lines => richHTML(lines.join("\n"), { keepCaps, iconBase: base });
  const imgTag = f => `<img class="fp-img" loading="lazy" alt="" data-b="${esc(bundleId)}" data-img="${esc(f.split("/").pop())}" src="${esc(base + f)}">`;
  if (bundleId) layoutFor(bundleId);
  const bare = l => l.replace(/\{c:#[0-9a-fA-F]{6}\||[*}]/g, "").trim();
  // Q:/A: blocks sit in a quiet box (the colour of the boxes on the left, not clickable): Q: in bold, A: in bold orange
  const qaHTML = lines => {
    const segs = [];
    lines.forEach(l => {
      // a Q:/A: line that came through wholly bold (e.g. "**A: Yes.**") is still a Q/A line, not a bold sub-heading
      if (/^\*\*(?:Q|A):[^*]*\*\*$/.test(l.trim())) l = l.trim().slice(2, -2);
      const q = /^Q:/.test(bare(l)), head = /^\*\*[^*]+\*\*$/.test(l.trim());
      const last = segs[segs.length - 1];
      if (q) segs.push({ qa: true, lines: [l] });
      else if (last && last.qa && !head) last.lines.push(l);
      else if (last && !last.qa) last.lines.push(l);
      else segs.push({ qa: false, lines: [l] });
    });
    return segs.map(g => {
      const h = rich(g.lines);
      if (!g.qa) return h;
      const mark = x => x.replace(/<p>((?:<[^>]+>)*)(Q|A):/g, (_, w, k) => `<p>${w}<span class="rf-lab rf-lab-${k.toLowerCase()}">${k}:</span>`);
      const at = g.lines.findIndex(l => /^A:/.test(bare(l)));   // the question sits on a lighter band, the answer below it
      if (at < 1) return `<div class="rf-qa"><div class="rf-a">${mark(h)}</div></div>`;
      return `<div class="rf-qa"><div class="rf-q">${mark(rich(g.lines.slice(0, at)))}</div><div class="rf-a">${mark(rich(g.lines.slice(at)))}</div></div>`;
    }).join("");
  };
  // Line breaks come from the PDF's own column width, so a line that stops mid-sentence is joined to the next one: where text wraps is up to the screen.
  // Breaks after a finished sentence stay, and so do bullets, numbered lines, Q:/A: labels, bold-only lines and short title lines.
  const endsSentence = t => /[.!?:;]['"”’)\]]*$/.test(t) && !/\b(?:e\.g|i\.e|etc|vs|approx)\.$/i.test(t);
  const joinWraps = lines => lines.reduce((out, l) => {
    const t = bare(l), pv = out.length ? bare(out[out.length - 1]) : "";
    const keep = !out.length || /^\u2063/.test(l.trim()) || !t || !pv || /^\*\*[^*]+\*\*$/.test(l.trim()) || /^\*\*[^*]+\*\*$/.test(out[out.length - 1].trim())
      || /^(?:•|[QA]:|\d+[.)]\s)/.test(t) || endsSentence(pv) || /^\[/.test(l.trim())
      || !(pv.length >= 40 || /^[a-z]/.test(t));
    if (keep) out.push(l); else out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "") + " " + l.replace(/^\s+/, "");
    return out;
  }, []);
  // A lone number line ("1") with a bold line under it is a numbered point: the number moves onto the bold line, in a small circle.
  const joinNums = lines => lines.reduce((out, l, i, all) => {
    if (out.skip === i) return out;
    const n = /^\d{1,2}$/.exec(bare(l));
    if (n && i + 1 < all.length && all[i + 1].trim().startsWith("**")) { out.push(`\u2063${n[0]}\u2063 ${all[i + 1].trim()}`); out.skip = i + 1; }
    else out.push(l);
    return out;
  }, []);
  let html = "", chunk = [], side = null;
  const flush = () => { if (chunk.length) html += qaHTML(joinWraps(joinNums(chunk))); chunk = []; };
  for (const line of String(text || "").split("\n")) {
    const t = line.trim(), im = /^\[image: (.+?)\]$/.exec(t), sd = /^\[side: (.+?)\]$/.exec(t);
    if (sd) { flush(); side = sd[1]; continue; }
    if (t === "[/side]") {
      const body = chunk.length ? qaHTML(joinWraps(joinNums(chunk))) : ""; chunk = [];
      html += `<div class="fp-side">${bundleId && side ? imgTag(side) : ""}<div class="fp-side-text">${body}</div></div>`;
      side = null; continue;
    }
    if (!im) { chunk.push(line); continue; }
    flush();
    if (bundleId) html += imgTag(im[1]);
  }
  flush();
  return html.replace(/\u2063(\d+)\u2063/g, '<span class="rf-num">$1</span>');
}

/* A pack can carry a layout.json beside its workbook: { "images": { "Core_Rules-p2-1.png": { "scale": 70, "row": "a" } } }.
 * "scale" is a percentage of the size the picture would otherwise show at; pictures that share a "row" sit side by side.
 * It is kept apart from the workbook so re-converting the PDF does not lose it. */
const layouts = {};
function layoutFor(bundleId) {
  if (bundleId in layouts) return layouts[bundleId];
  layouts[bundleId] = null;
  fetch(IMG_BASE + bundleId + "/layout.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(j => { layouts[bundleId] = j || {}; applyLayouts(); });
  return null;
}
function applyLayout(img) {
  const e = layouts[img.dataset.b]?.images?.[img.dataset.img];
  const sc = Math.max(5, Math.min(100, +e?.scale || 100)) / 100;
  if (img.closest(".fp-side")) { img.style.setProperty("--sc", sc); return; }
  if (!img.naturalWidth) return;
  // phones: a large picture on its own fills the line (the desktop percentages would make diagrams unreadable), but a small one (a screenshot-sized picture) keeps its percentage
  if (matchMedia("(max-width: 760px)").matches && img.naturalWidth > 520) { img.style.width = ""; return; }
  const box = img.parentElement.clientWidth || img.naturalWidth;
  img.style.width = Math.round(Math.min(img.naturalWidth, box) * sc) + "px";
}
function applyLayouts(root = document) {
  const imgs = [...root.querySelectorAll("img.fp-img[data-img]")];
  const byRow = new Map();
  imgs.forEach(img => {
    const row = layouts[img.dataset.b]?.images?.[img.dataset.img]?.row;
    if (!row || img.closest(".fp-side") || img.closest(".fp-imgrow")) return;
    const key = img.parentElement;
    if (!byRow.has(key)) byRow.set(key, new Map());
    const m = byRow.get(key);
    if (!m.has(row)) m.set(row, []);
    m.get(row).push(img);
  });
  byRow.forEach(m => m.forEach(list => {
    if (list.length < 2) return;
    const wrap = document.createElement("div");
    wrap.className = "fp-imgrow";
    list[0].before(wrap);
    list.forEach(i => wrap.appendChild(i));
  }));
  imgs.forEach(img => applyLayout(img));
}
if (typeof document !== "undefined") {
  document.addEventListener("load", ev => { const t = ev.target; if (t && t.matches && t.matches("img.fp-img[data-img]")) { applyLayouts(t.closest(".fp-text") || document); } }, true);
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => applyLayouts(), 120); });
}

/** Previous / Next rule buttons under a rule (shown on phones and tablets, where reading rule after rule means going back to the list otherwise). */
function pagerHTML(section, doc) {
  const flat = doc?.structured?.sections ? sectionsGrouped(doc).flatMap(g => g.items.filter(x => !(isChapterRow(x) && g.items.length > 1))) : [];
  const i = flat.findIndex(x => ruleKey(x) === ruleKey(section));
  if (i < 0 || flat.length < 2) return "";
  const btn = (x, dir) => x ? `<button type="button" class="fp-pg fp-pg-${dir}" data-fp-rule="${esc(ruleKey(x))}" data-fp-chapter="${esc(x.chapter || "")}"><span class="fp-pg-dir">${dir === "prev" ? "‹ Previous" : "Next ›"}</span><span class="fp-pg-name">${ruleLabelHTML(x)}</span></button>` : `<span></span>`;
  return `<nav class="fp-pager" aria-label="Rule navigation">${btn(flat[i - 1], "prev")}${btn(flat[i + 1], "next")}</nav>`;
}

function rulesRightHTML(section, doc) {
  if (!section) return `<div class="fp-empty">Choose a rule on the left.</div>`;
  // The first rule of a section opens with the section's own text (its intro), above the rule itself.
  let intro = "";
  const grp = doc?.structured?.sections ? sectionsGrouped(doc).find(g => g.chapter && g.chapter === section.chapter) : null;
  const head = grp && grp.items.find(isChapterRow), kids = grp ? grp.items.filter(x => x !== head) : [];
  if (head && kids.length && kids[0] === section && String(head.rich || head.text || "").trim()) {
    intro = `<div class="fp-intro"><h3 class="fp-intro-title">${esc(head.chapter)}</h3><div class="fv-rich fp-text">${bodyHTML(head.rich || head.text, doc?.pack?.bundleId, !!doc?.pack?.game && !/warhammer 40/i.test(doc.pack.game))}</div></div>`;
  }
  return `${intro}<div class="fp-head"><h2>${ruleLabelHTML(section)}</h2>${section.chapter && !isChapterRow(section) ? `<div class="fp-sub">${esc(section.chapter)}</div>` : ""}</div>
    <div class="fv-rich fp-text">${bodyHTML(section.rich || section.text, doc?.pack?.bundleId, !!doc?.pack?.game && !/warhammer 40/i.test(doc.pack.game))}</div>${pagerHTML(section, doc)}`;
}

export { ruleKey, sectionsGrouped, rulesBannerHTML, rulesLeftHTML, rulesRightHTML };
