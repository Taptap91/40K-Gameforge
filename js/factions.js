/* RulesForge · factions.js
 * Factions page: a faction's army rules, detachments and units on the left (30%), the selected one in full on the right (70%).
 */
import { $, DB, esc, icon, openSheet, state, store, toast, settingsTabsHTML } from "./core.js?v=8.51";
import { armyData } from "./army.js?v=8.51";
import { DATASHEET_GROUPS, datasheetDetailsHTML, detUnique, panelHTML, statsHTML, tidyDatasheet, wargearOptionsHTML, armyRuleParts, pluralKind, weaponPanelsHTML } from "./datasheets.js?v=8.51";
import { factionMatches } from "./search.js?v=8.51";
import { defaultColours, kitPending, kitSymbol } from "./pack-rules.js?v=8.51";
import { keywordList, normName, richHTML, softenCaps } from "./text.js?v=8.51";
import { sectionCount, TABS as MISSION_TABS, tabHTML as missionTabHTML } from "./mission-viewer.js?v=8.51";
import { ruleKey, rulesBannerHTML, rulesLeftHTML, rulesRightHTML, sectionsGrouped } from "./rules-viewer.js?v=8.51";
import { libraryHTML } from "./library.js?v=8.51";

/** The back button to the Game Packs home screen (the Library), shown inside every banner — a faction's, a
 *  mission pack's, a rules document's, and a Game Pack's own sections screen. */
const HOME_LINK = `<button type="button" class="btn plain fp-homelink" data-fp-home>‹ Back</button>`;

// Army Rules and Detachments start open; the unit groups below them start collapsed.
const fUI = { faction: store.get("rf.faction", ""), sel: null, filter: "", open: false, home: true, collapsed: new Set(DATASHEET_GROUPS.map(([t]) => t)), mission: null, missionTab: "battle", bundle: null, rulesDoc: null, ruleSel: null, facGroup: "All" };
// On phones and tablets every category starts closed, Army Rules and Detachments too.
if (matchMedia("(max-width: 1279px), (pointer: coarse) and (max-width: 1400px)").matches) { fUI.collapsed.add("army"); fUI.collapsed.add("det"); }
const isPhone = () => matchMedia("(max-width: 760px)").matches;
/** Phones and tablets: the bottom menu bar, closed categories, swipe to go back. */
const TOUCH_LAYOUT = "(max-width: 1279px), (pointer: coarse) and (max-width: 1400px)";
const isTouchLayout = () => matchMedia(TOUCH_LAYOUT).matches;
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
/** Goes to the Game Packs home screen (the Library) — the page's default view. */
function goHome() { fUI.home = true; fUI.mission = null; fUI.bundle = null; fUI.rulesDoc = null; fUI.open = false; renderFactionsPage(); }
function openFactionFromLibrary(f) {
  fUI.faction = f; store.set("rf.faction", f); fUI.sel = null; fUI.open = false; fUI.filter = ""; fUI.home = false; fUI.mission = null; fUI.bundle = null; fUI.rulesDoc = null;
  renderFactionsPage();
}
const missionDocs = () => state.docs.filter(d => d.kind === "missions" && d.structured?.missionPack).sort((a, b) => a.title.localeCompare(b.title));
function openMissionFromLibrary(docId) {
  fUI.mission = docId; fUI.missionTab = "battle"; fUI.open = false; fUI.home = false; fUI.bundle = null; fUI.rulesDoc = null;
  renderFactionsPage();
}
/** A Game Pack's box in the Library opens this: its contents split into Rules, Mission Packs and
 *  Factions (A–Z), each shown as a box laid out like the Library's own, so picking one opens it the
 *  same way picking it from the Library would. */
function openBundleFromLibrary(bundleId) {
  fUI.bundle = bundleId; fUI.mission = null; fUI.rulesDoc = null; fUI.open = false; fUI.home = false; fUI.facGroup = "All";
  renderFactionsPage();
}
/** A Rules box (Core Rules or an Update) inside a Game Pack's sections opens its own full-page view:
 *  numbered rules on the left, the selected one's text on the right. */
function openRulesFromLibrary(docId) {
  fUI.rulesDoc = docId; fUI.ruleSel = null; fUI.bundle = null; fUI.mission = null; fUI.open = false; fUI.home = false;
  renderFactionsPage();
}
const bundleDocs = bundleId => state.docs.filter(d => d.pack?.bundleId === bundleId);

/** Which of the three broad groups a faction belongs to, for the All/Imperium/Chaos/Xenos toggle in a
 *  Game Pack's Factions section. Anything not listed (every Xenos faction, and any new one the app
 *  doesn't know yet) falls into Xenos. */
const FACTION_GROUPS = [
  ["Imperium", ["Adepta Sororitas", "Adeptus Custodes", "Adeptus Mechanicus", "Astra Militarum", "Black Templars", "Blood Angels", "Dark Angels",
    "Deathwatch", "Grey Knights", "Imperial Agents", "Imperial Knights", "Space Marines", "Space Wolves"]],
  ["Chaos", ["Chaos Daemons", "Chaos Knights", "Chaos Space Marines", "Death Guard", "Emperor's Children", "Thousand Sons", "World Eaters"]],
  ["Xenos", null],
];
const groupOf = f => (FACTION_GROUPS.find(([, list]) => list && list.some(x => normName(x) === normName(f))) || FACTION_GROUPS[2])[0];

/** The Game Pack's sections screen: Core Rules at the top (its own section, boxed like a faction/codex),
 *  then Mission Packs, then Factions (A–Z, filterable by an All/Imperium/Chaos/Xenos toggle) — each laid
 *  out like the Library's own boxes. */
function bundleSectionsHTML(bundleId) {
  const docs = bundleDocs(bundleId);
  const title = docs[0]?.pack?.bundleTitle || bundleId;
  const core = docs.find(d => d.kind === "core");
  const updates = docs.filter(d => d.kind === "updates").sort((a, b) => a.title.localeCompare(b.title));
  const missions = docs.filter(d => d.kind === "missions").sort((a, b) => a.title.localeCompare(b.title));
  const allFacs = docs.filter(d => d.kind === "faction").sort((a, b) => String(a.faction || a.title).localeCompare(String(b.faction || b.title)));
  const facGroup = allFacs.some(d => groupOf(d.faction || d.title) === fUI.facGroup) || fUI.facGroup === "All" ? fUI.facGroup : "All";
  const facs = facGroup === "All" ? allFacs : allFacs.filter(d => groupOf(d.faction || d.title) === facGroup);

  const coreCard = d => `<div class="lib-card lib-core" role="button" tabindex="0" data-rules-open="${esc(d.id)}">
      <div class="lib-icon">${icon("book")}</div>
      <div class="lib-text"><div class="lib-name">Core Rules</div></div></div>`;
  const updateCard = d => `<div class="lib-card" role="button" tabindex="0" data-rules-open="${esc(d.id)}">
      <div class="lib-icon">${icon("clock")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.title)}</div></div></div>`;
  const missionCard = d => `<div class="lib-card lib-pack" role="button" tabindex="0" data-mission-open="${esc(d.id)}">
      <div class="lib-icon">${icon("flag")}</div>
      <div class="lib-text"><div class="lib-name">${esc(d.title)}</div></div></div>`;
  const facCard = d => {
    const st = factionStyle(d.faction || "");
    return `<div class="lib-card lib-fac${st.img ? " has-mark" : ""}" role="button" tabindex="0" data-lib-open="${esc(d.faction)}" style="--c1:${st.c1};--c2:${st.c2}">
      ${st.img ? `<img class="lib-mark" src="${esc(st.img)}" alt="">` : ""}
      <div class="lib-text"><div class="lib-name">${esc(d.faction)}</div></div></div>`;
  };
  const group = (label, items, card) => items.length ? `<div class="group-title">${esc(label)}</div><div class="lib-cards">${items.map(card).join("")}</div>` : "";
  const facToggle = `<div class="set-tabs fp-facgroup-tabs" role="tablist" aria-label="Faction group">
      ${["All", ...FACTION_GROUPS.map(([g]) => g)].map(g => `<button type="button" role="tab" class="set-tab${facGroup === g ? " on" : ""}" aria-selected="${facGroup === g}" data-fp-facgroup="${esc(g)}">${esc(g)}</button>`).join("")}
    </div>`;

  return `<div class="fp-banner"><div class="fp-banner-text">${HOME_LINK}<div class="fp-banner-kicker">Game Pack</div><div class="fp-banner-name">${esc(title)}</div></div></div>
    <div class="fp-bundle-sections">
      ${core || updates.length ? `<div class="group-title">Core Rules</div><div class="lib-cards">${core ? coreCard(core) : ""}${updates.map(updateCard).join("")}</div>` : ""}
      ${group("Mission Packs", missions, missionCard)}
      ${allFacs.length ? `<div class="group-title">Factions</div>${facToggle}<div class="lib-cards">${facs.length ? facs.map(facCard).join("") : `<p class="fp-empty">No factions in ${esc(facGroup)}.</p>`}</div>` : ""}
    </div>`;
}
/** The header above the page content: just the title (in index.html) and this one download button —
 *  whatever's downloaded or not, and wherever you are in the page, the header never shows anything else.
 *  Browsing (factions, mission packs, rules, a Game Pack's own sections) all happens in the content area. */
function renderFactionBar() {
  const tools = $("#factionsToolbar");
  tools.innerHTML = `<button type="button" class="btn primary fp-packs" data-lib-packs title="Game Packs" aria-label="Download a Game Pack">${icon("download")}<span>Game Packs</span></button>`;
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
    <div class="fp-banner-text">${HOME_LINK}<div class="fp-banner-kicker">Faction</div><div class="fp-banner-name">${esc(f)}</div><div class="fp-banner-counts">${counts}</div></div>
    <button type="button" class="fp-style" data-fp-style title="Symbol, banner &amp; colours" aria-label="Symbol, banner and colours">${GEAR_SVG}</button>
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

/** A mission pack's own banner: same shell as a faction's, no symbol/colours of its own. */
function missionBannerHTML(pack) {
  const counts = [[sectionCount(pack, "primaries"), "Primary Mission"], [sectionCount(pack, "secondaries"), "Secondary Mission"], [sectionCount(pack, "deployments"), "Deployment"]]
    .filter(([n]) => n).map(([n, w]) => `<span><b>${n}</b> ${w}${n === 1 ? "" : "s"}</span>`).join("");
  return `<div class="fp-banner"><div class="fp-banner-text">${HOME_LINK}<div class="fp-banner-kicker">Mission Pack</div><div class="fp-banner-name">${esc(pack.name)}</div><div class="fp-banner-counts">${counts}</div></div></div>`;
}
/** Left list: one item per section that has anything in it (Battle, Force Dispositions, Primary/Secondary
 *  Missions, Deployments, Twists, FAQ) — the same left-list/right-detail shell a faction uses. */
function missionLeftHTML(pack) {
  const items = MISSION_TABS.filter(([k]) => sectionCount(pack, k));
  return `<div class="fp-items">${items.map(([k, label]) => `<button type="button" class="fp-item${fUI.missionTab === k ? " on" : ""}" data-fp-mission="${esc(k)}">
      <span class="fp-iname">${esc(label)}</span><span class="fp-imeta">${sectionCount(pack, k)}</span></button>`).join("")}</div>`;
}
function missionRightHTML(pack) {
  const back = `<button type="button" class="btn plain fp-back" data-fp-back>‹ Back</button>`;
  const label = (MISSION_TABS.find(([k]) => k === fUI.missionTab) || [])[1] || "";
  return `${back}<div class="fp-head"><h2>${esc(label)}</h2></div>${missionTabHTML(pack, fUI.missionTab)}`;
}

function renderFactionsPage() {
  const host = $("#factionsHost");
  const names = factionNames();
  const missions = missionDocs();
  if (fUI.mission && !missions.some(d => d.id === fUI.mission)) fUI.mission = null;
  if (fUI.bundle && !bundleDocs(fUI.bundle).length) fUI.bundle = null;
  if (fUI.rulesDoc && !state.docs.some(d => d.id === fUI.rulesDoc && (d.kind === "core" || d.kind === "updates"))) fUI.rulesDoc = null;
  if (fUI.faction && !names.includes(fUI.faction)) fUI.faction = "";
  // Nothing in particular selected (or it just got deleted out from under us): the Game Packs home screen.
  if (!fUI.bundle && !fUI.rulesDoc && !fUI.mission && !fUI.faction) fUI.home = true;
  renderFactionBar();
  $("#view-factions").classList.remove("fp-unitmode");
  if (fUI.home) {
    host.innerHTML = libraryHTML();
    host.classList.add("fp-has-wide");
    applyAccent(host, "");
    return;
  }
  if (fUI.bundle) {
    host.innerHTML = bundleSectionsHTML(fUI.bundle);
    host.classList.add("fp-has-wide");
    applyAccent(host, "");
    return;
  }
  if (fUI.rulesDoc) {
    const doc = state.docs.find(d => d.id === fUI.rulesDoc);
    const flat = sectionsGrouped(doc).flatMap(g => g.items);
    if (!fUI.ruleSel || !flat.some(s => ruleKey(s) === fUI.ruleSel)) fUI.ruleSel = flat[0] ? ruleKey(flat[0]) : null;
    const sel = flat.find(s => ruleKey(s) === fUI.ruleSel);
    host.innerHTML = `${rulesBannerHTML(doc)}<div class="fp-shell${fUI.open ? " show-detail" : ""}">
        <div class="fp-left">${rulesLeftHTML(doc, fUI.ruleSel)}</div>
        <div class="fp-right" id="fpRight">${rulesRightHTML(sel)}</div>
      </div>`;
    host.classList.add("fp-has-wide");
    applyAccent(host, "");
    return;
  }
  if (fUI.mission) {
    const pack = missions.find(d => d.id === fUI.mission).structured.missionPack;
    if (!MISSION_TABS.some(([k]) => k === fUI.missionTab && sectionCount(pack, k))) fUI.missionTab = MISSION_TABS.find(([k]) => sectionCount(pack, k))?.[0] || "battle";
    host.innerHTML = `${missionBannerHTML(pack)}<div class="fp-shell${fUI.open ? " show-detail" : ""}">
        <div class="fp-left">${missionLeftHTML(pack)}</div>
        <div class="fp-right" id="fpRight">${missionRightHTML(pack)}</div>
      </div>`;
    host.classList.add("fp-has-wide");
    applyAccent(host, "");
    return;
  }
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
    if (e.target.closest("[data-fp-home]")) { goHome(); return; }
    const libFac = !e.target.closest(".lib-kebab") && e.target.closest("[data-lib-open]");
    if (libFac) return openFactionFromLibrary(libFac.dataset.libOpen);
    const missionOpen = !e.target.closest(".lib-kebab") && e.target.closest("[data-mission-open]");
    if (missionOpen) return openMissionFromLibrary(missionOpen.dataset.missionOpen);
    const bundleOpen = !e.target.closest(".lib-kebab") && e.target.closest("[data-bundle-open]");
    if (bundleOpen) return openBundleFromLibrary(bundleOpen.dataset.bundleOpen);
    const rulesOpen = !e.target.closest(".lib-kebab") && e.target.closest("[data-rules-open]");
    if (rulesOpen) return openRulesFromLibrary(rulesOpen.dataset.rulesOpen);
    const ms = e.target.closest("[data-fp-mission]");
    if (ms) {
      fUI.missionTab = ms.dataset.fpMission;
      fUI.open = isPhone();
      const left = view.querySelector(".fp-left"), keep = left?.scrollTop;
      renderFactionsPage();
      if (left) view.querySelector(".fp-left").scrollTop = keep;
      view.querySelector(".fp-right").scrollTop = 0;
      return;
    }
    const rl = e.target.closest("[data-fp-rule]");
    if (rl) {
      fUI.ruleSel = rl.dataset.fpRule;
      fUI.open = isPhone();
      const left = view.querySelector(".fp-left"), keep = left?.scrollTop;
      renderFactionsPage();
      if (left) view.querySelector(".fp-left").scrollTop = keep;
      view.querySelector(".fp-right").scrollTop = 0;
      return;
    }
    if (e.target.closest("[data-fp-back]")) { if (!isPhone() && unitMode()) fUI.sel = null; fUI.open = false; renderFactionsPage(); return; }
    if (e.target.closest("[data-fp-style]")) openStyleSheet(fUI.faction);
    const grp = e.target.closest("[data-fp-facgroup]");
    if (grp) { fUI.facGroup = grp.dataset.fpFacgroup; renderFactionsPage(); }
  });
  // Phones and tablets: swipe right on the datasheet to go back to the list.
  onSwipeRight(view, e => !!e.target.closest(".fp-shell.show-detail .fp-right"), () => { if (fUI.open) { fUI.open = false; renderFactionsPage(); } });
  onSwipeRight(view, e => isTouchLayout() && !fUI.home && !fUI.open && !!e.target.closest(".fp-left"), () => goHome());
  // Keyboard: Enter or Space on a faction's, mission pack's, Game Pack's or rules box in the library opens it.
  view.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches?.("[data-lib-open]")) { e.preventDefault(); openFactionFromLibrary(e.target.dataset.libOpen); }
    else if (e.target.matches?.("[data-mission-open]")) { e.preventDefault(); openMissionFromLibrary(e.target.dataset.missionOpen); }
    else if (e.target.matches?.("[data-bundle-open]")) { e.preventDefault(); openBundleFromLibrary(e.target.dataset.bundleOpen); }
    else if (e.target.matches?.("[data-rules-open]")) { e.preventDefault(); openRulesFromLibrary(e.target.dataset.rulesOpen); }
  });
  view.addEventListener("input", e => { if (e.target.id === "fpFilter") { fUI.filter = e.target.value; applyFilter(); } });
  view.addEventListener("toggle", e => {
    const g = e.target.dataset?.grp;
    if (g && !fUI.filter) e.target.open ? fUI.collapsed.delete(g) : fUI.collapsed.add(g);
  }, true);
}

export { applyAccent, factionStyle, goHome, onSwipeRight, openStyleSheet, renderFactionsPage, wireFactionsPage };
