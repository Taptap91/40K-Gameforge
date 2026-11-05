/* RulesForge · search.js
 * Rules search: finds the passages that answer a question, and works out which units and factions it's about.
 */
import { KNOWN_FACTIONS, state } from "./core.js?v=5.5";
import { scopeLabel } from "./rules-chat.js?v=5.5";
import { normName, tokens } from "./text.js?v=5.5";
import { editionLabel, effectiveRules, isRulesDoc, sectionChunks } from "./rules-doc.js?v=5.5";

const SHORTHAND = {
  fnp: "feel no pain", ds: "deep strike", oc: "objective control", mw: "mortal wounds", mws: "mortal wounds",
  cp: "command points", los: "line of sight", ap: "armour penetration", bs: "ballistic skill", ws: "weapon skill",
  ld: "leadership", sv: "save", invuln: "invulnerable save", inv: "invulnerable save", strat: "stratagem",
  strats: "stratagems", pts: "points", dt: "dedicated transport", dev: "devastating wounds", lethals: "lethal hits",
  sustained: "sustained hits", reroll: "re-roll", rerolls: "re-roll", armor: "armour", overwatch: "fire overwatch",
  heroic: "heroic intervention", mfm: "munitorum field manual", char: "character", chars: "character",
  lone: "lone operative", engagement: "engagement range",
  // Past tenses, so "fell back" finds Fall Back and "advanced" finds Advance.
  fell: "fall", fallen: "fall", advanced: "advance", charged: "charge", fought: "fight", shot: "shoot",
  moved: "move", destroyed: "destroy", embarked: "embark", disembarked: "disembark", attacked: "attack",
};
function expandQuery(q) {
  const extra = (q.toLowerCase().match(/[a-z]+/g) || []).map(w => SHORTHAND[w]).filter(Boolean);
  return extra.length ? q + " " + extra.join(" ") : q;
}

/* Datasheet pages show a stat line and ability/keyword headings. */
const DATASHEET_RX = /\bM\s+T\s+SV\s+W\s+LD\s+OC\b|\bABILITIES\b|\bKEYWORDS\b|\bRANGED WEAPONS\b|\bMELEE WEAPONS\b/i;
const NOT_A_UNIT = new Set([
  "abilities", "keywords", "faction keywords", "ranged weapons", "melee weapons", "wargear options", "wargear abilities",
  "unit composition", "leader", "core", "faction", "damaged", "invulnerable save", "stratagems", "enhancements",
  "detachment rule", "transport", "attached unit", "supreme commander", "designer s note", "contents",
].map(s => normName(s)));
/* Words too common to identify a unit on their own ("Captain", "Squad"…). */
const GENERIC_WORDS = new Set(tokens(
  "squad unit veteran captain lieutenant sergeant warrior guard terminator armour armor assault heavy battle command " +
  "champion chapter lord master librarian chaplain ancient apothecary brother sister knight character infantry vehicle " +
  "walker dreadnought tank bike jump pack rule rules shoot shooting fight charge move phase attack hit wound save " +
  "overwatch stratagem ability weapon model models army force"));

function buildIndex() {
  const chunks = [];
  for (const doc of state.docs) {
    if (isRulesDoc(doc)) continue;   // added below, as the rules currently in force
    doc.chunks.forEach((c, ordinal) => chunks.push({
      text: c.text, page: c.page, ordinal, docId: doc.id, docTitle: doc.title, kind: doc.kind, faction: doc.faction || "", cite: c.cite,
    }));
  }
  // Core Rules and updates: one passage per rule section, using the newest version of each rule only,
  // so a replaced rule is never quoted. Each passage says which document (and version) it comes from.
  const eff = effectiveRules();
  eff.sections.forEach(s => {
    const label = `${s.source.title}${editionLabel(s.source.edition) ? ` (${editionLabel(s.source.edition)})` : ""}`;
    const note = s.replaces.length ? `\n[This ${s.source.kind === "updates" ? "update" : "version"} replaces the rule in ${s.replaces.map(r => r.title).join(", ")}.]` : "";
    sectionChunks([s]).forEach((c, ordinal) => chunks.push({
      text: c.text + (ordinal === 0 ? note : ""), page: c.page, ordinal, docId: s.source.docId, docTitle: label, kind: s.source.kind, faction: "", cite: c.cite,
    }));
  });
  const tf = [], df = new Map(), lengths = [];
  for (const c of chunks) {
    const toks = tokens(c.text);
    const counts = new Map();
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
    tf.push(counts);
    lengths.push(toks.length);
    c.lower = c.text.toLowerCase();
    c.norm = normName(c.text);
  }
  const avg = lengths.length ? Math.max(1, lengths.reduce((a, b) => a + b, 0) / lengths.length) : 1;
  state.index = { chunks, tf, df, lengths, avg };
  state.units = buildUnitVocabulary(chunks);
}

/** Unit names come from points tables and from headings on datasheet pages in faction PDFs. */
function buildUnitVocabulary(chunks) {
  const units = new Map();
  const add = (raw, faction) => {
    const name = raw.trim();
    const key = normName(name);
    if (key.length < 4 || NOT_A_UNIT.has(key) || units.has(key)) return;
    const toks = tokens(name);
    // Real unit names have at least one proper word (this rules out stat-line headers like "M T SV W LD OC").
    if (!toks.length || toks.length > 6 || !toks.some(t => t.length >= 4)) return;
    units.set(key, { name: name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()) : name, key, toks, faction });
  };
  for (const doc of state.docs) for (const p of doc.points || []) if (!p.enh) add(p.name, p.section || doc.faction);
  for (const c of chunks) {
    if (c.kind !== "faction" || !DATASHEET_RX.test(c.text)) continue;
    for (const line of c.text.split("\n")) {
      const l = line.trim();
      if (l.length >= 4 && l.length <= 40 && /^[A-Z][A-Z'’\- ]+$/.test(l)) add(l, c.faction);
    }
  }
  // How many unit names share each word, so rare words ("Sternguard") can identify a unit alone.
  const wordCount = new Map();
  for (const u of units.values()) for (const t of new Set(u.toks)) wordCount.set(t, (wordCount.get(t) || 0) + 1);
  for (const u of units.values()) u.distinctive = u.toks.filter(t => t.length >= 5 && !GENERIC_WORDS.has(t) && wordCount.get(t) <= 3);
  return [...units.values()];
}

/** Finds units named in the question: every word of the name, or a distinctive word like "Sternguard". */
function detectUnits(question) {
  const qt = new Set(tokens(question));
  const found = [];
  for (const u of state.units || []) {
    const full = u.toks.every(t => qt.has(t));
    const partial = !full && u.distinctive.some(t => qt.has(t));
    if (full || partial) found.push({ unit: u, score: (full ? 10 : 0) + u.toks.filter(t => qt.has(t)).length });
  }
  found.sort((a, b) => b.score - a.score || b.unit.name.length - a.unit.name.length);
  const picked = [];
  for (const { unit } of found) {
    // Skip near-duplicates such as "Sternguard Veterans" vs "Sternguard Veteran Squad".
    if (picked.some(p => p.distinctive.some(t => unit.toks.includes(t)) || p.key.includes(unit.key) || unit.key.includes(p.key))) continue;
    picked.push(unit);
    if (picked.length === 2) break;
  }
  return picked;
}

const FACTION_NICKNAMES = {
  marines: "Space Marines", astartes: "Space Marines", sisters: "Adepta Sororitas", custodes: "Adeptus Custodes",
  admech: "Adeptus Mechanicus", mechanicus: "Adeptus Mechanicus", eldar: "Aeldari", craftworld: "Aeldari",
  tau: "T'au Empire", nids: "Tyranids", votann: "Leagues of Votann", gsc: "Genestealer Cults", csm: "Chaos Space Marines",
  daemons: "Chaos Daemons", necron: "Necrons", ork: "Orks",
};
function detectFactions(question) {
  const q = " " + normName(question) + " ";
  const names = new Set([...KNOWN_FACTIONS, ...state.docs.map(d => d.faction).filter(Boolean)]);
  const found = [...names].filter(f => q.includes(" " + normName(f) + " "));
  for (const w of q.trim().split(" ")) if (FACTION_NICKNAMES[w] && !found.includes(FACTION_NICKNAMES[w])) found.push(FACTION_NICKNAMES[w]);
  return found;
}

/** Removes unit and faction names so the rule search focuses on the rule itself. */
function stripNames(question, units, factions) {
  const drop = new Set([...units.flatMap(u => u.toks), ...factions.flatMap(f => tokens(f))]);
  return question.split(/\s+/).filter(w => !tokens(w).some(t => drop.has(t))).join(" ");
}

function factionMatches(tag, wanted) {
  const a = normName(tag || ""), b = normName(wanted || "");
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}
const isCoreOrUpdate = c => c.kind === "core" || c.kind === "updates";
function scopeFilter(scope) {
  if (typeof scope === "function") return scope;
  if (scope === "all" || scope === "auto") return () => true;
  if (scope === "core") return isCoreOrUpdate;
  const f = scope.slice(2);
  return c => c.kind !== "faction" || factionMatches(c.faction, f);
}

function bm25(i, queryTokens) {
  const ix = state.index, N = ix.chunks.length, k1 = 1.4, b = 0.75;
  let s = 0;
  for (const t of queryTokens) {
    const f = ix.tf[i].get(t);
    if (!f) continue;
    const d = ix.df.get(t);
    s += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * ix.lengths[i] / ix.avg));
  }
  return s;
}
const toHit = (c, s) => ({ text: c.text, page: c.page, docTitle: c.docTitle, kind: c.kind, score: s, citation: c.cite ? `${c.docTitle} — ${c.cite}` : `${c.docTitle}, p. ${c.page}` });

/** Keyword search. `scope` is "all", "core", "f:<Faction>" or a filter function. */
function search(query, extraTerms = [], scope = "all", limit = 8) {
  const ix = state.index;
  if (!ix || !ix.chunks.length) return [];
  const filter = scopeFilter(scope);
  const q = [...new Set(tokens(expandQuery([query, ...extraTerms].join(" "))))];
  const phrases = [...extraTerms, ...[...query.matchAll(/["“]([^"”]{3,60})["”]/g)].map(m => m[1])]
    .map(p => p.toLowerCase().trim()).filter(p => p.length > 3);
  const scored = [];
  ix.chunks.forEach((c, i) => {
    if (!filter(c)) return;
    let s = bm25(i, q);
    for (const p of phrases) if (c.lower.includes(p)) s += 1.5;
    if (s > 0) scored.push({ i, s });
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(({ i, s }) => toHit(ix.chunks[i], s));
}

/** Finds a unit's datasheet page in the faction PDFs and returns that whole page. */
function datasheetHits(unit, question) {
  const ix = state.index;
  const q = [...new Set(tokens(expandQuery(question)))];
  const nameWords = unit.distinctive.length ? unit.distinctive : unit.toks;
  let best = null;
  ix.chunks.forEach((c, i) => {
    if (c.kind !== "faction") return;
    const nameHere = c.norm.includes(unit.key) || nameWords.every(t => ix.tf[i].has(t));
    if (!nameHere) return;
    const s = (DATASHEET_RX.test(c.text) ? 5 : 0) + (c.norm.includes(unit.key) ? 3 : 0) + bm25(i, q);
    if (!best || s > best.s) best = { c, s };
  });
  if (!best) return [];
  // The passages around the best match (pages can be huge in web-exported PDFs, so not the whole page).
  const o = best.c.ordinal;
  return ix.chunks
    .filter(c => c.docId === best.c.docId && c.page === best.c.page && c.ordinal >= o - 1 && c.ordinal <= o + 2)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(c => toHit(c, best.s));
}

/** Decides which documents a question needs, based on how it's worded. */
function planRetrieval(question) {
  if (state.scope !== "auto") {
    return { groups: [{ label: "RULES EXCERPTS", hits: search(question, [], state.scope, 6) }], searched: scopeLabel(state.scope), units: [] };
  }
  const units = detectUnits(question);
  const factions = detectFactions(question);
  const ruleQuery = stripNames(question, units, factions) || question;
  const hasCore = state.docs.some(d => d.kind === "core" || d.kind === "updates");

  if (units.length) {
    const sheets = units.map(u => ({ label: `DATASHEET — ${u.name}`, hits: datasheetHits(u, question) })).filter(g => g.hits.length);
    let rule = hasCore ? search(ruleQuery, [], isCoreOrUpdate, 3) : [];
    if (!rule.length) rule = search(ruleQuery, [], "all", 3);
    const names = units.map(u => u.name).join(" and ");
    return {
      groups: [{ label: "CORE RULES", hits: rule }, ...sheets],
      searched: `Core Rules + ${names} datasheet${sheets.length ? "" : " (not found — check your faction PDF)"}`,
      units,
    };
  }
  if (factions.length) {
    const inFaction = c => c.kind === "faction" && (!c.faction || factions.some(f => factionMatches(c.faction, f)));
    return {
      groups: [
        { label: "CORE RULES", hits: hasCore ? search(ruleQuery, [], isCoreOrUpdate, 3) : [] },
        { label: `${factions.join(" / ").toUpperCase()} RULES`, hits: search(question, [], inFaction, 3) },
      ],
      searched: `Core Rules + ${factions.join(", ")}`,
      units: [],
    };
  }
  const core = hasCore ? search(question, [], isCoreOrUpdate, 5) : [];
  if (core.length) return { groups: [{ label: "CORE RULES", hits: core }], searched: "Core Rules", units: [] };
  return { groups: [{ label: "RULES EXCERPTS", hits: search(question, [], "all", 6) }], searched: "All sources", units: [] };
}

/** Builds the numbered excerpt text from several labelled groups, sharing the character budget. */
function buildContext(groups, budget) {
  const live = groups.filter(g => g.hits.length);
  let text = "";
  const used = [];
  live.forEach((g, gi) => {
    const share = live.length === 1 ? budget : gi === 0 ? Math.round(budget * 0.5) : Math.round(budget * 0.5 / (live.length - 1));
    const r = numberedExcerpts(g.hits, share, used.length);
    text += `${g.label}:\n${r.text}`;
    used.push(...r.used);
  });
  return { text, used };
}

function numberedExcerpts(hits, budget, startAt = 0) {
  let text = "";
  const used = [];
  for (const h of hits) {
    const header = `[${startAt + used.length + 1}] ${h.citation}\n`;
    let body = h.text;
    if (text.length + header.length + body.length + 2 > budget) {
      if (used.length) break;
      body = body.slice(0, Math.max(200, budget - header.length - 2));
    }
    text += header + body + "\n\n";
    used.push(h);
  }
  return { text, used };
}

export { buildContext, buildIndex, detectFactions, factionMatches, planRetrieval };
