const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const zlib = require('zlib');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const { pool, init } = require('./db');
const { sign, auth, admin, staff, invalidateUser } = require('./auth');

const app = express();
const compression = require('compression');
const sharp = require('sharp');
app.set('trust proxy', 1); // Render sits behind a proxy; this makes req.ip the visitor's real address
// Gzip text responses (the JSON lists, HTML, CSS, JS) over 1 KB. Images are already compressed, so they are skipped. Same data, a fraction of the bytes; polling stays just as fresh.
app.use(compression({ threshold: 1024 }));
// Small safety headers on everything.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
// "Revision": a counter that goes up whenever anything is changed through the API. Phones ask /api/rev (a few bytes) every few
// seconds and only download the real lists when it moved. Same live feel as before, a fraction of the outbound traffic.
// (One server process, which is what Render's free plan runs. After a restart the id changes, so every phone refreshes once.)
let REV = 0;
const BOOT_ID = Date.now().toString(36);
app.use('/api', (req, res, next) => {
  // Live data must never be kept by a shared cache; the browser may keep it only to ask "has this changed?" (304, no body).
  res.set('Cache-Control', 'private, no-cache');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.path.startsWith('/auth/') && !req.path.startsWith('/favorites')) res.on('finish', () => { if (res.statusCode < 400) REV++; }); // logging in changes nothing anyone else sees
  next();
});
/* ---------- Activity log (who changed what) ---------- */
// Every successful change made by raven or a seller is written down: what, who, and the old value where it matters.
// Passwords and other secrets are never written. The newest 5000 lines are kept.
const money2 = (v) => (v === undefined || v === null || v === '' || isNaN(v) ? null : Number(v).toFixed(2));
const brief = (b) => Object.entries(b || {}).filter(([k, v]) => !/pass|token|secret|data/i.test(k) && v !== undefined && v !== '')
  .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} items` : String(v).slice(0, 60)}`).join(', ');
const SNAP = {
  product: 'SELECT title, price, stock, discount_percent, category, cost, bulk_min, bulk_percent, is_sold_out FROM products WHERE id=$1',
  combo: 'SELECT title FROM combos WHERE id=$1',
  order: 'SELECT status FROM orders WHERE id=$1',
  user: 'SELECT username FROM users WHERE id=$1',
  promo: 'SELECT code FROM promo_codes WHERE id=$1',
};
const FIELDS = [['title', 'name'], ['price', 'price'], ['stock', 'stock'], ['discount_percent', 'discount %'], ['category', 'category'], ['cost', 'cost'], ['bulk_min', 'bulk min'], ['bulk_percent', 'bulk %']];
const same = (a, b) => (a === null || a === undefined ? '' : String(a)) === (b === null || b === undefined ? '' : String(b)) || (a !== '' && b !== '' && a != null && b != null && !isNaN(a) && !isNaN(b) && Number(a) === Number(b));
const AUDIT_RULES = [
  { m: 'POST', re: /^\/products$/, f: (b) => ['Added a product', `${b.title} at ${money2(b.price)}${b.stock ? `, stock ${b.stock}` : ''}`] },
  { m: 'PUT', re: /^\/products\/(\d+)$/, snap: 'product', f: (b, o) => {
    const ch = o ? FIELDS.filter(([k]) => b[k] !== undefined && !same(o[k], b[k])).map(([k, l]) => `${l} ${o[k] ?? '-'} -> ${b[k] === '' ? '-' : b[k]}`) : [];
    return ['Edited a product', `${o ? o.title : ''}: ${ch.join('; ') || 'description or photo'}`];
  } },
  { m: 'PATCH', re: /^\/products\/(\d+)\/sold-out$/, snap: 'product', f: (b, o) => ['Changed sold-out', `${o ? o.title : ''} (was ${o && o.is_sold_out ? 'sold out' : 'in stock'})`] },
  { m: 'PATCH', re: /^\/products\/category$/, f: (b) => ['Moved products to another category', brief(b)] },
  { m: 'PATCH', re: /^\/products\/discount$/, f: (b) => ['Changed discounts on products', brief(b)] },
  { m: 'DELETE', re: /^\/products\/(\d+)$/, snap: 'product', f: (b, o) => ['Deleted a product', o ? o.title : ''] },
  { m: 'POST', re: /^\/combos$/, f: (b) => ['Created a combo', `${b.title} at ${money2(b.price)}`] },
  { m: 'PATCH', re: /^\/combos\/(\d+)\/active$/, snap: 'combo', f: (b, o) => ['Turned a combo on/off', o ? o.title : ''] },
  { m: 'PATCH', re: /^\/combos\/(\d+)\/approval$/, snap: 'combo', f: (b, o) => ['Answered a combo approval', `${o ? o.title : ''} (${b.status || b.approve || ''})`] },
  { m: 'DELETE', re: /^\/combos\/(\d+)$/, snap: 'combo', f: (b, o) => ['Deleted a combo', o ? o.title : ''] },
  { m: 'PATCH', re: /^\/orders\/(\d+)\/status$/, snap: 'order', f: (b, o, id) => [`Order #${id} status`, `${o ? o.status : '?'} -> ${b.status}`] },
  { m: 'PATCH', re: /^\/orders\/(\d+)\/paid$/, f: (b, o, id) => [`Order #${id} payment`, b.paid ? 'marked paid' : 'paid tick removed'] },
  { m: 'POST', re: /^\/orders\/reprice$/, f: () => ['Re-priced open orders', ''] },
  { m: 'POST', re: /^\/admin\/sellers$/, f: (b) => ['Created a seller', b.username] },
  { m: 'PATCH', re: /^\/admin\/sellers\/(\d+)$/, snap: 'user', f: (b, o) => ['Renamed a seller', `${o ? o.username : ''} -> ${b.username}`] },
  { m: 'PATCH', re: /^\/admin\/sellers\/(\d+)\/password$/, snap: 'user', f: (b, o) => ['Reset a seller password', o ? o.username : ''] },
  { m: 'DELETE', re: /^\/admin\/sellers\/(\d+)$/, snap: 'user', f: (b, o) => ['Removed a seller', o ? o.username : ''] },
  { m: 'POST', re: /^\/admin\/sellers\/(\d+)\/split-off$/, snap: 'user', f: (b, o) => ['Split off a seller', o ? o.username : ''] },
  { m: 'PUT', re: /^\/admin\/settings$/, f: (b) => ['Changed shop settings', brief(b)] },
  { m: 'POST', re: /^\/admin\/import$/, f: () => ['Restored a backup', ''] },
  { m: 'POST', re: /^\/promos$/, f: (b) => ['Created a promo code', brief({ code: b.code, percent: b.percent, amount: b.amount })] },
  { m: 'PATCH', re: /^\/promos\/(\d+)\/active$/, snap: 'promo', f: (b, o) => ['Turned a promo on/off', o ? o.code : ''] },
  { m: 'PATCH', re: /^\/promos\/(\d+)\/shop-wide$/, snap: 'promo', f: (b, o) => ['Changed a promo to/from shop-wide', o ? o.code : ''] },
  { m: 'DELETE', re: /^\/promos\/(\d+)$/, snap: 'promo', f: (b, o) => ['Deleted a promo', o ? o.code : ''] },
];
let auditN = 0;
async function writeAudit(req, action, detail) {
  try {
    await pool.query('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, req.user.username, req.user.role, action, String(detail || '').slice(0, 500)]);
    if (++auditN % 200 === 0) await pool.query('DELETE FROM audit_log WHERE id < (SELECT COALESCE(MAX(id),0) - 5000 FROM audit_log)');
  } catch (e) { console.error('Activity log failed:', e.message); }
}
app.use('/api', async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const rule = AUDIT_RULES.find((r) => r.m === req.method && r.re.test(req.path));
  if (!rule) return next();
  const id = (req.path.match(rule.re) || [])[1];
  let old;
  if (rule.snap && id) { try { old = (await pool.query(SNAP[rule.snap], [id])).rows[0]; } catch (e) { /* the log line just has less detail */ } }
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user || !['admin', 'seller'].includes(req.user.role)) return;
    try { const [a, d] = rule.f(req.body || {}, old, id); writeAudit(req, a, d); } catch (e) { /* never break a request over the log */ }
  });
  next();
});
const json = express.json({ limit: '200kb' });
// The restore route accepts big files, so it brings its own larger body parser.
app.use((req, res, next) => (req.path === '/api/admin/import' ? next() : json(req, res, next)));
// The service worker must never be cached hard, or a new version of the app would not reach phones.
app.get('/sw.js', (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(path.join(__dirname, '../public'), {
  etag: true,
  setHeaders: (res, file) => { // icons never change under the same name; code files are re-checked (304 = a few hundred bytes)
    if (/\.(png|ico)$/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
  },
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype)),
});
// Shrinks an uploaded photo before it is stored: longest side at most 1400 px, WebP at quality 82 (looks the same on a phone, about a tenth of the size).
// Animated GIFs are left alone, and if anything goes wrong the original photo is stored as it was, so an upload never fails because of this.
async function squeeze(f) {
  if (!f || f.mimetype === 'image/gif') return f || null;
  try {
    const buffer = await sharp(f.buffer).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    return buffer.length < f.buffer.length ? { buffer, mimetype: 'image/webp' } : f;
  } catch (e) { return f; }
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const COLS = 'id,title,description,price,is_sold_out,category,discount_percent,bulk_min,bulk_percent,image_url,created_at,owner_id,stock';
const LOW_STOCK = 5; // warn at this many left or fewer
const CATEGORIES = ['drinks', 'snacks'];
// Price after the product's % discount. The server always works the price out itself.
const finalPrice = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_percent) || 0))) / 100;
// Bulk discount ("buy N or more, get X% off each"): a seller sets it per product. It does not stack with the regular % discount:
// the customer simply gets whichever price is lower once they buy enough.
const unitFor = (p, qty) => {
  const min = Number(p.bulk_min), pct = Number(p.bulk_percent);
  if (!(min >= 2 && pct > 0 && qty >= min)) return finalPrice(p);
  return Math.min(finalPrice(p), Math.round(Number(p.price) * (100 - pct)) / 100);
};
// Both numbers or neither. A % without a quantity is refused; a quantity without a % just means no bulk deal.
const parseBulk = (body) => {
  const pct = body.bulk_percent === undefined || body.bulk_percent === '' ? 0 : parseInt(body.bulk_percent);
  const min = body.bulk_min === undefined || body.bulk_min === '' ? null : parseInt(body.bulk_min);
  if (!(pct >= 0 && pct <= 90)) throw bad('Bulk discount must be between 0 and 90%.');
  if (!pct) return { min: null, pct: 0 };
  if (!(min >= 2 && min <= 999)) throw bad('For a bulk discount, enter how many must be bought (2 or more).');
  return { min, pct };
};
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
const notifyAll = async (text, by = null) => { // custom requests are a shared inbox: raven and every seller hear about them (except whoever just acted)
  if (!by || by.role !== 'admin') notify(text);
  try {
    const { rows } = await pool.query("SELECT id FROM users WHERE role='seller' AND ntfy_topic <> '' AND id <> $1", [by ? by.id : 0]);
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
  // Inside an order the code's row is locked, so two orders placed at the same moment cannot both use the last use
  // (or the same person use a once-per-account code twice).
  const { rows: [p] } = await db.query(`SELECT * FROM promo_codes WHERE upper(code)=upper($1) AND is_active${db === pool ? '' : ' FOR UPDATE'}`, [clean]); // applies only to the items its owner sells
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
  ALTER TABLE products ADD COLUMN IF NOT EXISTS bulk_min INT CHECK (bulk_min IS NULL OR bulk_min BETWEEN 2 AND 999);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS bulk_percent INT NOT NULL DEFAULT 0 CHECK (bulk_percent BETWEEN 0 AND 90);
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

// What the phones ask every few seconds: a couple of dozen bytes. `w` covers things that change with the clock (the order cutoff).
let revWin = { t: 0, v: '' };
app.get('/api/rev', wrap(async (req, res) => {
  if (Date.now() - revWin.t > 3000) { // many phones asking at once share one database visit
    const w = await orderWindow(pool);
    revWin = { t: Date.now(), v: `${w.closed ? 1 : 0}${w.label}${w.date}` };
  }
  res.json({ r: `${BOOT_ID}.${REV}`, w: revWin.v });
}));

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

// Picture sizes: the shop grid asks for ?w=480 (or 240 for small ones) instead of the full 1400 px photo, so a phone downloads
// about 15-40 KB per product instead of 100-300 KB. Resized copies are kept in memory (least recently used goes first).
const THUMB_WIDTHS = [160, 240, 480, 800], THUMB_BUDGET = 48 * 1024 * 1024;
const thumbs = new Map(); let thumbBytes = 0;
const thumbPending = new Map();
async function thumbFor(id, ver, w, data) {
  if (!ver) return sharp(data).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(); // no version = no way to know when it goes stale
  const key = `${id}:${ver}:${w}`, hit = thumbs.get(key);
  if (hit) { thumbs.delete(key); thumbs.set(key, hit); return hit; }
  if (thumbPending.has(key)) return thumbPending.get(key);
  const job = sharp(data).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()
    .then((buf) => {
      thumbs.set(key, buf); thumbBytes += buf.length;
      for (const [k, v] of thumbs) { if (thumbBytes <= THUMB_BUDGET) break; thumbs.delete(k); thumbBytes -= v.length; }
      return buf;
    }).finally(() => thumbPending.delete(key));
  thumbPending.set(key, job);
  return job;
}
app.get('/api/products/:id/image', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.sendStatus(404);
  const w = THUMB_WIDTHS.find((x) => x >= (parseInt(req.query.w) || 0)), ver = String(req.query.v || '').slice(0, 20);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  // The ?v= in the picture's address changes whenever the picture does, so a copy already in memory needs no database visit at all.
  const hit = req.query.w && w && ver ? thumbs.get(`${id}:${ver}:${w}`) : null;
  if (hit) return res.type('image/webp').send(await thumbFor(id, ver, w, null));
  const { rows: [p] } = await pool.query('SELECT image_data, image_mime FROM products WHERE id=$1', [id]);
  if (!p || !p.image_data) return res.sendStatus(404);
  if (req.query.w && w && p.image_mime !== 'image/gif') { // gifs may be animated: always sent as they are
    try { return res.type('image/webp').send(await thumbFor(id, ver, w, p.image_data)); } catch (e) { /* fall back to the original */ }
  }
  res.type(p.image_mime).send(p.image_data);
}));

/* ---------- Products (admin write) ---------- */
// When a product's price, sale % or bulk deal changes, the orders that are still open (pending or packed) follow the new price:
// the lines, the promo discount and the total are worked out again, so order lists and receipts match the shop.
// Finished and cancelled orders keep what was actually charged.
// Returns { checked, pending, packed, changed_list } so the screen can say exactly what it found and did.
async function repriceOpenOrders(productIds) {
  const ids = [...new Set((productIds || []).map(Number).filter(Number.isInteger))];
  const info = { checked: 0, pending: 0, packed: 0, changed_list: [] };
  if (!ids.length) return info;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: ords } = await c.query(`SELECT o.id,o.status,o.promo_code,o.total,o.discount FROM orders o WHERE o.status IN ('pending','packed')
      AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.product_id = ANY($1)) ORDER BY o.id FOR UPDATE OF o`, [ids]);
    const prods = new Map((await c.query('SELECT id,price,discount_percent,bulk_min,bulk_percent FROM products WHERE id = ANY($1)', [ids])).rows.map((p) => [p.id, p]));
    for (const o of ords) {
      info.checked++; info[o.status]++;
      const { rows: its } = await c.query('SELECT id,product_id,quantity,unit_price::float AS price,owner_id FROM order_items WHERE order_id=$1', [o.id]);
      const qty = new Map();
      for (const i of its) if (i.product_id != null) qty.set(i.product_id, (qty.get(i.product_id) || 0) + i.quantity);
      let touched = false;
      for (const i of its) {
        const p = i.product_id != null ? prods.get(i.product_id) : null; // only the products that were just changed
        if (!p) continue;
        const np = unitFor(p, qty.get(i.product_id));
        if (Math.abs(np - i.price) > 0.001) { await c.query('UPDATE order_items SET unit_price=$1 WHERE id=$2', [np.toFixed(2), i.id]); i.price = np; touched = true; }
      }
      let discount = Number(o.discount) || 0;
      if (o.promo_code) {
        const { rows: [pr] } = await c.query('SELECT percent,owner_id,shop_wide,product_ids FROM promo_codes WHERE upper(code)=upper($1)', [o.promo_code]);
        if (pr) {
          const eligible = (i) => (pr.shop_wide || pr.owner_id == null || i.owner_id === pr.owner_id)
            && (!pr.product_ids || !pr.product_ids.length || (i.product_id != null && pr.product_ids.includes(i.product_id)));
          discount = Math.round(its.filter(eligible).reduce((s, i) => s + i.price * i.quantity, 0) * pr.percent) / 100;
        }
      }
      const total = (its.reduce((s, i) => s + i.price * i.quantity, 0) - discount).toFixed(2);
      if (touched || total !== Number(o.total).toFixed(2)) {
        await c.query('UPDATE orders SET total=$1, discount=$2 WHERE id=$3', [total, discount.toFixed(2), o.id]);
        info.changed_list.push({ id: o.id, status: o.status });
      }
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Re-pricing open orders failed:', e.message);
    throw e;
  } finally {
    c.release();
  }
  return info;
}
// Runs the re-pricing for the routes below without ever losing the product change itself; a failure is reported to the screen.
const repriceSafe = async (ids) => {
  try { const info = await repriceOpenOrders(ids); return { repriced_orders: info.changed_list.length, reprice_info: info, reprice_error: null }; }
  catch (e) { return { repriced_orders: 0, reprice_info: null, reprice_error: e.message }; }
};

app.post('/api/products', auth, staff, upload.single('image'), wrap(async (req, res) => {
  const { title, description = '', price, category = 'snacks', discount_percent = 0 } = req.body;
  const stock = req.body.stock === undefined || req.body.stock === '' ? null : parseInt(req.body.stock);
  if (stock !== null && !(stock >= 0)) throw bad('Stock must be 0 or more.');
  const cost = req.body.cost === undefined || req.body.cost === '' ? null : Number(req.body.cost);
  if (cost !== null && !(cost >= 0)) throw bad('Cost must be 0 or more.');
  if (!String(title || '').trim() || price === '' || price === undefined || isNaN(price) || price < 0 || price > 99999999) throw bad('Title and a valid price are required.');
  if (String(title).trim().length > 200) throw bad('The name can be up to 200 characters.');
  if (String(description).length > 2000) throw bad('The description can be up to 2000 characters.');
  if (!CATEGORIES.includes(category)) throw bad('Pick Drinks or Snacks.');
  const disc = parseInt(discount_percent) || 0;
  if (disc < 0 || disc > 90) throw bad('Discount must be between 0 and 90%.');
  const f = await squeeze(req.file);
  const bulk = parseBulk(req.body);
  const owner = await pickOwner(req.user, req.body.owner_id);
  const { rows: [p] } = await pool.query(
    'INSERT INTO products (title, description, price, image_data, image_mime, category, discount_percent, owner_id, stock, is_sold_out, cost, bulk_min, bulk_percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
    [String(title).trim(), description, price, f ? f.buffer : null, f ? f.mimetype : null, category, disc, owner, stock, stock === 0, cost, bulk.min, bulk.pct]
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
  if (price !== undefined && (price === '' || isNaN(price) || price < 0 || price > 99999999)) throw bad('Invalid price.');
  if (title !== undefined && (!String(title).trim() || String(title).trim().length > 200)) throw bad('The name is required and can be up to 200 characters.');
  if (description !== undefined && String(description).length > 2000) throw bad('The description can be up to 2000 characters.');
  const f = await squeeze(req.file);
  const setStock = req.body.stock !== undefined; // empty = stop counting
  const stock = !setStock || req.body.stock === '' ? null : parseInt(req.body.stock);
  if (stock !== null && !(stock >= 0)) throw bad('Stock must be 0 or more.');
  const setCost = req.body.cost !== undefined; // empty = clear the cost
  const cost = !setCost || req.body.cost === '' ? null : Number(req.body.cost);
  if (cost !== null && !(cost >= 0)) throw bad('Cost must be 0 or more.');
  const setBulk = req.body.bulk_percent !== undefined || req.body.bulk_min !== undefined; // 0 / empty = remove the bulk deal
  const bulk = setBulk ? parseBulk(req.body) : { min: null, pct: 0 };
  const { rowCount } = await pool.query(
    `UPDATE products SET bulk_min=CASE WHEN $14::boolean THEN $15::int ELSE bulk_min END,
       bulk_percent=CASE WHEN $14::boolean THEN $16::int ELSE bulk_percent END,
       cost=CASE WHEN $12::boolean THEN $13::numeric ELSE cost END,
       stock=CASE WHEN $10::boolean THEN $11::int ELSE stock END,
       is_sold_out=CASE WHEN $10::boolean AND $11::int IS NOT NULL THEN $11::int = 0 ELSE is_sold_out END, title=COALESCE($1,title), description=COALESCE($2,description), price=COALESCE($3,price),
       image_data=COALESCE($4,image_data), image_mime=COALESCE($5,image_mime), category=COALESCE($6,category), discount_percent=COALESCE($7,discount_percent), owner_id=COALESCE($9,owner_id) WHERE id=$8`,
    [title === undefined ? null : String(title).trim(), description ?? null, price ?? null, f ? f.buffer : null, f ? f.mimetype : null, category ?? null, disc, req.params.id, newOwner, setStock, stock, setCost, cost, setBulk, bulk.min, bulk.pct]
  );
  if (!rowCount) throw bad('Product not found.', 404);
  res.json({ ...(await withImage(req.params.id)), ...(await repriceSafe([req.params.id])) });
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
  res.json({ updated: rowCount, ...(await repriceSafe(list)) });
}));

// Brings every open (pending or packed) order up to the shop's current prices: all products for the owner, a seller's own for a seller.
app.post('/api/orders/reprice', auth, staff, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM products WHERE ($1 OR owner_id=$2)', [isMain(req.user), req.user.id]);
  res.json(await repriceSafe(rows.map((r) => r.id)));
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
    // Raven (the main admin) controls the whole shop, so his combos go live without waiting for any seller. A seller's combo that
    // uses someone else's products still needs that person's approval.
    const others = isMain(req.user) ? [] : [...new Set(found.map((p) => p.owner_id).filter((id) => id != null && id !== req.user.id))];
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
// The owner (main admin) may also answer for a seller by passing her owner_id.
app.patch('/api/combos/:id/approval', auth, staff, wrap(async (req, res) => {
  const approve = !!(req.body || {}).approve;
  const forId = isMain(req.user) && Number.isInteger(parseInt((req.body || {}).owner_id)) ? parseInt(req.body.owner_id) : req.user.id;
  const { rows: [a] } = await pool.query(
    'UPDATE combo_approvals SET status=$1 WHERE combo_id=$2 AND owner_id=$3 RETURNING combo_id',
    [approve ? 'approved' : 'declined', req.params.id, forId]);
  if (!a) throw bad('This combo does not need that approval.', 404);
  const { rows: [cb] } = await pool.query('SELECT title, owner_id FROM combos WHERE id=$1', [a.combo_id]);
  const who = forId === req.user.id ? req.user.username : `${req.user.username} (for a seller)`;
  const msg = `${who} ${approve ? 'approved' : 'declined'} the combo "${cb.title}".`;
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
  if (!Array.isArray(req.body.items) || req.body.items.length > 100) throw bad('Your cart is empty.');
  const items = req.body.items.filter((i) => i && typeof i === 'object' && parseInt(i.quantity) > 0);
  if (!items.length) throw bad('Your cart is empty.');
  const prodIds = items.filter((i) => i.product_id).map((i) => parseInt(i.product_id)).filter(Number.isInteger);
  const comboIds = items.filter((i) => i.combo_id).map((i) => parseInt(i.combo_id)).filter(Number.isInteger);
  const win = await orderWindow(pool);
  if (win.closed) throw bad(`Orders closed for today at ${t12(win.cutoff)}. Please order again tomorrow.`);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: prods } = await c.query('SELECT id,title,price,discount_percent,bulk_min,bulk_percent,is_sold_out,owner_id FROM products WHERE id = ANY($1)', [prodIds]);
    const byId = new Map(prods.map((r) => [r.id, r]));
    const { rows: combos } = await c.query(`${COMBO_SQL} WHERE c.id = ANY($1) AND ${COMBO_LIVE}`, [comboIds]);
    const comboById = new Map(combos.map((r) => [r.id, r]));
    const allIds = [...new Set([...prodIds, ...combos.flatMap((cb) => cb.items.map((x) => x.product_id))])];
    const costOf = new Map((await c.query('SELECT id,cost FROM products WHERE id = ANY($1)', [allIds])).rows.map((r) => [r.id, r.cost == null ? null : Number(r.cost)]));
    // How many of each product are in the order in total (a bulk discount depends on it).
    const qtyOf = new Map();
    for (const i of items) if (!i.combo_id) { const id = parseInt(i.product_id); qtyOf.set(id, (qtyOf.get(id) || 0) + Math.min(99, parseInt(i.quantity))); }
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
        parts = [{ pid: p.id, title: p.title, price: unitFor(p, qtyOf.get(p.id)), q, owner: p.owner_id, cost: costOf.get(p.id) ?? null }];
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
      'INSERT INTO orders (user_id, total, note, promo_code, discount, deliver_for) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,total,status,created_at',
      [req.user.id, (total - discount).toFixed(2), note, promo ? promo.code : null, discount.toFixed(2), win.date]
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

const ORDER_SQL = `SELECT o.id,o.user_id,o.total,o.status,o.note,o.promo_code,o.discount,o.created_at,o.paid_by,o.paid_at,to_char(o.deliver_for,'YYYY-MM-DD') AS deliver_for,(SELECT username FROM users WHERE id=o.paid_by) AS paid_name,u.username,
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
// Adds what each owner's items in an order cost you (for the profit on printed lists). Staff only: customers never get this.
// Raven gets every owner's cost; a seller gets only her own. A finished order uses the cost saved on it, an open one the product's current cost.
const withCosts = async (rows, user) => {
  if (!rows.length) return rows;
  const { rows: cs } = await pool.query(`SELECT oi.order_id,oi.owner_id,
      SUM(CASE WHEN o.status='completed' THEN COALESCE(oi.cost_price,p.cost,0) ELSE COALESCE(p.cost,oi.cost_price,0) END * oi.quantity)::float AS cost,
      bool_or(COALESCE(oi.cost_price,p.cost) IS NULL) AS missing
    FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id = ANY($1) AND oi.owner_id IS NOT NULL AND ($2 OR oi.owner_id=$3)
    GROUP BY oi.order_id,oi.owner_id`, [rows.map((r) => r.id), isMain(user), user.id]);
  const by = new Map();
  for (const r of cs) { if (!by.has(r.order_id)) by.set(r.order_id, []); by.get(r.order_id).push({ owner_id: r.owner_id, cost: r.cost, missing: r.missing }); }
  return rows.map((o) => ({ ...o, costs: by.get(o.id) || [] }));
};

// Open orders (to pack / packed) are always sent. Finished ones (completed / cancelled) come newest first, 30 at a time
// (?finished=60 for more), so the list stays small however old the shop gets.
app.get('/api/orders', auth, staff, wrap(async (req, res) => {
  const fin = Math.min(2000, Math.max(1, parseInt(req.query.finished) || 30));
  if (isMain(req.user)) return res.json(await withCosts((await pool.query(
    `${ORDER_SQL} WHERE o.status IN ('pending','packed') OR o.id IN (SELECT id FROM orders WHERE status NOT IN ('pending','packed') ORDER BY created_at DESC LIMIT $1) ORDER BY o.created_at DESC`, [fin])).rows, req.user));
  const { rows } = await pool.query(
    `SELECT o.id,o.user_id,o.status,o.note,o.promo_code,o.discount,o.created_at,o.paid_by,o.paid_at,to_char(o.deliver_for,'YYYY-MM-DD') AS deliver_for,(SELECT username FROM users WHERE id=o.paid_by) AS paid_name,u.username,
       (SELECT json_agg(json_build_object('product_id',oi.product_id,'title',oi.title,'unit_price',oi.unit_price,'quantity',oi.quantity) ORDER BY oi.id)
          FROM order_items oi WHERE oi.order_id=o.id AND oi.owner_id=$1) AS items,
       EXISTS (SELECT 1 FROM promo_codes pc WHERE upper(pc.code)=upper(o.promo_code) AND pc.owner_id=$1) AS promo_mine,
       (SELECT json_agg(json_build_object('owner_id',x.owner_id,'username',pu.username,'status',COALESCE(a.status,'pending')) ORDER BY x.owner_id)
     FROM (SELECT DISTINCT owner_id FROM order_items WHERE order_id=o.id AND owner_id IS NOT NULL) x
     JOIN users pu ON pu.id=x.owner_id
     LEFT JOIN order_approvals a ON a.order_id=o.id AND a.owner_id=x.owner_id) AS parts
     FROM orders o JOIN users u ON u.id=o.user_id
     WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.owner_id=$1)
       AND (o.status IN ('pending','packed') OR o.id IN (SELECT o2.id FROM orders o2 WHERE o2.status NOT IN ('pending','packed')
            AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o2.id AND x.owner_id=$1) ORDER BY o2.created_at DESC LIMIT $2))
     ORDER BY o.created_at DESC`, [req.user.id, fin]);
  res.json(await withCosts(rows.map(({ promo_mine, ...o }) => {
    const sub = o.items.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
    const discount = promo_mine ? Number(o.discount) : 0;
    return { ...o, promo_code: promo_mine ? o.promo_code : null, discount, total: (sub - discount).toFixed(2) };
  }), req.user));
}));

// Customer cancels their own order, only while it is still pending.
app.patch('/api/orders/:id/cancel', auth, wrap(async (req, res) => {
  // change = the customer is cancelling to edit the order, which is only allowed for a few minutes after placing it
  const change = !!(req.body || {}).change;
  if (change) {
    const raw = await getSetting('edit_window'), mins = raw === '' ? 10 : Number(raw);
    const { rowCount } = await pool.query("SELECT 1 FROM orders WHERE id=$1 AND user_id=$2 AND created_at > now() - make_interval(mins => $3::int)", [req.params.id, req.user.id, mins]);
    if (!rowCount) throw bad('The time to change this order is over. You can still cancel it and order again.');
  }
  const { rows: [o] } = await pool.query(
    "UPDATE orders SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id,status,promo_code",
    [req.params.id, req.user.id]);
  if (!o) throw bad('Only pending orders can be cancelled.');
  await restoreStock(pool, o.id);
  if (o.promo_code) await pool.query('UPDATE promo_codes SET used_count = GREATEST(used_count - 1, 0) WHERE upper(code)=upper($1)', [o.promo_code]);
  notify(`Order #${o.id} was cancelled by ${req.user.username}${change ? ' (changing it, may re-order)' : ''}.`);
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
  // A cancelled order already gave its stock back, so it cannot come back to life (the customer can simply order again).
  if (ord.status === 'cancelled' && status !== 'cancelled') throw bad('This order was cancelled. The customer can place a new one.', 409);

  // Raven decides for the whole order, even when sellers are involved: no waiting for anyone's approval.
  // Every seller's part is set to match, so the screens agree.
  if (isMain(req.user)) {
    const { rows: [o] } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,status', [status, id]);
    for (const x of owners)
      await pool.query('INSERT INTO order_approvals (order_id, owner_id, status) VALUES ($1,$2,$3) ON CONFLICT (order_id, owner_id) DO UPDATE SET status=EXCLUDED.status', [id, x, status]);
    if (status === 'cancelled') await restoreStock(pool, id);
    return res.json(o);
  }

  // One owner: change the status directly.
  if (owners.length < 2) {
    const { rows: [o] } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING id,status', [status, id]);
    if (status === 'cancelled') await restoreStock(pool, id);
    return res.json(o);
  }

  // Mixed order: every owner approves their own part; the order moves only as far as all of them have.
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
  res.json((await pool.query(
    `SELECT r.id,r.description,r.status,r.quoted_price,r.admin_note,r.created_at,r.updated_at,u.username,
       r.handled_by,h.username AS handled_by_name
     FROM custom_requests r JOIN users u ON u.id=r.user_id LEFT JOIN users h ON h.id=r.handled_by
     ORDER BY r.created_at DESC`)).rows);
}));

// Staff sets a price (quoted) or says it can't be provided (unavailable).
// First come, first served: whoever answers first handles the request and the other seller is locked out.
// The main admin can still step in on a request a seller is handling.
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
    `UPDATE custom_requests SET status=$1, quoted_price=$2, admin_note=$3, updated_at=now(), handled_by=COALESCE(handled_by,$5::int)
     WHERE id=$4 AND status IN ('pending','quoted') AND (handled_by IS NULL OR handled_by=$5::int OR $6::boolean)
     RETURNING id,status,quoted_price,admin_note,handled_by`,
    [status, amount, String(note).slice(0, 1000), req.params.id, req.user.id, req.user.role === 'admin']);
  if (!r) {
    const { rows: [x] } = await pool.query(
      'SELECT r.status, h.username AS by FROM custom_requests r LEFT JOIN users h ON h.id=r.handled_by WHERE r.id=$1', [req.params.id]);
    if (x && x.by && ['pending', 'quoted'].includes(x.status)) throw bad(`${x.by} is already handling this request.`, 409);
    throw bad('Request not found or already answered.', 404);
  }
  notifyAll(`Custom request #${r.id} was ${unavailable ? 'marked not available' : 'priced'} by ${req.user.username}.`, req.user);
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
  await putSetting('last_backup', new Date().toISOString()); // first, so the file itself carries it and a restore keeps the reminder accurate
  const body = await buildBackup();
  res.set('Content-Type', 'application/json').send(body);
}));

// For the Admin reminder: the last copy that would survive the database being deleted (a download you did, or one sent to Telegram/ntfy).
app.get('/api/admin/backup-status', auth, admin, wrap(async (req, res) => {
  const [manual, offsite] = await Promise.all([getSetting('last_backup'), getSetting('last_offsite_backup')]);
  const times = [manual, offsite].filter(Boolean).map((x) => new Date(x).getTime()).filter(Number.isFinite);
  res.json({ last_safe_backup: times.length ? new Date(Math.max(...times)).toISOString() : null,
    offsite_configured: !!((process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.NTFY_TOPIC) });
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
    invalidateUser(); // everyone's role is read fresh from the restored data
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

// The owner can rename a seller. Her current login keeps working; the new name shows after she logs in again.
app.patch('/api/admin/sellers/:id', auth, admin, wrap(async (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) throw bad('Username: 3-30 letters, numbers or _.');
  try {
    const { rows: [u] } = await pool.query("UPDATE users SET username=$1 WHERE id=$2 AND role='seller' RETURNING id,username", [username, req.params.id]);
    if (!u) throw bad('Seller not found.', 404);
    invalidateUser(u.id);
    res.json(u);
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
  // Her old login stops working at once: she has to use the new password. (The "must change" flag is not used for sellers.)
  invalidateUser(req.params.id);
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
    invalidateUser(req.params.id);
    res.sendStatus(204);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}));

// Split off: parting ways with a seller. Deletes her products, combos and promo codes and her account.
// Needs Raven's password, and is refused while she has open orders or money is still unsettled.
app.post('/api/admin/sellers/:id/split-off', auth, admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Seller not found.', 404);
  const wait = lockedOut(req.ip);
  if (wait) throw bad(`Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);
  const { rows: [me] } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!me || !(await bcrypt.compare(String((req.body || {}).admin_password || ''), me.password_hash))) { failLogin(req.ip); throw bad('Your admin password is wrong.', 401); }
  const { rows: [sl] } = await pool.query("SELECT id, username FROM users WHERE id=$1 AND role='seller'", [id]);
  if (!sl) throw bad('Seller not found.', 404);
  const { rows: [open] } = await pool.query("SELECT count(DISTINCT o.id)::int AS n FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.owner_id=$1 AND o.status IN ('pending','packed')", [id]);
  if (open.n) throw bad(`${sl.username} still has ${open.n} open order${open.n === 1 ? '' : 's'}. Finish or cancel ${open.n === 1 ? 'it' : 'them'} first.`, 409);
  const cash = await cashSummary({ id, role: 'seller' });
  const unpaid = cash.unpaid.filter((o) => o.status === 'completed').reduce((t, o) => t + (o.shares[id] || 0), 0);
  if (unpaid > 0.004) throw bad(`${peso(unpaid)} of ${sl.username}'s delivered orders is not marked paid yet. Mark them paid first.`, 409);
  const names = await teamNames(), owed = cash.balances.filter((b) => b.from === id || b.to === id);
  if (owed.length) throw bad('Settle up first: ' + owed.map((b) => b.from === id ? `${sl.username} owes ${names.get(b.to)} ${peso(b.amount)}` : `${names.get(b.from)} owes ${sl.username} ${peso(b.amount)}`).join('; ') + '.', 409);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Other sellers' combos that use her products would lose parts, so switch them off instead of leaving them broken.
    const off = await c.query('UPDATE combos SET is_active=false WHERE owner_id IS DISTINCT FROM $1 AND is_active AND id IN (SELECT combo_id FROM combo_items WHERE product_id IN (SELECT id FROM products WHERE owner_id=$1))', [id]);
    const combos = await c.query('DELETE FROM combos WHERE owner_id=$1', [id]);
    await c.query('DELETE FROM promo_codes WHERE owner_id=$1', [id]);
    const prods = await c.query('DELETE FROM products WHERE owner_id=$1', [id]);
    await c.query('UPDATE order_items SET owner_id=$1 WHERE owner_id=$2', [req.user.id, id]); // past sales stay in the history
    await c.query('UPDATE orders SET paid_by=$1 WHERE paid_by=$2', [req.user.id, id]);
    await c.query('DELETE FROM users WHERE id=$1', [id]);
    await c.query('COMMIT');
    invalidateUser(id);
    notify(`Split off from ${sl.username}: ${prods.rowCount} products removed.`);
    res.json({ products: prods.rowCount, combos: combos.rowCount, switched_off: off.rowCount });
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
  const { rows: [m] } = await pool.query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1"); // raven: his products are pinned to the top of the shop
  res.json({ banner: o.banner || '', stamp_reward: o.stamp_reward || 'a free snack', main_owner_id: m ? m.id : null, edit_window: o.edit_window === undefined || o.edit_window === '' ? 10 : Number(o.edit_window), order_cutoff: o.order_cutoff || '', after_cutoff: o.after_cutoff === 'closed' ? 'closed' : 'tomorrow', order_window: await orderWindow(pool) });
}));

app.put('/api/admin/settings', auth, admin, wrap(async (req, res) => {
  const put = (k, v) => pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v || '').trim().slice(0, 200)]);
  const cut = String(req.body.order_cutoff || '').trim();
  if (cut && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cut)) throw bad('Cutoff time must look like 15:00.');
  await put('banner', req.body.banner);
  await put('stamp_reward', req.body.stamp_reward);
  const ew = req.body.edit_window === undefined || req.body.edit_window === '' ? 10 : parseInt(req.body.edit_window);
  if (!(ew >= 0 && ew <= 120)) throw bad('Change window must be 0 to 120 minutes.');
  await put('edit_window', String(ew));
  await put('order_cutoff', cut);
  await put('after_cutoff', req.body.after_cutoff === 'closed' ? 'closed' : 'tomorrow');
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
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), min: Number(p.minute), dow: p.weekday };
};
const t12 = (hm) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// Raven's order cutoff: before it, orders are for today; after it they are for tomorrow (or closed, if he chose that).
async function orderWindow(db) {
  const { rows } = await db.query("SELECT key,value FROM settings WHERE key IN ('order_cutoff','after_cutoff')");
  const o = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const t = localParts(), cutoff = /^\d{2}:\d{2}$/.test(o.order_cutoff || '') ? o.order_cutoff : '';
  const now = `${String(t.hour).padStart(2, '0')}:${String(t.min).padStart(2, '0')}`, past = !!cutoff && now >= cutoff;
  const next = new Date(t.date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
  const mode = o.after_cutoff === 'closed' ? 'closed' : 'tomorrow';
  return { cutoff, mode, closed: past && mode === 'closed', label: past ? 'tomorrow' : 'today', date: past ? next.toISOString().slice(0, 10) : t.date, today: t.date };
}

// Completed orders only. Raven sees the whole shop; a seller sees only her own items.
// Profit = what she sold (after her share of any promo) minus the cost prices saved on the order lines
// (a line saved without a cost uses the product's cost as it is now).
const reportData = async (user, days) => {
  const main = isMain(user), mine = (id) => main || id === user.id;
  const { rows: ords } = await pool.query(`SELECT o.id, to_char(o.created_at AT TIME ZONE $1,'YYYY-MM-DD') AS day, o.discount, pc.owner_id AS promo_owner, COALESCE(pc.shop_wide,false) AS shop_wide
    FROM orders o LEFT JOIN promo_codes pc ON upper(pc.code)=upper(o.promo_code)
    WHERE o.status='completed' AND o.created_at >= now() - make_interval(days => $2::int)`, [TZ, days]);
  const { rows: its } = await pool.query(`SELECT oi.order_id,oi.owner_id,oi.title,oi.quantity,oi.unit_price::float AS price,COALESCE(oi.cost_price, p.cost)::float AS cost
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.owner_id IS NOT NULL AND oi.order_id = ANY($1)`, [ords.map((o) => o.id)]);
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

// Per seller / admin (never a grand total). Gross = sales of completed orders. Income = gross minus the cost prices (the same profit the
// report uses). Potential income = the same thing for pending + packed orders (price minus cost, e.g. 50 sold at a cost of 30 = 20). Her own items only, after her share of any promo.
// Raven sees one row per person; a seller sees only her own row.
const peopleTotals = async (user) => {
  const main = isMain(user);
  const { rows: ords } = await pool.query(`SELECT o.id,o.status,o.discount,pc.owner_id AS promo_owner,COALESCE(pc.shop_wide,false) AS shop_wide
    FROM orders o LEFT JOIN promo_codes pc ON upper(pc.code)=upper(o.promo_code) WHERE o.status IN ('pending','packed','completed')`);
  const { rows: its } = await pool.query('SELECT order_id,owner_id,SUM(unit_price*quantity)::float AS sub FROM order_items WHERE owner_id IS NOT NULL GROUP BY order_id,owner_id');
  const subs = new Map();
  for (const r of its) { if (!subs.has(r.order_id)) subs.set(r.order_id, new Map()); subs.get(r.order_id).set(r.owner_id, r.sub); }
  const { rows: cs } = await pool.query(`SELECT oi.order_id,oi.owner_id,
      SUM(COALESCE(oi.cost_price,p.cost,0)*oi.quantity)::float AS cost_done,
      SUM(COALESCE(p.cost,oi.cost_price,0)*oi.quantity)::float AS cost_open,
      bool_or(COALESCE(oi.cost_price,p.cost) IS NULL) AS missing
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.owner_id IS NOT NULL GROUP BY oi.order_id,oi.owner_id`);
  const costs = new Map(cs.map((r) => [`${r.order_id}>${r.owner_id}`, r]));
  const { rows: team } = await pool.query("SELECT id,username,role FROM users WHERE role IN ('admin','seller') ORDER BY (role='admin') DESC, id");
  const out = new Map(team.map((u) => [u.id, { id: u.id, username: u.username, role: u.role, gross: 0, income: 0, potential: 0, done: 0, open: 0, missing_cost: false }]));
  for (const o of ords) {
    const sub = subs.get(o.id); if (!sub) continue;
    for (const [id, v] of shareOf(o, sub)) {
      const row = out.get(id); if (!row) continue;
      const c = costs.get(`${o.id}>${id}`) || { cost_done: 0, cost_open: 0, missing: false };
      if (o.status === 'completed') { row.gross += v; row.income += v - c.cost_done; row.done++; }
      else { row.potential += v - c.cost_open; row.open++; } // not finished yet, so it uses the product's cost as it is now
      if (c.missing) row.missing_cost = true;
    }
  }
  return [...out.values()].filter((r) => main || r.id === user.id).map((r) => ({ ...r, gross: r2(r.gross), income: r2(r.income), potential: r2(r.potential) }));
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
    await putSetting('last_offsite_backup', new Date().toISOString()); // a copy that survives the database being deleted
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

/* ---------- Activity log (read), sales CSV, favorites ---------- */
app.get('/api/admin/audit', auth, admin, wrap(async (req, res) => {
  const before = /^\d+$/.test(String(req.query.before || '')) ? req.query.before : null;
  res.json((await pool.query('SELECT id, at, username, role, action, detail FROM audit_log WHERE ($1::bigint IS NULL OR id < $1::bigint) ORDER BY id DESC LIMIT 50', [before])).rows);
}));

// One row per item sold. Raven gets every seller's items, a seller only her own. Opens in Excel / Google Sheets.
const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // a name that starts with = or + must not run as a formula in a spreadsheet
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
app.get('/api/admin/sales.csv', auth, staff, wrap(async (req, res) => {
  const ok = /^\d{4}-\d{2}-\d{2}$/, from = String(req.query.from || ''), to = String(req.query.to || '');
  if (!ok.test(from) || !ok.test(to) || from > to) throw bad('Pick a start day and an end day (start first).');
  if ((new Date(to) - new Date(from)) / 864e5 > 366) throw bad('Pick a range of one year or less.');
  const withCancelled = req.query.cancelled === '1';
  const { rows } = await pool.query(`SELECT o.id, to_char(o.created_at AT TIME ZONE $1,'YYYY-MM-DD HH24:MI') AS ordered, to_char(o.deliver_for,'YYYY-MM-DD') AS deliver_for,
      u.username AS customer, o.status, (o.paid_at IS NOT NULL) AS paid, o.promo_code, o.discount, oi.title, oi.quantity, oi.unit_price,
      (oi.unit_price*oi.quantity) AS line_total, ow.username AS seller, COALESCE(oi.cost_price,p.cost) AS cost,
      (oi.id = (SELECT MIN(id) FROM order_items WHERE order_id=o.id)) AS first_line
    FROM orders o JOIN users u ON u.id=o.user_id JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN users ow ON ow.id=oi.owner_id LEFT JOIN products p ON p.id=oi.product_id
    WHERE (o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date AND ($4 OR oi.owner_id=$5) AND ($6 OR o.status <> 'cancelled')
    ORDER BY o.created_at, o.id, oi.id`, [TZ, from, to, isMain(req.user), req.user.id, withCancelled]);
  const head = ['Order', 'Ordered', 'Deliver for', 'Customer', 'Status', 'Paid', 'Item', 'Qty', 'Unit price', 'Line total', 'Seller', 'Cost each', 'Promo code', 'Order discount (first line only)'];
  const lines = [head.join(',')].concat(rows.map((r) => [r.id, r.ordered, r.deliver_for, r.customer, r.status, r.paid ? 'yes' : 'no', r.title, r.quantity,
    r.unit_price, Number(r.line_total).toFixed(2), r.seller, r.cost, isMain(req.user) ? r.promo_code : '', isMain(req.user) && r.first_line && Number(r.discount) ? r.discount : ''].map(csvCell).join(',')));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-${from}_to_${to}.csv"` }).send('\ufeff' + lines.join('\r\n') + '\r\n');
}));

app.get('/api/favorites', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT product_id FROM favorites WHERE user_id=$1', [req.user.id])).rows.map((r) => r.product_id));
}));
app.post('/api/favorites/:id', auth, wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) throw bad('Product not found.', 404);
  await pool.query('INSERT INTO favorites (user_id, product_id) SELECT $1, id FROM products WHERE id=$2 ON CONFLICT DO NOTHING', [req.user.id, id]);
  res.sendStatus(204);
}));
app.delete('/api/favorites/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, parseInt(req.params.id) || 0]);
  res.sendStatus(204);
}));

/* ---------- Errors & boot ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
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
    ALTER TABLE custom_requests ADD COLUMN IF NOT EXISTS handled_by INT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS deliver_for DATE;
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
