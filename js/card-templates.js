/* RulesForge · card-templates.js
 * How a datacard looks, per game. A card is plain data (name, type, flavour, stats, weapons, abilities, keywords...) that the converter reads
 * from a PDF tagged in PDF Studio with that game's style; the card's "tpl" says which template below draws it. Adding a game:
 *   1. PDF Studio: add the game to PROFILES (how Tag All finds its cards).
 *   2. tagged-rules.js buildCards: fill the same card fields from the tagged parts (set card.tpl to the game's id).
 *   3. Here: add a function that returns the card's HTML and register it in CARD_TEMPLATES, then add its CSS to styles.css.
 * Warhammer 40,000 has no entry: its datasheets are read by the app's own parser (datasheets.js), not as cards.
 */
import { esc } from "./core.js?v=8.81";

/** A Kill Team datacard: title bar (name, type), italic flavour, stat tiles in a row, weapons table, abilities, then the keywords (the base size is read but not shown). */
function killTeamCard(c) {
  const wr = t => String(t || "").split(/\s*,\s*/).filter(Boolean).map(r => `<button type="button" class="rf-wr" data-wr="${esc(r)}">${esc(r)}</button>`).join(", ");
  const stats = (c.stats || []).map(([l, v]) => `<div class="rf-dc-stat"><span class="rf-dc-sl">${esc(l)}</span><span class="rf-dc-sv">${esc(v)}</span></div>`).join("");
  const weapons = (c.weapons || []).length ? `<div class="rf-dc-wt"><div class="rf-dc-wr rf-dc-wh"><span>Name</span><span>ATK</span><span>HIT</span><span>DMG</span><span>WR</span></div>${c.weapons.map(w =>
    `<div class="rf-dc-wr"><span class="rf-dc-wn">${esc(w.n)}</span><span>${esc(w.a)}</span><span>${esc(w.h)}</span><span>${esc(w.d)}</span><span class="rf-dc-wrs">${wr(w.w)}</span></div>`).join("")}</div>` : "";
  const abil = (c.abilities || []).map(a => `<p class="rf-dc-ab">${a.n ? `<b>${esc(a.n)}:</b> ` : ""}${esc(a.t)}</p>`).join("");
  const kws = String(c.keywords || "").split(/\s*,\s*/).filter(Boolean).map(k => c.hot && k.toLowerCase() === c.hot.toLowerCase() ? `<span class="rf-dc-hot">${esc(k)}</span>` : esc(k)).join(", ");
  const foot = kws ? `<div class="rf-dc-foot"><span class="rf-dc-kw">${kws}</span></div>` : "";   // the base size is read into the card but not shown
  return `<div class="rf-dc"><div class="rf-dc-bar"><span class="rf-dc-name">${esc(c.name)}</span><span class="rf-dc-type">${esc(c.type || "")}</span></div>${c.flavour ? `<p class="rf-dc-fl">${esc(c.flavour)}</p>` : ""}<div class="rf-dc-stats">${stats}</div>${weapons}${abil}${foot}</div>`;
}

const CARD_TEMPLATES = { killteam: killTeamCard };
/** Draws a card with the template its "tpl" names (Kill Team when it names none). */
const renderCard = c => (CARD_TEMPLATES[c.tpl || "killteam"] || killTeamCard)(c);

export { CARD_TEMPLATES, renderCard };
