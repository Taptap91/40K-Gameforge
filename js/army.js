/* RulesForge · army.js
 * Army rules and list legality (battle sizes, detachments, enhancements, attachments), and the list generator.
 */
import { DB, state, toast, uid } from "./core.js?v=8.13";
import { detUnique, keywordGrants, tidyDatasheet, viewerDatasheet } from "./datasheets.js?v=8.13";
import { attackBuffs, loadoutIssues, loadoutOf, loadoutProblem, weaponSummary } from "./loadout.js?v=8.13";
import { factionMatches } from "./search.js?v=8.13";
import { keywordList, normName, stripRich, titleCase } from "./text.js?v=8.13";
import { battleSizes, compareEditions } from "./rules-doc.js?v=8.13";

/* Lists are built from the structured faction data (converted faction PDFs).
   Battle sizes (points, detachment points, enhancement and unit limits) come from the Core Rules in the Library,
   with any newer update laid over them (Core Rules 25.03); without them, the 11th edition table is used. */

/** The battle size a points total plays at: the smallest that fits, or the largest if it's over every size. */
function sizeRules(pts) {
  const sizes = battleSizes();
  const s = sizes.find(b => pts <= b.points) || sizes[sizes.length - 1];
  return { name: s.name, points: s.points, dp: s.dp, enh: s.enh, dup: s.units, over: pts > s.points };
}
/** Points totals offered when creating a list: one per battle size. */
const pointSizes = () => battleSizes().map(b => b.points);
/* Keywords too common to say anything about a unit's role. */
const GENERIC_KW = new Set(["ADEPTUS ASTARTES", "IMPERIUM", "DARK ANGELS", "EXPLOSIVES", "CHARACTER", "EPIC HERO", "SMOKE", "GRENADES"]);

/** Rough per-model strength from stats and weapons, used to rank units. */
function unitPower(ds) {
  const p = ds.profiles?.[0] || {};
  const num = x => parseFloat(String(x ?? "").replace(/[^\d.]/g, "")) || 0;
  const avg = x => {
    const m = String(x ?? "").toUpperCase().match(/^(\d*)D(\d+)(?:\+(\d+))?$/);
    return m ? (num(m[1]) || 1) * (+m[2] + 1) / 2 + (+m[3] || 0) : num(x);
  };
  const weapon = w => avg(w.A) * (7 - Math.min(6, num(w.skill) || 4)) / 6 * Math.max(1, num(w.S)) * Math.max(1, avg(w.D)) * (1 + Math.abs(num(w.AP)) * 0.3) / 10;
  const best = type => Math.max(0, ...(ds.weapons || []).filter(w => w.type === type).map(weapon));
  const save = num(p.SV) || 5;
  return {
    durability: Math.max(1, num(p.W)) * Math.max(3, num(p.T)) * (8 - save) / 12 * (ds.invuln ? 1.25 : 1),
    ranged: best("Ranged"), melee: best("Melee"),
  };
}

/** "Adeptus Astartes Infantry / Mounted model only" → who an enhancement or upgrade can go on. */
function parseRestriction(text) {
  const plain = stripRich(text || "").replace(/\s+/g, " ");
  // Look at each sentence; the restriction is a short one naming keywords and ending in "only".
  const named = a => a.replace(/\(.*?\)/g, " ").split(/\s+|\//).filter(Boolean).every(w => /^[A-Z0-9’'“"-]/.test(w) || /^(of|the|and|or|with|a|an)$/i.test(w));
  let m = null;
  for (const sentence of plain.split(/(?<=[.!])\s+/)) {
    const t = sentence.trim();
    const x = t.match(/^(.{2,120}?)\s+(model|unit)\b([^.]*?)\bonly\b/i) || t.match(/^(.{2,80}?)\s+()()only\.?$/i);
    if (x && t.length <= 160 && named(x[1])) { m = x; break; }
  }
  if (!m) return null;
  return {
    upgrade: /unit/i.test(m[2] || ""),
    alts: m[1].replace(/^(friendly|a|an)\s+/i, "").split(/\s*\/\s*/).map(a => a.toUpperCase().replace(/^FRIENDLY\s+/, "").replace(/\s+/g, " ").trim()).filter(Boolean),
    excluding: (plain.match(/\(excluding ([^)]+)\)/i)?.[1] || "").toUpperCase().replace(/S\b/g, ""),
    ability: ((m[3] || "").match(/with the (.+?) ability/i)?.[1] || "").toUpperCase(),
  };
}

/** True if every word group of `alt` is one of the unit's keywords (or its name). */
function keywordsCover(alt, unit) {
  let rest = ` ${alt} `;
  for (const k of [...unit.all].sort((a, b) => b.length - a.length)) rest = rest.replace(` ${k} `, " ");
  return !rest.trim();
}

/** How many of the same enhancement an army can include (Core Rules 25.04): one, or three for an Upgrade,
 *  unless its own text says otherwise ("up to 2 units per army"). */
function enhLimit(enh) {
  const t = stripRich(enh?.text || "");
  const m = t.match(/\bup to (\d+) (?:times|units|models)\b/i) || t.match(/\b(\d+) (?:times|units|models) per army\b/i) || t.match(/\blimit(?: of)?:?\s*(\d+)\b/i);
  return m ? Math.max(1, +m[1]) : enh?.upgrade ? 3 : 1;
}

function canTakeEnhancement(unit, enh) {
  if (unit.epic) return false;
  // Keywords given by the enhancement's own detachment count too.
  const extra = (enh.grants || []).filter(g => g.alts.some(a => keywordsCover(a, unit))).map(g => g.kw);
  if (extra.length && !unit._granted?.has(extra.join("|"))) {
    unit = { ...unit, all: new Set([...unit.all, ...extra]), kws: [...unit.kws, ...extra], _granted: new Set([extra.join("|")]) };
  }
  // Only Characters take enhancements; Upgrades can also go on other units (Core Rules 25.04).
  const req = enh.req;
  if (!enh.upgrade && !unit.character) return false;
  if (!req) return true;
  if (req.excluding && unit.kws.some(k => req.excluding.includes(k.replace(/S$/, "")))) return false;
  if (req.ability && !unit.core.some(c => c.startsWith(req.ability))) return false;
  return req.alts.some(a => keywordsCover(a, unit));
}

/** Units and detachments for one faction, from the converted faction documents. */
/** Units and detachments for a faction, from your library — or from `docs` given (an opponent's synced rules). */
function armyData(faction, docsGiven = null) {
  const docs = docsGiven || state.docs.filter(d => d.structured?.datasheets && (!faction || factionMatches(d.faction, faction)));
  const units = new Map(), dets = new Map();
  for (const doc of docs) {
    for (const ds of doc.structured.datasheets) {
      tidyDatasheet(ds);
      if (!ds.points?.length || units.has(normName(ds.name))) continue;
      const v = viewerDatasheet(ds);
      const kws = keywordList(ds.keywords).map(k => k.toUpperCase());
      const fk = keywordList(ds.factionKeywords).map(k => k.toUpperCase());
      const u = {
        key: normName(ds.name), name: ds.name, ds, kws, fk, all: new Set([...kws, ...fk, ds.name.toUpperCase()]),
        options: ds.points.slice().sort((a, b) => a.models - b.models),
        character: kws.includes("CHARACTER") || kws.includes("EPIC HERO"), epic: kws.includes("EPIC HERO"),
        battleline: kws.includes("BATTLELINE"), transport: kws.includes("DEDICATED TRANSPORT"),
        core: (ds.coreAbilities || []).map(c => c.toUpperCase()),
        leads: [], supports: [], ledBy: [], supportedBy: [], power: unitPower(ds), buffs: attackBuffs(v.abilities, ds.name),
        supreme: ds.sections.some(x => /SUPREME COMMANDER/i.test(x.heading) || /^Supreme Commander:/i.test(x.text)) || (ds.abilities || []).some(a => /Supreme Commander/i.test(a.name)),
      };
      for (const l of v.leader) {
        const names = l.units.map(normName);
        if (/^led/i.test(l.heading)) u.ledBy.push(...names);
        else if (/^supported/i.test(l.heading)) u.supportedBy.push(...names);
        else if (/^support/i.test(l.heading)) u.supports.push(...names);
        else u.leads.push(...names);
      }
      units.set(u.key, u);
    }
    for (const det of doc.structured.detachments) {
      const key = normName(det.name);
      if (dets.has(key)) continue;
      const text = [det.description, ...det.rules.map(r => r.text), ...det.enhancements.map(e => e.text), ...det.stratagems.map(s => s.text)].join(" ").toUpperCase();
      const grants = keywordGrants(det);
      dets.set(key, { key, name: det.name, dp: parseInt(det.dp, 10) || 1, unique: detUnique(det), det, text, grants,
        enhancements: det.enhancements.map(e => {
          const req = parseRestriction(e.text);
          // Packs tag Upgrades ("UPGRADE"); older data only says "… unit only".
          const upgrade = e.upgrade != null ? !!e.upgrade : !!req?.upgrade;
          return { name: e.name, points: e.points || 0, text: e.text, detachment: det.name, req, grants, upgrade };
        }) });
    }
  }
  // Points from the newest Munitorum Field Manual replace the faction pack's.
  const mfm = pointsOverrides(faction);
  for (const u of units.values()) {
    const p = mfm.units.get(u.key);
    if (p) { u.options = p.rows; u.pointsFrom = p.from; }
  }
  for (const d of dets.values()) for (const e of d.enhancements) {
    const p = mfm.enh.get(normName(e.name));
    if (p != null) { e.points = p.points; e.pointsFrom = p.from; }
  }
  return { units: [...units.values()], detachments: [...dets.values()] };
}

/** Unit and enhancement points from Munitorum Field Manuals in the Library, newest last so it wins. */
function pointsOverrides(faction) {
  const docs = state.docs.filter(d => d.kind === "points" && d.points?.length).sort(compareEditions);
  const units = new Map(), enh = new Map();
  for (const d of docs) {
    const rows = d.points.filter(p => !p.section || !faction || factionMatches(p.section, faction) || factionMatches(d.faction || "", faction));
    const byUnit = new Map();
    for (const p of rows) {
      if (p.enh) { enh.set(normName(p.name), { points: p.points, from: d.title }); continue; }
      if (!(p.models > 0) || !(p.points >= 0)) continue;
      const k = normName(p.name);
      if (!byUnit.has(k)) byUnit.set(k, []);
      if (!byUnit.get(k).some(o => o.models === p.models)) byUnit.get(k).push({ models: p.models, points: p.points });
    }
    for (const [k, list] of byUnit) units.set(k, { rows: list.sort((a, b) => a.models - b.models), from: d.title });
  }
  return { units, enh };
}

/** A unit and the units attached to it count as one unit for enhancements (Core Rules 25.04). */
function attachedGroup(entries, x) {
  const host = x.attachTo ? entries.find(h => h.id === x.attachTo) || x : x;
  return [host, ...entries.filter(o => o.attachTo === host.id)];
}

/** Enhancements counted against the battle size's limit: every enhancement, but only the first copy of each Upgrade. */
function enhancementsCounted(picks) {
  const seen = new Set();
  let n = 0;
  for (const p of picks) {
    if (p.upgrade) { if (seen.has(p.name)) continue; seen.add(p.name); }
    n++;
  }
  return n;
}

/** Which slot a character fills when attached: "leader" or "support". */
const charSlot = u => (u.supports.length && !u.leads.length ? "support" : "leader");
function canAttach(ch, unit, slot = charSlot(ch)) {
  if (!ch.character || unit.character) return false;
  return slot === "support"
    ? ch.supports.includes(unit.key) || unit.supportedBy.includes(ch.key)
    : ch.leads.includes(unit.key) || unit.ledBy.includes(ch.key);
}

function detachmentsBudgetOK(dets, rules) {
  const dp = dets.reduce((s, d) => s + d.dp, 0);
  if (dets.length === 1 && rules.name === "Incursion" && dets[0].dp === 3) return true;
  return dp <= rules.dp;
}

/** Prices, attachments and rule checks for a list. */
function evaluateList(list, data = armyData(list.faction)) {
  const rules = sizeRules(list.points);
  const byKey = new Map(data.units.map(u => [u.key, u]));
  const dets = list.detachments.map(n => data.detachments.find(d => d.name === n)).filter(Boolean);
  const enhPool = dets.flatMap(d => d.enhancements);
  const copies = {}, issues = [];
  const entries = list.units.map(e => {
    const unit = byKey.get(e.key);
    if (!unit) return { ...e, unit: null, cost: 0, enhCost: 0, total: 0 };
    copies[e.key] = (copies[e.key] || 0) + 1;
    const opt = unit.options.find(o => o.models === e.models) || unit.options[0];
    const copy = copies[e.key];
    const cost = copy >= 3 && opt.later ? opt.later : opt.points;
    // Stored as enh (enhancement) or upg (Upgrade); a unit should only have one of them.
    const picks = [e.enh, e.upg].filter(Boolean).map(n => enhPool.find(x => x.name === n) || { name: n, missing: true, points: 0 });
    const enhCost = picks.reduce((s, p) => s + (p.points || 0), 0);
    return { ...e, unit, opt, copy, cost, picks, enhObj: picks.find(p => !p.missing && p.name === e.enh) || null, enhCost, total: cost + enhCost };
  });
  const total = entries.reduce((s, x) => s + x.total, 0);
  // Weapon loadouts, checked against the datasheet's wargear options
  for (const x of entries) {
    x.problems = [];
    if (!x.unit) continue;
    x.loadout = loadoutOf(x);
    x.loadoutProblems = {};
    for (const g of x.loadout) {
      const p = loadoutProblem(g, x.models);
      if (p) { x.loadoutProblems[g.name] = loadoutIssues(g, x.models); x.problems.push(p); (x.loadoutText ||= []).push(p); issues.push(`${x.unit.name} — ${p}`); }
    }
  }

  if (total > list.points) issues.push(`${total - list.points} points over the ${list.points} limit.`);
  for (const e of entries.filter(x => !x.unit)) issues.push(`“${e.name || e.key}” isn't in your library any more.`);
  const dpUsed = dets.reduce((s, d) => s + d.dp, 0);
  if (!dets.length) issues.push("Choose at least one detachment.");
  else if (!detachmentsBudgetOK(dets, rules)) issues.push(`Detachments use ${dpUsed} DP; ${rules.name} allows ${rules.dp} DP.`);
  const uniques = {};
  for (const d of dets.filter(d => d.unique)) (uniques[d.unique] ||= []).push(d.name);
  for (const [tag, names] of Object.entries(uniques)) if (names.length > 1) issues.push(`${names.join(" and ")} are both Unique: ${tag}; take only one.`);

  // Copy limits
  for (const [key, n] of Object.entries(copies)) {
    const u = byKey.get(key);
    const max = unitMax(u, rules);
    if (n > max) { issues.push(`${n}× ${u.name}: the limit is ${max}.`); for (const x of entries.filter(x => x.key === key).slice(max)) x.problems?.push(`Over the limit of ${max}.`); }
  }
  if (rules.over) issues.push(`${list.points} points is more than the largest battle size (${rules.name}, ${rules.points} points).`);

  // Enhancements and upgrades (Core Rules 25.04)
  const enhs = entries.flatMap(x => (x.picks || []).map(p => ({ x, p })));
  const counted = enhancementsCounted(enhs.map(e => e.p));
  if (counted > rules.enh) issues.push(`${counted} enhancements: ${rules.name} allows ${rules.enh} (extra copies of an Upgrade don't count).`);
  const groupsDone = new Set();
  for (const x of entries.filter(x => x.unit)) {
    const group = attachedGroup(entries, x);
    if (groupsDone.has(group[0].id)) continue;
    groupsDone.add(group[0].id);
    const held = group.flatMap(o => (o.picks || []).map(p => ({ o, p })));
    if (held.length > 1) {
      const msg = group.length > 1
        ? `${group.map(o => o.unit?.name).join(" + ")} form one attached unit, which can only have one enhancement (${held.map(h => h.p.name).join(", ")}).`
        : `${x.unit.name} can only have one enhancement (${held.map(h => h.p.name).join(", ")}).`;
      issues.push(msg);
      for (const h of held) h.o.problems.push("Only one enhancement per unit (attached units count as one).");
    }
  }
  const seenEnh = new Map();
  for (const { x, p } of enhs) {
    const flag = msg => { issues.push(msg); x.problems?.push(msg); };
    if (p.missing) flag(`${p.name} isn't from your chosen detachments.`);
    else if (!canTakeEnhancement(x.unit, p)) flag(`${x.unit.name} can't take ${p.name}.`);
    const n = (seenEnh.get(p.name) || 0) + 1, max = enhLimit(p);
    if (n > max) flag(max === 1 ? `${p.name} is taken more than once.` : `${p.name} is taken ${n} times: the most is ${max}.`);
    seenEnh.set(p.name, n);
  }

  // Attachments
  const slotUse = {};
  for (const x of entries.filter(x => x.attachTo)) {
    const host = entries.find(h => h.id === x.attachTo);
    if (!host?.unit || !x.unit) continue;
    const slot = x.slot || charSlot(x.unit);
    if (!canAttach(x.unit, host.unit, slot)) { issues.push(`${x.unit.name} can't be attached to ${host.unit.name}.`); x.problems.push(`Can't be attached to ${host.unit.name}.`); }
    const k = host.id + slot;
    slotUse[k] = (slotUse[k] || 0) + 1;
    if (slotUse[k] === 2) { issues.push(`${host.unit.name} has more than one ${slot === "support" ? "support character" : "leader"}.`); host.problems.push(`More than one ${slot === "support" ? "support character" : "leader"} attached.`); }
  }
  const chars = entries.filter(x => x.unit?.character);
  for (const x of chars.filter(x => x.unit.supreme && !x.warlord)) { issues.push(`${x.unit.name} is a Supreme Commander and must be your Warlord.`); x.problems.push("Supreme Commander: must be your Warlord."); }
  if (!chars.length && entries.length) issues.push("Add at least one Character to be your Warlord.");
  else if (chars.length && entries.filter(x => x.warlord).length !== 1) issues.push("Choose one Character as your Warlord.");

  return { entries, total, left: list.points - total, issues, rules, dets, enhPool, dpUsed, enhCount: counted };
}const VIBE_GROUPS = [
  [/terminator|deathwing|elite|first company/, ["TERMINATOR", "DEATHWING"]],
  [/ravenwing|bikes?\b|biker|fast|speed|mobile|speeders?/, ["MOUNTED", "RAVENWING", "FLY"]],
  [/tanks?\b|vehicles?|armou?red|land raiders?|gladiators?/, ["VEHICLE"]],
  [/dread(nought)?s?|walkers?/, ["DREADNOUGHT", "WALKER"]],
  [/infantry|horde|lots of (models|bodies|marines)|boots|troops/, ["INFANTRY", "BATTLELINE"]],
  [/objectives?|hold(ing)?\b|board control|sticky/, ["BATTLELINE"]],
  [/phobos|stealth|sneaky|infiltrat|scouts?/, ["PHOBOS"]],
  [/gravis|durable|tanky/, ["GRAVIS"]],
  [/jump ?packs?|deep strike|drop pods?/, ["JUMP PACK", "FLY"]],
  [/psykers?|librarians?|psychic/, ["PSYKER"]],
  [/aircraft|flyers?|planes?/, ["AIRCRAFT"]],
  [/tacticus/, ["TACTICUS"]],
  [/daemon engines?|engines|daemons?\b/, ["DAEMON", "VEHICLE"]],
];

function parseVibe(text, data) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const want = new Map(), avoid = new Set();
  for (const [re, kws] of VIBE_GROUPS) {
    const neg = new RegExp(`\\b(no|without|avoid|not|don'?t want|exclude|skip)\\s+(\\w+\\s+){0,2}?(${re.source})`).test(t);
    if (neg) kws.forEach(k => avoid.add(k));
    else if (re.test(t)) kws.forEach(k => want.set(k, (want.get(k) || 0) + 1));
  }
  const style = /melee|close combat|choppy|charge|assault|fight/.test(t) ? "melee" : /shoot|ranged|gunline|firepower|guns/.test(t) ? "ranged" : "";
  const names = new Set(data.units.filter(u => {
    const n = normName(u.name).replace(/ squad$/, "");
    return n.length > 3 && normName(t).includes(n);
  }).map(u => u.key));
  return { want, avoid, style, names, horde: /horde|lots of|many models|big units|max size|full size/.test(t), elite: /elite|small units|few/.test(t) };
}

/** Best detachment combination for the vibe within the DP budget, respecting Unique tags. */
function pickDetachments(data, prefs, rules) {
  const words = [...prefs.want.keys()];
  const detScore = d => {
    let s = 0;
    for (const k of words) s += (d.text.match(new RegExp(`\\b${k}\\b`, "g")) || []).length * prefs.want.get(k);
    if (prefs.style === "melee") s += (d.text.match(/\bMELEE\b|\bFIGHT\b|\bCHARGE\b/g) || []).length * 0.5;
    if (prefs.style === "ranged") s += (d.text.match(/\bRANGED\b|\bSHOOT/g) || []).length * 0.5;
    for (const k of prefs.avoid) s -= (d.text.match(new RegExp(`\\b${k}\\b`, "g")) || []).length;
    return s;
  };
  const scored = data.detachments.map(d => ({ d, s: detScore(d) }));
  let best = null;
  const consider = combo => {
    if (!combo.length || !detachmentsBudgetOK(combo.map(c => c.d), rules)) return;
    const tags = combo.map(c => c.d.unique).filter(Boolean);
    if (new Set(tags).size !== tags.length) return;
    const dp = combo.reduce((s, c) => s + c.d.dp, 0);
    const score = combo.reduce((s, c) => s + c.s, 0) + dp * 0.4 + Math.random() * 0.6;
    if (!best || score > best.score) best = { combo, score };
  };
  const n = scored.length;
  for (let i = 0; i < n; i++) {
    consider([scored[i]]);
    for (let j = i + 1; j < n; j++) {
      consider([scored[i], scored[j]]);
      for (let k = j + 1; k < n; k++) consider([scored[i], scored[j], scored[k]]);
    }
  }
  return best ? best.combo.map(c => c.d) : [];
}

function generateList({ faction, points, vibe, detachments }) {
  const data = armyData(faction);
  if (!data.units.length) throw new Error(`No converted faction data for ${faction || "this faction"}. Add the faction PDF in Get Data first.`);
  const rules = sizeRules(points);
  const prefs = parseVibe(vibe, data);
  const dets = detachments?.length ? detachments.map(n => data.detachments.find(d => d.name === n)).filter(Boolean) : pickDetachments(data, prefs, rules);
  const detText = dets.map(d => d.text).join(" ");
  const notes = [];

  const weights = prefs.style === "melee" ? [0.7, 1.6] : prefs.style === "ranged" ? [1.6, 0.7] : [1, 1];
  const synergy = u => u.kws.filter(k => !GENERIC_KW.has(k) && new RegExp(`\\b${k}\\b`).test(detText)).length;
  const vibeMatch = u => u.kws.reduce((s, k) => s + (prefs.want.get(k) || 0), 0);
  const avoided = u => u.kws.some(k => prefs.avoid.has(k));
  const jitter = new Map(data.units.map(u => [u.key, 0.85 + Math.random() * 0.3]));
  const score = (u, opt) => {
    const per = u.power.durability * (prefs.style ? 0.6 : 1) + u.power.ranged * weights[0] + u.power.melee * weights[1];
    const value = (per * opt.models) / Math.max(1, opt.points);
    // Variety: each copy already taken makes another one less attractive.
    const variety = Math.pow(0.75, list.units.filter(e => e.key === u.key).length);
    const named = prefs.names.has(u.key) && !list.units.some(e => e.key === u.key) ? 3 : prefs.names.has(u.key) ? 1.3 : 1;
    return value * (1 + 0.6 * vibeMatch(u) + 0.35 * Math.min(3, synergy(u))) * named * jitter.get(u.key) * variety;
  };

  const list = { id: uid(), version: 2, name: "", faction, points, detachments: dets.map(d => d.name), units: [], createdAt: Date.now(), updatedAt: Date.now() };
  const ev = () => evaluateList(list, data);
  const count = key => list.units.filter(e => e.key === key).length;
  const maxCopies = u => unitMax(u, rules);
  const nextCost = (u, opt) => (count(u.key) + 1 >= 3 && opt.later ? opt.later : opt.points);
  const fits = (u, opt) => count(u.key) < maxCopies(u) && nextCost(u, opt) <= ev().left;
  const add = (u, opt) => { const e = { id: uid(), key: u.key, models: opt.models, enh: null, attachTo: null, slot: null, warlord: false }; list.units.push(e); return e; };
  const sizeFor = u => {
    const opts = u.options;
    if (prefs.horde) return opts[opts.length - 1];
    return opts[0];
  };
  const wantsTransports = /transport|rhino|impulsor|repulsor|land raider|mechani[sz]ed|drop pod/i.test(vibe || "");
  const pool = data.units.filter(u => !avoided(u) && (!u.transport || wantsTransports || prefs.names.has(u.key)));

  // 1. Units the player named
  for (const key of prefs.names) {
    const u = pool.find(x => x.key === key);
    if (u && fits(u, sizeFor(u))) add(u, sizeFor(u));
  }
  // 2. Characters, preferring those who can lead strong bodyguards
  const bodyguards = pool.filter(u => !u.character && !u.transport);
  const charTarget = rules.name === "Incursion" ? 1 : points <= 2000 ? 2 : 3;
  const charScore = c => {
    const guards = bodyguards.filter(b => canAttach(c, b));
    const guardBest = Math.max(0, ...guards.map(b => score(b, b.options[0])));
    return (guards.length ? 1 + guardBest : 0.2) * (1 + 0.6 * vibeMatch(c) + 0.35 * synergy(c)) * jitter.get(c.key) * (prefs.names.has(c.key) ? 3 : 1);
  };
  const charsSorted = pool.filter(u => u.character).sort((a, b) => charScore(b) - charScore(a));
  for (const c of charsSorted) {
    if (list.units.filter(e => data.units.find(x => x.key === e.key)?.character).length >= charTarget) break;
    if (c.epic && list.units.some(e => data.units.find(x => x.key === e.key)?.epic) && !prefs.names.has(c.key)) continue;
    if (fits(c, c.options[0]) && c.options[0].points <= points * 0.3) add(c, c.options[0]);
  }
  // 3. A bodyguard for each character
  for (const ce of list.units.filter(e => data.units.find(x => x.key === e.key)?.character)) {
    const c = data.units.find(x => x.key === ce.key);
    const hasHost = list.units.some(e => { const u = data.units.find(x => x.key === e.key); return !u.character && canAttach(c, u); });
    if (hasHost) continue;
    const options = bodyguards.filter(b => canAttach(c, b)).map(b => ({ b, opt: sizeFor(b) })).filter(o => fits(o.b, o.opt)).sort((x, y) => score(y.b, y.opt) - score(x.b, x.opt));
    if (options[0]) add(options[0].b, options[0].opt);
  }
  // 4. Battleline to hold objectives
  const blTarget = rules.name === "Incursion" ? 1 : 2;
  for (const b of pool.filter(u => u.battleline && !u.character).sort((x, y) => score(y, sizeFor(y)) - score(x, sizeFor(x)))) {
    if (list.units.filter(e => data.units.find(x => x.key === e.key)?.battleline).length >= blTarget) break;
    if (fits(b, sizeFor(b))) add(b, sizeFor(b));
  }
  // 5. Fill with the best remaining units (a small reserve is kept for enhancements)
  const reserve = Math.min(rules.enh * 15, Math.round(points * 0.03));
  const fill = (minReserve) => {
    for (let guard = 0; guard < 60; guard++) {
      const left = ev().left - minReserve;
      const cands = pool.filter(u => !u.character || list.units.filter(e => data.units.find(x => x.key === e.key)?.character).length < charTarget + 1)
        .map(u => ({ u, opt: sizeFor(u) })).filter(o => fits(o.u, o.opt) && nextCost(o.u, o.opt) <= left && !(o.u.epic && count(o.u.key)));
      if (!cands.length) break;
      cands.sort((a, b) => score(b.u, b.opt) * (b.u.character ? 0.5 : 1) - score(a.u, a.opt) * (a.u.character ? 0.5 : 1));
      add(cands[0].u, cands[0].opt);
    }
  };
  fill(reserve);

  // 6. Attach characters where they help most
  const attachAll = () => {
    for (const ce of list.units.filter(e => !e.attachTo && data.units.find(x => x.key === e.key)?.character)) {
      const c = data.units.find(x => x.key === ce.key), slot = charSlot(c);
      const hosts = list.units.filter(e => {
        const u = data.units.find(x => x.key === e.key);
        return !u.character && canAttach(c, u, slot) && !list.units.some(o => o.attachTo === e.id && (o.slot || "leader") === slot);
      }).map(e => ({ e, u: data.units.find(x => x.key === e.key) }));
      hosts.sort((a, b) => (b.u.kws.filter(k => c.kws.includes(k) && !GENERIC_KW.has(k)).length + b.e.models / 10) - (a.u.kws.filter(k => c.kws.includes(k) && !GENERIC_KW.has(k)).length + a.e.models / 10));
      if (hosts[0]) { ce.attachTo = hosts[0].e.id; ce.slot = slot; }
    }
  };
  attachAll();

  // 7. Enhancements and upgrades
  const enhPool = dets.flatMap(d => d.enhancements).filter(e => e.points > 0 || e.points === 0);
  const enhScore = (e, u) => (1 + (e.text.toUpperCase().match(new RegExp(`\\b(${[...prefs.want.keys()].join("|") || "Ω"})\\b`, "g")) || []).length * 0.5) * (u.character ? 1.3 : 1) * (0.9 + Math.random() * 0.2);
  // One per attached unit, at most the battle size's limit, Upgrades up to their copy limit.
  for (let i = 0; i < rules.enh + 6; i++) {
    const r0 = ev();
    const used = new Map();
    for (const x of r0.entries) for (const p of x.picks || []) used.set(p.name, (used.get(p.name) || 0) + 1);
    const options = [];
    for (const x of r0.entries.filter(x => x.unit)) {
      if (attachedGroup(r0.entries, x).some(o => o.enh || o.upg)) continue;
      for (const en of enhPool) {
        if ((used.get(en.name) || 0) >= enhLimit(en) || !canTakeEnhancement(x.unit, en) || en.points > r0.left) continue;
        if (!(en.upgrade && used.has(en.name)) && r0.enhCount >= rules.enh) continue;
        options.push({ e: list.units.find(o => o.id === x.id), en, s: enhScore(en, x.unit) });
      }
    }
    if (!options.length) break;
    options.sort((a, b) => b.s - a.s);
    options[0].e[options[0].en.upgrade ? "upg" : "enh"] = options[0].en.name;
  }

  // 8. Spend what's left: bigger units first, then anything that fits
  for (let guard = 0; guard < 20; guard++) {
    const left = ev().left;
    const ups = list.units.map(e => {
      const u = data.units.find(x => x.key === e.key);
      const idx = u.options.findIndex(o => o.models === e.models);
      const next = u.options[idx + 1];
      return next ? { e, u, next, diff: next.points - u.options[idx].points } : null;
    }).filter(x => x && x.diff <= left && !prefs.elite).sort((a, b) => score(b.u, b.next) - score(a.u, a.next));
    if (!ups.length) break;
    ups[0].e.models = ups[0].next.models;
  }
  fill(0);
  attachAll();

  // Warlord: a Supreme Commander if present, otherwise the most expensive character
  const chars = list.units.filter(e => data.units.find(x => x.key === e.key)?.character);
  const lord = chars.find(e => data.units.find(x => x.key === e.key).supreme) || chars.sort((a, b) => (data.units.find(x => x.key === b.key).options[0].points) - (data.units.find(x => x.key === a.key).options[0].points))[0];
  if (lord) lord.warlord = true;

  // Notes for the player
  const r = ev();
  const matched = [...prefs.want.keys()].map(k => titleCase(k)).slice(0, 4);
  notes.push(`Detachments: ${dets.map(d => `${d.name} (${d.dp} DP)`).join(", ")}${detachments?.length ? "" : matched.length ? ` — picked to suit ${matched.join(", ")}` : " — picked for a balanced force"}.`);
  for (const e of r.entries.filter(x => x.attachTo)) {
    const host = r.entries.find(h => h.id === e.attachTo);
    notes.push(`${e.unit.name} ${e.slot === "support" ? "supports" : "leads"} ${host.unit.name}.`);
  }
  const syn = r.entries.filter(x => x.unit && synergy(x.unit) > 0 && !x.unit.character).map(x => x.unit.name);
  if (syn.length) notes.push(`Units the detachment rules call out: ${[...new Set(syn)].slice(0, 6).join(", ")}.`);
  list.generated = { vibe, notes };
  list.name = `${faction} – ${dets[0]?.name || "Army"} (${points})`;
  return list;
}

/** Plain-text army list for copying. */
function listToText(list) {
  const r = evaluateList(list);
  const lines = [`${list.name}`, `${list.faction} · ${r.rules.name} · ${r.total} / ${list.points} points`, `Detachments: ${list.detachments.join(", ") || "none"}`, ""];
  const line = (x, indent = "") => `${indent}${x.warlord ? "★ " : ""}${x.unit?.name || x.key} (${x.models} model${x.models === 1 ? "" : "s"}) — ${x.cost} pts${(x.picks || []).map(p => `\n${indent}   • ${p.name} (+${p.points} pts)`).join("")}${weaponSummary(x) ? `\n${indent}   ${weaponSummary(x)}` : ""}`;
  for (const x of r.entries.filter(x => !x.attachTo)) {
    lines.push(line(x));
    for (const c of r.entries.filter(c => c.attachTo === x.id)) lines.push(line(c, "   ↳ "));
  }
  return lines.join("\n");
}let listSaveTimer = null;
function saveList(list, now = false) {
  list.updatedAt = Date.now();
  const i = state.lists.findIndex(l => l.id === list.id);
  if (i < 0) state.lists.push(list); else state.lists[i] = list;
  clearTimeout(listSaveTimer);
  const doSave = () => DB.put("lists", list).catch(() => toast("Couldn't save the list"));
  if (now) return doSave();
  listSaveTimer = setTimeout(doSave, 400);
}

/** Highest number of copies allowed for a unit. */
/** Copies of one datasheet allowed: doubled for Battleline and Dedicated Transports, one for an Epic Hero (Core Rules 25.03). */
const unitMax = (u, rules) => (u.epic ? 1 : u.battleline || u.transport ? rules.dup * 2 : rules.dup);

export { attachedGroup, enhancementsCounted, enhLimit, pointSizes, armyData, canAttach, canTakeEnhancement, charSlot, detachmentsBudgetOK, evaluateList, generateList, listToText, saveList, sizeRules, unitMax };
