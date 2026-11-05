/* RulesForge · datasheets.js
 * Datasheet data helpers and the display pieces shared by the Library viewer and the list builder.
 */
import { esc, state, uid } from "./core.js?v=5.7";
import { wargearOf } from "./loadout.js?v=5.7";
import { factionMatches } from "./search.js?v=5.7";
import { coreAbilityRule } from "./rules-doc.js?v=5.7";
import { capWords, itemize, joinParagraphs, keywordList, letterCount, niceKeywords, normName, richHTML, softenCaps, stripRich, titleCase } from "./text.js?v=5.7";

/** Stat lines exactly as the datasheet shows them: one line, or one per model type (exact repeats dropped). */
function distinctProfiles(ds) {
  const seen = new Set();
  return ds.profiles.filter(p => {
    const key = [p.name, p.M, p.T, p.SV, p.W, p.LD, p.OC].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A datasheet laid out in the order of the Wahapedia card:
 * name, stat lines, ranged weapons, melee weapons, wargear options, abilities, unit composition,
 * unit costs, led by / can lead, supported by / can support, keywords, army rules,
 * faction keywords, detachment ability, enhancements, stratagems. Empty sections are left out.
 */
function datasheetBlocks(ds) {
  const blocks = [];
  const secs = re => ds.sections.filter(s => re.test(s.heading));
  const linesOf = list => list.flatMap(s => s.lines?.length ? s.lines : s.text.split(/\n| · /)).map(t => t.trim()).filter(Boolean);

  // 2 / 2a. Stat lines
  const profiles = distinctProfiles(ds);
  if (profiles.length) blocks.push({ type: "stats", heading: "", profiles, invuln: ds.invuln });

  // 3–4. Weapons
  for (const [type, heading, skill] of [["Ranged", "Ranged Weapons", "BS"], ["Melee", "Melee Weapons", "WS"]]) {
    const ws = ds.weapons.filter(w => w.type === type);
    if (ws.length) blocks.push({ type: "table", heading, header: ["Range", "A", skill, "S", "AP", "D", "Keywords"],
      rows: ws.map(w => [w.name, w.range, w.A, w.skill, w.S, w.AP, w.D, w.tags]) });
  }

  // 5. Wargear options
  const wargear = itemize(linesOf(secs(/^WARGEAR OPTIONS/)));
  if (wargear.length) blocks.push({ type: "lines", heading: "Wargear Options", lines: wargear });

  // 6. Abilities (core and faction abilities first, then the unit's own; damage brackets after)
  // Comma-separated lists can wrap onto a second line: rejoin, then split on the commas.
  const commaList = list => linesOf(list).join(" ").split(/\s*,\s*/).map(t => t.trim()).filter(Boolean);
  const core = commaList(secs(/^CORE ABILIT|^FACTION ABILIT/));
  const own = joinParagraphs(linesOf(secs(/^ABILITIES$/))).split("\n").filter(Boolean);
  const damaged = secs(/^DAMAGED/).flatMap(s => [titleCase(s.heading) + ":", ...joinParagraphs(s.lines || [s.text]).split("\n")]).filter(Boolean);
  const abilities = [...core.map(c => `Core: ${c}`), ...own, ...damaged];
  if (abilities.length) blocks.push({ type: "lines", heading: "Abilities", lines: abilities });
  const gearAbilities = linesOf(secs(/^WARGEAR ABILITIES/));
  if (gearAbilities.length) blocks.push({ type: "lines", heading: "Wargear Abilities", lines: gearAbilities });

  // 7a. Unit composition
  const comp = itemize(linesOf(secs(/COMPOSITION/)));
  if (comp.length) blocks.push({ type: "lines", heading: "Unit Composition", lines: comp });

  // 7b. Unit costs
  if (ds.points.length) blocks.push({ type: "pairs", heading: "Unit Costs",
    rows: ds.points.map(p => [`${p.models} model${p.models === 1 ? "" : "s"}`, p.points, p.later ? `3rd+ unit: ${p.later}` : ""]) });

  // 8–9. Leader / support lists: a sentence, then one unit per line
  const attachList = list => {
    const lines = linesOf(list), sentence = [], names = [];
    for (const l of lines) (l === l.toUpperCase() && letterCount(l) >= 3 ? names : sentence).push(l);
    return [...(sentence.length ? [sentence.join(" ")] : []), ...names.map(titleCase)];
  };
  for (const [re, ledHeading, leadsHeading] of [[/^(LED BY|LEADER)$/, "Led By", "Can Lead"], [/^(SUPPORTED BY|SUPPORT)$/, "Supported By", "Can Support"]]) {
    for (const s of secs(re)) {
      const lines = attachList([s]);
      if (lines.length) blocks.push({ type: "lines", heading: /^(LED BY|SUPPORTED BY)$/.test(s.heading) ? ledHeading : leadsHeading, lines });
    }
  }

  // 10–12. Keywords, army rules, faction keywords
  if (ds.keywords) blocks.push({ type: "lines", heading: "Keywords", lines: [ds.keywords] });
  const army = commaList(secs(/^ARMY RULES/));
  if (army.length) blocks.push({ type: "lines", heading: "Army Rules", lines: army });
  if (ds.factionKeywords) blocks.push({ type: "lines", heading: "Faction Keywords", lines: [ds.factionKeywords] });

  // Anything else the datasheet had, so nothing is lost
  const known = /^(WARGEAR OPTIONS|WARGEAR ABILITIES|CORE ABILIT|FACTION ABILIT|ABILITIES$|DAMAGED|.*COMPOSITION|LED BY$|LEADER$|SUPPORTED BY$|SUPPORT$|ARMY RULES|NOTES$|KEYWORDS|FACTION KEYWORDS)/;
  // (Scraps of the title, like "CAPTAIN (⌀40mm)", are skipped.)
  const isTitleScrap = s => normName(ds.name).startsWith(normName(s.heading)) ||
    /^\(?\s*([⌀\d][^)]*mm|Use model|Unique)\s*\)?$/i.test(s.text.trim());
  // Extra rule sections (Psychic Abilities, Transport…) sit right after Abilities, like on the card.
  const extras = [];
  for (const s of ds.sections.filter(s => !known.test(s.heading) && !isTitleScrap(s))) {
    const lines = joinParagraphs(linesOf([s])).split("\n").filter(Boolean);
    if (lines.length) extras.push({ type: "lines", heading: titleCase(s.heading), lines });
  }
  const afterAbilities = blocks.findIndex(b => b.heading === "Unit Composition");
  blocks.splice(afterAbilities >= 0 ? afterAbilities : blocks.length, 0, ...extras);

  // 13–15. Detachment abilities, enhancements, stratagems
  if (ds.detachmentAbilities?.length) blocks.push({ type: "lines", heading: "Detachment Ability", lines: ds.detachmentAbilities });
  if (ds.enhancementOptions?.length) blocks.push({ type: "pairs", heading: "Enhancements", rows: ds.enhancementOptions.map(e => [e.name, e.points ?? "", ""]) });
  const groups = stratagemGroups(ds);
  if (groups.length) blocks.push({ type: "groups", heading: "Stratagems", groups: groups.map(g => ({ name: g.group, rows: g.items.map(i => [i.name, `${i.cp} CP`]) })) });
  return blocks;
}

/** A unit's stratagems grouped as Core first, then each detachment in page order. */
function stratagemGroups(ds) {
  const groups = [];
  for (const st of ds.stratagems || []) {
    let g = groups.find(x => x.group === st.group);
    if (!g) { g = { group: st.group, items: [] }; groups.push(g); }
    g.items.push(st);
  }
  return groups.sort((a, b) => (b.group === "Core") - (a.group === "Core"));
}

/** Turns structured faction data into searchable records and points entries. */
function structuredToLibrary(data, faction) {
  const chunks = [], points = [];
  for (const ds of data.datasheets) {
    const lines = [`${ds.name.toUpperCase()} — ${faction || "faction"} datasheet${ds.unitType ? ` (${ds.unitType})` : ""}`];
    // Same sections as the card; abilities move up so they're never cut off when space is short.
    const blocks = datasheetBlocks(ds);
    const abil = blocks.findIndex(b => b.heading === "Abilities");
    if (abil > 1) blocks.splice(1, 0, ...blocks.splice(abil, 1));
    for (const b of blocks) {
      if (b.type === "stats") {
        for (const p of b.profiles) lines.push(`${p.name ? p.name + ": " : ""}M ${p.M} | T ${p.T} | SV ${p.SV} | W ${p.W} | LD ${p.LD} | OC ${p.OC}`);
        if (b.invuln) lines.push(`Invulnerable save: ${b.invuln}`);
      } else if (b.type === "table") {
        lines.push(`${b.heading.toUpperCase()}:`, ...b.rows.map(r => `- ${r[0]}: ${r[1]}, A ${r[2]}, ${b.header[2]} ${r[3]}, S ${r[4]}, AP ${r[5]}, D ${r[6]}${r[7] ? ` [${r[7]}]` : ""}`));
      } else if (b.type === "lines") {
        lines.push(`${b.heading.toUpperCase()}:`, ...b.lines);
      } else if (b.type === "pairs") {
        lines.push(`${b.heading.toUpperCase()}:`, ...b.rows.map(([l, v, x]) => `${l}: ${v}${x ? ` (${x})` : ""}`));
      } else if (b.type === "groups") {
        lines.push("STRATAGEMS:", ...b.groups.map(g => `${g.name}: ${g.rows.map(([n, cp]) => `${n} (${cp})`).join(", ")}`));
      }
    }
    chunks.push({ page: chunks.length + 1, text: lines.join("\n"), cite: ds.name });
    const kws = ds.keywords.split(/[;,]/).map(k => k.trim().toUpperCase()).filter(Boolean);
    for (const p of ds.points) points.push({ id: uid(), name: ds.name, models: p.models, points: p.points, ...(p.later ? { later: p.later } : {}), enh: false, section: faction, page: 0, keywords: kws });
  }
  for (const d of data.detachments) {
    const text = [`${d.name.toUpperCase()} — ${faction || ""} detachment${d.dp ? ` (${d.dp})` : ""}`, d.description,
      d.rules.length ? "DETACHMENT RULES:\n" + d.rules.map(r => `${r.name}: ${r.text}`).join("\n") : "",
      d.enhancements.length ? "ENHANCEMENTS:\n" + d.enhancements.map(e => `- ${e.name} (${e.points ?? "?"} pts): ${e.text}`).join("\n") : ""].filter(Boolean).join("\n");
    chunks.push({ page: chunks.length + 1, text, cite: `${d.name} detachment` });
    for (const s of d.stratagems) chunks.push({ page: chunks.length + 1, text: `${s.name.toUpperCase()} — ${s.cp} stratagem (${d.name} detachment)\n${s.text}`, cite: `${s.name} stratagem` });
    for (const e of d.enhancements) if (e.points != null) points.push({ id: uid(), name: e.name, models: 0, points: e.points, enh: true, section: faction, page: 0, detachment: d.name });
  }
  for (const r of data.armyRules) chunks.push({ page: chunks.length + 1, text: `${r.name.toUpperCase()} — army rule\n${r.text}`, cite: `${r.name} (army rule)` });
  return { chunks, points };
}

/** Datasheet details for the viewer, also for data read by the older reader. */
function viewerDatasheet(ds) {
  let abilities = ds.abilities;
  if (!abilities) {
    abilities = ds.sections.filter(s => /^ABILITIES$/.test(s.heading)).flatMap(s => s.text.split("\n"))
      .map(l => { const m = l.match(/^([^:]{2,80}):\s*(.*)$/); return m ? { name: m[1], text: m[2], rich: m[2], wargear: false } : null; }).filter(Boolean);
  }
  const fromSection = re => ds.sections.filter(s => re.test(s.heading)).flatMap(s => s.text.split(/\s*[,\n]\s*/)).map(t => t.trim()).filter(Boolean);
  const coreNames = (ds.coreAbilities || fromSection(/^CORE ABILIT/)).filter(n => !/^(Leader|Support)$/i.test(n));
  const factionNames = (ds.armyRuleNames || fromSection(/^(ARMY RULES?|FACTION ABILIT\w*)$/)).filter(n => !/^(Leader|Support)$/i.test(n));
  const ruleNames = [...coreNames, ...factionNames];
  let leader = ds.leader;
  if (!leader) {
    leader = ds.sections.filter(s => /^(LEADER|SUPPORT|LED BY|SUPPORTED BY)$/.test(s.heading)).map(s => {
      const ls = (s.lines || s.text.split(/\n| · /)).map(t => t.trim()).filter(Boolean);
      return { heading: titleCase(s.heading), intro: ls.filter(l => l !== l.toUpperCase()).join(" "), units: ls.filter(l => l === l.toUpperCase()).map(titleCase) };
    });
  }
  const extras = ds.sections.filter(s => !/^(CORE ABILIT|ARMY RULES?|ABILITIES|WARGEAR ABILITIES|WARGEAR OPTIONS|UNIT COMPOSITION|LEADER|SUPPORT|LED BY|SUPPORTED BY|KEYWORDS|FACTION KEYWORDS|NOTES|STRATAGEMS|DETACHMENT ABILIT|ENHANCEMENTS?)/.test(s.heading))
    .filter(s => !normName(ds.name).startsWith(normName(s.heading)) && !/^\(?\s*([⌀\d][^)]*mm|Use model|Unique)\s*\)?$/i.test(s.text.trim()));
  return { abilities, ruleNames, coreNames, factionNames, leader: leader || [], extras };
}

const DATASHEET_GROUPS = [
  ["Epic Characters", kws => kws.includes("EPIC HERO")],
  ["Characters", kws => kws.includes("CHARACTER")],
  ["Battleline", kws => kws.includes("BATTLELINE")],
  ["Dedicated Transports", kws => kws.includes("DEDICATED TRANSPORT")],
  ["Other Datasheets", () => true],
];
/** "Grenade Launcher - Frag": one weapon with several profiles. */
const isProfileName = name => /\S\s+[-–—]\s+\S/.test(String(name || ""));
const lowestPoints = ds => ds.points?.length ? Math.min(...ds.points.map(p => p.points)) : null;

/** Keywords a detachment rule hands out: "Friendly HELBRUTE / MYPHITIC BLIGHT-HAULER have CONTAGION ENGINE." */
function keywordGrants(det) {
  const text = [det.description, ...(det.rules || []).map(r => r.text)].map(t => stripRich(t || "")).join(" ").replace(/\s+/g, " ");
  const out = [];
  for (const m of text.matchAll(/Friendly ((?:[A-Z][A-Z0-9’'-]*\s*(?:\/\s*)?)+?)\s*(?:units?\s+)?(?:have|gain)\s+(?:the\s+)?([A-Z][A-Z0-9’'-]*(?:\s+[A-Z][A-Z0-9’'-]*)*)(?:\s+keyword)?\s*\./g)) {
    out.push({ alts: m[1].split(/\s*\/\s*/).map(a => a.trim().replace(/\s+/g, " ")).filter(Boolean), kw: m[2].trim() });
  }
  return out;
}

/** Tidies weapon rows read from a PDF: keyword fragments ("non-") caught in a name, rows that are only fragments. */
const tidiedSheets = new WeakSet();
function tidyDatasheet(ds) {
  if (!ds || tidiedSheets.has(ds)) return ds;
  tidiedSheets.add(ds);
  ds.weapons = (ds.weapons || []).filter(w => !/^(\s*non-?\s*)+$/i.test(w.name || "")).map(w => {
    const name = String(w.name || "").replace(/(\s+non-?)+\s*$/i, "").replace(/\s+(non-)\s+/gi, " ").trim();
    // "Lethal Hits:, Monster/vehicle" (with "non-" stuck to the name) → "Lethal Hits (non-Monster/Vehicle)"
    const cap = t => t.replace(/(^|[\/\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    const tags = String(w.tags || "").replace(/([A-Za-z][\w ]*?(?:\d+\+?)?):\s*,\s*([A-Za-z][\w\/ ]*?)(?=,|$)/g, (_, kw, target) => `${kw.trim()} (non-${cap(target.trim())})`)
      .replace(/(\w):(?=,|$)/g, "$1").replace(/\s+,/g, ",").trim();
    return name === w.name && tags === w.tags ? w : { ...w, name, tags };
  });
  return ds;
}

/** Faction abilities (army rules the unit has), each with its rules text from the faction's Army Rules when found. */
function factionAbilitiesHTML(names, armyRules) {
  if (!names?.length) return "";
  const key = n => normName(String(n).replace(/\(.*?\)/g, ""));
  const body = names.map(n => {
    const rule = (armyRules || []).find(r => key(r.name) === key(n)) || (armyRules || []).find(r => key(n).startsWith(key(r.name)) || key(r.name).startsWith(key(n)));
    return `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(n))}</div><div class="fv-rich">${rule ? richHTML(rule.rich || rule.text) : `<span class="lb-subtle">The rules text for this isn't in your faction pack.</span>`}</div></div>`;
  }).join("");
  return panelHTML("Faction Abilities", body, "fv-army");
}
/** Core abilities, with their rules text from the Core Rules (or a newer update) when those are in the Library. */
function coreAbilitiesHTML(names) {
  if (!names?.length) return "";
  const withRule = names.map(n => ({ n, rule: coreAbilityRule(n) }));
  if (!withRule.some(x => x.rule)) return panelHTML("Core Abilities", `<div class="fv-core">${names.map(n => `<span>${esc(softenCaps(n))}</span>`).join("")}</div>`);
  return panelHTML("Core Abilities", withRule.map(({ n, rule }) => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(n))}${rule?.num ? `<span class="fv-ab-ref">${esc(rule.num)}</span>` : ""}</div>
    <div class="fv-rich">${rule ? richHTML(rule.rich || rule.text) : `<span class="lb-subtle">Not found in your Core Rules.</span>`}</div></div>`).join(""));
}

/** Army rules of a faction from the Library (for datasheets shown in the list builder). */
const factionArmyRules = faction => state.docs.filter(d => d.structured?.datasheets && factionMatches(d.faction, faction)).flatMap(d => d.structured.armyRules || []);

/** The datasheet's Wargear Options, laid out as one rule per paragraph with its choices as bullets. */
function wargearOptionsHTML(ds) {
  const wo = ds.sections.find(sc => /^WARGEAR OPTIONS/.test(sc.heading));
  if (!wo) return "";
  const rules = wargearOf(tidyDatasheet(ds)).display || [];
  const body = rules.length
    ? rules.map(r => `<p>${esc(softenCaps(r.text))}</p>${r.bullets.length ? `<ul>${r.bullets.map(b => `<li>${esc(softenCaps(b.replace(/\.$/, "")))}</li>`).join("")}</ul>` : ""}`).join("")
    : richHTML(wo.rich || wo.text);
  return panelHTML("Wargear Options", `<div class="fv-rich lb-wargear">${body}</div>`);
}

/** The lower half of a datasheet, shared by the Library viewer and the list builder:
 *  faction abilities, abilities, wargear abilities, other sections, leader lists and keywords. */
/** Leader / support lists for a datasheet, filled in from both sides: a bodyguard unit lists every character
 *  whose datasheet says it can lead it, and a character lists every unit whose datasheet says it can be led by it. */
const LEADER_INTRO = {
  "Leader": "This model can be attached to the following units:",
  "Led By": "This unit can be led by the following units:",
  "Support": "This model can support the following units:",
  "Supported By": "This unit can be supported by the following units:",
};
const leaderTitle = h => /^(led|supported)/i.test(h) ? (/^led/i.test(h) ? "Led By" : "Supported By") : (/^support/i.test(h) ? "Support" : "Leader");
const MIRROR = { "Leader": "Led By", "Led By": "Leader", "Support": "Supported By", "Supported By": "Support" };
function attachLists(ds, siblings = []) {
  const groups = new Map();
  const add = (title, name, intro) => {
    if (!groups.has(title)) groups.set(title, { heading: title, intro: intro || LEADER_INTRO[title], units: [] });
    const g = groups.get(title);
    if (name && !g.units.some(n => normName(n) === normName(name)) && normName(name) !== normName(ds.name)) g.units.push(titleCase(name.toUpperCase()));
  };
  for (const l of viewerDatasheet(ds).leader) { add(leaderTitle(l.heading), "", l.intro); l.units.forEach(n => add(leaderTitle(l.heading), n)); }
  const me = normName(ds.name);
  for (const o of siblings) {
    if (o === ds || normName(o.name) === me) continue;
    for (const l of viewerDatasheet(o).leader) if (l.units.some(n => normName(n) === me)) add(MIRROR[leaderTitle(l.heading)], o.name);
  }
  return [...groups.values()].filter(g => g.units.length || (g.intro && g.intro !== LEADER_INTRO[g.heading]));
}

function datasheetDetailsHTML(ds, armyRules, opts = {}) {
  const v = viewerDatasheet(ds);
  const own = v.abilities.filter(a => !a.wargear), gear = v.abilities.filter(a => a.wargear);
  const kws = niceKeywords(ds.keywords), fkws = niceKeywords(ds.factionKeywords);
  const unitName = n => opts.link ? `<button type="button" class="fv-link" data-fp="unit" data-k="${esc(normName(n))}">${esc(n)}</button>` : esc(n);
  return [
    coreAbilitiesHTML(v.coreNames),
    factionAbilitiesHTML(v.factionNames, armyRules),
    own.length ? panelHTML("Datasheet Abilities", abilitiesHTML(own)) : "",
    gear.length ? panelHTML("Wargear Abilities", abilitiesHTML(gear)) : "",
    ...v.extras.map(s => panelHTML(esc(titleCase(s.heading)), `<div class="fv-rich">${richHTML(s.rich || s.text)}</div>`)),
    ...attachLists(ds, opts.siblings).map(l => panelHTML(l.heading,
      `${l.intro ? `<div class="fv-intro">${esc(l.intro)}</div>` : ""}<ul class="fv-units">${l.units.sort((a, b) => a.localeCompare(b)).map(n => `<li>${unitName(n)}</li>`).join("")}</ul>`)),
    kws || fkws ? panelHTML("Keywords", (kws ? `<div class="fv-kh">Keywords</div><div class="fv-kv">${esc(kws)}</div>` : "") + (fkws ? `<div class="fv-kh">Faction Keywords</div><div class="fv-kv">${esc(fkws)}</div>` : "")) : "",
  ].join("");
}

/** A detachment's Unique tag; older imports kept "Unique: X" as a rule or in the description. */
function detUnique(det) {
  if (det.fromExcel) return det.unique ? titleCase(det.unique.toUpperCase()) : "";   // the spreadsheet decides; blank means none
  if (det.unique) return titleCase(det.unique.toUpperCase());
  const rule = (det.rules || []).find(r => /^unique\b/i.test(r.name));
  let raw = rule ? (rule.name.replace(/^unique\s*:?\s*/i, "") || stripRich(rule.text || "").split(/[\n.]/)[0])
    : (stripRich(det.description || "").match(/^\s*unique\s*:\s*([^\n.]+)/i) || [])[1];
  // Some packs write it in the rules: "This detachment has the ENGINES tag and cannot be taken with another ENGINES detachment."
  if (!raw) {
    const all = [det.description, ...(det.rules || []).map(r => r.text)].map(t => stripRich(t || "")).join(" ");
    raw = (all.match(/has the ([A-Za-z][\w ’'-]{1,40}?) tag\b/i) || all.match(/cannot be taken with another ([A-Za-z][\w ’'-]{1,40}?) detachment/i) || [])[1];
  }
  return raw ? titleCase(raw.trim().toUpperCase()) : "";
}

function modStat(v, delta, stat) {
  const s = String(v ?? "").trim();
  if (stat === "AP") { const n = parseInt(s, 10); return isNaN(n) ? s : String(n - delta); }
  if (/^\d+$/.test(s)) return String(+s + delta);
  const m = s.match(/^(\d*D\d+)(?:\+(\d+))?$/i);
  return m ? `${m[1]}+${(+m[2] || 0) + delta}` : s;
}

function panelHTML(title, inner, cls = "") {
  return `<section class="fv-panel${cls ? " " + cls : ""}">${title ? `<div class="fv-panel-head">${title}</div>` : ""}${inner}</section>`;
}
function statsHTML(ds) {
  const profiles = distinctProfiles(ds);
  if (!profiles.length) return "";
  const named = profiles.length > 1;
  const cells = (vals, cls) => vals.map(v => `<span class="${cls}">${esc(v ?? "")}</span>`).join("");
  return `<section class="fv-panel"><div class="fv-stats${named ? " named" : ""}">
      ${named ? "<span></span>" : ""}${cells(["M", "T", "Sv", "W", "Ld", "Oc"], "lab")}
      ${profiles.map(p => (named ? `<span class="model">${esc(p.name)}</span>` : "") + cells([p.M, p.T, p.SV, p.W, p.LD, p.OC], "val")).join("")}
    </div>${ds.invuln ? `<div class="fv-inv"><span>Invulnerable Save</span><span class="val">${esc(ds.invuln)}</span></div>` : ""}</section>`;
}
const abilitiesHTML = list => list.map(a => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(a.name))}</div><div class="fv-rich">${richHTML(a.rich || a.text)}</div></div>`).join("");

/** Weapon rows with attached-character buffs worked in. */
function weaponGridHTML(ws, type, buffs, withHead = true) {
  const melee = type === "Melee";
  const keys = melee ? ["A", "skill", "S", "AP", "D"] : ["range", "A", "skill", "S", "AP", "D"];
  const heads = melee ? ["A", "Ws", "S", "Ap", "D"] : ["Range", "A", "Bs", "S", "Ap", "D"];
  const mine = buffs.filter(b => !b.type || b.type === type);
  const statKey = { A: "A", S: "S", D: "D", AP: "AP" };
  return `<div class="fv-weapons ${melee ? "melee" : "ranged"}">
    ${withHead ? `<span class="fv-wh">${withHead === "profile" ? "Profile" : melee ? "Melee Weapons" : "Ranged Weapons"}</span>${heads.map(h => `<span class="fv-wh c">${h}</span>`).join("")}<span></span>` : ""}
    ${ws.map(w => {
      const vals = keys.map(k => {
        const b = mine.filter(b => b.stat && statKey[b.stat] === k);
        if (!b.length) return `<span class="c">${esc(w[k])}</span>`;
        const v = b.reduce((acc, x) => modStat(acc, x.delta, x.stat), w[k]);
        return `<span class="c lb-buffed" title="${esc(b.map(x => `${x.delta > 0 ? "+" : ""}${x.delta} ${x.stat} – ${x.source}`).join(", "))}">${esc(v)}</span>`;
      });
      const own = keywordList(w.tags);
      const extra = mine.filter(b => b.keyword && !own.some(k => normName(k).startsWith(normName(b.keyword.split(" (")[0]))))
        .map(b => `<span class="lb-buffkw">${esc(b.keyword)} – ${esc(b.source)}</span>`);
      const statNotes = mine.filter(b => b.stat).map(b => `<span class="lb-buffkw">${b.delta > 0 ? "+" : ""}${b.delta} ${esc(b.stat)} – ${esc(b.source)}</span>`);
      const kwHTML = [own.length ? esc(own.join(", ")) : "", ...extra, ...statNotes].filter(Boolean).join('<span class="lb-sep">, </span>');
      return `<span class="fv-wname">${isProfileName(w.name) ? `<span class="fv-dash">–</span>` : ""}${esc(capWords(w.name.replace(/\s+non-?\s*$/i, "")))}</span>${vals.join("")}<span></span>
        ${kwHTML ? `<span class="fv-wkl">Keywords</span><span class="fv-wkw">${kwHTML}</span>` : ""}`;
    }).join("")}
  </div>`;
}

export { attachLists, DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, factionArmyRules, keywordGrants, lowestPoints, panelHTML, statsHTML, structuredToLibrary, tidyDatasheet, viewerDatasheet, wargearOptionsHTML, weaponGridHTML };
