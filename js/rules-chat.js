/* RulesForge · rules-chat.js
 * Ask Rules: prompts, answer clean-up and the chat page.
 */
import { AI, isOverflow } from "./ai.js?v=8.7";
import { $, $$, esc, state, store } from "./core.js?v=8.7";
import { factionsInLibrary } from "./library.js?v=8.7";
import { buildContext, keyLines, planRetrieval } from "./search.js?v=8.7";
import { md, normName, tokens } from "./text.js?v=8.7";

const RULES_SYSTEM = `You are a Warhammer 40,000 rules assistant. Answer ONLY from the numbered rules excerpts in the prompt. Never guess and never use outside knowledge.

How to answer:
- Start with **Answer** on its own line, then one bullet that answers the question directly in a full sentence. For a yes/no question, begin that sentence with Yes or No.
- If the question has more than one part, give each extra part its own short bold header with 1 to 3 bullets.
- Every bullet is a full sentence in plain words that states what the rule says. A bullet is never just a label or just a citation.
- End each bullet with the number of the excerpt it comes from, like [2].
- Don't repeat the question. No introduction, no closing summary, no tips. The player can ask for more.
- If the excerpts don't answer it, say so in one line and name the rule to look up.
- Excerpts already use the newest rules: when an excerpt says it replaces an older rule, that excerpt is the rule in force. Mention the update only if it changes the answer.
- Answer about the exact thing the question asks (for example shooting). When a rule lists several things a unit can't do, use the item that matches the question; don't swap in a different item from the list.
- When KEY LINES are given, they are the sentences that mention the most parts of the question. Check them first.

Example of the layout only (X and Y stand for whatever the question is about):
QUESTION: Can a unit that did X still do Y?
**Answer**
- No. Until the end of the turn, a unit that did X is not eligible to do Y. [1]`;

/* Second try when the first answer came back as empty labels: plain sentences only. */
const RULES_PLAIN_SYSTEM = `You are a Warhammer 40,000 rules assistant. Answer ONLY from the numbered rules excerpts in the prompt.
Reply with 1 to 3 plain sentences that directly answer the question. For a yes/no question, the first word is Yes or No.
End each sentence with the excerpt number it comes from, like [1]. No headers, no lists, don't repeat the question.`;

/** Tidies a model answer: drops a repeated question, label-only bullets and empty headers. Returns "" if nothing useful is left. */
function cleanAnswer(answer, question) {
  const cite = /\[\d+(?:\s*[,–-]\s*\d+)*\]|\(\d+(?:\s*,\s*\d+)*\)/g;
  const isHeader = l => /^\s*(#+\s*)?\*\*[^*]+\*\*:?\s*$/.test(l) || /^\s*#+\s+\S/.test(l);
  const content = l => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(cite, "").replace(/\*\*/g, "").trim();
  let lines = String(answer || "").split("\n");
  const q = normName(question);
  // Drop the question if the model repeated it at the top.
  const first = lines.findIndex(l => l.trim());
  if (first >= 0) {
    const f = normName(content(lines[first]));
    if (f && (f === q || (/\?\s*(\*\*)?\s*$/.test(lines[first]) && (q.includes(f) || f.includes(q))))) lines.splice(first, 1);
  }
  // A bullet or line is hollow if it's only a label ("What it hits on:"), a question, or a citation.
  const hollow = l => {
    const c = content(l);
    return !c || /[:?]$/.test(c) || c.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length < 3;
  };
  lines = lines.filter(l => !l.trim() || isHeader(l) || !hollow(l));
  // Drop headers with nothing under them.
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    if (isHeader(lines[k])) {
      const next = lines.slice(k + 1).find(l => l.trim());
      if (!next || isHeader(next)) continue;
    }
    out.push(lines[k]);
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = out.filter(l => l.trim() && !isHeader(l)).map(content).join(" ").split(/\s+/).filter(w => /[\p{L}]/u.test(w)).length;
  return words >= 4 ? text : "";
}

/* Extra instructions when a unit's datasheet is included. */
const UNIT_INSTRUCTIONS = `A unit's datasheet is included. Answer the question for that unit:
- Under the first header(s), give only the parts of the core rule the question asks about.
- Then add a header named after the unit, like **Sternguard abilities**, listing only the abilities that change the answer. For each, say in one bullet whether it applies or is blocked, and why.
- If the core rule forbids something (for example "no re-rolls" or "cannot be modified"), say plainly which ability it blocks.
- Leave out abilities that don't affect this question.`;

/* Used when the player asks for more about the previous answer. */
const FOLLOW_UP_INSTRUCTIONS = `The player wants more detail about the previous answer. Now give a fuller explanation: the conditions, restrictions and exceptions in the excerpts that relate to it. Keep the same layout: short bold headers with bullet points, citations at the end of bullets. Don't repeat the previous answer word for word.`;

/* "Tell me more", "why?", "what about…", or a short question about "it/that". */
const FOLLOW_UP_RX = /^(tell me more|more( info(rmation)?| details?)?|explain( (that|this|it|more|further))?|elaborate|go on|expand|why\b|what about|and (if|what|when|how|can)|what if|how so|details?\b|can you explain)/i;
function isFollowUp(question) {
  if (!state.lastTurn) return false;
  return FOLLOW_UP_RX.test(question) || (/\b(it|that|this|they|them)\b/i.test(question) && tokens(question).length <= 4);
}const RESTRICTIONS = [
  { what: "re-rolls", rule: /no re-?rolls?|cannot (?:be )?re-?roll|can'?t (?:be )?re-?roll/i, ability: /re-?roll/i },
  { what: "modifiers", rule: /irrespective of[^.]*modifiers|cannot be modified|unmodified (?:hit|wound)/i,
    ability: /[+-]\s?1 to (?:the )?(?:hit|wound)|add 1 to (?:the )?(?:hit|wound)|subtract 1 from|improve (?:the )?(?:ballistic|weapon) skill|worsen/i },
  { what: "shooting", rule: /cannot (?:shoot|be selected to shoot|make (?:ranged )?attacks)/i, ability: /\b(?:shoot|shot|ranged attack)/i },
  { what: "charging", rule: /cannot (?:declare a )?charge/i, ability: /\bcharge/i },
];
function sentences(text) {
  return text.replace(/\n(?=[a-z(])/g, " ").split(/(?<=[.!?])\s+|\n/).map(s => s.trim()).filter(s => s.length > 12);
}
/** Pairs a restriction in the core rule with datasheet lines it may block. */
function interactionHints(plan) {
  if (!plan.units?.length) return [];
  const ruleSentences = sentences(plan.groups[0].hits.map(h => h.text).join("\n"));
  const hints = [], seen = new Set();
  for (const r of RESTRICTIONS) {
    const ruleLine = ruleSentences.find(s => r.rule.test(s));
    if (!ruleLine) continue;
    for (const g of plan.groups.slice(1)) {
      for (const s of sentences(g.hits.map(h => h.text).join("\n"))) {
        if (!r.ability.test(s) || r.rule.test(s) || seen.has(s)) continue;
        seen.add(s);
        hints.push({ what: r.what, unit: g.label.replace(/^DATASHEET — /, ""), ability: s.slice(0, 200), rule: ruleLine.slice(0, 200) });
      }
    }
  }
  return hints.slice(0, 4);
}function hashText(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const answerCache = {
  get(key) { return store.get("rf.answers", {})[key]?.a || null; },
  set(key, answer) {
    const all = store.get("rf.answers", {});
    all[key] = { a: answer, t: Date.now() };
    const keys = Object.keys(all).sort((x, y) => all[y].t - all[x].t);
    for (const k of keys.slice(150)) delete all[k];
    store.set("rf.answers", all);
  },
};

async function ask(question) {
  question = question.trim();
  if (!question || state.answering) return;
  const user = { role: "user", text: question };
  const bot = { role: "bot", text: "", sources: [], error: false, status: "Finding the relevant rules…", openSources: false };
  state.messages.push(user, bot);
  state.answering = true;
  renderChat();

  const finish = (text, error = false) => {
    bot.text = text; bot.error = error; bot.status = null;
    state.answering = false;
    renderChat();
  };

  if (!state.docs.length) return finish("Your library is empty. Add your rules PDFs in **Library** first.", true);

  // Follow-ups ("tell me more", "what about…") keep the previous question's topic and sources.
  const followUp = isFollowUp(question);
  const previous = followUp ? state.lastTurn : null;
  const topic = previous ? `${previous.question} ${question}`.slice(-400) : question;

  // Search is instant and needs no AI. The wording decides which documents are searched.
  const plan = planRetrieval(topic);
  bot.searched = plan.searched + (previous ? " · follow-up" : "");
  const allHits = plan.groups.flatMap(g => g.hits);
  if (!allHits.length) return finish("I couldn't find anything about that in your PDFs. Try different wording, or check the search scope.", true);

  // Show the matching passages and any rule conflicts straight away; the AI's explanation streams in above them.
  const withUnits = plan.units.length > 0;
  const budgets = withUnits ? [3000, 1800] : [2600, 1500];
  bot.sources = buildContext(plan.groups, budgets[0]).used;
  bot.hints = interactionHints(plan);
  bot.openSources = true;
  if (!AI.ready) {
    return finish("Here are the most relevant passages from your PDFs. Turn on the **AI model** in the sidebar to get a written explanation as well.", false);
  }

  // Same question, same sources, same model → reuse the saved answer instantly.
  const cacheKey = hashText([AI.detail, "v4", normName(previous ? previous.question + " | " + question : question), buildContext(plan.groups, budgets[0]).text].join("|"));
  const saved = answerCache.get(cacheKey);
  const remember = answer => {
    state.lastTurn = { question: topic, answer };
  };
  if (saved) {
    bot.openSources = false;
    bot.searched += " · saved answer";
    remember(saved);
    return finish(saved);
  }

  const previousText = previous
    ? `PREVIOUS QUESTION: ${previous.question}\nPREVIOUS ANSWER:\n${previous.answer.slice(0, 700)}\n\n`
    : "";
  const instructions = [withUnits ? UNIT_INSTRUCTIONS : "", previous ? FOLLOW_UP_INSTRUCTIONS : ""].filter(Boolean).join("\n");

  bot.status = "Writing an explanation…";
  renderChat();

  const hintText = bot.hints.length
    ? "POSSIBLE INTERACTIONS TO ADDRESS (found by checking the text):\n" +
      bot.hints.map(h => `- Rule says: "${h.rule}" / ${h.unit} datasheet says: "${h.ability}" → state whether the datasheet ability is blocked by the rule.`).join("\n") + "\n\n"
    : "";

  // Small budgets keep the model's reading time short on phones and tablets.
  for (const budget of budgets) {
    const { text, used } = buildContext(plan.groups, budget);
    bot.sources = used;
    try {
      const answer = await AI.complete({
        system: RULES_SYSTEM,
        prompt: `${text}${keyLines(question, used)}${hintText}${previousText}QUESTION: ${question}\n\n${instructions ? instructions + "\n" : ""}Start with **Answer** and a full-sentence bullet that answers it directly. Use only the excerpts above.`,
        temperature: 0.2,
        // Short answers are faster too; follow-ups are allowed more room.
        maxTokens: previous ? 550 : withUnits ? 420 : 300,
        onText: t => {
          bot.text = t;
          if (bot.status) { bot.status = null; bot.openSources = false; }
          updateLastBubble();
        },
      });
      let final = cleanAnswer(answer, question);
      if (!final) {
        // The model gave labels without answers; ask again for plain sentences.
        bot.text = ""; bot.status = "Rewriting the answer…"; updateLastBubble(); renderChat();
        const plain = await AI.complete({
          system: RULES_PLAIN_SYSTEM,
          prompt: `${text}${keyLines(question, used)}QUESTION: ${question}\n\nAnswer in 1 to 3 plain sentences using only the excerpts above.`,
          temperature: 0.1, maxTokens: 200,
          onText: t => { bot.text = t; if (bot.status) bot.status = null; updateLastBubble(); },
        });
        const sentencesOut = sentences(String(plain || "").replace(/\*\*/g, "")).filter(x => !/\?$/.test(x));
        final = sentencesOut.length ? cleanAnswer("**Answer**\n" + sentencesOut.map(x => "- " + x).join("\n"), question) : "";
      }
      if (!final) {
        bot.openSources = true;
        return finish("I couldn't write a clear answer from these passages. The most relevant rules are shown below.", true);
      }
      bot.openSources = false;
      if (budget === budgets[0]) answerCache.set(cacheKey, final);
      remember(final);
      return finish(final);
    } catch (err) {
      if (isOverflow(err)) continue;
      return finish("The model couldn't answer: " + (err.message || err), true);
    }
  }
  finish("That question pulled in more rules text than the model can read at once. Try a narrower question or scope.", true);
}

function scopeOptions() {
  return [["auto", "Automatic"], ["core", "Core Rules only"], ["all", "All sources"],
    ...factionsInLibrary().map(f => ["f:" + f, `Core + ${f}`])];
}
function scopeLabel(scope) {
  return (scopeOptions().find(o => o[0] === scope) || [, "All sources"])[1];
}
function renderScope() {
  const sel = $("#scopeSelect");
  const opts = scopeOptions();
  if (!opts.some(o => o[0] === state.scope)) state.scope = "auto";
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === state.scope ? "selected" : ""}>${esc(l)}</option>`).join("");
  sel.classList.toggle("hidden", !state.docs.length);
}

function botBubbleHTML(m) {
  let body = m.searched ? `<div class="searched">Searched: ${esc(m.searched)}</div>` : "";
  if (m.hints?.length) {
    body += `<div class="hints"><strong>Rule check</strong>${m.hints.map(h =>
      `<div>⚠︎ The rule restricts ${esc(h.what)}: “${esc(h.rule)}” — ${esc(h.unit)} has: “${esc(h.ability)}”</div>`).join("")}</div>`;
  }
  if (m.text) body += `<div class="answer">${md(m.text)}</div>`;
  if (m.status) body += `<div class="status-line"><span class="spinner"></span><span>${esc(m.status)}</span></div>`;
  if (m.sources?.length) {
    // While the AI is still writing (or when it's off), the passages are shown open so there's something to read right away.
    const open = m.openSources;
    body += `<details class="sources" ${open ? "open" : ""}><summary>${open ? "Matching rules" : "Sources"} (${m.sources.length})</summary>${m.sources.map((s, i) =>
      `<details class="source" data-n="${i + 1}" ${open && i === 0 ? "open" : ""}><summary>[${i + 1}] ${esc(s.citation)}</summary><div>${esc(s.text)}</div></details>`).join("")}</details>`;
  }
  return body;
}

function welcomeHTML() {
  const hasDocs = state.docs.length > 0, hasAI = AI.ready;
  const steps = `
    <ol class="steps">
      <li class="step ${hasDocs ? "done" : ""}">
        <span class="step-num">${hasDocs ? "✓" : "1"}</span>
        <span class="step-text"><strong>Add your rules PDFs</strong><span>${hasDocs ? `${state.docs.length} document${state.docs.length === 1 ? "" : "s"} in your library` : "Core Rules, your faction, points and FAQs"}</span></span>
        ${hasDocs ? "" : `<button class="btn" data-go="library" type="button">Open Library</button>`}
      </li>
      <li class="step ${hasAI ? "done" : ""}">
        <span class="step-num">${hasAI ? "✓" : "2"}</span>
        <span class="step-text"><strong>Set up the AI model</strong><span>${hasAI ? AI.detail + " is ready" : "One-time download, then it runs on this device"}</span></span>
        ${hasAI ? "" : `<button class="btn" data-ai-setup type="button">Set up</button>`}
      </li>
    </ol>`;
  const examples = ["Can a unit that Fell Back still shoot?", "How does Feel No Pain interact with mortal wounds?",
    "When can I use Fire Overwatch, and what do I hit on?", "My Character is leading a unit — who can the enemy target?"];
  return `<div class="card">
      <h2>Ask about any rule or situation</h2>
      <p>Answers come only from the PDFs in your library, with page references you can check.</p>
      ${hasDocs && hasAI ? `<div class="examples">${examples.map(e => `<button class="example" type="button" data-example="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : steps}
    </div>`;
}

function renderChat() {
  const inner = $("#chatInner");
  if (!state.messages.length) {
    inner.innerHTML = welcomeHTML();
  } else {
    const last = state.messages[state.messages.length - 1];
    inner.innerHTML = state.messages.map(m => m.role === "user"
      ? `<div class="bubble user">${esc(m.text)}</div>`
      : `<div class="bubble bot ${m.error ? "error" : ""}">${botBubbleHTML(m)}</div>`).join("");
    // Short answers by design; one tap gets the fuller explanation.
    if (last?.role === "bot" && !state.answering && !last.error && last.text && AI.ready && state.lastTurn) {
      inner.insertAdjacentHTML("beforeend", `<button class="example more-btn" type="button" data-example="Tell me more">More detail</button>`);
    }
  }
  $("#clearChat").disabled = !state.messages.length || state.answering;
  updateSendButton();
  const chat = $("#chat");
  chat.scrollTop = chat.scrollHeight;
}

function updateLastBubble() {
  const bubbles = $$(".bubble.bot", $("#chatInner"));
  const last = bubbles[bubbles.length - 1];
  const m = state.messages[state.messages.length - 1];
  if (!last || !m) return;
  const chat = $("#chat");
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  last.innerHTML = botBubbleHTML(m);
  if (atBottom) chat.scrollTop = chat.scrollHeight;
}

function updateSendButton() {
  $("#sendBtn").disabled = !$("#question").value.trim() || state.answering;
}

export { ask, renderChat, renderScope, scopeLabel, updateSendButton };
