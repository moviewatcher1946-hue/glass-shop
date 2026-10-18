// src/magi.js: server side of the MAGI console (public/magi.js talks to this).
//
// Mount it in your server file:
//   const magi = require('./src/magi');
//   app.use('/api/admin/magi', magi({ auth: requireAdmin, pool }));
//
//   auth : your existing "admin only" middleware (must reject non-admins). Required.
//   pool : your pg Pool (optional). With it, LINK changes survive restarts (table magi_nodes is created for you).
//   context : optional async function returning a short text about the shop (sales, stock...) that is
//             added to every question, e.g. async () => 'Top seller: ...'. Optional.
//
// Env keys: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY (a provider with no key shows "NO KEY").
// Optional env: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL.
// Needs Node 18+ (global fetch).

const express = require('express');

const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    key: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: () => process.env.MAGI_GEMINI_MODEL || 'gemini-2.5-flash',
    call: callGemini
  },
  groq: {
    label: 'Groq',
    key: () => process.env.GROQ_API_KEY || '',
    model: () => process.env.MAGI_GROQ_MODEL || 'llama-3.3-70b-versatile',
    call: (key, model, sys, q, signal) => callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', key, model, sys, q, signal)
  },
  openrouter: {
    label: 'OpenRouter',
    key: () => process.env.OPENROUTER_API_KEY || '',
    model: () => process.env.MAGI_OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    call: (key, model, sys, q, signal) => callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', key, model, sys, q, signal)
  }
};

// the three nodes: id must match the ids the frontend knows (melchior / balthasar / caspar)
const NODES = [
  { id: 'melchior', name: 'Melchior', role: 'SCIENTIST', provider_id: 'gemini',
    persona: 'You are MELCHIOR, the scientist: judge by data, numbers, logic and evidence.' },
  { id: 'balthasar', name: 'Balthasar', role: 'MOTHER', provider_id: 'groq',
    persona: 'You are BALTHASAR, the mother: judge by protecting the shop, its staff, its stock and its long-term health.' },
  { id: 'caspar', name: 'Casper', role: 'WOMAN', provider_id: 'openrouter',
    persona: 'You are CASPER, the woman: judge by what customers want, feel and will actually buy.' }
];

const SYSTEM = [
  'You are one of three voting AIs advising the owner of a small online snack and drink shop.',
  'Reply format, strictly: the FIRST line is exactly one word, APPROVED or DENIED.',
  'Then, on the next lines, give the reason in at most 2 short sentences. No markdown, no lists.'
].join(' ');

const TIMEOUT_MS = 25000;

// ---------- provider calls ----------
async function callGemini(key, model, sys, q, signal) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: q }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 300 }
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Gemini HTTP ' + r.status);
  const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
  const text = (parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('Empty answer');
  return text;
}

async function callOpenAICompat(url, key, model, sys, q, signal) {
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model, temperature: 0.4, max_tokens: 300,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: q }]
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || 'HTTP ' + r.status);
  const text = d.choices && d.choices[0] && d.choices[0].message && String(d.choices[0].message.content || '').trim();
  if (!text) throw new Error('Empty answer');
  return text;
}

function parseVerdict(text) {
  const first = (text.split('\n')[0] || '');
  let m = first.match(/\b(APPROVED|DENIED)\b/i);
  if (!m) m = text.match(/\b(APPROVED|DENIED)\b/i);
  return m ? m[1].toUpperCase() : 'UNCLEAR';
}

module.exports = function magiRouter(opts) {
  opts = opts || {};
  if (typeof opts.auth !== 'function') throw new Error('magi: pass { auth: yourAdminMiddleware }');
  const pool = opts.pool || null;
  const getContext = typeof opts.context === 'function' ? opts.context : null;

  // current setting per node (null provider/model = built-in default)
  const cfg = {};
  NODES.forEach(n => { cfg[n.id] = { provider: n.provider_id, model: '' }; });

  const ready = pool ? pool.query(
    'CREATE TABLE IF NOT EXISTS magi_nodes (id text PRIMARY KEY, provider text NOT NULL, model text NOT NULL DEFAULT \'\')'
  ).then(() => pool.query('SELECT id, provider, model FROM magi_nodes')).then(res => {
    res.rows.forEach(row => { if (cfg[row.id] && PROVIDERS[row.provider]) cfg[row.id] = { provider: row.provider, model: row.model || '' }; });
  }).catch(e => console.warn('magi: could not load saved links:', e.message)) : Promise.resolve();

  const nodeDef = id => NODES.find(n => n.id === id);
  const effModel = c => c.model || PROVIDERS[c.provider].model();

  function view(n) {
    const c = cfg[n.id], p = PROVIDERS[c.provider];
    return {
      id: n.id, name: n.name, role: n.role,
      provider: p.label, provider_id: c.provider,
      model: effModel(c), default_model: p.model(),
      enabled: !!p.key()
    };
  }

  async function ask(n, question, extra) {
    const c = cfg[n.id], p = PROVIDERS[c.provider], model = effModel(c);
    const base = { id: n.id, name: n.name, provider: p.label, model };
    const key = p.key();
    if (!key) return Object.assign(base, { ok: false, error: 'No API key for ' + p.label });
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const q = (extra ? 'Shop info:\n' + extra + '\n\n' : '') + 'Question: ' + question;
      const text = await p.call(key, model, n.persona + ' ' + SYSTEM, q, ctl.signal);
      return Object.assign(base, { ok: true, verdict: parseVerdict(text), text, ms: Date.now() - t0 });
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Timed out after ' + TIMEOUT_MS / 1000 + 's' : (e.message || 'Failed');
      return Object.assign(base, { ok: false, error: String(msg).slice(0, 300), ms: Date.now() - t0 });
    } finally { clearTimeout(timer); }
  }

  const router = express.Router();
  router.use(opts.auth);
  router.use(express.json({ limit: '10kb' }));
  router.use((req, res, next) => { ready.then(() => next()); });

  // GET /status -> providers + the three nodes
  router.get('/status', (req, res) => {
    res.json({
      providers: Object.keys(PROVIDERS).map(id => ({ id, label: PROVIDERS[id].label, ready: !!PROVIDERS[id].key(), model: PROVIDERS[id].model() })),
      nodes: NODES.map(view)
    });
  });

  // POST /node  { node, provider, model }  or  { node, reset:true }
  router.post('/node', async (req, res) => {
    const b = req.body || {}, n = nodeDef(b.node);
    if (!n) return res.status(400).json({ error: 'Unknown node' });
    let next;
    if (b.reset) next = { provider: n.provider_id, model: '' };
    else {
      const p = PROVIDERS[b.provider];
      if (!p) return res.status(400).json({ error: 'Unknown provider' });
      if (!p.key()) return res.status(400).json({ error: p.label + ' has no API key on the server' });
      const m = String(b.model || '').trim();
      if (m && !/^[\w.\-:\/]{1,120}$/.test(m)) return res.status(400).json({ error: 'Bad model name' });
      next = { provider: b.provider, model: m };
    }
    cfg[n.id] = next;
    if (pool) {
      try {
        await pool.query(
          'INSERT INTO magi_nodes (id, provider, model) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET provider=$2, model=$3',
          [n.id, next.provider, next.model]);
      } catch (e) { console.warn('magi: save failed:', e.message); }
    }
    res.json({ node: view(n) });
  });

  // POST /test  { node }  -> quick ping of one link
  router.post('/test', async (req, res) => {
    const n = nodeDef((req.body || {}).node);
    if (!n) return res.status(400).json({ error: 'Unknown node' });
    const r = await ask(n, 'Connection test. Answer APPROVED.');
    if (r.ok) res.json({ ok: true, ms: r.ms, model: r.model });
    else res.json({ ok: false, error: r.error, ms: r.ms, model: r.model });
  });

  // POST /  { question } -> all three vote in parallel
  router.post('/', async (req, res) => {
    const question = String((req.body || {}).question || '').trim().slice(0, 1000);
    if (!question) return res.status(400).json({ error: 'Question is empty' });
    let extra = '';
    if (getContext) { try { extra = String(await getContext() || '').slice(0, 3000); } catch (e) { console.warn('magi: context failed:', e.message); } }

    const results = await Promise.all(NODES.map(n => ask(n, question, extra)));
    const ok = results.filter(r => r.ok);
    const approved = ok.filter(r => r.verdict === 'APPROVED').length;
    const denied = ok.filter(r => r.verdict === 'DENIED').length;
    let decision = 'NO CONSENSUS';
    if (ok.length >= 2) {
      if (approved > denied) decision = 'APPROVED';
      else if (denied > approved) decision = 'DENIED';
    }
    res.json({ results, decision, approved, denied, responded: ok.length });
  });

  return router;
};
