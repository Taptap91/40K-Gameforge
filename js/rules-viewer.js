/* RulesForge · rules-viewer.js
 * Builds the content for a Core Rules or Updates document opened on its own: its numbered rules
 * grouped by chapter on the left, the selected one's full text on the right — the same left-list/
 * right-detail shell a faction or mission pack uses (factions.js calls into this).
 */
import { esc } from "./core.js?v=8.49";
import { richHTML, softenCaps } from "./text.js?v=8.49";

/** A section has no stable id of its own, so its number (or, when unnumbered, its title) stands in for one. */
const ruleKey = s => `${s.num || ""}|${s.title}`;

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

function rulesBannerHTML(doc) {
  const n = doc.structured.sections.length;
  return `<div class="fp-banner"><div class="fp-banner-text"><div class="fp-banner-kicker">${doc.kind === "core" ? "Core Rules" : "Update"}</div>
    <div class="fp-banner-name">${esc(doc.title)}</div><div class="fp-banner-counts"><span><b>${n}</b> Rule${n === 1 ? "" : "s"}</span></div></div></div>`;
}

function rulesLeftHTML(doc, selKey) {
  const groups = sectionsGrouped(doc);
  const item = s => `<button type="button" class="fp-item${ruleKey(s) === selKey ? " on" : ""}" data-fp-rule="${esc(ruleKey(s))}">
    <span class="fp-iname">${s.num ? esc(s.num) + " " : ""}${esc(softenCaps(s.title))}</span></button>`;
  return groups.map(g => g.chapter
    ? `<details class="fp-grp" open><summary><span class="lb-grp-title">${esc(g.chapter)} · ${g.items.length}</span></summary><div class="fp-items">${g.items.map(item).join("")}</div></details>`
    : `<div class="fp-items">${g.items.map(item).join("")}</div>`).join("");
}

function rulesRightHTML(section) {
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  if (!section) return `<div class="fp-empty">Choose a rule on the left.</div>`;
  return `${back}<div class="fp-head"><h2>${section.num ? esc(section.num) + " " : ""}${esc(softenCaps(section.title))}</h2>${section.chapter ? `<div class="fp-sub">${esc(section.chapter)}</div>` : ""}</div>
    <div class="fv-rich fp-text">${richHTML(section.rich || section.text)}</div>`;
}

export { ruleKey, sectionsGrouped, rulesBannerHTML, rulesLeftHTML, rulesRightHTML };
