// Boost: extra security, live stats and admin tools.
// server.js calls boost.early(app) near the top, boost.mount(app, {...}) after the other admin tools, and boost.tune(server) once listening.
// Plain Node, no extra packages. State lives in memory (fine for one Render process); a restart clears it.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const sec = require('./security');

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const started = Date.now();
const BAN_MS = 30 * 60e3;
const ALLOWED = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TZ = process.env.SHOP_TZ || 'Asia/Manila';

const stat = { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, lat: [], mins: new Map(), routes: new Map() };
const bans = new Map(); // ip -> { until, why, at }
const strikes = new Map(); // ip -> { n, t }
const vitals = { lcp: [], fcp: [], cls: [], inp: [], ttfb: [] };

// Paths that only bots and scanners ask for (this shop is Node, not WordPress/PHP). 4 strikes in 10 minutes = 30 minute ban.
const SCAN = /^\/(wp-|wordpress|xmlrpc|phpmyadmin|pma\b|\.env|\.git|\.aws|\.ssh|\.ds_store|cgi-bin|actuator|server-status|vendor\/phpunit|boaform|owa\/|autodiscover|config\.(json|php|yml))|\.(php\d?|asp|aspx|jsp|cgi|sql|bak|env|ini|swp)(\?|$)/i;

const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
const push = (arr, v, cap = 300) => { arr.push(v); if (arr.length > cap) arr.shift(); };
const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);

function strike(ip, req, why) {
  if (!ip) return;
  const now = Date.now();
  let s = strikes.get(ip);
  if (!s || now - s.t > 10 * 60e3) s = { n: 0, t: now };
  s.n++; strikes.set(ip, s);
  if (strikes.size > 5000) strikes.clear();
  if (s.n === 1) sec.logEvent('scanner', req, `probe ${String(why).slice(0, 80)}`);
  if (s.n >= 4 && !bans.has(ip)) {
    if (bans.size > 5000) bans.clear();
    bans.set(ip, { until: now + BAN_MS, why: 'scanner probes', at: now });
    sec.logEvent('auto_ban', req, `30 min ban after ${s.n} probes`);
  }
}

const VENDOR = { 'gsap.min.js': 'gsap/dist/gsap.min.js', 'lenis.min.js': 'lenis/dist/lenis.min.js' };

function early(app) {
  app.disable('x-powered-by');

  // Scripts the shop needs are served from this site (installed by npm), so no outside script host is needed and the CSP can say 'self' only.
  app.get('/vendor/:f', (req, res, next) => {
    const rel = VENDOR[req.params.f];
    if (!rel) return next();
    const p = path.join(__dirname, '../node_modules', rel);
    if (!fs.existsSync(p)) return res.status(404).type('text').send('Not installed.');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(p);
  });

  app.use((req, res, next) => {
    const ip = req.ip || '';
    const b = bans.get(ip);
    if (b) { if (Date.now() < b.until) return res.status(403).type('text').send('Blocked.'); bans.delete(ip); }
    if (SCAN.test(req.path)) { strike(ip, req, req.path); return res.status(404).type('text').send('Not found.'); }

    // Same-site check for anything that changes data: a form on another website cannot make a visitor's browser act on this shop.
    if (!/^(GET|HEAD|OPTIONS)$/.test(req.method)) {
      const o = req.get('origin');
      if (o && o !== 'null') {
        let h = '';
        try { h = new URL(o).host; } catch (e) { /* bad header */ }
        if (h !== req.get('host') && !ALLOWED.includes(h)) {
          sec.logEvent('bad_origin', req, `${req.method} ${req.path} from ${o}`);
          return res.status(403).json({ error: 'Blocked: that request came from another website.' });
        }
      }
    }

    // Numbers for Admin Pulse. The 15-second live check is left out so it does not skew the averages.
    if (req.path === '/api/rev') return next();
    const t = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      stat.total++;
      const k = res.statusCode;
      if (k >= 500) stat.s5++; else if (k >= 400) stat.s4++; else if (k >= 300) stat.s3++; else stat.s2++;
      const m = Math.floor(Date.now() / 60000);
      stat.mins.set(m, (stat.mins.get(m) || 0) + 1);
      if (stat.mins.size > 70) for (const key of stat.mins.keys()) if (key < m - 60) stat.mins.delete(key);
      if (req.originalUrl.startsWith('/api')) {
        push(stat.lat, ms, 500);
        const rk = `${req.method} ${req.baseUrl || ''}${req.route ? req.route.path : '?'}`.slice(0, 80);
        let r = stat.routes.get(rk);
        if (!r) { if (stat.routes.size > 200) return; r = { n: 0, sum: 0, max: 0 }; stat.routes.set(rk, r); }
        r.n++; r.sum += ms; if (ms > r.max) r.max = ms;
      }
    });
    next();
  });
}

function mount(app, { pool, auth, admin, wrap }) {
  const A = [auth, admin];
  const q = (s, p) => pool.query(s, p);
  const log = (req, a, d) => q('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, a, String(d || '').slice(0, 500)]).catch(() => {});
  const ipOk = (s) => typeof s === 'string' && s.length <= 64 && /^[0-9a-f:.]+$/i.test(s);

  // Real-visitor speed numbers sent by public/boost.js (a few bytes, once per visit).
  const vit = express.json({ limit: '2kb' });
  app.post('/api/boost/vitals', sec.limiter({ name: 'vitals', windowMs: 60e3, max: 30 }), vit, (req, res) => {
    const b = req.body || {};
    for (const [k, hi] of [['lcp', 60000], ['fcp', 60000], ['inp', 10000], ['ttfb', 60000], ['cls', 10]]) { const v = num(b[k], 0, hi); if (v !== null) push(vitals[k], v); }
    res.status(204).end();
  });

  // Browsers report anything the content security policy blocked; it lands in Admin > System > Security.
  const cspParse = express.json({ type: ['application/csp-report', 'application/json', 'application/reports+json'], limit: '8kb' });
  app.post('/api/boost/csp', sec.limiter({ name: 'csp', windowMs: 60e3, max: 20 }), cspParse, (req, res) => {
    const r = (req.body && (req.body['csp-report'] || req.body)) || {};
    sec.logEvent('csp_block', req, `${r['violated-directive'] || r.effectiveDirective || '?'} blocked ${r['blocked-uri'] || r.blockedURL || '?'}`);
    res.status(204).end();
  });

  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /api/\nAllow: /\n'));
  if (process.env.SECURITY_CONTACT) {
    app.get('/.well-known/security.txt', (req, res) => res.type('text').send(`Contact: ${process.env.SECURITY_CONTACT}\nExpires: ${new Date(Date.now() + 365 * 864e5).toISOString()}\nPreferred-Languages: en\n`));
  }

  /* ---------- Admin Pulse (main admin only) ---------- */
  app.get('/api/admin/boost/stats', ...A, wrap(async (req, res) => {
    const [db, c] = await Promise.all([
      q('SELECT pg_database_size(current_database())::float AS bytes'),
      q('SELECT (SELECT count(*) FROM users)::int users, (SELECT count(*) FROM products)::int products, (SELECT count(*) FROM orders)::int orders, (SELECT count(*) FROM audit_log)::int audit'),
    ]);
    const mem = process.memoryUsage();
    const m = Math.floor(Date.now() / 60000);
    const perMin = []; for (let i = 29; i >= 0; i--) perMin.push(stat.mins.get(m - i) || 0);
    const routes = [...stat.routes].map(([k, v]) => ({ route: k, n: v.n, avg: Math.round(v.sum / v.n), max: Math.round(v.max) })).sort((a, b) => b.avg - a.avg).slice(0, 6);
    const med = (a) => Math.round(pct(a, 0.5) * 100) / 100, p75 = (a) => Math.round(pct(a, 0.75) * 100) / 100;
    res.set('Cache-Control', 'no-store');
    res.json({
      uptime: Math.round((Date.now() - started) / 1000), node: process.version, env: process.env.NODE_ENV || 'dev',
      mem: { rss: mem.rss, heap: mem.heapUsed, heapTotal: mem.heapTotal },
      loop: { mean: Math.round(lag.mean / 1e6 * 10) / 10, p99: Math.round(lag.percentile(99) / 1e6 * 10) / 10 },
      req: { total: stat.total, s2: stat.s2, s3: stat.s3, s4: stat.s4, s5: stat.s5, p50: Math.round(pct(stat.lat, 0.5)), p95: Math.round(pct(stat.lat, 0.95)), perMin },
      routes,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      db: { bytes: db.rows[0].bytes, ...c.rows[0] },
      vitals: { n: vitals.lcp.length, lcp: p75(vitals.lcp), fcp: p75(vitals.fcp), cls: p75(vitals.cls), inp: p75(vitals.inp), ttfb: med(vitals.ttfb) },
      bans: [...bans].filter(([, b]) => b.until > Date.now()).map(([ip, b]) => ({ ip, why: b.why, mins: Math.ceil((b.until - Date.now()) / 60000) })).slice(0, 50),
      events: sec.recentEvents(12),
    });
  }));

  app.post('/api/admin/boost/unban', ...A, wrap(async (req, res) => {
    const ip = req.body && req.body.ip;
    if (!ipOk(ip)) return res.status(400).json({ error: 'Bad address.' });
    bans.delete(ip); strikes.delete(ip);
    await log(req, 'unban', ip);
    res.json({ ok: true });
  }));

  app.post('/api/admin/boost/ban', ...A, wrap(async (req, res) => {
    const ip = req.body && req.body.ip, mins = Math.max(1, Math.min(10080, Number(req.body && req.body.minutes) || 60));
    if (!ipOk(ip)) return res.status(400).json({ error: 'Bad address.' });
    if (ip === req.ip) return res.status(400).json({ error: 'That is your own address.' });
    bans.set(ip, { until: Date.now() + mins * 60e3, why: `by ${req.user.username}`, at: Date.now() });
    await log(req, 'ban', `${ip} for ${mins} min`);
    res.json({ ok: true });
  }));

  // Sales insights: best sellers, best customers, busiest hours and weekdays. Cached 20 seconds so refreshing never hammers the database.
  const ins = new Map();
  app.get('/api/admin/boost/insights', ...A, wrap(async (req, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const hit = ins.get(days);
    res.set('Cache-Control', 'no-store');
    if (hit && Date.now() - hit.t < 20e3) return res.json(hit.v);
    const ok = "o.created_at > now() - make_interval(days => $1::int) AND o.status NOT IN ('cancelled','canceled','declined','rejected')";
    const [top, cust, hours, dows] = await Promise.all([
      q(`SELECT oi.title, sum(oi.quantity)::int qty, sum(oi.quantity*oi.unit_price)::float rev FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${ok} GROUP BY oi.title ORDER BY rev DESC LIMIT 8`, [days]),
      q(`SELECT u.username, count(*)::int orders, sum(o.total)::float spent FROM orders o JOIN users u ON u.id=o.user_id WHERE ${ok} GROUP BY u.username ORDER BY spent DESC LIMIT 5`, [days]),
      q(`SELECT extract(hour from o.created_at AT TIME ZONE $2)::int k, count(*)::int n FROM orders o WHERE ${ok} GROUP BY 1`, [days, TZ]),
      q(`SELECT extract(dow from o.created_at AT TIME ZONE $2)::int k, count(*)::int n FROM orders o WHERE ${ok} GROUP BY 1`, [days, TZ]),
    ]);
    const fill = (rows, n) => { const a = new Array(n).fill(0); rows.forEach((r) => { a[r.k] = r.n; }); return a; };
    const v = { days, top: top.rows, customers: cust.rows, hours: fill(hours.rows, 24), weekdays: fill(dows.rows, 7) };
    if (ins.size > 20) ins.clear();
    ins.set(days, { t: Date.now(), v });
    res.json(v);
  }));

  // Refresh the database's own statistics so queries stay quick after lots of changes.
  app.post('/api/admin/boost/analyze', ...A, wrap(async (req, res) => {
    await pool.query('ANALYZE');
    await log(req, 'db_analyze', 'ANALYZE run from Admin Pulse');
    res.json({ ok: true });
  }));
}

// Called once the server is listening. Render's proxy keeps connections open about a minute; staying slightly longer avoids random 502 errors.
function tune(srv) {
  try { srv.keepAliveTimeout = 65e3; srv.headersTimeout = 66e3; srv.requestTimeout = 120e3; } catch (e) { /* older Node */ }
}

module.exports = { early, mount, tune };
