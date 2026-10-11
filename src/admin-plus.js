// 20 extra admin tools (main admin only). Mounted from server.js: require('./admin-plus')(app, { pool, auth, admin, wrap }).
const os = require('os');

module.exports = function mount(app, { pool, auth, admin, wrap }) {
  const q = (s, p) => pool.query(s, p);
  const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
  const log = (req, a, d) => q('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, a, String(d || '').slice(0, 500)]).catch(() => {});
  const ready = q(`CREATE TABLE IF NOT EXISTS customer_notes (user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS plus_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS orders_user_created ON orders (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
    CREATE INDEX IF NOT EXISTS order_items_order ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS order_items_product ON order_items (product_id);
    CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);`).catch((e) => console.error('admin-plus init:', e.message));

  const cache = {};
  const get = async (k) => { if (cache[k] !== undefined) return cache[k]; await ready; const r = await q('SELECT value FROM plus_settings WHERE key=$1', [k]); return (cache[k] = r.rows[0] ? r.rows[0].value : ''); };
  const set = async (k, v) => { await ready; await q('INSERT INTO plus_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, v]); cache[k] = v; };
  const A = [auth, admin];
  const num = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : d));
  const ids = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isInteger).slice(0, 500) : []);

  // 1 + 2: public announcement and maintenance flag
  app.get('/api/plus/public', wrap(async (req, res) => { res.set('Cache-Control', 'public, max-age=15'); res.json({ announcement: await get('announcement'), maintenance: (await get('maintenance')) === '1' }); }));
  app.put('/api/plus/announcement', ...A, wrap(async (req, res) => { await set('announcement', String((req.body || {}).text || '').slice(0, 300)); await log(req, 'announcement', req.body.text); res.json({ ok: true }); }));
  app.put('/api/plus/maintenance', ...A, wrap(async (req, res) => { await set('maintenance', (req.body || {}).on ? '1' : '0'); await log(req, 'maintenance', req.body.on ? 'on' : 'off'); res.json({ ok: true }); }));
  // Maintenance: only blocks customers placing orders; staff keep working.
  app.use('/api/orders', async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || (await get('maintenance')) !== '1') return next();
    res.status(503).json({ error: 'The shop is paused for maintenance. Please try again soon.' });
  });

  // 3 bulk sold-out toggle, 4 bulk price change, 5 duplicate product
  app.post('/api/plus/products/soldout', ...A, wrap(async (req, res) => { const i = ids(req.body.ids); const r = await q('UPDATE products SET is_sold_out=$2 WHERE id=ANY($1)', [i, !!req.body.soldOut]); await log(req, 'bulk-soldout', `${r.rowCount} items -> ${!!req.body.soldOut}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/price', ...A, wrap(async (req, res) => { const pct = num(req.body.percent, 0, -90, 500); const i = ids(req.body.ids); const r = await q('UPDATE products SET price=ROUND(price*(1+$2::numeric/100),2) WHERE ($1::int[] = ARRAY[]::int[] OR id=ANY($1))', [i, pct]); await log(req, 'bulk-price', `${pct}% on ${r.rowCount} items`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/:id/duplicate', ...A, wrap(async (req, res) => { const r = await q("INSERT INTO products (title,description,price,is_sold_out,image_url,image_data,image_mime) SELECT left(title||' (copy)',200),description,price,is_sold_out,NULL,image_data,image_mime FROM products WHERE id=$1 RETURNING id", [req.params.id]); if (!r.rows[0]) throw bad('Product not found.', 404); await q("UPDATE products SET image_url='/api/products/'||id||'/image' WHERE id=$1 AND image_data IS NOT NULL", [r.rows[0].id]); await log(req, 'duplicate-product', req.params.id); res.json({ id: r.rows[0].id }); }));

  // 6 bulk order status, 7 purge old cancelled orders
  app.post('/api/plus/orders/status', ...A, wrap(async (req, res) => { const s = String(req.body.status || ''); if (!/^[a-z_]{3,20}$/.test(s)) throw bad('Bad status.'); const r = await q('UPDATE orders SET status=$2 WHERE id=ANY($1)', [ids(req.body.ids), s]); await log(req, 'bulk-order-status', `${r.rowCount} -> ${s}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/orders/purge-cancelled', ...A, wrap(async (req, res) => { const d = num(req.body.days, 30, 1, 3650); const r = await q("DELETE FROM orders WHERE status='cancelled' AND created_at < now() - ($1||' days')::interval", [d]); await log(req, 'purge-cancelled', `${r.rowCount} older than ${d}d`); res.json({ deleted: r.rowCount }); }));

  // 8 customer search, 9 customer detail, 10 top customers, 11 notes, 12 inactive customers
  app.get('/api/plus/customers', ...A, wrap(async (req, res) => { const s = '%' + String(req.query.q || '').replace(/[%_\\]/g, '') + '%'; res.json((await q("SELECT u.id,u.username,u.created_at,COUNT(o.id)::int orders,COALESCE(SUM(o.total) FILTER (WHERE o.status<>'cancelled'),0)::float spent,MAX(o.created_at) last_order FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' AND u.username ILIKE $1 GROUP BY u.id ORDER BY u.created_at DESC LIMIT 50", [s])).rows); }));
  app.get('/api/plus/customers/:id', ...A, wrap(async (req, res) => { const [u, o, n] = await Promise.all([q('SELECT id,username,role,created_at FROM users WHERE id=$1', [req.params.id]), q('SELECT id,total::float,status,created_at FROM orders WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [req.params.id]), q('SELECT note FROM customer_notes WHERE user_id=$1', [req.params.id])]); if (!u.rows[0]) throw bad('Customer not found.', 404); res.json({ user: u.rows[0], orders: o.rows, note: (n.rows[0] || {}).note || '' }); }));
  app.get('/api/plus/top-customers', ...A, wrap(async (req, res) => res.json((await q("SELECT u.id,u.username,COUNT(o.id)::int orders,SUM(o.total)::float spent FROM users u JOIN orders o ON o.user_id=u.id WHERE o.status<>'cancelled' GROUP BY u.id ORDER BY spent DESC LIMIT 10")).rows)));
  app.put('/api/plus/customers/:id/note', ...A, wrap(async (req, res) => { await ready; await q('INSERT INTO customer_notes (user_id,note) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET note=$2, updated_at=now()', [req.params.id, String(req.body.note || '').slice(0, 1000)]); res.json({ ok: true }); }));
  app.get('/api/plus/inactive', ...A, wrap(async (req, res) => res.json((await q("SELECT u.id,u.username,u.created_at,MAX(o.created_at) last_order FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id HAVING MAX(o.created_at) IS NULL OR MAX(o.created_at) < now() - interval '60 days' ORDER BY u.created_at DESC LIMIT 50")).rows)));

  // 13 sales summary, 14 best sellers, 15 revenue by day
  app.get('/api/plus/summary', ...A, wrap(async (req, res) => res.json((await q("SELECT COALESCE(SUM(total) FILTER (WHERE created_at>=date_trunc('day',now())),0)::float today, COALESCE(SUM(total) FILTER (WHERE created_at>=now()-interval '7 days'),0)::float week, COALESCE(SUM(total) FILTER (WHERE created_at>=now()-interval '30 days'),0)::float month, COUNT(*) FILTER (WHERE status='pending')::int pending, COUNT(*)::int orders FROM orders WHERE status<>'cancelled'")).rows[0])));
  app.get('/api/plus/best-sellers', ...A, wrap(async (req, res) => res.json((await q("SELECT i.title,SUM(i.quantity)::int sold,SUM(i.quantity*i.unit_price)::float revenue FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'cancelled' GROUP BY i.title ORDER BY sold DESC LIMIT 10")).rows)));
  app.get('/api/plus/daily', ...A, wrap(async (req, res) => res.json((await q("SELECT to_char(d,'MM-DD') day, COALESCE(SUM(o.total),0)::float revenue, COUNT(o.id)::int orders FROM generate_series(current_date-13,current_date,'1 day') d LEFT JOIN orders o ON o.created_at::date=d AND o.status<>'cancelled' GROUP BY d ORDER BY d")).rows)));

  // 16 database stats, 17 server health, 18 trim audit log, 19 orders CSV, 20 optimize database
  app.get('/api/plus/db-stats', ...A, wrap(async (req, res) => res.json((await q("SELECT relname name, n_live_tup::int rows, pg_size_pretty(pg_total_relation_size(relid)) size FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC")).rows)));
  app.get('/api/plus/health', ...A, wrap(async (req, res) => { const t = Date.now(); await q('SELECT 1'); const m = process.memoryUsage(); res.json({ uptimeMin: Math.round(process.uptime() / 60), rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), dbPingMs: Date.now() - t, node: process.version, load: os.loadavg()[0].toFixed(2), pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } }); }));
  app.post('/api/plus/audit/trim', ...A, wrap(async (req, res) => { const d = num(req.body.days, 30, 1, 3650); const r = await q("DELETE FROM audit_log WHERE at < now() - ($1||' days')::interval", [d]); await log(req, 'trim-audit', `${r.rowCount} rows`); res.json({ deleted: r.rowCount }); }));
  app.get('/api/plus/orders.csv', ...A, wrap(async (req, res) => { const r = await q('SELECT o.id,u.username,o.total,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 10000'); const esc = (v) => { v = String(v instanceof Date ? v.toISOString() : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }; const row = (a) => a.map((v) => '"' + esc(v).replace(/"/g, '""') + '"').join(','); res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=orders.csv' }); res.send([row(['id', 'customer', 'total', 'status', 'created'])].concat(r.rows.map((x) => row([x.id, x.username, x.total, x.status, x.created_at]))).join('\n')); }));
  app.post('/api/plus/optimize', ...A, wrap(async (req, res) => { await q('ANALYZE'); await log(req, 'optimize-db', 'ANALYZE'); res.json({ ok: true }); }));
};
