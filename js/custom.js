/* RulesForge · custom.js
 * Applies what was built in App Builder (tools/app-builder), saved in custom/custom.json:
 *   css      look-and-feel and layout changes to the existing app
 *   labels   renamed text
 *   pages    extra screens, each with an optional menu button
 *   elements headings, text, buttons, images, dividers and boxes placed on a page or beside any existing block
 *   actions  where an existing button goes when pressed (instead of its normal job)
 * With the default empty file nothing changes. The last file is cached so a returning visitor sees it at first paint. */
const CACHE = "rf.customCache";
const ICONS = {
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const BASE_CSS = `.rf-subnav{margin:6px 18px 24px}.rf-subnav h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.65}.rf-subnav .list{display:flex;flex-wrap:wrap;gap:8px}.rf-crumbs{padding:6px 18px 0;font-size:13px;opacity:.9;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rf-crumbs button{background:none;border:0;color:var(--accent,#0a84ff);cursor:pointer;padding:0;font:inherit}
.rf-page-body{position:relative;flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.rf-el-row,.rf-el-col{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}.rf-el-col{flex-direction:column}
.rf-el-text,.rf-el-heading{margin:0}.rf-el-image{max-width:100%;height:auto;border-radius:8px}.rf-el-divider{width:100%;border:0;border-top:1px solid rgba(255,255,255,.15);margin:4px 0}.rf-el-space{height:24px;width:100%}
.rf-el-rect{width:140px;height:90px;background:#0a84ff;border-radius:10px}.rf-el-ellipse{width:110px;height:110px;background:#0a84ff;border-radius:50%}.rf-el-line{width:160px;height:3px;background:#0a84ff;border-radius:2px}
@keyframes rf-fade-in{from{opacity:0}to{opacity:1}}
@keyframes rf-slide-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes rf-slide-down{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}
@keyframes rf-slide-left{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:none}}
@keyframes rf-slide-right{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:none}}
@keyframes rf-zoom-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
@keyframes rf-pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes rf-flip-in{from{opacity:0;transform:perspective(600px) rotateX(-70deg)}to{opacity:1;transform:none}}
@keyframes rf-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes rf-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes rf-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}}
@keyframes rf-spin{to{transform:rotate(360deg)}}
@keyframes rf-glow{0%,100%{box-shadow:0 0 0 rgba(10,132,255,0)}50%{box-shadow:0 0 18px rgba(10,132,255,.9)}}
@keyframes rf-blink{50%{opacity:.25}}`;
let data = { css: "", labels: [], pages: [], elements: [], actions: [] };
const originals = new Map();   // text node → its text before a label changed it, so the editor can undo a rename live
let running = false;
let current = null;
let sig = "";   // what the pages and elements last looked like, so unchanged ones are left alone while editing   // the id of the custom page on screen, if any

const $q = s => { try { return document.querySelector(s); } catch { return null; } };
function setCSS(css) {
  let el = document.getElementById("rf-custom");
  if (!el) { el = document.createElement("style"); el.id = "rf-custom"; document.head.appendChild(el); }
  const full = BASE_CSS + "\n" + css;
  if (el.textContent !== full) el.textContent = full;
}

/* ---------- text changes ---------- */
function applyLabels() {
  for (const { sel, from, to } of data.labels) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const el of nodes) for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim() === from) {
        if (!originals.has(n)) originals.set(n, n.nodeValue);
        n.nodeValue = n.nodeValue.replace(from, to);
      }
    }
  }
}

/* ---------- pages ---------- */
const pageView = id => document.getElementById("view-rf-" + id);
function ensurePages() {
  const main = $q(".app > main") || $q("main");
  const nav = $q("aside nav"), settings = document.getElementById("settingsBtn");
  if (!main) return;
  for (const p of data.pages || []) {
    let v = pageView(p.id);
    if (!v) {
      v = document.createElement("section");
      v.className = "view hidden rf-page"; v.id = "view-rf-" + p.id;
      v.innerHTML = '<header class="toolbar"><h1></h1></header><div class="rf-page-body"></div>';
      main.appendChild(v);
    }
    const h1 = v.querySelector("h1"); if (h1.textContent !== p.title) h1.textContent = p.title;
    let b = nav && nav.querySelector(`[data-rf-page="${p.id}"]`);
    if (p.menu !== false && nav && !b) {
      b = document.createElement("button"); b.type = "button"; b.className = "nav-item rf-nav"; b.dataset.rfPage = p.id;
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[p.icon] || ICONS.doc}</svg><span></span>`;
      nav.insertBefore(b, settings && settings.parentNode === nav ? settings : null);
    }
    if (b) { const s = b.querySelector("span"); if (s.textContent !== p.title) s.textContent = p.title; if (p.menu === false) b.remove(); }
  }
  ensureLinks();
}
/* subpages: a page with children lists them at its foot; a child shows a trail back up */
const keyView = key => key.startsWith("view:") ? document.getElementById("view-" + key.slice(5)) : pageView(key);
const keyTitle = key => key.startsWith("view:")
  ? (document.querySelector(`.nav-item[data-view="${key.slice(5)}"]`)?.textContent || key.slice(5)).replace(/\s+/g, " ").trim()
  : ((data.pages || []).find(p => p.id === key)?.title || "");
function ensureLinks() {
  const pages = data.pages || [];
  const parents = new Set(pages.map(p => p.parent).filter(Boolean));
  document.querySelectorAll(".rf-subnav,.rf-crumbs").forEach(n => { const v = n.parentElement; const k = v && (v.id.startsWith("view-rf-") ? v.id.slice(8) : "view:" + v.id.slice(5)); if (!(n.classList.contains("rf-subnav") ? parents.has(k) : pages.find(p => p.id === k && p.parent))) n.remove(); });
  for (const key of parents) {
    const v = keyView(key); if (!v) continue;
    const kids = pages.filter(p => p.parent === key), page = pages.find(p => p.id === key);
    if (page && page.links === false) { v.querySelector(":scope > .rf-subnav")?.remove(); continue; }
    const sig = JSON.stringify(kids.map(k => [k.id, k.title]));
    let n = v.querySelector(":scope > .rf-subnav");
    if (!n) { n = document.createElement("nav"); n.className = "rf-subnav"; v.appendChild(n); }
    if (n.dataset.sig !== sig) {
      n.dataset.sig = sig; n.innerHTML = '<h3>In this section</h3><div class="list"></div>';
      const l = n.querySelector(".list");
      for (const k of kids) { const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.dataset.rfGo = k.id; b.textContent = k.title; l.appendChild(b); }
    }
  }
  for (const p of pages) {
    if (!p.parent) continue;
    const v = pageView(p.id); if (!v) continue;
    const trail = []; let k = p.parent, guard = 0;
    while (k && guard++ < 20) { trail.unshift(k); k = (pages.find(x => x.id === k) || {}).parent; }
    const sig = JSON.stringify([trail.map(keyTitle), p.title]);
    let c = v.querySelector(":scope > .rf-crumbs");
    if (!c) { c = document.createElement("div"); c.className = "rf-crumbs"; const h = v.querySelector(":scope > header"); h ? h.after(c) : v.prepend(c); }
    if (c.dataset.sig !== sig) {
      c.dataset.sig = sig; c.innerHTML = "";
      trail.forEach(t => { const b = document.createElement("button"); b.type = "button"; b.dataset.rfGo = t; b.textContent = keyTitle(t); c.append(b, " › "); });
      const e = document.createElement("b"); e.textContent = p.title; c.append(e);
    }
  }
}
function goKey(key) {
  if (key.startsWith("view:")) { hidePages(); document.querySelector(`.nav-item[data-view="${key.slice(5)}"]`)?.click(); }
  else openPage(key);
}
function hidePages() {
  current = null;
  document.querySelectorAll(".rf-page").forEach(v => v.classList.add("hidden"));
  document.querySelectorAll(".rf-nav").forEach(b => b.removeAttribute("aria-current"));
}
function openPage(id) {
  ensurePages(); ensureElements();
  const v = pageView(id); if (!v) return;
  document.querySelectorAll(".app > main > .view, main > .view").forEach(x => x.classList.add("hidden"));
  hidePages(); current = id; v.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b => b.removeAttribute("aria-current"));
  document.querySelector(`[data-rf-page="${id}"]`)?.setAttribute("aria-current", "page");
}

/* ---------- placed elements ---------- */
function build(d) {
  let el;
  switch (d.type) {
    case "heading": el = document.createElement("h2"); el.className = "rf-el-heading"; el.textContent = d.text || ""; break;
    case "text": el = document.createElement("p"); el.className = "rf-el-text"; el.textContent = d.text || ""; break;
    case "button": el = document.createElement("button"); el.type = "button"; el.className = "btn rf-el-button" + (d.style === "primary" ? " primary" : ""); el.textContent = d.text || "Button"; break;
    case "image": el = document.createElement("img"); el.className = "rf-el-image"; el.src = d.src || ""; el.alt = d.alt || ""; break;
    case "divider": el = document.createElement("hr"); el.className = "rf-el-divider"; break;
    case "space": el = document.createElement("div"); el.className = "rf-el-space"; break;
    case "row": el = document.createElement("div"); el.className = "rf-el-row"; break;
    case "column": el = document.createElement("div"); el.className = "rf-el-col"; break;
    case "rect": el = document.createElement("div"); el.className = "rf-el-rect"; break;
    case "ellipse": el = document.createElement("div"); el.className = "rf-el-ellipse"; break;
    case "line": el = document.createElement("div"); el.className = "rf-el-line"; break;
    default: return null;
  }
  el.dataset.rfEl = d.id;
  return el;
}
function ensureElements() {
  for (const d of data.elements || []) {
    const anchor = $q(d.anchor);
    if (!anchor) continue;
    const where = d.where || "end", inside = where === "start" || where === "end";
    const parent = inside ? anchor : anchor.parentNode;
    let el = document.querySelector(`[data-rf-el="${d.id}"]`);
    if (el && el.parentNode === parent) continue;
    if (!el) el = build(d);
    if (!el) continue;
    el.dataset.rfAt = d.anchor + "|" + where;
    if (where === "before") parent.insertBefore(el, anchor);
    else if (where === "start") { let ref = anchor.firstChild; while (ref && ref.dataset && ref.dataset.rfAt === el.dataset.rfAt) ref = ref.nextSibling; anchor.insertBefore(el, ref); }
    else if (where === "after") { let ref = anchor; while (ref.nextSibling && ref.nextSibling.dataset && ref.nextSibling.dataset.rfAt === el.dataset.rfAt) ref = ref.nextSibling; parent.insertBefore(el, ref.nextSibling); }
    else anchor.appendChild(el);
  }
}

/* ---------- what buttons do ---------- */
function run(a) {
  if (a.type === "view") document.querySelector(`.nav-item[data-view="${a.target}"]`)?.click();
  else if (a.type === "page") openPage(a.target);
  else if (a.type === "url" && /^(https?:|mailto:|tel:)/i.test(a.target || "")) window.open(a.target, "_blank", "noopener");
  else if (a.type === "top") document.querySelector(".view:not(.hidden)")?.scrollTo?.({ top: 0 });
}
document.addEventListener("click", e => {
  if (e.target.closest?.(".nav-item[data-view], [data-go]")) hidePages();
  if (running) return;
  const nb = e.target.closest?.("[data-rf-page]");
  if (nb && nb.classList.contains("rf-nav") && !window.__rfNoActions) { e.preventDefault(); e.stopImmediatePropagation(); openPage(nb.dataset.rfPage); return; }
  const go = e.target.closest?.("[data-rf-go]");
  if (go && !window.__rfNoActions) { e.preventDefault(); e.stopImmediatePropagation(); goKey(go.dataset.rfGo); return; }
  if (window.__rfNoActions) return;
  let act = null;
  const ce = e.target.closest?.("[data-rf-el]");
  if (ce) act = (data.elements || []).find(d => d.id === ce.dataset.rfEl)?.action;
  if (!act) for (const a of data.actions || []) { let m = null; try { m = e.target.closest(a.sel); } catch { /* bad selector */ } if (m) { act = a; break; } }
  if (!act || !act.type || act.type === "default") return;
  e.preventDefault(); e.stopImmediatePropagation();
  running = true; try { run(act); } finally { running = false; }
}, true);

/* ---------- apply ---------- */
function apply(next) {
  const keep = current;
  for (const [n, text] of originals) if (n.isConnected) n.nodeValue = text;
  originals.clear();
  const nextSig = JSON.stringify([next.pages, next.elements]);
  if (nextSig !== sig) {
    sig = nextSig;
    document.querySelectorAll("[data-rf-el]").forEach(x => x.remove());
    document.querySelectorAll(".rf-page,.rf-nav").forEach(x => x.remove());
  }
  data = { css: next.css || "", labels: (next.labels || []).filter(l => l && l.sel && l.from && typeof l.to === "string"),
    pages: next.pages || [], elements: next.elements || [], actions: next.actions || [] };
  setCSS(data.css); ensurePages(); ensureElements(); applyLabels();
  if (keep && pageView(keep)) openPage(keep);
}

let queued = false;
new MutationObserver(() => {
  if (queued || !(data.labels.length || data.pages.length || data.elements.length)) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; ensurePages(); ensureElements(); applyLabels(); });
}).observe(document.documentElement, { childList: true, subtree: true });
window.__rfCustomApply = apply;
window.__rfCustomOpenPage = openPage;
window.__rfCustomGo = goKey;
window.__rfCustomHidePages = hidePages;

const studio = /[?&]studio=1/.test(location.search);   // inside App Builder the editor is in charge
try { const cached = JSON.parse(localStorage.getItem(CACHE) || "null"); if (cached && !studio) apply(cached); } catch { /* ignore */ }
fetch(new URL("custom/custom.json", document.baseURI), { cache: "no-cache" })
  .then(r => (r.ok ? r.json() : null))
  .then(d => {
    if (!d || studio) return;
    try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch { /* storage full or blocked */ }
    apply(d);
  })
  .catch(() => {});
export {};
