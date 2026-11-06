/* RulesForge · list-editor.js
 * Army Lists pages: the lists home, the generate form and the three-column list editor.
 */
import { armyData, attachedGroup, canAttach, canTakeEnhancement, charSlot, detachmentsBudgetOK, enhLimit, evaluateList, generateList, listToText, pointSizes, saveList, sizeRules, unitMax } from "./army.js?v=8.2";
import { $, $$, askText, closePopMenu, confirmSheet, DB, esc, icon, openPopMenu, openSheet, state, store, toast, uid } from "./core.js?v=8.2";
import { DATASHEET_GROUPS, datasheetDetailsHTML, factionArmyRules, panelHTML, statsHTML, wargearOptionsHTML, weaponGridHTML } from "./datasheets.js?v=8.2";
import { buffsFor, setWeapon, weaponBase, weaponLimits } from "./loadout.js?v=8.2";
import { applyAccent, factionStyle, onSwipeRight } from "./factions.js?v=8.2";
import { capWords, keywordList, normName, richHTML } from "./text.js?v=8.2";

function renderSaved() { renderListsPage(); }const listUI = { mode: "home", id: null, gen: null, sel: null, pane: "unit", filter: "", openWeapons: new Set(), collapsed: new Set() };
const isPhone = () => matchMedia("(max-width: 760px)").matches;
const structuredFactions = () => [...new Set(state.docs.filter(d => d.structured?.datasheets && d.faction).map(d => d.faction))].sort();

function renderListsPage() {
  const host = $("#listsHost"), tools = $("#listsToolbar"), title = $("#listsTitle");
  if (!host) return;
  $("#view-lists").classList.remove("lb-editing");
  applyAccent($("#view-lists"), null);
  if (listUI.mode === "edit") {
    const list = state.lists.find(l => l.id === listUI.id);
    if (list?.version === 2) return renderListEditor(list);
    listUI.mode = "home";
  }
  if (listUI.mode === "generate") return renderGenerateForm();
  title.textContent = "Army Lists";
  const factions = structuredFactions();
  tools.innerHTML = `<button class="btn" type="button" data-lb="create" ${factions.length ? "" : "disabled"}>Create list</button>
    <button class="btn primary" type="button" data-lb="generate" ${factions.length ? "" : "disabled"}>Generate list</button>`;
  const lists = [...state.lists].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  host.innerHTML = `
    ${factions.length ? "" : `<div class="card"><h2>Add your faction first</h2><p>Lists are built from a converted faction PDF. Add one in Library, then come back here.</p><button class="btn primary" type="button" data-go="library">Open Library</button></div>`}
    ${lists.length ? `<div class="list">${lists.map(l => {
      if (l.version !== 2) return `<div class="list-row"><div class="main"><div class="title">${esc(l.title || "Saved list")}</div><div class="meta">Older list · ${l.points || ""} pts</div></div>
        <button class="btn plain" type="button" data-lb-copy-old="${esc(l.id)}">Copy</button><button class="btn plain danger" type="button" data-lb-delete="${esc(l.id)}">Delete</button></div>`;
      const r = evaluateList(l), st = factionStyle(l.faction);
      // A box per list in its faction's colours and symbol; swipe left (touch) or the trash (desktop) to delete.
      return `<div class="lb-listswipe">
        <div role="button" tabindex="0" class="lb-listcard${st.img ? " has-mark" : ""}" data-lb-open="${esc(l.id)}" style="--c1:${st.c1};--c2:${st.c2}">
          <div class="lb-lc-text">
            <div class="lb-lc-name">${esc(l.name)}</div>
            <div class="lb-lc-fac">${esc(l.faction)}</div>
            ${l.detachments.length ? `<div class="lb-lc-dets">${l.detachments.map(d => `<div>${esc(d)}</div>`).join("")}</div>` : ""}
            <div class="lb-lc-pts"><b>${r.total.toLocaleString()}</b> / ${l.points.toLocaleString()} pts${r.issues.length ? ` <span class="lb-warn lb-hazard" title="${r.issues.length} to fix" aria-label="${r.issues.length} to fix"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3 2 20.5h20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.2" fill="currentColor"/></svg>${r.issues.length}</span>` : ""}</div>
          </div>
          ${st.img ? `<img class="lb-lc-mark" src="${esc(st.img)}" alt="">` : ""}
          <button type="button" class="lb-lc-kebab" data-lb-listmenu="${esc(l.id)}" data-menu-key="l:${esc(l.id)}" title="More" aria-label="More options for ${esc(l.name)}" aria-haspopup="menu"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg></button>
        </div></div>`;
    }).join("")}</div>` : factions.length ? `<div class="empty">No lists yet. Create one yourself, or let the app generate one from a description.</div>` : ""}`;
}

function renderGenerateForm() {
  const g = listUI.gen ||= { faction: structuredFactions()[0] || "", points: (p => pointSizes().includes(p) ? p : pointSizes().at(-1))(store.get("rf.points", 2000)), vibe: "", pick: true, chosen: [] };
  $("#listsTitle").textContent = "Generate List";
  $("#listsToolbar").innerHTML = `<button class="btn" type="button" data-lb="home">Cancel</button>`;
  const data = armyData(g.faction);
  const rules = sizeRules(g.points);
  const chosen = data.detachments.filter(d => g.chosen.includes(d.name));
  const dpUsed = chosen.reduce((s, d) => s + d.dp, 0);
  const takenTags = new Set(chosen.map(d => d.unique).filter(Boolean));
  $("#listsHost").innerHTML = `
    <div class="card stack">
      <div class="row">
        <div class="field"><label for="genFaction">Faction</label>
          <select class="select" id="genFaction" style="width:100%">${structuredFactions().map(f => `<option ${f === g.faction ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div>
        <div class="field"><label>Points</label>
          <div class="segmented" id="genPoints">${pointSizes().map(p => `<button type="button" data-v="${p}" aria-pressed="${p === g.points}">${p}</button>`).join("")}</div>
          <span class="hint">${rules.name}: ${rules.dp} detachment points, up to ${rules.enh} enhancements, ${rules.dup} copies of a unit (Battleline ${rules.dup * 2}).</span></div>
      </div>
      <div class="field"><label for="genVibe">What should the army feel like?</label>
        <textarea class="input" id="genVibe" placeholder="e.g. Deathwing Terminators teleporting onto objectives, a few Ravenwing bikes for speed, no tanks">${esc(g.vibe)}</textarea>
        <span class="hint">Mention playstyle, units you want, models you own, or things to avoid.</span></div>
      <div class="field"><label>Detachments</label>
        <div class="segmented" id="genPick"><button type="button" data-v="pick" aria-pressed="${g.pick}">Pick for me</button><button type="button" data-v="choose" aria-pressed="${!g.pick}">Let me choose</button></div>
        ${g.pick ? "" : `<div class="hint">${dpUsed} of ${rules.dp} DP used${rules.name === "Incursion" ? " (a single 3 DP detachment is also allowed)" : ""}</div>
          <div class="list lb-detpick">${data.detachments.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => {
            const on = g.chosen.includes(d.name);
            const blocked = !on && ((d.unique && takenTags.has(d.unique)) || !detachmentsBudgetOK([...chosen, d], rules));
            return `<label class="list-row ${blocked ? "lb-blocked" : ""}"><input type="checkbox" data-gen-det="${esc(d.name)}" ${on ? "checked" : ""} ${blocked ? "disabled" : ""}>
              <span class="main"><span class="title">${esc(d.name)}</span><span class="meta" style="display:block">${d.dp} DP${d.unique ? ` · Unique: ${esc(d.unique)}` : ""}</span></span></label>`;
          }).join("")}</div>`}
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn primary large" type="button" id="genGo">Generate list</button>
        <span class="check problem hidden" id="genError"></span>
      </div>
    </div>`;
}

/** One weapon area per model type: tick what they carry, with how many of them carry it. */
function lbLoadout(x, buffs) {
  const ws = x.unit.ds.weapons || [];
  if (!ws.length) return "";
  const profiles = base => ws.filter(w => weaponBase(w.name) === base);
  const open = listUI.openWeapons;
  return (x.loadout || []).map(gr => {
    const problems = (x.loadoutProblems || {})[gr.name] || [];
    const problem = problems.length > 0;
    const limits = weaponLimits(gr, x.models);
    const icon = msgs => msgs.length ? `<span class="lb-warnicon" role="img" tabindex="0" title="${esc(msgs.join(" "))}" aria-label="${esc(msgs.join(" "))}" data-lb-warn="${esc(msgs.join(" "))}">⚠︎</span>` : "";
    const weaponWarn = w => icon(problems.filter(p => (p.ws || []).includes(w)).map(p => p.msg));
    const groupWarn = icon(problems.filter(p => !(p.ws || []).length).map(p => p.msg));
    // A model type with nothing to swap (every weapon is its standard wargear) shows its counts without − / +.
    const fixed = [...gr.reach.keys()].every(w => gr.defaults.includes(w));
    const row = w => {
      const ps = profiles(w);
      if (!ps.length) return "";
      // Swap-in weapons show the most this squad size allows; default weapons show what's left after swaps.
      const type = ps[0].type, n = gr.counts[w] ?? 0, isDefault = gr.defaults.includes(w);
      // X/Y: Y is the most models the datasheet lets carry this weapon (every model for default wargear).
      const room = isDefault ? gr.N : Math.max(1, gr.reach.get(w) ?? 0);
      const canAdd = n < room;   // greyed out at the most the datasheet allows
      const key = `${x.id}|${gr.name}|${w}`;
      const mine = buffs.filter(b => !b.type || b.type === type);
      const own = [...new Set(ps.flatMap(p => keywordList(p.tags)))];
      const extra = [...mine.filter(b => b.keyword && !own.some(k => normName(k).startsWith(normName(b.keyword.split(" (")[0])))).map(b => `${b.keyword} – ${b.source}`),
        ...mine.filter(b => b.stat).map(b => `${b.delta > 0 ? "+" : ""}${b.delta} ${b.stat} – ${b.source}`)];
      // Keywords as outlined tags under the name (bonuses from attached characters in their own colour).
      const kw = [...own.map(k => `<button type="button" class="fv-kw fv-kw-btn" data-core="${esc(k)}" aria-haspopup="dialog">${esc(k)}</button>`), ...extra.map(e => `<span class="fv-kw lb-buffkw">${esc(e)}</span>`)].join("");
      const data = `data-entry="${x.id}" data-group="${esc(gr.name)}" data-w="${esc(w)}"`;
      return `<div class="lb-wopt lb-split lb-nocheck${n > 0 ? " on" : ""}${fixed ? " fixed" : " stepper"}" data-split title="Left half: show or hide details · Right half: equip or unequip">
        <details data-wkey="${esc(key)}" ${open.has(key) ? "open" : ""}><summary><span class="lb-arrow" aria-hidden="true"></span><span class="lb-whead"><span class="lb-wtitle">${esc(capWords(w))}${ps.length > 1 ? `<span class="lb-subtle lb-pcount">${ps.length} profiles</span>` : ""}${weaponWarn(w)}</span>
          ${kw ? `<span class="lb-wkws fv-kws">${kw}</span>` : ""}</span></summary>
          ${weaponGridHTML(ps, type, buffs, "profile", w)}</details>
        <div class="lb-count">${fixed ? `<span>${n}/${room}</span>` : `<button type="button" class="lb-step" data-lb-step="-1" ${data} ${n <= 0 ? "disabled" : ""} aria-label="One fewer">−</button><span>${n}/${room}</span><button type="button" class="lb-step" data-lb-step="1" ${data} ${canAdd ? "" : "disabled"} aria-label="One more">+</button>`}</div>
      </div>`;
    };
    const all = [...gr.reach.keys()];
    const byType = t => all.filter(w => profiles(w)[0]?.type === t);
    const part = (t, label) => byType(t).length ? `<div class="lb-wtype">${label}</div><div class="lb-wopts">${byType(t).map(row).join("")}</div>` : "";
    // A weapon with a ranged and a melee profile under the same name: one "Weapons" list instead of two.
    const shared = all.some(w => new Set(profiles(w).map(p => p.type)).size > 1);
    const body = shared ? `<div class="lb-wtype">Weapons</div><div class="lb-wopts">${[...byType("Ranged"), ...byType("Melee")].map(row).join("")}</div>`
      : part("Ranged", "Ranged weapons") + part("Melee", "Melee weapons");
    return panelHTML(`${esc(gr.name)} <span class="lb-subtle">· ${gr.N} model${gr.N === 1 ? "" : "s"}</span>${groupWarn}`, body, problem ? "lb-bad" : "");
  }).join("");
}

/** "Plague Marines #2 (led by Lord of Contagion)": a list entry named so it can be told apart from its copies. */
function lbEntryLabel(o, r) {
  const same = r.entries.filter(e => e.key === o.key);
  const name = `${o.unit?.name || o.key}${same.length > 1 ? ` #${same.indexOf(o) + 1}` : ""}`;
  const host = o.attachTo && r.entries.find(e => e.id === o.attachTo);
  const riders = r.entries.filter(e => e.attachTo === o.id && e.unit);
  if (host?.unit) return `${name} (attached to ${host.unit.name})`;
  if (riders.length) return `${name} (with ${riders.map(e => e.unit.name).join(", ")})`;
  return name;
}

/** Enhancements or upgrades this unit can take, as a checklist with each one's rules under its name.
 *  Kept legal (Core Rules 25.04): one enhancement per unit (attached units count as one), the battle size's
 *  enhancement limit (extra copies of an Upgrade don't count), one of each enhancement and up to three of each Upgrade.
 *  Anything blocked is greyed out and says why; where it can be moved here, a button does that. */
function lbEnhChecklist(x, r, upgrade) {
  const current = x.enh || x.upg;
  const options = r.enhPool.filter(en => !!en.upgrade === upgrade && (canTakeEnhancement(x.unit, en) || en.name === current));
  if (!options.length) return "";
  const group = attachedGroup(r.entries, x);
  const partnerPick = group.filter(o => o.id !== x.id).find(o => o.enh || o.upg);
  const ownPick = (x.picks || [])[0];
  const rows = options.map(en => {
    const on = en.name === x.enh || en.name === x.upg;
    const holders = r.entries.filter(o => o.id !== x.id && (o.enh === en.name || o.upg === en.name));
    const max = enhLimit(en);
    let block = null;   // { msg, move: true when the button can fix it }
    if (!on) {
      // Would this add to the enhancement count? (Swapping this unit's own counted pick doesn't.)
      const adds = !(en.upgrade && holders.length) && !(ownPick && !(ownPick.upgrade && r.entries.some(o => o.id !== x.id && (o.enh === ownPick.name || o.upg === ownPick.name))));
      if (holders.length >= max) block = { msg: `Equipped to ${holders.map(o => lbEntryLabel(o, r)).join(", ")}${max > 1 ? ` (all ${max} copies)` : ""}`, move: true };
      else if (partnerPick) block = { msg: `${lbEntryLabel(partnerPick, r)} already has ${partnerPick.enh || partnerPick.upg}. An attached unit can only have one enhancement.`, move: true, from: partnerPick.id };
      else if (adds && r.enhCount >= r.rules.enh) block = { msg: `Enhancement limit reached (${r.enhCount} of ${r.rules.enh} for ${r.rules.name}). Remove one from another unit first.` };
    }
    const btn = block?.move ? `<button type="button" class="btn lb-enhmove" data-lb-enhmove="${x.id}" data-slot="${upgrade ? "upg" : "enh"}" data-name="${esc(en.name)}"${block.from ? ` data-from="${block.from}"` : ""}>Equip to this unit?</button>` : "";
    const count = en.upgrade ? ` <span class="lb-subtle">${holders.length + (on ? 1 : 0)}/${max} in army</span>` : max > 1 ? ` <span class="lb-subtle">${holders.length + (on ? 1 : 0)}/${max} in army</span>` : "";
    const key = `e|${x.id}|${en.name}`;
    return `<div class="lb-wopt lb-enhopt lb-split${on ? " on" : ""}${block ? " taken" : ""}" data-split title="Left half: show or hide details · Right half: equip or unequip">
      <input type="checkbox" class="lb-check" data-lb-enhcheck="${x.id}" data-slot="${upgrade ? "upg" : "enh"}" data-name="${esc(en.name)}" ${on ? "checked" : ""} ${block ? "disabled" : ""} aria-label="Equip ${esc(en.name)}">
      <div class="lb-enhbody">
        <details data-wkey="${esc(key)}" ${listUI.openWeapons.has(key) ? "open" : ""}><summary><span class="lb-arrow" aria-hidden="true"></span><span class="lb-whead">
          <span class="lb-enhhead"><span class="lb-wtitle">${esc(en.name)}</span><span class="lb-enhpts">+${en.points} pts</span>${count}</span></span></summary>
          <div class="lb-enhmore"><span class="lb-enhdet">${esc(en.detachment)}${en.upgrade ? " · Upgrade" : ""}</span>
          ${en.flavour ? `<span class="fv-flavour lb-enhflav">${esc(en.flavour)}</span>` : ""}<span class="fv-rich lb-enhtext">${richHTML(en.text)}</span></div></details>
        ${block ? `<div class="lb-enhtaken" data-block="${esc(block.msg)}"><span>${esc(block.msg)}</span>${btn}</div>` : ""}
      </div>
    </div>`;
  }).join("");
  const note = upgrade ? "Up to three of each Upgrade; only the first counts towards the enhancement limit." : "";
  return panelHTML(upgrade ? "Upgrades" : "Enhancements", `${note ? `<div class="lb-enhnote">${note}</div>` : ""}<div class="lb-wopts">${rows}</div>`);
}

/** Puts an enhancement or upgrade on a unit. It replaces anything else in that unit's attached group (one per unit),
 *  and comes off `from` when every copy was in use. */
function lbEquipEnh(list, id, slot, name, from) {
  const e = list.units.find(u => u.id === id);
  if (!e) return;
  const r = evaluateList(list);
  const x = r.entries.find(o => o.id === id);
  const removed = [];
  if (from) { const o = list.units.find(u => u.id === from); if (o) { if (o.enh === name) o.enh = null; if (o.upg === name) o.upg = null; } }
  for (const g of attachedGroup(r.entries, x)) {
    const u = list.units.find(o => o.id === g.id);
    for (const k of ["enh", "upg"]) if (u[k] && !(u.id === id && u[k] === name)) { if (u.id !== id || u[k] !== name) removed.push(`${u[k]} from ${lbEntryLabel(g, r)}`); u[k] = null; }
  }
  e[slot] = name;
  saveList(list);
  renderListEditor(list);
  const others = removed.filter(t => !t.endsWith(`from ${lbEntryLabel(x, r)}`));
  if (others.length) toast(`Removed ${others.join(", ")} (one enhancement per unit)`);
}

/** "Equip to this unit?" — moves it straight over, or asks which unit gives it up when several have it. */
function lbMoveEnh(list, d) {
  const data = armyData(list.faction), r = evaluateList(list, data);
  if (d.from) return lbEquipEnh(list, d.lbEnhmove, d.slot, d.name);   // a partner in the same attached unit gives up theirs
  const holders = r.entries.filter(o => o.id !== d.lbEnhmove && (o.enh === d.name || o.upg === d.name));
  if (holders.length <= 1) return lbEquipEnh(list, d.lbEnhmove, d.slot, d.name, holders[0]?.id);
  const target = r.entries.find(o => o.id === d.lbEnhmove);
  const dlg = openSheet(`
    <div class="sheet-head"><h2>${esc(d.name)}</h2><p>Every copy is in use. Choose the unit that gives it up so ${esc(target ? lbEntryLabel(target, r) : "this unit")} can take it.</p></div>
    <div class="sheet-body"><div class="lb-hosts">${holders.map(o => `<button type="button" class="lb-host" data-enhfrom="${o.id}">
      <span class="lb-hostname">${esc(lbEntryLabel(o, r))}</span><span class="lb-subtle">${o.models} model${o.models === 1 ? "" : "s"} · ${o.total} pts</span></button>`).join("")}</div></div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Cancel</button></div>`);
  dlg.querySelectorAll("[data-enhfrom]").forEach(b => b.onclick = () => { dlg.close(); lbEquipEnh(list, d.lbEnhmove, d.slot, d.name, b.dataset.enhfrom); });
}

function lbInspector(list, r, data) {
  const x = r.entries.find(e => e.id === listUI.sel);
  if (!x) return `<div class="lb-empty">${r.entries.length ? "Select a unit in your list to see its datasheet." : "Add units from the list on the right."}</div>`;
  if (!x.unit) return `<div class="lb-empty">“${esc(x.key)}” isn't in your library any more.<div><button class="btn danger" type="button" data-lb-remove="${x.id}">Remove</button></div></div>`;
  const u = x.unit, ds = u.ds;
  const buffs = buffsFor(x, r);
  const size = u.options.length > 1
    ? (() => {
        const i = Math.max(0, u.options.findIndex(o => o.models === x.models));
        return `<div class="lb-switch" role="radiogroup" aria-label="Unit size" style="--n:${u.options.length};--i:${i}">
          <span class="lb-thumb" aria-hidden="true"></span>
          ${u.options.map((o, k) => `<button type="button" role="radio" aria-checked="${k === i}" data-lb-setsize="${x.id}" data-v="${o.models}" data-i="${k}" aria-label="${o.models} model${o.models === 1 ? "" : "s"}, ${o.points} points"><span class="lb-szlong">${o.models} Model${o.models === 1 ? "" : "s"} - ${o.points} pts</span><span class="lb-szshort">x${o.models}</span></button>`).join("")}
        </div>`;
      })()
    : `<span class="lb-subtle">${x.models} model${x.models === 1 ? "" : "s"}</span>`;

  let attach = "";
  if (u.character) {
    const slot = charSlot(u);
    const hosts = r.entries.filter(h => h.unit && !h.unit.character && canAttach(u, h.unit, slot) && (h.id === x.attachTo || !r.entries.some(o => o.attachTo === h.id && (o.slot || charSlot(o.unit)) === slot)));
    // Attaching can't give one unit two enhancements (Core Rules 25.04).
    const clash = h => h.id !== x.attachTo && (x.enh || x.upg) && [h, ...r.entries.filter(o => o.attachTo === h.id && o.id !== x.id)].find(o => o.enh || o.upg);
    const same = h => r.entries.filter(o => o.key === h.key);
    attach = `<div class="lb-field"><div class="lb-label">${slot === "support" ? "Support a unit" : "Lead a unit"}</div><div class="lb-hosts">
      ${hosts.map(h => { const c = clash(h); return `<button type="button" class="lb-host${h.id === x.attachTo ? " on" : ""}" data-lb-attachto="${h.id}" ${c ? "disabled" : ""}>
        <span class="lb-hostname">${esc(h.unit.name)}${same(h).length > 1 ? ` #${same(h).indexOf(h) + 1}` : ""}</span><span class="lb-subtle">${c ? `${esc(c.unit.name)} has ${esc(c.enh || c.upg)}; one enhancement per attached unit` : `${h.models} models · ${h.total} pts`}</span>${h.id === x.attachTo ? `<span class="lb-tick">✓</span>` : ""}</button>`; }).join("")}
      <button type="button" class="lb-host${!x.attachTo ? " on" : ""}" data-lb-attachto=""><span class="lb-hostname">Not attached</span><span class="lb-subtle">${hosts.length ? "Fights as its own unit" : "No unit in your list can take this character"}</span></button>
    </div></div>`;
  }
  else {
    // Bodyguard units: the characters that can be attached to this unit, from your list and from the faction.
    for (const [slot, label, verb] of [["leader", "Leaders", "led"], ["support", "Support Characters", "supported"]]) {
      const able = (data?.units || []).filter(c => c.character && charSlot(c) === slot && canAttach(c, u, slot));
      if (!able.length) continue;
      const inList = r.entries.filter(c => c.unit?.character && charSlot(c.unit) === slot && canAttach(c.unit, u, slot));
      const hostOf = c => c.attachTo && r.entries.find(e => e.id === c.attachTo);
      // Attaching can't give one unit two enhancements (Core Rules 25.04); the leader it replaces doesn't count.
      const clash = c => c.attachTo !== x.id && (c.enh || c.upg) && [x, ...r.entries.filter(o => o.attachTo === x.id && o.id !== c.id && (o.slot || charSlot(o.unit)) !== slot)].find(o => o.enh || o.upg);
      const missing = able.filter(c => !inList.some(e => e.key === c.key)).map(c => c.name).sort();
      attach += `<div class="lb-field"><div class="lb-label">${label}</div><div class="lb-hosts">
        ${inList.map(c => { const k = clash(c), h = hostOf(c), on = c.attachTo === x.id; return `<button type="button" class="lb-host${on ? " on" : ""}" data-lb-leadby="${c.id}" data-host="${x.id}" data-slot="${slot}" ${k ? "disabled" : ""}>
          <span class="lb-hostname">${esc(lbEntryLabel({ ...c, attachTo: null }, r).replace(/ \(with .*\)$/, ""))}</span><span class="lb-subtle">${k ? `${esc(k.unit.name)} has ${esc(k.enh || k.upg)}; one enhancement per attached unit` : on ? `Attached to this unit · tap to detach` : h ? `Attached to ${esc(lbEntryLabel({ ...h, attachTo: null }, r).replace(/ \(with .*\)$/, ""))} · tap to move here` : `${c.total} pts · not attached`}</span>${on ? `<span class="lb-tick">✓</span>` : ""}</button>`; }).join("")}
        ${inList.length ? "" : `<div class="lb-subtle lb-none">None in your list yet.</div>`}
      </div></div>`;
    }
  }
  const buffNote = buffs.length ? `<div class="lb-buffnote">Weapon bonuses from attached characters are shown in <span class="lb-buffkw">this colour</span>.</div>` : "";
  const enhHTML = lbEnhChecklist(x, r, false) + lbEnhChecklist(x, r, true);
  return `
    <div class="lb-insp-head">
      <div class="lb-insp-title"><h2>${esc(unitLabel(list, x) || u.name)}<button class="lb-pencil" type="button" data-lb-unitname="${x.id}" title="Rename unit" aria-label="Rename unit">${PENCIL_SVG}</button></h2><div class="lb-insp-cost">${x.total}<span> pts</span></div></div>${unitLabel(list, x) ? `<div class="lb-insp-orig">${esc(u.name)}</div>` : ""}
      <div class="lb-insp-bar">${size}
        ${u.character ? `<button class="btn${x.warlord ? " lb-on" : ""}" type="button" data-lb-warlord="${x.id}">${x.warlord ? "★ Warlord" : "☆ Make Warlord"}</button>` : ""}
        <span class="lb-insp-acts"><button class="btn lb-iconbtn" type="button" data-lb-dup="${x.id}" ${data && lbAtMax(u, r) ? "disabled" : ""} title="Duplicate" aria-label="Duplicate">${DUP_SVG}<span class="lb-btntext">Duplicate</span></button>
        <button class="btn danger lb-iconbtn" type="button" data-lb-remove="${x.id}" title="Remove" aria-label="Remove">${TRASH_MID}<span class="lb-btntext">Remove</span></button></span></div>
    </div>
    ${attach}
    ${statsHTML(ds)}
    ${buffNote}
    ${(() => { const other = (x.problems || []).filter(p => !(x.loadoutText || []).includes(p)); return other.length ? `<div class="lb-problems">${other.map(p => `<div>⚠︎ ${esc(p)}</div>`).join("")}</div>` : ""; })()}
    ${lbLoadout(x, buffs)}
    ${enhHTML}
    ${datasheetDetailsHTML(ds, factionArmyRules(list.faction), { siblings: (data?.units || []).map(o => o.ds) })}
    ${(w => w ? w.replace('<section class="fv-panel"><div class="fv-panel-head">Wargear Options</div>', '<details class="fv-panel lb-wgfold"><summary class="fv-panel-head">Wargear Options</summary>').replace(/<\/section>$/, "</details>") : "")(wargearOptionsHTML(ds))}`;
}

/** The player's own name for a unit in a list ("" when it has none). */
const unitLabel = (list, x) => list?.units?.find(o => o.id === x.id)?.label || "";

function lbAtMax(u, r) {
  const n = r.entries.filter(e => e.key === u.key).length;
  if (n >= unitMax(u, r.rules)) return true;
  return u.transport && r.entries.filter(e => e.unit?.transport).length >= 6;
}

function lbGroupOf(u) { return DATASHEET_GROUPS.findIndex(([, test]) => test(u.kws)); }

const PENCIL_SVG = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11.3 1.3a1.5 1.5 0 0 1 2.1 0l1.3 1.3a1.5 1.5 0 0 1 0 2.1l-8.6 8.6a1 1 0 0 1-.46.26l-3.4.9a.6.6 0 0 1-.74-.74l.9-3.4a1 1 0 0 1 .26-.46l8.64-8.56Zm-.6 2.3-7.1 7.1-.5 1.9 1.9-.5 7.1-7.1-1.4-1.4Zm1.5-1.4-.6.6 1.4 1.4.6-.6-1.4-1.4Z"/></svg>`;
const TRASH_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 1.5h4a1 1 0 0 1 1 1V3h3a.75.75 0 0 1 0 1.5h-.6l-.7 9.1A1.5 1.5 0 0 1 11.2 15H4.8a1.5 1.5 0 0 1-1.5-1.4L2.6 4.5H2A.75.75 0 0 1 2 3h3v-.5a1 1 0 0 1 1-1Zm-1.9 3 .7 9h6.4l.7-9H4.1Zm2.15 1.75a.6.6 0 0 1 .6.6v4.8a.6.6 0 1 1-1.2 0v-4.8a.6.6 0 0 1 .6-.6Zm3.5 0a.6.6 0 0 1 .6.6v4.8a.6.6 0 1 1-1.2 0v-4.8a.6.6 0 0 1 .6-.6Z"/></svg>`;

const KEBAB_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>`;
const TRASH_MID = TRASH_SVG.replace('width="14" height="14"', 'width="22" height="22"');
/** Duplicate: a rounded square with a plus, with a second square behind it, up and to the right. */
const DUP_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5V5a2.5 2.5 0 0 1 2.5-2.5H19A2.5 2.5 0 0 1 21.5 5v8.5A2.5 2.5 0 0 1 19 16h-.5"/><rect x="2.5" y="8" width="13.5" height="13.5" rx="2.5"/><path d="M9.25 11.5v6.5M6 14.75h6.5"/></svg>`;
function lbListColumn(list, r) {
  const chip = (target, label) => `<button type="button" class="lb-attached${target.problems?.length ? " bad" : ""}" data-lb-jump="${target.id}" title="Show ${esc(target.unit.name)} in the list"><span class="lb-arrow">${label}</span><span class="lb-aname">${esc(target.unit.name)}</span><span class="lb-ccost">${target.total}</span></button>`;
  const card = x => {
    const sel = listUI.sel === x.id ? " sel" : "";
    // ⋮ opens a small menu with Duplicate and Delete (the same menu as an army list's box).
    const trash = `<button type="button" class="lb-trash lb-unitkebab" data-lb-unitmenu="${x.id}" data-menu-key="u:${x.id}" title="More" aria-label="More options for ${esc(x.unit?.name || x.key)}" aria-haspopup="menu">${KEBAB_SVG}</button>`;
    if (!x.unit) return `<div class="lb-cardwrap"><div role="button" tabindex="0" class="lb-card bad${sel}" id="lbc-${x.id}" data-lb-sel="${x.id}"><span class="lb-cname">${esc(x.key)}</span><span class="lb-cmeta">Not in your library</span>${trash}</div></div>`;
    const host = x.attachTo ? r.entries.find(h => h.id === x.attachTo && h.unit) : null;
    const tags = [x.warlord ? `<span class="lb-tag">Warlord</span>` : "", x.enh ? `<span class="lb-tag enh">${esc(x.enh)}</span>` : "", x.upg ? `<span class="lb-tag upg">${esc(x.upg)}</span>` : ""].join("");
    // A unit lists the characters attached to it; a character lists the unit it's attached to.
    const chips = x.unit.character ? (host ? [chip(host, "↳")] : []) : r.entries.filter(c => c.attachTo === x.id && c.unit).map(c => chip(c, "↳"));
    const bad = x.problems?.length ? " bad" : "";
    return `<div class="lb-cardwrap">
      <div role="button" tabindex="0" class="lb-card${sel}${bad}" id="lbc-${x.id}" data-lb-sel="${x.id}">
        <span class="lb-ctop"><span class="lb-cname">${esc(unitLabel(list, x) || x.unit.name)}</span><span class="lb-ccost">${x.total}</span></span>
        ${unitLabel(list, x) ? `<span class="lb-corig">${esc(x.unit.name)}</span>` : ""}
        <span class="lb-cmeta">${x.models} model${x.models === 1 ? "" : "s"}${host ? ` · ${x.slot === "support" ? "supporting" : "leading"} the unit below` : ""}${x.copy >= 3 && x.opt?.later ? " · 3rd+ cost" : ""}</span>
        ${tags ? `<span class="lb-ctags">${tags}</span>` : ""}
        ${bad ? `<span class="lb-cerr">⚠︎ ${esc(x.problems[0])}${x.problems.length > 1 ? ` (+${x.problems.length - 1} more)` : ""}</span>` : ""}
        ${trash}
      </div>
      ${chips.join("")}
    </div>`;
  };
  const groups = DATASHEET_GROUPS.map(([title]) => ({ title, items: [] }));
  for (const x of r.entries) groups[x.unit ? lbGroupOf(x.unit) : groups.length - 1].items.push(x);
  // Alphabetical within each category, whenever a unit was added (copies keep their order).
  for (const g of groups) g.items.sort((a, b) => (a.unit?.name || a.key).localeCompare(b.unit?.name || b.key));
  const pct = Math.min(100, Math.round(r.total / list.points * 100));
  const enhCount = r.enhCount;
  const st = factionStyle(list.faction);
  // Each chosen detachment on its own line, in the faction's colours, right above the units.
  const dets = `<div class="lb-detbox" style="--c1:${st.c1};--c2:${st.c2}">
      ${list.detachments.map(d => { const dd = r.dets.find(x => x.name === d);
        return `<div class="lb-detline"><span class="lb-detname">${esc(d)}</span>${dd?.unique ? `<span class="lb-detuq" title="Unique: ${esc(dd.unique)}">◆ ${esc(dd.unique)}</span>` : ""}${dd ? `<span class="lb-detdp">${dd.dp} DP</span>` : ""}</div>`; }).join("")
        || `<div class="lb-subtle">No detachment chosen</div>`}
      <button class="btn lb-detbtn" type="button" data-lb="detachments">${list.detachments.length ? "Change Detachments" : "Choose Detachments"}</button>
    </div>`;
  return `
    <div class="lb-listhead">
      <div class="lb-actions"><button class="btn" type="button" data-lb="copy">Copy as text</button><button class="btn danger" type="button" data-lb-delete="${list.id}">Delete list</button></div>
      <div class="lb-namebar"><h2>${esc(list.name)}</h2><button class="lb-pencil" type="button" data-lb-rename="${list.id}" title="Rename list" aria-label="Rename list">${PENCIL_SVG}</button></div>
      <div class="lb-meta">${esc(list.faction)} · ${r.rules.name}</div>
      <div class="lb-pts"><b class="${r.left < 0 ? "over" : ""}">${r.total.toLocaleString()}</b> / ${list.points.toLocaleString()} pts · ${r.entries.length} unit${r.entries.length === 1 ? "" : "s"}</div>
      <div class="lb-bar"><span class="${r.left < 0 ? "over" : ""}" style="width:${pct}%"></span></div>
      <div class="lb-meta">${r.dpUsed} of ${r.rules.dp} DP · ${enhCount} of ${r.rules.enh} enhancements</div>
      ${r.issues.length ? `<div class="lb-issues">${r.issues.map(i => `<div>⚠︎ ${esc(i)}</div>`).join("")}</div>` : `<div class="lb-ok">✓ Legal for ${r.rules.name}</div>`}
      ${list.generated?.notes?.length ? `<details class="more"><summary>Why this list</summary><ul class="lb-notes">${list.generated.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
      ${dets}
    </div>
    ${groups.filter(g => g.items.length).map(g => `<div class="lb-grp"><div class="lb-grp-title">${esc(g.title)} · ${g.items.length}</div>${g.items.map(card).join("")}</div>`).join("") || `<div class="lb-empty">No units yet.<br>Add them from the list on the right.</div>`}`;
}

function lbAddColumn(list, r, data) {
  const groups = DATASHEET_GROUPS.map(([title]) => ({ title, items: [] }));
  for (const u of data.units) groups[lbGroupOf(u)].items.push(u);
  return `
    <div class="lb-addhead"><div class="lb-addtitle">Add units <span class="lb-subtle">· ${Math.max(0, r.left)} pts left</span></div>
      <input class="input" id="lbAddFilter" placeholder="Search units…" value="${esc(listUI.filter || "")}" autocomplete="off"></div>
    ${groups.filter(g => g.items.length).map(g => `<details class="lb-grp lb-addgrp" data-addgrp="${esc(g.title)}" ${listUI.collapsed.has(g.title) ? "" : "open"}><summary class="lb-grp-title">${esc(g.title)} · ${g.items.length}</summary>
      ${g.items.sort((a, b) => a.name.localeCompare(b.name)).map(u => {
        const n = r.entries.filter(e => e.key === u.key).length, max = unitMax(u, r.rules), full = lbAtMax(u, r);
        return `<button type="button" class="lb-addrow${full ? " full" : ""}" data-lb-addunit="${esc(u.key)}" data-name="${esc(normName(u.name))}" ${full ? 'disabled aria-disabled="true"' : ""}>
          <span class="lb-plus">+</span><span class="lb-aname">${esc(u.name)}<span class="lb-subtle">${n ? `${n} in list · ` : ""}max ${max}</span></span>
          <span class="lb-ccost">${u.options[0].points}</span></button>`;
      }).join("")}</details>`).join("")}`;
}

function renderListEditor(list) {
  const data = armyData(list.faction);
  // Upgrades live in their own slot; older lists kept them with enhancements.
  const pool = data.detachments.flatMap(d => d.enhancements);
  for (const e of list.units) {
    const en = e.enh && pool.find(p => p.name === e.enh);
    if (en?.req?.upgrade && !e.upg) { e.upg = e.enh; e.enh = null; }
  }
  const r = evaluateList(list, data);
  if (!r.entries.some(e => e.id === listUI.sel)) listUI.sel = r.entries[0]?.id || null;
  const view = $("#view-lists");
  view.classList.add("lb-editing");
  applyAccent(view, list.faction);
  // Phones, on a unit or the add screen: a box with the list's name goes back to the list; otherwise "Lists" goes to all lists.
  $("#listsTitle").innerHTML = isPhone() && listUI.pane !== "list"
    ? `<button class="btn lb-titleback" type="button" data-lb-pane="list">‹ <span>${esc(list.name || "List")}</span></button>`
    : `<button class="btn lb-titleback" type="button" data-lb="home">‹ Lists</button>`;
  $("#listsToolbar").innerHTML = `
    <div class="lb-left ${r.left < 0 ? "over" : ""}"><span>${Math.abs(r.left).toLocaleString()}</span> <i class="lb-w">points</i> ${r.left < 0 ? "over" : "left"}</div>`;
  const host = $("#listsHost");
  const keep = {};
  for (const c of host.querySelectorAll(".lb-col")) keep[c.dataset.col] = c.scrollTop;
  const filterFocused = document.activeElement?.id === "lbAddFilter";
  host.innerHTML = `<div class="lb-shell" data-pane="${listUI.pane}">
    <div class="lb-col lb-colL" data-col="L">${lbListColumn(list, r)}</div>
    <div class="lb-col lb-colC" data-col="C">${lbInspector(list, r, data)}</div>
    <div class="lb-col lb-colR" data-col="R">${lbAddColumn(list, r, data)}</div>
  </div>
  <button type="button" class="lb-fab${listUI.pane === "add" || (listUI.pane === "unit" && isPhone()) ? " hidden" : ""}" data-lb-pane="add" aria-label="Add a unit" title="Add a unit">+</button>`;
  for (const c of host.querySelectorAll(".lb-col")) if (keep[c.dataset.col] != null) c.scrollTop = keep[c.dataset.col];
  lbApplyFilter();
  if (filterFocused) { const f = $("#lbAddFilter"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

function lbApplyFilter() {
  const q = normName(listUI.filter || "");
  $$("#listsHost .lb-addrow").forEach(b => b.hidden = !!q && !b.dataset.name.includes(q));
  $$("#listsHost .lb-addgrp").forEach(g => {
    g.hidden = !g.querySelector(".lb-addrow:not([hidden])");
    if (q && !g.hidden) g.open = true;
  });
}

/** Adds or removes a weapon for one model type; swaps happen automatically where the datasheet says what it replaces. */
function lbChangeWeapon(list, d, how) {
  const e = list.units.find(u => u.id === d.entry);
  const data = armyData(list.faction);
  const x = evaluateList(list, data).entries.find(o => o.id === d.entry);
  const gr = x?.loadout?.find(g => g.name === d.group);
  if (!e || !gr) return;
  const counts = setWeapon(gr, d.w, how);
  e.load ||= {};
  e.load[gr.name] = { n: gr.N, c: counts };
  saveList(list);
  renderListEditor(list);
}

/** Selects a unit and scrolls the list so its card is in view. */
function lbJumpTo(list, id) {
  listUI.sel = id;
  renderListEditor(list);
  const card = document.getElementById("lbc-" + id);
  if (!card) return;
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1200);
}

function openDetachmentPicker(list) {
  const data = armyData(list.faction);
  const rules = sizeRules(list.points);
  const draw = () => {
    const chosen = data.detachments.filter(d => list.detachments.includes(d.name));
    const tags = new Set(chosen.map(d => d.unique).filter(Boolean));
    openSheet(`
      <div class="sheet-head"><h2>Detachments</h2><p>${chosen.reduce((s, d) => s + d.dp, 0)} of ${rules.dp} DP used (${rules.name}) · no two detachments may share a Unique tag${rules.name === "Incursion" ? " · one 3 DP detachment may be taken on its own" : ""}.</p></div>
      <div class="sheet-body"><div class="list">${data.detachments.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => {
        const on = list.detachments.includes(d.name);
        const rival = !on && d.unique && chosen.find(c => c.unique === d.unique);
        const over = !on && !detachmentsBudgetOK([...chosen, d], rules);
        const why = rival ? `Shares the Unique: ${d.unique} tag with ${rival.name}` : over ? `Needs ${d.dp} DP; ${Math.max(0, rules.dp - chosen.reduce((s, c) => s + c.dp, 0))} left for ${rules.name}` : "";
        return `<label class="list-row ${why ? "lb-blocked" : ""}"><input type="checkbox" data-det="${esc(d.name)}" ${on ? "checked" : ""} ${why ? "disabled" : ""}>
          <span class="main"><span class="title">${esc(d.name)}</span><span class="meta" style="display:block">${d.dp} DP${d.unique ? ` · Unique: ${esc(d.unique)}` : ""} · ${d.enhancements.length} enhancements</span>${why ? `<span class="meta lb-why">${esc(why)}</span>` : ""}</span></label>`;
      }).join("")}</div></div>
      <div class="sheet-foot"><button class="btn primary" type="button" data-close>Done</button></div>`);
    $$('#sheet [data-det]').forEach(cb => cb.onchange = () => {
      list.detachments = cb.checked ? [...list.detachments, cb.dataset.det] : list.detachments.filter(n => n !== cb.dataset.det);
      // Enhancements from a removed detachment are dropped.
      const allowed = new Set(data.detachments.filter(d => list.detachments.includes(d.name)).flatMap(d => d.enhancements.map(e => e.name)));
      for (const u of list.units) { if (u.enh && !allowed.has(u.enh)) u.enh = null; if (u.upg && !allowed.has(u.upg)) u.upg = null; }
      saveList(list);
      renderListEditor(list);
      draw();
    });
  };
  draw();
}

function openCreateSheet() {
  const factions = structuredFactions();
  const d = openSheet(`
    <div class="sheet-head"><h2>Create list</h2><p>Build it yourself, unit by unit.</p></div>
    <div class="sheet-body">
      <div class="field"><label for="newName">Name</label><input class="input" id="newName" placeholder="My army"></div>
      <div class="field"><label for="newFaction">Faction</label><select class="select" id="newFaction" style="width:100%">${factions.map(f => `<option>${esc(f)}</option>`).join("")}</select></div>
      <div class="field"><label>Points</label><div class="segmented" id="newPoints">${pointSizes().map(p => `<button type="button" data-v="${p}" aria-pressed="${p === 2000}">${p}</button>`).join("")}</div></div>
    </div>
    <div class="sheet-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="newGo">Create</button></div>`);
  let pts = 2000;
  $$("#newPoints button").forEach(b => b.onclick = () => { pts = +b.dataset.v; $$("#newPoints button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
  $("#newGo").onclick = () => {
    const faction = $("#newFaction").value;
    const list = { id: uid(), version: 2, name: $("#newName").value.trim() || `${faction} ${pts}`, faction, points: pts, detachments: [], units: [], createdAt: Date.now(), updatedAt: Date.now() };
    saveList(list, true);
    d.close();
    listUI.mode = "edit"; listUI.id = list.id; listUI.sel = null; listUI.pane = isPhone() ? "list" : "unit";
    renderListsPage();
    openDetachmentPicker(list);
  };
}

/* The ⋮ menu on an army list's box or a unit's box: Duplicate and Delete. */
function openListMenu(btn) {
  const list = btn.dataset.lbListmenu, id = esc(list || btn.dataset.lbUnitmenu);
  const dupIcon = DUP_SVG.replace(/width="22" height="22"/, 'width="18" height="18"'), binIcon = TRASH_SVG.replace('width="14" height="14"', 'width="18" height="18"');
  openPopMenu(btn, list ? "l:" + list : "u:" + btn.dataset.lbUnitmenu, list
    ? `<button type="button" role="menuitem" data-lb-duplist="${id}">${dupIcon}Duplicate</button>
    <button type="button" role="menuitem" class="danger" data-lb-delete="${id}">${binIcon}Delete</button>`
    : `<button type="button" role="menuitem" data-lb-dup="${id}">${dupIcon}Duplicate</button>
    <button type="button" role="menuitem" class="danger" data-lb-menuremove="${id}">${binIcon}Delete</button>`);
}

function wireListBuilder() {
  const view = $("#view-lists");
  /* Phones and tablets: swipe a unit card left to reveal its delete button; swipe right (or tap elsewhere) to close it.
     Swipe right on a datasheet or the add screen to go back to the list. */
  // Swipe right on a datasheet or the add screen to go back to the list (phones), or from adding to the unit (tablets).
  onSwipeRight(view, e => !!e.target.closest(".lb-colC, .lb-colR"), () => {
    const list = state.lists.find(l => l.id === listUI.id);
    if (!list || listUI.mode !== "edit" || listUI.pane === "list") return;
    listUI.pane = "list"; renderListEditor(list);
  });
  // Weapon, enhancement and upgrade rows: a tap anywhere on the bar (not on its buttons or checkbox) opens or closes the details.
  view.addEventListener("click", e => {
    const t = e.target, row = t.closest("[data-split]");
    if (!row || t.closest("input, button, a, summary, [data-lb-warn], .lb-enhtaken")) return;
    const bar = row.querySelector("summary")?.getBoundingClientRect();
    if (!bar || e.clientY > bar.bottom + 2) return;
    const d = row.querySelector("details"); if (d) d.open = !d.open;
  }, true);
  view.addEventListener("click", async e => {
    const t = e.target;
    const act = t.closest("[data-lb]")?.dataset.lb;
    const list = state.lists.find(l => l.id === listUI.id);
    if (act === "home") { listUI.mode = "home"; return renderListsPage(); }
    if (act === "generate") { listUI.mode = "generate"; return renderListsPage(); }
    if (act === "create") return openCreateSheet();
    if (act === "add" && list) { listUI.pane = "add"; return renderListEditor(list); }
    if (act === "detachments" && list) return openDetachmentPicker(list);
    if (act === "copy" && list) {
      const text = listToText(list);
      try { await navigator.clipboard.writeText(text); toast("List copied"); } catch { toast("Couldn't copy here"); }
      return;
    }
    const open = !t.closest("[data-lb-delete], [data-lb-listmenu], .lb-menu") && t.closest("[data-lb-open]");
    if (open) { listUI.mode = "edit"; listUI.id = open.dataset.lbOpen; listUI.sel = null; listUI.pane = isPhone() ? "list" : "unit"; return renderListsPage(); }
    const uren = t.closest("[data-lb-unitname]");
    if (uren && list) {
      // A name of the player's own for a unit in this list; left empty, the unit goes back to its datasheet name.
      const e = list.units.find(o => o.id === uren.dataset.lbUnitname);
      if (!e) return;
      const name = await askText("Rename unit", "Name (leave empty to use the datasheet name)", e.label || "");
      if (name === null) return;
      e.label = String(name).trim() || undefined;
      saveList(list, true); return renderListEditor(list);
    }
    const ren = t.closest("[data-lb-rename]");
    if (ren) {
      const l = state.lists.find(x => x.id === ren.dataset.lbRename);
      const name = await askText("Rename list", "Name", l.name);
      if (name) { l.name = name; await saveList(l, true); renderListsPage(); }
      return;
    }
    const menuBtn = t.closest("[data-lb-listmenu]");
    if (menuBtn) return openListMenu(menuBtn);
    const dupL = t.closest("[data-lb-duplist]");
    if (dupL) {
      closePopMenu();
      const l = state.lists.find(x => x.id === dupL.dataset.lbDuplist);
      if (!l) return;
      // An exact copy of the list and everything in it, named "Name (1)", "Name (2)", … so no two share a name.
      const base = String(l.name || "List").replace(/ \(\d+\)$/, ""), names = new Set(state.lists.map(x => x.name));
      let n = 1; while (names.has(`${base} (${n})`)) n++;
      const copy = { ...structuredClone(l), id: uid(), name: `${base} (${n})`, createdAt: Date.now() };
      await saveList(copy, true);
      toast(`Duplicated as ${copy.name}`);
      return renderListsPage();
    }
    const del = t.closest("[data-lb-delete]");
    if (del) {
      closePopMenu();
      const l = state.lists.find(x => x.id === del.dataset.lbDelete);
      if (!(await confirmSheet("Delete this list?", `“${l.name || l.title || "This list"}” will be deleted. This can't be undone.`, "Delete"))) return;
      await DB.del("lists", l.id);
      state.lists = state.lists.filter(x => x !== l);
      if (listUI.id === l.id) listUI.mode = "home";
      return renderListsPage();
    }
    const old = t.closest("[data-lb-copy-old]");
    if (old) { try { await navigator.clipboard.writeText(state.lists.find(l => l.id === old.dataset.lbCopyOld)?.text || ""); toast("Copied"); } catch {} return; }
    if (t.id === "genGo") {
      const g = listUI.gen;
      g.vibe = $("#genVibe").value;
      try {
        const made = generateList({ faction: g.faction, points: g.points, vibe: g.vibe, detachments: g.pick ? null : g.chosen });
        await saveList(made, true);
        listUI.mode = "edit"; listUI.id = made.id; listUI.sel = null; listUI.pane = isPhone() ? "list" : "unit";
        renderListsPage();
        toast("List generated");
      } catch (err) { const box = $("#genError"); box.textContent = err.message; box.classList.remove("hidden"); }
    }
    const pb = t.closest("#genPoints button");
    if (pb) { listUI.gen.vibe = $("#genVibe").value; listUI.gen.points = +pb.dataset.v; store.set("rf.points", listUI.gen.points); listUI.gen.chosen = []; return renderGenerateForm(); }
    const pk = t.closest("#genPick button");
    if (pk) { listUI.gen.vibe = $("#genVibe").value; listUI.gen.pick = pk.dataset.v === "pick"; return renderGenerateForm(); }
    if (!list) return;
    // Delete from the trash icon on a unit card (checked before the card's own click).
    const um = t.closest("[data-lb-unitmenu]");
    if (um) return openListMenu(um);
    const trash = t.closest("[data-lb-menuremove]");
    if (trash) {
      const id = trash.dataset.lbMenuremove;
      list.units = list.units.filter(u => u.id !== id).map(u => (u.attachTo === id ? { ...u, attachTo: null, slot: null } : u));
      if (listUI.sel === id) listUI.sel = null;
      saveList(list); return renderListEditor(list);
    }
    const sz = t.closest("[data-lb-setsize]");
    if (sz) {
      const e = list.units.find(u => u.id === sz.dataset.lbSetsize);
      if (!e || e.models === +sz.dataset.v) return;
      // Slide the switch to the chosen size, then update the unit once it has moved.
      const sw = sz.closest(".lb-switch");
      sw.style.setProperty("--i", sz.dataset.i);
      sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b === sz)));
      e.models = +sz.dataset.v;
      saveList(list);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => renderListEditor(list), reduce ? 0 : 200);
      return;
    }
    const move = t.closest("[data-lb-enhmove]");
    if (move) { e.preventDefault(); return lbMoveEnh(list, move.dataset); }
    const warnIcon = t.closest("[data-lb-warn]");
    if (warnIcon) { e.preventDefault(); return toast(warnIcon.dataset.lbWarn); }
    const step = t.closest("[data-lb-step]");
    if (step) return lbChangeWeapon(list, step.dataset, +step.dataset.lbStep);
    const pane = t.closest("[data-lb-pane]");
    if (pane) { listUI.pane = pane.dataset.lbPane; return renderListEditor(list); }
    const sel = t.closest("[data-lb-sel]");
    if (sel) { listUI.sel = sel.dataset.lbSel; listUI.pane = "unit"; renderListEditor(list); if (isPhone()) $(".lb-colC").scrollTop = 0; return; }
    const jump = t.closest("[data-lb-jump]");
    if (jump) { if (isPhone()) listUI.pane = "list"; return lbJumpTo(list, jump.dataset.lbJump); }
    const addu = t.closest("[data-lb-addunit]");
    if (addu) {
      if (addu.disabled) return;
      const data = armyData(list.faction);
      const u = data.units.find(x => x.key === addu.dataset.lbAddunit);
      if (!u || lbAtMax(u, evaluateList(list, data))) return;
      const e = { id: uid(), key: u.key, models: u.options[0].models, enh: null, upg: null, attachTo: null, slot: null, warlord: false, gear: {} };
      if (u.character && !list.units.some(x => x.warlord)) e.warlord = true;
      list.units.push(e);
      if (!isPhone()) listUI.sel = e.id;
      saveList(list); renderListEditor(list);
      if (!isPhone()) document.getElementById("lbc-" + e.id)?.scrollIntoView({ block: "nearest" });
      return toast(`Added ${u.name}`);
    }
    const lead = t.closest("[data-lb-leadby]");
    if (lead) {
      const c = list.units.find(u => u.id === lead.dataset.lbLeadby), host = lead.dataset.host, slot = lead.dataset.slot;
      if (!c || lead.disabled) return;
      if (c.attachTo === host) { c.attachTo = null; c.slot = null; }
      else {
        const data = armyData(list.faction);
        // One leader (and one support character) per unit: the one already there steps off.
        const before = list.units.filter(o => o.id !== c.id && o.attachTo === host && (o.slot || charSlot(data.units.find(z => z.key === o.key) || {})) === slot);
        for (const o of before) { o.attachTo = null; o.slot = null; }
        c.attachTo = host; c.slot = slot;
        if (before.length) toast(`Detached ${before.map(o => data.units.find(z => z.key === o.key)?.name || o.key).join(", ")}`);
      }
      saveList(list); return renderListEditor(list);
    }
    const at = t.closest("[data-lb-attachto]");
    if (at) {
      const c = list.units.find(u => u.id === listUI.sel);
      const u = c && armyData(list.faction).units.find(x => x.key === c.key);
      if (!c || !u) return;
      c.attachTo = at.dataset.lbAttachto || null; c.slot = c.attachTo ? charSlot(u) : null;
      saveList(list); return renderListEditor(list);
    }
    const dup = t.closest("[data-lb-dup]");
    if (dup) {
      const src = list.units.find(u => u.id === dup.dataset.lbDup);
      if (!src) return;
      const copy = { ...src, id: uid(), enh: null, upg: null, attachTo: null, slot: null, warlord: false, gear: JSON.parse(JSON.stringify(src.gear || {})) };
      list.units.splice(list.units.indexOf(src) + 1, 0, copy);
      listUI.sel = copy.id;
      saveList(list); return renderListEditor(list);
    }
    const rm = t.closest("[data-lb-remove]");
    if (rm) {
      const id = rm.dataset.lbRemove;
      list.units = list.units.filter(u => u.id !== id).map(u => (u.attachTo === id ? { ...u, attachTo: null, slot: null } : u));
      saveList(list); return renderListEditor(list);
    }
    const wl = t.closest("[data-lb-warlord]");
    if (wl) { for (const u of list.units) u.warlord = u.id === wl.dataset.lbWarlord; saveList(list); return renderListEditor(list); }
  });
  view.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "genFaction") { listUI.gen.vibe = $("#genVibe").value; listUI.gen.faction = t.value; listUI.gen.chosen = []; return renderGenerateForm(); }
    if (t.dataset.genDet) {
      listUI.gen.vibe = $("#genVibe").value;
      const g = listUI.gen;
      g.chosen = t.checked ? [...g.chosen, t.dataset.genDet] : g.chosen.filter(n => n !== t.dataset.genDet);
      return renderGenerateForm();
    }
    const list = state.lists.find(l => l.id === listUI.id);
    if (!list) return;
    const entry = id => list.units.find(u => u.id === id);
    if (t.matches("[data-lb-enhcheck]")) {
      if (t.checked) return lbEquipEnh(list, t.dataset.lbEnhcheck, t.dataset.slot, t.dataset.name);
      const u = entry(t.dataset.lbEnhcheck); if (u.enh === t.dataset.name) u.enh = null; if (u.upg === t.dataset.name) u.upg = null;
    }
    else if (t.matches("[data-lb-attach]")) {
      const c = entry(t.dataset.lbAttach);
      const u = armyData(list.faction).units.find(x => x.key === c.key);
      c.attachTo = t.value || null; c.slot = t.value ? charSlot(u) : null;
    } else return;
    saveList(list);
    renderListEditor(list);
  });
  view.addEventListener("input", e => {
    if (e.target.id === "genVibe" && listUI.gen) listUI.gen.vibe = e.target.value;
    if (e.target.id === "lbAddFilter") { listUI.filter = e.target.value; lbApplyFilter(); }
  });
  // Remember which weapon bars are open, so they stay open after changes.
  view.addEventListener("toggle", e => {
    const k = e.target.dataset?.wkey;
    if (k) e.target.open ? listUI.openWeapons.add(k) : listUI.openWeapons.delete(k);
    const g = e.target.dataset?.addgrp;
    if (g && !listUI.filter) e.target.open ? listUI.collapsed.delete(g) : listUI.collapsed.add(g);
  }, true);
  // Keyboard: unit cards act like buttons.
  view.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".lb-card, .lb-listcard")) { e.preventDefault(); e.target.click(); }
  });
}

export { renderListsPage, renderSaved, wireListBuilder };
