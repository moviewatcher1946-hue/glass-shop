// In-site chat: each customer has one private conversation with the shop. Staff (admin and sellers) answer from an inbox. No outside service needed.
// Limits: 1000 characters per message, 6 messages a minute and 200 a day per customer, blocked customers cannot write, messages are deleted after 90 days.
module.exports = function mount(app, { pool, auth, wrap }) {
  const q = (s, p) => pool.query(s, p);
  const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
  q(`CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_staff BOOLEAN NOT NULL DEFAULT false,
      sender TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      read_by_staff BOOLEAN NOT NULL DEFAULT false,
      read_by_customer BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS chat_user_id ON chat_messages (user_id, id);
    CREATE INDEX IF NOT EXISTS chat_unread ON chat_messages (user_id) WHERE NOT from_staff AND NOT read_by_staff;`).catch((e) => console.error('chat init:', e.message));
  const clean = (b) => String(b == null ? '' : b).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 1000);
  const customer = (req, res, next) => (req.user && req.user.role === 'customer' ? next() : res.status(403).json({ error: 'Customers only.' }));
  const staff = (req, res, next) => (req.user && req.user.role !== 'customer' ? next() : res.status(403).json({ error: 'Staff only.' }));
  const after = (r) => Math.max(0, parseInt(r.query.after) || 0);
  const list = (uid, aft) => q('SELECT * FROM (SELECT id,from_staff,sender,body,created_at FROM chat_messages WHERE user_id=$1 AND id>$2 ORDER BY id DESC LIMIT 100) x ORDER BY id', [uid, aft]).then((r) => r.rows);
  const nocache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // ----- customer side
  app.get('/api/chat', auth, customer, nocache, wrap(async (req, res) => {
    const messages = await list(req.user.id, after(req));
    if (messages.some((m) => m.from_staff)) await q('UPDATE chat_messages SET read_by_customer=true WHERE user_id=$1 AND from_staff AND NOT read_by_customer', [req.user.id]);
    res.json({ messages });
  }));
  app.get('/api/chat/unread', auth, customer, nocache, wrap(async (req, res) => {
    res.json({ n: (await q('SELECT COUNT(*)::int n FROM chat_messages WHERE user_id=$1 AND from_staff AND NOT read_by_customer', [req.user.id])).rows[0].n });
  }));
  app.post('/api/chat', auth, customer, wrap(async (req, res) => {
    const body = clean(req.body && req.body.body); if (!body) throw bad('Write a message first.');
    if ((await q('SELECT 1 FROM customer_blocks WHERE user_id=$1 AND shop_wide LIMIT 1', [req.user.id])).rowCount) throw bad('You cannot send messages right now.', 403);
    const c = (await q("SELECT COUNT(*) FILTER (WHERE created_at>now()-interval '1 minute')::int m, COUNT(*)::int d FROM chat_messages WHERE user_id=$1 AND NOT from_staff AND created_at>now()-interval '1 day'", [req.user.id])).rows[0];
    if (c.m >= 6) throw bad('Slow down a little, then try again.', 429);
    if (c.d >= 200) throw bad('Daily message limit reached. Try again tomorrow.', 429);
    const row = (await q('INSERT INTO chat_messages (user_id,from_staff,sender,body,read_by_customer) VALUES ($1,false,$2,$3,true) RETURNING id,from_staff,sender,body,created_at', [req.user.id, req.user.username, body])).rows[0];
    res.status(201).json(row);
    if (app.locals.agentReply) setImmediate(() => app.locals.agentReply(req.user.id).catch((e) => console.error('agent:', e.message))); // AI helper answers in the background
  }));

  // ----- staff side
  app.get('/api/chat/staff-unread', auth, staff, nocache, wrap(async (req, res) => {
    res.json({ n: (await q('SELECT COUNT(DISTINCT user_id)::int n FROM chat_messages WHERE NOT from_staff AND NOT read_by_staff')).rows[0].n });
  }));
  app.get('/api/chat/inbox', auth, staff, nocache, wrap(async (req, res) => {
    res.json((await q(`SELECT u.id,u.username,LEFT(m.body,80) last,m.created_at,m.from_staff,
        (SELECT COUNT(*)::int FROM chat_messages x WHERE x.user_id=u.id AND NOT x.from_staff AND NOT x.read_by_staff) unread
      FROM (SELECT DISTINCT ON (user_id) * FROM chat_messages ORDER BY user_id,id DESC) m JOIN users u ON u.id=m.user_id
      ORDER BY unread DESC, m.id DESC LIMIT 100`)).rows);
  }));
  app.get('/api/chat/thread/:uid', auth, staff, nocache, wrap(async (req, res) => {
    const uid = parseInt(req.params.uid); if (!uid) throw bad('Unknown customer.', 404);
    const messages = await list(uid, after(req));
    if (messages.some((m) => !m.from_staff)) await q('UPDATE chat_messages SET read_by_staff=true WHERE user_id=$1 AND NOT from_staff AND NOT read_by_staff', [uid]);
    res.json({ messages });
  }));
  app.post('/api/chat/thread/:uid', auth, staff, wrap(async (req, res) => {
    const uid = parseInt(req.params.uid), body = clean(req.body && req.body.body); if (!body) throw bad('Write a message first.');
    if (!(await q("SELECT 1 FROM users WHERE id=$1 AND role='customer'", [uid])).rowCount) throw bad('Unknown customer.', 404);
    res.status(201).json((await q('INSERT INTO chat_messages (user_id,from_staff,sender,body,read_by_staff) VALUES ($1,true,$2,$3,true) RETURNING id,from_staff,sender,body,created_at', [uid, req.user.username, body])).rows[0]);
  }));

  setInterval(() => q("DELETE FROM chat_messages WHERE created_at<now()-interval '90 days'").catch(() => {}), 6 * 3600e3).unref();
};
