// MAGI: three AI nodes, modelled on the MAGI supercomputers in Neon Genesis Evangelion.
// Each node has its own personality (they were built from the three sides of one person).
//
// ADMIN CONTROL (all saved in the magi_settings table, so it survives a restart):
//   mode      "verdict" = each node answers APPROVED or DENIED and the majority decides.
//             "discuss" = no yes or no at all. Each node gives an analysis and they talk it through.
//             "link"    = the three nodes assist each other in a chain. MELCHIOR drafts an answer,
//                         BALTHASAR reviews and improves it, CASPAR writes the final answer.
//                         In link mode "rounds" is ignored and there is no vote.
//   rounds    1, 2 or 3. The default is 1 (a quick single answer). The 3-round mode is switched on from the CONTROL panel.
//               Round 1: every node answers alone.
//               Round 2: the CONVINCING round (each node reads the others and argues to win them over),
//                        or a plain debate when "convince" is switched off.
//               Round 3: the FINAL round (each node hears every appeal and gives its closing position).
//   directive standing orders added to every node's instructions.
//   personas  the admin can rewrite any node's personality, or mute a node.
//   temperature  how creative the nodes are (0 to 1.5).
//   decree    on any single run the admin can force APPROVED or DENIED whatever the nodes voted (verdict mode).
//
// RUNS ARE BACKGROUND JOBS: POST /api/admin/magi starts a run and answers at once with a job id.
// The screen then asks GET /api/admin/magi/job/:id every second or so. So a slow model (Gemma, big reasoning
// models) never runs into a browser or proxy request limit. Jobs are kept in memory for 15 minutes.
//
// GEMINI IS STREAMED: a Gemini request only fails if no data arrives for MAGI_IDLE_MS (default 90 s) or the
// whole request passes MAGI_TIMEOUT_MS (default 180 s). A slow model that keeps producing text is not cut off.
//
// Majority rule: two matching verdicts decide. A node that fails, is muted or answers unclearly does not vote.
// Melchior = Google Gemini, Balthasar = Groq, Caspar = OpenRouter (any node can be linked to any provider). Admin only.
// Keys come from environment variables only.
// Providers: Gemini, Groq, OpenRouter, NVIDIA (build.nvidia.com, free key) and Cloudflare Workers AI (free daily allowance).
// Env vars: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
// Optional models: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL, MAGI_NVIDIA_MODEL, MAGI_CLOUDFLARE_MODEL.
// Optional: MAGI_THINKING=on keeps the providers' reasoning enabled (the default turns it off for speed).
// Optional: MAGI_TIMEOUT_MS, MAGI_IDLE_MS, MAGI_RUN_MS change the time limits (milliseconds).
// Without a database (pool is null) the settings and links only last until the server restarts.
const crypto = require('crypto');

const TIMEOUT = Number(process.env.MAGI_TIMEOUT_MS) || 180000;   // most one request may take in total
const IDLE_MS = Number(process.env.MAGI_IDLE_MS) || 90000;       // a Gemini stream with no data for this long is dead
const RUN_BUDGET = Number(process.env.MAGI_RUN_MS) || 600000;    // whole run (10 minutes); nodes still waiting then are reported as timed out
const MIN_CALL_MS = 3000;    // never start a request with less time than this
const ROUND_MIN_MS = 30000;  // do not start another round or link with less time than this
const JOB_KEEP_MS = 15 * 60 * 1000; // finished jobs are forgotten after this
const QUESTION_MAX = 4096;
// Reasoning models (Qwen on Groq, Nemotron, Gemini 3.5) spend output tokens on thinking before the visible answer.
// 1024 was often used up by the thinking alone, which left an empty or cut-off answer.
const MAX_OUT = 8192;
const GEMMA_OUT = 4096;
// Turn off the reasoning step on providers that support it, unless MAGI_THINKING=on.
const NO_THINK = process.env.MAGI_THINKING !== 'on';

const FORMAT_VERDICT = 'On the first line write exactly APPROVED or DENIED. Then give your reasoning in at most three sentences. Plain text only.';
const FORMAT_DISCUSS = 'Do not answer yes or no, and never use the words APPROVED or DENIED. On the first line write a headline of at most eight words that sums up your position. Then give your analysis in at most four sentences. Plain text only.';
const FORMAT_LINK = 'Do not answer yes or no, and never use the words APPROVED or DENIED. Write your answer in at most six sentences. Plain text only.';
const formatOf = (mode) => (mode === 'discuss' ? FORMAT_DISCUSS : mode === 'link' ? FORMAT_LINK : FORMAT_VERDICT);

// What each node is asked to do in rounds 2 and 3.
const INSTR = {
  debate: {
    verdict: 'Consider their reasoning. Keep your position if you still believe it, or change it if they convinced you.',
    discuss: 'Respond to their reasoning. Say where you agree and where you disagree, and sharpen your own view.',
  },
  convince: {
    verdict: 'This is the convincing round. Make the strongest honest case you can to win the others over: speak to them by name and go after the weakest point in their reasoning. You may change your own verdict if their case beats yours.',
    discuss: 'This is the convincing round. Make the strongest honest case you can to bring the others round to your view: speak to them by name and go after the weakest point in their reasoning. You may change your mind if their case beats yours.',
  },
  final: {
    verdict: 'This is the final round. Weigh the arguments made to you. Hold your verdict or change it. The vote is taken on what you write now.',
    discuss: 'This is the final round. Weigh the arguments made to you and state your closing position.',
  },
};

// What each node does in the link chain, by its position in the chain.
const LINK_TASK = [
  'You are the first link. Write a first draft answer to the question.',
  'You are the second link. Review the draft you were given. Check it for errors, harm and missing human considerations, then write an improved answer.',
  'You are the last link. Using the draft and the review you were given, write the final answer the question deserves. Make it clear and decisive.',
];

// Providers: one entry per AI service. "model" is the built-in default, overridable with the env var.
const PROVIDERS = {
  gemini: {
    id: 'gemini', label: 'Google Gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    model: () => process.env.MAGI_GEMINI_MODEL || 'gemini-3.5-flash-lite',
  },
  groq: {
    id: 'groq', label: 'Groq', keys: ['GROQ_API_KEY'],
    url: () => 'https://api.groq.com/openai/v1/chat/completions',
    model: () => process.env.MAGI_GROQ_MODEL || 'qwen/qwen3.8-27b',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', keys: ['OPENROUTER_API_KEY'],
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
    model: () => process.env.MAGI_OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
  },
  // NVIDIA NIM (OpenAI-compatible). Free key at build.nvidia.com, about 40 requests a minute.
  nvidia: {
    id: 'nvidia', label: 'NVIDIA', keys: ['NVIDIA_API_KEY'],
    url: () => 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: () => process.env.MAGI_NVIDIA_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  },
  // Cloudflare Workers AI (OpenAI-compatible). Needs an API token and your account id. Free allowance resets daily.
  cloudflare: {
    id: 'cloudflare', label: 'Cloudflare', keys: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'], need: 'CLOUDFLARE_ACCOUNT_ID',
    url: () => 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent((process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()) + '/ai/v1/chat/completions',
    model: () => process.env.MAGI_CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct',
  },
};

// Nodes: fixed id and role. "persona" is the built-in personality, which the admin can overwrite. "home" is the provider a node starts on.
const NODES = [
  {
    id: 'melchior', name: 'MELCHIOR-1', role: 'SCIENCE', home: 'gemini',
    persona: 'You are MELCHIOR-1, the rational, scientific node. You decide on evidence, logic and measurable outcomes. You distrust sentiment and want proof. You are sceptical of anything you cannot verify.',
  },
  {
    id: 'balthasar', name: 'BALTHASAR-2', role: 'MATERNAL', home: 'groq',
    persona: 'You are BALTHASAR-2, the protective, maternal node. You decide on the wellbeing and safety of people. You are cautious about harm to anyone, and you weigh the human cost first.',
  },
  {
    id: 'caspar', name: 'CASPAR-3', role: 'PERSONAL', home: 'openrouter',
    persona: 'You are CASPAR-3, the personal, intuitive node. You decide on conviction and what feels right in the situation. You are willing to stand against the others when you believe they are wrong.',
  },
];
const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n]));

// node id -> { provider, model } saved by the admin. Empty model means "the provider's default".
const links = new Map();

// ===== admin settings =====
const fresh = () => ({
  mode: 'verdict',
  rounds: 1,
  convince: true,
  temperature: 0.4,
  directive: '',
  nodes: Object.fromEntries(NODES.map((n) => [n.id, { persona: '', muted: false }])),
});
let settings = fresh();

const publicSettings = () => ({ mode: settings.mode, rounds: settings.rounds, convince: settings.convince, temperature: settings.temperature, directive: settings.directive });
const snapshot = () => JSON.parse(JSON.stringify(settings));

// Take any of the fields from an object (a request body or a saved copy), checking each one.
function applySettings(b) {
  if (!b || typeof b !== 'object') return;
  if (b.mode === 'verdict' || b.mode === 'discuss' || b.mode === 'link') settings.mode = b.mode;
  if (b.rounds != null) { const r = parseInt(b.rounds, 10); if (r >= 1 && r <= 3) settings.rounds = r; }
  if (b.convince != null) settings.convince = !!b.convince;
  if (b.temperature != null) { const t = Number(b.temperature); if (Number.isFinite(t)) settings.temperature = Math.min(1.5, Math.max(0, Math.round(t * 10) / 10)); }
  if (b.directive != null) settings.directive = String(b.directive).trim().slice(0, 1200);
  if (b.nodes && typeof b.nodes === 'object') {
    for (const n of NODES) {
      const x = b.nodes[n.id];
      if (!x || typeof x !== 'object') continue;
      if (x.persona != null) settings.nodes[n.id].persona = String(x.persona).trim().slice(0, 1500);
      if (x.muted != null) settings.nodes[n.id].muted = !!x.muted;
    }
  }
}

// A provider is ready only when its key (and, for Cloudflare, the account id) is set.
const hintOf = (p) => p.keys[0] + (p.need ? ' and ' + p.need : '');
const keyOf = (p) => { if (p.need && !(process.env[p.need] || '').trim()) return ''; for (const k of p.keys) { const v = (process.env[k] || '').trim(); if (v) return v; } return ''; };

// The provider and model a node is actually using right now.
function effective(n) {
  const link = links.get(n.id);
  const pid = link && PROVIDERS[link.provider] ? link.provider : n.home;
  const p = PROVIDERS[pid];
  return { node: n, provider: p, label: p.label, model: (link && link.model) || p.model(), key: keyOf(p) };
}

// The full instructions for one node: personality, then the admin's standing orders, then the round text, then the answer format.
const personaOf = (n, cfg) => (cfg.nodes[n.id] && cfg.nodes[n.id].persona) || n.persona;
function systemFor(n, cfg, extra) {
  let s = personaOf(n, cfg);
  if (cfg.directive) s += ' STANDING ORDERS FROM THE ADMINISTRATOR. Follow them in everything you write: ' + cfg.directive;
  if (extra) s += ' ' + extra;
  return s + ' ' + formatOf(cfg.mode);
}

// Remove a reasoning model's visible "thinking" (<think>...</think>), which would otherwise be read as the verdict line.
const stripThink = (t) => {
  let s = String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const i = s.lastIndexOf('</think>');
  if (i >= 0) s = s.slice(i + 8);
  return s.replace(/<think>[\s\S]*$/i, '').trim();
};

// Verdict = the first APPROVED or DENIED word on the first non-empty line (tolerates "Verdict: APPROVED", "**APPROVED**", etc.).
// If that line is only a short label such as "Verdict:", the next line is used. "NOT APPROVED" counts as DENIED and "NOT DENIED" as APPROVED.
const verdictOf = (t) => {
  const lines = String(t || '').split('\n').filter((l) => l.trim());
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    const up = lines[i].toUpperCase();
    const m = up.match(/\b(NOT\s+)?(APPROVED|DENIED)\b/);
    if (m) return m[1] ? (m[2] === 'APPROVED' ? 'DENIED' : 'APPROVED') : m[2];
    if (up.replace(/[^A-Z]/g, '').length > 20) break; // a real sentence with no verdict: stop looking
  }
  return 'UNCLEAR';
};

// A readable message from an API error body (the body can be a string, an object with message, or an object without one).
const errText = (d, status) => {
  if (d && Array.isArray(d.errors) && d.errors.length) return String(d.errors[0].message || JSON.stringify(d.errors[0])).slice(0, 200); // Cloudflare
  const e = d && d.error;
  if (e && typeof e === 'object') return String(e.message || (e.metadata && e.metadata.raw) || JSON.stringify(e)).slice(0, 200);
  return String(e || 'HTTP ' + status).slice(0, 200);
};

// "run" is the job a call belongs to. It carries the deadline for the whole run and a progress callback.
const noop = () => { };
const newRun = (budget) => ({ deadline: Date.now() + budget, round: 1, progress: noop });
// Time a single request may take: the per-request limit, but never past the end of the run.
const requestMs = (run) => Math.max(MIN_CALL_MS, Math.min(TIMEOUT, run.deadline - Date.now()));

// POST JSON. A rate limit (429) or a briefly unavailable server (503) is tried once more, but only if the run still has time.
async function postJson(url, headers, body, run) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(requestMs(run)) });
    if ((r.status === 429 || r.status === 503) && attempt === 0) {
      const wait = Math.min(4000, (Number(r.headers.get('retry-after')) || 1.5) * 1000);
      if (run.deadline - Date.now() > wait + MIN_CALL_MS) {
        await new Promise((ok) => setTimeout(ok, wait));
        continue;
      }
    }
    const d = await r.json().catch(() => ({}));
    return { r, d };
  }
}

// Gemini over a stream. The request only fails if no data arrives for IDLE_MS, or the total limit is passed.
async function streamGemini(model, key, body, run) {
  const ctl = new AbortController();
  let idle;
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(new Error('No data from Gemini for ' + Math.round(IDLE_MS / 1000) + 's')), IDLE_MS);
  };
  const total = requestMs(run);
  const hard = setTimeout(() => ctl.abort(new Error('Gemini took longer than ' + Math.round(total / 1000) + 's')), total);
  bump();
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse',
      { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }
    );
    if (!r.ok) return { r, d: await r.json().catch(() => ({})), text: '', finish: '', block: '' };
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', finish = '', block = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let j;
        try { j = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (j.error) throw new Error(errText(j, 500));
        if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
        const c = (j.candidates || [])[0];
        if (c) {
          if (c.finishReason) finish = c.finishReason;
          if (c.content) text += (c.content.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
        }
      }
    }
    return { r, d: {}, text, finish, block };
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
  }
}

// One call to one provider. system and user are plain strings. temp is optional (the saved creativity is used when it is left out).
async function callProvider(view, system, user, temp, run) {
  const { provider: p, key, model } = view;
  const temperature = temp == null ? settings.temperature : temp;
  if (p.id === 'gemini') {
    // Gemini 3-series uses thinkingLevel. Other models do not get a thinking setting at all.
    const thinking = NO_THINK && /gemini-3/i.test(model) ? { thinkingLevel: 'minimal' } : null;
    const isGemma = /gemma/i.test(model);

    // foldSystem puts the instructions at the start of the user message, for models that refuse a separate system instruction.
    const geminiCall = (thinkingConfig, foldSystem) => {
      const generationConfig = { temperature, maxOutputTokens: isGemma ? GEMMA_OUT : MAX_OUT };
      if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
      const body = {
        contents: [{ role: 'user', parts: [{ text: foldSystem ? system + '\n\n' + user : user }] }],
        generationConfig,
      };
      if (!foldSystem) body.systemInstruction = { parts: [{ text: system }] };
      return streamGemini(model, key, body, run);
    };

    let res = await geminiCall(thinking, false);
    if (!res.r.ok && (res.r.status === 429 || res.r.status === 503) && run.deadline - Date.now() > 8000) {
      await new Promise((ok) => setTimeout(ok, 3000));
      res = await geminiCall(thinking, false);
    }
    if (!res.r.ok && thinking && /thinking/i.test(errText(res.d, res.r.status))) {
      console.error('magi gemini: thinkingLevel rejected, retrying without it:', errText(res.d, res.r.status));
      res = await geminiCall(null, false);
    }
    if (!res.r.ok && /instruction/i.test(errText(res.d, res.r.status))) {
      console.error('magi gemini: system instruction rejected, folding it into the message:', errText(res.d, res.r.status));
      res = await geminiCall(null, true);
    }
    if (!res.r.ok) throw new Error(errText(res.d, res.r.status));
    if (!res.text.trim() && res.block) throw new Error('Blocked by Gemini: ' + res.block);
    if (!res.text.trim() && res.finish === 'MAX_TOKENS') throw new Error('Ran out of tokens while thinking');
    return stripThink(res.text);
  }
  const url = p.url();
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
  if (p.id === 'openrouter') headers['X-Title'] = 'MAGI';
  const body = {
    model, temperature, max_tokens: MAX_OUT,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (NO_THINK) {
    if (p.id === 'groq') body.reasoning_effort = 'none';
    if (p.id === 'openrouter') body.reasoning = { enabled: false };
  }
  const { r, d } = await postJson(url, headers, body, run);
  if (!r.ok) throw new Error(errText(d, r.status));
  const ch = d.choices && d.choices[0];
  if (d.error) throw new Error(errText(d, r.status)); // OpenRouter can answer 200 with an error body
  const text = stripThink((ch && ch.message && ch.message.content) || '');
  if (!text && ch && ch.finish_reason === 'length') throw new Error('Ran out of tokens while thinking');
  return text;
}

// In discuss and link modes nobody votes, so the "verdict" is the neutral word OPEN.
function shape(view, text, started, mode, round, kind) {
  return {
    id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: true,
    verdict: mode === 'verdict' ? verdictOf(text) : 'OPEN',
    text: String(text).trim().slice(0, 1500), ms: Date.now() - started, round, kind,
  };
}

function failed(view, error, started) {
  return { id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: false, error: String(error || 'no answer').slice(0, 200), ms: Date.now() - started };
}

// Stop waiting for a step at the run's deadline. The fallback is used for any node still pending then.
function untilDeadline(work, fallback, run) {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback()), Math.max(0, run.deadline - Date.now()));
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

// Round 1: the node answers alone.
async function round1(n, question, cfg, run) {
  const v = effective(n), started = Date.now();
  if (cfg.nodes[n.id].muted) return failed(v, 'Muted by the administrator', started);
  if (!v.key) return failed(v, 'Not set up: add ' + hintOf(v.provider) + ' on the server', started);
  try {
    const text = await callProvider(v, systemFor(n, cfg, ''), question, cfg.temperature, run);
    if (!String(text).trim()) return failed(v, 'Empty answer from ' + v.label, started);
    return shape(v, text, started, cfg.mode, 1, 'independent');
  } catch (e) {
    const msg = (e && e.message) || e;
    console.error('magi round 1', n.id, msg);
    return failed(v, msg, started);
  }
}

// Rounds 2 and 3: the node reads where the others stand. kind is "debate", "convince" or "final".
async function step(n, question, mine, others, kind, round, total, cfg, run) {
  const v = effective(n), started = Date.now(), withVerdict = cfg.mode === 'verdict';
  const said = (o) => (withVerdict ? o.verdict + '. ' : '') + o.text;
  const lines = others.map((o) => o.name + ' (' + o.role + '): ' + said(o)).join('\n\n');
  const user = 'Question: ' + question + '\n\nYour position so far: ' + said(mine) + '\n\nThe other nodes said:\n\n' + lines +
    '\n\n' + INSTR[kind][cfg.mode] + ' ' + formatOf(cfg.mode);
  try {
    const text = await callProvider(v, systemFor(n, cfg, 'This is round ' + round + ' of ' + total + '.'), user, cfg.temperature, run);
    if (!String(text).trim()) throw new Error('empty');
    return shape(v, text, started, cfg.mode, round, kind);
  } catch (e) {
    // If a later round fails, the node keeps what it said before. Log why, so a slow or broken node is visible.
    console.error('magi round', round, n.id, (e && e.message) || e);
    return { ...mine };
  }
}

// Link mode: the three nodes run in a chain. Each one reads the work so far and builds on it.
async function linkStep(n, question, prior, index, cfg, run) {
  const v = effective(n), started = Date.now();
  if (cfg.nodes[n.id].muted) return { result: failed(v, 'Muted by the administrator', started), raw: '' };
  if (!v.key) return { result: failed(v, 'Not set up: add ' + hintOf(v.provider) + ' on the server', started), raw: '' };
  const user = 'Question: ' + question +
    (prior ? '\n\nWork so far from the previous link:\n' + prior : '') +
    '\n\n' + LINK_TASK[index];
  try {
    const text = await callProvider(v, systemFor(n, cfg, 'You are link ' + (index + 1) + ' of 3 in a chain where the AIs assist each other.'), user, cfg.temperature, run);
    if (!String(text).trim()) throw new Error('Empty answer from ' + v.label);
    return { result: shape(v, text, started, cfg.mode, index + 1, 'chain'), raw: String(text).trim() };
  } catch (e) {
    const msg = (e && e.message) || e;
    console.error('magi link', index + 1, n.id, msg);
    return { result: failed(v, msg, started), raw: '' };
  }
}

async function deliberateLink(question, cfg, run) {
  const results = [];
  let prior = '';
  for (let i = 0; i < NODES.length; i++) {
    const n = NODES[i];
    run.round = i + 1;
    if (i > 0 && run.deadline - Date.now() < ROUND_MIN_MS) {
      const r = failed(effective(n), 'Skipped: time limit reached', Date.now());
      results.push(r);
      run.progress(n.id, { state: 'failed', round: i + 1 });
      continue;
    }
    run.progress(n.id, { state: 'thinking', round: i + 1 });
    const { result, raw } = await untilDeadline(
      linkStep(n, question, prior, i, cfg, run),
      () => { console.error('magi link', i + 1, n.id, 'no answer before the time limit'); return { result: failed(effective(n), 'No answer before the time limit', Date.now()), raw: '' }; },
      run
    );
    results.push(result);
    run.progress(n.id, { state: result.ok ? 'done' : 'failed', round: i + 1, ms: result.ms });
    if (raw) prior = raw; // a failed link passes on the last good work unchanged
  }
  return { results, finalText: prior };
}

async function deliberate(question, cfg, run) {
  const total = cfg.rounds;
  run.round = 1;
  let cur = await Promise.all(NODES.map(async (n) => {
    run.progress(n.id, { state: 'thinking', round: 1 });
    const r = await untilDeadline(
      round1(n, question, cfg, run),
      () => { console.error('magi round 1', n.id, 'no answer before the time limit'); return failed(effective(n), 'No answer before the time limit', Date.now()); },
      run
    );
    run.progress(n.id, { state: r.ok ? 'done' : 'failed', round: 1, ms: r.ms });
    return r;
  }));
  const spent = cur.map((r) => r.ms || 0);
  const hist = cur.map((r) => (r.ok ? [{ round: 1, kind: r.kind, verdict: r.verdict, text: r.text }] : []));

  for (let rd = 2; rd <= total; rd++) {
    if (run.deadline - Date.now() < ROUND_MIN_MS) break; // not enough time left: keep the answers so far
    run.round = rd;
    const kind = rd === 2 ? (cfg.convince ? 'convince' : 'debate') : 'final';
    const prev = cur;
    cur = await Promise.all(NODES.map(async (n, i) => {
      const mine = prev[i];
      if (!mine.ok) return mine;
      const others = prev.filter((o, j) => j !== i && o.ok);
      if (!others.length) return mine;
      run.progress(n.id, { state: 'thinking', round: rd });
      const r = await untilDeadline(
        step(n, question, mine, others, kind, rd, total, cfg, run),
        () => ({ ...mine }),
        run
      );
      run.progress(n.id, { state: 'done', round: rd, ms: r.ms });
      return r;
    }));
    cur.forEach((r, i) => {
      if (!r.ok) return;
      if (r.round === rd && prev[i] !== r) { hist[i].push({ round: rd, kind: r.kind, verdict: r.verdict, text: r.text }); spent[i] += r.ms || 0; }
    });
  }

  return cur.map((r, i) => {
    if (!r.ok) return { ...r, initial: null, revised: false, history: [] };
    const first = hist[i][0];
    return {
      ...r, ms: spent[i], initial: first ? first.verdict : r.verdict,
      revised: cfg.mode === 'verdict' && !!first && first.verdict !== r.verdict,
      history: hist[i],
    };
  });
}

// The vote. In discuss mode there is no vote. In link mode the result is the chain's final answer.
// A decree from the admin replaces the vote (verdict mode only).
function tally(results, cfg, override) {
  const ok = results.filter((r) => r.ok);
  if (cfg.mode === 'link') {
    return { decision: ok.length ? 'LINKED' : 'NO ANSWER', approved: 0, denied: 0, responded: ok.length, mode: 'link', rounds: NODES.length };
  }
  if (cfg.mode === 'discuss') {
    return { decision: ok.length ? 'DISCUSSED' : 'NO CONSENSUS', approved: 0, denied: 0, responded: ok.length, mode: 'discuss', rounds: cfg.rounds };
  }
  const approved = ok.filter((r) => r.verdict === 'APPROVED').length;
  const denied = ok.filter((r) => r.verdict === 'DENIED').length;
  const vote = approved >= 2 ? 'APPROVED' : denied >= 2 ? 'DENIED' : 'NO CONSENSUS';
  const forced = override === 'APPROVED' || override === 'DENIED' ? override : '';
  return { decision: forced || vote, vote, overridden: !!forced, approved, denied, responded: ok.length, mode: 'verdict', rounds: cfg.rounds };
}

// What the admin screen shows for one node.
function nodeView(n) {
  const v = effective(n), s = settings.nodes[n.id];
  return {
    id: n.id, name: n.name, role: n.role,
    provider: v.label, provider_id: v.provider.id,
    model: v.model, default_model: v.provider.model(),
    persona: s.persona, default_persona: n.persona, muted: !!s.muted,
    enabled: !!v.key && !s.muted,
  };
}

// ===== background jobs =====
const jobs = new Map();

function startJob(question, cfg, override) {
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    cfg, started: Date.now(), finished: 0,
    deadline: Date.now() + RUN_BUDGET,
    status: 'running', round: 1, error: '', result: null,
    nodes: Object.fromEntries(NODES.map((n) => [n.id, { state: 'waiting' }])),
  };
  job.progress = (id, patch) => { if (job.nodes[id]) Object.assign(job.nodes[id], patch); };
  jobs.set(job.id, job);

  (async () => {
    try {
      if (cfg.mode === 'link') {
        const { results, finalText } = await deliberateLink(question, cfg, job);
        job.result = { question, results, final: finalText, ...tally(results, cfg, '') };
      } else {
        const results = await deliberate(question, cfg, job);
        job.result = { question, results, ...tally(results, cfg, override) };
      }
      job.status = 'done';
    } catch (e) {
      console.error('magi job', job.id, (e && e.message) || e);
      job.status = 'error';
      job.error = String((e && e.message) || e).slice(0, 200);
    } finally {
      job.finished = Date.now();
    }
  })();
  return job;
}

function jobView(j) {
  return {
    id: j.id, status: j.status, mode: j.cfg.mode,
    rounds: j.cfg.mode === 'link' ? NODES.length : j.cfg.rounds,
    round: j.round, nodes: j.nodes, elapsed: Date.now() - j.started,
    result: j.status === 'done' ? j.result : undefined,
    error: j.status === 'error' ? j.error : undefined,
  };
}

// Forget old jobs so memory does not grow.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - (j.finished || j.started) > JOB_KEEP_MS) jobs.delete(id);
}, 60000).unref();

module.exports = function mount(app, { pool, auth, admin, wrap }) {
  // Load saved node links and settings from the database, if there is one.
  const ready = (async () => {
    if (!pool) return;
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS magi_links (node TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '')`);
      const r = await pool.query('SELECT node, provider, model FROM magi_links');
      for (const x of r.rows) if (NODE_BY_ID[x.node] && PROVIDERS[x.provider]) links.set(x.node, { provider: x.provider, model: x.model || '' });
    } catch (e) { console.error('magi links init:', e.message); }
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS magi_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
      const r = await pool.query("SELECT v FROM magi_settings WHERE k = 'main'");
      if (r.rows[0]) applySettings(JSON.parse(r.rows[0].v));
    } catch (e) { console.error('magi settings init:', e.message); }
  })();

  const persist = () => (pool
    ? pool.query(
      "INSERT INTO magi_settings (k, v) VALUES ('main', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [JSON.stringify(settings)]
    ).catch((e) => console.error('magi settings save:', e.message))
    : Promise.resolve());

  app.get('/api/admin/magi/status', auth, admin, wrap(async (req, res) => {
    await ready;
    res.json({
      nodes: NODES.map(nodeView),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, ready: !!keyOf(p), model: p.model() })),
      settings: publicSettings(),
      quorum: 2,
    });
  }));

  // Change how the nodes act: mode, rounds, convincing round, creativity, standing orders, personalities, muting.
  // Send only the fields that change, or { reset: true } to put everything back to the defaults.
  app.post('/api/admin/magi/settings', auth, admin, wrap(async (req, res) => {
    await ready;
    const b = req.body || {};
    if (b.reset) settings = fresh();
    else applySettings(b);
    await persist();
    res.json({ settings: publicSettings(), nodes: NODES.map(nodeView) });
  }));

  // Save a node's provider and model, or reset it to its built-in link.
  app.post('/api/admin/magi/node', auth, admin, wrap(async (req, res) => {
    await ready;
    const body = req.body || {};
    const n = NODE_BY_ID[String(body.node || '')];
    if (!n) return res.status(400).json({ error: 'Unknown node.' });

    if (body.reset) {
      links.delete(n.id);
      if (pool) await pool.query('DELETE FROM magi_links WHERE node = $1', [n.id]).catch((e) => console.error('magi reset:', e.message));
      return res.json({ node: nodeView(n) });
    }

    const pid = String(body.provider || '');
    const model = String(body.model || '').trim().slice(0, 120);
    const p = PROVIDERS[pid];
    if (!p) return res.status(400).json({ error: 'Unknown provider.' });
    if (!keyOf(p)) return res.status(400).json({ error: 'Not set up: add ' + hintOf(p) + ' on the server for ' + p.label + '.' });

    links.set(n.id, { provider: pid, model });
    if (pool) {
      await pool.query(
        'INSERT INTO magi_links (node, provider, model) VALUES ($1, $2, $3) ON CONFLICT (node) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model',
        [n.id, pid, model]
      ).catch((e) => console.error('magi save:', e.message));
    }
    res.json({ node: nodeView(n) });
  }));

  // Send one short question to a node to check its link.
  app.post('/api/admin/magi/test', auth, admin, wrap(async (req, res) => {
    await ready;
    const n = NODE_BY_ID[String((req.body || {}).node || '')];
    if (!n) return res.status(400).json({ error: 'Unknown node.' });
    const v = effective(n), started = Date.now();
    if (!v.key) return res.json({ ok: false, error: 'Not set up: add ' + hintOf(v.provider) + ' on the server', model: v.model });
    const run = newRun(TIMEOUT);
    try {
      const text = await callProvider(v, 'Reply with the single word APPROVED and nothing else.', 'Test.', null, run);
      if (!String(text).trim()) return res.json({ ok: false, error: 'Empty answer', model: v.model, ms: Date.now() - started });
      res.json({ ok: true, model: v.model, ms: Date.now() - started });
    } catch (e) {
      res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200), model: v.model, ms: Date.now() - started });
    }
  }));

  // Start a run. It answers at once with { job } and carries on in the background.
  // Optional "override": "APPROVED" or "DENIED" is the admin's decree and replaces the vote (verdict mode only).
  app.post('/api/admin/magi', auth, admin, wrap(async (req, res) => {
    await ready;
    const body = req.body || {};
    const question = String(body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });
    if (question.length > QUESTION_MAX) return res.status(400).json({ error: 'Question is too long (max ' + QUESTION_MAX + ' characters).' });
    const cfg = snapshot(); // settings are frozen for the whole run, so a change mid-run cannot mix two setups
    const override = cfg.mode === 'verdict' ? String(body.override || '').toUpperCase() : '';
    const job = startJob(question, cfg, override);
    res.json({ job: job.id, mode: cfg.mode, rounds: cfg.mode === 'link' ? NODES.length : cfg.rounds });
  }));

  // Progress of a run. When status is "done", "result" holds the results, the decision, and "final" in link mode.
  app.get('/api/admin/magi/job/:id', auth, admin, wrap(async (req, res) => {
    const j = jobs.get(String(req.params.id || ''));
    if (!j) return res.status(404).json({ error: 'That run was not found. It may have expired.' });
    res.json(jobView(j));
  }));
};
