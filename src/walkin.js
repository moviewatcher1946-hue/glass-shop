// Walk-in sales: things sold face to face. They are saved as completed orders marked "walkin", so every total
// and report counts them, and stock goes down the same way as an online order.
// They belong to a shop account named "walk-in", which nobody can sign in to.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

module.exports = function mount(app, { pool, auth, admin, wrap }) {
  const WALK = 'walk-in';
  const bad = (m, status = 400) => { const e = new Error(m); e.status = status; return e; };
  let walkId = null;
  const ready = (async () => {
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'online'");
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'customer') ON CONFLICT DO NOTHING", [WALK, hash]);
    const { rows: [u] } = await pool.query('SELECT id FROM users WHERE username = $1', [WALK]);
    walkId = u.id;
  })().catch((e) => console.error('[walkin] setup:', e.message));

  // paid_by holds the id of the person who took the money. The method (cash or GCash) goes in the note.
  async function recordSale(items, paidBy, collectorId) {
    await ready;
    if (!walkId) throw bad('Walk-in sales are not ready yet. Try again in a moment.', 503);
    const want = new Map();
    for (const it of items) {
      const id = parseInt(it && it.product_id) || 0, qty = parseInt(it && it.quantity) || 0;
      if (id > 0 && qty > 0 && qty <= 999) want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw bad('Add at least one product and a quantity.');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows: prods } = await c.query('SELECT id, title, price, stock, is_sold_out FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [[...want.keys()]]);
      if (prods.length !== want.size) throw bad('A product was not found. Refresh and try again.');
      let total = 0;
      for (const p of prods) {
        const q = want.get(p.id);
        if (p.is_sold_out) throw bad(`"${p.title}" is sold out.`);
        if (p.stock != null && p.stock < q) throw bad(`Only ${p.stock} of "${p.title}" left.`);
        total += Number(p.price) * q;
      }
      const { rows: [o] } = await c.query(
        "INSERT INTO orders (user_id, total, status, channel, paid_by, paid_at, note) VALUES ($1, $2, 'completed', 'walkin', $3, now(), $4) RETURNING id",
        [walkId, total.toFixed(2), collectorId || null, 'Walk-in sale, paid by ' + paidBy]);
      for (const p of prods) {
        const q = want.get(p.id);
        await c.query('INSERT INTO order_items (order_id, product_id, title, unit_price, quantity) VALUES ($1, $2, $3, $4, $5)', [o.id, p.id, p.title, p.price, q]);
        if (p.stock != null) await c.query('UPDATE products SET stock = $1::int, is_sold_out = is_sold_out OR $1::int = 0 WHERE id = $2', [p.stock - q, p.id]);
      }
      await c.query('COMMIT');
      return { id: o.id, total: total.toFixed(2) };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  app.post('/api/admin/walkin', auth, admin, wrap(async (req, res) => {
    const b = req.body || {};
    const paid = ['cash', 'gcash'].includes(b.paid_by) ? b.paid_by : 'cash';
    res.json(await recordSale(Array.isArray(b.items) ? b.items : [], paid, req.user.id));
  }));

  // Walk-in totals for today (Philippine time) and for all time.
  app.get('/api/admin/walkin/summary', auth, admin, wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(`SELECT count(*)::int AS orders, COALESCE(sum(total),0) AS total FROM orders
      WHERE channel = 'walkin' AND status = 'completed' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`);
    const { rows: [a] } = await pool.query("SELECT count(*)::int AS orders, COALESCE(sum(total),0) AS total FROM orders WHERE channel = 'walkin' AND status = 'completed'");
    res.set('Cache-Control', 'no-store');
    res.json({ today: t, all_time: a });
  }));

  return { recordSale };
};
