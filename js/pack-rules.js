/* RulesForge · pack-rules.js
 * The faction pack ruleset: the fixed rules every faction pack PDF (or RulesForge Excel file) goes through when it's added,
 * so the same pack gives the same faction name, symbol, colours and layout whoever adds it, on any device.
 *
 *  Rule 1  What counts as a faction pack: a PDF that reads as at least 2 datasheets or 1 detachment. It's treated as a
 *          faction pack whatever type was picked when it was added (picking "Core Rules" by mistake doesn't matter).
 *  Rule 2  Which faction it is, decided by the pack's own contents, in this order:
 *            a. the Faction keywords printed on its datasheets. A sub-faction keyword (DARK ANGELS) beats its parent
 *               (ADEPTUS ASTARTES) when 3 or more datasheets carry it, since a Space Marines book never prints it;
 *            b. the PDF's title, then its file name;
 *            c. the faction typed when it was added (only when the pack itself doesn't say).
 *          The result is always the faction's official name ("dark angles", "DA", "Dark Angels Faction Pack" → Dark Angels).
 *  Rule 3  The symbol: the icon printed beside the faction's own name in the PDF's "Books" table.
 *          Kept from the earlier copy if a newer PDF doesn't have one.
 *  Rule 4  The colours: the built-in pair for every official faction (FACTION_THEMES). A faction that isn't listed takes
 *          its colours from its symbol (the two most common strong colours in it); a plain or missing symbol falls back to
 *          a pair worked out from the faction's name. All three give the same result on every device.
 *  Rule 5  The layout: always built the same way from the pack (Army Rules, Detachments, then unit groups by battlefield role),
 *          with "[Name] Ability" rules grouped under their army rule.
 *  Rule 6  Changes you make in "Symbol, banner & colours" (your own image, banner art, colours) stay in your browser only.
 *          They never change what anyone else gets from the same pack, and "Default colours" returns to the ruleset's.
 *  Rule 8  The app's own faction kit (the "factions" folder beside index.html) comes first: factions.json gives each
 *          faction's colours, and an image named after the faction (dark-angels.png, tau-empire.svg …) is its symbol.
 *          Any size or format works: the image is trimmed of empty edges and scaled to fit the symbol box.
 *  Rule 9  Symbol sizes. Banner: as tall as the banner allows, 5px from the top and 5px above the coloured bottom line
 *          (101px tall on desktop, 82px on phones); width follows the image's shape, up to 30px more than that height
 *          (131px / 112px), and a wider image is scaled down to fit. Every symbol is centred in that slot, so their centres line up.
 *          Button: fitted inside 30 × 28.
 *  Rule 10 A symbol that's entirely black or dark grey is redrawn in near-white so it shows on the dark app.
 *  Rule 11 Core Abilities vs Faction Abilities on each datasheet. The labels' lists are read beside their label (not
 *          top to bottom), then every name is checked: one that matches the pack's own Army Rules is a faction ability,
 *          one that matches the game's core abilities (Deep Strike, Leader, Scouts 6"...) is a core ability, and two
 *          names run together ("Leader Combat Doctrines") are split. The same check runs for every faction.
 *  Rule 12 Datasheet abilities are read by layout, not punctuation: a name is the bold text at the start of a
 *          paragraph, read across lines up to its colon or to where normal text begins. Text the reader can't place
 *          is kept with the datasheet (and its Excel file's "Unsorted text" sheet) but not shown in the app.
 *  Rule 7  The theme travels with the faction's Excel file (About sheet: faction, colours, symbol), so a pack shared as
 *          Excel looks the same as the PDF it came from.
 */
import { KNOWN_FACTIONS } from "./core.js?v=8.16";
import { normName } from "./text.js?v=8.16";

const PACK_RULES_VERSION = 1;
const KIT_DIR = "factions/";
const IMAGE_TYPES = ["png", "svg", "webp", "jpg", "jpeg", "gif", "avif"];
/** A faction's file name: "Dark Angels" → "dark-angels", "T'au Empire" → "tau-empire", "Emperor's Children" → "emperors-children". */
const kitSlug = f => String(f).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Each official faction's colours: [first (main), second (trim)]. */
const FACTION_THEMES = {
  "Adepta Sororitas": ["#b3262d", "#e6e1d3"], "Adeptus Custodes": ["#d4a72c", "#8e1f2a"], "Adeptus Mechanicus": ["#b0302a", "#b9bcc0"],
  "Astra Militarum": ["#6b7a3a", "#b58a4c"], "Black Templars": ["#1b1b1e", "#e9e6df"], "Blood Angels": ["#b3121b", "#d4a72c"],
  "Dark Angels": ["#1f6b3a", "#f6f4f1"], "Deathwatch": ["#9aa3ad", "#2e2e33"], "Grey Knights": ["#a9b4bf", "#3b6fb6"],
  "Imperial Agents": ["#8a8f96", "#b3262d"], "Imperial Knights": ["#2f5fa8", "#d4a72c"], "Space Marines": ["#2f5fb8", "#d4a72c"],
  "Space Wolves": ["#7f9bb3", "#d4a72c"], "Chaos Daemons": ["#a3202a", "#7a3fb0"], "Chaos Knights": ["#7a1f1f", "#9aa0a6"],
  "Chaos Space Marines": ["#1b1b1e", "#c9a227"], "Death Guard": ["#9aa83f", "#b08d57"], "Emperor's Children": ["#c0399a", "#d9b84a"],
  "Thousand Sons": ["#2f6fc0", "#d4a72c"], "World Eaters": ["#c0201f", "#b08d57"], "Aeldari": ["#1f8a78", "#d9b84a"],
  "Drukhari": ["#6b3a8c", "#2fa88a"], "Genestealer Cults": ["#6a4a9c", "#c9a227"], "Leagues of Votann": ["#c9732f", "#6b7d8c"],
  "Necrons": ["#36c45a", "#9aa0a6"], "Orks": ["#4f9a2f", "#d9b84a"], "T'au Empire": ["#d99a4e", "#3f7fbf"], "Tyranids": ["#7d3fb0", "#d8cfb4"],
};

/** Other names people and books use for a faction (compared without capitals or punctuation). */
const ALIASES = {
  "sisters of battle": "Adepta Sororitas", "sororitas": "Adepta Sororitas", "custodes": "Adeptus Custodes",
  "admech": "Adeptus Mechanicus", "mechanicus": "Adeptus Mechanicus", "imperial guard": "Astra Militarum", "guard": "Astra Militarum",
  "adeptus astartes": "Space Marines", "astartes": "Space Marines", "marines": "Space Marines",
  "agents of the imperium": "Imperial Agents", "questor imperialis": "Imperial Knights", "questor traitoris": "Chaos Knights",
  "legiones daemonica": "Chaos Daemons", "daemons": "Chaos Daemons", "heretic astartes": "Chaos Space Marines", "csm": "Chaos Space Marines",
  "emperors children": "Emperor's Children", "eldar": "Aeldari", "craftworlds": "Aeldari", "asuryani": "Aeldari", "harlequins": "Aeldari",
  "dark eldar": "Drukhari", "gsc": "Genestealer Cults", "votann": "Leagues of Votann", "squats": "Leagues of Votann",
  "necron": "Necrons", "ork": "Orks", "tau": "T'au Empire", "tau empire": "T'au Empire", "nids": "Tyranids", "da": "Dark Angels",
};
/** Sub-factions and the parent whose keyword they also print (ADEPTUS ASTARTES, DARK ANGELS). */
const PARENT = { "Dark Angels": "Space Marines", "Blood Angels": "Space Marines", "Space Wolves": "Space Marines",
  "Black Templars": "Space Marines", "Deathwatch": "Space Marines", "Death Guard": "Chaos Space Marines",
  "Thousand Sons": "Chaos Space Marines", "World Eaters": "Chaos Space Marines", "Emperor's Children": "Chaos Space Marines" };

const KEY = new Map([...KNOWN_FACTIONS.map(f => [normName(f), f]), ...Object.entries(ALIASES).map(([k, f]) => [normName(k), f])]);
/** Words around a faction's name in titles and file names. */
const NOISE = /\b(warhammer|40,?000|40k|11th|10th|edition|faction|pack|codex|index|supplement|datasheets?|rules|pdf|v\d+(\.\d+)*|final|copy|download|\d{4})\b/gi;

/** The faction's official name for any way of writing it, or "" when it isn't an official faction. */
function canonicalFaction(raw) {
  const s = " " + normName(String(raw || "").replace(/[_\-.]+/g, " ")) + " ";
  if (!s.trim()) return "";
  if (KEY.has(s.trim())) return KEY.get(s.trim());
  // Longest name found inside the text ("Dark Angels Faction Pack" → Dark Angels, not Space Marines' "marines").
  let best = "", len = 0;
  for (const [k, f] of KEY) if (k.length > len && k.length > 3 && s.includes(" " + k + " ")) { best = f; len = k.length; }
  return best;
}
/* ---------- Rule 8: the app's faction kit (factions/factions.json and one image per faction) ---------- */
const KIT = { images: {}, listed: {}, tried: new Set(), onImages: null };

/** Rule 10: a symbol drawn only in black or dark grey (like a black SVG) would vanish on the app's dark background,
 *  so it's redrawn in near-white, keeping its shape and soft edges. Coloured symbols are left as they are. */
const LIGHT = [236, 233, 228];
function lightenDarkSymbol(g, w, h) {
  const img = g.getImageData(0, 0, w, h), px = img.data;
  let solid = 0, dark = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    solid++;
    const max = Math.max(px[i], px[i + 1], px[i + 2]), min = Math.min(px[i], px[i + 1], px[i + 2]);
    if (max < 70 && max - min < 30) dark++;
  }
  if (!solid || dark / solid < 0.9) return;
  for (let i = 0; i < px.length; i += 4) [px[i], px[i + 1], px[i + 2]] = LIGHT;
  g.putImageData(img, 0, 0);
}
/** Loads an image file and returns it trimmed of empty (see-through) edges and scaled to fit 256 × 256, as a PNG. */
async function fitImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512, k = Math.min(1, 1024 / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 16) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, s = Math.min(1, 256 / Math.max(cw, ch));   // sharp at the banner's full height on high-resolution screens
  const out = document.createElement("canvas"); out.width = Math.max(1, Math.round(cw * s)); out.height = Math.max(1, Math.round(ch * s));
  const o = out.getContext("2d", { willReadFrequently: true }); o.imageSmoothingQuality = "high"; o.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
  lightenDarkSymbol(o, out.width, out.height);
  return out.toDataURL("image/png");
}
/** The first image that exists for a faction: the file named in factions.json, then its name in each image type. */
async function kitImage(name, listed) {
  const tries = [...(listed ? [listed] : []), ...IMAGE_TYPES.map(t => `${kitSlug(name)}.${t}`)];
  for (const file of [...new Set(tries)]) {
    try {
      const r = await fetch(KIT_DIR + file, { cache: "no-cache" });
      if (!r.ok) continue;
      const blob = await r.blob(), url = URL.createObjectURL(blob);
      try { return await fitImage(url); } finally { URL.revokeObjectURL(url); }
    } catch {}
  }
  return "";
}
/** Reads the kit. Colours apply at once; images arrive in the background and onImages() is called when they're ready. */
async function loadFactionKit(onImages) {
  let list = {};
  try { const r = await fetch(KIT_DIR + "factions.json", { cache: "no-cache" }); if (r.ok) list = (await r.json()).factions || {}; } catch {}
  for (const [raw, v] of Object.entries(list)) {
    const name = canonicalFaction(raw) || raw.trim();
    if (!KEY.has(normName(name))) KEY.set(normName(name), name);           // a faction the app didn't know yet
    const cs = (v?.colours || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    if (cs.length) FACTION_THEMES[name] = [cs[0], cs[1] || cs[0]];
    list[raw] = { ...v, name };
  }
  KIT.listed = Object.fromEntries(Object.values(list).map(v => [v.name, v.image]));
  KIT.onImages = onImages;
  KIT.loaded = true;
  for (const n of Object.keys(KIT.listed)) kitSymbol(n);   // start fetching every symbol now, so they're ready sooner
}
/** True while the app's own symbol for a faction may still arrive (the folder list hasn't loaded, or its image is on the
 *  way). Until then nothing is shown, rather than briefly showing the PDF's icon and then swapping it. */
function kitPending(f) {
  const n = canonicalFaction(f) || f;
  if (!KIT.loaded) return true;
  return !!KIT.listed[n] && !KIT.images[n] && !KIT.failed?.has(n);
}
/** The kit's image for a faction ("" when the folder has none). Each faction's image is looked for once, the first time
 *  it's shown; when it arrives, the page is redrawn. */
let redraw = 0;
function kitSymbol(f) {
  const n = canonicalFaction(f) || f;
  if (!n) return "";
  if (!KIT.tried.has(n)) {
    KIT.tried.add(n);
    kitImage(n, KIT.listed[n]).then(img => {
      if (!img) { (KIT.failed ||= new Set()).add(n); clearTimeout(redraw); redraw = setTimeout(() => KIT.onImages?.(), 50); return; }
      KIT.images[n] = img;
      clearTimeout(redraw); redraw = setTimeout(() => KIT.onImages?.(), 50);
    });
  }
  return KIT.images[n] || "";
}

/* ---------- Rule 11: core abilities and faction abilities ---------- */
/** The 11th edition Core Rules' unit abilities (section 24: Damaged, Deadly Demise, Deep Strike, Feel No Pain, Fights First,
 *  Firing Deck, Hover, Infiltrators, Leader / Support, Lone Operative, Scouts, Stealth, Super-Heavy Walker), as printed on datasheets (with any number: "Scouts 6\"", "Deadly Demise D3", "Feel No Pain 5+"). */
const CORE_ABILITY = /^(damaged( \d+(-\d+)?)?|deadly demise( d?\d+(\+\d+)?)?|deep strike|feel no pain( \d\+)?|fights first|firing deck( \d+)?|hover|infiltrators|leader|lone operative( \d+"?)?|scouts( \d+"?)?|stealth|super-heavy walker|support)$/i;
const abilityKey = n => normName(String(n).replace(/\(.*?\)/g, ""));
function sortDatasheetAbilities(data) {
  const army = new Set((data.armyRules || []).filter(r => !r.partOf).map(r => abilityKey(r.name)));
  const isArmy = n => army.has(abilityKey(n));
  const isCore = n => CORE_ABILITY.test(String(n).trim());
  // "Leader Combat Doctrines" → "Leader" + "Combat Doctrines": two names a line break ran together.
  const split = n => {
    if (isArmy(n) || isCore(n)) return [n];
    const w = String(n).split(/\s+/);
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i).join(" "), b = w.slice(i).join(" ");
      if ((isCore(a) || isArmy(a)) && (isCore(b) || isArmy(b))) return [a, b];
    }
    return [n];
  };
  for (const ds of data.datasheets || []) {
    const core = [], fac = [], add = (list, n) => { if (!list.some(x => abilityKey(x) === abilityKey(n))) list.push(n); };
    for (const n of [...(ds.coreAbilities || [])].flatMap(split)) (isArmy(n) ? add(fac, n) : add(core, n));
    for (const n of [...(ds.armyRuleNames || [])].flatMap(split)) (isCore(n) && !isArmy(n) ? add(core, n) : add(fac, n));
    ds.coreAbilities = core;
    ds.armyRuleNames = fac;
  }
  return data;
}

/** A tidy name for a faction that isn't official (a new release): the title without "Codex", "Faction Pack" and so on. */
const tidyName = raw => String(raw || "").replace(/[_]+/g, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim()
  .replace(/\b\w/g, c => c.toUpperCase());

/** Rule 2: which faction a pack is, from its contents first. */
function packFaction({ datasheets = [], title = "", fileName = "", typed = "" }) {
  const counts = new Map();
  for (const ds of datasheets) {
    const seen = new Set();
    for (const k of String(ds.factionKeywords || "").split(/\s*[,;]\s*/)) {
      const f = canonicalFaction(k);
      if (f && !seen.has(f)) { seen.add(f); counts.set(f, (counts.get(f) || 0) + 1); }
    }
  }
  if (counts.size) {
    // A sub-faction printed on 3+ datasheets wins over its parent; otherwise the most common faction keyword.
    const sub = [...counts].filter(([f, n]) => PARENT[f] && n >= 3).sort((a, b) => b[1] - a[1])[0];
    if (sub) return sub[0];
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  return canonicalFaction(title) || canonicalFaction(fileName) || canonicalFaction(typed) || tidyName(typed || title || fileName);
}

/** Rule 3: the icon beside the faction's own name in the Books table (exact faction first). */
function packIcon(bookIcons, faction) {
  const list = bookIcons || [];
  return (list.find(b => canonicalFaction(b.name) === faction) || list.find(b => normName(b.name) === normName(faction)))?.image || "";
}

/* Rule 4: colours. */
const hslHex = (h, s, l) => { s /= 100; l /= 100; const f = n => { const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, "0"); }; return `#${f(0)}${f(8)}${f(4)}`; };
function nameColours(f) { let h = 0; for (const ch of f) h = (h * 31 + ch.charCodeAt(0)) % 360; return [hslHex(h, 60, 52), hslHex((h + 45) % 360, 55, 60)]; }
const hex = (r, g, b) => "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The two most common strong colours in a symbol, or null when it's plain (white, black or grey). */
async function iconColours(src) {
  if (!src || typeof document === "undefined") return null;
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement("canvas"); c.width = c.height = 48;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 48, 48);
  const px = g.getImageData(0, 0, 48, 48).data, bins = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    if (a < 128 || max - min < 50 || max < 60) continue;     // see-through, grey or too dark
    const h = max === r ? ((gg - b) / (max - min) + 6) % 6 : max === gg ? (b - r) / (max - min) + 2 : (r - gg) / (max - min) + 4;
    const k = Math.floor(h * 2);                               // 12 hue groups
    const s = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; s.n++; s.r += r; s.g += gg; s.b += b; bins.set(k, s);
  }
  const top = [...bins].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]).filter(([, s]) => s.n >= 12);
  if (!top.length) return null;
  const avg = s => hex(s.r / s.n, s.g / s.n, s.b / s.n);
  // The second colour is a clearly different hue (60° or more away); a one-colour symbol gets a lighter shade of its colour.
  const [k1, s1] = top[0], other = top.find(([k]) => Math.min(Math.abs(k - k1), 12 - Math.abs(k - k1)) >= 2);
  const light = hex(...[s1.r, s1.g, s1.b].map(v => v / s1.n * 0.55 + 255 * 0.45));
  return [avg(s1), other ? avg(other[1]) : light];
}

/** Rule 4: the faction's colours and where they came from. */
async function packTheme(faction, icon) {
  if (FACTION_THEMES[faction]) return { c1: FACTION_THEMES[faction][0], c2: FACTION_THEMES[faction][1], from: "built-in" };
  const fromIcon = await iconColours(icon);
  if (fromIcon) return { c1: fromIcon[0], c2: fromIcon[1], from: "symbol" };
  const [c1, c2] = nameColours(faction);
  return { c1, c2, from: "name" };
}
/** The ruleset's colours for a faction without waiting (built-in, else what was worked out when it was added, else from its name). */
function defaultColours(faction, theme) {
  return FACTION_THEMES[faction] || FACTION_THEMES[canonicalFaction(faction)] || (theme?.c1 ? [theme.c1, theme.c2] : nameColours(faction));
}

/** Rules 1–4 for a converted pack: fills in doc.faction, doc.icon and doc.theme. */
async function applyPackRules(doc, { bookIcons, fileName = "", typed = "" } = {}) {
  doc.faction = packFaction({ datasheets: doc.structured?.datasheets || [], title: doc.title, fileName, typed: typed || doc.faction });
  const icon = packIcon(bookIcons, doc.faction);
  if (icon) doc.icon = icon;
  doc.theme = { rules: PACK_RULES_VERSION, ...(await packTheme(doc.faction, doc.icon)) };
  return doc;
}

export { sortDatasheetAbilities, loadFactionKit, kitPending, kitSymbol, kitSlug, PACK_RULES_VERSION, FACTION_THEMES, canonicalFaction, packFaction, packIcon, packTheme, defaultColours, applyPackRules };
