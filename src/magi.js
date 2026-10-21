// MAGI: three AI nodes, modelled on the MAGI supercomputers in Neon Genesis Evangelion.
// Each node has its own personality (they were built from the three sides of one person).
//
// ADMIN CONTROL (all saved in the magi_settings table, so it survives a restart):
//   mode      "verdict" = each node answers APPROVED or DENIED and the majority decides.
//             "discuss" = no yes or no at all. Each node gives an analysis and they talk it through.
//             "link"    = the nodes work as a chain: Melchior drafts, Balthasar reviews, Casper writes the final answer.
//   linkOut   only used in link mode. How the chain ends:
//               "verdict" = every link answers APPROVED or DENIED and the LAST link's verdict is the decision (no majority vote).
//               "discuss" = no yes or no, the chain builds one analysis.
//   rounds    1, 2 or 3. The default is 1 (a quick single answer). The 3-round mode is switched on from the CONTROL panel.
//             Rounds do not apply in link mode (the chain has its own three links).
//               Round 1: every node answers alone.
//               Round 2: the CONVINCING round (each node reads the others and argues to win them over),
//                        or a plain debate when "convince" is switched off.
//               Round 3: the FINAL round (each node hears every appeal and gives its closing position).
//   directive standing orders added to every node's instructions.
//   personas  the admin can rewrite any node's personality, or mute a node.
//   temperature  how creative the nodes are (0 to 1.5).
//   decree    on any single run the admin can force APPROVED or DENIED whatever the nodes said
//             (verdict mode, and link mode when it ends with a verdict).
//   history   the last 50 runs are saved (magi_history table, or in memory without a database).
//             The console can list them, replay one, or clear them.
//
// Majority rule (verdict mode): two matching verdicts decide. A node that fails, is muted or answers unclearly does not vote.
// Link mode: nodes run one after another. A muted, unready or failed node is skipped and the chain carries on.
// Melchior = Google Gemini, Balthasar = Groq, Caspar = OpenRouter (any node can be linked to any provider). Admin only.
// Keys come from environment variables only.
// Providers: Gemini, Groq, OpenRouter, NVIDIA (build.nvidia.com, free key) and Cloudflare Workers AI (free daily allowance).
// Env vars: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
// Optional models: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL, MAGI_NVIDIA_MODEL, MAGI_CLOUDFLARE_MODEL.
// Optional: MAGI_THINKING=on keeps the providers' reasoning enabled (the default turns it off for speed).
// Without a database (pool is null) the settings, links and history only last until the server restarts.
const TIMEOUT = 45000;       // longest wait for a single provider call
const RUN_BUDGET = 60000;    // longest total time for one whole run; keep below the browser/proxy limit
const MIN_CALL_MS = 5000;    // never start a call with less time than this
const ROUND_MIN_MS = 20000;  // do not start another round with less time than this
const QUESTION_MAX = 4096;
// Reasoning models (Qwen on Groq, Nemotron, Gemini 3.5) spend output tokens on thinking before the visible answer.
// 1024 was often used up by the thinking alone, which left an empty or cut-off answer.
const MAX_OUT = 8192;
// Turn off the reasoning step on providers that support it, unless MAGI_THINKING=on.
const NO_THINK = process.env.MAGI_THINKING !== 'on';
let runDeadline = 0; // set at the start of each run

const FORMAT_VERDICT = 'On the first line write exactly APPROVED or DENIED. Then give your reasoning in at most three sentences. Plain text only.';
const FORMAT_DISCUSS = 'Do not answer yes or no, and never use the words APPROVED or DENIED. On the first line write a headline of at most eight words that sums up your position. Then give your analysis in at most four sentences. Plain text only.';
const formatOf = (mode) => (mode === 'discuss' ? FORMAT_DISCUSS : FORMAT_VERDICT);

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

// What each link of the chain is asked to do in link mode (the first link just answers the question).
const LINK_INSTR = {
  review: {
    verdict: 'You are a middle link in a chain. Check the reasoning above, fix mistakes and add what is missing. Keep the verdict or change it.',
    discuss: 'You are a middle link in a chain. Check the analysis above, fix mistakes and add what is missing, then give your improved analysis.',
  },
  final: {
    verdict: 'You are the last link in the chain. Weigh everything above and give the final ruling. The decision is taken on what you write now.',
    discuss: 'You are the last link in the chain. Pull everything above together into one closing analysis.',
  },
};

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
// The order of this list is also the order of the chain in link mode.
const NODES = [
  {
    id: 'melchior', name: 'MELCHIOR-1', role: 'SCIENTIST', home: 'gemini',
    persona: 'You are MELCHIOR-1, the rational, scientific node. You decide on evidence, logic and measurable outcomes. You distrust sentiment and want proof. You are sceptical of anything you cannot verify.',
  },
  {
    id: 'balthasar', name: 'BALTHASAR-2', role: 'REALIST', home: 'groq',
    persona: 'You are BALTHASAR-2, the protective, maternal node. You decide on the wellbeing and safety of people. You are cautious about harm to anyone, and you weigh the human cost first.',
  },
  {
    id: 'caspar', name: 'CASPAR-3', role: 'HUMAN', home: 'openrouter',
    persona: 'You are CASPAR-3, the personal, intuitive node. You decide on conviction and what feels right in the situation. You are willing to stand against the others when you believe they are wrong.',
  },
];
const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n]));

// node id -> { provider, model } saved by the admin. Empty model means "the provider's default".
const links = new Map();

// ===== admin settings =====
const fresh = () => ({
  mode: 'verdict',
  linkOut: 'verdict',   // link mode ends with: 'verdict' or 'discuss'
  rounds: 1,
  convince: true,
  temperature: 0.4,
  directive: '',
  nodes: Object.fromEntries(NODES.map((n) => [n.id, { persona: '', muted: false }])),
});
let settings = fresh();

const publicSettings = () => ({ mode: settings.mode, linkOut: settings.linkOut, rounds: settings.rounds, convince: settings.convince, temperature: settings.temperature, directive: settings.directive });
const snapshot = () => JSON.parse(JSON.stringify(settings));

// Take any of the fields from an object (a request body or a saved copy), checking each one.
function applySettings(b) {
  if (!b || typeof b !== 'object') return;
  if (b.mode === 'verdict' || b.mode === 'discuss' || b.mode === 'link') settings.mode = b.mode;
  if (b.linkOut === 'verdict' || b.linkOut === 'discuss') settings.linkOut = b.linkOut;
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

// The answer style a run uses: in link mode it follows linkOut (verdict or discuss), otherwise it is the mode itself.
const outModeOf = (cfg) => (cfg.mode === 'link' ? cfg.linkOut : cfg.mode);

// The full instructions for one node: personality, then the admin's standing orders, then the round text, then the answer format.
const personaOf = (n, cfg) => (cfg.nodes[n.id] && cfg.nodes[n.id].persona) || n.persona;
function systemFor(n, cfg, extra) {
  let s = personaOf(n, cfg);
  if (cfg.directive) s += ' STANDING ORDERS FROM THE ADMINISTRATOR. Follow them in everything you write: ' + cfg.directive;
  if (extra) s += ' ' + extra;
  return s + ' ' + formatOf(outModeOf(cfg));
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

// POST JSON. A rate limit (429) or a briefly unavailable server (503) is tried once more, since the free tiers hit those often.
// ms is the longest this one request may wait.
async function postJson(url, headers, body, ms = TIMEOUT) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    if ((r.status === 429 || r.status === 503) && attempt === 0) {
      const wait = Math.min(4000, (Number(r.headers.get('retry-after')) || 1.5) * 1000);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    const d = await r.json().catch(() => ({}));
    return { r, d };
  }
}

// One call to one provider. system and user are plain strings. temp is optional (the saved creativity is used when it is left out).
// Each call is capped by what is left of the run's time budget.
async function callProvider(view, system, user, temp) {
  const { provider: p, key, model } = view;
  const temperature = temp == null ? settings.temperature : temp;
  const ms = Math.max(MIN_CALL_MS, Math.min(TIMEOUT, runDeadline - Date.now()));
  if (p.id === 'gemini') {
    // Gemini 3-series uses thinkingLevel. Older models do not accept thinkingBudget here,
    // so the setting is only sent to Gemini 3 models.
    const thinking = NO_THINK && /gemini-3/i.test(model) ? { thinkingLevel: 'minimal' } : null;

    const geminiCall = (thinkingConfig) => {
      const generationConfig = { temperature, maxOutputTokens: MAX_OUT };
      if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
      return postJson(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        { 'x-goog-api-key': key, 'content-type': 'application/json' },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig,
        },
        ms
      );
    };

    let res = await geminiCall(thinking);
    if (!res.r.ok && thinking && /thinking/i.test(errText(res.d, res.r.status))) {
      console.error('magi gemini: thinkingLevel rejected, retrying without it:', errText(res.d, res.r.status));
      res = await geminiCall(null);
    }
    const { r, d } = res;
    if (!r.ok) throw new Error(errText(d, r.status));
    const c = (d.candidates || [])[0];
    const text = c && c.content ? (c.content.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('') : '';
    if (!text.trim() && d.promptFeedback && d.promptFeedback.blockReason) throw new Error('Blocked by Gemini: ' + d.promptFeedback.blockReason);
    if (!text.trim() && c && c.finishReason === 'MAX_TOKENS') throw new Error('Ran out of tokens while thinking');
    return stripThink(text);
  }
  const url = p.url();
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
  if (p.id === 'openrouter') headers['X-Title'] = 'MAGI';
  const body = {
    model, temperature, max_tokens: MAX_OUT,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (NO_THINK) {
    if (p.id === 'groq') body.reasoning_effort = 'medium';
    if (p.id === 'openrouter') body.reasoning = { enabled: false };
  }
  const { r, d } = await postJson(url, headers, body, ms);
  if (!r.ok) throw new Error(errText(d, r.status));
  const ch = d.choices && d.choices[0];
  if (d.error) throw new Error(errText(d, r.status)); // OpenRouter can answer 200 with an error body
  const text = stripThink((ch && ch.message && ch.message.content) || '');
  if (!text && ch && ch.finish_reason === 'length') throw new Error('Ran out of tokens while thinking');
  return text;
}

// In discuss mode nobody votes, so the "verdict" is the neutral word OPEN.
function shape(view, text, started, mode, round, kind) {
  return {
    id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: true,
    verdict: mode === 'discuss' ? 'OPEN' : verdictOf(text),
    text: String(text).trim().slice(0, 1500), ms: Date.now() - started, round, kind,
  };
}

function failed(view, error, started) {
  return { id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: false, error: String(error || 'no answer').slice(0, 200), ms: Date.now() - started };
}

// Round 1: the node answers alone.
async function round1(n, question, cfg) {
  const v = effective(n), started = Date.now();
  if (cfg.nodes[n.id].muted) return failed(v, 'Muted by the administrator', started);
  if (!v.key) return failed(v, 'Not set up: add ' + hintOf(v.provider) + ' on the server', started);
  try {
    const text = await callProvider(v, systemFor(n, cfg, ''), question, cfg.temperature);
    if (!String(text).trim()) return failed(v, 'Empty answer from ' + v.label, started);
    return shape(v, text, started, cfg.mode, 1, 'independent');
  } catch (e) {
    return failed(v, (e && e.message) || e, started);
  }
}

// Rounds 2 and 3: the node reads where the others stand. kind is "debate", "convince" or "final".
async function step(n, question, mine, others, kind, round, total, cfg) {
  const v = effective(n), started = Date.now(), withVerdict = cfg.mode === 'verdict';
  const said = (o) => (withVerdict ? o.verdict + '. ' : '') + o.text;
  const lines = others.map((o) => o.name + ' (' + o.role + '): ' + said(o)).join('\n\n');
  const user = 'Question: ' + question + '\n\nYour position so far: ' + said(mine) + '\n\nThe other nodes said:\n\n' + lines +
    '\n\n' + INSTR[kind][cfg.mode] + ' ' + formatOf(cfg.mode);
  try {
    const text = await callProvider(v, systemFor(n, cfg, 'This is round ' + round + ' of ' + total + '.'), user, cfg.temperature);
    if (!String(text).trim()) throw new Error('empty');
    return shape(v, text, started, cfg.mode, round, kind);
  } catch (e) {
    // If a later round fails, the node keeps what it said before. Log why, so a slow or broken node is visible.
    console.error('magi round', round, n.id, (e && e.message) || e);
    return { ...mine };
  }
}

async function deliberate(question, cfg) {
  runDeadline = Date.now() + RUN_BUDGET;
  const total = cfg.rounds;
  let cur = await Promise.all(NODES.map((n) => round1(n, question, cfg)));
  const spent = cur.map((r) => r.ms || 0);
  const hist = cur.map((r) => (r.ok ? [{ round: 1, kind: r.kind, verdict: r.verdict, text: r.text }] : []));

  for (let rd = 2; rd <= total; rd++) {
    if (runDeadline - Date.now() < ROUND_MIN_MS) break; // not enough time left: keep the answers so far
    const kind = rd === 2 ? (cfg.convince ? 'convince' : 'debate') : 'final';
    const prev = cur;
    cur = await Promise.all(NODES.map((n, i) => {
      const mine = prev[i];
      if (!mine.ok) return Promise.resolve(mine);
      const others = prev.filter((o, j) => j !== i && o.ok);
      if (!others.length) return Promise.resolve(mine);
      return step(n, question, mine, others, kind, rd, total, cfg);
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

// Link mode: the nodes run one after another (Melchior, Balthasar, Casper), each building on the one before.
// The first link drafts, the middle link reviews, the last usable link gives the final answer.
// Muted, unready or failed nodes are skipped and the chain carries on.
async function linkChain(question, cfg) {
  runDeadline = Date.now() + RUN_BUDGET;
  const out = outModeOf(cfg);
  const usable = NODES.filter((n) => !cfg.nodes[n.id].muted && effective(n).key);
  const lastId = usable.length ? usable[usable.length - 1].id : '';
  const chain = [], results = [];

  for (const n of NODES) {
    const v = effective(n), started = Date.now();
    if (cfg.nodes[n.id].muted) { results.push(failed(v, 'Muted by the administrator', started)); continue; }
    if (!v.key) { results.push(failed(v, 'Not set up: add ' + hintOf(v.provider) + ' on the server', started)); continue; }
    if (runDeadline - Date.now() < MIN_CALL_MS) { results.push(failed(v, 'Out of time', started)); continue; }

    const kind = !chain.length ? 'draft' : n.id === lastId ? 'final' : 'review';
    let user = question;
    if (chain.length) {
      const said = (o) => (out === 'verdict' ? o.verdict + '. ' : '') + o.text;
      user = 'Question: ' + question + '\n\nThe chain so far:\n\n' +
        chain.map((o) => o.name + ' (' + o.role + '): ' + said(o)).join('\n\n') +
        '\n\n' + LINK_INSTR[kind][out] + ' ' + formatOf(out);
    }
    try {
      const text = await callProvider(v, systemFor(n, cfg, 'You are link ' + (chain.length + 1) + ' of a chain of ' + usable.length + ' nodes.'), user, cfg.temperature);
      if (!String(text).trim()) throw new Error('Empty answer from ' + v.label);
      const r = shape(v, text, started, out, chain.length + 1, kind);
      chain.push(r);
      results.push({ ...r, initial: r.verdict, revised: false, history: [] });
    } catch (e) {
      console.error('magi link', n.id, (e && e.message) || e);
      results.push(failed(v, (e && e.message) || e, started));
    }
  }
  return results;
}

// The vote. In discuss mode there is no vote. A decree from the admin replaces the vote (verdict mode only).
// In link mode there is no majority: the last link that answered decides (or, when the chain ends in a discussion, nobody decides).
function tally(results, cfg, override) {
  const ok = results.filter((r) => r.ok);
  if (cfg.mode === 'link') {
    const fin = ok[ok.length - 1];
    const approved = ok.filter((r) => r.verdict === 'APPROVED').length;
    const denied = ok.filter((r) => r.verdict === 'DENIED').length;
    const base = { mode: 'link', linkOut: cfg.linkOut, rounds: 3, responded: ok.length, approved, denied, final: fin ? fin.text : '' };
    if (!fin) return { ...base, decision: 'NO ANSWER' };
    if (cfg.linkOut === 'discuss') return { ...base, decision: 'LINKED' };
    const forced = override === 'APPROVED' || override === 'DENIED' ? override : '';
    const vote = fin.verdict === 'APPROVED' || fin.verdict === 'DENIED' ? fin.verdict : 'NO CONSENSUS';
    return { ...base, decision: forced || vote, vote, overridden: !!forced };
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

  // ===== run history (last 50). With no database it lives in memory until the server restarts =====
  const HIST_MAX = 50;
  const memHist = [];
  let memId = 0;
  const histReady = (async () => {
    if (!pool) return;
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS magi_history (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), question TEXT NOT NULL, mode TEXT NOT NULL, decision TEXT NOT NULL, payload TEXT NOT NULL)`);
    } catch (e) { console.error('magi history init:', e.message); }
  })();

  async function histSave(run) {
    const slim = { ...run, results: (run.results || []).map((r) => ({ ...r, history: (r.history || []).slice(0, 3) })) };
    if (!pool) {
      memHist.unshift({ id: ++memId, ts: new Date().toISOString(), question: run.question, mode: run.mode, decision: run.decision, payload: slim });
      memHist.length = Math.min(memHist.length, HIST_MAX);
      return;
    }
    await histReady;
    await pool.query(
      'INSERT INTO magi_history (question, mode, decision, payload) VALUES ($1, $2, $3, $4)',
      [run.question.slice(0, QUESTION_MAX), run.mode, run.decision, JSON.stringify(slim)]
    );
    await pool.query('DELETE FROM magi_history WHERE id NOT IN (SELECT id FROM magi_history ORDER BY id DESC LIMIT $1)', [HIST_MAX]);
  }

  app.get('/api/admin/magi/history', auth, admin, wrap(async (req, res) => {
    if (!pool) return res.json({ items: memHist.map(({ payload, ...m }) => m) });
    await histReady;
    const r = await pool.query('SELECT id, ts, question, mode, decision FROM magi_history ORDER BY id DESC LIMIT $1', [HIST_MAX]);
    res.json({ items: r.rows });
  }));

  app.get('/api/admin/magi/history/:id', auth, admin, wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    if (!pool) {
      const m = memHist.find((x) => x.id === id);
      return m ? res.json({ run: m.payload }) : res.status(404).json({ error: 'Not found.' });
    }
    await histReady;
    const r = await pool.query('SELECT payload FROM magi_history WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found.' });
    res.json({ run: JSON.parse(r.rows[0].payload) });
  }));

  app.delete('/api/admin/magi/history', auth, admin, wrap(async (req, res) => {
    memHist.length = 0;
    if (pool) { await histReady; await pool.query('DELETE FROM magi_history'); }
    res.json({ ok: true });
  }));

  app.get('/api/admin/magi/status', auth, admin, wrap(async (req, res) => {
    await ready;
    res.json({
      nodes: NODES.map(nodeView),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, ready: !!keyOf(p), model: p.model() })),
      settings: publicSettings(),
      quorum: 2,
    });
  }));

  // Change how the nodes act: mode, link ending, rounds, convincing round, creativity, standing orders, personalities, muting.
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
    runDeadline = Date.now() + TIMEOUT;
    try {
      const text = await callProvider(v, 'Reply with the single word APPROVED and nothing else.', 'Test.');
      if (!String(text).trim()) return res.json({ ok: false, error: 'Empty answer', model: v.model, ms: Date.now() - started });
      res.json({ ok: true, model: v.model, ms: Date.now() - started });
    } catch (e) {
      res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200), model: v.model, ms: Date.now() - started });
    }
  }));

  // Run the MAGI. Optional "override": "APPROVED" or "DENIED" is the admin's decree and replaces the vote
  // (verdict mode, and link mode when the chain ends with a verdict).
  app.post('/api/admin/magi', auth, admin, wrap(async (req, res) => {
    await ready;
    const body = req.body || {};
    const question = String(body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });
    if (question.length > QUESTION_MAX) return res.status(400).json({ error: 'Question is too long (max ' + QUESTION_MAX + ' characters).' });
    const cfg = snapshot(); // settings are frozen for the whole run, so a change mid-run cannot mix two setups
    const decreeOk = cfg.mode === 'verdict' || (cfg.mode === 'link' && cfg.linkOut === 'verdict');
    const override = decreeOk ? String(body.override || '').toUpperCase() : '';
    const results = cfg.mode === 'link' ? await linkChain(question, cfg) : await deliberate(question, cfg);
    const run = { question, results, ...tally(results, cfg, override) };
    await histSave(run).catch((e) => console.error('magi history save:', e.message));
    res.json(run);
  }));
};
