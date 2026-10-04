const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const zlib = require('zlib');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const { pool, init } = require('./db');
const { sign, auth, admin, staff } = require('./auth');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; this makes req.ip the visitor's real address
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
const COLS = 'id,title,description,price,is_sold_out,category,discount_percent,image_url,created_at,owner_id,stock';
const LOW_STOCK = 5; // warn at this many left or fewer
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
// Puts back the stock an order took (combo parts too). Safe to call twice.
const restoreStock = (db, id) => db.query(`WITH m AS (DELETE FROM order_stock WHERE order_id=$1 RETURNING product_id, qty)
  UPDATE products p SET stock = p.stock + m.qty, is_sold_out = false FROM m WHERE p.id = m.product_id AND p.stock IS NOT NULL`, [id]);
// What each seller's items are worth in one order after the promo discount (ownerId -> amount).
const shareOf = (o, sub) => {
  const sum = [...sub.values()].reduce((a, b) => a + b, 0), d = Number(o.discount) || 0, out = new Map(sub);
  if (d > 0) {
    if (!o.shop_wide && o.promo_owner != null && sub.has(o.promo_owner)) out.set(o.promo_owner, sub.get(o.promo_owner) - d);
    else if (sum > 0) for (const [k, v] of sub) out.set(k, v - (d * v) / sum);
  }
  return new Map([...out].map(([k, v]) => [k, Math.round(v * 100) / 100]));
};
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

// Tells every seller when a shop-wide code (which also discounts her items) is switched on.
const alertSellersShopWide = async (code, percent) => {
  try {
    const { rows } = await pool.query("SELECT id FROM users WHERE role='seller'");
    const msg = `Shop-wide promo ${code} (${percent}% off) is on. It also discounts your items.`;
    await notifySellers(new Map(rows.map((r) => [r.id, msg])));
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
// Login guard: 10 wrong passwords from one address locks that address out for 15 minutes.
const LOGIN_MAX = 10, LOGIN_WINDOW = 15 * 60e3, loginFails = new Map();
const lockedOut = (ip) => {
  const f = loginFails.get(ip);
  if (f && Date.now() - f.t > LOGIN_WINDOW) { loginFails.delete(ip); return 0; }
  return f && f.n >= LOGIN_MAX ? Math.ceil((LOGIN_WINDOW - (Date.now() - f.t)) / 60e3) : 0;
};
const failLogin = (ip) => {
  const f = loginFails.get(ip);
  loginFails.set(ip, f && Date.now() - f.t <= LOGIN_WINDOW ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() });
};
setInterval(() => { for (const [ip, f] of loginFails) if (Date.now() - f.t > LOGIN_WINDOW) loginFails.delete(ip); }, LOGIN_WINDOW).unref();
// Signup guard: each IP address can own at most 10 accounts in total (the address is saved on the account).
const MAX_ACCOUNTS_PER_IP = 10, MAX_ACCOUNTS_PER_DEVICE = 5;
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { rows: [n] } = await pool.query('SELECT count(*)::int AS n FROM users WHERE signup_ip=$1', [req.ip]);
  if (n.n >= MAX_ACCOUNTS_PER_IP) throw bad('This connection has reached the limit of accounts. Please talk to the seller.', 429);
  const { username = '', password = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username) || password.length < 8)
    throw bad('Username: 3-30 letters, numbers or _. Password: at least 8 characters.');
  // Device guard: each browser/device gets a random ID and can own at most 5 accounts.
  const device = String((req.body || {}).device_id || '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(device)) throw bad('Please refresh the page and try again.');
  const { rows: [dv] } = await pool.query('SELECT count(*)::int AS n FROM users WHERE device_id=$1', [device]);
  if (dv.n >= MAX_ACCOUNTS_PER_DEVICE) throw bad('This device has reached the limit of accounts. Please talk to the seller.', 429);
  try {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (username, password_hash, role, signup_ip, device_id) VALUES ($1,$2,'customer',$3,$4) RETURNING id,username,role",
      [username, await bcrypt.hash(password, 12), req.ip, device]
    );
    res.status(201).json({ token: sign(u), user: u });
  } catch (e) {
    if (e.code === '23505') throw bad('That username is taken.', 409);
    throw e;
  }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const wait = lockedOut(req.ip);
  if (wait) throw bad(`Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)', [username]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    failLogin(req.ip);
    throw bad('Wrong username or password.', 401);
  }
  loginFails.delete(req.ip);
  if (u.must_change && u.temp_expires && new Date(u.temp_expires) < new Date())
    throw bad('That temporary password expired. Ask the seller for a new one.', 401);
  const user = { id: u.id, username: u.username, role: u.role };
  res.json({ token: sign(user, u.must_change), user, must_change: !!u.must_change });
}));

// Used after a reset (temporary password) and open to everyone who wants to change their own password.
app.post('/api/auth/change-password', auth, wrap(async (req, res) => {
  const { current_password = '', new_password = '' } = req.body || {};
  const wait = lockedOut(req.ip);
  if (wait) throw bad(`Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);
  if (String(new_password).length < 8) throw bad('New password: at least 8 characters.');
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!u || !(await bcrypt.compare(String(current_password), u.password_hash))) { failLogin(req.ip); throw bad('The current password is wrong.', 401); }
  if (current_password === new_password) throw bad('Pick a different password.');
  await pool.query('UPDATE users SET password_hash=$1, must_change=false, temp_expires=NULL WHERE id=$2', [await bcrypt.hash(String(new_password), 12), u.id]);
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
  const stock = req.body.stock === undefined || req.body.stock === '' ? null : parseInt(req.body.stock);
  if (stock !== null && !(stock >= 0)) throw bad('Stock must be 0 or more.');
  const cost = req.body.cost === undefined || req.body.cost === '' ? null : Number(req.body.cost);
  if (cost !== null && !(cost >= 0)) throw bad('Cost must be 0 or more.');
  if (!title || price === '' || isNaN(price) || price < 0) throw bad('Title and a valid price are required.');
  if (!CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  const disc = parseInt(discount_percent) || 0;
  if (disc < 0 || disc > 90) throw bad('Discount must be between 0 and 90%.');
  const f = req.file;
  const owner = await pickOwner(req.user, req.body.owner_id);
  const { rows: [p] } = await pool.query(
    'INSERT INTO products (title, description, price, image_data, image_mime, category, discount_percent, owner_id, stock, is_sold_out, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [title, description, price, f ? f.buffer : null, f ? f.mimetype : null, category, disc, owner, stock, stock === 0, cost]
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
  const setStock = req.body.stock !== undefined; // empty = stop counting
  const stock = !setStock || req.body.stock === '' ? null : parseInt(req.body.stock);
  if (stock !== null && !(stock >= 0)) throw bad('Stock must be 0 or more.');
  const setCost = req.body.cost !== undefined; // empty = clear the cost
  const cost = !setCost || req.body.cost === '' ? null : Number(req.body.cost);
  if (cost !== null && !(cost >= 0)) throw bad('Cost must be 0 or more.');
  const { rowCount } = await pool.query(
    `UPDATE products SET cost=CASE WHEN $12::boolean THEN $13::numeric ELSE cost END,
       stock=CASE WHEN $10::boolean THEN $11::int ELSE stock END,
       is_sold_out=CASE WHEN $10::boolean AND $11::int IS NOT NULL THEN $11::int = 0 ELSE is_sold_out END, title=COALESCE($1,title), description=COALESCE($2,description), price=COALESCE($3,price),
       image_data=COALESCE($4,image_data), image_mime=COALESCE($5,image_mime), category=COALESCE($6,category), discount_percent=COALESCE($7,discount_percent), owner_id=COALESCE($9,owner_id) WHERE id=$8`,
    [title ?? null, description ?? null, price ?? null, f ? f.buffer : null, f ? f.mimetype : null, category ?? null, disc, req.params.id, newOwner, setStock, stock, setCost, cost]
  );
  if (!rowCount) throw bad('Product not found.', 404);
  res.json(await withImage(req.params.id));
}));

// Cost prices are private: only the owner (and Raven) can read them, and they never go out in the public product list.
app.get('/api/admin/costs', auth, staff, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id,cost FROM products WHERE cost IS NOT NULL AND ($1 OR owner_id=$2)', [isMain(req.user), req.user.id]);
  res.json(Object.fromEntries(rows.map((r) => [r.id, Number(r.cost)])));
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
    const allIds = [...new Set([...prodIds, ...combos.flatMap((cb) => cb.items.map((x) => x.product_id))])];
    const costOf = new Map((await c.query('SELECT id,cost FROM products WHERE id = ANY($1)', [allIds])).rows.map((r) => [r.id, r.cost == null ? null : Number(r.cost)]));
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
          const g = groups.get(k) || { owner: k, names: [], value: 0, cost: 0 };
          g.names.push(`${x.quantity}x ${x.title}`);
          g.value += finalPrice(x) * x.quantity;
          g.cost = g.cost === null || costOf.get(x.product_id) == null ? null : g.cost + costOf.get(x.product_id) * x.quantity;
          groups.set(k, g);
        }
        const list = [...groups.values()];
        const worth = list.reduce((sum, g) => sum + g.value, 0) || 1;
        let left = Number(cb.price);
        parts = list.map((g, n) => {
          const share = n === list.length - 1 ? left : Math.round((Number(cb.price) * g.value / worth) * 100) / 100;
          left = Math.round((left - share) * 100) / 100;
          return { pid: null, title: `Combo: ${cb.title} (${g.names.join(', ')})`, price: share, q, owner: g.owner, cost: g.cost };
        });
      } else {
        const p = byId.get(parseInt(i.product_id));
        if (!p || p.is_sold_out) throw bad('An item in your cart is no longer available.');
        parts = [{ pid: p.id, title: p.title, price: finalPrice(p), q, owner: p.owner_id, cost: costOf.get(p.id) ?? null }];
      }
      parts.forEach((l) => { total += l.price * l.q; });
      return parts;
    });
    // Blocked customers: shop-wide by the main admin, or from one seller's items by that seller.
    const { rows: blocks } = await c.query('SELECT blocked_by, shop_wide FROM customer_blocks WHERE user_id=$1', [req.user.id]);
    if (blocks.some((b) => b.shop_wide)) throw bad('Your account cannot place orders. Please talk to the seller.', 403);
    const hit = lines.find((l) => blocks.some((b) => b.blocked_by === l.owner));
    if (hit) throw bad(`A seller has blocked your account, so you cannot order "${hit.title}". Remove it from your cart.`, 403);
    // Stock: count what the order uses (combo parts too) and take it off the shelf.
    const need = new Map();
    for (const i of items) {
      const q = Math.min(99, parseInt(i.quantity));
      if (i.combo_id) for (const x of comboById.get(parseInt(i.combo_id)).items) need.set(x.product_id, (need.get(x.product_id) || 0) + x.quantity * q);
      else need.set(parseInt(i.product_id), (need.get(parseInt(i.product_id)) || 0) + q);
    }
    const { rows: counted } = await c.query('SELECT id,title,stock,owner_id FROM products WHERE id = ANY($1) AND stock IS NOT NULL ORDER BY id FOR UPDATE', [[...need.keys()]]);
    const low = [];
    for (const p of counted) {
      const left = p.stock - need.get(p.id);
      if (left < 0) throw bad(p.stock ? `Only ${p.stock} of "${p.title}" left.` : `"${p.title}" is sold out.`);
      await c.query('UPDATE products SET stock=$1::int, is_sold_out = is_sold_out OR $1::int = 0 WHERE id=$2', [left, p.id]);
      if (left <= LOW_STOCK) low.push({ ...p, left });
    }
    const promo = await checkPromo(c, req.body.promo, req.user.id);
    // A promo discounts the items its owner sells (or everything if it has no owner),
    // and only the chosen products when it is a per-product code.
    const eligible = (l) => (promo.shop_wide || promo.owner_id == null || l.owner === promo.owner_id)
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
      await c.query('INSERT INTO order_items (order_id, product_id, title, unit_price, quantity, owner_id, cost_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [o.id, l.pid, l.title, l.price.toFixed(2), l.q, l.owner ?? null, l.cost == null ? null : l.cost.toFixed(2)]);
    for (const p of counted) await c.query('INSERT INTO order_stock (order_id, product_id, qty) VALUES ($1,$2,$3)', [o.id, p.id, need.get(p.id)]);
    await c.query('COMMIT');
    for (const p of low) {
      const msg = p.left === 0 ? `Sold out: ${p.title}` : `Low stock: ${p.title} (${p.left} left)`;
      notify(msg); notifySellers(new Map([[p.owner_id, msg]]));
    }
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

const ORDER_SQL = `SELECT o.id,o.user_id,o.total,o.status,o.note,o.promo_code,o.discount,o.created_at,o.paid_by,o.paid_at,(SELECT username FROM users WHERE id=o.paid_by) AS paid_name,u.username,
  (SELECT json_agg(json_build_object('product_id',product_id,'title',title,'unit_price',unit_price,'quantity',quantity,'owner_id',owner_id))
   FROM order_items WHERE order_id=o.id) AS items,
  (SELECT json_agg(json_build_object('owner_id',x.owner_id,'username',pu.username,'status',COALESCE(a.status,'pending')) ORDER BY x.owner_id)
     FROM (SELECT DISTINCT owner_id FROM order_items WHERE order_id=o.id AND owner_id IS NOT NULL) x
     JOIN users pu ON pu.id=x.owner_id
     LEFT JOIN order_approvals a ON a.order_id=o.id AND a.owner_id=x.owner_id) AS parts,
  (SELECT pc.owner_id FROM promo_codes pc WHERE upper(pc.code)=upper(o.promo_code) LIMIT 1) AS promo_owner,
  (SELECT pc.shop_wide FROM promo_codes pc WHERE upper(pc.code)=upper(o.promo_code) LIMIT 1) AS promo_wide
  FROM orders o JOIN users u ON u.id=o.user_id`;

app.get('/api/orders/mine', auth, wrap(async (req, res) => {
  res.json((await pool.query(`${ORDER_SQL} WHERE o.user_id=$1 ORDER BY o.created_at DESC`, [req.user.id])).rows);
}));

// The main admin sees every order. A seller sees only orders that contain her items, and only those items.
app.get('/api/orders', auth, staff, wrap(async (req, res) => {
  if (isMain(req.user)) return res.json((await pool.query(`${ORDER_SQL} ORDER BY o.created_at DESC`)).rows);
  const { rows } = await pool.query(
    `SELECT o.id,o.user_id,o.status,o.note,o.promo_code,o.discount,o.created_at,o.paid_by,o.paid_at,(SELECT username FROM users WHERE id=o.paid_by) AS paid_name,u.username,
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
  await restoreStock(pool, o.id);
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
    if (status === 'cancelled') await restoreStock(pool, id);
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
  if (overall === 'cancelled') await restoreStock(pool, id);
  const waiting = ow.filter((r) => (got.get(r.owner_id) || 'pending') !== status && r.owner_id !== req.user.id).map((r) => r.username);
  if (waiting.length) {
    const msg = `Order #${id}: ${req.user.username} marked their part ${status}. Your approval is needed.`;
    notify(msg);
    notifySellers(new Map(owners.filter((x) => x !== req.user.id).map((x) => [x, msg])));
  }
  res.json({ id, status: overall, waiting });
}));

// Cash on delivery: tick Paid when the money is in hand. Whoever ticks it is the one holding the cash.
app.patch('/api/orders/:id/paid', auth, staff, wrap(async (req, res) => {
  const id = parseInt(req.params.id), paid = !!(req.body || {}).paid;
  if (!Number.isInteger(id)) throw bad('Order not found.', 404);
  const { rows: [o] } = await pool.query('SELECT status, paid_by FROM orders WHERE id=$1', [id]);
  if (!o) throw bad('Order not found.', 404);
  if (!isMain(req.user) && !(await pool.query('SELECT 1 FROM order_items WHERE order_id=$1 AND owner_id=$2', [id, req.user.id])).rowCount)
    throw bad('Order not found.', 404);
  if (paid) {
    const { rowCount } = await pool.query("UPDATE orders SET paid_by=$1, paid_at=now() WHERE id=$2 AND paid_by IS NULL AND status IN ('packed','completed')", [req.user.id, id]);
    if (!rowCount) throw bad(o.paid_by ? 'Already marked as paid.' : 'Pack the order before taking cash.', 409);
  } else {
    if (o.paid_by !== req.user.id && !isMain(req.user)) throw bad('Only the person who collected the cash can undo this.', 403);
    await pool.query('UPDATE orders SET paid_by=NULL, paid_at=NULL WHERE id=$1', [id]);
  }
  res.json({ ok: true });
}));

// Cash page: what is still to collect, what each seller collected, and who owes whom.
// Raven sees everything; a seller sees only her own figures.
const cashSummary = async (user) => {
  const me = user.id, main = isMain(user);
  const { rows: ords } = await pool.query(`SELECT o.id,o.created_at,o.status,o.discount,o.paid_by,pc.owner_id AS promo_owner,COALESCE(pc.shop_wide,false) AS shop_wide
    FROM orders o LEFT JOIN promo_codes pc ON upper(pc.code)=upper(o.promo_code) WHERE o.status<>'cancelled'`);
  const { rows: its } = await pool.query('SELECT order_id,owner_id,SUM(unit_price*quantity)::float AS sub FROM order_items WHERE owner_id IS NOT NULL GROUP BY order_id,owner_id');
  const subs = new Map();
  for (const r of its) { if (!subs.has(r.order_id)) subs.set(r.order_id, new Map()); subs.get(r.order_id).set(r.owner_id, r.sub); }
  const { rows: team } = await pool.query("SELECT id,username FROM users WHERE role IN ('admin','seller')");
  const name = new Map(team.map((u) => [u.id, u.username]));
  const unpaid = [], collected = new Map(), owes = new Map();
  for (const o of ords) {
    const sub = subs.get(o.id); if (!sub) continue;
    const sh = shareOf(o, sub);
    if (!o.paid_by) {
      if (main || sh.has(me)) unpaid.push({ id: o.id, created_at: o.created_at, status: o.status, shares: Object.fromEntries([...sh].filter(([k]) => main || k === me)) });
      continue;
    }
    const c = collected.get(o.paid_by) || { amount: 0, orders: 0 };
    c.amount += [...sh.values()].reduce((a, b) => a + b, 0); c.orders++; collected.set(o.paid_by, c);
    for (const [k, v] of sh) if (k !== o.paid_by) owes.set(`${o.paid_by}>${k}`, (owes.get(`${o.paid_by}>${k}`) || 0) + v);
  }
  const { rows: sets } = await pool.query('SELECT from_id,to_id,SUM(amount)::float AS amt FROM settlements GROUP BY from_id,to_id');
  const settled = new Map(sets.map((r) => [`${r.from_id}>${r.to_id}`, r.amt]));
  const net = (a, b) => (owes.get(`${a}>${b}`) || 0) - (settled.get(`${a}>${b}`) || 0) - ((owes.get(`${b}>${a}`) || 0) - (settled.get(`${b}>${a}`) || 0));
  const balances = [], seen = new Set();
  for (const k of [...owes.keys(), ...settled.keys()]) {
    const [a, b] = k.split('>').map(Number), key = [a, b].sort().join('>');
    if (seen.has(key)) continue; seen.add(key);
    const n = Math.round(net(a, b) * 100) / 100;
    if (Math.abs(n) < 0.01 || !(main || a === me || b === me)) continue;
    const [from, to] = n > 0 ? [a, b] : [b, a];
    balances.push({ from, to, from_name: name.get(from), to_name: name.get(to), amount: Math.abs(n) });
  }
  const { rows: recent } = await pool.query(`SELECT s.id,s.from_id,s.to_id,s.amount,s.created_at FROM settlements s
    WHERE $1 OR s.from_id=$2 OR s.to_id=$2 ORDER BY s.created_at DESC LIMIT 15`, [main, me]);
  return {
    unpaid,
    collected: [...collected].filter(([id]) => main || id === me).map(([id, c]) => ({ id, username: name.get(id), amount: Math.round(c.amount * 100) / 100, orders: c.orders })),
    balances,
    settlements: recent.map((r) => ({ ...r, from_name: name.get(r.from_id), to_name: name.get(r.to_id) })),
  };
};
app.get('/api/admin/cash', auth, staff, wrap(async (req, res) => res.json(await cashSummary(req.user))));

// Record money handed over between sellers. Only the one who received it (or Raven) can record it.
app.post('/api/admin/settlements', auth, staff, wrap(async (req, res) => {
  const from = parseInt(req.body.from_id), to = parseInt(req.body.to_id), amount = Number(req.body.amount);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || !(amount > 0 && amount < 99999999)) throw bad('Enter a valid amount.');
  if (!isMain(req.user) && req.user.id !== to) throw bad('Only the seller who received the money can record it.', 403);
  const { rowCount } = await pool.query("SELECT 1 FROM users WHERE id IN ($1,$2) AND role IN ('admin','seller') HAVING count(*)=2", [from, to]);
  if (!rowCount) throw bad('Seller not found.', 404);
  await pool.query('INSERT INTO settlements (from_id, to_id, amount) VALUES ($1,$2,$3)', [from, to, amount.toFixed(2)]);
  notifySellers(new Map([[from, `${req.user.username} recorded ${amount.toFixed(2)} received from you.`]]));
  res.status(201).json({ ok: true });
}));

/* ---------- Custom requests ---------- */
const CR_SQL = `SELECT r.id,r.description,r.status,r.quoted_price,r.admin_note,r.created_at,r.updated_at,u.username
  FROM custom_requests r JOIN users u ON u.id=r.user_id`;

// Customer submits a request.
app.post('/api/custom-requests', auth, wrap(async (req, res) => {
  const { rowCount: blockedAll } = await pool.query('SELECT 1 FROM customer_blocks WHERE user_id=$1 AND shop_wide', [req.user.id]);
  if (blockedAll) throw bad('Your account cannot send requests. Please talk to the seller.', 403);
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
const BACKUP_TABLES = ['users', 'customer_blocks', 'products', 'combos', 'combo_items', 'combo_approvals', 'promo_codes', 'settings', 'orders', 'order_items', 'custom_requests', 'order_approvals', 'order_stock', 'settlements', 'password_resets']; // parents first

const buildBackup = async () => {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY ${{ order_approvals: 'order_id', combo_approvals: 'combo_id', order_stock: 'order_id' }[t] || 'id'}`);
    tables[t] = rows.map((row) => {
      for (const k in row) if (Buffer.isBuffer(row[k])) row[k] = { $b64: row[k].toString('base64') }; // product photos
      return row;
    });
  }
  return JSON.stringify({ app: 'glass-shop', version: 1, exported_at: new Date().toISOString(), tables });
};
const putSetting = (k, v) => pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v)]);
const getSetting = async (k) => ((await pool.query('SELECT value FROM settings WHERE key=$1', [k])).rows[0] || {}).value || '';

app.get('/api/admin/export', auth, admin, wrap(async (req, res) => {
  const body = await buildBackup();
  await putSetting('last_backup', new Date().toISOString());
  res.set('Content-Type', 'application/json').send(body);
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
    await c.query('TRUNCATE password_resets, settlements, order_stock, customer_blocks, order_approvals, order_items, orders, custom_requests, combo_approvals, combo_items, combos, promo_codes, settings, products, users RESTART IDENTITY CASCADE');
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
      if (!['order_approvals', 'combo_approvals', 'order_stock'].includes(t)) await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
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

app.get('/api/admin/backups', auth, admin, wrap(async (req, res) => {
  res.json((await pool.query('SELECT id,size,created_at FROM backups ORDER BY created_at DESC, id DESC')).rows);
}));

app.get('/api/admin/backups/:id/download', auth, admin, wrap(async (req, res) => {
  const { rows: [b] } = await pool.query('SELECT data,created_at FROM backups WHERE id=$1', [parseInt(req.params.id) || 0]);
  if (!b) throw bad('Backup not found.', 404);
  res.set('Content-Type', 'application/json')
    .set('Content-Disposition', `attachment; filename="shop-backup-${b.created_at.toISOString().slice(0, 10)}.json"`)
    .send(await gunzip(b.data));
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
    await c.query('UPDATE orders SET paid_by=$1 WHERE paid_by=$2', [req.user.id, req.params.id]);
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
  res.json({ code: p.code, percent: p.percent, owner_id: p.owner_id, product_ids: p.product_ids, shop_wide: p.shop_wide });
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
  const wide = !!req.body.shop_wide; // works on every seller's items; only the main admin may switch it on
  if (wide && !isMain(req.user)) throw bad('Only the main admin can make shop-wide codes.', 403);
  let productIds = null; // null = universal: everything this seller sells
  if (ids.length && !wide) {
    const { rows } = await pool.query('SELECT id FROM products WHERE id = ANY($1) AND ($2 OR owner_id = $3)', [ids, req.user.role === 'admin', req.user.id]);
    if (rows.length !== new Set(ids).size) throw bad('You can only pick your own products.');
    productIds = rows.map((r) => r.id);
  }
  try {
    const { rows: [p] } = await pool.query('INSERT INTO promo_codes (code, percent, max_uses, owner_id, product_ids, shop_wide) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [code, percent, maxUses, req.user.id, productIds, wide]);
    if (wide) alertSellersShopWide(code, percent);
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

// The main admin switches a code between "my items only" and "every seller's items".
app.patch('/api/promos/:id/shop-wide', auth, admin, wrap(async (req, res) => {
  const { rows: [p] } = await pool.query(
    'UPDATE promo_codes SET shop_wide = NOT shop_wide, product_ids = CASE WHEN NOT shop_wide THEN NULL ELSE product_ids END WHERE id=$1 RETURNING id,code,percent,shop_wide',
    [req.params.id]);
  if (!p) throw bad('Code not found.', 404);
  if (p.shop_wide) alertSellersShopWide(p.code, p.percent);
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

/* ---------- Blocking customers who abuse the shop ---------- */
// Raven sees every customer; a seller sees customers who ordered her items (or whom she blocked).
app.get('/api/customers', auth, staff, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username,
      count(DISTINCT o.id)::int AS orders,
      (count(DISTINCT o.id) FILTER (WHERE o.status='completed'))::int AS completed,
      (count(DISTINCT o.id) FILTER (WHERE o.status='cancelled'))::int AS cancelled,
      EXISTS (SELECT 1 FROM customer_blocks b WHERE b.user_id=u.id AND b.shop_wide) AS blocked_shop,
      EXISTS (SELECT 1 FROM customer_blocks b WHERE b.user_id=u.id AND b.blocked_by=$1) AS blocked_by_me,
      (SELECT reason FROM customer_blocks b WHERE b.user_id=u.id AND b.blocked_by=$1) AS my_reason,
      (SELECT max(created_at) FROM password_resets r WHERE r.user_id=u.id) AS last_reset
    FROM users u
    LEFT JOIN orders o ON o.user_id=u.id AND ($2::boolean OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.owner_id=$1))
    WHERE u.role='customer'
    GROUP BY u.id
    HAVING $2::boolean OR count(o.id) > 0 OR EXISTS (SELECT 1 FROM customer_blocks b WHERE b.user_id=u.id AND b.blocked_by=$1)
    ORDER BY cancelled DESC, orders DESC, u.username`, [req.user.id, isMain(req.user)]);
  res.json(rows);
}));

// Raven's block covers the whole shop; a seller's block covers only her own items.
app.post('/api/customers/:id/block', auth, staff, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Customer not found.', 404);
  const reason = String((req.body || {}).reason || '').trim().slice(0, 200);
  const { rows: [u] } = await pool.query("SELECT id, username FROM users WHERE id=$1 AND role='customer'", [id]);
  if (!u) throw bad('Customer not found.', 404);
  await pool.query(
    `INSERT INTO customer_blocks (user_id, blocked_by, shop_wide, reason) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, blocked_by) DO UPDATE SET reason=EXCLUDED.reason, shop_wide=EXCLUDED.shop_wide`,
    [u.id, req.user.id, isMain(req.user), reason]);
  if (!isMain(req.user)) notify(`${req.user.username} blocked ${u.username}${reason ? ': ' + reason : ''}`);
  res.json({ ok: true });
}));

// Raven resets a customer's password: needs Raven's own password again, max 5 per hour, every reset is logged and alerts his phone.
// The customer gets a random temporary password that works for 24 hours and only lets them set a new one.
const TEMP_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
app.post('/api/admin/customers/:id/reset-password', auth, admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Customer not found.', 404);
  const wait = lockedOut(req.ip);
  if (wait) throw bad(`Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);
  const { rows: [me] } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!me || !(await bcrypt.compare(String((req.body || {}).admin_password || ''), me.password_hash))) { failLogin(req.ip); throw bad('Your admin password is wrong.', 401); }
  const { rows: [n] } = await pool.query("SELECT count(*)::int AS n FROM password_resets WHERE by_id=$1 AND created_at > now() - interval '1 hour'", [req.user.id]);
  if (n.n >= 5) throw bad('You reset 5 passwords in the last hour. Try again later.', 429);
  const { rows: [u] } = await pool.query("SELECT id, username FROM users WHERE id=$1 AND role='customer'", [id]);
  if (!u) throw bad('Customer not found.', 404);
  const temp = Array.from(crypto.randomBytes(10), (b) => TEMP_CHARS[b % TEMP_CHARS.length]).join('');
  await pool.query("UPDATE users SET password_hash=$1, must_change=true, temp_expires=now() + interval '24 hours' WHERE id=$2", [await bcrypt.hash(temp, 12), u.id]);
  await pool.query('INSERT INTO password_resets (user_id, by_id) VALUES ($1,$2)', [u.id, req.user.id]);
  notify(`Password reset for ${u.username} by ${req.user.username}.`);
  res.json({ username: u.username, password: temp });
}));

app.delete('/api/customers/:id/block', auth, staff, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Customer not found.', 404);
  await pool.query('DELETE FROM customer_blocks WHERE user_id=$1 AND blocked_by=$2', [id, req.user.id]);
  res.sendStatus(204);
}));

/* ---------- Sales and profit report ---------- */
const TZ = process.env.REPORT_TZ || 'Asia/Manila';
const r2 = (n) => Math.round(n * 100) / 100;
const localParts = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), dow: p.weekday };
};

// Completed orders only. Raven sees the whole shop; a seller sees only her own items.
// Profit = what she sold (after her share of any promo) minus the cost prices saved on the order lines.
const reportData = async (user, days) => {
  const main = isMain(user), mine = (id) => main || id === user.id;
  const { rows: ords } = await pool.query(`SELECT o.id, to_char(o.created_at AT TIME ZONE $1,'YYYY-MM-DD') AS day, o.discount, pc.owner_id AS promo_owner, COALESCE(pc.shop_wide,false) AS shop_wide
    FROM orders o LEFT JOIN promo_codes pc ON upper(pc.code)=upper(o.promo_code)
    WHERE o.status='completed' AND o.created_at >= now() - make_interval(days => $2::int)`, [TZ, days]);
  const { rows: its } = await pool.query(`SELECT order_id,owner_id,title,quantity,unit_price::float AS price,cost_price::float AS cost
    FROM order_items WHERE owner_id IS NOT NULL AND order_id = ANY($1)`, [ords.map((o) => o.id)]);
  const byOrder = new Map();
  for (const i of its) { if (!byOrder.has(i.order_id)) byOrder.set(i.order_id, []); byOrder.get(i.order_id).push(i); }
  const dayMap = new Map(), itemMap = new Map();
  let missing = 0;
  for (const o of ords) {
    const lines = byOrder.get(o.id) || [], sub = new Map(), cost = new Map();
    for (const i of lines) {
      sub.set(i.owner_id, (sub.get(i.owner_id) || 0) + i.price * i.quantity);
      if (i.cost != null) cost.set(i.owner_id, (cost.get(i.owner_id) || 0) + i.cost * i.quantity);
    }
    const owners = [...sub.keys()].filter(mine);
    if (!owners.length) continue;
    const share = shareOf(o, sub), d = dayMap.get(o.day) || { day: o.day, orders: 0, revenue: 0, profit: 0 };
    d.orders++;
    for (const id of owners) { d.revenue += share.get(id); d.profit += share.get(id) - (cost.get(id) || 0); }
    dayMap.set(o.day, d);
    for (const i of lines.filter((x) => mine(x.owner_id))) {
      const t = itemMap.get(i.title) || { title: i.title, qty: 0, revenue: 0, profit: 0, known: true };
      t.qty += i.quantity; t.revenue += i.price * i.quantity;
      if (i.cost == null) { t.known = false; missing++; } else t.profit += (i.price - i.cost) * i.quantity;
      itemMap.set(i.title, t);
    }
  }
  return {
    days: [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({ ...d, revenue: r2(d.revenue), profit: r2(d.profit) })),
    items: [...itemMap.values()].sort((a, b) => b.profit - a.profit).map((t) => ({ ...t, revenue: r2(t.revenue), profit: r2(t.profit) })),
    missing_cost: missing,
  };
};

// Per seller / admin (never a grand total): gross = completed orders, potential = pending + packed orders still to come.
// Each person's figure is her own items after her share of any promo. Raven sees one row per person; a seller sees only her own row.
const peopleTotals = async (user) => {
  const main = isMain(user);
  const { rows: ords } = await pool.query(`SELECT o.id,o.status,o.discount,pc.owner_id AS promo_owner,COALESCE(pc.shop_wide,false) AS shop_wide
    FROM orders o LEFT JOIN promo_codes pc ON upper(pc.code)=upper(o.promo_code) WHERE o.status IN ('pending','packed','completed')`);
  const { rows: its } = await pool.query('SELECT order_id,owner_id,SUM(unit_price*quantity)::float AS sub FROM order_items WHERE owner_id IS NOT NULL GROUP BY order_id,owner_id');
  const subs = new Map();
  for (const r of its) { if (!subs.has(r.order_id)) subs.set(r.order_id, new Map()); subs.get(r.order_id).set(r.owner_id, r.sub); }
  const { rows: team } = await pool.query("SELECT id,username,role FROM users WHERE role IN ('admin','seller') ORDER BY (role='admin') DESC, id");
  const out = new Map(team.map((u) => [u.id, { id: u.id, username: u.username, role: u.role, gross: 0, potential: 0, done: 0, open: 0 }]));
  for (const o of ords) {
    const sub = subs.get(o.id); if (!sub) continue;
    for (const [id, v] of shareOf(o, sub)) {
      const row = out.get(id); if (!row) continue;
      if (o.status === 'completed') { row.gross += v; row.done++; } else { row.potential += v; row.open++; }
    }
  }
  return [...out.values()].filter((r) => main || r.id === user.id).map((r) => ({ ...r, gross: r2(r.gross), potential: r2(r.potential) }));
};

app.get('/api/admin/report', auth, staff, wrap(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
  res.json({ today: localParts().date, people: await peopleTotals(req.user), ...(await reportData(req.user, days)) });
}));

/* ---------- Automatic backup (every 3 days) ---------- */
// Each automatic backup is kept inside the site (Admin > Backup, newest 5). If Telegram or ntfy is set up, a copy is also sent there.
const BACKUP_EVERY = 3 * 24 * 3600e3, KEEP_BACKUPS = 5;
async function autoBackup() {
  const name = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const body = await buildBackup();
    const zipped = await gzip(Buffer.from(body));
    await pool.query('INSERT INTO backups (size, data) VALUES ($1,$2)', [zipped.length, zipped]);
    await pool.query('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC, id DESC LIMIT $1)', [KEEP_BACKUPS]);
    await putSetting('last_auto_backup', new Date().toISOString());
    const tg = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID, nt = process.env.NTFY_TOPIC;
    if (!tg && !nt) return;
    let r;
    if (tg) {
      const fd = new FormData();
      fd.append('chat_id', process.env.TELEGRAM_CHAT_ID);
      fd.append('document', new Blob([body], { type: 'application/json' }), name);
      r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
    } else {
      r = await fetch(`https://ntfy.sh/${encodeURIComponent(nt)}`, { method: 'PUT', body, headers: { Filename: name, Title: 'Glass Shop backup' } });
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.error('Auto backup failed:', e.message);
    notify('Auto backup failed. Please download one by hand in Admin > Backup.');
  }
}

// Checked every 5 minutes. If the free server was asleep when a backup was due, it catches up when it wakes.
let busy = false, lastBackupTry = 0;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const last = await getSetting('last_auto_backup');
    if ((!last || Date.now() - new Date(last) > BACKUP_EVERY) && Date.now() - lastBackupTry > 3600e3) { lastBackupTry = Date.now(); await autoBackup(); }
  } catch (e) { console.error('Scheduled job failed:', e.message); } finally { busy = false; }
}

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
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS shop_wide BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS combo_approvals (
      combo_id INT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status   VARCHAR(10) NOT NULL DEFAULT 'pending',
      PRIMARY KEY (combo_id, owner_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(64);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id VARCHAR(64);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_expires TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS password_resets (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      by_id      INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT CHECK (stock >= 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) CHECK (cost >= 0);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_by INT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS order_stock (
      order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty        INT NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS settlements (
      id         SERIAL PRIMARY KEY,
      from_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS backups (
      id         SERIAL PRIMARY KEY,
      size       INT NOT NULL,
      data       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS customer_blocks (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shop_wide  BOOLEAN NOT NULL DEFAULT false,
      reason     VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, blocked_by)
    );`))
  .then(() => app.listen(PORT, () => { console.log(`Glass Shop running on :${PORT}`); setInterval(tick, 5 * 60 * 1000); setTimeout(tick, 20000); }))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
