// MAGI: three AI nodes, modelled on the MAGI supercomputers in Neon Genesis Evangelion.
// Each node has its own personality (they were built from the three sides of one person), and they work in two rounds:
//   Round 1: each node reaches its own verdict, independently.
//   Round 2: each node reads the other nodes' verdicts and may revise its own. The final vote is taken after this.
// Majority rule: two matching verdicts decide. A node that fails or answers unclearly does not vote.
// Melchior = Google Gemini, Balthasar = Groq, Caspar = OpenRouter. Admin only. Keys come from environment variables only.
// Optional models: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL.
// The admin can link any node to any provider that has a key (saved in the magi_links table).
const TIMEOUT = 25000;
const QUESTION_MAX = 1000;
// Reasoning models (Qwen on Groq, Nemotron, Gemini 3.5) spend output tokens on thinking before the visible answer.
// 1024 was often used up by the thinking alone, which left an empty or cut-off answer.
const MAX_OUT = 2048;

const FORMAT = 'On the first line write exactly APPROVED or DENIED. Then give your reasoning in at most three sentences. Plain text only.';

// Providers: one entry per AI service. "model" is the built-in default, overridable with the env var.
const PROVIDERS = {
  gemini: {
    id: 'gemini', label: 'Google Gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    model: () => process.env.MAGI_GEMINI_MODEL || 'gemini-3.5-flash-lite',
  },
  groq: {
    id: 'groq', label: 'Groq', keys: ['GROQ_API_KEY'],
    model: () => process.env.MAGI_GROQ_MODEL || 'qwen/qwen3.8-27b',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', keys: ['OPENROUTER_API_KEY'],
    model: () => process.env.MAGI_OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
  },
};

// Nodes: fixed personality and role. "home" is the provider a node starts on.
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

const keyOf = (p) => { for (const k of p.keys) { const v = (process.env[k] || '').trim(); if (v) return v; } return ''; };

// The provider and model a node is actually using right now.
function effective(n) {
  const link = links.get(n.id);
  const pid = link && PROVIDERS[link.provider] ? link.provider : n.home;
  const p = PROVIDERS[pid];
  return { node: n, provider: p, label: p.label, model: (link && link.model) || p.model(), key: keyOf(p) };
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

// One call to one provider. system and user are plain strings.
async function callProvider(view, system, user) {
  const { provider: p, key, model } = view;
  if (p.id === 'gemini') {
    const { r, d } = await postJson(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'x-goog-api-key': key, 'content-type': 'application/json' },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUT },
      }
    );
    if (!r.ok) throw new Error(errText(d, r.status));
    const c = (d.candidates || [])[0];
    const text = c && c.content ? (c.content.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('') : '';
    if (!text.trim() && d.promptFeedback && d.promptFeedback.blockReason) throw new Error('Blocked by Gemini: ' + d.promptFeedback.blockReason);
    if (!text.trim() && c && c.finishReason === 'MAX_TOKENS') throw new Error('Ran out of tokens while thinking');
    return stripThink(text);
  }
  const url = p.id === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
  if (p.id === 'openrouter') headers['X-Title'] = 'MAGI';
  const { r, d } = await postJson(url, headers, {
    model, temperature: 0.4, max_tokens: MAX_OUT,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  if (!r.ok) throw new Error(errText(d, r.status));
  const ch = d.choices && d.choices[0];
  if (d.error) throw new Error(errText(d, r.status)); // OpenRouter can answer 200 with an error body
  const text = stripThink((ch && ch.message && ch.message.content) || '');
  if (!text && ch && ch.finish_reason === 'length') throw new Error('Ran out of tokens while thinking');
  return text;
}

function shape(view, text, started) {
  return { id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: true, verdict: verdictOf(text), text: String(text).trim().slice(0, 1200), ms: Date.now() - started };
}

function failed(view, error, started) {
  return { id: view.node.id, name: view.node.name, role: view.node.role, provider: view.label, model: view.model, ok: false, error: String(error || 'no answer').slice(0, 200), ms: Date.now() - started };
}

async function round1(n, question) {
  const v = effective(n), started = Date.now();
  if (!v.key) return failed(v, 'No API key set for ' + v.label, started);
  try {
    const text = await callProvider(v, n.persona + ' ' + FORMAT, question);
    if (!String(text).trim()) return failed(v, 'Empty answer from ' + v.label, started);
    return shape(v, text, started);
  } catch (e) {
    return failed(v, (e && e.message) || e, started);
  }
}

async function round2(n, question, first, others) {
  const v = effective(n), started = Date.now();
  const lines = others.map((o) => o.name + ' (' + o.role + '): ' + o.verdict + '. ' + o.text).join('\n\n');
  const user = 'Question: ' + question + '\n\nYour first verdict was ' + first.verdict + '.\n\nThe other nodes said:\n\n' + lines +
    '\n\nConsider their reasoning. Keep your position if you still believe it, or change it if they convinced you. ' + FORMAT;
  try {
    // FORMAT is in the system text too, so the answer starts with the verdict word in round 2 as well.
    const text = await callProvider(v, n.persona + ' This is the second round of deliberation. ' + FORMAT, user);
    if (!String(text).trim()) throw new Error('empty');
    return { ...shape(v, text, started), initial: first.verdict, revised: verdictOf(text) !== first.verdict };
  } catch (e) {
    // If round 2 fails, keep the round 1 verdict.
    return { ...first, initial: first.verdict, revised: false, ms: Date.now() - started };
  }
}

function tally(results) {
  const ok = results.filter((r) => r.ok);
  const approved = ok.filter((r) => r.verdict === 'APPROVED').length;
  const denied = ok.filter((r) => r.verdict === 'DENIED').length;
  const decision = approved >= 2 ? 'APPROVED' : denied >= 2 ? 'DENIED' : 'NO CONSENSUS';
  return { decision, approved, denied, responded: ok.length };
}

async function deliberate(question) {
  // Round 1: independent verdicts.
  const first = await Promise.all(NODES.map((n) => round1(n, question)));
  // Round 2: each responding node sees the others' round 1 verdicts and may revise.
  const results = await Promise.all(NODES.map((n, i) => {
    const f = first[i];
    if (!f.ok) return Promise.resolve({ ...f, initial: null, revised: false });
    const others = first.filter((o, j) => j !== i && o.ok);
    if (!others.length) return Promise.resolve({ ...f, initial: f.verdict, revised: false });
    return round2(n, question, f, others);
  }));
  return results;
}

// What the admin screen shows for one node.
function nodeView(n) {
  const v = effective(n);
  return {
    id: n.id, name: n.name, role: n.role,
    provider: v.label, provider_id: v.provider.id,
    model: v.model, default_model: v.provider.model(),
    enabled: !!v.key,
  };
}

module.exports = function mount(app, { pool, auth, admin, wrap }) {
  // Load saved node links (provider and model) from the database, if there is one.
  const ready = (async () => {
    if (!pool) return;
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS magi_links (node TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '')`);
      const r = await pool.query('SELECT node, provider, model FROM magi_links');
      for (const x of r.rows) if (NODE_BY_ID[x.node] && PROVIDERS[x.provider]) links.set(x.node, { provider: x.provider, model: x.model || '' });
    } catch (e) { console.error('magi links init:', e.message); }
  })();

  app.get('/api/admin/magi/status', auth, admin, wrap(async (req, res) => {
    await ready;
    res.json({
      nodes: NODES.map(nodeView),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, ready: !!keyOf(p), model: p.model() })),
      quorum: 2,
    });
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
    if (!keyOf(p)) return res.status(400).json({ error: 'No API key set on the server for ' + p.label + '.' });

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
    if (!v.key) return res.json({ ok: false, error: 'No API key set for ' + v.label, model: v.model });
    try {
      const text = await callProvider(v, 'Reply with the single word APPROVED and nothing else.', 'Test.');
      if (!String(text).trim()) return res.json({ ok: false, error: 'Empty answer', model: v.model, ms: Date.now() - started });
      res.json({ ok: true, model: v.model, ms: Date.now() - started });
    } catch (e) {
      res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200), model: v.model, ms: Date.now() - started });
    }
  }));

  app.post('/api/admin/magi', auth, admin, wrap(async (req, res) => {
    await ready;
    const question = String((req.body || {}).question || '').trim();
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });
    if (question.length > QUESTION_MAX) return res.status(400).json({ error: 'Question is too long (max ' + QUESTION_MAX + ' characters).' });
    const results = await deliberate(question);
    res.json({ question, results, ...tally(results) });
  }));
};
