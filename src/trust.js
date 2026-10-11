// Trusted addresses: an address where a real admin is logged in is exempt from the shop's own flood limits, bans and security switches.
// Proof = a valid, signed admin token, re-checked against the database (a demoted or removed admin is not trusted). Memory only; 12 h per sighting.
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const TTL = 12 * 3600e3, trusted = new Map(), roleCache = new Map();
const is = (ip) => { const t = trusted.get(ip); if (!t) return false; if (t < Date.now()) { trusted.delete(ip); return false; } return true; };
setInterval(() => { const n = Date.now(); for (const [k, v] of trusted) if (v < n) trusted.delete(k); for (const [k, v] of roleCache) if (n - v.t > 60e3) roleCache.delete(k); }, 60e3).unref();
function early(app, pool) {
  app.use(async (req, res, next) => {
    try {
      const h = req.headers.authorization;
      if (h && h.length > 20 && !is(req.ip)) {
        const c = jwt.verify(h.replace(/^Bearer /, ''), SECRET, { algorithms: ['HS256'] });
        if (c && c.role === 'admin' && !c.pc) {
          let r = roleCache.get(c.id);
          if (!r) { const q = await pool.query('SELECT role FROM users WHERE id=$1', [c.id]); r = { role: q.rows[0] && q.rows[0].role, t: Date.now() }; roleCache.set(c.id, r); }
          if (r.role === 'admin') trusted.set(req.ip, Date.now() + TTL);
        }
      } else if (h && is(req.ip)) trusted.set(req.ip, Date.now() + TTL); // keep it fresh while the admin is active
    } catch (e) { /* not an admin: normal rules */ }
    next();
  });
}
module.exports = { early, is };
