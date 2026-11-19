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
  return `<div class="fp-banner"><div class="fp-banner-text"><button type="button" class="btn plain fp-homelink" data-fp-home>‹ Back</button><div class="fp-banner-kicker">${doc.kind === "core" ? "Core Rules" : doc.kind === "companion" ? "Event Companion" : doc.kind === "collection" ? doc.section || "Reference" : "Update"}</div>
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
  const item = s => `<button type="button" class="fp-item${ruleKey(s) === selKey ? " on" : ""}" data-fp-rule="${esc(ruleKey(s))}" data-fp-chapter="${esc(s.chapter || "")}" data-search="${esc(JSON.stringify(s).toLowerCase())}">
    <span class="fp-iname">${ruleLabelHTML(s)}</span></button>`;
  return groups.map(g => {
    const head = g.items.find(isChapterRow), kids = g.items.filter(s => s !== head);
    if (!g.chapter) return `<div class="fp-items">${g.items.map(item).join("")}</div>`;
    if (head && !kids.length) return `<div class="fp-items">${item(head)}</div>`;
    const open = openCh ? openCh.has(g.chapter) : g.items.some(s => ruleKey(s) === selKey);
    const title = `<span class="lb-grp-title">${esc(softenCaps(g.chapter))} · ${kids.length}</span>`;
    const summary = head
      ? `<summary class="fp-grp-click${ruleKey(head) === selKey ? " on" : ""}" data-fp-rule="${esc(ruleKey(head))}" data-fp-chapter="${esc(g.chapter)}" data-fp-head>${title}</summary>`
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
  const bare = l => l.replace(/\{c:#[0-9a-fA-F]{6}\||[*}]/g, "").trim();
  // Q:/A: blocks sit in a quiet box (the colour of the boxes on the left, not clickable): Q: in bold, A: in bold orange
  const qaHTML = lines => {
    const segs = [];
    lines.forEach(l => {
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
      const lab = h.replace(/<p>((?:<[^>]+>)*)(Q|A):/g, (_, w, k) => `<p>${w}<span class="rf-lab rf-lab-${k.toLowerCase()}">${k}:</span>`);
      return `<div class="rf-qa">${lab}</div>`;
    }).join("");
  };
  let html = "", chunk = [], side = null;
  const flush = () => { if (chunk.length) html += qaHTML(chunk); chunk = []; };
  for (const line of String(text || "").split("\n")) {
    const t = line.trim(), im = /^\[image: (.+?)\]$/.exec(t), sd = /^\[side: (.+?)\]$/.exec(t);
    if (sd) { flush(); side = sd[1]; continue; }
    if (t === "[/side]") {
      const body = chunk.length ? qaHTML(chunk) : ""; chunk = [];
      html += `<div class="fp-side">${bundleId && side ? `<img class="fp-img" loading="lazy" alt="" src="${esc(base + side)}">` : ""}<div class="fp-side-text">${body}</div></div>`;
      side = null; continue;
    }
    if (!im) { chunk.push(line); continue; }
    flush();
    if (bundleId) html += `<img class="fp-img" loading="lazy" alt="" src="${esc(base + im[1])}">`;
  }
  flush();
  return html;
}

function rulesRightHTML(section, doc) {
  if (!section) return `<div class="fp-empty">Choose a rule on the left.</div>`;
  return `<div class="fp-head"><h2>${ruleLabelHTML(section)}</h2>${section.chapter && !isChapterRow(section) ? `<div class="fp-sub">${esc(section.chapter)}</div>` : ""}</div>
    <div class="fv-rich fp-text">${bodyHTML(section.rich || section.text, doc?.pack?.bundleId, !!doc?.pack?.game && !/warhammer 40/i.test(doc.pack.game))}</div>`;
}

export { ruleKey, sectionsGrouped, rulesBannerHTML, rulesLeftHTML, rulesRightHTML };
