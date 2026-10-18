// MAGI: three AI nodes, modelled on the MAGI supercomputers in Neon Genesis Evangelion.
// Each node has its own personality (they were built from the three sides of one person).
//
// ADMIN CONTROL (all saved in the magi_settings table, so it survives a restart):
//   mode      "verdict" = each node answers APPROVED or DENIED and the majority decides.
//             "discuss" = no yes or no at all. Each node gives an analysis and they talk it through.
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
// Majority rule: two matching verdicts decide. A node that fails, is muted or answers unclearly does not vote.
// Melchior = Google Gemini, Balthasar = Groq, Caspar = OpenRouter (any node can be linked to any provider). Admin only.
// Keys come from environment variables only.
// Providers: Gemini, Groq, OpenRouter, NVIDIA (build.nvidia.com, free key) and Cloudflare Workers AI (free daily allowance).
// Env vars: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
// Optional models: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL, MAGI_NVIDIA_MODEL, MAGI_CLOUDFLARE_MODEL.
// Without a database (pool is null) the settings and links only last until the server restarts.
const TIMEOUT = 25000;
const QUESTION_MAX = 1000;
// Reasoning models (Qwen on Groq, Nemotron, Gemini 3.5) spend output tokens on thinking before the visible answer.
// 1024 was often used up by the thinking alone, which left an empty or cut-off answer.
const MAX_OUT = 2048;

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
  if (b.mode === 'verdict' || b.mode === 'discuss') settings.mode = b.mode;
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

// POST JSON. A rate limit (429) or a briefly unavailable server (503) is tried once more, since the free tiers hit those often.
async function postJson(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
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
async function callProvider(view, system, user, temp) {
  const { provider: p, key, model } = view;
  const temperature = temp == null ? settings.temperature : temp;
  if (p.id === 'gemini') {
    const { r, d } = await postJson(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'x-goog-api-key': key, 'content-type': 'application/json' },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: MAX_OUT },
      }
    );
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
  const { r, d } = await postJson(url, headers, {
    model, temperature, max_tokens: MAX_OUT,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
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
    // If a later round fails, the node keeps what it said before.
    return { ...mine };
  }
}

async function deliberate(question, cfg) {
  const total = cfg.rounds;
  let cur = await Promise.all(NODES.map((n) => round1(n, question, cfg)));
  const spent = cur.map((r) => r.ms || 0);
  const hist = cur.map((r) => (r.ok ? [{ round: 1, kind: r.kind, verdict: r.verdict, text: r.text }] : []));

  for (let rd = 2; rd <= total; rd++) {
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

// The vote. In discuss mode there is no vote. A decree from the admin replaces the vote (verdict mode only).
function tally(results, cfg, override) {
  const ok = results.filter((r) => r.ok);
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
    try {
      const text = await callProvider(v, 'Reply with the single word APPROVED and nothing else.', 'Test.');
      if (!String(text).trim()) return res.json({ ok: false, error: 'Empty answer', model: v.model, ms: Date.now() - started });
      res.json({ ok: true, model: v.model, ms: Date.now() - started });
    } catch (e) {
      res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200), model: v.model, ms: Date.now() - started });
    }
  }));

  // Run the MAGI. Optional "override": "APPROVED" or "DENIED" is the admin's decree and replaces the vote (verdict mode only).
  app.post('/api/admin/magi', auth, admin, wrap(async (req, res) => {
    await ready;
    const body = req.body || {};
    const question = String(body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });
    if (question.length > QUESTION_MAX) return res.status(400).json({ error: 'Question is too long (max ' + QUESTION_MAX + ' characters).' });
    const cfg = snapshot(); // settings are frozen for the whole run, so a change mid-run cannot mix two setups
    const override = cfg.mode === 'verdict' ? String(body.override || '').toUpperCase() : '';
    const results = await deliberate(question, cfg);
    res.json({ question, results, ...tally(results, cfg, override) });
  }));
};
