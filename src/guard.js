// Software protection ("guard"): keeps the shop alive and answering its health check, and notices if its own files are changed.
//
//  1. /healthz answers instantly and never touches the database, so Render's 5 second health check cannot time out
//     (the old route sat behind the database start-up, so a slow database made the deploy look dead).
//  2. Start-up gate: the server starts listening at once; visitors get a friendly "waking up" answer until the database is ready.
//  3. Load shedding: when the server is overloaded (event loop lag, too many requests at once, memory almost full)
//     extra requests get a polite 503 + Retry-After instead of making everything slower for everyone.
//  4. Memory watchdog: warns, sheds, and (in production) does a clean restart before the host kills the process for using too much memory.
//  5. Database circuit breaker: if the database stops answering, requests fail fast instead of piling up.
//  6. Request timeout: no request can hang for more than a minute.
//  7. File integrity: a SHA-256 fingerprint of the app files is taken at start and re-checked every 10 minutes.
//     On a host with read-only deploys a change means something modified the code: it is logged as a security event.
// Plain Node, no extra packages. State is in memory (one server process, which is what Render's free plan runs).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');
const sec = require('./security');

const ROOT = path.join(__dirname, '..');
const BOOT = Date.now();
const num = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const MAX_BUSY = num('GUARD_MAX_INFLIGHT', 120); // requests running at the same time (the 15 s live check is not counted)
const LAG_MS = num('GUARD_LAG_MS', 1500); // event loop delay (p99) that counts as overloaded
const MAX_RSS = num('GUARD_MAX_RSS_MB', 470) * 1048576; // Render's free plan has 512 MB
const REQ_MS = num('GUARD_REQUEST_MS', 60e3);
const AUTO_RESTART = sec.PROD && process.env.GUARD_AUTO_RESTART !== '0';

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

const st = {
  ready: false, readyAt: 0, shedding: true, inflight: 0, lagMs: 0, lagHigh: 0, memHigh: false, memStrikes: 0, restartReason: '',
  shed: { starting: 0, busy: 0, lag: 0, memory: 0, db: 0, timeout: 0 },
  peakInflight: 0, peakRss: 0, peakLag: 0,
};
const br = { until: 0, fails: [], opened: 0 };
let integrity = { baselineAt: 0, checkedAt: 0, ok: true, files: 0, digest: '', changed: [], added: [], removed: [] };
let baseline = null;

const say = (type, detail) => { try { sec.logEvent(type, 'server', detail); } catch (e) { console.warn('[guard]', type, detail); } };

/* ---------- 1 to 3 + 6: health check, start-up gate, load shedding, request timeout ---------- */
const NEVER_SHED = /^\/api\/(auth\/|admin\/guard|shield|rev$|boost\/)/;
const WAKE_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3">'
  + '<title>Snackify is waking up</title><body style="font:16px system-ui,sans-serif;background:#0b1020;color:#eef;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">'
  + '<div><h1 style="font-size:1.4rem;margin:0 0 8px">Snackify is waking up</h1><p style="opacity:.75;margin:0">This takes a few seconds. The page will reload by itself.</p></div>';

function early(app) {
  // Must be the very first thing the app does: no database, no cookies, no other middleware in front of it.
  const ok = (req, res) => { res.set('Cache-Control', 'no-store'); res.type('text/plain').send('ok'); };
  app.get('/healthz', ok);
  app.get('/readyz', (req, res) => { res.set('Cache-Control', 'no-store'); res.status(st.ready ? 200 : 503).type('text/plain').send(st.ready ? 'ready' : 'starting'); });

  app.use((req, res, next) => {
    const p = req.path;
    if (!st.ready) {
      st.shed.starting++;
      res.set('Retry-After', '5').set('Cache-Control', 'no-store');
      if (p.startsWith('/api')) return res.status(503).json({ error: 'The shop is waking up. Try again in a few seconds.' });
      return res.status(503).type('html').send(WAKE_PAGE);
    }
    const live = p === '/api/rev'; // the long poll can wait 15 s by design: not counted as load
    if (!live) {
      st.inflight++; if (st.inflight > st.peakInflight) st.peakInflight = st.inflight;
      let done = false;
      const longJob = /^\/api\/admin\/(export|import|backup)/.test(p); // backups and restores are allowed to take their time
      const timer = longJob ? null : setTimeout(() => { if (!res.headersSent) { st.shed.timeout++; res.status(503).set('Retry-After', '5').json({ error: 'That took too long. Please try again.' }); } }, REQ_MS);
      if (timer) timer.unref();
      res.on('close', () => { if (done) return; done = true; st.inflight--; if (timer) clearTimeout(timer); });
    }
    if (st.shedding && p.startsWith('/api') && !NEVER_SHED.test(p)) {
      let why = '';
      if (st.memHigh) why = 'memory'; else if (st.lagHigh >= 2) why = 'lag'; else if (st.inflight > MAX_BUSY) why = 'busy';
      if (why) {
        st.shed[why]++;
        res.set('Retry-After', '3');
        return res.status(503).json({ error: 'The shop is very busy right now. Please try again in a few seconds.' });
      }
    }
    next();
  });
}

function markReady() { st.ready = true; st.readyAt = Date.now(); say('guard', `ready after ${Math.round((st.readyAt - BOOT) / 100) / 10}s`); }

/* ---------- 4: lag + memory watchdog ---------- */
setInterval(() => {
  const l = lag.percentile(99) / 1e6; lag.reset();
  st.lagMs = Math.round(l * 10) / 10; if (l > st.peakLag) st.peakLag = Math.round(l);
  if (l > LAG_MS) { st.lagHigh++; if (st.lagHigh === 2) say('guard', `overloaded: event loop delay ${Math.round(l)} ms, shedding extra requests`); } else st.lagHigh = 0;
}, 5e3).unref();

setInterval(() => {
  const rss = process.memoryUsage().rss; if (rss > st.peakRss) st.peakRss = rss;
  if (rss > MAX_RSS) {
    if (!st.memHigh) say('guard', `memory high: ${Math.round(rss / 1048576)} MB of ${Math.round(MAX_RSS / 1048576)} MB allowed, shedding extra requests`);
    st.memHigh = true; st.memStrikes++;
    if (typeof global.gc === 'function') global.gc();
    if (AUTO_RESTART && st.memStrikes >= 4 && st.ready) { // about a minute over the limit: restart cleanly before the host kills the process
      st.restartReason = 'memory ' + Math.round(rss / 1048576) + ' MB';
      say('guard', 'restarting cleanly: ' + st.restartReason);
      process.kill(process.pid, 'SIGTERM'); // server.js finishes requests in flight, closes the database, exits; the host starts it again
    }
  } else { st.memHigh = false; st.memStrikes = 0; }
}, 15e3).unref();

/* ---------- 5: database circuit breaker ---------- */
const NET = /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|57P01|57P02|57P03|08000|08001|08003|08004|08006)$/;
function watchPool(pool) {
  const orig = pool.query.bind(pool);
  pool.query = function guarded(...args) {
    if (st.ready && Date.now() < br.until) {
      st.shed.db++;
      return Promise.reject(Object.assign(new Error('The database is not answering. Please try again in a few seconds.'), { status: 503 }));
    }
    const r = orig(...args);
    if (r && typeof r.then === 'function') {
      r.then(() => { if (br.fails.length) br.fails.length = 0; }, (e) => {
        if (!st.ready || !e) return;
        const bad = NET.test(String(e.code || '')) || /timeout exceeded when trying to connect|Connection terminated|connection timeout/i.test(String(e.message || ''));
        if (!bad) return;
        const now = Date.now(); br.fails = br.fails.filter((t) => now - t < 15e3); br.fails.push(now);
        if (br.fails.length >= 5 && now >= br.until) { br.until = now + 10e3; br.opened++; br.fails.length = 0; say('guard', 'database not answering: pausing database calls for 10 s'); }
      });
    }
    return r;
  };
  pool.on('error', () => {}); // db.js already logs it; this only makes sure a late listener can never crash the process
}

/* ---------- 7: file integrity ---------- */
const WATCH = ['src', 'public', 'db', 'package.json', 'render.yaml'];
async function walk(rel, out) {
  const full = path.join(ROOT, rel);
  let stat; try { stat = await fs.promises.stat(full); } catch (e) { return; }
  if (stat.isDirectory()) {
    if (/node_modules|\.git$/.test(rel)) return;
    for (const f of await fs.promises.readdir(full)) await walk(path.join(rel, f), out);
  } else if (stat.size < 5 * 1048576) {
    out[rel.split(path.sep).join('/')] = crypto.createHash('sha256').update(await fs.promises.readFile(full)).digest('hex').slice(0, 16);
  }
}
async function fingerprint() { const out = {}; for (const w of WATCH) await walk(w, out); return out; }
async function scan() {
  const now = await fingerprint();
  const names = Object.keys(now).sort();
  const digest = crypto.createHash('sha256').update(names.map((n) => n + now[n]).join('|')).digest('hex').slice(0, 16);
  if (!baseline) { baseline = now; integrity = { baselineAt: Date.now(), checkedAt: Date.now(), ok: true, files: names.length, digest, changed: [], added: [], removed: [] }; return integrity; }
  const changed = names.filter((n) => n in baseline && baseline[n] !== now[n]);
  const added = names.filter((n) => !(n in baseline));
  const removed = Object.keys(baseline).filter((n) => !(n in now));
  const ok = !changed.length && !added.length && !removed.length;
  if (!ok && integrity.ok) say('tamper', `app files changed since start: ${changed.length} changed, ${added.length} new, ${removed.length} removed (${[...changed, ...added, ...removed].slice(0, 3).join(', ')})`);
  integrity = { baselineAt: integrity.baselineAt, checkedAt: Date.now(), ok, files: names.length, digest, changed: changed.slice(0, 50), added: added.slice(0, 50), removed: removed.slice(0, 50) };
  return integrity;
}
function startIntegrity() {
  setTimeout(() => scan().catch((e) => console.warn('[guard] integrity:', e.message)), 3e3).unref();
  setInterval(() => scan().catch(() => {}), 10 * 60e3).unref();
}

/* ---------- Admin panel data (main admin only) ---------- */
function mount(app, { pool, auth, admin, wrap }) {
  const A = [auth, admin];
  const log = (req, a, d) => pool.query('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, a, String(d || '').slice(0, 500)]).catch(() => {});
  const view = async () => {
    let dbMs = -1; const t = Date.now();
    try { await pool.query('SELECT 1'); dbMs = Date.now() - t; } catch (e) { dbMs = -1; }
    const m = process.memoryUsage();
    return {
      ready: st.ready, bootSeconds: st.readyAt ? Math.round((st.readyAt - BOOT) / 100) / 10 : null, uptime: Math.round((Date.now() - BOOT) / 1000),
      shedding: st.shedding, overloaded: st.lagHigh >= 2 || st.memHigh, inflight: st.inflight, peakInflight: st.peakInflight,
      lagMs: st.lagMs, peakLag: st.peakLag, rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576), peakRssMb: Math.round(st.peakRss / 1048576),
      limits: { busy: MAX_BUSY, lagMs: LAG_MS, rssMb: Math.round(MAX_RSS / 1048576), requestMs: REQ_MS, autoRestart: AUTO_RESTART },
      shed: st.shed, breaker: { open: Date.now() < br.until, opened: br.opened }, dbMs,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, restartReason: st.restartReason, integrity,
    };
  };
  app.get('/api/admin/guard', ...A, wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await view()); }));
  app.post('/api/admin/guard/shedding', ...A, wrap(async (req, res) => { st.shedding = !!(req.body && req.body.on); await log(req, 'guard-shedding', st.shedding ? 'on' : 'off'); res.json(await view()); }));
  app.post('/api/admin/guard/scan', ...A, wrap(async (req, res) => { await scan(); await log(req, 'guard-scan', integrity.ok ? 'files unchanged' : 'FILES CHANGED'); res.json(await view()); }));
  app.get('/api/admin/guard/events', ...A, wrap(async (req, res) => res.json(sec.recentEvents(50))));
  // Which protections are configured. Only yes/no answers: no secret value ever leaves the server.
  app.get('/api/admin/guard/env', ...A, wrap(async (req, res) => {
    const has = (k) => !!process.env[k];
    res.json([
      { name: 'Production mode (NODE_ENV)', ok: sec.PROD, note: sec.PROD ? 'On' : 'Not production: HTTPS-only headers are off' },
      { name: 'Database address', ok: has('DATABASE_URL'), note: has('DATABASE_URL') ? 'Set' : 'Missing' },
      { name: 'Login signing key (JWT_SECRET)', ok: String(process.env.JWT_SECRET || '').length >= 32, note: String(process.env.JWT_SECRET || '').length >= 32 ? 'Set, long enough' : 'Missing or shorter than 32 characters' },
      { name: 'Admin password is long', ok: !has('ADMIN_PASSWORD') || String(process.env.ADMIN_PASSWORD).length >= 12, note: has('ADMIN_PASSWORD') ? (String(process.env.ADMIN_PASSWORD).length >= 12 ? '12+ characters' : 'Under 12 characters, make it longer') : 'Not set (fine once the admin exists)' },
      { name: 'Public address (RENDER_EXTERNAL_URL)', ok: has('RENDER_EXTERNAL_URL'), note: has('RENDER_EXTERNAL_URL') ? 'Set' : 'Missing: Keep server awake cannot work' },
      { name: 'Allowed other origins', ok: true, note: has('ALLOWED_ORIGINS') ? 'Extra origins are allowed' : 'Same site only (safest)' },
      { name: 'Security contact', ok: has('SECURITY_CONTACT'), note: has('SECURITY_CONTACT') ? 'security.txt is published' : 'Not set (optional)' },
      { name: 'Auto restart on memory limit', ok: AUTO_RESTART, note: AUTO_RESTART ? 'On' : 'Off' },
      { name: 'File integrity watch', ok: integrity.files > 0, note: integrity.files ? integrity.files + ' files fingerprinted' : 'Still starting' },
    ]);
  }));
}

module.exports = { early, markReady, mount, watchPool, startIntegrity, scan };
