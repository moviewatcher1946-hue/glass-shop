// Sign in with Google. Turned on only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
// PUBLIC_URL must be the site address exactly as registered with Google, for example https://stexpress.ddns.net
// A new Google person gets a normal shop account (a random password nobody knows, so they only sign in with Google).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sign } = require('./auth');

module.exports = function mount(app, { pool, wrap, auth }) {
  const ID = process.env.GOOGLE_CLIENT_ID || '';
  const SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
  const BASE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const on = !!(ID && SECRET && BASE);
  const REDIRECT = BASE + '/auth/google/callback';
  const states = new Map(); // state -> { t: expiry, uid?: account to link }, so a return can only come from a sign-in we started

  pool.query(`CREATE TABLE IF NOT EXISTS oauth_links (
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, subject))`).catch((e) => console.error('[google] table:', e.message));
  setInterval(() => { const now = Date.now(); for (const [k, v] of states) if (v.t < now) states.delete(k); }, 60e3).unref();

  // The page asks this to decide whether to show the Google button.
  app.get('/api/auth/providers', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ google: on });
  });

  function googleUrl(state) {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({
      client_id: ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  app.get('/auth/google', (req, res) => {
    if (!on) return res.status(404).send('Google sign-in is not set up yet.');
    const state = crypto.randomBytes(24).toString('hex');
    states.set(state, { t: Date.now() + 10 * 60e3 });
    res.redirect(googleUrl(state));
  });

  // Link the Google account to the shop account that is signed in right now (for example, your admin account).
  app.get('/api/auth/google/link', auth, (req, res) => {
    if (!on) return res.status(404).json({ error: 'Google sign-in is not set up yet.' });
    const state = crypto.randomBytes(24).toString('hex');
    states.set(state, { t: Date.now() + 10 * 60e3, uid: req.user.id });
    res.set('Cache-Control', 'no-store');
    res.json({ url: googleUrl(state) });
  });

  app.get('/auth/google/callback', async (req, res) => {
    const back = (why) => res.redirect('/?google_error=' + encodeURIComponent(why));
    try {
      if (!on) return back('not set up');
      const { code, state, error } = req.query;
      if (error) return back('cancelled');
      const entry = states.get(String(state || ''));
      states.delete(String(state || ''));
      if (!entry || entry.t < Date.now() || !code) return back('expired, please try again');

      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(code), client_id: ID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(10000),
      });
      const tok = await tokRes.json().catch(() => ({}));
      if (!tok.access_token) return back('Google did not confirm the sign-in');

      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: 'Bearer ' + tok.access_token }, signal: AbortSignal.timeout(10000),
      });
      const info = await infoRes.json().catch(() => ({}));
      if (!info.sub || !info.email || info.email_verified !== true) return back('use a verified Google email');

      if (entry.uid) {
        // Linking: this Google account now signs in to the account that asked for the link.
        await pool.query(`INSERT INTO oauth_links (provider, subject, user_id) VALUES ($1, $2, $3)
          ON CONFLICT (provider, subject) DO UPDATE SET user_id = EXCLUDED.user_id`, ['google', String(info.sub), entry.uid]);
        return res.redirect('/?google_linked=1');
      }

      let { rows: [u] } = await pool.query(
        'SELECT u.id, u.username, u.role FROM oauth_links l JOIN users u ON u.id = l.user_id WHERE l.provider = $1 AND l.subject = $2',
        ['google', String(info.sub)]);
      if (!u) {
        // New person: pick a free username from the start of their email address.
        let base = String(info.email).split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
        if (base.length < 3) base = 'shopper';
        const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        for (let i = 0; i < 6 && !u; i++) {
          const name = i === 0 ? base : base.slice(0, 20) + crypto.randomInt(1000, 9999);
          try {
            const { rows: [n] } = await pool.query(
              "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'customer') RETURNING id, username, role", [name, hash]);
            u = n;
          } catch (e) { if (e.code !== '23505') throw e; }
        }
        if (!u) return back('could not create your account, please try again');
        await pool.query('INSERT INTO oauth_links (provider, subject, user_id) VALUES ($1, $2, $3)', ['google', String(info.sub), u.id]);
      }
      const user = { id: u.id, username: u.username, role: u.role };
      const payload = Buffer.from(JSON.stringify(user)).toString('base64');
      // The token travels in the address after #, which the browser never sends back to the server. The page reads it and clears it.
      res.redirect('/#google=' + encodeURIComponent(sign(user)) + '&u=' + encodeURIComponent(payload));
    } catch (e) {
      console.error('[google] sign-in:', e.message);
      back('something went wrong, please try again');
    }
  });
};
