const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

const sign = (u) => jwt.sign({ id: u.id, username: u.username, role: u.role }, SECRET, { expiresIn: '7d' });

// Requires a valid "Authorization: Bearer <token>" header.
const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Log in to continue.' });
  }
};

// Use after `auth`: only role "admin" (the seeded raven account) passes.
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

module.exports = { sign, auth, admin };
