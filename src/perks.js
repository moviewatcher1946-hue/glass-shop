// Perks for customers: "Your usual" (the snacks you buy most), loyalty points (earned on delivered orders),
// and order alerts (phone notifications when an order is packed, delivered or cancelled).
// Push needs web-push and three settings: PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY and PUSH_SUBJECT (for example mailto:you@example.com).
// Make the keys once with: npx web-push generate-vapid-keys
// Points: one point per PESO_PER_POINT pesos of a delivered order (default 10).
let webpush = null;
try { webpush = require('web-push'); } catch (e) { console.log('[perks] web-push is not installed yet: order alerts stay off until you run npm install.'); }
const PUB = process.env.PUSH_PUBLIC_KEY || '';
const PRIV = process.env.PUSH_PRIVATE_KEY || '';
const pushOn = !!(webpush && PUB && PRIV);
if (pushOn) webpush.setVapidDetails(process.env.PUSH_SUBJECT || 'mailto:admin@example.com', PUB, PRIV);
const PESO_PER_POINT = Math.max(1, parseInt(process.env.PESO_PER_POINT) || 10);

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
    .catch((e) => console.error('[perks] tables:', e.message));

  // "Your usual": the snacks this person has ordered most, with today's price and stock.
  app.get('/api/me/usual', auth, wrap(async (req, res) => {
    const { rows } = await q(`SELECT p.id, p.title, p.price, p.image_url, p.is_sold_out, SUM(oi.quantity)::int AS times
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.user_id = $1 AND o.status <> 'cancelled'
        GROUP BY p.id
        ORDER BY times DESC, MAX(o.created_at) DESC
        LIMIT 8`, [req.user.id]);
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  }));

  // Loyalty points: the balance and the latest entries.
  app.get('/api/me/points', auth, wrap(async (req, res) => {
    const { rows: [b] } = await q('SELECT COALESCE(SUM(points),0)::int AS points FROM loyalty_ledger WHERE user_id = $1', [req.user.id]);
    const { rows: history } = await q('SELECT order_id, points, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [req.user.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ points: b.points, per_peso: PESO_PER_POINT, history });
  }));

  // Order alerts: the public key the browser needs, and saving or removing a phone's subscription.
  app.get('/api/push/key', wrap(async (req, res) => {
    if (!pushOn) { const e = new Error('Order alerts are not set up yet.'); e.status = 503; throw e; }
    res.json({ key: PUB });
  }));
  app.post('/api/push/subscribe', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const endpoint = String(b.endpoint || ''), p256dh = String((b.keys || {}).p256dh || ''), authKey = String((b.keys || {}).auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 600 || !p256dh || !authKey) { const e = new Error('That alert subscription is not valid.'); e.status = 400; throw e; }
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
    const text = { packed: `is packed and on its way`, completed: `was delivered. Enjoy!`, cancelled: `was cancelled` }[status];
    if (text) await notifyUser(o.user_id, `Order #${o.id} ${text}`);
  }
  return { onOrderStatus };
};
