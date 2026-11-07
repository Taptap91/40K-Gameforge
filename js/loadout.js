/* RulesForge · loadout.js
 * Wargear: model groups, default weapons, swap options and limits read from datasheets, and weapon changes in the list builder.
 */
import { normName, stripRich, titleCase } from "./text.js?v=8.11";

/** "Bolt Rifle - Focused Fire" → "Bolt Rifle". */
const weaponBase = name => String(name || "").split(/\s+[-–—]\s+/)[0].replace(/\s+non-?\s*$/i, "").trim();/** Loose name key for matching wargear text to weapons ("Lightning Claws" → "lightning claw"). */
const gearKey = s => normName(String(s || "").replace(/\(.*?\)/g, "").replace(/(\s+non-?)+\s*$/i, "").replace(/(\w)[-‐‑](\w)/g, "$1$2")).split(" ").map(w => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w)).join(" ");

const wargearCache = new WeakMap();
/** Model groups, default weapons and swap options read from a datasheet. */
function wargearOf(ds) {
  if (wargearCache.has(ds)) return wargearCache.get(ds);
  const weapons = ds.weapons || [];
  const bases = [...new Set(weapons.map(w => weaponBase(w.name)))];
  const byKey = new Map(bases.map(b => [gearKey(b), b]));
  const findWeapon = text => {
    const k = gearKey(text);
    if (byKey.has(k)) return byKey.get(k);
    // "1 Storm Bolter (that model's...)" or "Twin lightning claws": longest weapon name inside the text
    let best = null, bestAt = Infinity, bestLen = 0;
    for (const [wk, b] of byKey) {
      const at = (` ${k} `).indexOf(` ${wk} `);
      if (at < 0) continue;
      if (at < bestAt || (at === bestAt && wk.length > bestLen)) { best = b; bestAt = at; bestLen = wk.length; }
    }
    if (!best && k.length > 3) for (const [wk, b] of byKey) if (wk.startsWith(k + " ") || (k.length > 8 && wk.endsWith(" " + k))) best = b;
    return best;
  };
  const sec = re => ds.sections.find(s => re.test(s.heading));
  const comp = sec(/^UNIT COMPOSITION/), opts = sec(/^WARGEAR OPTIONS/);
  const compText = stripRich(comp?.text || "").replace(/\s+/g, " ")
    // "…1 shearing claws WARGEAR OPTIONS per …": stray heading text after the equipment list
    .replace(/(equipped with:?[^.]*?)\s+[A-Z]{3,}(?:\s+[A-Z]{3,})+\b.*$/, "$1.")
    // "1 Typhus – EPIC HERO": the role label isn't part of the model's name
    .replace(/\s+[–-]\s+EPIC HERO\b/g, "");

  // "1 Bolt Pistol; 1 Storm Shield and 1 Thunder Hammer" → items; "claws and teeth" stays whole when it's one weapon's name.
  const splitGear = text => String(text).split(/\s*[;,]\s*/).flatMap(part => {
    const clean = x => x.trim().replace(/^\d+\s*x?\s*(additional\s+)?/i, "").replace(/[.*]+$/, "");
    if (findWeapon(clean(part)) && !/\band\s+\d/.test(part)) return [clean(part)];
    return part.split(/\s+and\s+/).map(clean);
  }).filter(Boolean);
  // Model groups: "1 Intercessor Sergeant model", "4-9 Intercessor models"
  const groups = [];
  for (const m of compText.matchAll(/(?:^|[•\s])(\d+)(?:\s*[-–]\s*(\d+))?\s+([A-Z][^•.:;\d]*?)(?:\s+models?\b|(?=\s+\d)|(?=\s+(?:Every|Each|This|The)\b)|\s*$)/g)) {
    const name = m[3].replace(/\s+(Every|Each|This|The|All)\b.*$/, "").trim();
    if (/^(every|this|the)\b/i.test(name)) continue;
    groups.push({ name, key: gearKey(name), min: +m[1], max: +(m[2] || m[1]), defaults: [] });
  }
  if (!groups.length) groups.push({ name: ds.name, key: gearKey(ds.name), min: 1, max: 99, defaults: [], fallback: true });

  // Who is equipped with what
  let foundEquip = false;
  for (const clause of compText.split(/[•.]|\s(?=(?:Every|Each|This|The|All)\s[^.;:]*?\b(?:is|are) equipped)/)) {
    const m = clause.trim().match(/^(.*?)\s+(?:is|are) equipped with:?\s*(.*)$/i);
    if (!m) continue;
    const who = m[1].trim();
    const weaponsHere = splitGear(m[2]).map(findWeapon).filter(Boolean);
    foundEquip = true;
    const targets = /^(every|each|all) models?\b|^this (model|unit)\b/i.test(who) || groups.length === 1 ? groups : [matchGroup(groups, who)].filter(Boolean);
    for (const g of targets) for (const w of weaponsHere) if (!g.defaults.includes(w)) g.defaults.push(w);
  }

  // Swap options, one sentence each, with their bullet lists
  const options = [];
  // Rejoin sentences that were wrapped across lines in the PDF.
  const lines = [];
  for (const l of (opts?.lines || stripRich(opts?.text || "").split("\n")).map(l => stripRich(l).trim()).filter(Boolean)) {
    const prev = lines[lines.length - 1];
    if (prev && !/^[•●▪*\d-]/.test(l) && !/^[•●▪\d-]/.test(prev) && !/[.:]$/.test(prev)) lines[lines.length - 1] = prev + " " + l;
    else lines.push(l);
  }
  const rules = [];
  for (const line of lines) {
    const last = rules[rules.length - 1];
    if (/^[•●▪-]\s*/.test(line) || (last && /one of the following:?$/i.test(last.text) && /^\d+\s/.test(line) && !/\bcan\b/.test(line))) {
      if (last) last.bullets.push(line.replace(/^[•●▪-]\s*/, ""));
      continue;
    }
    for (const s of line.split(/(?<=\.)\s+|(?<![,:])\s+(?=(?:The|Any number of|All|For every|Up to|This unit|This model(?:[’']s)?|Each|If this unit)\s[^.]*?\bcan\b)/)) if (s.trim()) rules.push({ text: s.trim(), bullets: [] });
  }
  // Squads whose composition names only one kind of model: find the Sergeant-equivalent
  // from the stat-line names, or from options that name one model ("The Plague Champion's boltgun…").
  const squadMax = Math.max(1, ...(ds.points || []).map(p => p.models || 1));
  if (squadMax > 1 && groups.length === 1) {
    const main = groups[0];
    const leaders = [];
    const add = name => {
      const n = String(name || "").trim();
      if (n && !groups.some(g => g.key === gearKey(n)) && !leaders.some(l => l.key === gearKey(n)) && gearKey(n) !== gearKey(ds.name)) leaders.push({ name: n, key: gearKey(n) });
    };
    const named = rules.map(r => r.text.match(/^The ((?:[A-Z][\w’'-]*\s?){1,6}?)(?:[’']s\b|\s+can\b|\s+is\b)/)?.[1]?.trim()).filter(Boolean);
    const profileNames = [...new Set((ds.profiles || []).map(p => p.name).filter(Boolean))];
    if (profileNames.length > 1) {
      // The rank-and-file stat line is the one whose name sits inside another ("Intercessor" / "Intercessor Sergeant"),
      // or the one no option names on its own.
      const k = n => ` ${gearKey(n)} `;
      const isLeader = n => named.some(x => gearKey(x) === gearKey(n)) || profileNames.some(o => o !== n && k(n).includes(k(o)));
      const ranks = profileNames.filter(n => !isLeader(n));
      if (main.fallback && ranks.length === 1) { main.name = ranks[0]; main.key = gearKey(ranks[0]); }
      for (const n of profileNames) if (isLeader(n)) add(n);
    }
    for (const n of named) add(n);
    for (const l of leaders.slice(0, 2)) {
      groups.unshift({ name: l.name, key: l.key, min: 1, max: 1, defaults: [...main.defaults] });
      // Take the leader out of the main count when the composition counted every model.
      if (main.fallback || main.max >= squadMax) { main.min = Math.max(0, main.min - 1); main.max = Math.max(main.min, main.max - 1); }
    }
  }
  const mainGroup = groups.find(x => x.max > x.min) || groups[groups.length - 1];
  for (const r of rules) {
    let t = r.text;
    // "This model's Storm Bolter can be replaced with…" → "This model can have their Storm Bolter replaced with…"
    t = t.replace(/^(.+?)[’'](?:s\b)?\s+(.+?)\s+can (?:each )?be replaced with/i, "$1 can have their $2 replaced with");
    const who = t.split(/\s+can\s+/i)[0] || "";
    const whoName = who.replace(/^for every \d+ models? in this unit,?\s*(up to\s+\d+\s*)?/i, "");
    let targets;
    if (/^this (unit|model)\b/i.test(who)) targets = [groups.length === 1 ? groups[0] : mainGroup];
    else {
      const g = matchGroup(groups, whoName);
      if (g) targets = [g];
      else if (/\bmodels?\b/i.test(whoName) || groups.length === 1) targets = /^(any number of|all|each)\b/i.test(who) ? groups : [mainGroup];
      else continue;
    }
    for (const g of targets) {
    let max;
    let m;
    if ((m = who.match(/^For every (\d+) models? in this unit,?\s*(?:up to\s+)?(\d+)/i))) max = { per: +m[1], n: +m[2] };
    else if (/^(any number of|all|each)\b/i.test(who) || /\beach\b/i.test(t.split(/\bhave\b|\bbe\b/)[0])) max = { all: true };
    else if ((m = who.match(/^up to (\d+)/i))) max = { n: +m[1] };
    else if ((m = who.match(/^(\d+)\s/))) max = { n: +m[1] };
    else if ((m = t.match(/can be equipped with (?:up to )?(\d+)/i)) && /^this unit/i.test(who)) max = { n: 1 };
    else max = { n: 1 };
    const repl = t.match(/have (?:their|its|his|her) (.+?) replaced with/i);
    const replaces = repl ? repl[1].split(/\s*(?:,|\band\b)\s*/).map(findWeapon).filter(Boolean) : [];
    if (repl && !replaces.length) continue;
    let choiceTexts;
    if (/one of the following/i.test(t)) {
      // Bullets can arrive run together ("1 plasma cannon 1 twin lascannon"), or after the colon on the same line.
      const inline = t.split(/one of the following:?/i)[1]?.trim();
      choiceTexts = [...(inline ? [inline] : []), ...r.bullets].flatMap(b => b.split(/(?<!\band)\s+(?=\d+\s+[A-Za-z])/));
    }
    else {
      const w = t.match(/(?:replaced with|can (?:each )?be equipped with)\s+(?:up to\s+)?(.+?)\.?$/i);
      choiceTexts = w ? [w[1]] : [];
    }
    let choices = choiceTexts.map(c => splitGear(c.replace(/\(.*?\)/g, "")).map(findWeapon).filter(Boolean));
    // Swapping a weapon for wargear that isn't a weapon (a shield) just removes the weapon.
    if (replaces.length && choiceTexts.length && choices.every(c => !c.length)) choices = [[]];
    choices = choices.filter((c, i) => c.length || (replaces.length && choices.length === 1));
    if (!choices.length) continue;
    options.push({ group: g.name, replaces, choices, max, text: t });
    }
  }
  // Readable layout of the options: one rule per paragraph, its choices as bullets.
  const display = rules.map(r => {
    const t = r.text, cut = t.search(/one of the following:?/i);
    const head = cut >= 0 ? t.slice(0, cut).trim() + " one of the following:" : t;
    const inline = cut >= 0 ? t.slice(cut).replace(/^one of the following:?/i, "").trim() : "";
    const bullets = [...(inline ? [inline] : []), ...r.bullets].flatMap(b => b.split(/(?<!\band)\s+(?=\d+\s+[A-Za-z])/)).map(b => b.trim()).filter(Boolean);
    return { text: head, bullets };
  });
  const out = { groups, options, bases, free: !foundEquip, display };
  wargearCache.set(ds, out);
  return out;
}

function matchGroup(groups, text) {
  const k = ` ${gearKey(text)} `;
  let best = null;
  for (const g of groups) if (k.includes(` ${g.key} `) && (!best || g.key.length > best.key.length)) best = g;
  return best;
}

/** How many models are in each group for a unit of `size` models. */
function groupSizes(wg, size) {
  const fixed = wg.groups.filter(g => g.min === g.max && !g.fallback).reduce((s, g) => s + g.min, 0);
  let rest = Math.max(0, size - fixed);
  return Object.fromEntries(wg.groups.map(g => {
    if (g.fallback) return [g.name, Math.max(0, size - fixed)];
    if (g.min === g.max) return [g.name, g.min];
    const n = Math.max(g.min, Math.min(g.max, rest));
    rest -= n;
    return [g.name, n];
  }));
}
const optionMax = (o, groupN, unitSize) => Math.min(groupN, o.max.all ? groupN : o.max.per ? Math.floor(unitSize / o.max.per) * o.max.n : o.max.n);

/** Weapons each group can carry, the most models that can carry each, and current counts. */
function loadoutOf(x) {
  const wg = wargearOf(x.unit.ds);
  const sizes = groupSizes(wg, x.models);
  return wg.groups.map(g => {
    const N = sizes[g.name];
    const opts = wg.options.filter(o => o.group === g.name);
    const reach = new Map();
    for (const w of g.defaults) reach.set(w, N);
    for (const o of opts) for (const c of o.choices) for (const w of c) if (!g.defaults.includes(w)) reach.set(w, Math.min(N, (reach.get(w) || 0) + optionMax(o, N, x.models)));
    if (wg.free) for (const b of wg.bases) reach.set(b, N);
    const saved = x.load?.[g.name];
    const counts = {};
    for (const w of reach.keys()) {
      const base = g.defaults.includes(w) ? N : 0;
      let c = saved && w in saved.c ? saved.c[w] + (g.defaults.includes(w) ? N - saved.n : 0) : base;
      counts[w] = Math.max(0, Math.min(N, c));
    }
    const types = new Map([...reach.keys()].map(w => [w, (x.unit.ds.weapons || []).find(v => weaponBase(v.name) === w)?.type || ""]));
    return { name: g.name, N, defaults: g.defaults, options: opts, reach, counts, types, free: wg.free };
  }).filter(g => g.N > 0);
}

/** Checks one group's counts against the datasheet's swap rules. Returns "" if legal. */
function loadoutProblem(gr, unitSize) {
  const ws = [...gr.reach.keys()];
  const target = ws.map(w => gr.counts[w] - (gr.defaults.includes(w) ? gr.N : 0));
  if (gr.free || target.every(v => v === 0)) return "";
  const moves = [];
  for (const o of gr.options) {
    const cap = optionMax(o, gr.N, unitSize);
    moves.push({ cap, deltas: o.choices.map(c => ws.map(w => (c.includes(w) ? 1 : 0) - (o.replaces.includes(w) ? 1 : 0))) });
  }
  let steps = 0;
  const cur = ws.map(() => 0);
  const solve = (i) => {
    if (++steps > 200000) return true; // too many combinations to check: don't flag it
    if (i === moves.length) return cur.every((v, k) => v === target[k]);
    const { cap, deltas } = moves[i];
    const spread = (j, left) => {
      if (j === deltas.length) return solve(i + 1);
      for (let n = 0; n <= left; n++) {
        for (let k = 0; k < ws.length; k++) cur[k] += deltas[j][k] * n;
        const ok = spread(j + 1, left - n);
        for (let k = 0; k < ws.length; k++) cur[k] -= deltas[j][k] * n;
        if (ok) return true;
      }
      return false;
    };
    return spread(0, cap);
  };
  if (solve(0)) return "";
  return `${gr.name}: ${loadoutIssues(gr, unitSize).map(i => i.msg).join(" ")}`;
}

/** Why a group's weapons aren't legal, each tied to the ranged or melee section it's about. */
function loadoutIssues(gr, unitSize) {
  const out = [];
  const type = w => gr.types?.get(w) || "";
  const { left, gap } = optionUsage(gr, unitSize);
  const many = gr.N > 1;
  const explained = new Set(), quietDefaults = new Set();
  // Shared limits: "for every 5 models, 1 can take one of the following" covers all of those weapons together.
  for (const o of gr.options) {
    const only = [...new Set(o.choices.flat())].filter(w => !gr.defaults.includes(w) && gr.options.every(p => p === o || !p.choices.some(ch => ch.includes(w))));
    const taken = only.reduce((n, w) => n + (gr.counts[w] || 0), 0);
    const cap = optionMax(o, gr.N, unitSize);
    if (only.length > 1 && taken > cap) {
      out.push({ type: type(only[0]), ws: only.filter(w => gr.counts[w] > 0), msg: `Only ${cap} model${cap === 1 ? "" : "s"} in total can take ${only.join(", ").replace(/, ([^,]*)$/, " or $1")} at this unit size (${taken} chosen).` });
      for (const w of only) explained.add(w);
      for (const r of o.replaces) quietDefaults.add(r);
    }
  }
  for (const w of gr.reach.keys()) {
    if (gr.defaults.includes(w) || !(gr.counts[w] > 0) || explained.has(w)) continue;
    const max = gr.reach.get(w) ?? 0;
    if (gr.counts[w] > max) { out.push({ type: type(w), ws: [w], msg: max ? `Only ${max} model${max === 1 ? "" : "s"} can take ${w} at this unit size.` : `${w} can't be taken by this model.` }); continue; }
    if (left[w] > 0) {
      const opt = gr.options.find(o => o.choices.some(ch => ch.includes(w)));
      const ch = opt?.choices.find(c => c.includes(w)) || [];
      const repl = (opt?.replaces || []).filter(r => !ch.includes(r));
      out.push({ type: type(w), ws: [w, ...repl], msg: repl.length ? `${w} replaces ${repl.join(" and ")}, so uncheck ${repl.length > 1 ? "them" : "it"}${many ? " for that model" : ""}.` : `${w} can't be added alongside the other choices here.` });
    }
  }
  for (const d of gr.defaults) if (gap[d] > 0 && !quietDefaults.has(d)) out.push({ type: type(d), ws: [d], msg: `${d} was removed without picking a weapon to replace it${many ? ` (${gap[d]} model${gap[d] === 1 ? "" : "s"})` : ""}.` });
  if (!out.length) out.push({ type: "", ws: [], msg: "This weapon combination isn't allowed by the datasheet's Wargear Options." });
  return out;
}

/** Which weapons checking `w` should replace: the option whose replaced weapon (or other pick) is equipped, same type first. */
function swapFor(gr, w) {
  const opts = gr.options.filter(o => o.choices.some(ch => ch.includes(w)));
  if (!opts.length) return null;
  const t = gr.types?.get(w);
  const info = o => {
    const ci = o.choices.findIndex(ch => ch.includes(w));
    const out = o.replaces.filter(r => !o.choices[ci].includes(r));
    const others = o.choices.flatMap((ch, k) => (k === ci ? [] : ch)).filter(x => !gr.defaults.includes(x) && x !== w);
    const busy = out.some(r => (gr.counts[r] ?? 0) > 0) || others.some(x => (gr.counts[x] ?? 0) > 0);
    const score = (busy ? 2 : 0) + (out.some(r => gr.types?.get(r) === t) || others.some(x => gr.types?.get(x) === t) ? 1 : 0);
    return { o, out, others, score };
  };
  return opts.map(info).sort((a, b) => b.score - a.score)[0];
}

/** − / + on a weapon (how is +1 or −1): adding a swap-in takes it from the weapons it replaces, and the other way round. */
function setWeapon(gr, w, how) {
  const c = { ...gr.counts };
  const N = gr.N, isDefault = gr.defaults.includes(w);
  const cur = c[w] ?? 0;
  const max = isDefault ? N : Math.max(1, gr.reach.get(w) ?? N);
  // Weapons that can take default weapon r's place
  const swapsOf = r => gr.options.filter(o => o.replaces.includes(r)).flatMap(o => o.choices.filter(ch => !ch.includes(r)).flat()).filter(x => !gr.defaults.includes(x));
  const carried = r => (c[r] ?? 0) + [...new Set(swapsOf(r))].reduce((n, x) => n + (c[x] ?? 0), 0);
  // Only when the default plus its replacements would be more than the models can carry, the default goes down.
  const fitDefault = r => { const over = carried(r) - N; if (over > 0) c[r] = Math.max(0, (c[r] ?? 0) - over); };
  // …and the other way round: re-adding a default trims a replacement only when there's no room.
  const fitSwaps = r => { let over = carried(r) - N; for (const x of [...new Set(swapsOf(r))]) { if (over <= 0) break; const k = Math.min(over, c[x] ?? 0); c[x] = (c[x] ?? 0) - k; over -= k; } };
  // +1 / −1
  if (how > 0) {
    if (cur >= max) return c;
    c[w] = cur + 1;
    if (isDefault) fitSwaps(w);
    else { const s = swapFor(gr, w); for (const r of s?.out || []) fitDefault(r); }
    return c;
  }
  if (cur <= 0) return c;
  c[w] = cur - 1;
  if (!isDefault) { const s = swapFor(gr, w); for (const r of s?.out || []) if ((c[r] ?? 0) > 0) c[r] = Math.min(N, c[r] + 1); }
  return c;
}

/** Applies one option in the direction of `sign` so swaps happen automatically when a weapon is added or removed. */
/** Which swap options the current weapons use: each taken weapon is matched to the option whose replaced weapon is missing. */
function optionUsage(gr, unitSize) {
  const left = {}, gap = {};
  for (const w of gr.reach.keys()) {
    if (gr.defaults.includes(w)) gap[w] = Math.max(0, gr.N - (gr.counts[w] || 0));
    else left[w] = gr.counts[w] || 0;
  }
  const uses = gr.options.map(o => ({ o, cap: optionMax(o, gr.N, unitSize), total: 0, byChoice: o.choices.map(() => 0) }));
  // What a choice really removes: a Cyclone Missile Launcher "and 1 Storm Bolter" keeps the Storm Bolter.
  const removes = (o, ch) => o.replaces.filter(r => !ch.includes(r));
  for (let guard = 0; guard < 200; guard++) {
    let best = null;
    for (const u of uses) {
      if (u.total >= u.cap) continue;
      u.o.choices.forEach((ch, ci) => {
        const extra = ch.filter(w => !gr.defaults.includes(w));
        const rem = removes(u.o, ch);
        if (extra.some(w => !(left[w] > 0))) return;
        if (rem.some(r => !(gap[r] > 0))) return;
        if (!extra.length && !rem.length) return;
        // Prefer swaps that explain a missing weapon, then plain additions, then weapon removals.
        const score = (rem.length ? 2 : 1) + (extra.length ? 1 : 0) - u.o.choices.length * 0.01;
        if (!best || score > best.score) best = { u, ci, extra, rem, score };
      });
    }
    if (!best) break;
    for (const w of best.extra) left[w]--;
    for (const r of best.rem) gap[r]--;
    best.u.total++; best.u.byChoice[best.ci]++;
  }
  const replacedUse = {};
  for (const u of uses) u.o.choices.forEach((ch, ci) => { for (const r of removes(u.o, ch)) replacedUse[r] = (replacedUse[r] || 0) + u.byChoice[ci]; });
  return { uses, replacedUse, removes, left, gap };
}

/** The most models that can carry each weapon right now, given the rest of the loadout. */
function weaponLimits(gr, unitSize) {
  const lim = new Map();
  if (gr.free) { for (const w of gr.reach.keys()) lim.set(w, gr.N); return lim; }
  const { uses, replacedUse } = optionUsage(gr, unitSize);
  // A default weapon that was unticked leaves a free slot for its replacement.
  const avail = r => (gr.counts[r] ?? 0) + Math.max(0, gr.N - (gr.counts[r] ?? 0) - (replacedUse[r] || 0));
  for (const w of gr.reach.keys()) {
    if (gr.defaults.includes(w)) { lim.set(w, Math.max(0, gr.N - (replacedUse[w] || 0))); continue; }
    let room = gr.counts[w] || 0;
    for (const u of uses) {
      if (!u.o.choices.some(ch => ch.includes(w))) continue;
      const ch = u.o.choices.find(c => c.includes(w));
      const free = Math.min(u.cap - u.total, ...u.o.replaces.filter(r => !ch.includes(r)).map(avail));
      if (free > 0) room += free;
      // "One of the following" for a single pick: choosing this one swaps out the other.
      else if (u.cap === 1 && u.total === 1 && !(gr.counts[w] > 0)) room += 1;
    }
    lim.set(w, Math.min(gr.N, room));
  }
  return lim;
}

/** Unconditional "This unit's (ranged/melee) attacks have X." lines from a character's abilities. */
function attackBuffs(abilities, source) {
  const out = [];
  for (const a of abilities || []) {
    for (const s of stripRich(a.text || "").split(/(?<=\.)\s+/)) {
      const t = s.trim();
      // "While this model is leading a unit, melee weapons equipped by models in that unit have the [SUSTAINED HITS 1] and [LANCE] abilities."
      const lead = t.match(/^While this model is leading a unit,\s*(ranged |melee )?weapons equipped by models in that unit have (?:the )?(.+?) abilit(?:y|ies)\.?$/i);
      if (lead) {
        const type = lead[1] ? (/melee/i.test(lead[1]) ? "Melee" : "Ranged") : null;
        for (const kw of lead[2].split(/\]\s*(?:,|and)\s*\[|\s+and\s+|,\s*/)) {
          const clean = kw.replace(/[\[\]]/g, "").trim();
          if (!clean) continue;
          const [k, cond] = clean.split(/\s*:\s*/);
          out.push({ type, keyword: titleCase(k.toUpperCase()) + (cond ? ` (${cond})` : ""), source, ability: a.name });
        }
        continue;
      }
      // "While this model is leading a unit, add 1 to the Attacks characteristic of melee weapons equipped by models in that unit."
      const add = t.match(/^While this model is leading a unit,\s*add (\d+) to the (Attacks|Strength|Damage)(?: and (Attacks|Strength|Damage))? characteristics? of (ranged |melee )?weapons equipped by models in that unit\.?$/i);
      if (add) {
        const type = add[4] ? (/melee/i.test(add[4]) ? "Melee" : "Ranged") : null;
        for (const st of [add[2], add[3]].filter(Boolean)) out.push({ type, stat: { attacks: "A", strength: "S", damage: "D" }[st.toLowerCase()], delta: +add[1], source, ability: a.name });
        continue;
      }
      const m = t.match(/^This unit[’']s (ranged |melee )?attacks have:?\s*(.+?)\.?$/i);
      if (!m) continue;
      const type = m[1] ? (/melee/i.test(m[1]) ? "Melee" : "Ranged") : null;
      const what = m[2].replace(/[\[\]]/g, "").replace(/\s+-\s*/g, "-").replace(/non-\s+/gi, "non-").trim();
      const stat = what.match(/^([+-]\d+)\s*(A|S|D|AP)$/i);
      if (stat) { out.push({ type, stat: stat[2].toUpperCase(), delta: +stat[1], source, ability: a.name }); continue; }
      const [kw, cond] = what.split(/\s*:\s*/);
      out.push({ type, keyword: titleCase(kw.toUpperCase()) + (cond ? ` (${cond.replace(/(^|[\/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/^Non/, "non")})` : ""), source, ability: a.name });
    }
  }
  return out;
}

/** Buffs this entry gets from characters attached alongside it. */
function buffsFor(x, r) {
  const hostId = x.unit?.character ? x.attachTo : x.id;
  if (!hostId) return [];
  return r.entries.filter(c => c.attachTo === hostId && c.id !== x.id && c.unit).flatMap(c => c.unit.buffs || []);
}

/** "5× Chainsword, 4× Heavy Bolt Pistol, 1× Plasma Pistol" across every model in the unit. */
function weaponSummary(x) {
  const total = {};
  for (const g of x.loadout || []) for (const [w, n] of Object.entries(g.counts)) if (n) total[w] = (total[w] || 0) + n;
  return Object.entries(total).map(([w, n]) => `${n}× ${w}`).join(", ");
}

export { attackBuffs, buffsFor, loadoutIssues, loadoutOf, loadoutProblem, setWeapon, wargearOf, weaponBase, weaponLimits, weaponSummary };
