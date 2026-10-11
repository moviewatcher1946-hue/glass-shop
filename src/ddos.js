// DDoS guard: per-address flood limits, automatic escalating bans, a cap on simultaneous requests per address, and an automatic
// "attack mode" (stricter limits for everyone) when the whole shop suddenly gets far more traffic than normal.
// Plain Node, in memory, small and capped. /healthz and the live-check poll (/api/rev) are never counted. Addresses in DDOS_ALLOW (comma list) are never limited.
const num = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const WIN = 10e3, LIM = { api: num('DDOS_API', 200), page: num('DDOS_PAGE', 400), img: num('DDOS_IMG', 150) }, CONC = num('DDOS_CONC', 30), ATTACK_RPS = num('DDOS_ATTACK_RPS', 100);
const ALLOW = new Set(String(process.env.DDOS_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean));
const BAN_MIN = [15, 60, 360]; // 1st, 2nd, 3rd+ ban for the same address (minutes)
const hits = new Map(), conc = new Map(), strikes = new Map(), bans = new Map(), levels = new Map();
const st = { n: 0, rps: 0, peak: 0, high: 0, auto: false, until: 0, forced: false, limited: 0, dropped: 0, bansMade: 0, since: Date.now() };
const attack = () => st.forced || st.auto;

function strike(ip, now) {
  let s = strikes.get(ip); if (!s || now - s.t > 5 * 60e3) s = { n: 0, t: now };
  s.n++; s.t = now; strikes.set(ip, s);
  if (s.n >= (attack() ? 2 : 3)) {
    const lv = levels.get(ip) || { n: 0, t: now }; const dur = BAN_MIN[Math.min(lv.n, BAN_MIN.length - 1)] * 60e3;
    levels.set(ip, { n: lv.n + 1, t: now }); bans.set(ip, { until: now + dur, at: now, level: lv.n + 1 }); strikes.delete(ip); st.bansMade++;
    console.warn(`[ddos] banned ${ip} for ${dur / 60e3} min (flooding)`);
  }
}

function early(app) {
  app.use((req, res, next) => {
    const p = req.path; if (p === '/healthz') return next();
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || ''; if (ALLOW.has(ip)) return next();
    const now = Date.now(), b = bans.get(ip);
    if (b) { if (b.until > now) { st.dropped++; return req.socket.destroy(); } bans.delete(ip); } // banned: closed without an answer, the cheapest possible reply
    st.n++;
    if (p === '/api/rev') return next();
    const kind = p.startsWith('/api/') ? (/^\/api\/products\/\d+\/image/.test(p) ? 'img' : 'api') : 'page';
    let e = hits.get(ip); if (!e || now > e.reset) { if (hits.size > 20000) hits.clear(); e = { reset: now + WIN, api: 0, page: 0, img: 0 }; hits.set(ip, e); }
    const cap = Math.max(20, Math.floor(LIM[kind] / (attack() ? 3 : 1)));
    if (++e[kind] > cap) { st.limited++; strike(ip, now); return res.set('Retry-After', '10').status(429).type('text/plain').send('Too many requests. Please slow down.'); }
    const c = conc.get(ip) || 0; if (c >= CONC) { st.limited++; return res.set('Retry-After', '5').status(429).type('text/plain').send('Too many requests at once.'); }
    conc.set(ip, c + 1); let done = false;
    const fin = () => { if (done) return; done = true; const x = (conc.get(ip) || 1) - 1; if (x > 0) conc.set(ip, x); else conc.delete(ip); };
    res.on('finish', fin); res.on('close', fin);
    next();
  });
  setInterval(() => { // every 5 s: measure whole-shop traffic and switch attack mode on or off
    const now = Date.now(); st.rps = Math.round((st.n / 5) * 10) / 10; if (st.rps > st.peak) st.peak = st.rps; st.n = 0;
    if (st.rps > ATTACK_RPS) { st.high++; if (st.high >= 2 && !st.auto) { st.auto = true; console.warn(`[ddos] attack mode ON (${st.rps} requests/s)`); } if (st.auto) st.until = now + 5 * 60e3; } else st.high = 0;
    if (st.auto && now > st.until && st.rps < ATTACK_RPS / 2) { st.auto = false; console.warn('[ddos] attack mode off'); }
  }, 5e3).unref();
  setInterval(() => { // tidy so memory stays small
    const now = Date.now();
    for (const [k, v] of bans) if (v.until < now) bans.delete(k);
    for (const [k, v] of strikes) if (now - v.t > 10 * 60e3) strikes.delete(k);
    for (const [k, v] of levels) if (now - v.t > 24 * 3600e3) levels.delete(k);
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, 60e3).unref();
}

function mount(app, { auth, admin }) {
  const A = [auth, admin];
  app.get('/api/plus/p/ddos-status', ...A, (req, res) => res.json([{ attack_mode: attack() ? (st.forced ? 'ON (manual)' : 'ON (automatic)') : 'off', requests_per_second: st.rps, peak_per_second: st.peak, banned_now: bans.size, bans_made: st.bansMade, requests_limited: st.limited, connections_dropped: st.dropped, attack_trigger_rps: ATTACK_RPS }]));
  app.get('/api/plus/p/ddos-bans', ...A, (req, res) => res.json([...bans].map(([ip, b]) => ({ address: ip, level: b.level, banned_at: new Date(b.at).toISOString(), minutes_left: Math.max(0, Math.round((b.until - Date.now()) / 60e3)) })).slice(0, 100)));
  app.post('/api/plus/p/act-ddos-unban', ...A, (req, res) => { const n = bans.size; bans.clear(); strikes.clear(); levels.clear(); res.json({ message: `Lifted ${n} ban(s).` }); });
  app.post('/api/plus/p/act-ddos-toggle', ...A, (req, res) => { st.forced = !st.forced; res.json({ message: st.forced ? 'Attack mode forced ON: limits are a third of normal.' : 'Manual attack mode off.' }); });
}
module.exports = { early, mount };
