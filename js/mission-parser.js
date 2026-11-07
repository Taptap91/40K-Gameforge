/* RulesForge · mission-parser.js
 * Reads a Chapter Approved mission pack (the Mission Deck PDF) into structured cards:
 *   the battle sequence, Force Disposition cards, Primary and Secondary Missions, Deployment cards (as pictures),
 *   Twists and the FAQ.
 * The pack's "Mission Generator" and "Player's Hand" (the web page's interactive tools) are skipped entirely.
 */
import { readingLines } from "./pdf-reader.js?v=8.17";
import { cleanGlyphs, normName } from "./text.js?v=8.17";

const TYPES = { "PRIMARY MISSION": "primary", "SECONDARY MISSION": "secondary", "TWIST": "twist", "DEPLOYMENT CARD": "deployment", "FORCE DISPOSITION CARDS": "disposition" };
/* Section headings of the deck itself (never card names). */
const SECTIONS = /^(card decks|force disposition cards|primary mission deck|secondary mission deck|deployment deck|twist deck|mission generator|deployment card key|chapter approved battles|faq|books|contents|objective points)$/i;
/* On every Force Disposition card the opponent's symbols are printed in this order (they're pictures, so the order is the key). */
const DISPOSITION_ORDER = ["Take and Hold", "Purge the Foe", "Disruption", "Reconnaissance", "Priority Assets"];

const VP = /^\+?\d+\s?VP$/i, CAP = /^\(\s*UP TO \d+\s?VP\s*\)$/i;
const LABEL = /^(FIXED|TACTICAL|CUMULATIVE|OPPONENT|PLAYER)$/;
const isCaps = s => /[A-Z]/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s);
const titleCaseName = s => s.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(And|Of|The|To|A|In|On)\b(?!$)/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());

/** Words run together in the PDF's small-caps headings ("FIRSTANDSECONDBATTLEROUND") are split again,
 *  using the words found elsewhere in the same document. */
function makeSplitter(allText) {
  const vocab = new Set((allText.toLowerCase().match(/[a-z’']+/g) || []).filter(w => w.length > 1 || w === "a"));
  return token => {
    const t = token.toLowerCase();
    if (t.length < 9 || vocab.has(t) || !/^[a-z’']+$/.test(t)) return token;
    const best = new Array(t.length + 1).fill(null); best[0] = [];
    for (let i = 0; i < t.length; i++) {
      if (!best[i]) continue;
      for (let j = t.length; j > i; j--) {
        const w = t.slice(i, j);
        if (vocab.has(w) && (!best[j] || best[j].length > best[i].length + 1)) best[j] = [...best[i], w];
      }
    }
    if (!best[t.length]) return token;
    let k = 0;   // keep the original letters (and their case)
    return best[t.length].map(w => { const out = token.slice(k, k + w.length); k += w.length; return out; }).join(" ");
  };
}
const respace = (s, split) => cleanGlyphs(String(s || ""))
  .replace(/\b(?:[A-Z] ){3,}[A-Z]\b/g, m => m.replace(/ /g, ""))   // letter-spaced headings: "P R I M A R Y" → "PRIMARY"
  .replace(/\b([A-Z]{3,})([a-z]{2,})/g, "$1 $2")            // "BATTLELINEunit" → "BATTLELINE unit"
  .split(" ").map(w => isCaps(w) ? split(w) : w).join(" ")
  .replace(/\[([A-Z]{6,})\]/g, (m, w) => `[${split(w)}]`);

/** Reads the mission pack. `pages` come from readPdf (with item positions and, for picture cards, a page image). */
async function parseMissionPack(pages, title = "") {
  const items = pages.flatMap(p => p.items || []);
  const split = makeSplitter(items.map(i => i.t).join(" "));
  let lines = readingLines(items, 3).map(l => ({ ...l, text: respace(l.text, split) }));
  // The interactive Mission Generator and Player's Hand (on the web page this PDF was printed from) are left out.
  const genStart = lines.find(l => /^mission generator$/i.test(l.text)), genEnd = lines.find(l => genStart && l.y > genStart.y && /^card decks$/i.test(l.text));
  if (genStart) lines = lines.filter(l => l.y < genStart.y || (genEnd && l.y >= genEnd.y));
  // The printed page header ("Mission Deck 2026-27 [Warhammer 40,000 11th edition]") repeats on every page; it's left out.
  const seen = new Map(); for (const l of lines) seen.set(l.text, (seen.get(l.text) || 0) + 1);
  lines = lines.filter(l => !(seen.get(l.text) >= 5 && /\[.*edition\]/i.test(l.text)));
  for (const l of lines) l.text = l.text.replace(/\s+([.,;:)])/g, "$1").replace(/\(\s+/g, "(");
  const pack = { name: packName(lines, title), sequence: [], limits: [], dispositions: [], primaries: [], secondaries: [], deployments: [], twists: [], faq: [] };

  // ---------- cards ----------
  const starts = [];
  lines.forEach((l, i) => {
    const type = TYPES[l.text.toUpperCase()], prev = lines[i - 1];
    if (type && prev && isCaps(prev.text) && !/\d/.test(prev.text) && !SECTIONS.test(prev.text) && !TYPES[prev.text]) starts.push({ i: i - 1, type });
  });
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], endIdx = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    let body = lines.slice(s.i + 2, endIdx);
    const stop = body.findIndex(l => SECTIONS.test(l.text) || /mission deck$|twist deck$|deployment deck$/i.test(l.text));
    if (stop >= 0) body = body.slice(0, stop);
    const name = titleCaseName(lines[s.i].text);
    const lineItems = l => l.items;
    if (s.type === "disposition") pack.dispositions.push(readDisposition(name, body));
    else if (s.type === "twist") pack.twists.push(readTwist(name, body));
    else if (s.type === "deployment") pack.deployments.push(await readDeployment(name, lines[s.i], body, pages));
    else (s.type === "primary" ? pack.primaries : pack.secondaries).push(readMission(name, body, lineItems));
  }
  // Mission names on Force Disposition cards are matched to the Primary Mission cards' names.
  const byKey = new Map(pack.primaries.map(p => [normName(p.name).replace(/\s/g, ""), p.name]));
  for (const d of pack.dispositions) for (const m of d.missions) m.mission = byKey.get(normName(m.mission).replace(/\s/g, "")) || m.mission;

  // ---------- the battle sequence and the VP limits ----------
  readSequence(lines, pack);
  // ---------- FAQ ----------
  pack.faq = readFaq(lines);
  return pack;
}

function packName(lines, title) {
  const t = lines.slice(0, 4).map(l => l.text).find(x => /mission (deck|pack)/i.test(x)) || title;
  return cleanGlyphs(String(t).replace(/\[.*?\]/g, "").replace(/^\d+\/\d+\/\d+.*?(AM|PM)\s*/i, "")).trim() || "Mission pack";
}

/** Lines into paragraphs: a line that starts close below the previous one continues it. */
function paragraphs(lines) {
  const out = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && l.y - last.bottom < l.size * 1.6 && l.items.every(i => i.it) === last.italic && !/^[A-Z][A-Z ’']+:/.test(l.text) && !/^(\+|OR$|Designer’s Note)/.test(l.text)) { last.text += " " + l.text; last.bottom = l.y; }
    else out.push({ text: l.text, y: l.y, bottom: l.y, size: l.size, italic: l.items.every(i => i.it) });
  }
  return out;
}

function readDisposition(name, body) {
  const text = body.filter(l => !/^(player|opponent|player opponent)$/i.test(l.text));
  const flavour = text.find(l => !/^mission\b/i.test(l.text))?.text || "";
  const missions = text.filter(l => /^mission\s+/i.test(l.text)).map((l, i) => ({ vs: DISPOSITION_ORDER[i] || "", mission: titleCaseName(l.text.replace(/^mission\s+/i, "")) }));
  return { name, flavour, missions };
}

function readTwist(name, body) {
  const ps = paragraphs(body);
  let flavour = "";
  while (ps[0]?.italic) flavour += (flavour ? " " : "") + ps.shift().text;
  const n = ps.findIndex(p => /^Designer’s Note/i.test(p.text));
  const note = n < 0 ? "" : ps.slice(n).map(p => p.text).join(" ").replace(/^Designer’s Note:\s*/i, "");
  return { name, flavour, text: (n < 0 ? ps : ps.slice(0, n)).map(p => p.text).join("\n"), note };
}

/** Deployment cards are maps, so each is kept as a picture cut from its page. */
async function readDeployment(name, titleLine, body, pages) {
  const page = pages.find(p => p.image && titleLine.y >= p.top && titleLine.y < p.top + p.ph);
  const bottom = body.length ? Math.max(...body.map(l => l.y)) : titleLine.y;
  let image = "";
  if (page) {
    const nextHeading = body.find(l => SECTIONS.test(l.text));
    // Down to the next heading, or the page's end less its printed footer (the web address and page number).
    const y1 = (nextHeading ? nextHeading.y - 14 : page.top + page.ph - 34) - page.top;
    try { image = await cropImage(page.image, page.scale, Math.max(0, titleLine.y - page.top - 16), y1); } catch {}
  }
  return { name, image, objectives: body.filter(l => /objective/i.test(l.text)).length || undefined, bottom };
}
/** Cuts a band out of a page picture and trims the white margins around the card. */
async function cropImage(src, scale, y0, y1) {
  const img = new Image(); img.src = src; await img.decode();
  const top = Math.round(y0 * scale), h = Math.max(1, Math.min(img.height, Math.round(y1 * scale)) - top);
  const c = document.createElement("canvas"); c.width = img.width; c.height = h;
  const g = c.getContext("2d"); g.drawImage(img, 0, -top);
  const d = g.getImageData(0, 0, c.width, h).data, white = (x, y) => { const k = (y * c.width + x) * 4; return d[k] > 236 && d[k + 1] > 236 && d[k + 2] > 236 && Math.abs(d[k] - d[k + 2]) < 6; };
  const colBlank = x => { for (let y = 0; y < h; y += 3) if (!white(x, y)) return false; return true; };
  const rowBlank = y => { for (let x = 0; x < c.width; x += 3) if (!white(x, y)) return false; return true; };
  let l = 0, r = c.width - 1, t = 0, b = h - 1;
  while (l < r && colBlank(l)) l++; while (r > l && colBlank(r)) r--; while (t < b && rowBlank(t)) t++; while (b > t && rowBlank(b)) b--;
  const o = document.createElement("canvas"); o.width = r - l + 1; o.height = b - t + 1;
  o.getContext("2d").drawImage(c, -l, -t);
  return o.toDataURL("image/jpeg", 0.82);
}

/** A Primary or Secondary Mission: its flavour text, rules, actions and scoring (each heading, when it's scored, and each line's VP). */
function readMission(name, body) {
  const card = { name, flavour: "", whenDrawn: "", rules: [], actions: [], scoring: [], fixed: false };
  let block = null, action = null, field = null, last = null, alt = false;
  const flush = () => { field = null; };
  const ps = [];
  // Each line: its words, and any VP values / labels printed at the right of it.
  for (const l of body) {
    const words = [], vps = [], labels = [];
    for (const it of l.items) {
      const t = cleanGlyphs(it.t);
      for (const part of t.split(/\s{2,}/)) {
        if (VP.test(part)) vps.push(part.replace(/\s/g, "").toUpperCase());
        else if (CAP.test(part)) labels.push(part.toUpperCase());
        else if (/^(\+?\d+\s?VP\s*)+$/i.test(part)) vps.push(...part.toUpperCase().match(/\+?\d+\s?VP/g).map(v => v.replace(/\s/g, "")));
        else if (part.split(" ").every(w => LABEL.test(w))) labels.push(...part.split(" "));
        else words.push(part);
      }
    }
    ps.push({ y: l.y, size: l.size, text: words.join(" ").replace(/\s+([.,;:)])/g, "$1").replace(/\(\s+/g, "(").trim(), vps, labels, italic: l.items.filter(i => cleanGlyphs(i.t)).every(i => i.it), bold: l.items.some(i => i.b) });
  }
  // A VP value printed on a line of its own goes with the nearest line of text (just above or just below it).
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.text || !p.vps.length) continue;
    const rowLike = q => q?.text && !isCaps(q.text) && !/^[A-Z][A-Z ’'/]{1,40}:/.test(q.text) && !/^Designer/i.test(q.text);
    const near = [ps[i - 1], ps[i + 1]].filter(q => rowLike(q) && Math.abs(q.y - p.y) < 14)
      .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y) || a.vps.length - b.vps.length)[0];
    if (near) { near.vps.push(...p.vps); p.vps = []; }
  }
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], prev = ps[i - 1];
    const text = p.text;
    // Labels under a row: FIXED / TACTICAL name its two VP values; CUMULATIVE and "(UP TO …)" belong to the block.
    if (p.labels.length) {
      if (block && p.labels.includes("CUMULATIVE")) block.cumulative = true;
      const cap = p.labels.find(x => CAP.test(x)); if (block && cap) block.cap = cap.replace(/[()]/g, "").replace(/^UP TO/i, "Up to").trim();
      const ft = p.labels.filter(x => x === "FIXED" || x === "TACTICAL");
      if (ft.length && last?.vps?.length) {
        last.vps = [...last.vps];
        card.fixed = true;
        if (ft.length === last.vps.length) { last.vp = Object.fromEntries(ft.map((k, j) => [k.toLowerCase(), last.vps[j]])); }
        else if (ft.length === 1) last.vp = { [ft[0].toLowerCase()]: last.vps[0] };
      }
    }
    // VP printed on a line of its own belongs to the scoring row above it.
    if (!text) { const row = block?.rows[block.rows.length - 1]; if (p.vps.length && row) row.vps.push(...p.vps); continue; }
    if (/^Designer’s Note/i.test(text)) { card.note = text.replace(/^Designer’s Note:\s*/i, ""); last = { text: card.note, note: true }; continue; }
    if (last?.note && prev && p.y - prev.y < p.size * 1.6 && !isCaps(text)) { card.note += " " + text; last.text = card.note; continue; }
    const rowOpen = last && last.vps && !last.vps.length;   // a scoring row without its VP yet runs on to the next line
    const cont = prev && last && p.y - prev.y < p.size * 1.6 && (!p.vps.length || rowOpen) && !isCaps(text) && !/^[A-Z][A-Z ’']{2,}:/.test(text) && !/^(\+|OR$)/.test(text) && (/[a-z,(]$/.test(last.text || "") || rowOpen);
    if (cont && last && last.text !== undefined && !p.italic) { last.text += " " + text; if (last.vps) last.vps.push(...p.vps); if (last === field) action[field.key] = field.text; if (last.set) last.set(last.text); continue; }
    if (cont && last?.flavour) { card.flavour += " " + text; continue; }
    // Headings: a battle round, the end of the battle, or an action.
    if (isCaps(text) && !/:/.test(text)) {
      if (/ACTION$/.test(text)) { action = { type: titleCaseName(text), name: "", starts: "", units: "", useLimit: "", completes: "", effect: "", restrictions: "" }; card.actions.push(action); block = null; flush(); last = null; continue; }
      if (/BATTLE ROUND|END OF THE BATTLE|^ANY |ONWARDS/.test(text)) { block = { round: titleCaseName(text), when: "", rows: [] }; card.scoring.push(block); action = null; flush(); last = null; continue; }
      if (text === "OR") {
        // "OR" printed beside a two-line row (sometimes with that row's VP on the same line) marks the row as the alternative.
        const row = block?.rows[block.rows.length - 1];
        if (row && last === row && !row.vps.length && block.rows.length > 1) { row.alt = true; row.vps.push(...p.vps); } else alt = true;
        continue;
      }
      if (action && !action.name) { action.name = titleCaseName(text); continue; }
      continue;   // a lone label under an icon (e.g. the opponent's symbol)
    }
    const lab = /^([A-Z][A-Z ’'/]{1,40}):\s*(.*)$/.exec(text);
    if (lab) {
      const key = lab[1].trim(), rest = lab[2];
      if (key === "WHEN" && block) { block.when = rest; last = { text: rest, set: v => block.when = v }; continue; }
      if (key === "WHEN DRAWN") { card.whenDrawn = rest; last = { text: rest, set: v => card.whenDrawn = v }; continue; }
      const map = { STARTS: "starts", UNITS: "units", "USE LIMIT": "useLimit", COMPLETES: "completes", EFFECT: "effect", RESTRICTIONS: "restrictions" };
      if (action && map[key]) { field = { key: map[key], text: rest }; action[field.key] = rest; last = field; continue; }
      const r = { label: titleCaseName(key), text: rest }; card.rules.push(r); last = r; continue;
    }
    if (!card.flavour && !card.rules.length && !block && !action && p.italic) { card.flavour = text; last = { flavour: true, text }; continue; }
    if (block) {
      const row = { text: text.replace(/^\+\s*/, ""), plus: /^\+/.test(text), alt, vps: [...p.vps], vp: p.vps.join(" / ") };
      alt = false; block.rows.push(row); last = row; continue;
    }
    const r = { label: "", text }; card.rules.push(r); last = r;
  }
  // Tidy: setters for continued WHEN text, and the VP value as text where FIXED/TACTICAL didn't name them.
  for (const b of card.scoring) if (!b.when && /end of the battle/i.test(b.round)) b.when = "End of the battle.";
  for (const b of card.scoring) for (const r of b.rows) { if (typeof r.vp !== "object") r.vp = r.vps.join(" / "); delete r.vps; }
  return card;
}

/** The numbered steps of a Chapter Approved battle (1 Muster Armies … 14 Determine Victor) and the VP limits table. */
function readSequence(lines, pack) {
  const a = lines.findIndex(l => /^chapter approved battles$/i.test(l.text));
  const b = lines.findIndex((l, i) => i > a && /^deployment card key$/i.test(l.text));
  if (a < 0) return;
  const seg = lines.slice(a + 1, b > a ? b : undefined);
  let step = null, pendingNum = null, pendingWord = "";
  const intro = [];
  for (const l of seg) {
    const t = l.text;
    const m = /^(\d{1,2})\s+([A-Z][A-Z ’'&-]+)$/.exec(t);
    if (m || (pendingNum && isCaps(t) && !/VP/.test(t))) {
      const n = m ? +m[1] : pendingNum, ttl = (pendingWord ? pendingWord + " " : "") + (m ? m[2] : t);
      step = { n, title: titleCaseName(ttl.trim()), text: "" }; pack.sequence.push(step); pendingNum = null; pendingWord = ""; continue;
    }
    if (/^\d{1,2}$/.test(t)) { pendingNum = +t; continue; }
    if (/^[A-Z]{3,}$/.test(t) && !step?.text?.endsWith(":")) { pendingWord = t; continue; }   // "BEGIN" printed above "12 THE BATTLE"
    if (/VP SOURCE|MAXIMUM VP|^PRIMARY MISSION|^SECONDARY MISSIONS|^BATTLE READY ARMY|per battle round|^Up to|^\d+VP$|^Mission card\.$|^\* In addition/i.test(t)) continue;
    if (step) step.text += (step.text ? (l.y - step.lastY > l.size * 1.8 ? "\n" : " ") : "") + t, step.lastY = l.y;
    else intro.push(t);
  }
  for (const s of pack.sequence) delete s.lastY;
  pack.intro = intro.join(" ");
  // VP limits, as printed in step 14's table.
  const all = seg.map(l => l.text).join(" ");
  const grab = re => (re.exec(all) || [])[1];
  const per = all.match(/(\d+)\s?VP\s+per battle round/i)?.[1] || "15";
  pack.limits = [
    { source: "Primary Mission", max: `${grab(/PRIMARY MISSION\s+Up to\s+\d+VP\s+(\d+VP)/i) || "45VP"}`, perRound: `${per}VP` },
    { source: "Secondary Missions", max: `${grab(/SECONDARY MISSIONS\s+Up to\s+\d+VP\s+(\d+VP)/i) || "45VP"}`, perRound: `${per}VP` },
    { source: "Battle Ready army", max: grab(/BATTLE READY ARMY\s+(\d+VP)/i) || "10VP" },
    { source: "Each Fixed Secondary Mission card", max: grab(/maximum of\s+(\d+VP)\s+per Fixed/i) || all.match(/(\d+)VP\s+per Fixed Secondary/i)?.[1] + "VP" || "20VP" },
  ];
}

/** The FAQ is printed in columns: each column is a run of questions and answers (the "Q:" and "A:" markers sit beside them). */
function readFaq(lines) {
  const b = lines.findIndex(l => /^chapter approved battles$/i.test(l.text));
  if (b < 0) return [];
  let a = -1; for (let i = 0; i < b; i++) if (/^FAQ$/.test(lines[i].text) || /^FAQ\b/.test(lines[i].items[0]?.t || "") && lines[i].items[0].x < 60) a = i;
  if (a < 0) return [];
  const head = lines[a].items.find(i => /^FAQ$/.test(cleanGlyphs(i.t))) || lines[a].items[0];
  const items = lines.slice(Math.max(0, a - 3), b).flatMap(l => l.items).filter(i => i !== head && i.y >= head.y - 14);
  const marks = items.filter(i => /^Q:?$/.test(cleanGlyphs(i.t)));
  const cols = [...new Set(marks.map(m => Math.round(m.x / 20) * 20))].sort((x, y) => x - y);
  const text = items.filter(i => !/^(Q|A):?$/.test(cleanGlyphs(i.t)));
  const out = [];
  cols.forEach((x0, c) => {
    const x1 = cols[c + 1] ?? Infinity;
    const col = text.filter(i => i.x >= x0 - 6 && i.x < x1 - 6);
    const qa = items.filter(i => /^(Q|A):?$/.test(cleanGlyphs(i.t)) && i.x >= x0 - 6 && i.x < x1 - 6).sort((p, q) => p.y - q.y);
    const ls = readingLines(col, 3), paras = [];
    for (const l of ls) { const last = paras[paras.length - 1]; if (last && l.y - last.bottom < l.size * 1.7) { last.text += " " + l.text; last.bottom = l.y; } else paras.push({ text: l.text, top: l.y, bottom: l.y }); }
    // Each paragraph is a question or an answer by the marker beside it.
    let q = null;
    for (const p of paras) {
      const m = qa.find(k => k.y >= p.top - 8 && k.y <= p.bottom + 8);
      const isA = m ? /^A/.test(cleanGlyphs(m.t)) : !!q;
      const t = cleanGlyphs(p.text).replace(/\s+([.,;:?)!])/g, "$1");
      if (!isA) q = { q: t, a: "" }, out.push(q);
      else if (q) q.a += (q.a ? " " : "") + t;
    }
  });
  return out.filter(f => f.q && f.a);
}

/** Text chunks so Ask Rules can find mission rules. */
function missionChunks(pack) {
  const vpText = v => typeof v === "object" ? Object.entries(v).map(([k, x]) => `${x} (${k})`).join(", ") : v || "";
  const mission = (kind, m) => [`${m.name} — ${kind}`, m.flavour, m.whenDrawn && `When drawn: ${m.whenDrawn}`, ...m.rules.map(r => (r.label ? r.label + ": " : "") + r.text),
    ...m.actions.map(a => `${a.type}${a.name ? " (" + a.name + ")" : ""}: Starts: ${a.starts} Units: ${a.units} Use limit: ${a.useLimit} Completes: ${a.completes} Effect: ${a.effect}${a.restrictions ? " Restrictions: " + a.restrictions : ""}`),
    ...m.scoring.map(b => `${b.round}${b.when ? " — when: " + b.when : ""}${b.cap ? " (" + b.cap + ")" : ""}${b.cumulative ? " (cumulative)" : ""}: ` + b.rows.map(r => `${r.alt ? "Or: " : r.plus ? "Plus: " : ""}${r.text} ${vpText(r.vp)}`).join("; "))].filter(Boolean).join("\n");
  return [
    ...pack.sequence.map(s => ({ page: 0, text: `${pack.name} — step ${s.n}: ${s.title}\n${s.text}` })),
    ...pack.dispositions.map(d => ({ page: 0, text: `${d.name} — Force Disposition card\n${d.flavour}\n` + d.missions.map(m => `Against ${m.vs}: ${m.mission}`).join("\n") })),
    ...pack.primaries.map(m => ({ page: 0, text: mission("Primary Mission", m) })),
    ...pack.secondaries.map(m => ({ page: 0, text: mission("Secondary Mission", m) })),
    ...pack.twists.map(t => ({ page: 0, text: `${t.name} — Twist\n${t.flavour}\n${t.text}${t.note ? "\nDesigner's note: " + t.note : ""}` })),
    ...pack.faq.map(f => ({ page: 0, text: `${pack.name} FAQ\nQ: ${f.q}\nA: ${f.a}` })),
  ];
}

/** A PDF counts as a mission pack when it has several Primary and Secondary Mission cards. */
const looksLikeMissionPack = pages => {
  const t = pages.map(p => p.text).join("\n");
  const n = re => (t.match(re) || []).length;
  return n(/^P ?R ?I ?M ?A ?R ?Y ?M ?I ?S ?S ?I ?O ?N$/gm) >= 5 && n(/^S ?E ?C ?O ?N ?D ?A ?R ?Y ?M ?I ?S ?S ?I ?O ?N$/gm) >= 5;
};

export { DISPOSITION_ORDER, looksLikeMissionPack, missionChunks, parseMissionPack };
