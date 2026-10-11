// Security helpers: safe headers, rate limiting, a short security event log, a password policy and picture checks.
// Everything here is plain Node (no extra packages) and keeps its state in memory, which is fine for one server process.

const PROD = process.env.NODE_ENV === 'production';

/* ---------- Security event log ---------- */
// The newest 300 security events (failed logins, lockouts, floods, fake pictures...) are kept in memory and also printed to the server log.
// They are shown to the admin on Admin > System > Security. A restart clears the list; the server log keeps the history.
const events = [];
const clean = (v, n = 80) => String(v == null ? '' : v).replace(/[^\x20-\x7e]/g, '?').slice(0, n); // no line breaks or odd characters (log injection)
function logEvent(type, who, detail = '') {
  const ip = typeof who === 'string' ? who : who && who.ip;
  const user = who && typeof who === 'object' && who.user ? who.user.username : '';
  const e = { at: new Date().toISOString(), type: clean(type, 30), ip: clean(ip, 64), user: clean(user, 40), detail: clean(detail, 200) };
  events.push(e);
  if (events.length > 300) events.shift();
  console.warn('[security]', JSON.stringify(e));
  return e;
}
const recentEvents = (n = 100) => events.slice(-n).reverse();

/* ---------- Safe response headers ---------- */
// CSP: the page may only load code, styles, fonts and pictures from this site plus Google Fonts (Lenis and GSAP are served from this site).
// Nobody can put the shop inside another site (clickjacking), change its base address, or send its forms somewhere else.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'report-uri /api/boost/csp',
  ...(PROD ? ['upgrade-insecure-requests'] : []),
].join('; ');

function headers(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Origin-Agent-Cluster': '?1',
    'X-DNS-Prefetch-Control': 'off',
    'X-Download-Options': 'noopen',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
  });
  // Tell browsers to use HTTPS only, for a year (only when this request really came in over HTTPS).
  if (PROD && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Login and account answers must never be kept by the browser or any cache.
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/admin')) res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/api')) res.set('X-Robots-Tag', 'noindex');
  next();
}

/* ---------- Rate limiting ---------- */
// Counts requests per visitor address in a time window. Over the limit: HTTP 429 with Retry-After, and one line in the security log.
// The limits are generous on purpose: a whole class may share one school Wi-Fi address.
function limiter({ name, windowMs, max, skip }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, Math.min(windowMs, 60e3)).unref();
  return (req, res, next) => {
    if (skip && skip(req)) return next();
    const now = Date.now(), key = req.ip || 'unknown';
    let h = hits.get(key);
    if (!h || now > h.reset) {
      if (hits.size > 50000) hits.clear(); // never let the table grow without limit
      h = { n: 0, reset: now + windowMs }; hits.set(key, h);
    }
    if (++h.n > max) {
      const wait = Math.max(1, Math.ceil((h.reset - now) / 1000));
      res.set('Retry-After', String(wait));
      if (h.n === max + 1) logEvent('rate_limited', req, `${name}: more than ${max} requests in ${Math.round(windowMs / 1000)}s`);
      return res.status(429).json({ error: `Too many requests. Please wait ${wait} second${wait === 1 ? '' : 's'} and try again.` });
    }
    next();
  };
}

/* ---------- Password policy ---------- */
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyui', 'qwerty123', 'qwertyuiop', '12345678', '123456789',
  '1234567890', '87654321', '11111111', '00000000', 'abcd1234', 'abc12345', 'iloveyou', 'admin123', 'administrator', 'welcome1', 'welcome123', 'letmein1',
  'letmein123', 'monkey123', 'dragon123', 'football1', 'baseball1', 'superman1', 'princess1', 'sunshine1', 'whatever1', 'changeme', 'changeme1', 'snackify',
  'snackify1', 'snackify123', 'glassshop', 'shop1234', 'school123', 'mama5577']);
// Returns a message when the password is not acceptable, or '' when it is fine. bcrypt only reads the first 72 bytes, so longer passwords are refused.
function passwordProblem(pw, username = '') {
  if (typeof pw !== 'string') return 'Password: at least 8 characters.';
  if (pw.length < 8) return 'Password: at least 8 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password: at most 72 characters.';
  const low = pw.toLowerCase();
  if (username && low === String(username).toLowerCase()) return 'Your password cannot be the same as your username.';
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return 'That password is too easy to guess. Pick something less common.';
  return '';
}

/* ---------- Picture check ---------- */
// The browser says what a file is, but anyone can lie. Look at the first bytes of the file to see whether it really is a PNG, JPEG, GIF or WebP.
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const head = buf.toString('latin1', 0, 12);
  const gif = head.startsWith('GIF87a') || head.startsWith('GIF89a');
  const webp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  return png || jpg || gif || webp;
}
// Put right after multer: refuses an "image" that is not one.
function checkUpload(req, res, next) {
  if (req.file && !looksLikeImage(req.file.buffer)) {
    logEvent('fake_picture', req, `${req.file.originalname ? clean(req.file.originalname, 60) : 'file'} (${req.file.mimetype}) is not a real picture`);
    return res.status(400).json({ error: 'That file is not a real picture. Use a PNG, JPG, WebP or GIF.' });
  }
  next();
}

module.exports = { PROD, logEvent, recentEvents, headers, limiter, passwordProblem, looksLikeImage, checkUpload };
