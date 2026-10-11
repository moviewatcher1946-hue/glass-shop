// Data guard: (1) leak guard: a password hash can never leave the server inside any JSON answer;
// (2) data-loss tripwire: every 10 minutes the row counts of users, products, orders and order lines are compared with their 24-hour high;
//     a drop of more than 25% sends an alert (Telegram/ntfy, if set up) and shows in Admin+. Planned resets and restores call allowDrop() first.
const T = ['users', 'products', 'orders', 'order_items'], DAY = 144; // 144 samples of 10 minutes
const st = { leaks: 0, hist: [], rows: {}, hi: {}, alerts: 0, lastAlert: 0, grace: 0, checkedAt: null };

function early(app) {
  app.use((req, res, next) => {
    const j = res.json;
    res.json = function (obj) {
      let s; try { s = JSON.stringify(obj); } catch (e) { return j.call(this, obj); }
      if (s === undefined) return j.call(this, obj);
      if (s.includes('"password_hash"')) { st.leaks++; console.warn(`[dataguard] password hash removed from the answer to ${req.method} ${req.path}`); s = JSON.stringify(JSON.parse(s, (k, v) => (k === 'password_hash' ? undefined : v))); }
      if (!this.get('Content-Type')) this.type('application/json');
      return this.send(s);
    };
    next();
  });
}
const allowDrop = () => { st.grace = Date.now() + 30 * 60e3; st.hist = []; };

function mount(app, { pool, auth, admin, notify }) {
  const A = [auth, admin];
  async function check() {
    const cur = {}; for (const t of T) cur[t] = Number((await pool.query(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n);
    const now = Date.now(); st.rows = cur; st.checkedAt = new Date(now).toISOString();
    if (now < st.grace) { st.hist = []; return; }
    st.hist.push(cur); if (st.hist.length > DAY) st.hist.shift();
    for (const t of T) {
      const hi = Math.max(...st.hist.map((h) => h[t])); st.hi[t] = hi;
      if (hi >= 20 && cur[t] < hi * 0.75 && now - st.lastAlert > 6 * 3600e3) {
        st.lastAlert = now; st.alerts++;
        const msg = `DATA ALERT: ${t} fell from ${hi} to ${cur[t]} in the last 24 hours. If you did not do this, restore from Admin > Backup.`;
        console.error('[dataguard] ' + msg); try { notify(msg); } catch (e) {}
      }
    }
  }
  setTimeout(() => check().catch(() => {}), 90e3).unref(); setInterval(() => check().catch(() => {}), 10 * 60e3).unref();
  app.get('/api/plus/p/data-protect', ...A, (req, res) => res.json([{ password_leaks_blocked: st.leaks, tripwire_alerts: st.alerts, last_row_check: st.checkedAt || 'not yet', offsite_backup_encryption: process.env.BACKUP_KEY ? 'on' : 'OFF (set BACKUP_KEY)', backups_sent_off_site: process.env.TELEGRAM_BOT_TOKEN || process.env.NTFY_TOPIC ? 'yes' : 'no' }]));
  app.get('/api/plus/p/data-rows', ...A, (req, res) => res.json(T.map((t) => ({ table_name: t, now: st.rows[t] == null ? null : st.rows[t], high_24h: st.hi[t] == null ? null : st.hi[t] }))));
  app.post('/api/plus/p/act-data-reset-baseline', ...A, (req, res) => { st.hist = []; st.hi = {}; res.json({ message: 'Baseline reset: counts are compared from now on.' }); });
}
module.exports = { early, mount, allowDrop };
