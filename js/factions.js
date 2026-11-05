/* RulesForge · factions.js
 * Factions page: a faction's army rules, detachments and units on the left (30%), the selected one in full on the right (70%).
 */
import { $, DB, esc, openSheet, state, store, toast } from "./core.js?v=5.8";
import { armyData } from "./army.js?v=5.8";
import { DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, panelHTML, statsHTML, tidyDatasheet, wargearOptionsHTML, weaponGridHTML } from "./datasheets.js?v=5.8";
import { factionMatches } from "./search.js?v=5.8";
import { keywordList, normName, richHTML, softenCaps } from "./text.js?v=5.8";

// Army Rules and Detachments start open; the unit groups below them start collapsed.
const fUI = { faction: store.get("rf.faction", ""), sel: null, filter: "", open: false, collapsed: new Set(DATASHEET_GROUPS.map(([t]) => t)) };
const isPhone = () => matchMedia("(max-width: 760px)").matches;
const factionDocs = f => state.docs.filter(d => d.structured?.datasheets && factionMatches(d.faction, f));
const factionNames = () => [...new Set(state.docs.filter(d => d.structured?.datasheets && d.faction).map(d => d.faction))].sort();

/** Everything shown for one faction, merged from its documents (the newest copy of a name wins). */
function factionContent(f) {
  const docs = factionDocs(f).sort((a, b) => b.importedAt - a.importedAt);
  const seen = new Set(), add = (list, x) => { const k = normName(x.name); if (!seen.has(list + k)) { seen.add(list + k); return true; } return false; };
  const armyRules = docs.flatMap(d => d.structured.armyRules || []).filter(r => add("a", r));
  const detachments = docs.flatMap(d => d.structured.detachments || []).filter(d => add("d", d)).sort((a, b) => a.name.localeCompare(b.name));
  const datasheets = docs.flatMap(d => d.structured.datasheets || []).filter(ds => add("u", ds)).map(tidyDatasheet);
  // Points as the list builder uses them (the newest Munitorum Field Manual wins over the pack).
  const priced = new Map(armyData(f).units.map(u => [u.key, u]));
  return { armyRules, detachments, datasheets, priced };
}

/* ---------- Faction buttons: colours and symbol ---------- */

/* Each faction's colours (first, second). Factions not listed get colours worked out from their name. */
const FACTION_COLOURS = {
  "adepta sororitas": ["#b3262d", "#e6e1d3"], "adeptus custodes": ["#d4a72c", "#8e1f2a"], "adeptus mechanicus": ["#b0302a", "#b9bcc0"],
  "astra militarum": ["#6b7a3a", "#b58a4c"], "black templars": ["#e9e6df", "#b3121b"], "blood angels": ["#b3121b", "#d4a72c"],
  "dark angels": ["#1f6b3a", "#cdb67a"], "deathwatch": ["#9aa3ad", "#2e2e33"], "grey knights": ["#a9b4bf", "#3b6fb6"],
  "imperial agents": ["#8a8f96", "#b3262d"], "imperial knights": ["#2f5fa8", "#d4a72c"], "space marines": ["#2f5fb8", "#d4a72c"],
  "space wolves": ["#7f9bb3", "#d4a72c"], "chaos daemons": ["#a3202a", "#7a3fb0"], "chaos knights": ["#7a1f1f", "#9aa0a6"],
  "chaos space marines": ["#9e1c1c", "#c9a227"], "death guard": ["#9aa83f", "#b08d57"], "emperor s children": ["#c0399a", "#d9b84a"],
  "thousand sons": ["#2f6fc0", "#d4a72c"], "world eaters": ["#c0201f", "#b08d57"], "aeldari": ["#1f8a78", "#d9b84a"],
  "drukhari": ["#6b3a8c", "#2fa88a"], "genestealer cults": ["#6a4a9c", "#c9a227"], "leagues of votann": ["#c9732f", "#6b7d8c"],
  "necrons": ["#36c45a", "#9aa0a6"], "orks": ["#4f9a2f", "#d9b84a"], "t au empire": ["#d99a4e", "#3f7fbf"], "tyranids": ["#7d3fb0", "#d8cfb4"],
};
const hslHex = (h, s, l) => { s /= 100; l /= 100; const f = n => { const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, "0"); }; return `#${f(0)}${f(8)}${f(4)}`; };
function factionStyle(f) {
  const saved = store.get("rf.facStyle", {})[f] || {};
  let def = FACTION_COLOURS[normName(f)];
  if (!def) { let h = 0; for (const ch of f) h = (h * 31 + ch.charCodeAt(0)) % 360; def = [hslHex(h, 60, 52), hslHex((h + 45) % 360, 55, 60)]; }
  // The symbol: one you chose, else the icon read from the faction's PDF ("Books" table).
  const pdfIcon = factionDocs(f).sort((a, b) => b.importedAt - a.importedAt).find(d => d.icon)?.icon || "";
  return { c1: saved.c1 || def[0], c2: saved.c2 || def[1], img: saved.img || pdfIcon, own: !!saved.img, pdfIcon, def };
}
function saveFactionStyle(f, patch) {
  const all = store.get("rf.facStyle", {});
  all[f] = { ...(all[f] || {}), ...patch };
  for (const k of Object.keys(all[f])) if (all[f][k] == null || all[f][k] === "") delete all[f][k];
  store.set("rf.facStyle", all);
}
function factionButton(f, on) {
  const st = factionStyle(f);
  return `<button type="button" class="fp-fac${on ? " on" : ""}${st.img ? " has-sym" : ""}" data-fac="${esc(f)}" aria-pressed="${on}" style="--c1:${st.c1};--c2:${st.c2}">
    <span class="fp-fac-name">${esc(f)}</span>
    ${st.img ? `<span class="fp-fac-sym" aria-hidden="true"><img src="${esc(st.img)}" alt=""></span>` : ""}</button>`;
}
function renderFactionBar(names) {
  const tools = $("#factionsToolbar");
  const html = names.length ? `<div class="fp-facs" role="group" aria-label="Faction">${names.map(n => factionButton(n, n === fUI.faction)).join("")}</div>
    <button type="button" class="btn plain fp-style" data-fp-style title="Choose this faction's symbol, banner image and colours">Symbol, banner &amp; colours</button>` : "";
  // Same factions and looks: only the selection moves, so the name slides and the symbol fades instead of jumping.
  const key = html.replace(/ on(?=[" ])/g, "").replace(/aria-pressed="(true|false)"/g, "");
  if (tools.dataset.key !== key) { tools.dataset.key = key; tools.innerHTML = html; }
  else for (const b of tools.querySelectorAll(".fp-fac")) { const on = b.dataset.fac === fUI.faction; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
  // Every button is the same size: as wide as the longest name needs, with room for a symbol if any faction has one.
  const btns = [...tools.querySelectorAll(".fp-facs .fp-fac")];
  if (btns.length) {
    const sym = btns.some(b => b.classList.contains("has-sym"));
    const name = Math.max(...btns.map(b => b.querySelector(".fp-fac-name").offsetWidth));
    if (name) tools.querySelector(".fp-facs").style.setProperty("--facw", `${Math.ceil(name + 20 + (sym ? 72 : 20))}px`);
  }
  const row = tools.querySelector(".fp-facs"), on = row?.querySelector(".fp-fac.on");
  if (on && (on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth || on.offsetLeft < row.scrollLeft)) row.scrollLeft = on.offsetLeft - 12;
}

/* ---------- The faction banner (full width, above both columns, always in view) ---------- */
const newestDoc = f => factionDocs(f).sort((a, b) => b.importedAt - a.importedAt)[0];
function bannerHTML(f, c) {
  const st = factionStyle(f), art = newestDoc(f)?.banner || "";
  const counts = [[c.armyRules.length, "Army Rule"], [c.detachments.length, "Detachment"], [c.datasheets.length, "Datasheet"]]
    .filter(([n]) => n).map(([n, w]) => `<span><b>${n}</b> ${w}${n === 1 ? "" : "s"}</span>`).join("");
  return `<div class="fp-banner${art ? " has-art" : ""}" style="--c1:${st.c1};--c2:${st.c2}${art ? `;--art:url('${art}')` : ""}">
    ${!art && st.img ? `<img class="fp-banner-mark" src="${esc(st.img)}" alt="">` : ""}
    <div class="fp-banner-text"><div class="fp-banner-kicker">Faction</div><div class="fp-banner-name">${esc(f)}</div><div class="fp-banner-counts">${counts}</div></div>
  </div>`;
}

/** A sheet for choosing the faction's symbol (an image of your own) and its two colours. */
function openStyleSheet(f) {
  const draw = () => {
    const st = factionStyle(f);
    const d = openSheet(`
      <div class="sheet-head"><h2>${esc(f)}: symbol, banner and colours</h2><p>Shown on the faction's button when it's selected. The symbol comes from the faction's PDF (the icon beside its name in the Books table), or you can choose your own image (PNG, JPG, SVG or WebP); it's kept only in this browser.</p></div>
      <div class="sheet-body fp-stylebody">
        <div class="fp-stylepreview">${factionButton(f, true)}</div>
        <div class="field"><label>Symbol</label><div class="fp-stylerow">
          <button class="btn" type="button" id="fsPick">${st.img ? "Change image…" : "Choose image…"}</button>
          ${st.own ? `<button class="btn plain" type="button" id="fsNoImg">${st.pdfIcon ? "Use the PDF's icon" : "Remove image"}</button>` : `<span class="lb-subtle">${st.pdfIcon ? "Using the icon from the faction's PDF." : "No icon was found in this faction's PDF. Add the PDF again to look for one, or choose an image."}</span>`}
          <input type="file" id="fsFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></div></div>
        <div class="field"><label>Banner image</label><div class="fp-stylerow">
          <button class="btn" type="button" id="fsArt">${newestDoc(f)?.banner ? "Change banner image…" : "Choose banner image…"}</button>
          ${newestDoc(f)?.banner ? `<button class="btn plain" type="button" id="fsNoArt">Remove banner image</button>` : ""}
          <input type="file" id="fsArtFile" accept="image/png,image/jpeg,image/webp" hidden></div>
          <span class="hint">A wide picture works best (about 1600 × 300). It fills the right side of the banner and fades into the faction's colours behind the name.</span></div>
        <div class="fp-stylerow">
          <label class="fp-colour">First colour <input type="color" id="fsC1" value="${st.c1}"></label>
          <label class="fp-colour">Second colour <input type="color" id="fsC2" value="${st.c2}"></label>
          <button class="btn plain" type="button" id="fsReset">Default colours</button>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn primary" type="button" data-close>Done</button></div>`);
    const live = () => { const b = d.querySelector(".fp-stylepreview .fp-fac"); b.style.setProperty("--c1", $("#fsC1").value); b.style.setProperty("--c2", $("#fsC2").value); };
    $("#fsC1").oninput = $("#fsC2").oninput = live;
    $("#fsC1").onchange = $("#fsC2").onchange = () => { saveFactionStyle(f, { c1: $("#fsC1").value, c2: $("#fsC2").value }); repaint(); };
    $("#fsReset").onclick = () => { saveFactionStyle(f, { c1: null, c2: null }); repaint(); draw(); };
    $("#fsPick").onclick = () => $("#fsFile").click();
    if ($("#fsNoImg")) $("#fsNoImg").onclick = () => { saveFactionStyle(f, { img: null }); repaint(); draw(); };
    $("#fsFile").onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try { saveFactionStyle(f, { img: await shrinkImage(file) }); repaint(); draw(); }
      catch { toast("That image couldn't be read. Try a PNG or JPG."); }
    };
    const setArt = async art => {
      const doc = newestDoc(f);
      if (!doc) return;
      if (art) doc.banner = art; else delete doc.banner;
      try { await DB.put("docs", doc); } catch { toast("That image is too large to keep. Try a smaller one."); }
      repaint(); draw();
    };
    $("#fsArt").onclick = () => $("#fsArtFile").click();
    if ($("#fsNoArt")) $("#fsNoArt").onclick = () => setArt(null);
    $("#fsArtFile").onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try { await setArt(await shrinkImage(file, 1800, 600, "image/jpeg")); }
      catch { toast("That image couldn't be read. Try a PNG or JPG."); }
    };
    d.querySelector("[data-close]").onclick = () => d.close();
  };
  const repaint = () => { $("#factionsToolbar").dataset.key = ""; renderFactionBar(factionNames()); renderFactionsPage(); };
  draw();
}
/** Scales an image down (96×96 for symbols, 1800×600 for banners) so it stays small enough to keep in the browser. */
function shrinkImage(file, maxW = 96, maxH = 96, type = "image/png") {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((img.naturalWidth || 96) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 96) * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

function renderFactionsPage() {
  const host = $("#factionsHost");
  const names = factionNames();
  if (!names.length) {
    renderFactionBar([]);
    host.innerHTML = `<div class="fp-empty">No factions yet. Add a faction pack PDF (or a RulesForge Excel file) in Library, and its army rules, detachments and units appear here.</div>`;
    return;
  }
  if (!names.some(n => n === fUI.faction)) fUI.faction = names[0];
  renderFactionBar(names);
  const c = factionContent(fUI.faction);
  if (!fUI.sel) fUI.sel = c.armyRules[0] ? { t: "army", k: normName(c.armyRules[0].name) } : c.detachments[0] ? { t: "det", k: normName(c.detachments[0].name) } : null;
  host.innerHTML = `${bannerHTML(fUI.faction, c)}<div class="fp-shell${fUI.open ? " show-detail" : ""}">
      <div class="fp-left">${leftHTML(c)}</div>
      <div class="fp-right" id="fpRight">${rightHTML(c)}</div>
    </div>`;
  host.classList.add("fp-has-wide");
  applyFilter();
}

function leftHTML(c) {
  const item = (t, k, name, meta = "") => `<button type="button" class="fp-item${fUI.sel?.t === t && fUI.sel.k === k ? " on" : ""}" data-fp="${t}" data-k="${esc(k)}" data-name="${esc(normName(name))}">
      <span class="fp-iname">${esc(softenCaps(name))}</span>${meta ? `<span class="fp-imeta">${esc(meta)}</span>` : ""}</button>`;
  const group = (id, title, items) => items.length ? `<details class="fp-grp" data-grp="${esc(id)}" ${fUI.collapsed.has(id) ? "" : "open"}>
      <summary><span class="lb-grp-title">${esc(title)} · ${items.length}</span></summary><div class="fp-items">${items.join("")}</div></details>` : "";
  const groups = DATASHEET_GROUPS.map(([title]) => ({ title, items: [] }));
  for (const ds of c.datasheets) {
    const kws = keywordList(ds.keywords).map(k => k.toUpperCase());
    groups[DATASHEET_GROUPS.findIndex(([, test]) => test(kws))].items.push(ds);
  }
  // Detachments: name on the left, DP on the right, and the Unique tag on its own line below so it can't be read as part of the name.
  const detItem = d => {
    const k = normName(d.name), uq = detUnique(d), dp = parseInt(d.dp, 10);
    return `<button type="button" class="fp-item fp-det${fUI.sel?.t === "det" && fUI.sel.k === k ? " on" : ""}" data-fp="det" data-k="${esc(k)}" data-name="${esc(k)}">
      <span class="fp-irow"><span class="fp-iname">${esc(softenCaps(d.name))}</span>${dp ? `<span class="fp-dp">${dp} DP</span>` : ""}</span>
      ${uq ? `<span class="fp-uq"><span class="fp-uq-k">Unique</span><span class="fp-uq-v">${esc(uq)}</span></span>` : ""}</button>`;
  };
  const pts = ds => { const u = c.priced.get(normName(ds.name)); const o = u?.options || ds.points || []; return o.length ? `${Math.min(...o.map(p => p.points))} pts` : ""; };
  return `<input class="input fp-filter" id="fpFilter" placeholder="Filter by name…" value="${esc(fUI.filter)}">
    ${group("army", "Army Rules", c.armyRules.map(r => item("army", normName(r.name), r.name, r.special ? "Special move" : "")))}
    ${group("det", "Detachments", c.detachments.map(detItem))}
    ${groups.map(g => group(g.title, g.title, g.items.sort((a, b) => a.name.localeCompare(b.name)).map(ds => item("unit", normName(ds.name), ds.name, pts(ds))))).join("")}
    <div class="fp-none" hidden>Nothing matches that name.</div>`;
}

function rightHTML(c) {
  const s = fUI.sel;
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  if (!s) return `<div class="fp-empty">Choose an army rule, detachment or unit on the left.</div>`;
  if (s.t === "army") {
    const r = c.armyRules.find(x => normName(x.name) === s.k);
    if (!r) return "";
    return `${back}<div class="fp-head"><h2>${esc(softenCaps(r.name))}</h2><div class="fp-sub">Army Rule${r.special ? " · Special move" : ""} · ${esc(fUI.faction)}</div></div>
      ${panelHTML("", `<div class="fv-rich fv-army fp-text">${richHTML(r.rich || r.text)}</div>`)}`;
  }
  if (s.t === "det") {
    const d = c.detachments.find(x => normName(x.name) === s.k);
    if (!d) return "";
    const uq = detUnique(d);
    const rivals = uq ? c.detachments.filter(o => o !== d && normName(detUnique(o)) === normName(uq)).map(o => o.name) : [];
    const rules = d.rules.filter(r => !/^unique\b/i.test(r.name));
    const priced = armyData(fUI.faction).detachments.find(x => x.name === d.name);
    const enhPts = e => priced?.enhancements.find(x => x.name === e.name)?.points ?? e.points;
    const isUp = e => priced?.enhancements.find(x => x.name === e.name)?.upgrade;
    const ab = (name, meta, body) => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(name))}${meta ? `<span class="fv-ab-ref">${esc(meta)}</span>` : ""}</div><div class="fv-rich">${body}</div></div>`;
    return `${back}<div class="fp-head"><h2>${esc(d.name)}</h2><div class="fp-sub">Detachment · ${esc(String(d.dp || "").replace(/(\d+)\s*DP/i, "$1 DP"))}</div></div>
      ${uq ? `<div class="fv-unique"><b>Unique: ${esc(uq)}</b><span>${rivals.length ? `Can't be taken in the same army as ${esc(rivals.join(", "))}.` : "No other detachment in your army may share this tag."}</span></div>` : ""}
      ${d.description ? panelHTML("", `<div class="fv-rich fp-text">${richHTML(d.description)}</div>`) : ""}
      ${rules.length ? panelHTML("Detachment Rules", rules.map(r => ab(r.name, "", richHTML(r.rich || r.text))).join("")) : ""}
      ${d.enhancements.length ? panelHTML("Enhancements", d.enhancements.map(e => ab(e.name, [enhPts(e) != null ? `${enhPts(e)} pts` : "", isUp(e) ? "Upgrade" : ""].filter(Boolean).join(" · "), richHTML(e.rich || e.text))).join("")) : ""}
      ${d.stratagems.length ? panelHTML("Stratagems", d.stratagems.map(st => ab(st.name, [String(st.cp || "").replace(/(\d+)\s*CP/i, "$1 CP"), st.category].filter(Boolean).join(" · "), richHTML(st.rich || st.text))).join("")) : ""}`;
  }
  const ds = c.datasheets.find(x => normName(x.name) === s.k);
  if (!ds) return "";
  const u = c.priced.get(normName(ds.name));
  const opts = u?.options || ds.points || [];
  const weapons = type => { const ws = (ds.weapons || []).filter(w => w.type === type); return ws.length ? panelHTML("", weaponGridHTML(ws, type, [])) : ""; };
  return `${back}<div class="fp-head"><h2>${esc(ds.name)}</h2>
      <div class="fp-sub">${opts.map(o => `${o.models} model${o.models === 1 ? "" : "s"} – ${o.points} pts`).join(" · ") || "No points listed"}${u?.pointsFrom ? ` · points from ${esc(u.pointsFrom)}` : ""}</div></div>
    ${statsHTML(ds)}${weapons("Ranged")}${weapons("Melee")}${wargearOptionsHTML(ds)}${datasheetDetailsHTML(ds, c.armyRules, { siblings: c.datasheets, link: true })}`;
}

function applyFilter() {
  const q = normName(fUI.filter);
  let shown = 0;
  for (const g of document.querySelectorAll("#factionsHost .fp-grp")) {
    let any = 0;
    for (const b of g.querySelectorAll(".fp-item")) { const hit = !q || b.dataset.name.includes(q); b.hidden = !hit; any += hit; }
    g.hidden = !any;
    if (q && any) g.open = true;
    shown += any;
  }
  const none = document.querySelector("#factionsHost .fp-none");
  if (none) none.hidden = shown > 0;
}

function wireFactionsPage() {
  const view = $("#view-factions");
  view.addEventListener("click", e => {
    const it = e.target.closest("[data-fp]");
    if (it) {
      fUI.sel = { t: it.dataset.fp, k: it.dataset.k };
      fUI.open = isPhone();
      const left = view.querySelector(".fp-left"), keep = left?.scrollTop;
      renderFactionsPage();
      if (left) view.querySelector(".fp-left").scrollTop = keep;
      view.querySelector(".fp-right").scrollTop = 0;
      return;
    }
    if (e.target.closest("[data-fp-back]")) { fUI.open = false; renderFactionsPage(); return; }
    const fac = e.target.closest("[data-fac]");
    if (fac && fac.closest("#factionsToolbar")) {
      if (fac.dataset.fac === fUI.faction) return;
      fUI.faction = fac.dataset.fac; store.set("rf.faction", fUI.faction); fUI.sel = null; fUI.open = false; fUI.filter = "";
      renderFactionsPage();
      fac.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    if (e.target.closest("[data-fp-style]")) openStyleSheet(fUI.faction);
  });
  view.addEventListener("input", e => { if (e.target.id === "fpFilter") { fUI.filter = e.target.value; applyFilter(); } });
  view.addEventListener("toggle", e => {
    const g = e.target.dataset?.grp;
    if (g && !fUI.filter) e.target.open ? fUI.collapsed.delete(g) : fUI.collapsed.add(g);
  }, true);
}

export { renderFactionsPage, wireFactionsPage };
