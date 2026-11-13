/* RulesForge · factions.js
 * Factions page: a faction's army rules, detachments and units on the left (30%), the selected one in full on the right (70%).
 */
import { $, DB, esc, openSheet, state, store, toast, settingsTabsHTML } from "./core.js?v=8.38";
import { armyData } from "./army.js?v=8.38";
import { DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, panelHTML, statsHTML, tidyDatasheet, wargearOptionsHTML, armyRuleParts, pluralKind, weaponPanelsHTML } from "./datasheets.js?v=8.38";
import { factionMatches } from "./search.js?v=8.38";
import { defaultColours, kitPending, kitSymbol } from "./pack-rules.js?v=8.38";
import { keywordList, normName, richHTML, softenCaps } from "./text.js?v=8.38";

// Army Rules and Detachments start open; the unit groups below them start collapsed.
const fUI = { faction: store.get("rf.faction", ""), sel: null, filter: "", open: false, home: true, collapsed: new Set(DATASHEET_GROUPS.map(([t]) => t)) };
// On phones and tablets every category starts closed, Army Rules and Detachments too.
if (matchMedia("(max-width: 1279px), (pointer: coarse) and (max-width: 1400px)").matches) { fUI.collapsed.add("army"); fUI.collapsed.add("det"); }
const isPhone = () => matchMedia("(max-width: 760px)").matches;
/** Phones and tablets: the bottom menu bar, faction group buttons, closed categories, swipe to go back. */
const TOUCH_LAYOUT = "(max-width: 1279px), (pointer: coarse) and (max-width: 1400px)";
const isTouchLayout = () => matchMedia(TOUCH_LAYOUT).matches;
/* Faction groups for the phone and tablet picker. Factions the app doesn't know yet go under Xenos. */
const FACTION_GROUPS = [
  ["Imperium", ["Adepta Sororitas", "Adeptus Custodes", "Adeptus Mechanicus", "Astra Militarum", "Black Templars", "Blood Angels", "Dark Angels",
    "Deathwatch", "Grey Knights", "Imperial Agents", "Imperial Knights", "Space Marines", "Space Wolves"]],
  ["Forces of Chaos", ["Chaos Daemons", "Chaos Knights", "Chaos Space Marines", "Death Guard", "Emperor's Children", "Thousand Sons", "World Eaters"]],
  ["Xenos", null],
];
const groupOf = f => (FACTION_GROUPS.find(([, list]) => list && list.some(x => normName(x) === normName(f))) || FACTION_GROUPS[2])[0];
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
  // The list shows each army rule once; "[Name] Ability" rules appear inside the rule they belong to.
  return { armyRules, topRules: armyRules.filter(r => !r.partOf), detachments, datasheets, priced };
}

/* ---------- Faction buttons: colours and symbol ---------- */

/* Default colours and symbols come from the faction pack ruleset (pack-rules.js), so they match on every device. */
function factionStyle(f) {
  const saved = store.get("rf.facStyle", {})[f] || {};
  const docs = factionDocs(f).sort((a, b) => b.importedAt - a.importedAt);
  const def = defaultColours(f, docs.find(d => d.theme)?.theme);
  // The symbol: one you chose (this browser only), else the icon read from the faction's PDF ("Books" table).
  // Order: your own image (this browser), the app's faction kit image, then the icon from the faction's PDF.
  const kit = kitSymbol(f), pdfIcon = docs.find(d => d.icon)?.icon || "", base = kit || (kitPending(f) ? "" : pdfIcon);
  return { c1: saved.c1 || def[0], c2: saved.c2 || def[1], img: saved.img || base, own: !!saved.img, pdfIcon: base, kit: !!kit, def };
}
/** Accent colours for keywords, checkboxes and selected weapons: the faction's (default) or the app's own. */
const useFactionAccents = () => store.get("rf.accent", "faction") !== "app";
const luminance = hex => { const v = (parseInt(String(hex).slice(1), 16) || 0), ch = n => { const c = ((v >> n) & 255) / 255; return c <= .04 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * ch(16) + .7152 * ch(8) + .0722 * ch(0); };
function applyAccent(el, f) {
  if (!el) return;
  const on = useFactionAccents() && f;
  el.classList.toggle("acc-faction", !!on);
  // A very dark main colour (Black Templars, Chaos Space Marines) would hide checkboxes and tags, so the trim colour is used.
  if (on) { const st = factionStyle(f), [a, b] = luminance(st.c1) < 0.06 ? [st.c2, st.c1] : [st.c1, st.c2]; el.style.setProperty("--acc", a); el.style.setProperty("--acc2", b); }
  else { el.style.removeProperty("--acc"); el.style.removeProperty("--acc2"); }
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
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const BOOK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/></svg>`;
const ADDPDF_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><path d="M14 2v6h6"/><path d="M20 8v5"/><path d="M18 16v6M15 19h6"/></svg>`;
/** Opens the library: on phones and tablets it's the Factions home; on desktop a panel slides in from the right. */
function openLibrary() {
  if (isTouchLayout()) { fUI.home = true; fUI.open = false; return renderFactionsPage(); }
  $("#view-factions").classList.add("lib-open");
}
const closeLibrary = () => $("#view-factions").classList.remove("lib-open");
function openFactionFromLibrary(f) {
  fUI.faction = f; store.set("rf.faction", f); fUI.sel = null; fUI.open = false; fUI.filter = ""; fUI.home = false;
  closeLibrary(); renderFactionsPage();
}
function renderFactionBar(names) {
  const tools = $("#factionsToolbar");
  // Desktop shows every faction's button; phones and tablets show three group buttons that open a picker.
  const groups = FACTION_GROUPS.map(([g]) => [g, names.filter(n => groupOf(n) === g)]).filter(([, l]) => l.length);
  // Phones and tablets: "‹ Factions" (back to the Factions home, which is the library) and an Add PDF icon.
  // Desktop: "Library" (slides in from the right) and "Add PDF" beside the gear.
  const html = `<button type="button" class="btn fp-homeback" data-fp-home>‹ Factions</button>
    ${names.length ? `<div class="fp-facs" role="group" aria-label="Faction">${names.map(n => factionButton(n, n === fUI.faction)).join("")}</div>
    <div class="fp-groups" role="group" aria-label="Faction group">${groups.map(([g, l]) => `<button type="button" class="fp-groupbtn${groupOf(fUI.faction) === g ? " on" : ""}" data-fp-group="${esc(g)}">${esc(g)}<span class="fp-groupn">${l.length}</span></button>`).join("")}</div>` : `<div class="fp-facs"></div>`}
    <button type="button" class="btn fp-libbtn" data-lib-show>${BOOK_SVG}Library</button>
    <button type="button" class="btn primary fp-addpdf" data-lib-add title="Add PDF" aria-label="Add PDF">${ADDPDF_SVG}<span>Add PDF</span></button>
    ${names.length ? `<button type="button" class="fp-style" data-fp-style title="Symbol, banner &amp; colours" aria-label="Symbol, banner and colours">${GEAR_SVG}</button>` : ""}`;
  // Same factions and looks: only the selection moves, so the name slides and the symbol fades instead of jumping.
  const key = html.replace(/ on(?=[" ])/g, "").replace(/aria-pressed="(true|false)"/g, "");
  if (tools.dataset.key !== key) { tools.dataset.key = key; tools.innerHTML = html; }
  else for (const b of tools.querySelectorAll(".fp-fac")) { const on = b.dataset.fac === fUI.faction; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
  const row = tools.querySelector(".fp-facs"), on = row?.querySelector(".fp-fac.on");
  // Scrolls the row so the selected button is fully in view (measured against the row itself, so it never ends up under the
  // title or the gear). The button grows as it's selected, so it's checked again once that finishes.
  const reveal = () => {
    const btn = row?.querySelector(".fp-fac.on");
    if (!btn) return;
    const r = row.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (b.left < r.left + 8) row.scrollBy({ left: b.left - (r.left + 8), behavior: "smooth" });
    else if (b.right > r.right - 8) row.scrollBy({ left: b.right - (r.right - 8), behavior: "smooth" });
  };
  if (on) { reveal(); clearTimeout(row._reveal); row._reveal = setTimeout(reveal, 480); }
}

/* ---------- The faction banner (full width, above both columns, always in view) ---------- */
const newestDoc = f => factionDocs(f).sort((a, b) => b.importedAt - a.importedAt)[0];
/** Phones and tablets with a unit open: the banner becomes the unit's header (Back, faction, unit name, models and points). */
const unitMode = () => isTouchLayout() && fUI.sel?.t === "unit" && (fUI.open || !isPhone());
function bannerHTML(f, c) {
  const st = factionStyle(f), art = newestDoc(f)?.banner || "";
  const ds = unitMode() && c.datasheets.find(x => normName(x.name) === fUI.sel.k);
  if (ds) {
    const u = c.priced.get(normName(ds.name)), opts = u?.options || ds.points || [];
    const cost = opts.map(o => `<span><b>${o.models}</b> model${o.models === 1 ? "" : "s"} – <b>${o.points}</b> pts</span>`).join("") || "<span>No points listed</span>";
    // Shown beside the name once the header has shrunk (the model counts are hidden then).
    const pts = opts.length ? `${opts.map(o => o.points).join(" / ")} pts` : "";
    return `<div class="fp-banner fp-unitbanner${art ? " has-art" : ""}" style="--c1:${st.c1};--c2:${st.c2}${art ? `;--art:url('${art}')` : ""}">
    ${!art && st.img ? `<img class="fp-banner-mark" src="${esc(st.img)}" alt="">` : ""}
    <div class="fp-banner-text"><button type="button" class="btn fp-bannerback" data-fp-back>‹ Back</button><div class="fp-banner-nameline"><span class="fp-banner-name">${esc(ds.name)}</span>${pts ? `<span class="fp-banner-pts">${esc(pts)}</span>` : ""}</div><div class="fp-banner-counts">${cost}</div></div>
  </div>`;
  }
  const counts = [[c.topRules.length, "Army Rule"], [c.detachments.length, "Detachment"], [c.datasheets.length, "Datasheet"]]
    .filter(([n]) => n).map(([n, w]) => `<span><b>${n}</b> ${w}${n === 1 ? "" : "s"}</span>`).join("");
  return `<div class="fp-banner${art ? " has-art" : ""}" style="--c1:${st.c1};--c2:${st.c2}${art ? `;--art:url('${art}')` : ""}">
    ${!art && st.img ? `<img class="fp-banner-mark" src="${esc(st.img)}" alt="">` : ""}
    <div class="fp-banner-text"><div class="fp-banner-kicker">Faction</div><div class="fp-banner-name">${esc(f)}</div><div class="fp-banner-counts">${counts}</div></div>
  </div>`;
}

/** A sheet for choosing the faction's symbol (an image of your own) and its two colours. */
function openStyleSheet(f = fUI.faction || factionNames()[0]) {
  if (!f) return false;
  const draw = () => {
    const st = factionStyle(f);
    const d = openSheet(`
      ${settingsTabsHTML("colours")}<div class="sheet-head"><h2>${esc(f)}: symbol, banner and colours</h2><p>Shown on the faction's button when it's selected. The symbol comes from the faction's PDF (the icon beside its name in the Books table), or you can choose your own image (PNG, JPG, SVG or WebP); Your own image, banner and colours are kept only in this browser; everyone who adds the same faction pack starts from the same symbol and colours.</p></div>
      <div class="sheet-body fp-stylebody">
        <div class="fp-stylepreview">${factionButton(f, true)}</div>
        <div class="field"><label>Symbol</label><div class="fp-stylerow">
          <button class="btn" type="button" id="fsPick">${st.img ? "Change image…" : "Choose image…"}</button>
          ${st.own ? `<button class="btn plain" type="button" id="fsNoImg">${st.kit ? "Use the app's symbol" : st.pdfIcon ? "Use the PDF's icon" : "Remove image"}</button>` : `<span class="lb-subtle">${st.kit ? "Using the app's symbol for this faction." : st.pdfIcon ? "Using the icon from the faction's PDF." : "No icon was found in this faction's PDF. Add the PDF again to look for one, or choose an image."}</span>`}
          <input type="file" id="fsFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden></div></div>
        <div class="field"><label>Banner image</label><div class="fp-stylerow">
          <button class="btn" type="button" id="fsArt">${newestDoc(f)?.banner ? "Change banner image…" : "Choose banner image…"}</button>
          ${newestDoc(f)?.banner ? `<button class="btn plain" type="button" id="fsNoArt">Remove banner image</button>` : ""}
          <input type="file" id="fsArtFile" accept="image/png,image/jpeg,image/webp" hidden></div>
          <span class="hint">A wide picture works best (about 1600 × 300). It fills the right side of the banner and fades into the faction's colours behind the name.</span></div>
        <div class="field"><label>Accent colours</label><div class="fp-stylerow" role="radiogroup">
          <label class="fp-colour"><input type="radio" name="fsAcc" value="faction" ${useFactionAccents() ? "checked" : ""}> Faction colours</label>
          <label class="fp-colour"><input type="radio" name="fsAcc" value="app" ${useFactionAccents() ? "" : "checked"}> App default colours</label></div>
          <span class="hint">Used for weapon keywords, checkboxes and selected weapons, here and in list building (every faction).</span></div>
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
    d.querySelectorAll("input[name=fsAcc]").forEach(i => i.onchange = () => { store.set("rf.accent", i.value); repaint(); });
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
  return true;
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
  // Phones and tablets open on the Factions home (the library); picking a faction opens it.
  $("#view-factions").classList.toggle("fp-home", isTouchLayout() && (fUI.home || !names.length));
  if (!names.length) {
    renderFactionBar([]);
    $("#view-factions").classList.remove("fp-unitmode");
    host.innerHTML = `<div class="fp-empty">No factions yet. Use Add PDF to add a faction pack PDF (or a RulesForge Excel file), and its army rules, detachments and units appear here.</div>`;
    return;
  }
  if (!names.some(n => n === fUI.faction)) fUI.faction = names[0];
  renderFactionBar(names);
  const c = factionContent(fUI.faction);
  if (!fUI.sel) fUI.sel = c.topRules[0] ? { t: "army", k: normName(c.topRules[0].name) } : c.detachments[0] ? { t: "det", k: normName(c.detachments[0].name) } : null;
  host.innerHTML = `${bannerHTML(fUI.faction, c)}<div class="fp-shell${fUI.open ? " show-detail" : ""}">
      <div class="fp-left">${leftHTML(c)}</div>
      <div class="fp-right" id="fpRight">${rightHTML(c)}</div>
    </div>`;
  host.classList.add("fp-has-wide");
  $("#view-factions").classList.toggle("fp-unitmode", unitMode());
  host.querySelector(".fp-right").onscroll = shrinkBanner;
  applyAccent(host, fUI.faction);
  applyFilter();
}

/** Unit header: shrinks once the datasheet is scrolled down, and grows again only when it's back near the top
   (different points either way, so it doesn't flicker at the edge). */
function shrinkBanner(e) {
  const b = document.querySelector("#factionsHost .fp-unitbanner");
  if (!b) return;
  const y = e.target.scrollTop;
  if (y > 48 && !b.classList.contains("compact")) b.classList.add("compact");
  else if (y < 12 && b.classList.contains("compact")) b.classList.remove("compact");
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
  // A detachment stays open in the list while any of its own parts (the page, Stratagems or Enhancements) is selected.
  const inDet = k => ["det", "dstrat", "denh"].includes(fUI.sel?.t) && fUI.sel.k === k;
  const detItem = d => {
    const k = normName(d.name), uq = detUnique(d), dp = parseInt(d.dp, 10);
    // One line: name, then the Unique tag, then DP at the right edge.
    return `<button type="button" class="fp-item fp-det${inDet(k) ? " on" : ""}" data-fp="det" data-k="${esc(k)}" data-name="${esc(k)}" title="${esc(d.name)}${uq ? ` · Unique: ${esc(uq)}` : ""}">
      <span class="fp-irow"><span class="fp-iname">${esc(softenCaps(d.name))}</span>${uq ? `<span class="fp-uq"><span class="fp-uq-k">Unique</span><span class="fp-uq-v">${esc(uq)}</span></span>` : ""}${dp ? `<span class="fp-dp">${dp} DP</span>` : ""}</span></button>`;
  };
  const pts = ds => { const u = c.priced.get(normName(ds.name)); const o = u?.options || ds.points || []; return o.length ? `${Math.min(...o.map(p => p.points))} pts` : ""; };
  return `<input class="input fp-filter" id="fpFilter" placeholder="Filter by name…" value="${esc(fUI.filter)}">
    ${group("army", "Army Rules", c.topRules.map(r => { const ps = armyRuleParts(r, c.armyRules);
      return item("army", normName(r.name), r.name, r.special ? "Special move" : ps.length ? `${ps.length} ${pluralKind(ps[0].kind, ps.length)}` : ""); }))}
    ${group("det", "Detachments", c.detachments.map(d => { const k = normName(d.name);
      return `<div class="fp-detwrap" data-name="${esc(k)}">${detItem(d)}${inDet(k) ? detSubsHTML(d) : ""}</div>`; }))}
    ${groups.map(g => group(g.title, g.title, g.items.sort((a, b) => a.name.localeCompare(b.name)).map(ds => item("unit", normName(ds.name), ds.name, pts(ds))))).join("")}
    <div class="fp-none" hidden>Nothing matches that name.</div>`;
}

/** Under a selected detachment in the list: two boxes, Stratagems then Enhancements. Choosing one shows its entries in the right column. */
function detSubsHTML(d) {
  const k = normName(d.name);
  const box = (t, title, n) => `<div class="fp-subrow"><svg class="fp-arrow" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1v8.5h8"/><path d="M8.5 6.5 11 9l-2.5 2.5"/></svg><button type="button" class="fp-subbox${fUI.sel?.t === t && fUI.sel.k === k ? " on" : ""}" data-fp="${t}" data-k="${esc(k)}">${title} · ${n}</button></div>`;
  return `<div class="fp-subs">${box("dstrat", "Stratagems", d.stratagems.length)}${box("denh", "Enhancements", d.enhancements.length)}</div>`;
}

function rightHTML(c) {
  const s = fUI.sel;
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  if (!s) return `<div class="fp-empty">Choose an army rule, detachment or unit on the left.</div>`;
  if (s.t === "army") {
    const r = c.armyRules.find(x => normName(x.name) === s.k);
    if (!r) return "";
    const ps = armyRuleParts(r, c.armyRules);
    return `${back}<div class="fp-head"><h2>${esc(softenCaps(r.name))}</h2><div class="fp-sub">Army Rule${r.special ? " · Special move" : ""}${ps.length ? ` · ${ps.length} ${esc(pluralKind(ps[0].kind, ps.length))}` : ""} · ${esc(fUI.faction)}</div></div>
      ${panelHTML("", `<div class="fv-rich fv-army fp-text">${richHTML(r.rich || r.text)}</div>`)}
      ${ps.length ? panelHTML(esc(pluralKind(ps[0].kind, ps.length)), ps.map(p => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(p.name))}</div><div class="fv-rich">${richHTML(p.rich || p.text)}</div></div>`).join("")) : ""}`;
  }
  if (s.t === "dstrat" || s.t === "denh") {
    const d = c.detachments.find(x => normName(x.name) === s.k);
    if (!d) return "";
    const priced = armyData(fUI.faction).detachments.find(x => x.name === d.name);
    const enhPts = e => priced?.enhancements.find(x => x.name === e.name)?.points ?? e.points;
    const isUp = e => priced?.enhancements.find(x => x.name === e.name)?.upgrade;
    const fl = x => x.flavour ? `<p class="fv-flavour">${esc(x.flavour)}</p>` : "";
    const ab = (name, meta, body) => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(name))}${meta ? `<span class="fv-ab-ref">${esc(meta)}</span>` : ""}</div><div class="fv-rich">${body}</div></div>`;
    const strat = s.t === "dstrat";
    const items = strat
      ? d.stratagems.map(st => ab(st.name, [String(st.cp || "").replace(/(\d+)\s*CP/i, "$1 CP"), st.category].filter(Boolean).join(" · "), fl(st) + richHTML(st.rich || st.text)))
      : d.enhancements.map(e => ab(e.name, [enhPts(e) != null ? `${enhPts(e)} pts` : "", isUp(e) ? "Upgrade" : ""].filter(Boolean).join(" · "), fl(e) + richHTML(e.rich || e.text)));
    return `${back}<div class="fp-head"><h2>${strat ? "Stratagems" : "Enhancements"}</h2><div class="fp-sub">${esc(d.name)} · ${items.length}</div></div>
      ${items.length ? panelHTML("", items.join("")) : `<div class="fp-empty">None in this detachment.</div>`}`;
  }
  if (s.t === "det") {
    const d = c.detachments.find(x => normName(x.name) === s.k);
    if (!d) return "";
    const uq = detUnique(d);
    const disp = d.dispositions?.length ? d.dispositions : uq ? [uq] : [];
    const rivals = uq ? c.detachments.filter(o => o !== d && normName(detUnique(o)) === normName(uq)).map(o => o.name) : [];
    const rules = d.rules.filter(r => !/^unique\b/i.test(r.name));
    // Lore text (in italics) above the rules, when the faction pack prints any.
    const fl = x => x.flavour ? `<p class="fv-flavour">${esc(x.flavour)}</p>` : "";
    const ab = (name, meta, body) => `<div class="fv-ab"><div class="fv-ab-name">${esc(softenCaps(name))}${meta ? `<span class="fv-ab-ref">${esc(meta)}</span>` : ""}</div><div class="fv-rich">${body}</div></div>`;
    return `${back}<div class="fp-head"><h2>${esc(d.name)}</h2><div class="fp-sub">Detachment · ${esc(String(d.dp || "").replace(/(\d+)\s*DP/i, "$1 DP"))}</div></div>
      ${uq ? `<div class="fv-unique"><b>Unique: ${esc(uq)}</b><span>${rivals.length ? `Can't be taken in the same army as ${esc(rivals.join(", "))}.` : "No other detachment in your army may share this tag."}</span></div>` : ""}
      ${disp.length ? panelHTML("Force Disposition:", `<div class="fp-disp"><span class="fp-disp-sym" aria-hidden="true">◆</span><span class="fp-disp-name">${esc(disp.join(", "))}</span></div>`) : ""}
      ${d.description ? panelHTML("", `<div class="fv-rich fp-text">${richHTML(d.description)}</div>`) : ""}
      ${rules.length ? panelHTML("Detachment Rules", rules.map(r => ab(r.name, "", fl(r) + richHTML(r.rich || r.text))).join("")) : ""}
      `;
  }
  const ds = c.datasheets.find(x => normName(x.name) === s.k);
  if (!ds) return "";
  const u = c.priced.get(normName(ds.name));
  const opts = u?.options || ds.points || [];

  if (unitMode()) return `${statsHTML(ds)}${weaponPanelsHTML(ds)}${wargearOptionsHTML(ds)}${datasheetDetailsHTML(ds, c.armyRules, { siblings: c.datasheets, link: true })}`;
  return `${back}<div class="fp-head"><h2>${esc(ds.name)}</h2>
      <div class="fp-sub">${opts.map(o => `${o.models} model${o.models === 1 ? "" : "s"} – ${o.points} pts`).join(" · ") || "No points listed"}${u?.pointsFrom ? ` · points from ${esc(u.pointsFrom)}` : ""}</div></div>
    ${statsHTML(ds)}${weaponPanelsHTML(ds)}${wargearOptionsHTML(ds)}${datasheetDetailsHTML(ds, c.armyRules, { siblings: c.datasheets, link: true })}`;
}

function applyFilter() {
  const q = normName(fUI.filter);
  let shown = 0;
  for (const g of document.querySelectorAll("#factionsHost .fp-grp")) {
    let any = 0;
    for (const b of g.querySelectorAll(".fp-item")) { const hit = !q || b.dataset.name.includes(q); (b.closest(".fp-detwrap") || b).hidden = !hit; any += hit; }
    g.hidden = !any;
    if (q && any) g.open = true;
    shown += any;
  }
  const none = document.querySelector("#factionsHost .fp-none");
  if (none) none.hidden = shown > 0;
}

/** A popup listing one group's factions as their buttons; tapping one selects it. */
function openFactionPicker(group) {
  const names = factionNames().filter(n => groupOf(n) === group);
  const d = openSheet(`<div class="sheet-head"><h2>${esc(group)}</h2><p>Choose a faction.</p></div>
    <div class="sheet-body fp-picker">${names.map(n => factionButton(n, n === fUI.faction)).join("")}</div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Close</button></div>`);
  d.querySelector(".fp-picker").onclick = e => {
    const b = e.target.closest("[data-fac]");
    if (!b) return;
    d.close();
    if (b.dataset.fac === fUI.faction) { if (fUI.home) { fUI.home = false; renderFactionsPage(); } return; }
    fUI.home = false; fUI.faction = b.dataset.fac; store.set("rf.faction", fUI.faction); fUI.sel = null; fUI.open = false; fUI.filter = "";
    renderFactionsPage();
  };
}
/** Calls back on a mostly-horizontal swipe to the right (touch screens), started where `where(event)` allows. */
function onSwipeRight(el, where, cb) {
  let x0 = null, y0 = 0;
  el.addEventListener("touchstart", e => { const t = e.touches[0]; x0 = where(e) ? t.clientX : null; y0 = t.clientY; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0); x0 = null;
    if (dx > 70 && dy < dx * 0.6) cb();
  }, { passive: true });
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
    if (e.target.closest("[data-fp-home]")) { fUI.home = true; fUI.open = false; return renderFactionsPage(); }
    if (e.target.closest("[data-lib-show]")) return openLibrary();
    if (e.target.closest("[data-lib-close]")) return closeLibrary();
    const libFac = !e.target.closest(".lib-kebab") && e.target.closest("[data-lib-open]");
    if (libFac) return openFactionFromLibrary(libFac.dataset.libOpen);
    if (e.target.closest("[data-fp-back]")) { if (!isPhone() && unitMode()) fUI.sel = null; fUI.open = false; renderFactionsPage(); return; }
    const fac = e.target.closest("[data-fac]");
    if (fac && fac.closest("#factionsToolbar")) {
      if (fac.dataset.fac === fUI.faction) return;
      fUI.faction = fac.dataset.fac; store.set("rf.faction", fUI.faction); fUI.sel = null; fUI.open = false; fUI.filter = "";
      renderFactionsPage();
      fac.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    const grp = e.target.closest("[data-fp-group]");
    if (grp) { openFactionPicker(grp.dataset.fpGroup); return; }
    if (e.target.closest("[data-fp-style]")) openStyleSheet(fUI.faction);
  });
  // Phones and tablets: swipe right on the datasheet to go back to the list.
  onSwipeRight(view, e => !!e.target.closest(".fp-shell.show-detail .fp-right"), () => { if (fUI.open) { fUI.open = false; renderFactionsPage(); } });
  onSwipeRight(view, e => isTouchLayout() && !fUI.home && !fUI.open && !!e.target.closest(".fp-left"), () => { fUI.home = true; renderFactionsPage(); });
  // Keyboard: Enter or Space on a faction's box in the library opens it.
  view.addEventListener("keydown", e => { const c = e.target.matches?.("[data-lib-open]") && (e.key === "Enter" || e.key === " "); if (c) { e.preventDefault(); openFactionFromLibrary(e.target.dataset.libOpen); } });
  view.addEventListener("input", e => { if (e.target.id === "fpFilter") { fUI.filter = e.target.value; applyFilter(); } });
  view.addEventListener("toggle", e => {
    const g = e.target.dataset?.grp;
    if (g && !fUI.filter) e.target.open ? fUI.collapsed.delete(g) : fUI.collapsed.add(g);
  }, true);
}

export { applyAccent, factionStyle, onSwipeRight, openLibrary, openStyleSheet, renderFactionsPage, wireFactionsPage };
