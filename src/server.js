const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, init } = require('./db');
const { sign, auth, admin } = require('./auth');

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
const COLS = 'id,title,description,price,is_sold_out,category,image_url,created_at';
const CATEGORIES = ['drinks', 'snacks'];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Adds the category column to products (safe to run every start; existing products become 'snacks').
const ensureCategory = () => pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'snacks'");

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
app.post('/api/products', auth, admin, upload.single('image'), wrap(async (req, res) => {
  const { title, description = '', price, category = 'snacks' } = req.body;
  if (!title || price === '' || isNaN(price) || price < 0) throw bad('Title and a valid price are required.');
  if (!CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  const f = req.file;
  const { rows: [p] } = await pool.query(
    'INSERT INTO products (title, description, price, image_data, image_mime, category) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [title, description, price, f ? f.buffer : null, f ? f.mimetype : null, category]
  );
  res.status(201).json(await withImage(p.id));
}));

app.put('/api/products/:id', auth, admin, upload.single('image'), wrap(async (req, res) => {
  const { title, description, price, category } = req.body;
  if (category !== undefined && !CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  if (price !== undefined && (price === '' || isNaN(price) || price < 0)) throw bad('Invalid price.');
  const f = req.file;
  const { rowCount } = await pool.query(
    `UPDATE products SET title=COALESCE($1,title), description=COALESCE($2,description), price=COALESCE($3,price),
       image_data=COALESCE($4,image_data), image_mime=COALESCE($5,image_mime), category=COALESCE($6,category) WHERE id=$7`,
    [title ?? null, description ?? null, price ?? null, f ? f.buffer : null, f ? f.mimetype : null, category ?? null, req.params.id]
  );
  if (!rowCount) throw bad('Product not found.', 404);
  res.json(await withImage(req.params.id));
}));

app.patch('/api/products/:id/sold-out', auth, admin, wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    `UPDATE products SET is_sold_out = NOT is_sold_out WHERE id=$1 RETURNING ${COLS}`, [req.params.id]);
  if (!p) throw bad('Product not found.', 404);
  res.json(p);
}));

app.delete('/api/products/:id', auth, admin, wrap(async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.sendStatus(204);
}));

/* ---------- Orders ---------- */
app.post('/api/orders', auth, wrap(async (req, res) => {
  const items = (req.body.items || []).filter((i) => parseInt(i.quantity) > 0);
  if (!items.length) throw bad('Your cart is empty.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT id,title,price,is_sold_out FROM products WHERE id = ANY($1)', [
      items.map((i) => parseInt(i.product_id)),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    let total = 0;
    const lines = items.map((i) => {
      const p = byId.get(parseInt(i.product_id));
      if (!p || p.is_sold_out) throw bad('An item in your cart is no longer available.');
      const q = Math.min(99, parseInt(i.quantity));
      total += Number(p.price) * q;
      return { p, q };
    });
    const { rows: [o] } = await c.query(
      'INSERT INTO orders (user_id, total) VALUES ($1,$2) RETURNING id,total,status,created_at',
      [req.user.id, total.toFixed(2)]
    );
    for (const { p, q } of lines)
      await c.query('INSERT INTO order_items (order_id, product_id, title, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)',
        [o.id, p.id, p.title, p.price, q]);
    await c.query('COMMIT');
    res.status(201).json(o);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

const ORDER_SQL = `SELECT o.id,o.total,o.status,o.created_at,u.username,
  (SELECT json_agg(json_build_object('title',title,'unit_price',unit_price,'quantity',quantity))
   FROM order_items WHERE order_id=o.id) AS items FROM orders o JOIN users u ON u.id=o.user_id`;

app.get('/api/orders/mine', auth, wrap(async (req, res) => {
  res.json((await pool.query(`${ORDER_SQL} WHERE o.user_id=$1 ORDER BY o.created_at DESC`, [req.user.id])).rows);
}));

app.get('/api/orders', auth, admin, wrap(async (req, res) => {
  res.json((await pool.query(`${ORDER_SQL} ORDER BY o.created_at DESC`)).rows);
}));

// Customer cancels their own order, only while it is still pending.
app.patch('/api/orders/:id/cancel', auth, wrap(async (req, res) => {
  const { rows: [o] } = await pool.query(
    "UPDATE orders SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id,status",
    [req.params.id, req.user.id]);
  if (!o) throw bad('Only pending orders can be cancelled.');
  res.json(o);
}));

// Admin moves an order along: pending -> packed (ready) -> completed, or cancelled.
app.patch('/api/orders/:id/status', auth, admin, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'packed', 'completed', 'cancelled'].includes(status)) throw bad('Invalid status.');
  const { rows: [o] } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,status', [status, req.params.id]);
  if (!o) throw bad('Order not found.', 404);
  res.json(o);
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
  res.status(201).json(r);
}));

app.get('/api/custom-requests/mine', auth, wrap(async (req, res) => {
  res.json((await pool.query(`${CR_SQL} WHERE r.user_id=$1 ORDER BY r.created_at DESC`, [req.user.id])).rows);
}));

app.get('/api/custom-requests', auth, admin, wrap(async (req, res) => {
  res.json((await pool.query(`${CR_SQL} ORDER BY r.created_at DESC`)).rows);
}));

// Admin sets a price (quoted) or says it can't be provided (unavailable).
app.patch('/api/custom-requests/:id/quote', auth, admin, wrap(async (req, res) => {
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
  res.json(r);
}));

/* ---------- Backup / restore (admin only) ---------- */
const BACKUP_TABLES = ['users', 'products', 'orders', 'order_items', 'custom_requests']; // parents first

app.get('/api/admin/export', auth, admin, wrap(async (req, res) => {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY id`);
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
    await c.query('TRUNCATE order_items, orders, custom_requests, products, users RESTART IDENTITY CASCADE');
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
      await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
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
  .then(() => app.listen(PORT, () => console.log(`Glass Shop running on :${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
