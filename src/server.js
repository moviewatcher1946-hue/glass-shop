const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, init } = require('./db');
const { sign, auth, admin, staff } = require('./auth');

const app = express();
const json = express.json();
// The restore route accepts big files, so it brings its own larger body parser.
app.use((req, res, next) => (req.path === '/api/admin/import' ? next() : json(req, res, next)));
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype)),
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const COLS = 'id,title,description,price,is_sold_out,category,discount_percent,image_url,created_at,owner_id';
const CATEGORIES = ['drinks', 'snacks'];
// Price after the product's % discount. The server always works the price out itself.
const finalPrice = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_percent) || 0))) / 100;
const COMBO_SQL = `SELECT c.id,c.title,c.description,c.price,c.is_active,c.created_at,c.owner_id,
  COALESCE((SELECT json_agg(json_build_object('product_id',p.id,'title',p.title,'quantity',ci.quantity,'price',p.price,
      'discount_percent',p.discount_percent,'is_sold_out',p.is_sold_out,'image_url',p.image_url,'owner_id',p.owner_id) ORDER BY p.title)
    FROM combo_items ci JOIN products p ON p.id=ci.product_id WHERE ci.combo_id=c.id), '[]'::json) AS items,
  COALESCE((SELECT json_agg(json_build_object('owner_id',a.owner_id,'username',au.username,'status',a.status) ORDER BY a.owner_id)
    FROM combo_approvals a JOIN users au ON au.id=a.owner_id WHERE a.combo_id=c.id), '[]'::json) AS approvals
  FROM combos c`;
// A combo with other sellers' products goes live only when every one of them has approved it.
const COMBO_LIVE = "c.is_active AND NOT EXISTS (SELECT 1 FROM combo_approvals a WHERE a.combo_id=c.id AND a.status <> 'approved')";
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isMain = (u) => u.role === 'admin'; // raven: controls everything, including the sellers' items

// Sellers may only touch rows they own; the main admin may touch anything.
async function guard(table, id, user) {
  const { rows: [r] } = await pool.query(`SELECT owner_id FROM ${table} WHERE id=$1`, [id]); // table is always a fixed name below
  if (!r) throw bad('Not found.', 404);
  if (!isMain(user) && r.owner_id !== user.id) throw bad('That belongs to another seller.', 403);
}
// Only the main admin may hand an item to someone else; the owner must be a staff account.
async function pickOwner(user, wanted) {
  const id = parseInt(wanted);
  if (!isMain(user) || !Number.isInteger(id)) return user.id;
  const { rowCount } = await pool.query("SELECT 1 FROM users WHERE id=$1 AND role IN ('admin','seller')", [id]);
  if (!rowCount) throw bad('That owner does not exist.');
  return id;
}

// Phone alerts for the owner. Set NTFY_TOPIC (free ntfy app) and/or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in Render.
// Never blocks or breaks an order if the alert fails.
const notify = (text) => {
  const jobs = [];
  if (process.env.NTFY_TOPIC)
    jobs.push(fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, { method: 'POST', body: text, headers: { Title: 'Glass Shop' } }));
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    }));
  Promise.allSettled(jobs).catch(() => {});
};

// Per-seller alerts through her own ntfy topic. Never blocks or breaks a request if an alert fails.
const notifySellers = async (texts) => { // texts: Map(userId -> message)
  try {
    const { rows } = await pool.query(
      "SELECT id, ntfy_topic FROM users WHERE role='seller' AND ntfy_topic <> '' AND id = ANY($1)", [[...texts.keys()]]);
    await Promise.allSettled(rows.map((r) => fetch(`https://ntfy.sh/${encodeURIComponent(r.ntfy_topic)}`,
      { method: 'POST', body: texts.get(r.id), headers: { Title: 'Glass Shop' } })));
  } catch { /* ignore */ }
};
const notifyAll = async (text) => { // custom requests are a shared inbox: raven and every seller hear about them
  notify(text);
  try {
    const { rows } = await pool.query("SELECT id FROM users WHERE role='seller' AND ntfy_topic <> ''");
    await notifySellers(new Map(rows.map((r) => [r.id, text])));
  } catch { /* ignore */ }
};

// A promo code gives % off the whole order, once per account.
async function checkPromo(db, code, userId) {
  const clean = String(code || '').trim();
  if (!clean) return null;
  const { rows: [p] } = await db.query('SELECT * FROM promo_codes WHERE upper(code)=upper($1) AND is_active', [clean]); // applies only to the items its owner sells
  if (!p) throw bad('That promo code is not valid.');
  if (p.max_uses != null && p.used_count >= p.max_uses) throw bad('That promo code has been fully used.');
  const { rowCount } = await db.query("SELECT 1 FROM orders WHERE user_id=$1 AND upper(promo_code)=upper($2) AND status <> 'cancelled'", [userId, p.code]);
  if (rowCount) throw bad('You already used that promo code.');
  return p;
}

// Adds the category column to products (safe to run every start; existing products become 'snacks').
const ensureCategory = () => pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'snacks'");

// Discounts and combos (safe to run every start; never touches existing data).
const ensureCombos = () => pool.query(`
  ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent INT NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90);
  CREATE TABLE IF NOT EXISTS combos (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(120) NOT NULL,
    description VARCHAR(300) NOT NULL DEFAULT '',
    price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS combo_items (
    id         SERIAL PRIMARY KEY,
    combo_id   INT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity   INT NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    UNIQUE (combo_id, product_id)
  );
`);

// Order notes, promo codes and shop settings (safe to run every start).
const ensureShop = () => pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS note VARCHAR(300) NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(40);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS promo_codes (
    id         SERIAL PRIMARY KEY,
    code       VARCHAR(40) NOT NULL,
    percent    INT NOT NULL CHECK (percent BETWEEN 1 AND 90),
    max_uses   INT,
    used_count INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code ON promo_codes (upper(code));
  CREATE TABLE IF NOT EXISTS settings (
    id    SERIAL PRIMARY KEY,
    key   VARCHAR(40) UNIQUE NOT NULL,
    value TEXT NOT NULL DEFAULT ''
  );
`);

// Seller accounts and ownership (safe to run every start). Existing rows become the main admin's.
const ensureOwners = () => pool.query(`
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','customer','seller'));
  ALTER TABLE products    ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE combos      ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS ntfy_topic VARCHAR(64) NOT NULL DEFAULT '';
  CREATE TABLE IF NOT EXISTS order_approvals (
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status   VARCHAR(20) NOT NULL,
    PRIMARY KEY (order_id, owner_id)
  );
  UPDATE products    SET owner_id=(SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1) WHERE owner_id IS NULL;
  UPDATE combos      SET owner_id=(SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1) WHERE owner_id IS NULL;
  UPDATE promo_codes SET owner_id=(SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1) WHERE owner_id IS NULL;
  UPDATE order_items oi SET owner_id=COALESCE((SELECT owner_id FROM products WHERE id=oi.product_id),
    (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1)) WHERE owner_id IS NULL;
`);

// Creates the custom_requests table if it doesn't exist yet (never touches existing data).
const ensureCustomRequests = () => pool.query(`
  CREATE TABLE IF NOT EXISTS custom_requests (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','quoted','accepted','declined','unavailable')),
    quoted_price NUMERIC(10,2) CHECK (quoted_price >= 0),
    admin_note   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS custom_requests_user ON custom_requests (user_id);
`);

// Sets image_url (with a cache-busting version) and returns the public product row.
const withImage = async (id) =>
  (
    await pool.query(
      `UPDATE products SET image_url = CASE WHEN image_data IS NOT NULL
         THEN '/api/products/' || id || '/image?v=' || floor(extract(epoch from now()))::text END
       WHERE id=$1 RETURNING ${COLS}`,
      [id]
    )
  ).rows[0];

app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- Auth ---------- */
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username) || password.length < 8)
    throw bad('Username: 3-30 letters, numbers or _. Password: at least 8 characters.');
  try {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'customer') RETURNING id,username,role",
      [username, await bcrypt.hash(password, 12)]
    );
    res.status(201).json({ token: sign(u), user: u });
  } catch (e) {
    if (e.code === '23505') throw bad('That username is taken.', 409);
    throw e;
  }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)', [username]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw bad('Wrong username or password.', 401);
  const user = { id: u.id, username: u.username, role: u.role };
  res.json({ token: sign(user), user });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------- Products (public read) ---------- */
app.get('/api/products', wrap(async (req, res) => {
  res.json((await pool.query(`SELECT ${COLS} FROM products ORDER BY created_at DESC`)).rows);
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(`SELECT ${COLS} FROM products WHERE id=$1`, [req.params.id]);
  if (!p) throw bad('Product not found.', 404);
  res.json(p);
}));

app.get('/api/products/:id/image', wrap(async (req, res) => {
  const { rows: [p] } = await pool.query('SELECT image_data, image_mime FROM products WHERE id=$1', [req.params.id]);
  if (!p || !p.image_data) return res.sendStatus(404);
  res.set('Content-Type', p.image_mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(p.image_data);
}));

/* ---------- Products (admin write) ---------- */
app.post('/api/products', auth, staff, upload.single('image'), wrap(async (req, res) => {
  const { title, description = '', price, category = 'snacks', discount_percent = 0 } = req.body;
  if (!title || price === '' || isNaN(price) || price < 0) throw bad('Title and a valid price are required.');
  if (!CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  const disc = parseInt(discount_percent) || 0;
  if (disc < 0 || disc > 90) throw bad('Discount must be between 0 and 90%.');
  const f = req.file;
  const owner = await pickOwner(req.user, req.body.owner_id);
  const { rows: [p] } = await pool.query(
    'INSERT INTO products (title, description, price, image_data, image_mime, category, discount_percent, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [title, description, price, f ? f.buffer : null, f ? f.mimetype : null, category, disc, owner]
  );
  res.status(201).json(await withImage(p.id));
}));

app.put('/api/products/:id', auth, staff, upload.single('image'), wrap(async (req, res) => {
  await guard('products', req.params.id, req.user);
  const { title, description, price, category, discount_percent } = req.body;
  const newOwner = isMain(req.user) && req.body.owner_id ? await pickOwner(req.user, req.body.owner_id) : null;
  const disc = discount_percent === undefined || discount_percent === '' ? null : parseInt(discount_percent);
  if (disc !== null && !(disc >= 0 && disc <= 90)) throw bad('Discount must be between 0 and 90%.');
  if (category !== undefined && !CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  if (price !== undefined && (price === '' || isNaN(price) || price < 0)) throw bad('Invalid price.');
  const f = req.file;
  const { rowCount } = await pool.query(
    `UPDATE products SET title=COALESCE($1,title), description=COALESCE($2,description), price=COALESCE($3,price),
       image_data=COALESCE($4,image_data), image_mime=COALESCE($5,image_mime), category=COALESCE($6,category), discount_percent=COALESCE($7,discount_percent), owner_id=COALESCE($9,owner_id) WHERE id=$8`,
    [title ?? null, description ?? null, price ?? null, f ? f.buffer : null, f ? f.mimetype : null, category ?? null, disc, req.params.id, newOwner]
  );
  if (!rowCount) throw bad('Product not found.', 404);
  res.json(await withImage(req.params.id));
}));

app.patch('/api/products/:id/sold-out', auth, staff, wrap(async (req, res) => {
  await guard('products', req.params.id, req.user);
  const { rows: [p] } = await pool.query(
    `UPDATE products SET is_sold_out = NOT is_sold_out WHERE id=$1 RETURNING ${COLS}`, [req.params.id]);
  if (!p) throw bad('Product not found.', 404);
  res.json(p);
}));

// Move several products to a category at once.
app.patch('/api/products/category', auth, staff, wrap(async (req, res) => {
  const { ids, category } = req.body || {};
  if (!CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!list.length) throw bad('Select at least one product.');
  const { rowCount } = isMain(req.user)
    ? await pool.query('UPDATE products SET category=$1 WHERE id = ANY($2)', [category, list])
    : await pool.query('UPDATE products SET category=$1 WHERE id = ANY($2) AND owner_id=$3', [category, list, req.user.id]);
  res.json({ updated: rowCount });
}));

// Set the same % discount on several products at once (0 removes it).
app.patch('/api/products/discount', auth, staff, wrap(async (req, res) => {
  const { ids, percent } = req.body || {};
  const pct = parseInt(percent);
  if (!(pct >= 0 && pct <= 90)) throw bad('Discount must be between 0 and 90%.');
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  if (!list.length) throw bad('Select at least one product.');
  const { rowCount } = isMain(req.user)
    ? await pool.query('UPDATE products SET discount_percent=$1 WHERE id = ANY($2)', [pct, list])
    : await pool.query('UPDATE products SET discount_percent=$1 WHERE id = ANY($2) AND owner_id=$3', [pct, list, req.user.id]);
  res.json({ updated: rowCount });
}));

/* ---------- Combos ---------- */
app.get('/api/combos', wrap(async (req, res) => {
  const { rows } = await pool.query(`${COMBO_SQL} WHERE ${COMBO_LIVE} ORDER BY c.created_at DESC`);
  res.json(rows.filter((c) => c.items.length));
}));

app.get('/api/admin/combos', auth, staff, wrap(async (req, res) => {
  res.json((await (isMain(req.user)
    ? pool.query(`${COMBO_SQL} ORDER BY c.created_at DESC`)
    : pool.query(`${COMBO_SQL} WHERE c.owner_id=$1 OR EXISTS (SELECT 1 FROM combo_approvals a WHERE a.combo_id=c.id AND a.owner_id=$1) ORDER BY c.created_at DESC`, [req.user.id]))).rows);
}));

app.post('/api/combos', auth, staff, wrap(async (req, res) => {
  const clean = (v, n) => String(v || '').trim().slice(0, n);
  const title = clean(req.body.title, 120), description = clean(req.body.description, 300);
  const price = Number(req.body.price);
  const items = (Array.isArray(req.body.items) ? req.body.items : [])
    .map((i) => ({ pid: parseInt(i.product_id), q: parseInt(i.quantity) }))
    .filter((i) => Number.isInteger(i.pid) && i.q >= 1 && i.q <= 20).slice(0, 20);
  if (!title || req.body.price === '' || !(price >= 0) || !items.length) throw bad('Add a name, a price and at least one product.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Any seller's products can be paired. Every other seller involved must approve before the combo goes live.
    const { rows: found } = await c.query('SELECT id, owner_id, title FROM products WHERE id = ANY($1)', [items.map((i) => i.pid)]);
    if (found.length !== new Set(items.map((i) => i.pid)).size) throw bad('One of the products no longer exists.');
    const { rows: [cb] } = await c.query('INSERT INTO combos (title, description, price, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [title, description, price.toFixed(2), req.user.id]);
    for (const i of items)
      await c.query('INSERT INTO combo_items (combo_id, product_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (combo_id, product_id) DO UPDATE SET quantity=EXCLUDED.quantity',
        [cb.id, i.pid, i.q]);
    const others = [...new Set(found.map((p) => p.owner_id).filter((id) => id != null && id !== req.user.id))];
    for (const o of others) await c.query("INSERT INTO combo_approvals (combo_id, owner_id, status) VALUES ($1,$2,'pending')", [cb.id, o]);
    await c.query('COMMIT');
    if (others.length) {
      const msgs = new Map(others.map((o) => [o, `${req.user.username} wants to pair your ${found.filter((p) => p.owner_id === o).map((p) => p.title).join(', ')} in the combo "${title}". Open Combos to approve or decline.`]));
      notifySellers(msgs);
      const adm = (await pool.query("SELECT id FROM users WHERE role='admin'")).rows.map((r) => r.id);
      const mine = others.find((o) => adm.includes(o));
      if (mine) notify(msgs.get(mine));
    }
    res.status(201).json({ id: cb.id, waiting: others.length });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

// A seller approves or declines the pairing of her products in someone else's combo.
app.patch('/api/combos/:id/approval', auth, staff, wrap(async (req, res) => {
  const approve = !!(req.body || {}).approve;
  const { rows: [a] } = await pool.query(
    'UPDATE combo_approvals SET status=$1 WHERE combo_id=$2 AND owner_id=$3 RETURNING combo_id',
    [approve ? 'approved' : 'declined', req.params.id, req.user.id]);
  if (!a) throw bad('This combo does not need your approval.', 404);
  const { rows: [cb] } = await pool.query('SELECT title, owner_id FROM combos WHERE id=$1', [a.combo_id]);
  const msg = `${req.user.username} ${approve ? 'approved' : 'declined'} the combo "${cb.title}".`;
  notify(msg);
  notifySellers(new Map([[cb.owner_id, msg]]));
  res.json({ ok: true });
}));

app.patch('/api/combos/:id/active', auth, staff, wrap(async (req, res) => {
  await guard('combos', req.params.id, req.user);
  const { rows: [c] } = await pool.query('UPDATE combos SET is_active = NOT is_active WHERE id=$1 RETURNING id,is_active', [req.params.id]);
  if (!c) throw bad('Combo not found.', 404);
  res.json(c);
}));

app.delete('/api/combos/:id', auth, staff, wrap(async (req, res) => {
  await guard('combos', req.params.id, req.user);
  await pool.query('DELETE FROM combos WHERE id=$1', [req.params.id]);
  res.sendStatus(204);
}));

app.delete('/api/products/:id', auth, staff, wrap(async (req, res) => {
  await guard('products', req.params.id, req.user);
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.sendStatus(204);
}));

/* ---------- Orders ---------- */
app.post('/api/orders', auth, wrap(async (req, res) => {
  const items = (req.body.items || []).filter((i) => parseInt(i.quantity) > 0);
  if (!items.length) throw bad('Your cart is empty.');
  const prodIds = items.filter((i) => i.product_id).map((i) => parseInt(i.product_id)).filter(Number.isInteger);
  const comboIds = items.filter((i) => i.combo_id).map((i) => parseInt(i.combo_id)).filter(Number.isInteger);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: prods } = await c.query('SELECT id,title,price,discount_percent,is_sold_out,owner_id FROM products WHERE id = ANY($1)', [prodIds]);
    const byId = new Map(prods.map((r) => [r.id, r]));
    const { rows: combos } = await c.query(`${COMBO_SQL} WHERE c.id = ANY($1) AND ${COMBO_LIVE}`, [comboIds]);
    const comboById = new Map(combos.map((r) => [r.id, r]));
    let total = 0;
    const lines = items.flatMap((i) => {
      const q = Math.min(99, parseInt(i.quantity));
      let parts;
      if (i.combo_id) {
        const cb = comboById.get(parseInt(i.combo_id));
        if (!cb || !cb.items.length || cb.items.some((x) => x.is_sold_out)) throw bad('A combo in your cart is no longer available.');
        // Each seller gets her own line with her share of the combo price (by value), so she sees and approves her part.
        const groups = new Map();
        for (const x of cb.items) {
          const k = x.owner_id ?? cb.owner_id;
          const g = groups.get(k) || { owner: k, names: [], value: 0 };
          g.names.push(`${x.quantity}x ${x.title}`);
          g.value += finalPrice(x) * x.quantity;
          groups.set(k, g);
        }
        const list = [...groups.values()];
        const worth = list.reduce((sum, g) => sum + g.value, 0) || 1;
        let left = Number(cb.price);
        parts = list.map((g, n) => {
          const share = n === list.length - 1 ? left : Math.round((Number(cb.price) * g.value / worth) * 100) / 100;
          left = Math.round((left - share) * 100) / 100;
          return { pid: null, title: `Combo: ${cb.title} (${g.names.join(', ')})`, price: share, q, owner: g.owner };
        });
      } else {
        const p = byId.get(parseInt(i.product_id));
        if (!p || p.is_sold_out) throw bad('An item in your cart is no longer available.');
        parts = [{ pid: p.id, title: p.title, price: finalPrice(p), q, owner: p.owner_id }];
      }
      parts.forEach((l) => { total += l.price * l.q; });
      return parts;
    });
    const promo = await checkPromo(c, req.body.promo, req.user.id);
    // A promo discounts the items its owner sells (or everything if it has no owner),
    // and only the chosen products when it is a per-product code.
    const eligible = (l) => (promo.owner_id == null || l.owner === promo.owner_id)
      && (!promo.product_ids || !promo.product_ids.length || (l.pid != null && promo.product_ids.includes(l.pid)));
    const base = !promo ? total : lines.filter(eligible).reduce((s, l) => s + l.price * l.q, 0);
    if (promo && base === 0) throw bad('That promo code only applies to items that are not in your cart.');
    const discount = promo ? Math.round(base * promo.percent) / 100 : 0;
    const note = String(req.body.note || '').trim().slice(0, 300);
    const { rows: [o] } = await c.query(
      'INSERT INTO orders (user_id, total, note, promo_code, discount) VALUES ($1,$2,$3,$4,$5) RETURNING id,total,status,created_at',
      [req.user.id, (total - discount).toFixed(2), note, promo ? promo.code : null, discount.toFixed(2)]
    );
    if (promo) await c.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE id=$1', [promo.id]);
    for (const l of lines)
      await c.query('INSERT INTO order_items (order_id, product_id, title, unit_price, quantity, owner_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [o.id, l.pid, l.title, l.price.toFixed(2), l.q, l.owner ?? null]);
    await c.query('COMMIT');
    notify(`New order #${o.id} from ${req.user.username} - total ${Number(o.total).toFixed(2)}\n${lines.map((l) => `${l.q}x ${l.title}`).join(', ')}${note ? `\nNote: ${note}` : ''}${promo ? `\nPromo: ${promo.code}` : ''}`);
    const per = new Map();
    for (const l of lines) if (l.owner) per.set(l.owner, [...(per.get(l.owner) || []), l]);
    notifySellers(new Map([...per].map(([id, ls]) => [id,
      `New order #${o.id} from ${req.user.username}\n${ls.map((l) => `${l.q}x ${l.title}`).join(', ')}${note ? `\nNote: ${note}` : ''}`])));
    res.status(201).json(o);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

const ORDER_SQL = `SELECT o.id,o.total,o.status,o.note,o.promo_code,o.discount,o.created_at,u.username,
  (SELECT json_agg(json_build_object('product_id',product_id,'title',title,'unit_price',unit_price,'quantity',quantity))
   FROM order_items WHERE order_id=o.id) AS items,
  (SELECT json_agg(json_build_object('owner_id',x.owner_id,'username',pu.username,'status',COALESCE(a.status,'pending')) ORDER BY x.owner_id)
     FROM (SELECT DISTINCT owner_id FROM order_items WHERE order_id=o.id AND owner_id IS NOT NULL) x
     JOIN users pu ON pu.id=x.owner_id
     LEFT JOIN order_approvals a ON a.order_id=o.id AND a.owner_id=x.owner_id) AS parts
  FROM orders o JOIN users u ON u.id=o.user_id`;

app.get('/api/orders/mine', auth, wrap(async (req, res) => {
  res.json((await pool.query(`${ORDER_SQL} WHERE o.user_id=$1 ORDER BY o.created_at DESC`, [req.user.id])).rows);
}));

// The main admin sees every order. A seller sees only orders that contain her items, and only those items.
app.get('/api/orders', auth, staff, wrap(async (req, res) => {
  if (isMain(req.user)) return res.json((await pool.query(`${ORDER_SQL} ORDER BY o.created_at DESC`)).rows);
  const { rows } = await pool.query(
    `SELECT o.id,o.status,o.note,o.promo_code,o.discount,o.created_at,u.username,
       (SELECT json_agg(json_build_object('product_id',oi.product_id,'title',oi.title,'unit_price',oi.unit_price,'quantity',oi.quantity) ORDER BY oi.id)
          FROM order_items oi WHERE oi.order_id=o.id AND oi.owner_id=$1) AS items,
       EXISTS (SELECT 1 FROM promo_codes pc WHERE upper(pc.code)=upper(o.promo_code) AND pc.owner_id=$1) AS promo_mine,
       (SELECT json_agg(json_build_object('owner_id',x.owner_id,'username',pu.username,'status',COALESCE(a.status,'pending')) ORDER BY x.owner_id)
     FROM (SELECT DISTINCT owner_id FROM order_items WHERE order_id=o.id AND owner_id IS NOT NULL) x
     JOIN users pu ON pu.id=x.owner_id
     LEFT JOIN order_approvals a ON a.order_id=o.id AND a.owner_id=x.owner_id) AS parts
     FROM orders o JOIN users u ON u.id=o.user_id
     WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.owner_id=$1)
     ORDER BY o.created_at DESC`, [req.user.id]);
  res.json(rows.map(({ promo_mine, ...o }) => {
    const sub = o.items.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
    const discount = promo_mine ? Number(o.discount) : 0;
    return { ...o, promo_code: promo_mine ? o.promo_code : null, discount, total: (sub - discount).toFixed(2) };
  }));
}));

// Customer cancels their own order, only while it is still pending.
app.patch('/api/orders/:id/cancel', auth, wrap(async (req, res) => {
  const { rows: [o] } = await pool.query(
    "UPDATE orders SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id,status",
    [req.params.id, req.user.id]);
  if (!o) throw bad('Only pending orders can be cancelled.');
  notify(`Order #${o.id} was cancelled by ${req.user.username}.`);
  const { rows: ow } = await pool.query('SELECT DISTINCT owner_id FROM order_items WHERE order_id=$1 AND owner_id IS NOT NULL', [o.id]);
  notifySellers(new Map(ow.map((r) => [r.owner_id, `Order #${o.id} was cancelled by ${req.user.username}.`])));
  res.json(o);
}));

// Admin moves an order along: pending -> packed (ready) -> completed, or cancelled.
app.patch('/api/orders/:id/status', auth, staff, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'packed', 'completed', 'cancelled'].includes(status)) throw bad('Invalid status.');
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) throw bad('Order not found.', 404);
  const { rows: [ord] } = await pool.query('SELECT status FROM orders WHERE id=$1', [id]);
  if (!ord) throw bad('Order not found.', 404);
  const { rows: ow } = await pool.query(
    'SELECT DISTINCT oi.owner_id, u.username FROM order_items oi JOIN users u ON u.id=oi.owner_id WHERE oi.order_id=$1', [id]);
  const owners = ow.map((r) => r.owner_id);
  if (!isMain(req.user) && !owners.includes(req.user.id)) throw bad('Order not found.', 404);

  // One owner (or raven stepping in on an order he has no items in): change the status directly.
  if (owners.length < 2 || !owners.includes(req.user.id)) {
    const { rows: [o] } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,status', [status, id]);
    return res.json(o);
  }

  // Mixed order: every owner approves their own part; the order moves only as far as all of them have.
  if (ord.status === 'cancelled') throw bad('This order was cancelled.', 409);
  await pool.query(
    'INSERT INTO order_approvals (order_id, owner_id, status) VALUES ($1,$2,$3) ON CONFLICT (order_id, owner_id) DO UPDATE SET status=EXCLUDED.status',
    [id, req.user.id, status]);
  const { rows: ap } = await pool.query('SELECT owner_id,status FROM order_approvals WHERE order_id=$1', [id]);
  const got = new Map(ap.map((r) => [r.owner_id, r.status]));
  const sts = owners.map((x) => got.get(x) || 'pending');
  const rank = { pending: 0, packed: 1, completed: 2, cancelled: 0 };
  const overall = sts.every((x) => x === 'cancelled') ? 'cancelled' : ['pending', 'packed', 'completed'][Math.min(...sts.map((x) => rank[x]))];
  await pool.query('UPDATE orders SET status=$1 WHERE id=$2', [overall, id]);
  const waiting = ow.filter((r) => (got.get(r.owner_id) || 'pending') !== status && r.owner_id !== req.user.id).map((r) => r.username);
  if (waiting.length) {
    const msg = `Order #${id}: ${req.user.username} marked their part ${status}. Your approval is needed.`;
    notify(msg);
    notifySellers(new Map(owners.filter((x) => x !== req.user.id).map((x) => [x, msg])));
  }
  res.json({ id, status: overall, waiting });
}));

/* ---------- Custom requests ---------- */
const CR_SQL = `SELECT r.id,r.description,r.status,r.quoted_price,r.admin_note,r.created_at,r.updated_at,u.username
  FROM custom_requests r JOIN users u ON u.id=r.user_id`;

// Customer submits a request.
app.post('/api/custom-requests', auth, wrap(async (req, res) => {
  const description = String((req.body || {}).description || '').trim();
  if (description.length < 10 || description.length > 2000)
    throw bad('Please describe what you want (10-2000 characters).');
  const { rows: [r] } = await pool.query(
    'INSERT INTO custom_requests (user_id, description) VALUES ($1,$2) RETURNING id,description,status,quoted_price,admin_note,created_at',
    [req.user.id, description]);
  notifyAll(`New custom request #${r.id} from ${req.user.username}:\n${description.slice(0, 300)}`);
  res.status(201).json(r);
}));

app.get('/api/custom-requests/mine', auth, wrap(async (req, res) => {
  res.json((await pool.query(`${CR_SQL} WHERE r.user_id=$1 ORDER BY r.created_at DESC`, [req.user.id])).rows);
}));

app.get('/api/custom-requests', auth, staff, wrap(async (req, res) => {
  res.json((await pool.query(`${CR_SQL} ORDER BY r.created_at DESC`)).rows);
}));

// Admin sets a price (quoted) or says it can't be provided (unavailable).
app.patch('/api/custom-requests/:id/quote', auth, staff, wrap(async (req, res) => {
  const { price, note = '', unavailable = false } = req.body || {};
  let status = 'unavailable', amount = null;
  if (!unavailable) {
    amount = Number(price);
    if (price === '' || price == null || !Number.isFinite(amount) || amount < 0 || amount > 99999999)
      throw bad('Enter a valid price.');
    status = 'quoted';
  }
  const { rows: [r] } = await pool.query(
    `UPDATE custom_requests SET status=$1, quoted_price=$2, admin_note=$3, updated_at=now()
     WHERE id=$4 AND status IN ('pending','quoted') RETURNING id,status,quoted_price,admin_note`,
    [status, amount, String(note).slice(0, 1000), req.params.id]);
  if (!r) throw bad('Request not found or already answered.', 404);
  res.json(r);
}));

// Customer accepts or declines the price they were quoted.
app.patch('/api/custom-requests/:id/respond', auth, wrap(async (req, res) => {
  const status = (req.body || {}).accept ? 'accepted' : 'declined';
  const { rows: [r] } = await pool.query(
    `UPDATE custom_requests SET status=$1, updated_at=now()
     WHERE id=$2 AND user_id=$3 AND status='quoted' RETURNING id,status`,
    [status, req.params.id, req.user.id]);
  if (!r) throw bad('This request has no price to respond to.');
  notifyAll(`Custom request #${r.id}: ${req.user.username} ${status} your price.`);
  res.json(r);
}));

/* ---------- Backup / restore (admin only) ---------- */
const BACKUP_TABLES = ['users', 'products', 'combos', 'combo_items', 'combo_approvals', 'promo_codes', 'settings', 'orders', 'order_items', 'custom_requests', 'order_approvals']; // parents first

app.get('/api/admin/export', auth, admin, wrap(async (req, res) => {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY ${{ order_approvals: 'order_id', combo_approvals: 'combo_id' }[t] || 'id'}`);
    tables[t] = rows.map((row) => {
      for (const k in row) if (Buffer.isBuffer(row[k])) row[k] = { $b64: row[k].toString('base64') }; // product photos
      return row;
    });
  }
  res.set('Content-Type', 'application/json')
    .send(JSON.stringify({ app: 'glass-shop', version: 1, exported_at: new Date().toISOString(), tables }));
}));

// Replaces ALL data with the contents of a backup file, in one transaction (all or nothing).
app.post('/api/admin/import', auth, admin, express.json({ limit: '100mb' }), wrap(async (req, res) => {
  const data = req.body;
  if (!data || data.app !== 'glass-shop' || !data.tables) throw bad('This is not a valid backup file.');
  if (!(data.tables.users || []).some((u) => u.role === 'admin'))
    throw bad('The backup has no admin account, so nothing was restored.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE order_approvals, order_items, orders, custom_requests, combo_approvals, combo_items, combos, promo_codes, settings, products, users RESTART IDENTITY CASCADE');
    for (const t of BACKUP_TABLES) {
      const { rows: colRows } = await c.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [t]);
      const valid = new Set(colRows.map((r) => r.column_name));
      for (const row of data.tables[t] || []) {
        const cols = Object.keys(row).filter((k) => valid.has(k)); // only real columns are ever used in SQL
        if (!cols.length) continue;
        const vals = cols.map((k) => (row[k] && row[k].$b64 !== undefined ? Buffer.from(row[k].$b64, 'base64') : row[k]));
        await c.query(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
      }
      if (!['order_approvals', 'combo_approvals'].includes(t)) await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    }
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

/* ---------- Team names and seller alerts ---------- */
app.get('/api/staff/team', auth, staff, wrap(async (req, res) => {
  res.json((await pool.query("SELECT id,username FROM users WHERE role IN ('admin','seller') ORDER BY id")).rows);
}));

const sellerOnly = (req, res, next) => (req.user.role === 'seller' ? next() : res.status(403).json({ error: 'Sellers only.' }));
app.get('/api/staff/alerts', auth, sellerOnly, wrap(async (req, res) => {
  res.json((await pool.query('SELECT ntfy_topic FROM users WHERE id=$1', [req.user.id])).rows[0] || { ntfy_topic: '' });
}));
app.put('/api/staff/alerts', auth, sellerOnly, wrap(async (req, res) => {
  const topic = String((req.body || {}).ntfy_topic || '').trim();
  if (!/^[A-Za-z0-9_-]{0,64}$/.test(topic)) throw bad('Topic: up to 64 letters, numbers, - or _.');
  await pool.query('UPDATE users SET ntfy_topic=$1 WHERE id=$2', [topic, req.user.id]);
  res.json({ ok: true });
}));

/* ---------- Seller accounts (main admin only) ---------- */
app.get('/api/admin/sellers', auth, admin, wrap(async (req, res) => {
  res.json((await pool.query("SELECT id,username,created_at FROM users WHERE role='seller' ORDER BY id")).rows);
}));

app.post('/api/admin/sellers', auth, admin, wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username) || password.length < 8)
    throw bad('Username: 3-30 letters, numbers or _. Password: at least 8 characters.');
  try {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'seller') RETURNING id,username,created_at",
      [username, await bcrypt.hash(password, 12)]);
    res.status(201).json(u);
  } catch (e) {
    if (e.code === '23505') throw bad('That username is taken.', 409);
    throw e;
  }
}));

app.patch('/api/admin/sellers/:id/password', auth, admin, wrap(async (req, res) => {
  const password = String((req.body || {}).password || '');
  if (password.length < 8) throw bad('Password: at least 8 characters.');
  const { rowCount } = await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2 AND role='seller'",
    [await bcrypt.hash(password, 12), req.params.id]);
  if (!rowCount) throw bad('Seller not found.', 404);
  res.json({ ok: true });
}));

// Removing a seller hands all her products, combos, promos and order history to the main admin.
app.delete('/api/admin/sellers/:id', auth, admin, wrap(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rowCount } = await c.query("SELECT 1 FROM users WHERE id=$1 AND role='seller'", [req.params.id]);
    if (!rowCount) throw bad('Seller not found.', 404);
    for (const t of ['products', 'combos', 'promo_codes', 'order_items'])
      await c.query(`UPDATE ${t} SET owner_id=$1 WHERE owner_id=$2`, [req.user.id, req.params.id]);
    await c.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    await c.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

/* ---------- Promo codes and settings ---------- */
app.get('/api/promos/check', auth, wrap(async (req, res) => {
  const p = await checkPromo(pool, req.query.code, req.user.id);
  if (!p) throw bad('Type a promo code first.');
  res.json({ code: p.code, percent: p.percent, owner_id: p.owner_id, product_ids: p.product_ids });
}));

app.get('/api/admin/promos', auth, staff, wrap(async (req, res) => {
  // Sellers can see every code but only change their own (the guard on toggle/delete enforces that).
  res.json((await pool.query('SELECT p.*, u.username AS owner FROM promo_codes p LEFT JOIN users u ON u.id=p.owner_id ORDER BY p.created_at DESC')).rows);
}));

app.post('/api/promos', auth, staff, wrap(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const percent = parseInt(req.body.percent);
  const maxUses = req.body.max_uses === '' || req.body.max_uses == null ? null : parseInt(req.body.max_uses);
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad('Code: 3-30 letters, numbers, - or _.');
  if (!(percent >= 1 && percent <= 90)) throw bad('Percent must be between 1 and 90.');
  if (maxUses !== null && !(maxUses >= 1)) throw bad('Max uses must be 1 or more.');
  const ids = (Array.isArray(req.body.product_ids) ? req.body.product_ids : []).map(Number).filter(Number.isInteger);
  let productIds = null; // null = universal: everything this seller sells
  if (ids.length) {
    const { rows } = await pool.query('SELECT id FROM products WHERE id = ANY($1) AND ($2 OR owner_id = $3)', [ids, req.user.role === 'admin', req.user.id]);
    if (rows.length !== new Set(ids).size) throw bad('You can only pick your own products.');
    productIds = rows.map((r) => r.id);
  }
  try {
    const { rows: [p] } = await pool.query('INSERT INTO promo_codes (code, percent, max_uses, owner_id, product_ids) VALUES ($1,$2,$3,$4,$5) RETURNING *', [code, percent, maxUses, req.user.id, productIds]);
    res.status(201).json(p);
  } catch (e) {
    if (e.code === '23505') throw bad('That code already exists.', 409);
    throw e;
  }
}));

app.patch('/api/promos/:id/active', auth, staff, wrap(async (req, res) => {
  await guard('promo_codes', req.params.id, req.user);
  const { rows: [p] } = await pool.query('UPDATE promo_codes SET is_active = NOT is_active WHERE id=$1 RETURNING id,is_active', [req.params.id]);
  if (!p) throw bad('Code not found.', 404);
  res.json(p);
}));

app.delete('/api/promos/:id', auth, staff, wrap(async (req, res) => {
  await guard('promo_codes', req.params.id, req.user);
  await pool.query('DELETE FROM promo_codes WHERE id=$1', [req.params.id]);
  res.sendStatus(204);
}));

app.get('/api/settings', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT key,value FROM settings');
  const o = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ banner: o.banner || '', stamp_reward: o.stamp_reward || 'a free snack' });
}));

app.put('/api/admin/settings', auth, admin, wrap(async (req, res) => {
  const put = (k, v) => pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v || '').trim().slice(0, 200)]);
  await put('banner', req.body.banner);
  await put('stamp_reward', req.body.stamp_reward);
  res.json({ ok: true });
}));

/* ---------- Errors & boot ---------- */
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = bad('Image must be 5 MB or smaller.');
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
init()
  .then(ensureCustomRequests)
  .then(ensureCategory)
  .then(ensureCombos)
  .then(ensureShop)
  .then(ensureOwners)
  .then(() => pool.query(`
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS product_ids INT[];
    CREATE TABLE IF NOT EXISTS combo_approvals (
      combo_id INT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status   VARCHAR(10) NOT NULL DEFAULT 'pending',
      PRIMARY KEY (combo_id, owner_id)
    );`))
  .then(() => app.listen(PORT, () => console.log(`Glass Shop running on :${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
