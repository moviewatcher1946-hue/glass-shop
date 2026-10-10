const jwt = require('jsonwebtoken');
const { pool } = require('./db');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

// pc = the person logged in with a temporary password: a short session that can only set a new password.
const sign = (u, pc = false) => jwt.sign({ id: u.id, username: u.username, role: u.role, ...(pc ? { pc: true } : {}) }, SECRET, { expiresIn: pc ? '1h' : '7d' });

// The token only proves WHO someone is. Their role and name are always read from the database (cached for a few
// seconds), so a seller who is removed or renamed stops working right away instead of staying powerful until the
// token expires, and nobody can keep admin rights after losing them.
const TTL = 10e3, cache = new Map();
const invalidateUser = (id) => { if (id == null) cache.clear(); else cache.delete(Number(id)); };
setInterval(() => { const now = Date.now(); for (const [k, v] of cache) if (now - v.t > TTL) cache.delete(k); }, 60e3).unref();
async function currentUser(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < TTL) return hit.u;
  const { rows: [u] } = await pool.query('SELECT id, username, role FROM users WHERE id=$1', [id]);
  cache.set(id, { u: u || null, t: Date.now() });
  return u || null;
}

// Like `auth`, but never rejects: if a valid token is sent it sets req.user, otherwise the person is just a visitor.
const softAuth = async (req, res, next) => {
  try {
    const claims = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET);
    const u = await currentUser(claims.id);
    if (u) req.user = { id: u.id, username: u.username, role: u.role };
  } catch (e) { /* a visitor */ }
  next();
};

// Requires a valid "Authorization: Bearer <token>" header.
const auth = async (req, res, next) => {
  let claims;
  try {
    claims = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET);
  } catch {
    return res.status(401).json({ error: 'Log in to continue.' });
  }
  try {
    const u = await currentUser(claims.id);
    if (!u) return res.status(401).json({ error: 'Log in to continue.' });
    req.user = { id: u.id, username: u.username, role: u.role, ...(claims.pc ? { pc: true } : {}) };
  } catch (e) {
    return next(e);
  }
  if (req.user.pc && !['/api/auth/change-password', '/api/auth/me'].includes(req.originalUrl.split('?')[0]))
    return res.status(403).json({ error: 'Choose a new password first.' });
  next();
};

// Use after `auth`: only role "admin" (the seeded raven account) passes.
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

// Use after `auth`: the main admin (raven) or a seller account.
const staff = (req, res, next) =>
  ['admin', 'seller'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Staff only.' });

module.exports = { sign, auth, softAuth, admin, staff, invalidateUser };
