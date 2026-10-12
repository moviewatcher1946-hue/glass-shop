// 20 extra admin tools (main admin only). Mounted from server.js: require('./admin-plus')(app, { pool, auth, admin, wrap }).
const os = require('os');

const SYS = { hours: false, open: 8, close: 22, slowlog: false, slowms: 1000, trim: false, trimdays: 30, optimize: false, purge: false, purgedays: 90, awake: false };
const SYSR = { hours: 'b', open: [0, 23], close: [1, 24], slowlog: 'b', slowms: [100, 30000], trim: 'b', trimdays: [1, 3650], optimize: 'b', purge: 'b', purgedays: [1, 3650], awake: 'b' };
const PERF = { lite: false, nomotion: false, noglow: false, lazy: false, nohover: false, slowrefresh: false };
const shared = { sys: { ...SYS }, slow: [] };

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
  const readJ = async (k, d) => { try { return { ...d, ...JSON.parse((await get(k)) || '{}') }; } catch (e) { return { ...d }; } };
  ready.then(() => readJ('sys', SYS)).then((v) => Object.assign(shared.sys, v)).catch(() => {});
  app.get('/api/plus/public', wrap(async (req, res) => { res.set('Cache-Control', 'public, max-age=15'); res.json({ announcement: await get('announcement'), maintenance: (await get('maintenance')) === '1', perf: await readJ('perf', PERF) }); }));
  app.put('/api/plus/announcement', ...A, wrap(async (req, res) => { await set('announcement', String((req.body || {}).text || '').slice(0, 300)); await log(req, 'announcement', req.body.text); res.json({ ok: true }); }));
  app.put('/api/plus/maintenance', ...A, wrap(async (req, res) => { await set('maintenance', (req.body || {}).on ? '1' : '0'); await log(req, 'maintenance', req.body.on ? 'on' : 'off'); res.json({ ok: true }); }));
  // Maintenance and shop hours only stop customers placing new orders; staff keep working.
  app.use('/api/orders', async (req, res, next) => {
    if (req.method !== 'POST' || req.path !== '/') return next();
    if ((await get('maintenance')) === '1') return res.status(503).json({ error: 'The shop is paused for maintenance. Please try again soon.' });
    const c = shared.sys;
    if (c.hours) {
      const h = new Date(Date.now() + 8 * 3600e3).getUTCHours();
      const open = c.open <= c.close ? h >= c.open && h < c.close : h >= c.open || h < c.close;
      if (!open) return res.status(503).json({ error: `The shop takes orders from ${c.open}:00 to ${c.close}:00 (Philippine time).` });
    }
    next();
  });

  // Performance modes (applied by every visitor's browser) and system settings
  app.get('/api/plus/perf', ...A, wrap(async (req, res) => res.json(await readJ('perf', PERF))));
  app.put('/api/plus/perf', ...A, wrap(async (req, res) => { const cur = await readJ('perf', PERF), b = req.body || {}; for (const k of Object.keys(PERF)) if (k in b) cur[k] = !!b[k]; await set('perf', JSON.stringify(cur)); await log(req, 'performance', Object.keys(cur).filter((k) => cur[k]).join(',') || 'balanced'); res.json(cur); }));
  app.get('/api/plus/sys', ...A, wrap(async (req, res) => res.json({ sys: shared.sys, slow: shared.slow })));
  app.put('/api/plus/sys', ...A, wrap(async (req, res) => { const { key, value } = req.body || {}, r = SYSR[key]; if (!r) throw bad('Unknown setting.'); shared.sys[key] = r === 'b' ? !!value : Math.round(num(value, shared.sys[key], r[0], r[1])); await set('sys', JSON.stringify(shared.sys)); await log(req, 'system-setting', `${key} = ${shared.sys[key]}`); res.json({ sys: shared.sys }); }));
  let lastDaily = 0;
  const tick = async () => {
    const c = shared.sys;
    try {
      if (c.awake && process.env.RENDER_EXTERNAL_URL && typeof fetch === 'function') fetch(process.env.RENDER_EXTERNAL_URL + '/healthz').catch(() => {});
      if (Date.now() - lastDaily > 24 * 3600e3) {
        lastDaily = Date.now();
        if (c.trim) await q("DELETE FROM audit_log WHERE at < now() - ($1||' days')::interval", [c.trimdays]);
        if (c.purge) await q("DELETE FROM orders WHERE status='cancelled' AND created_at < now() - ($1||' days')::interval", [c.purgedays]);
        if (c.optimize) await q('ANALYZE');
      }
    } catch (e) { console.error('admin-plus tick:', e.message); }
  };
  setInterval(tick, 10 * 60e3).unref(); setTimeout(tick, 60e3).unref();

  // 3 bulk sold-out toggle, 4 bulk price change, 5 duplicate product
  app.post('/api/plus/products/soldout', ...A, wrap(async (req, res) => { const i = ids(req.body.ids); const r = await q('UPDATE products SET is_sold_out=$2 WHERE id=ANY($1)', [i, !!req.body.soldOut]); await log(req, 'bulk-soldout', `${r.rowCount} items -> ${!!req.body.soldOut}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/price', ...A, wrap(async (req, res) => { const pct = num(req.body.percent, 0, -90, 500); const i = ids(req.body.ids); const r = await q('UPDATE products SET price=ROUND(price*(1+$2::numeric/100),2) WHERE ($1::int[] = ARRAY[]::int[] OR id=ANY($1))', [i, pct]); await log(req, 'bulk-price', `${pct}% on ${r.rowCount} items`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/:id/duplicate', ...A, wrap(async (req, res) => { const r = await q("INSERT INTO products (title,description,price,is_sold_out,image_data,image_mime,category,discount_until,discount_percent,bulk_min,bulk_percent,stock,cost,owner_id) SELECT left(title||' (copy)',200),description,price,is_sold_out,image_data,image_mime,category,discount_until,discount_percent,bulk_min,bulk_percent,stock,cost,owner_id FROM products WHERE id=$1 RETURNING id", [req.params.id]); if (!r.rows[0]) throw bad('Product not found.', 404); await q("UPDATE products SET image_url='/api/products/'||id||'/image' WHERE id=$1 AND image_data IS NOT NULL", [r.rows[0].id]); await log(req, 'duplicate-product', req.params.id); res.json({ id: r.rows[0].id }); }));

// 6 bulk order status, 7 purge old cancelled orders
  app.post('/api/plus/orders/status', ...A, wrap(async (req, res) => { const s = String(req.body.status || ''); if (!['pending', 'packed', 'completed', 'cancelled'].includes(s)) throw bad('Status must be pending, packed, completed or cancelled.'); const r = await q('UPDATE orders SET status=$2 WHERE id=ANY($1)', [ids(req.body.ids), s]); await log(req, 'bulk-order-status', `${r.rowCount} -> ${s}`); res.json({ changed: r.rowCount }); }));
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

  // ===== 30 more tools =====
  const G = (path, sql, fn) => app.get('/api/plus/' + path, ...A, wrap(async (req, res) => { const r = await q(sql, fn ? fn(req) : []); res.json(r.rows); }));
  // Inventory
  G('low-stock', "SELECT id,title,stock FROM products WHERE stock IS NOT NULL AND stock <= $1 ORDER BY stock,id LIMIT 100", (r) => [num(r.query.n, 5, 0, 9999)]);
  app.post('/api/plus/products/stock', ...A, wrap(async (req, res) => { const n = Math.round(num(req.body.stock, 0, 0, 999999)); const r = await q('UPDATE products SET stock=$2 WHERE id=ANY($1)', [ids(req.body.ids), n]); await log(req, 'set-stock', `${r.rowCount} items -> ${n}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/stock-adjust', ...A, wrap(async (req, res) => { const n = Math.round(num(req.body.delta, 0, -99999, 99999)); const r = await q('UPDATE products SET stock=GREATEST(0,stock+$2) WHERE stock IS NOT NULL AND id=ANY($1)', [ids(req.body.ids), n]); await log(req, 'adjust-stock', `${r.rowCount} items by ${n}`); res.json({ changed: r.rowCount }); }));
  G('sold-out', 'SELECT id,title,price::float FROM products WHERE is_sold_out ORDER BY id DESC LIMIT 200');
  G('never-sold', "SELECT p.id,p.title,p.price::float FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id=p.id) ORDER BY p.id DESC LIMIT 100");
  // Catalog
  G('price-overview', 'SELECT COUNT(*)::int products, MIN(price)::float cheapest, MAX(price)::float priciest, ROUND(AVG(price),2)::float average FROM products');
  app.post('/api/plus/products/pin', ...A, wrap(async (req, res) => { const r = await q('UPDATE products SET pinned=$2 WHERE id=ANY($1)', [ids(req.body.ids), !!req.body.pinned]); await log(req, 'pin', `${r.rowCount} -> ${!!req.body.pinned}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/discount', ...A, wrap(async (req, res) => { const pct = Math.round(num(req.body.percent, 0, 0, 90)); const days = num(req.body.days, 7, 1, 365); const i = ids(req.body.ids); const r = await q("UPDATE products SET discount_percent=$2, discount_until=now()+($3||' days')::interval WHERE ($1::int[]=ARRAY[]::int[] OR id=ANY($1))", [i, pct, days]); await log(req, 'bulk-discount', `${pct}% for ${days}d on ${r.rowCount}`); res.json({ changed: r.rowCount }); }));
  app.post('/api/plus/products/clear-discounts', ...A, wrap(async (req, res) => { const r = await q('UPDATE products SET discount_percent=0, discount_until=NULL WHERE discount_percent>0'); await log(req, 'clear-discounts', r.rowCount); res.json({ changed: r.rowCount }); }));
  G('categories', "SELECT p.category, COUNT(DISTINCT p.id)::int products, COALESCE(SUM(i.quantity*i.unit_price) FILTER (WHERE o.status<>'cancelled'),0)::float revenue FROM products p LEFT JOIN order_items i ON i.product_id=p.id LEFT JOIN orders o ON o.id=i.order_id GROUP BY p.category ORDER BY revenue DESC");
  app.post('/api/plus/products/move-category', ...A, wrap(async (req, res) => { const f = String(req.body.from || '').slice(0, 30), t = String(req.body.to || '').slice(0, 30); if (!f || !t) throw bad('Fill both categories.'); const r = await q('UPDATE products SET category=$2 WHERE category=$1', [f, t]); await log(req, 'move-category', `${f} -> ${t} (${r.rowCount})`); res.json({ changed: r.rowCount }); }));
  G('missing-images', 'SELECT id,title FROM products WHERE image_data IS NULL ORDER BY id DESC LIMIT 100');
  G('duplicate-titles', 'SELECT lower(title) title, COUNT(*)::int copies, array_to_string(array_agg(id),\',\') ids FROM products GROUP BY lower(title) HAVING COUNT(*)>1 ORDER BY copies DESC LIMIT 100');
  app.get('/api/plus/products.csv', ...A, wrap(async (req, res) => { const r = await q('SELECT id,title,price,category,stock,cost,is_sold_out FROM products ORDER BY id'); const esc = (v) => { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }; const row = (a) => a.map((v) => '"' + esc(v).replace(/"/g, '""') + '"').join(','); res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=products.csv' }); res.send([row(['id', 'title', 'price', 'category', 'stock', 'cost', 'sold_out'])].concat(r.rows.map((x) => row([x.id, x.title, x.price, x.category, x.stock, x.cost, x.is_sold_out]))).join('\n')); }));
  // Orders
  G('stale-pending', "SELECT o.id,u.username,o.total::float,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='pending' AND o.created_at < now()-interval '24 hours' ORDER BY o.id LIMIT 100");
  G('status-counts', 'SELECT status, COUNT(*)::int orders, COALESCE(SUM(total),0)::float total FROM orders GROUP BY status ORDER BY orders DESC');
  app.get('/api/plus/orders/:id/detail', ...A, wrap(async (req, res) => { const [o, i] = await Promise.all([q('SELECT o.id,o.total::float,o.status,o.created_at,u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1', [req.params.id]), q('SELECT title,quantity,unit_price::float FROM order_items WHERE order_id=$1 ORDER BY id', [req.params.id])]); if (!o.rows[0]) throw bad('Order not found.', 404); res.json({ order: o.rows[0], items: i.rows }); }));
  app.post('/api/plus/orders/complete', ...A, wrap(async (req, res) => { const r = await q("UPDATE orders SET status='completed' WHERE status<>'cancelled' AND id=ANY($1)", [ids(req.body.ids)]); await log(req, 'bulk-complete', `${r.rowCount} orders`); res.json({ changed: r.rowCount }); }));
  // People
  G('repeat-customers', "SELECT COUNT(*) FILTER (WHERE n=1)::int one_time, COUNT(*) FILTER (WHERE n>1)::int repeat, COUNT(*)::int buyers FROM (SELECT user_id, COUNT(*) n FROM orders WHERE status<>'cancelled' GROUP BY user_id) t");
  G('never-ordered', "SELECT u.id,u.username,u.created_at FROM users u WHERE u.role='customer' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id) ORDER BY u.created_at DESC LIMIT 100");
  // Insights
  G('favorited', 'SELECT p.title, COUNT(*)::int hearts FROM favorites f JOIN products p ON p.id=f.product_id GROUP BY p.id ORDER BY hearts DESC LIMIT 15');
  G('peak-hours', "SELECT lpad(EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Manila')::int::text,2,'0')||':00' label, COUNT(*)::int orders FROM orders WHERE status<>'cancelled' GROUP BY 1 ORDER BY 1");
  G('weekdays', "SELECT to_char(created_at AT TIME ZONE 'Asia/Manila','Dy') label, EXTRACT(isodow FROM created_at AT TIME ZONE 'Asia/Manila')::int d, COUNT(*)::int orders FROM orders WHERE status<>'cancelled' GROUP BY 1,2 ORDER BY 2");
  G('monthly', "SELECT to_char(m,'YY-MM') label, COALESCE(SUM(o.total),0)::float revenue FROM generate_series(date_trunc('month',now())-interval '11 months',date_trunc('month',now()),'1 month') m LEFT JOIN orders o ON date_trunc('month',o.created_at)=m AND o.status<>'cancelled' GROUP BY m ORDER BY m");
  G('signups', "SELECT to_char(d,'MM-DD') label, COUNT(u.id)::int signups FROM generate_series(current_date-13,current_date,'1 day') d LEFT JOIN users u ON u.created_at::date=d AND u.role='customer' GROUP BY d ORDER BY d");
  G('owner-revenue', "SELECT COALESCE(u.username,'(no owner)') owner, COALESCE(SUM(i.quantity*i.unit_price),0)::float revenue, COALESCE(SUM(i.quantity),0)::int sold FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' JOIN products p ON p.id=i.product_id LEFT JOIN users u ON u.id=p.owner_id GROUP BY 1 ORDER BY revenue DESC LIMIT 20");
  G('profit', "SELECT COALESCE(SUM(i.quantity*i.unit_price),0)::float revenue, COALESCE(SUM(i.quantity*COALESCE(p.cost,0)),0)::float cost, COALESCE(SUM(i.quantity*(i.unit_price-COALESCE(p.cost,0))),0)::float profit FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' LEFT JOIN products p ON p.id=i.product_id");
  G('aov', "SELECT ROUND(AVG(total),2)::float avg_order, ROUND((SELECT AVG(c) FROM (SELECT SUM(quantity) c FROM order_items GROUP BY order_id) x),2)::float items_per_order, MAX(total)::float biggest FROM orders WHERE status<>'cancelled'");
  // System
  G('recent-activity', 'SELECT at,username,action,detail FROM audit_log ORDER BY id DESC LIMIT 40');
  G('activity-users', "SELECT username, COUNT(*)::int actions, MAX(at) last FROM audit_log WHERE at > now()-interval '7 days' GROUP BY username ORDER BY actions DESC LIMIT 20");

  // ===== 50 more tools (v3): catalog, inventory, orders, people, insights, system =====
  const MNL = "(now() AT TIME ZONE 'Asia/Manila')::date"; // today in Philippine time
  const OD = "(o.created_at AT TIME ZONE 'Asia/Manila')::date";
  // Catalog
  G('free-products', 'SELECT id,title,price::float FROM products WHERE price=0 ORDER BY id DESC LIMIT 100');
  G('active-discounts', 'SELECT id,title,discount_percent pct,discount_until FROM products WHERE discount_percent>0 AND (discount_until IS NULL OR discount_until>now()) ORDER BY discount_percent DESC,id LIMIT 100');
  G('discounts-ending', "SELECT id,title,discount_percent pct,discount_until FROM products WHERE discount_percent>0 AND discount_until BETWEEN now() AND now()+interval '7 days' ORDER BY discount_until LIMIT 100");
  G('low-margin', 'SELECT id,title,price::float,cost::float,ROUND((price-cost)/NULLIF(price,0)*100,1)::float margin FROM products WHERE cost IS NOT NULL AND price>0 ORDER BY (price-cost)/price,id LIMIT 30');
  G('no-cost', 'SELECT id,title,price::float FROM products WHERE cost IS NULL ORDER BY id DESC LIMIT 100');
  G('bulk-deals', 'SELECT id,title,bulk_min,bulk_percent FROM products WHERE bulk_min IS NOT NULL AND bulk_percent>0 ORDER BY id DESC LIMIT 100');
  G('newest-products', 'SELECT id,title,price::float,created_at FROM products ORDER BY id DESC LIMIT 20');
  G('products-per-owner', "SELECT COALESCE(u.username,'(no owner)') owner, COUNT(*)::int products FROM products p LEFT JOIN users u ON u.id=p.owner_id GROUP BY 1 ORDER BY products DESC LIMIT 20");
  app.post('/api/plus/products/unpin-all', ...A, wrap(async (req, res) => { const r = await q('UPDATE products SET pinned=false WHERE pinned'); await log(req, 'unpin-all', r.rowCount + ' products'); res.json({ changed: r.rowCount }); }));
  G('hidden-products', 'SELECT p.id,p.title,u.username owner FROM products p JOIN users u ON u.id=p.owner_id WHERE u.products_hidden ORDER BY p.id DESC LIMIT 100');
  // Inventory
  G('out-of-stock', 'SELECT id,title,is_sold_out FROM products WHERE stock=0 ORDER BY id DESC LIMIT 100');
  G('stock-value', 'SELECT COALESCE(SUM(stock*cost),0)::float at_cost, COALESCE(SUM(stock*price),0)::float at_price, COALESCE(SUM(stock),0)::int units, COUNT(*)::int tracked FROM products WHERE stock IS NOT NULL');
  G('overstocked', 'SELECT id,title,stock FROM products WHERE stock>=50 ORDER BY stock DESC LIMIT 100');
  G('stock-runway', "SELECT p.id,p.title,p.stock,s.sold::int sold30,ROUND(p.stock/(s.sold/30.0),1)::float days_left FROM products p JOIN (SELECT i.product_id, SUM(i.quantity) sold FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' AND o.created_at>now()-interval '30 days' GROUP BY i.product_id) s ON s.product_id=p.id WHERE p.stock>0 AND s.sold>0 ORDER BY p.stock/(s.sold/30.0) LIMIT 30");
  app.post('/api/plus/products/sync-soldout', ...A, wrap(async (req, res) => {
    const a = await q('UPDATE products SET is_sold_out=true WHERE stock=0 AND NOT is_sold_out');
    const b = await q('UPDATE products SET is_sold_out=false WHERE stock>0 AND is_sold_out');
    await log(req, 'sync-soldout', `${a.rowCount} marked sold out, ${b.rowCount} put back in stock`); res.json({ changed: a.rowCount + b.rowCount });
  }));
  G('untracked-stock', 'SELECT id,title,price::float FROM products WHERE stock IS NULL ORDER BY id DESC LIMIT 100');
  // Orders
  G('orders-today', `SELECT o.id,u.username,o.total::float,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE ${OD}=${MNL} ORDER BY o.id DESC LIMIT 100`);
  G('unpaid-orders', "SELECT o.id,u.username,o.total::float,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.paid_at IS NULL AND o.status<>'cancelled' ORDER BY o.id DESC LIMIT 100");
  G('cancelled-recent', "SELECT o.id,u.username,o.total::float,COALESCE(o.cancel_reason,'') reason,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='cancelled' ORDER BY o.id DESC LIMIT 50");
  G('cancel-reasons', "SELECT COALESCE(NULLIF(trim(cancel_reason),''),'(none given)') reason, COUNT(*)::int orders FROM orders WHERE status='cancelled' GROUP BY 1 ORDER BY orders DESC LIMIT 15");
  G('biggest-orders', "SELECT o.id,u.username,o.total::float,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status<>'cancelled' ORDER BY o.total DESC LIMIT 10");
  G('orders-with-notes', "SELECT o.id,u.username,o.note,o.status FROM orders o JOIN users u ON u.id=o.user_id WHERE o.note<>'' ORDER BY o.id DESC LIMIT 50");
  G('pending-age', "SELECT label, COUNT(*)::int orders FROM (SELECT CASE WHEN h<1 THEN '1) under 1 hour' WHEN h<6 THEN '2) 1 to 6 hours' WHEN h<24 THEN '3) 6 to 24 hours' ELSE '4) over 24 hours' END label FROM (SELECT EXTRACT(EPOCH FROM now()-created_at)/3600 h FROM orders WHERE status='pending') a) b GROUP BY label ORDER BY label");
  G('today-vs-yesterday', `SELECT COALESCE(SUM(total) FILTER (WHERE d=t),0)::float today, COALESCE(SUM(total) FILTER (WHERE d=t-1),0)::float yesterday, COALESCE(SUM(total) FILTER (WHERE d=t-7),0)::float last_week, COUNT(*) FILTER (WHERE d=t)::int orders_today, COUNT(*) FILTER (WHERE d=t-1)::int orders_yesterday FROM (SELECT total,(created_at AT TIME ZONE 'Asia/Manila')::date d,${MNL} t FROM orders WHERE status<>'cancelled' AND created_at>now()-interval '9 days') x`);
  G('items-today', `SELECT i.title, SUM(i.quantity)::int qty FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status<>'cancelled' AND ${OD}=${MNL} GROUP BY i.title ORDER BY qty DESC LIMIT 15`);
  G('promo-performance', 'SELECT code,percent,used_count,max_uses,is_active FROM promo_codes ORDER BY used_count DESC,id DESC LIMIT 50');
  // People
  G('new-customers', "SELECT id,username,created_at FROM users WHERE role='customer' AND created_at>now()-interval '7 days' ORDER BY id DESC LIMIT 100");
  G('sellers-overview', "SELECT u.id,u.username,(SELECT COUNT(*) FROM products p WHERE p.owner_id=u.id)::int products,COALESCE((SELECT SUM(i.quantity*i.unit_price) FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' WHERE i.owner_id=u.id),0)::float revenue,u.products_hidden hidden FROM users u WHERE u.role='seller' ORDER BY revenue DESC LIMIT 50");
  G('top-spenders-30', "SELECT u.username,COUNT(o.id)::int orders,SUM(o.total)::float spent FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status<>'cancelled' AND o.created_at>now()-interval '30 days' GROUP BY u.id,u.username ORDER BY spent DESC LIMIT 10");
  G('must-change', 'SELECT id,username,role,temp_expires FROM users WHERE must_change ORDER BY id DESC LIMIT 100');
  G('recent-resets', 'SELECT u.username,r.created_at,b.username reset_by FROM password_resets r JOIN users u ON u.id=r.user_id LEFT JOIN users b ON b.id=r.by_id ORDER BY r.id DESC LIMIT 30');
  G('blocked-customers', 'SELECT u.username,b.shop_wide,b.reason,b.created_at,s.username blocker FROM customer_blocks b JOIN users u ON u.id=b.user_id LEFT JOIN users s ON s.id=b.blocked_by ORDER BY b.id DESC LIMIT 100');
  G('shared-signup-ip', "SELECT signup_ip ip,COUNT(*)::int accounts,string_agg(username,', ' ORDER BY id) users FROM users WHERE role='customer' AND signup_ip IS NOT NULL AND signup_ip<>'' GROUP BY signup_ip HAVING COUNT(*)>=5 ORDER BY accounts DESC LIMIT 30");
  G('requests-waiting', "SELECT r.id,u.username,LEFT(r.description,60) request,r.created_at FROM custom_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.id LIMIT 100");
  // Insights
  G('revenue-week', `SELECT to_char(d,'Dy MM-DD') label, COALESCE(SUM(o.total),0)::float revenue FROM generate_series(${MNL}-6,${MNL},'1 day') d LEFT JOIN orders o ON ${OD}=d::date AND o.status<>'cancelled' GROUP BY d ORDER BY d`);
  G('sales-by-hour-today', `SELECT lpad(h::text,2,'0')||':00' label, COUNT(o.id)::int orders FROM generate_series(0,23) h LEFT JOIN orders o ON EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Manila')=h AND ${OD}=${MNL} AND o.status<>'cancelled' GROUP BY h ORDER BY h`);
  G('best-sellers-7', "SELECT i.title,SUM(i.quantity)::int sold FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' WHERE o.created_at>now()-interval '7 days' GROUP BY i.title ORDER BY sold DESC LIMIT 10");
  G('slow-movers', "SELECT p.id,p.title,COALESCE(s.sold,0)::int sold30 FROM products p LEFT JOIN (SELECT i.product_id, SUM(i.quantity) sold FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' AND o.created_at>now()-interval '30 days' GROUP BY i.product_id) s ON s.product_id=p.id WHERE COALESCE(s.sold,0)<=2 AND NOT p.is_sold_out ORDER BY sold30,p.id LIMIT 50");
  G('fav-never-sold', 'SELECT p.id,p.title,COUNT(f.user_id)::int hearts FROM favorites f JOIN products p ON p.id=f.product_id WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id=p.id) GROUP BY p.id,p.title ORDER BY hearts DESC LIMIT 30');
  G('category-30', "SELECT p.category label,COALESCE(SUM(i.quantity*i.unit_price),0)::float revenue FROM order_items i JOIN orders o ON o.id=i.order_id AND o.status<>'cancelled' AND o.created_at>now()-interval '30 days' JOIN products p ON p.id=i.product_id GROUP BY p.category ORDER BY revenue DESC LIMIT 15");
  G('month-compare', "SELECT COALESCE(SUM(total) FILTER (WHERE m=0),0)::float this_month, COALESCE(SUM(total) FILTER (WHERE m=1),0)::float last_month, COUNT(*) FILTER (WHERE m=0)::int orders_this, COUNT(*) FILTER (WHERE m=1)::int orders_last FROM (SELECT total,((date_part('year',now())*12+date_part('month',now()))-(date_part('year',created_at)*12+date_part('month',created_at)))::int m FROM orders WHERE status<>'cancelled' AND created_at>=date_trunc('month',now())-interval '1 month') x");
  G('discount-given', "SELECT COALESCE(SUM(discount),0)::float given,COUNT(*) FILTER (WHERE discount>0)::int orders_with_discount,COUNT(*)::int orders FROM orders WHERE status<>'cancelled' AND created_at>now()-interval '30 days'");
  // System
  G('backup-list', 'SELECT id,size,created_at FROM backups ORDER BY id DESC LIMIT 20');
  G('top-actions', "SELECT action label,COUNT(*)::int n FROM audit_log WHERE at>now()-interval '7 days' GROUP BY action ORDER BY n DESC LIMIT 12");
  G('audit-search', 'SELECT at,username,action,detail FROM audit_log WHERE action ILIKE $1 OR detail ILIKE $1 OR username ILIKE $1 ORDER BY id DESC LIMIT 50', (r) => ['%' + String(r.query.q || '').replace(/[%_\\]/g, '').slice(0, 60) + '%']);
};

// Mounted first in server.js so it times every API request.
module.exports.early = function early(app) {
  app.use((req, res, next) => {
    if (!shared.sys.slowlog) return next();
    const t = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      if (ms >= shared.sys.slowms && req.originalUrl.startsWith('/api')) {
        shared.slow.unshift({ at: new Date().toISOString(), ms: Math.round(ms), method: req.method, path: String(req.originalUrl).slice(0, 100), status: res.statusCode });
        if (shared.slow.length > 30) shared.slow.pop();
        console.warn(`[slow] ${req.method} ${req.originalUrl} ${Math.round(ms)}ms`);
      }
    });
    next();
  });
};
