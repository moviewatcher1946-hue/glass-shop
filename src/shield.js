// Security switches (main admin only): lockdown, firewall, read-only, sign-up pause, bot blocking, IP blocklist, log everyone out.
const express = require('express');

module.exports = function mount(app, { pool, auth }) {
  const state = { lockdown: false, firewall: false, readonly: false, nosignup: false, nobots: false, ips: [], killBefore: 0, killExcept: 0 };
  const stats = { lockdown: 0, firewall: 0, readonly: 0, nosignup: 0, nobots: 0, ip: 0, session: 0 };
  const blocked = [];
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const save = () => pool.query("INSERT INTO plus_settings (key,value) VALUES ('shield',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(state)]);
  pool.query("CREATE TABLE IF NOT EXISTS plus_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')")
    .then(() => pool.query("SELECT value FROM plus_settings WHERE key='shield'"))
    .then((r) => { if (r.rows[0]) Object.assign(state, JSON.parse(r.rows[0].value)); })
    .catch((e) => console.error('shield load:', e.message));

  const note = (req, type) => { stats[type]++; blocked.unshift({ at: new Date().toISOString(), ip: req.ip, type, path: String(req.originalUrl).slice(0, 120) }); if (blocked.length > 50) blocked.pop(); };
  const SAFE = new Set(['/api/rev', '/api/plus/public', '/api/auth/login', '/api/auth/me']);
  const asAdmin = (req, cb) => {
    const fake = { status() { return this; }, json() { cb(false); }, set() { return this; }, end() { cb(false); } };
    auth(req, fake, (e) => cb(!e && !!req.user && req.user.role === 'admin'));
  };
  const BOT = /(curl|wget|python-requests|python-urllib|scrapy|go-http-client|java\/|libwww|httpclient|okhttp\/|aiohttp|node-fetch|axios|postman|masscan|nikto|sqlmap)/i;
  const BAD = /(\.\.\/|\.\.%2f|<script|union\s+select|\bor\b\s+1\s*=\s*1|;\s*drop\s+table|\/etc\/passwd|\$\{jndi)/i;
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.t > 60000) hits.delete(k); }, 60000).unref();

  app.use('/api', (req, res, next) => {
    const path = req.baseUrl + req.path;
    if (path.startsWith('/api/shield')) return next();
    if (state.ips.length && state.ips.includes(req.ip)) { note(req, 'ip'); return res.status(403).json({ error: 'Access blocked.' }); }
    if (state.nobots && BOT.test(req.get('user-agent') || '')) { note(req, 'nobots'); return res.status(403).json({ error: 'Automated access is blocked.' }); }
    if (state.firewall) {
      let url = req.originalUrl; try { url = decodeURIComponent(url); } catch (e) { /* keep raw */ }
      if (!req.get('user-agent') || BAD.test(url)) { note(req, 'firewall'); return res.status(403).json({ error: 'Request blocked by the firewall.' }); }
      if (path !== '/api/rev') {
        const h = hits.get(req.ip) || { n: 0, t: Date.now() };
        if (Date.now() - h.t > 60000) { h.n = 0; h.t = Date.now(); }
        if (++h.n > 120) { hits.set(req.ip, h); note(req, 'firewall'); res.set('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests. Slow down.' }); }
        hits.set(req.ip, h);
      }
    }
    if (state.nosignup && req.method === 'POST' && path === '/api/auth/signup') { note(req, 'nosignup'); return res.status(403).json({ error: 'New sign-ups are paused right now.' }); }
    if (state.killBefore) {
      const tk = (req.headers.authorization || '').replace(/^Bearer /, '');
      try { const c = JSON.parse(Buffer.from(tk.split('.')[1] || '', 'base64url').toString()); if (c && c.iat < state.killBefore && c.id !== state.killExcept) { note(req, 'session'); return res.status(401).json({ error: 'Log in to continue.' }); } } catch (e) { /* no token */ }
    }
    if (SAFE.has(path)) return next();
    const readOnlyHit = state.readonly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!state.lockdown && !readOnlyHit) return next();
    asAdmin(req, (ok) => {
      if (ok) return next();
      if (state.lockdown) { note(req, 'lockdown'); return res.status(503).json({ error: 'The shop is in lockdown. Please check back soon.' }); }
      note(req, 'readonly'); return res.status(403).json({ error: 'The shop is read-only right now.' });
    });
  });

  const J = express.json({ limit: '10kb' });
  const log = (req, a, d) => pool.query('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, a, String(d || '').slice(0, 500)]).catch(() => {});
  const view = () => ({ state: { lockdown: state.lockdown, firewall: state.firewall, readonly: state.readonly, nosignup: state.nosignup, nobots: state.nobots, ips: state.ips }, stats, blocked });
  const A = [auth, (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }))];

  app.get('/api/shield', ...A, wrap(async (req, res) => res.json(view())));
  app.put('/api/shield/toggle', ...A, J, wrap(async (req, res) => {
    const k = String((req.body || {}).key || '');
    if (!['lockdown', 'firewall', 'readonly', 'nosignup', 'nobots'].includes(k)) return res.status(400).json({ error: 'Unknown switch.' });
    state[k] = !!req.body.on; await save(); await log(req, 'shield-' + k, state[k] ? 'on' : 'off'); res.json(view());
  }));
  app.put('/api/shield/ips', ...A, J, wrap(async (req, res) => {
    const list = [...new Set(String((req.body || {}).text || '').split(/[\s,]+/).filter(Boolean))].slice(0, 200);
    if (list.some((x) => !/^[0-9a-fA-F:.]{3,45}$/.test(x))) return res.status(400).json({ error: 'Only IP addresses, one per line.' });
    if (list.includes(req.ip)) return res.status(400).json({ error: 'You cannot block your own address (' + req.ip + ').' });
    state.ips = list; await save(); await log(req, 'shield-ips', list.length + ' blocked'); res.json(view());
  }));
  app.post('/api/shield/logout-all', ...A, wrap(async (req, res) => {
    state.killBefore = Math.floor(Date.now() / 1000); state.killExcept = req.user.id; await save(); await log(req, 'shield-logout-all', 'everyone but ' + req.user.username); res.json(view());
  }));
  app.post('/api/shield/clear-log', ...A, wrap(async (req, res) => { blocked.length = 0; Object.keys(stats).forEach((k) => { stats[k] = 0; }); res.json(view()); }));
};
