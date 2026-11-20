/* RulesForge · card-templates.js
 * How a datacard looks, per game. A card is plain data (name, type, flavour, stats, weapons, abilities, keywords...) that the converter reads
 * from a PDF tagged in PDF Studio with that game's style; the card's "tpl" says which template below draws it. Adding a game:
 *   1. PDF Studio: add the game to PROFILES (how Tag All finds its cards).
 *   2. tagged-rules.js buildCards: fill the same card fields from the tagged parts (set card.tpl to the game's id).
 *   3. Here: add a function that returns the card's HTML and register it in CARD_TEMPLATES, then add its CSS to styles.css.
 * Warhammer 40,000 has no entry: its datasheets are read by the app's own parser (datasheets.js), not as cards.
 */
import { esc } from "./core.js?v=8.85";
import { richHTML } from "./text.js?v=8.85";

/** A Kill Team datacard: title bar (name, type), italic flavour, stat tiles in a row, weapons table, abilities, then the keywords (the base size is read but not shown). */
function killTeamCard(c) {
  const wr = t => String(t || "").split(/\s*,\s*/).filter(Boolean).map(r => `<button type="button" class="rf-wr" data-wr="${esc(r)}">${esc(r)}</button>`).join(", ");
  const stats = (c.stats || []).map(([l, v]) => `<div class="rf-dc-stat"><span class="rf-dc-sl">${esc(l)}</span><span class="rf-dc-sv">${esc(v)}</span></div>`).join("");
  const weapons = (c.weapons || []).length ? `<div class="rf-dc-wt"><div class="rf-dc-wr rf-dc-wh"><span>Name</span><span>ATK</span><span>HIT</span><span>DMG</span><span class="rf-dc-wrs">WR</span></div>${c.weapons.map(w =>
    `<div class="rf-dc-wr"><span class="rf-dc-wn">${esc(w.n)}</span><span>${esc(w.a)}</span><span>${esc(w.h)}</span><span>${esc(w.d)}</span><span class="rf-dc-wrs">${wr(w.w)}</span></div>`).join("")}</div>` : "";
  const abil = (c.abilities || []).map(a => `<p class="rf-dc-ab">${a.n ? `<b>${esc(a.n)}:</b> ` : ""}${esc(a.t)}</p>`).join("");
  const kws = String(c.keywords || "").split(/\s*,\s*/).filter(Boolean).map(k => c.hot && k.toLowerCase() === c.hot.toLowerCase() ? `<span class="rf-dc-hot">${esc(k)}</span>` : esc(k)).join(", ");
  const foot = kws ? `<div class="rf-dc-foot"><span class="rf-dc-kw">${kws}</span></div>` : "";   // the base size is read into the card but not shown
  return `<div class="rf-dc"><div class="rf-dc-bar"><span class="rf-dc-name">${esc(c.name)}</span><span class="rf-dc-type">${esc(c.type || "")}</span></div>${c.flavour ? `<p class="rf-dc-fl">${esc(c.flavour)}</p>` : ""}<div class="rf-dc-stats">${stats}</div>${weapons}${abil}${foot}</div>`;
}

/** The dusty colour an Age of Sigmar ability takes from the phase it works in. */
const PHASE_COLOURS = [[/hero/i, "#9a8444"], [/movement/i, "#6f7173"], [/shoot/i, "#4f7394"], [/charge/i, "#a86d3b"], [/combat|fight/i, "#8c3b3b"], [/end/i, "#705c8a"]];
const phaseColour = phase => (PHASE_COLOURS.find(([re]) => re.test(String(phase || ""))) || [0, "#5f8050"])[1];

/** An Age of Sigmar ability (a rules ability, or one on a warscroll): phase bar with the command point cost at the right, name and italic flavour, Declare / Effect lines
 *  split by a short rule, keywords. The bar and border take the colour of the phase. */
function aosAbility(c) {
  const parts = [`<p class="rf-ab-nm"><b>${esc(c.name || "")}:</b> ${c.flavour ? `<i>${esc(c.flavour)}</i>` : ""}</p>`,
    ...(c.lines || []).map(([k, v]) => `<p class="rf-ab-ln"><b>${esc(k)}:</b> ${richHTML(String(v || ""), {}).replace(/^<p>|<\/p>$/g, "")}</p>`)];
  const kws = String(c.keywords || "").split(/\s*,\s*/).filter(Boolean).join(", ");
  const cp = String(c.cp || "").trim();
  return `<div class="rf-ab" style="--ph:${phaseColour(c.phase)}"><div class="rf-ab-bar"><span>${esc(c.phase || "")}</span>${cp ? `<span class="rf-ab-cp">${esc(/^\d+$/.test(cp) ? cp + " CP" : cp)}</span>` : ""}</div><div class="rf-ab-body">${parts.join('<hr class="rf-ab-sep">')}</div>${kws ? `<div class="rf-ab-kw"><span class="rf-ab-kl">Keywords</span><span class="rf-ab-kv">${esc(kws)}</span></div>` : ""}</div>`;
}

/** Lifts a faction's panel colour (dark, as printed) to one that reads as a border on a dark page: same hue, softer, lighter. "" when it is not a colour. */
function accentOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return "";
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return `hsl(${Math.round(h * 60)}, ${Math.round(Math.min(s, 0.5) * 100)}%, 40%)`;
}

/** An Age of Sigmar warscroll: kicker and name, flavour, stat tiles in a row (Move, Health, Save, Control), weapons table, battle profile, abilities, keywords. */
function aosWarscroll(c) {
  const wr = n => n ? `<button type="button" class="rf-wr" data-wr="${esc(String(n).replace(/\s*\(.*$/, ""))}">${esc(n)}</button>` : "";
  const stats = (c.stats || []).map(([l, v]) => `<div class="rf-aw-stat"><span class="rf-aw-sl">${esc(l)}</span><span class="rf-aw-sv">${esc(v)}</span></div>`).join("");
  const head = g => `<div class="rf-aw-wr rf-aw-wh"><span>${esc(g || "Weapons")}</span><span>ATK</span><span>HIT</span><span>WND</span><span>RND</span><span>DMG</span></div>`;
  let last = null, wt = "";
  (c.weapons || []).forEach(w => { if (w.group !== last) { wt += head(w.group); last = w.group; }
    wt += `<div class="rf-aw-wr"><span class="rf-aw-wn">${esc(w.n)}${w.note ? `<small>${wr(w.note)}</small>` : ""}</span><span>${esc(w.a)}</span><span>${esc(w.h)}</span><span>${esc(w.w)}</span><span>${esc(w.r)}</span><span>${esc(w.d)}</span></div>`; });
  const prof = (c.profile || []).length ? `<div class="rf-aw-prof"><b>Battle profile</b>${c.profile.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("")}</div>` : "";
  const kws = (c.keywords || []).map(k => `<span class="rf-aw-kv">${esc(k)}</span>`).join("");
  return `<div class="rf-aw"${accentOf(c.colour) ? ` style="--aos:${accentOf(c.colour)}"` : ""}>${c.kicker ? `<div class="rf-aw-kick">${esc(c.kicker)}</div>` : ""}<div class="rf-aw-bar">${esc(c.name)}</div>${c.flavour ? `<p class="rf-aw-fl">${esc(c.flavour)}</p>` : ""}<div class="rf-aw-stats">${stats}</div>${wt ? `<div class="rf-aw-wt">${wt}</div>` : ""}${(c.abilities || []).map(aosAbility).join("")}${kws ? `<div class="rf-aw-kw"><span class="rf-ab-kl">Keywords</span><div>${kws}</div></div>` : ""}${prof}</div>`;
}

const CARD_TEMPLATES = { killteam: killTeamCard, aos: aosWarscroll, "aos-ability": aosAbility };
/** Draws a card with the template its "tpl" names (Kill Team when it names none). */
const renderCard = c => (CARD_TEMPLATES[c.tpl || "killteam"] || killTeamCard)(c);

export { CARD_TEMPLATES, renderCard };
