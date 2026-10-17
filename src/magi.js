// MAGI: three AI nodes, modelled on the MAGI supercomputers in Neon Genesis Evangelion.
// Each node has its own personality (they were built from the three sides of one person), and they work in two rounds:
//   Round 1: each node reaches its own verdict, independently.
//   Round 2: each node reads the other nodes' verdicts and may revise its own. The final vote is taken after this.
// Majority rule: two matching verdicts decide. A node that fails or answers unclearly does not vote.
// Melchior = Google Gemini, Balthasar = Groq, Caspar = OpenRouter. Admin only. Keys come from environment variables only.
// Optional models: MAGI_GEMINI_MODEL, MAGI_GROQ_MODEL, MAGI_OPENROUTER_MODEL.
const TIMEOUT = 25000;
const QUESTION_MAX = 1000;

const FORMAT = 'On the first line write exactly APPROVED or DENIED. Then give your reasoning in at most three sentences. Plain text only.';

const NODES = [
  {
    id: 'melchior', name: 'MELCHIOR-1', role: 'SCIENCE', provider: 'gemini', label: 'Google Gemini',
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], model: () => process.env.MAGI_GEMINI_MODEL || 'gemini-3.5-flash-lite',
    persona: 'You are MELCHIOR-1, the rational, scientific node. You decide on evidence, logic and measurable outcomes. You distrust sentiment and want proof. You are sceptical of anything you cannot verify.',
  },
  {
    id: 'balthasar', name: 'BALTHASAR-2', role: 'MATERNAL', provider: 'groq', label: 'Groq',
    keys: ['GROQ_API_KEY'], model: () => process.env.MAGI_GROQ_MODEL || 'qwen/qwen3.8-27b',
    persona: 'You are BALTHASAR-2, the protective, maternal node. You decide on the wellbeing and safety of people. You are cautious about harm to anyone, and you weigh the human cost first.',
  },
  {
    id: 'caspar', name: 'CASPAR-3', role: 'PERSONAL', provider: 'openrouter', label: 'OpenRouter',
    keys: ['OPENROUTER_API_KEY'], model: () => process.env.MAGI_OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
    persona: 'You are CASPAR-3, the personal, intuitive node. You decide on conviction and what feels right in the situation. You are willing to stand against the others when you believe they are wrong.',
  },
];

const keyOf = (n) => { for (const k of n.keys) { const v = (process.env[k] || '').trim(); if (v) return v; } return ''; };
const verdictOf = (t) => {
  const w = String(t || '').trim().split(/\s+/)[0] || '';
  const u = w.toUpperCase().replace(/[^A-Z]/g, '');
  return u === 'APPROVED' ? 'APPROVED' : u === 'DENIED' ? 'DENIED' : 'UNCLEAR';
};

// One call to one node. system and user are plain strings; provider adapters are below.
async function callNode(n, system, user) {
  const key = keyOf(n);
  if (n.provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(n.model()) + ':generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && d.error.message) || 'HTTP ' + r.status);
    const c = (d.candidates || [])[0];
    return c && c.content ? (c.content.parts || []).map((p) => p.text || '').join('') : '';
  }
  const url = n.provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + key };
  if (n.provider === 'openrouter') headers['X-Title'] = 'MAGI';
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: n.model(), temperature: 0.4, max_tokens: 350,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || 'HTTP ' + r.status);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}

function shape(n, text, started) {
  return { id: n.id, name: n.name, role: n.role, provider: n.label, model: n.model(), ok: true, verdict: verdictOf(text), text: String(text).trim().slice(0, 1200), ms: Date.now() - started };
}

async function round1(n, question) {
  const started = Date.now();
  if (!keyOf(n)) return { id: n.id, name: n.name, role: n.role, provider: n.label, model: n.model(), ok: false, error: 'No API key set for ' + n.label };
  try {
    const text = await callNode(n, n.persona + ' ' + FORMAT, question);
    return shape(n, text, started);
  } catch (e) {
    return { id: n.id, name: n.name, role: n.role, provider: n.label, model: n.model(), ok: false, error: String((e && e.message) || e).slice(0, 200), ms: Date.now() - started };
  }
}

async function round2(n, question, first, others) {
  const started = Date.now();
  const lines = others.map((o) => o.name + ' (' + o.role + '): ' + o.verdict + '. ' + o.text).join('\n\n');
  const user = 'Question: ' + question + '\n\nYour first verdict was ' + first.verdict + '.\n\nThe other nodes said:\n\n' + lines +
    '\n\nConsider their reasoning. Keep your position if you still believe it, or change it if they convinced you. ' + FORMAT;
  try {
    const text = await callNode(n, n.persona + ' This is the second round of deliberation.', user);
    return { ...shape(n, text, started), initial: first.verdict, revised: verdictOf(text) !== first.verdict };
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

module.exports = function mount(app, { auth, admin, wrap }) {
  app.get('/api/admin/magi/status', auth, admin, (req, res) => {
    res.json({
      nodes: NODES.map((n) => ({ id: n.id, name: n.name, role: n.role, provider: n.label, model: n.model(), enabled: !!keyOf(n) })),
      quorum: 2,
    });
  });

  app.post('/api/admin/magi', auth, admin, wrap(async (req, res) => {
    const question = String((req.body || {}).question || '').trim();
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });
    if (question.length > QUESTION_MAX) return res.status(400).json({ error: 'Question is too long (max ' + QUESTION_MAX + ' characters).' });
    const results = await deliberate(question);
    res.json({ question, results, ...tally(results) });
  }));
};
