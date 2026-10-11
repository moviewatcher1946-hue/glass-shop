// Security switches (main admin only): lockdown, firewall, read-only, sign-up pause, bot blocking, IP blocklist, log everyone out.
const express = require('express');

module.exports = function mount(app, { pool, auth }) {
  const NEW = ['throttle','throttleauto','ddos','datashield','sqlguard','xssguard','origin','honeypot','autoban','scrape','bigbody','noupload','slowlogin','forcehttps','nohotlink','secheaders'];
  const state = { lockdown: false, firewall: false, readonly: false, nosignup: false, nobots: false, throttle: false, throttleauto: true, ddos: false, datashield: false, sqlguard: false, xssguard: false, origin: false, honeypot: false, autoban: false, scrape: false, bigbody: false, noupload: false, slowlogin: false, forcehttps: false, nohotlink: false, secheaders: false, ips: [], killBefore: 0, killExcept: 0 };
  const stats = { throttle: 0, ddos: 0, datashield: 0, sqlguard: 0, xssguard: 0, origin: 0, honeypot: 0, autoban: 0, scrape: 0, bigbody: 0, noupload: 0, slowlogin: 0, forcehttps: 0, nohotlink: 0, secheaders: 0, lockdown: 0, firewall: 0, readonly: 0, nosignup: 0, nobots: 0, ip: 0, session: 0 };
  const blocked = [];
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
  const save = () => pool.query("INSERT INTO plus_settings (key,value) VALUES ('shield',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(state)]);
  pool.query("CREATE TABLE IF NOT EXISTS plus_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')")
    .then(() => pool.query("SELECT value FROM plus_settings WHERE key='shield'"))
    .then((r) => { if (r.rows[0]) Object.assign(state, JSON.parse(r.rows[0].value)); })
    .catch((e) => console.error('shield load:', e.message));

  const note = (req, type) => { stats[type]++; blocked.unshift({ at: new Date().toISOString(), ip: req.ip, type, path: String(req.originalUrl).slice(0, 120) }); if (blocked.length > (P[state.perf] || P.balanced).log) blocked.pop(); };
  const SAFE = new Set(['/api/rev', '/api/plus/public', '/api/auth/login', '/api/auth/me']);
  const asAdmin = (req, cb) => {
    const fake = { status() { return this; }, json() { cb(false); }, set() { return this; }, end() { cb(false); } };
    auth(req, fake, (e) => cb(!e && !!req.user && req.user.role === 'admin'));
  };

  // ---- Throttle mode: keeps the shop running near its max when an attack gets past the other defences ----
  // ON (manual) or AUTO (when the server is overloaded: lag, too many open requests, or a burst of blocked hits).
  // While active: public pages/data are cached for a few seconds, anonymous visitors get a tight limit, requests beyond capacity get a
  // quick "busy, retry" instead of piling up, and logged-in users are served first. Turns itself off 60 s after things calm down.
  const TH = { inflight: 0, lag: 0, auto: false, until: 0, last: Date.now(), cache: new Map(), anon: new Map(), served: 0, shed: 0, cached: 0, recent: [] };
  setInterval(() => { const n = Date.now(), d = n - TH.last - 500; TH.last = n; TH.lag = Math.max(0, TH.lag * 0.7 + d * 0.3); const t = n - 10000; TH.recent = TH.recent.filter((x) => x > t);
    if (state.throttleauto && (TH.lag > 120 || TH.inflight > 80 || TH.recent.length > 150)) { TH.auto = true; TH.until = n + 60000; } else if (TH.auto && n > TH.until) TH.auto = false;
    if (TH.cache.size > prof().cache) TH.cache.clear(); for (const [k, v] of TH.anon) if (n - v.t > 30000) TH.anon.delete(k); }, 500).unref();
  const thOn = () => state.throttle || TH.auto || state.perf === 'max' || (state.perf === 'low' && true);
  app.use((req, res, next) => {
    const path = req.path; if (path === '/healthz' || path === '/readyz') return next();
    TH.recent.push(Date.now()); TH.inflight++; let done = false; const fin = () => { if (!done) { done = true; TH.inflight--; } }; res.on('finish', fin); res.on('close', fin);
    if (!thOn()) return next();
    const loggedIn = /^Bearer\s+\S{20,}/.test(req.headers.authorization || ''), isApi = path.startsWith('/api'), get = req.method === 'GET' || req.method === 'HEAD';
    if (path === '/api/rev') return next();
    if (!loggedIn) { const t = Date.now(); let h = TH.anon.get(req.ip); if (!h || t - h.t > 10000) h = { n: 0, t }; h.n++; TH.anon.set(req.ip, h);
      if (h.n > prof().anon) { stats.throttle++; res.set('Retry-After', '10'); return res.status(429).type('text/plain').send('Busy. Please wait a few seconds.'); } }
    if (TH.inflight > prof().open[loggedIn ? 1 : 0] || (MEM.pressure > Date.now() && !loggedIn && TH.inflight > 20)) { TH.shed++; stats.throttle++; res.set('Retry-After', '3'); return res.status(503).type('text/plain').send('The shop is very busy. Retrying in a moment...'); }
    if (!isApi && get) res.set('Cache-Control', 'public, max-age=300');
    if (isApi && get && !loggedIn) { const key = req.originalUrl, hit = TH.cache.get(key);
      if (hit && Date.now() - hit.t < prof().ttl) { TH.cached++; res.set('X-Throttle-Cache', 'hit'); return res.status(200).type('application/json').send(hit.body); }
      const send = res.send; res.send = function (b) { if (this.statusCode === 200 && typeof b === 'string' && /json/.test(String(this.get('Content-Type')))) if (MEM.pressure < Date.now()) TH.cache.set(key, { t: Date.now(), body: b }); return send.call(this, b); }; }
    TH.served++; next();
  });

  // ---- Extra defences (each one is a switch in Admin > System > Security) ----
  const strikes = new Map(), autobans = new Map(), rate = new Map(), scrapeHits = new Map(), loginHits = new Map();
  setInterval(() => { const t = Date.now(); for (const m of [strikes, rate, scrapeHits, loginHits]) for (const [k, v] of m) if (t - v.t > 120000) m.delete(k); for (const [k, v] of autobans) if (v < t) autobans.delete(k); }, 60000).unref();
  const bump = (m, ip, win) => { const t = Date.now(); let h = m.get(ip); if (!h || t - h.t > win) h = { n: 0, t }; h.n++; m.set(ip, h); return h.n; };
  const strike = (req, type) => { note(req, type); if (state.autoban && bump(strikes, req.ip, 600000) >= 8) { autobans.set(req.ip, Date.now() + 3600000); note(req, 'autoban'); } };
  const TRAP = /^\/(\.env|\.git|wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|admin\.php|config\.php|backup\.sql|\.aws|server-status|cgi-bin)/i;
  const SQLI = /(union\s+(all\s+)?select|select\s.+\sfrom\s|insert\s+into|drop\s+(table|database)|;\s*(delete|update)\s|sleep\s*\(|benchmark\s*\(|information_schema|pg_sleep|'\s*or\s*'?\d|--\s*$)/i;
  const XSS = /(<\s*script|javascript:|onerror\s*=|onload\s*=|<\s*iframe|<\s*svg[^>]*on\w+=|document\.cookie|<\s*img[^>]+onerror)/i;
  app.use((req, res, next) => {
    const path = req.path;
    if (path === '/healthz' || path === '/readyz') return next();
    if (state.forcehttps && req.get('x-forwarded-proto') === 'http') return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
    if (state.secheaders) { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' }); }
    if (autobans.has(req.ip)) { note(req, 'autoban'); return res.status(403).type('text/plain').send('Access blocked.'); }
    if (state.honeypot && TRAP.test(path)) { strike(req, 'honeypot'); autobans.set(req.ip, Date.now() + 3600000); return res.status(404).type('text/plain').send('Not found'); }
    if (state.ddos && path !== '/api/rev' && bump(rate, req.ip, 10000) > 60) { strike(req, 'ddos'); res.set('Retry-After', '10'); return res.status(429).type('text/plain').send('Too many requests. Slow down.'); }
    if (state.nohotlink && /\.(png|jpe?g|webp|gif|svg)$/i.test(path)) { const r = req.get('referer'); if (r) { try { if (new URL(r).host !== req.get('host')) { strike(req, 'nohotlink'); return res.status(403).end(); } } catch (e) { /* ignore */ } } }
    if (!path.startsWith('/api')) return next();
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (state.origin && unsafe) { const o = req.get('origin'); if (o) { try { if (new URL(o).host !== req.get('host')) { strike(req, 'origin'); return res.status(403).json({ error: 'Cross-site request blocked.' }); } } catch (e) { strike(req, 'origin'); return res.status(403).json({ error: 'Bad origin.' }); } } }
    if (state.bigbody && Number(req.get('content-length') || 0) > 2e6) { strike(req, 'bigbody'); return res.status(413).json({ error: 'Request too large.' }); }
    if (state.noupload && unsafe && /multipart|image\//i.test(req.get('content-type') || '') ) { note(req, 'noupload'); return res.status(403).json({ error: 'Uploads are turned off right now.' }); }
    if (state.slowlogin && unsafe && /\/api\/auth\/(login|signup|reset)/.test(path) && bump(loginHits, req.ip, 300000) > 12) { strike(req, 'slowlogin'); res.set('Retry-After', '300'); return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' }); }
    if (state.scrape && req.method === 'GET' && path !== '/api/rev' && path !== '/api/auth/me' && bump(scrapeHits, req.ip, 60000) > 90) { strike(req, 'scrape'); return res.status(429).json({ error: 'Slow down.' }); }
    if (state.sqlguard || state.xssguard) {
      let q = req.originalUrl; try { q = decodeURIComponent(q); } catch (e) { /* raw */ }
      if (state.sqlguard && SQLI.test(q)) { strike(req, 'sqlguard'); return res.status(403).json({ error: 'Blocked: unsafe input.' }); }
      if (state.xssguard && XSS.test(q)) { strike(req, 'xssguard'); return res.status(403).json({ error: 'Blocked: unsafe input.' }); }
      if (unsafe && state.perf !== 'low' && req.body && typeof req.body === 'object') { let b = ''; try { b = JSON.stringify(req.body); } catch (e) { /* skip */ } if (state.sqlguard && SQLI.test(b)) { strike(req, 'sqlguard'); return res.status(403).json({ error: 'Blocked: unsafe input.' }); } if (state.xssguard && XSS.test(b)) { strike(req, 'xssguard'); return res.status(403).json({ error: 'Blocked: unsafe input.' }); } }
    }
    if (state.datashield) {
      const j = res.json;
      res.json = function (obj) { try { const s = JSON.stringify(obj, (k, v) => (/^(password|password_hash|token|secret|api_key|reset_code|otp)$/i.test(k) ? (stats.datashield++, undefined) : v)); if (s !== undefined) { if (!this.get('Content-Type')) this.type('application/json'); this.set('Cache-Control', 'no-store'); return this.send(s); } } catch (e) { /* fall through */ } return j.call(this, obj); };
    }
    next();
  });


  // ---- Performance modes (low power / balanced / max) ----
  const NEW2 = ['dotfiles','methodlock','hpp','longurl','protopollution','nullbyte','burst','conip','hostcheck','slowloris'];
  NEW.push(...NEW2); NEW2.forEach((k) => { if (state[k] === undefined) state[k] = false; stats[k] = 0; });
  state.perf = state.perf || 'balanced'; stats.spill = 0; stats.memory = 0;
  const P = {
    low: { ttl: 30000, cache: 100, anon: 25, open: [40, 100], log: 20, mem: 0.6, always: true },
    balanced: { ttl: 8000, cache: 300, anon: 40, open: [70, 160], log: 50, mem: 0.75, always: false },
    max: { ttl: 8000, cache: 500, anon: 60, open: [150, 300], log: 50, mem: 0.85, always: false }
  };
  const prof = () => P[state.perf] || P.balanced;
  const MEM = { ratio: 0, rssMb: 0, limitMb: Number(process.env.RAM_LIMIT_MB) || 512, spills: 0, last: null, pressure: 0 };
  pool.query('CREATE TABLE IF NOT EXISTS shield_spill (id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), ram_mb INT, reason TEXT, data TEXT)').catch(() => {});
  // Export everything bulky from RAM into the database, then free it. Ban lists stay (tiny) but are saved too and reloaded on restart.
  let spilling = false;
  const spill = async (reason) => {
    if (spilling) return; spilling = true;
    try {
      const data = JSON.stringify({ blocked: blocked.slice(0, 50), stats, autobans: [...autobans], strikes: [...strikes].slice(0, 500), th: { served: TH.served, shed: TH.shed, cached: TH.cached } });
      await pool.query('INSERT INTO shield_spill (ram_mb, reason, data) VALUES ($1,$2,$3)', [MEM.rssMb, reason, data]);
      await pool.query('DELETE FROM shield_spill WHERE id NOT IN (SELECT id FROM shield_spill ORDER BY id DESC LIMIT 20)');
      TH.cache.clear(); TH.anon.clear(); rate.clear(); scrapeHits.clear(); loginHits.clear(); strikes.clear(); burstHits.clear(); blocked.length = 0; TH.recent = [];
      MEM.spills++; stats.spill++; MEM.last = new Date().toISOString(); MEM.pressure = Date.now() + 30000;
      if (global.gc) global.gc();
    } catch (e) { console.error('shield spill:', e.message); } finally { spilling = false; }
  };
  pool.query("SELECT data FROM shield_spill ORDER BY id DESC LIMIT 1").then((r) => { if (r.rows[0]) { const d = JSON.parse(r.rows[0].data); (d.autobans || []).forEach(([ip, t]) => { if (t > Date.now()) autobans.set(ip, t); }); } }).catch(() => {});
  setInterval(() => {
    const m = process.memoryUsage(); MEM.rssMb = Math.round(m.rss / 1048576); MEM.ratio = m.rss / (MEM.limitMb * 1048576);
    if (MEM.ratio > prof().mem) { stats.memory++; spill('RAM ' + Math.round(MEM.ratio * 100) + '% of ' + MEM.limitMb + ' MB'); }
    if (MEM.ratio > 0.9 && state.throttleauto) { TH.auto = true; TH.until = Date.now() + 60000; }
  }, 5000).unref();
  const burstHits = new Map(), ipConc = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of burstHits) if (t - v.t > 5000) burstHits.delete(k); }, 10000).unref();
  const HOSTS = String(process.env.ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const DOT = /(^|\/)\.(git|env|svn|htaccess|htpasswd|ds_store|npmrc|aws|ssh)|\.(bak|old|sql|swp|orig|log|ini|pem|key)$|\/(node_modules|src|scripts|db)\//i;
  const POLL = /"(__proto__|constructor|prototype)"\s*:/;
  app.use((req, res, next) => {
    const path = req.path; if (path === '/healthz' || path === '/readyz') return next();
    if (state.slowloris) { req.setTimeout(20000); res.setTimeout(30000); }
    if (state.methodlock && !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) { strike(req, 'methodlock'); return res.status(405).end(); }
    if (state.longurl && req.originalUrl.length > 2000) { strike(req, 'longurl'); return res.status(414).end(); }
    if (state.nullbyte && /%00|\u0000/.test(req.originalUrl)) { strike(req, 'nullbyte'); return res.status(400).end(); }
    if (state.dotfiles) { let d = path; try { d = decodeURIComponent(path); } catch (e) { /* raw */ } if (DOT.test(d)) { strike(req, 'dotfiles'); return res.status(404).end(); } }
    if (state.hostcheck && HOSTS.length && !HOSTS.includes(String(req.hostname || '').toLowerCase())) { strike(req, 'hostcheck'); return res.status(400).end(); }
    if (state.hpp && Object.values(req.query || {}).some((v) => Array.isArray(v) && v.length > 5)) { strike(req, 'hpp'); return res.status(400).json({ error: 'Bad request.' }); }
    if (state.burst && path !== '/api/rev') { const t = Date.now(); let h = burstHits.get(req.ip); if (!h || t - h.t > 1000) h = { n: 0, t }; h.n++; burstHits.set(req.ip, h); if (h.n > 25) { strike(req, 'burst'); res.set('Retry-After', '2'); return res.status(429).end(); } }
    if (state.conip) { const c = (ipConc.get(req.ip) || 0) + 1; ipConc.set(req.ip, c); let d = false; const f = () => { if (!d) { d = true; const n = (ipConc.get(req.ip) || 1) - 1; if (n <= 0) ipConc.delete(req.ip); else ipConc.set(req.ip, n); } }; res.on('finish', f); res.on('close', f); if (c > 25) { strike(req, 'conip'); return res.status(429).end(); } }
    if (state.protopollution && req.method !== 'GET' && req.body && typeof req.body === 'object') { let b = ''; try { b = JSON.stringify(req.body); } catch (e) { /* skip */ } if (POLL.test(b)) { strike(req, 'protopollution'); return res.status(400).json({ error: 'Bad request.' }); } }
    next();
  });

  // ---- More protocols ----
  const NEW3 = ['ctypecheck','jsondepth','uaguard','hdrspoof','apinostore','tarpit','maxparams','rangeguard','tokenurl','logindelay','geoblock','corsstrict','referercheck'];
  NEW.push(...NEW3); NEW3.forEach((k) => { if (state[k] === undefined) state[k] = false; stats[k] = 0; });
  const GEO = new Set(String(process.env.BLOCK_COUNTRIES || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
  const depth = (o, d = 0) => (d > 12 || !o || typeof o !== 'object' ? d : Math.max(d, ...Object.values(o).slice(0, 200).map((v) => depth(v, d + 1))));
  app.use((req, res, next) => {
    const path = req.path; if (path === '/healthz' || path === '/readyz') return next();
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method), api = path.startsWith('/api');
    if (state.hdrspoof) { ['x-original-url', 'x-rewrite-url', 'x-forwarded-host', 'x-http-method-override', 'x-forwarded-server'].forEach((h) => { delete req.headers[h]; }); }
    if (state.uaguard) { const ua = req.get('user-agent') || ''; if (ua.length > 300 || /[<>{}`$|;]/.test(ua)) { strike(req, 'uaguard'); return res.status(400).end(); } }
    if (state.tokenurl && /[?&](token|access_token|jwt|auth|password)=/i.test(req.originalUrl)) { strike(req, 'tokenurl'); return res.status(400).json({ error: 'Never put secrets in the address.' }); }
    if (state.maxparams && Object.keys(req.query || {}).length > 40) { strike(req, 'maxparams'); return res.status(400).end(); }
    if (state.rangeguard) { const r = req.get('range'); if (r && (r.split(',').length > 4 || /-\s*,/.test(r))) { strike(req, 'rangeguard'); return res.status(416).end(); } }
    if (state.geoblock && GEO.size) { const c = String(req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('x-country-code') || '').toUpperCase(); if (c && GEO.has(c)) { strike(req, 'geoblock'); return res.status(403).type('text/plain').send('Not available in your region.'); } }
    if (state.corsstrict) { const o = req.get('origin'); if (o) { try { if (new URL(o).host !== req.get('host')) { strike(req, 'corsstrict'); return res.status(403).end(); } } catch (e) { return res.status(403).end(); } } res.removeHeader && res.removeHeader('Access-Control-Allow-Origin'); }
    if (api && unsafe && state.ctypecheck && Number(req.get('content-length') || 0) > 0 && !/(json|x-www-form-urlencoded|multipart\/form-data|text\/plain|image\/)/i.test(req.get('content-type') || '')) { strike(req, 'ctypecheck'); return res.status(415).json({ error: 'Unsupported content type.' }); }
    if (api && unsafe && state.referercheck && !['/api/auth/login'].includes(path)) { const o = req.get('origin') || req.get('referer'); if (o) { try { if (new URL(o).host !== req.get('host')) { strike(req, 'referercheck'); return res.status(403).json({ error: 'Blocked.' }); } } catch (e) { return res.status(403).end(); } } }
    if (state.jsondepth && req.body && typeof req.body === 'object' && depth(req.body) > 10) { strike(req, 'jsondepth'); return res.status(400).json({ error: 'Data too deeply nested.' }); }
    if (api && state.apinostore) { res.set('Cache-Control', 'no-store, private'); res.set('Pragma', 'no-cache'); }
    const delay = (state.tarpit && (strikes.get(req.ip) || { n: 0 }).n >= 3 ? 1500 : 0) + (state.logindelay && unsafe && /\/api\/auth\/login/.test(path) ? 700 : 0);
    if (delay) return setTimeout(next, delay);
    next();
  });
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
  const view = () => ({ state: { ...Object.fromEntries(NEW.map((k) => [k, !!state[k]])), lockdown: state.lockdown, firewall: state.firewall, readonly: state.readonly, nosignup: state.nosignup, nobots: state.nobots, perf: state.perf, ips: state.ips }, stats, blocked, live: { perf: state.perf, ram: { mb: MEM.rssMb, limit: MEM.limitMb, pct: Math.round(MEM.ratio * 100), spills: MEM.spills, last: MEM.last }, throttle: thOn(), auto: TH.auto, lag: Math.round(TH.lag), open: TH.inflight, served: TH.served, shed: TH.shed, cached: TH.cached } });
  const A = [auth, (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }))];

  app.get('/api/shield', ...A, wrap(async (req, res) => res.json(view())));
  app.put('/api/shield/toggle', ...A, J, wrap(async (req, res) => {
    const k = String((req.body || {}).key || '');
    if (!['lockdown', 'firewall', 'readonly', 'nosignup', 'nobots', ...NEW].includes(k)) return res.status(400).json({ error: 'Unknown switch.' });
    state[k] = !!req.body.on; await save(); await log(req, 'shield-' + k, state[k] ? 'on' : 'off'); res.json(view());
  }));
  app.put('/api/shield/perf', ...A, J, wrap(async (req, res) => {
    const m = String((req.body || {}).mode || ''); if (!P[m]) return res.status(400).json({ error: 'Unknown mode.' });
    state.perf = m; await save(); await log(req, 'shield-perf', m); res.json(view());
  }));
  app.post('/api/shield/spill-now', ...A, wrap(async (req, res) => { await spill('manual export'); await log(req, 'shield-spill', 'manual'); res.json(view()); }));
  app.get('/api/shield/spill', ...A, wrap(async (req, res) => { const r = await pool.query('SELECT id, at, ram_mb, reason FROM shield_spill ORDER BY id DESC LIMIT 20'); res.json(r.rows); }));
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
