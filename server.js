const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, init } = require('./db');
const { sign, auth, admin } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype)),
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const COLS = 'id,title,description,price,is_sold_out,image_url,created_at';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

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
  const { title, description = '', price } = req.body;
  if (!title || price === '' || isNaN(price) || price < 0) throw bad('Title and a valid price are required.');
  const f = req.file;
  const { rows: [p] } = await pool.query(
    'INSERT INTO products (title, description, price, image_data, image_mime) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [title, description, price, f ? f.buffer : null, f ? f.mimetype : null]
  );
  res.status(201).json(await withImage(p.id));
}));

app.put('/api/products/:id', auth, admin, upload.single('image'), wrap(async (req, res) => {
  const { title, description, price } = req.body;
  if (price !== undefined && (price === '' || isNaN(price) || price < 0)) throw bad('Invalid price.');
  const f = req.file;
  const { rowCount } = await pool.query(
    `UPDATE products SET title=COALESCE($1,title), description=COALESCE($2,description), price=COALESCE($3,price),
       image_data=COALESCE($4,image_data), image_mime=COALESCE($5,image_mime) WHERE id=$6`,
    [title ?? null, description ?? null, price ?? null, f ? f.buffer : null, f ? f.mimetype : null, req.params.id]
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

/* ---------- Errors & boot ---------- */
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = bad('Image must be 5 MB or smaller.');
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log(`Glass Shop running on :${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
