/* RulesForge · rules-viewer.js
 * Builds the content for a Core Rules or Updates document opened on its own: its numbered rules
 * grouped by chapter on the left, the selected one's full text on the right — the same left-list/
 * right-detail shell a faction or mission pack uses (factions.js calls into this).
 */
import { esc } from "./core.js?v=8.60";
import { richHTML, softenCaps } from "./text.js?v=8.60";

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
  const game = doc.pack?.game || doc.title;
  const edition = doc.pack?.game ? doc.pack.editionTag : "";
  return `<div class="fp-banner"><div class="fp-banner-text"><button type="button" class="btn plain fp-homelink" data-fp-home>‹ Back</button><div class="fp-banner-kicker">${doc.kind === "core" ? "Core Rules" : "Update"}</div>
    <div class="fp-banner-name">${esc(game)}</div>${edition ? `<div class="fp-banner-kicker">${esc(edition)}</div>` : ""}</div></div>`;
}

function rulesLeftHTML(doc, selKey) {
  const groups = sectionsGrouped(doc);
  // data-search covers the rule's full text, not just its title, so a search finds a word buried in
  // the body even when the heading itself doesn't mention it.
  const item = s => `<button type="button" class="fp-item${ruleKey(s) === selKey ? " on" : ""}" data-fp-rule="${esc(ruleKey(s))}" data-search="${esc(JSON.stringify(s).toLowerCase())}">
    <span class="fp-iname">${ruleLabelHTML(s)}</span></button>`;
  return groups.map(g => g.chapter
    ? `<details class="fp-grp" open><summary><span class="lb-grp-title">${esc(g.chapter)} · ${g.items.length}</span></summary><div class="fp-items">${g.items.map(item).join("")}</div></details>`
    : `<div class="fp-items">${g.items.map(item).join("")}</div>`).join("") + `<div class="fp-empty fp-search-none" hidden>Nothing matches your search.</div>`;
}

function rulesRightHTML(section) {
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  if (!section) return `<div class="fp-empty">Choose a rule on the left.</div>`;
  return `${back}<div class="fp-head"><h2>${ruleLabelHTML(section)}</h2>${section.chapter ? `<div class="fp-sub">${esc(section.chapter)}</div>` : ""}</div>
    <div class="fv-rich fp-text">${richHTML(section.rich || section.text)}</div>`;
}

export { ruleKey, sectionsGrouped, rulesBannerHTML, rulesLeftHTML, rulesRightHTML };
