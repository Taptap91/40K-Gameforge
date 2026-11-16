/* RulesForge · custom.js
 * Applies the look-and-feel and label changes saved by Layout Studio (tools/layout-studio) in custom/custom.json:
 * the CSS goes into one <style>, and renamed text is swapped in wherever the app draws it. With the default empty
 * file nothing changes. The last file is cached so a returning visitor sees the changes from the first paint. */
const CACHE = "rf.customCache";
let labels = [];
const originals = new Map();   // text node → its text before a label changed it, so the editor can undo a rename live

function setCSS(css) {
  let el = document.getElementById("rf-custom");
  if (!el) { el = document.createElement("style"); el.id = "rf-custom"; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

function applyLabels() {
  for (const { sel, from, to } of labels) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch { continue; }
    for (const el of nodes) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.nodeValue.trim() === from) {
          if (!originals.has(n)) originals.set(n, n.nodeValue);
          n.nodeValue = n.nodeValue.replace(from, to);
        }
      }
    }
  }
}

/** Used by Layout Studio to preview changes live: undoes earlier renames, then applies the new set. */
function apply(data) {
  for (const [n, text] of originals) if (n.isConnected) n.nodeValue = text;
  originals.clear();
  labels = (data.labels || []).filter(l => l && l.sel && l.from && typeof l.to === "string");
  setCSS(data.css || "");
  applyLabels();
}

let queued = false;
new MutationObserver(() => {
  if (!labels.length || queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; applyLabels(); });
}).observe(document.documentElement, { childList: true, subtree: true });
window.__rfCustomApply = apply;

const studio = /[?&]studio=1/.test(location.search);   // inside Layout Studio the editor is in charge
try { const cached = JSON.parse(localStorage.getItem(CACHE) || "null"); if (cached && !studio) apply(cached); } catch { /* ignore */ }
fetch(new URL("custom/custom.json", document.baseURI), { cache: "no-cache" })
  .then(r => (r.ok ? r.json() : null))
  .then(data => {
    if (!data || studio) return;
    try { localStorage.setItem(CACHE, JSON.stringify({ css: data.css, labels: data.labels })); } catch { /* storage full or blocked */ }
    apply(data);
  })
  .catch(() => {});
export {};
