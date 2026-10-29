// Perks for customers: loyalty points (earned on delivered orders, spent at checkout, tiers, expiry),
// marketing consent, and order alerts (phone notifications).
// Push needs web-push and three settings: PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY and PUSH_SUBJECT (for example mailto:you@example.com).
// Make the keys once with: npx web-push generate-vapid-keys
// Settings (all optional):
//   PESO_PER_POINT   pesos spent on a delivered order per point earned (default 10)
//   REDEEM_POINTS    points that make one discount block (default 100)
//   REDEEM_PESO      pesos off per block (default 20)
//   EXPIRY_DAYS      days before earned points expire (default 180)
let webpush = null;
try { webpush = require('web-push'); } catch (e) { console.log('[perks] web-push is not installed yet: order alerts stay off until you run npm install.'); }
const PUB = process.env.PUSH_PUBLIC_KEY || '';
const PRIV = process.env.PUSH_PRIVATE_KEY || '';
const pushOn = !!(webpush && PUB && PRIV);
if (pushOn) webpush.setVapidDetails(process.env.PUSH_SUBJECT || 'mailto:admin@example.com', PUB, PRIV);
const PESO_PER_POINT = Math.max(1, parseInt(process.env.PESO_PER_POINT) || 10);
const REDEEM_POINTS = Math.max(1, parseInt(process.env.REDEEM_POINTS) || 100);
const REDEEM_PESO = Math.max(1, Number(process.env.REDEEM_PESO) || 20);
const EXPIRY_DAYS = Math.max(1, parseInt(process.env.EXPIRY_DAYS) || 180);
// Tiers by lifetime points earned (never expires). Highest tier reached wins.
const TIERS = [['Bronze', 0], ['Silver', 500], ['Gold', 1500]];

const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

module.exports = function mount(app, { pool, auth, wrap }) {
  const q = (text, params) => pool.query(text, params);
  q(`CREATE TABLE IF NOT EXISTS push_subs (
       id SERIAL PRIMARY KEY,
       user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       endpoint TEXT NOT NULL UNIQUE,
       p256dh TEXT NOT NULL,
       auth TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    .then(() => q(`CREATE TABLE IF NOT EXISTS loyalty_ledger (
       id SERIAL PRIMARY KEY,
       user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
       points INT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now())`))
    .then(() => q(`CREATE TABLE IF NOT EXISTS loyalty_redemptions (
       id SERIAL PRIMARY KEY,
       order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
       user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       points INT NOT NULL,
       peso NUMERIC(10,2) NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now())`))
    .then(() => q('ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false'))
    .catch((e) => console.error('[perks] tables:', e.message));

  // Points that can be spent right now: earned within the expiry window, minus what was already used.
  // Points used on an order that was later cancelled are given back (see onOrderStatus).
  async function balance(db, uid) {
    const { rows: [b] } = await db.query(
      `SELECT
         (SELECT COALESCE(SUM(points),0) FROM loyalty_ledger WHERE user_id=$1 AND created_at > now() - ($2::int * interval '1 day'))::int AS live,
         (SELECT COALESCE(SUM(points),0) FROM loyalty_ledger WHERE user_id=$1)::int AS lifetime,
         (SELECT COALESCE(SUM(points),0) FROM loyalty_redemptions WHERE user_id=$1)::int AS used`, [uid, EXPIRY_DAYS]);
    const available = Math.max(0, b.live - b.used);
    let tier = TIERS[0][0], next = null;
    TIERS.forEach(([name, min], i) => { if (b.lifetime >= min) tier = name; else if (next == null) next = { name, at: min }; });
    return { available, lifetime: b.lifetime, tier, next };
  }

  // Called inside the checkout transaction. Returns how many points and pesos this order uses (possibly fewer than asked).
  async function reserve(db, uid, wantPoints, maxPeso) {
    const want = parseInt(wantPoints) || 0;
    if (want <= 0) return { points: 0, peso: 0 };
    if (want % REDEEM_POINTS !== 0) throw fail(`Points are used in blocks of ${REDEEM_POINTS}.`);
    const { available } = await balance(db, uid);
    if (want > available) throw fail(`You have ${available} points, so you cannot use ${want}.`);
    const blocks = Math.min(want / REDEEM_POINTS, Math.floor(Math.max(0, maxPeso) / REDEEM_PESO));
    if (blocks < 1) return { points: 0, peso: 0 };
    return { points: blocks * REDEEM_POINTS, peso: blocks * REDEEM_PESO };
  }
  async function record(db, orderId, uid, points, peso) {
    await db.query('INSERT INTO loyalty_redemptions (order_id, user_id, points, peso) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING', [orderId, uid, points, peso]);
  }

  // Flavors: names only; they use the product's price and stock, and each can be marked sold out.
  q(`CREATE TABLE IF NOT EXISTS product_variants (
       id SERIAL PRIMARY KEY,
       product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
       name VARCHAR(60) NOT NULL,
       is_sold_out BOOLEAN NOT NULL DEFAULT false,
       sort INT NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).catch((e) => console.error('[perks] flavors table:', e.message));
  const adminOnly = (req) => { if (req.user.role !== 'admin') throw fail('Only the main admin can change flavors.', 403); };
  app.get('/api/variants', wrap(async (req, res) => {
    const { rows } = await q('SELECT id, product_id, name, is_sold_out FROM product_variants ORDER BY product_id, sort, id');
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  }));
  app.post('/api/variants', auth, wrap(async (req, res) => {
    adminOnly(req);
    const b = req.body || {}, pid = parseInt(b.product_id), name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!Number.isInteger(pid)) throw fail('Pick a product.');
    if (name.length < 1) throw fail('Give the flavor a name.');
    const { rows: [p] } = await q('SELECT id FROM products WHERE id=$1', [pid]);
    if (!p) throw fail('Product not found.', 404);
    const { rows: [v] } = await q('INSERT INTO product_variants (product_id, name) VALUES ($1,$2) RETURNING id, product_id, name, is_sold_out', [pid, name]);
    res.json(v);
  }));
  app.patch('/api/variants/:id', auth, wrap(async (req, res) => {
    adminOnly(req);
    const id = parseInt(req.params.id); if (!Number.isInteger(id)) throw fail('Flavor not found.', 404);
    const { rows: [v] } = await q('UPDATE product_variants SET is_sold_out=$2 WHERE id=$1 RETURNING id, product_id, name, is_sold_out', [id, !!(req.body || {}).is_sold_out]);
    if (!v) throw fail('Flavor not found.', 404);
    res.json(v);
  }));
  app.delete('/api/variants/:id', auth, wrap(async (req, res) => {
    adminOnly(req);
    const id = parseInt(req.params.id); if (!Number.isInteger(id)) throw fail('Flavor not found.', 404);
    await q('DELETE FROM product_variants WHERE id=$1', [id]);
    res.json({ ok: true });
  }));

  // Frequently bought together: products that appear in the same orders as the ones in the cart (not cancelled orders).
  app.get('/api/together', wrap(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map((x) => parseInt(x)).filter((x) => Number.isInteger(x) && x > 0).slice(0, 10);
    if (!ids.length) return res.json([]);
    const { rows } = await q(`SELECT p.id, p.title, p.price, p.image_url, p.is_sold_out, COUNT(*)::int AS together
        FROM order_items a
        JOIN order_items b ON b.order_id = a.order_id AND b.product_id IS NOT NULL AND b.product_id <> a.product_id
        JOIN orders o ON o.id = a.order_id AND o.status <> 'cancelled'
        JOIN products p ON p.id = b.product_id
        WHERE a.product_id = ANY($1::int[]) AND NOT (b.product_id = ANY($1::int[])) AND NOT p.resting
        GROUP BY p.id
        ORDER BY together DESC, p.id
        LIMIT 4`, [ids]);
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  }));

  // Loyalty points: balance, tier, what it can buy, and the latest entries.
  app.get('/api/me/points', auth, wrap(async (req, res) => {
    const b = await balance(pool, req.user.id);
    const { rows: history } = await q(
      `SELECT order_id, points, created_at, false AS spent FROM loyalty_ledger WHERE user_id=$1
       UNION ALL SELECT order_id, -points, created_at, true FROM loyalty_redemptions WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 12`, [req.user.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ points: b.available, lifetime: b.lifetime, tier: b.tier, next_tier: b.next, expiry_days: EXPIRY_DAYS,
      per_peso: PESO_PER_POINT, redeem_points: REDEEM_POINTS, redeem_peso: REDEEM_PESO, history });
  }));

  // Marketing consent: off until the customer turns it on.
  app.get('/api/me/privacy', auth, wrap(async (req, res) => {
    const { rows: [u] } = await q('SELECT marketing_opt_in FROM users WHERE id=$1', [req.user.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ marketing: !!(u && u.marketing_opt_in) });
  }));
  app.post('/api/me/privacy', auth, wrap(async (req, res) => {
    await q('UPDATE users SET marketing_opt_in=$2 WHERE id=$1', [req.user.id, !!(req.body || {}).marketing]);
    res.json({ ok: true });
  }));

  // Order alerts: the public key the browser needs, and saving or removing a phone's subscription.
  app.get('/api/push/key', wrap(async (req, res) => {
    if (!pushOn) throw fail('Order alerts are not set up yet.', 503);
    res.json({ key: PUB });
  }));
  app.post('/api/push/subscribe', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const endpoint = String(b.endpoint || ''), p256dh = String((b.keys || {}).p256dh || ''), authKey = String((b.keys || {}).auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 600 || !p256dh || !authKey) throw fail('That alert subscription is not valid.');
    await q(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
             ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.user.id, endpoint, p256dh, authKey]);
    res.json({ ok: true });
  }));
  app.post('/api/push/unsubscribe', auth, wrap(async (req, res) => {
    await q('DELETE FROM push_subs WHERE endpoint = $1 AND user_id = $2', [String((req.body || {}).endpoint || ''), req.user.id]);
    res.json({ ok: true });
  }));

  async function notifyUser(uid, body) {
    if (!pushOn) return;
    const { rows } = await q('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = $1', [uid]);
    await Promise.all(rows.map((s) => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ title: 'Snack Shop', body, url: '/' }), { TTL: 3600 }
    ).catch(async (e) => { if (e.statusCode === 404 || e.statusCode === 410) await q('DELETE FROM push_subs WHERE id = $1', [s.id]); })));
  }

  // Called by the order status route after every status change. Safe to call twice: points are recorded once per order.
  async function onOrderStatus(orderId, status) {
    const { rows: [o] } = await q('SELECT id, user_id, total FROM orders WHERE id = $1', [orderId]);
    if (!o) return;
    if (status === 'completed') {
      const pts = Math.floor(Number(o.total) / PESO_PER_POINT);
      if (pts > 0) await q('INSERT INTO loyalty_ledger (user_id, order_id, points) VALUES ($1,$2,$3) ON CONFLICT (order_id) DO NOTHING', [o.user_id, o.id, pts]);
    }
    if (status === 'cancelled') await q('DELETE FROM loyalty_redemptions WHERE order_id = $1', [o.id]); // points used on it come back
    const text = { packed: `is packed and on its way`, completed: `was delivered. Enjoy!`, cancelled: `was cancelled` }[status];
    if (text) await notifyUser(o.user_id, `Order #${o.id} ${text}`);
  }
  return { onOrderStatus, reserve, record, balance };
};
