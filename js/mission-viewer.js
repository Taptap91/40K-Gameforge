/* RulesForge · mission-viewer.js
 * Shows what was read from a mission pack: the battle sequence, Force Disposition pairings, every Primary and
 * Secondary Mission card, the Deployment maps, the Twists and the FAQ.
 */
import { esc, openSheet, state } from "./core.js?v=8.22";

const TABS = [["battle", "Battle"], ["dispositions", "Force Dispositions"], ["primaries", "Primary"], ["secondaries", "Secondary"], ["deployments", "Deployment"], ["twists", "Twists"], ["faq", "FAQ"]];
const vpHTML = v => {
  if (!v) return "";
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `<span class="mc-vp"><b>${esc(x)}</b><small>${esc(k)}</small></span>`).join("");
  return `<span class="mc-vp"><b>${esc(v)}</b></span>`;
};
/* Keywords in capitals (AIRCRAFT, CHARACTER, BATTLELINE) are shown in small caps like the datasheets. */
const rich = t => esc(t || "").replace(/\b([A-Z]{4,}(?: [A-Z]{4,})*)\b/g, '<span class="mc-kw">$1</span>');

function missionCard(m, type) {
  const rules = m.rules.map(r => `<p>${r.label ? `<b>${esc(r.label)}:</b> ` : ""}${rich(r.text)}</p>`).join("");
  const actions = m.actions.map(a => `<div class="mc-action"><div class="mc-action-h">${esc(a.type)}${a.name && a.name.toLowerCase() !== m.name.toLowerCase() ? ` · ${esc(a.name)}` : ""}</div>
      ${[["Starts", a.starts], ["Units", a.units], ["Use limit", a.useLimit], ["Completes", a.completes], ["Effect", a.effect], ["Restrictions", a.restrictions]].filter(([, v]) => v).map(([k, v]) => `<p><b>${k}:</b> ${rich(v)}</p>`).join("")}</div>`).join("");
  const scoring = m.scoring.map(b => `<div class="mc-block">
      <div class="mc-round">${esc(b.round)}${b.cap ? `<span class="mc-cap">${esc(b.cap)}</span>` : ""}${b.cumulative ? `<span class="mc-cap">Cumulative</span>` : ""}</div>
      ${b.when ? `<div class="mc-when"><b>When:</b> ${esc(b.when)}</div>` : ""}
      ${b.rows.map(r => `${r.alt ? `<div class="mc-or">or</div>` : ""}<div class="mc-row${r.plus ? " plus" : ""}"><span>${r.plus ? "+ " : ""}${rich(r.text)}</span><span class="mc-vps">${vpHTML(r.vp)}</span></div>`).join("")}
    </div>`).join("");
  return `<article class="mc mc-${type}">
    <header><h3>${esc(m.name)}</h3><span>${type === "primary" ? "Primary Mission" : "Secondary Mission"}${m.fixed ? " · Fixed or Tactical" : ""}</span></header>
    ${m.flavour ? `<p class="mc-flavour">${esc(m.flavour)}</p>` : ""}
    ${m.whenDrawn ? `<p class="mc-drawn"><b>When drawn:</b> ${rich(m.whenDrawn)}</p>` : ""}
    ${rules}${actions}${scoring}
    ${m.note ? `<p class="mc-note"><b>Designer’s note:</b> ${esc(m.note)}</p>` : ""}
  </article>`;
}

function tabHTML(pack, tab) {
  if (tab === "battle") return `${pack.intro ? `<p class="mc-intro">${esc(pack.intro)}</p>` : ""}
    <ol class="mc-steps">${pack.sequence.map(s => `<li><div class="mc-step-h"><span>${s.n}</span>${esc(s.title)}</div>${s.text.split("\n").map(p => `<p>${rich(p)}</p>`).join("")}</li>`).join("")}</ol>
    ${pack.limits?.length ? `<div class="mc-block"><div class="mc-round">Maximum VP</div>${pack.limits.map(l => `<div class="mc-row"><span>${esc(l.source)}${l.perRound ? ` <small class="lb-subtle">(up to ${esc(l.perRound)} per battle round)</small>` : ""}</span><span class="mc-vps">${vpHTML(l.max)}</span></div>`).join("")}</div>` : ""}`;
  if (tab === "dispositions") {
    const order = pack.dispositions[0]?.missions.map(m => m.vs) || [];
    return `<p class="lb-subtle">Your Force Disposition (left) against your opponent's (top) gives your Primary Mission.</p>
      <div class="mc-tablewrap"><table class="mc-table"><thead><tr><th>You \\ Opponent</th>${order.map(o => `<th>${esc(o)}</th>`).join("")}</tr></thead>
      <tbody>${pack.dispositions.map(d => `<tr><th>${esc(d.name)}</th>${order.map(o => `<td>${esc(d.missions.find(m => m.vs === o)?.mission || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${pack.dispositions.map(d => `<article class="mc"><header><h3>${esc(d.name)}</h3><span>Force Disposition</span></header><p class="mc-flavour">${esc(d.flavour)}</p></article>`).join("")}`;
  }
  if (tab === "primaries") return pack.primaries.map(m => missionCard(m, "primary")).join("");
  if (tab === "secondaries") return pack.secondaries.map(m => missionCard(m, "secondary")).join("");
  if (tab === "deployments") return `<div class="mc-maps">${pack.deployments.map(d => `<figure class="mc-map"><figcaption>${esc(d.name)}</figcaption>${d.image ? `<img src="${d.image}" alt="${esc(d.name)} deployment map">` : `<p class="lb-subtle">No map picture was read.</p>`}</figure>`).join("")}</div>`;
  if (tab === "twists") return pack.twists.map(t => `<article class="mc mc-twist"><header><h3>${esc(t.name)}</h3><span>Twist</span></header>${t.flavour ? `<p class="mc-flavour">${esc(t.flavour)}</p>` : ""}${t.text.split("\n").map(p => `<p>${rich(p)}</p>`).join("")}${t.note ? `<p class="mc-note"><b>Designer’s note:</b> ${esc(t.note)}</p>` : ""}</article>`).join("");
  if (tab === "faq") return pack.faq.map(f => `<div class="mc-faq"><p><b>Q:</b> ${esc(f.q)}</p><p><b>A:</b> ${esc(f.a)}</p></div>`).join("") || `<p class="lb-subtle">No FAQ was found.</p>`;
  return "";
}

function openMissionViewer(docId, tab = "battle") {
  const doc = state.docs.find(d => d.id === docId), pack = doc?.structured?.missionPack;
  if (!pack) return;
  const count = k => k === "battle" ? pack.sequence.length : (pack[k] || []).length;
  const d = openSheet(`<div class="sheet-head"><h2>${esc(pack.name)}</h2><p>What RulesForge read from this mission pack. The Mission Generator and Player's Hand pages are left out.</p></div>
    <div class="mc-tabs" role="tablist">${TABS.filter(([k]) => count(k)).map(([k, l]) => `<button type="button" role="tab" class="mc-tab${k === tab ? " on" : ""}" aria-selected="${k === tab}" data-mc-tab="${k}">${l}<span>${count(k)}</span></button>`).join("")}</div>
    <div class="sheet-body mc-body">${tabHTML(pack, tab)}</div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Close</button></div>`, true);
  d.querySelector(".mc-tabs").onclick = e => {
    const b = e.target.closest("[data-mc-tab]");
    if (!b) return;
    d.querySelectorAll(".mc-tab").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); });
    const body = d.querySelector(".mc-body"); body.innerHTML = tabHTML(pack, b.dataset.mcTab); body.scrollTop = 0;
  };
}

export { missionCard, openMissionViewer };
