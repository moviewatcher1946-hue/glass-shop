const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

// pc = the person logged in with a temporary password: a short session that can only set a new password.
const sign = (u, pc = false) => jwt.sign({ id: u.id, username: u.username, role: u.role, ...(pc ? { pc: true } : {}) }, SECRET, { expiresIn: pc ? '1h' : '7d' });

// Requires a valid "Authorization: Bearer <token>" header.
const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Log in to continue.' });
  }
  if (req.user.pc && !['/api/auth/change-password', '/api/auth/me'].includes(req.originalUrl.split('?')[0]))
    return res.status(403).json({ error: 'Choose a new password first.' });
  try {
    next();
  } catch {
    res.status(401).json({ error: 'Log in to continue.' });
  }
};

// Use after `auth`: only role "admin" (the seeded raven account) passes.
const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

// Use after `auth`: the main admin (raven) or a seller account.
const staff = (req, res, next) =>
  ['admin', 'seller'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Staff only.' });

module.exports = { sign, auth, admin, staff };
