/* RulesForge · ai.js
 * The on-device AI model (Chrome's built-in model or WebLLM) and its setup sheet.
 */
import { $, confirmSheet, esc, formatGB, openSheet, state, store, toast, settingsTabsHTML } from "./core.js?v=7.6";
import { renderChat } from "./rules-chat.js?v=7.6";

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm";

/* `id` is the model family; the exact build (16- or 32-bit maths) is picked per device. */
const MODELS = [
  { id: "Llama-3.2-1B-Instruct", name: "Light", desc: "Fastest · phones, tablets and laptops · about 0.9 GB" },
  { id: "Qwen2.5-1.5B-Instruct", name: "Balanced", desc: "Better at rule interactions, a little slower · newer phones and tablets · about 1.1 GB" },
  { id: "Llama-3.2-3B-Instruct", name: "Standard", desc: "Better answers, slower · computers with a graphics card · about 2.3 GB" },
  { id: "Qwen2.5-7B-Instruct", name: "Smart", desc: "Best list building · desktops with a strong graphics card · about 5 GB" },
];
const modelFamily = id => (MODELS.find(m => id && id.startsWith(m.id)) || MODELS[0]).id;

/* Phones, tablets and low-memory computers get the Light model by default. */
const SMALL_DEVICE = matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 4);
const RECOMMENDED_MODEL = SMALL_DEVICE ? MODELS[0].id : MODELS[2].id;/* Uses WebLLM (open model, runs on the computer's graphics chip via WebGPU),
   or Chrome's built-in model when the browser offers it. Either way, the
   model runs locally and only reads the excerpts it is given. */

/* Chrome checks support per language, so the same options go to availability() and create(). */
const CHROME_OPTS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const AI = {
  kind: null,          // "webllm" | "chrome"
  engine: null,
  webllm: null,
  state: "off",        // off | loading | ready | error
  detail: "Not set up",
  progress: 0,
  choice: store.get("rf.ai", null),   // { kind, modelId }

  get chromeAvailable() { return typeof self.LanguageModel !== "undefined"; },
  get webgpu() { return !!navigator.gpu; },
  get ready() { return this.state === "ready"; },

  set(stateName, detail, progress = 0) {
    this.justBecameReady = stateName === "ready" && this.state === "loading";
    this.state = stateName;
    this.detail = detail;
    this.progress = progress;
    renderAIStatus();
  },

  async start(choice) {
    this.choice = choice;
    store.set("rf.ai", choice);
    try {
      if (choice.kind === "chrome") {
        if (!this.chromeAvailable) throw new Error("This browser doesn't have Chrome's built-in AI. Use desktop Chrome 148 or newer.");
        const availability = await self.LanguageModel.availability(CHROME_OPTS);
        if (availability === "unavailable") {
          throw new Error("Chrome's built-in AI can't run on this computer (it needs about 22 GB of free disk space and 16 GB of memory). Choose one of the other models.");
        }
        if (availability !== "available") {
          // Chrome downloads its model once and shares it with every site. Needs a click to start.
          this.set("loading", "Chrome is getting its AI model ready…");
          const s = await self.LanguageModel.create({
            ...CHROME_OPTS,
            monitor(m) { m.addEventListener("downloadprogress", e => AI.set("loading", `Chrome is downloading its model ${Math.round(e.loaded * 100)}%`, e.loaded)); },
          });
          s.destroy();
        }
        this.kind = "chrome";
        this.set("ready", "Chrome built-in AI");
        return;
      }
      if (!this.webgpu) throw new Error("This browser doesn't support WebGPU. Use a recent Chrome, Edge or Safari.");
      this.set("loading", "Loading AI library…");
      this.webllm ??= await import(WEBLLM_URL);
      const model = MODELS.find(m => m.id === modelFamily(choice.modelId));
      const buildId = await this.buildFor(model.id);
      this.set("loading", "Preparing model…");
      if (this.engine) { try { await this.engine.unload(); } catch {} this.engine = null; }
      this.engine = await this.webllm.CreateMLCEngine(buildId, {
        initProgressCallback: r => {
          const pct = Math.round((r.progress || 0) * 100);
          const text = /fetch|download|loading model from cache/i.test(r.text || "") ? `Downloading ${pct}%` : `Starting up ${pct}%`;
          AI.set("loading", text, r.progress || 0);
        },
      });
      // A tiny warm-up run so the first real question doesn't pay the start-up cost.
      this.set("loading", "Warming up…", 1);
      try { await this.engine.chat.completions.create({ messages: [{ role: "user", content: "Hi" }], max_tokens: 1 }); } catch {}
      this.kind = "webllm";
      this.loadedId = buildId;
      this.set("ready", `${model.name} model`);
    } catch (err) {
      console.error(err);
      this.set("error", err.message || "Couldn't start the model");
    }
  },

  /** Many phones' graphics chips lack 16-bit maths; those need the 32-bit build of the model. */
  async buildFor(family) {
    if (this.f16 === undefined) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        this.f16 = !!adapter?.features.has("shader-f16");
      } catch { this.f16 = false; }
    }
    return `${family}-${this.f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
  },

  /** Loads a previously chosen model automatically if it's already cached. */
  async resume() {
    // No choice saved yet: if Chrome's built-in AI is already on this computer, just use it.
    if (!this.choice || this.choice.kind === "chrome") {
      if (this.chromeAvailable) {
        try {
          const availability = await self.LanguageModel.availability(CHROME_OPTS);
          if (availability === "available") return this.start({ kind: "chrome" });
          if (availability !== "unavailable") return this.set("off", "Click to turn on Chrome AI");
        } catch {}
      }
      if (!this.choice) return;
      if (this.choice.kind === "chrome") return this.set("off", "Not set up");
    }
    if (!this.webgpu) return;
    try {
      this.webllm ??= await import(WEBLLM_URL);
      const cached = await this.webllm.hasModelInCache?.(await this.buildFor(modelFamily(this.choice.modelId)));
      if (cached) await this.start(this.choice);
      else this.set("off", "Download needed");
    } catch { this.set("off", "Not set up"); }
  },

  /** One stateless completion. `schema` returns parsed JSON; `onText` streams. */
  async complete({ system, prompt, temperature = 0.3, schema = null, onText = null, maxTokens = 600 }) {
    if (!this.ready) throw new Error("The AI model isn't set up yet.");
    if (this.kind === "chrome") {
      const session = await self.LanguageModel.create({ ...CHROME_OPTS, initialPrompts: [{ role: "system", content: system }] });
      try {
        if (schema) return parseJSON(await session.prompt(prompt, { responseConstraint: schema }));
        if (onText) {
          let acc = "";
          for await (const piece of session.promptStreaming(prompt)) {
            acc += piece;   // each streamed chunk is a new piece of text
            onText(acc);
          }
          return acc;
        }
        return await session.prompt(prompt);
      } finally { session.destroy(); }
    }
    const request = {
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    };
    if (schema) {
      request.response_format = { type: "json_object", schema: JSON.stringify(schema) };
      const r = await this.engine.chat.completions.create(request);
      return parseJSON(r.choices[0].message.content);
    }
    if (onText) {
      request.stream = true;
      let acc = "";
      for await (const chunk of await this.engine.chat.completions.create(request)) {
        acc += chunk.choices[0]?.delta?.content || "";
        onText(acc);
      }
      return acc;
    }
    const r = await this.engine.chat.completions.create(request);
    return r.choices[0].message.content;
  },
};

function parseJSON(text) {
  const cleaned = String(text).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("The model returned an unreadable answer. Try again.");
  }
}
const isOverflow = err => /context|too long|exceed|prompt.*(length|large)|QuotaExceeded/i.test(String(err?.message || err));

function renderAIStatus() {
  $("#aiDot").className = "dot" + (AI.state === "ready" ? " ready" : AI.state === "loading" ? " loading" : AI.state === "error" ? " error" : "");
  $("#aiStatusText").textContent = AI.detail;
  const sheetBar = $("#aiSheetBar");
  if (sheetBar) {
    sheetBar.style.width = `${Math.round(AI.progress * 100)}%`;
    $("#aiSheetText").textContent = AI.detail;
    $("#aiSheetStart").disabled = AI.state === "loading";
    if (AI.justBecameReady) setTimeout(() => $("#sheet").open && $("#sheet").close(), 600);
  }
  if (!state.messages.length) renderChat();
}

function openAISheet() {
  const useChrome = AI.chromeAvailable && !SMALL_DEVICE;
  const choice = AI.choice || { kind: useChrome ? "chrome" : "webllm", modelId: RECOMMENDED_MODEL };
  const options = MODELS.map(m => ({
    value: m.id,
    name: m.name + (!useChrome && m.id === RECOMMENDED_MODEL ? " (recommended for this device)" : ""),
    desc: m.desc,
  }));
  if (AI.chromeAvailable) options.unshift({ value: "chrome", name: "Chrome built-in AI" + (useChrome ? " (recommended)" : ""), desc: "Built into Chrome on this computer — nothing for this site to download. Chrome may fetch its model once if it hasn't already." });
  const selected = choice.kind === "chrome" ? "chrome" : modelFamily(choice.modelId);
  openSheet(`${settingsTabsHTML("ai")}
    <div class="sheet-head">
      <h2>Set up the AI model</h2>
      <p>The model downloads once and is saved in this browser. After that it runs entirely on this device and never looks anything up online.</p>
    </div>
    <div class="sheet-body">
      ${!AI.webgpu && !AI.chromeAvailable ? `<div class="check problem">This browser can't run AI models. Use a recent version of Chrome, Edge or Safari on a computer, iPad or recent phone.</div>` : ""}
      ${options.map(o => `<label class="choice"><input type="radio" name="aiModel" value="${esc(o.value)}" ${o.value === selected ? "checked" : ""}><span><strong>${esc(o.name)}</strong><span>${esc(o.desc)}</span></span></label>`).join("")}
      <div>
        <div class="status-line"><span id="aiSheetText">${esc(AI.detail)}</span></div>
        <div class="progress"><div id="aiSheetBar" style="width:${Math.round(AI.progress * 100)}%"></div></div>
      </div>
      <div class="field">
        <label>Saved on this device</label>
        <div class="list" id="modelStorage"><div class="list-row"><span class="meta">Checking…</span></div></div>
        <span class="hint">Removing a model only frees up space — your PDFs and saved lists stay. Chrome's built-in AI is managed by Chrome itself.</span>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn" type="button" data-close>Close</button>
      <button class="btn primary" type="button" id="aiSheetStart" ${AI.state === "loading" ? "disabled" : ""}>${AI.ready ? "Switch model" : "Start"}</button>
    </div>`);
  $("#aiSheetStart").onclick = () => {
    const v = $('input[name="aiModel"]:checked')?.value;
    if (!v) return;
    AI.start(v === "chrome" ? { kind: "chrome" } : { kind: "webllm", modelId: v });
  };
  $("#modelStorage").onclick = e => {
    const btn = e.target.closest("[data-remove-model]");
    if (btn) removeModel(btn.dataset.removeModel);
  };
  renderModelStorage();
}

/** Lists the models this browser has downloaded, each with a Remove button. */
async function renderModelStorage() {
  const host = $("#modelStorage");
  if (!host) return;
  const note = text => `<div class="list-row"><span class="meta">${esc(text)}</span></div>`;
  if (!AI.webgpu) { host.innerHTML = note("No downloadable models in this browser."); return; }
  try { AI.webllm ??= await import(WEBLLM_URL); }
  catch { host.innerHTML = note("Couldn't check — you may be offline."); return; }
  const saved = [];
  for (const m of MODELS) {
    const id = await AI.buildFor(m.id);
    if (await AI.webllm.hasModelInCache(id).catch(() => false)) saved.push({ m, id });
  }
  let html = saved.length
    ? saved.map(({ m, id }) => `<div class="list-row">
        <div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${AI.loadedId === id ? "In use now" : "Downloaded"}</div></div>
        <button class="btn plain danger" type="button" data-remove-model="${esc(id)}">Remove</button>
      </div>`).join("")
    : note("No models downloaded.");
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) html += note(`This site is using ${formatGB(est.usage)} of storage in total.`);
  } catch {}
  if ($("#modelStorage") === host) host.innerHTML = html;
}

async function removeModel(id) {
  if (!(await confirmSheet("Remove this model?", "It will be deleted from this device. You can download it again any time.", "Remove"))) return;
  if (AI.loadedId === id) {
    try { await AI.engine?.unload(); } catch {}
    AI.engine = null; AI.kind = null; AI.loadedId = null;
    AI.set("off", "Not set up");
  }
  try {
    await AI.webllm.deleteModelAllInfoInCache(id);
    if (AI.choice?.kind === "webllm" && (await AI.buildFor(modelFamily(AI.choice.modelId))) === id) {
      AI.choice = null;
      store.set("rf.ai", null);
    }
    toast("Model removed");
  } catch (err) {
    toast("Couldn't remove the model: " + (err.message || err));
  }
  openAISheet();   // the confirmation replaced the AI window; bring it back
}

export { AI, isOverflow, openAISheet, renderAIStatus };
