// Messages: everyone who is signed in can send and receive private messages (customers, sellers and the admin alike).
// The old "chat with the shop" thread (src/chatroom.js) stays and shows up inside Messages as "Shop support".
// Features: direct messages, replies, forwarding, edit/delete, reactions, stars, pinned message, images, scheduled sending,
// saved replies, blocking, privacy settings, auto-reply, read receipts, typing, search, reports, admin broadcast, diagnostics.
module.exports = function mount(app, { pool, auth, admin, wrap }) {
  const q = (s, p) => pool.query(s, p);
  const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
  const TEXT_MAX = 2000, IMG_MAX = 150000, EDIT_MIN = 15, KEEP_DAYS = 180;
  const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const seen = new Map(), typing = new Map(); // in-memory presence: user id -> last request time, "from>to" -> last keystroke

  q(`CREATE TABLE IF NOT EXISTS dm_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'text',
      body TEXT NOT NULL DEFAULT '',
      reply_to BIGINT,
      forwarded BOOLEAN NOT NULL DEFAULT false,
      broadcast BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS dm_send ON dm_messages (sender_id, recipient_id, id);
    CREATE INDEX IF NOT EXISTS dm_recv ON dm_messages (recipient_id, sender_id, id);
    CREATE INDEX IF NOT EXISTS dm_unread ON dm_messages (recipient_id) WHERE read_at IS NULL;
    CREATE TABLE IF NOT EXISTS dm_state (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pinned BOOLEAN NOT NULL DEFAULT false, muted BOOLEAN NOT NULL DEFAULT false, archived BOOLEAN NOT NULL DEFAULT false,
      nickname TEXT NOT NULL DEFAULT '', cleared_before BIGINT NOT NULL DEFAULT 0, pinned_msg BIGINT,
      PRIMARY KEY (user_id, peer_id));
    CREATE TABLE IF NOT EXISTS dm_blocks (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, blocked_id));
    CREATE TABLE IF NOT EXISTS dm_reactions (
      message_id BIGINT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL, PRIMARY KEY (message_id, user_id));
    CREATE TABLE IF NOT EXISTS dm_stars (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id BIGINT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE, PRIMARY KEY (user_id, message_id));
    CREATE TABLE IF NOT EXISTS dm_reports (
      id SERIAL PRIMARY KEY, message_id BIGINT, reporter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_id INT, excerpt TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS dm_prefs (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      read_receipts BOOLEAN NOT NULL DEFAULT true, typing BOOLEAN NOT NULL DEFAULT true, show_last_seen BOOLEAN NOT NULL DEFAULT true,
      allow_from TEXT NOT NULL DEFAULT 'everyone', auto_reply_on BOOLEAN NOT NULL DEFAULT false, auto_reply TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS dm_canned (
      id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dm_scheduled (
      id SERIAL PRIMARY KEY, sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL, reply_to BIGINT, send_at TIMESTAMPTZ NOT NULL);`).catch((e) => console.error('messages init:', e.message));

  const clean = (b, max = TEXT_MAX) => String(b == null ? '' : b).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  const nocache = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const touch = (req, res, next) => { seen.set(req.user.id, Date.now()); next(); };
  const M = [auth, nocache, touch];
  const isStaff = (u) => u.role !== 'customer';
  const pid = (v) => { const n = parseInt(v); if (!n || n < 1) throw bad('Unknown person.', 404); return n; };
  const online = (id) => Date.now() - (seen.get(id) || 0) < 70e3;
  const excerpt = (kind, body, deleted) => (deleted ? 'Deleted message' : kind === 'image' ? 'Photo' : String(body).slice(0, 80));
  const audit = (req, detail) => q('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, 'messages', detail]).catch(() => {});
  const prefsOf = async (id) => (await q('SELECT * FROM dm_prefs WHERE user_id=$1', [id])).rows[0] || { read_receipts: true, typing: true, show_last_seen: true, allow_from: 'everyone', auto_reply_on: false, auto_reply: '' };
  const person = async (id) => (await q('SELECT id,username,role,created_at FROM users WHERE id=$1', [id])).rows[0];
  const shortId = (v) => { const n = parseInt(v); if (!n) throw bad('Unknown message.', 404); return n; };

  // May `me` message `to`? Returns the reason it is not allowed, or null.
  async function gate(me, to) {
    if (!to) return 'Unknown person.';
    if (to.id === me.id) return 'You cannot message yourself.';
    if (me.role === 'customer') return 'Messages from customers go to Shop support.';
    if (me.role === 'customer' && (await q('SELECT 1 FROM customer_blocks WHERE user_id=$1 AND shop_wide LIMIT 1', [me.id])).rowCount) return 'You cannot send messages right now.';
    if ((await q('SELECT 1 FROM dm_blocks WHERE user_id=$1 AND blocked_id=$2', [me.id, to.id])).rowCount) return 'You blocked this person. Unblock them to send a message.';
    if ((await q('SELECT 1 FROM dm_blocks WHERE user_id=$1 AND blocked_id=$2', [to.id, me.id])).rowCount) return 'This person is not accepting messages from you.';
    const p = await prefsOf(to.id);
    if (me.role !== 'admin' && p.allow_from === 'nobody') return 'This person is not accepting new messages.';
    if (me.role === 'customer' && p.allow_from === 'staff') return 'This person only accepts messages from the shop team.';
    return null;
  }

  async function limits(me) {
    const c = (await q("SELECT COUNT(*) FILTER (WHERE created_at>now()-interval '1 minute')::int m, COUNT(*)::int d FROM dm_messages WHERE sender_id=$1 AND kind IN ('text','image') AND NOT broadcast AND created_at>now()-interval '1 day'", [me.id])).rows[0];
    const staff = isStaff(me);
    if (c.m >= (staff ? 30 : 8)) throw bad('Slow down a little, then try again.', 429);
    if (c.d >= (staff ? 2000 : 300)) throw bad('Daily message limit reached. Try again tomorrow.', 429);
  }

  const MSG_SQL = `SELECT m.id,m.sender_id,m.recipient_id,m.kind,m.body,m.reply_to,m.forwarded,m.broadcast,m.created_at,m.edited_at,m.deleted_at,m.delivered_at,m.read_at,
      r.body rbody,r.kind rkind,r.sender_id rsender,r.deleted_at rdel,
      (SELECT COALESCE(json_object_agg(e.emoji,e.n),'{}'::json) FROM (SELECT emoji,COUNT(*)::int n FROM dm_reactions WHERE message_id=m.id GROUP BY emoji) e) reactions,
      (SELECT emoji FROM dm_reactions WHERE message_id=m.id AND user_id=$1) myreact,
      EXISTS(SELECT 1 FROM dm_stars WHERE message_id=m.id AND user_id=$1) starred
    FROM dm_messages m LEFT JOIN dm_messages r ON r.id=m.reply_to`;
  const shape = (m, me, peerReceipts) => ({
    id: m.id, mine: m.sender_id === me, kind: m.kind, body: m.deleted_at ? '' : m.body, deleted: !!m.deleted_at, edited: !!m.edited_at, forwarded: m.forwarded, broadcast: m.broadcast,
    created_at: m.created_at, status: m.sender_id !== me ? undefined : m.read_at && peerReceipts ? 'read' : m.delivered_at || m.read_at ? 'delivered' : 'sent',
    reply: m.reply_to ? { id: m.reply_to, mine: m.rsender === me, text: m.rsender == null ? 'Message unavailable' : excerpt(m.rkind, m.rbody, m.rdel) } : null,
    reactions: m.reactions || {}, my_reaction: m.myreact || null, starred: m.starred });

  // Core delivery used by send, forward and auto-reply.
  async function deliver(req, to, { body, kind = 'text', reply_to = null, forwarded = false }) {
    const me = req.user;
    if (kind === 'image') { if (!IMG_RE.test(body) || body.length > IMG_MAX) throw bad('That picture is too large or not a supported type.'); }
    else { body = clean(body); if (!body) throw bad('Write a message first.'); }
    const reason = await gate(me, to); if (reason) throw bad(reason, 403);
    await limits(me);
    const dup = (await q("SELECT id FROM dm_messages WHERE sender_id=$1 AND recipient_id=$2 AND body=$3 AND created_at>now()-interval '5 seconds' LIMIT 1", [me.id, to.id, body])).rows[0];
    if (dup) return dup.id;
    if (reply_to != null && !(await q('SELECT 1 FROM dm_messages WHERE id=$1 AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2))', [reply_to, me.id, to.id])).rowCount) reply_to = null;
    const id = (await q('INSERT INTO dm_messages (sender_id,recipient_id,kind,body,reply_to,forwarded) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [me.id, to.id, kind, body, reply_to, forwarded])).rows[0].id;
    // Un-archive for the receiver so a new message is never lost, then send their away message once every 6 hours.
    q('UPDATE dm_state SET archived=false WHERE user_id=$1 AND peer_id=$2', [to.id, me.id]).catch(() => {});
    prefsOf(to.id).then(async (p) => {
      if (!p.auto_reply_on || !p.auto_reply) return;
      if ((await q("SELECT 1 FROM dm_messages WHERE sender_id=$1 AND recipient_id=$2 AND kind='auto' AND created_at>now()-interval '6 hours'", [to.id, me.id])).rowCount) return;
      await q("INSERT INTO dm_messages (sender_id,recipient_id,kind,body) VALUES ($1,$2,'auto',$3)", [to.id, me.id, clean(p.auto_reply, 500)]);
    }).catch(() => {});
    return id;
  }
  const one = async (id, me) => { const m = (await q(MSG_SQL + ' WHERE m.id=$2', [me, id])).rows[0]; return m && shape(m, me, true); };
  const mine = async (id, uid, mustOwn) => {
    const m = (await q('SELECT * FROM dm_messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)', [id, uid])).rows[0];
    if (!m) throw bad('Unknown message.', 404);
    if (mustOwn && m.sender_id !== uid) throw bad('That is not your message.', 403);
    return m;
  };

  // ----- numbers for the button
  app.get('/api/msg/summary', ...M, wrap(async (req, res) => {
    const me = req.user;
    await q('UPDATE dm_messages SET delivered_at=now() WHERE recipient_id=$1 AND delivered_at IS NULL', [me.id]);
    const dm = (await q(`SELECT COUNT(*)::int n FROM dm_messages m LEFT JOIN dm_state s ON s.user_id=$1 AND s.peer_id=m.sender_id
      WHERE m.recipient_id=$1 AND m.read_at IS NULL AND m.deleted_at IS NULL AND m.id>COALESCE(s.cleared_before,0) AND NOT COALESCE(s.muted,false)`, [me.id])).rows[0].n;
    const support = isStaff(me)
      ? (await q('SELECT COUNT(DISTINCT user_id)::int n FROM chat_messages WHERE NOT from_staff AND NOT read_by_staff')).rows[0].n
      : (await q('SELECT COUNT(*)::int n FROM chat_messages WHERE user_id=$1 AND from_staff AND NOT read_by_customer', [me.id])).rows[0].n;
    const latest = (await q(`SELECT u.username,m.kind,LEFT(m.body,60) body FROM dm_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN dm_state s ON s.user_id=$1 AND s.peer_id=m.sender_id
      WHERE m.recipient_id=$1 AND m.read_at IS NULL AND m.deleted_at IS NULL AND NOT COALESCE(s.muted,false) AND m.kind<>'auto' ORDER BY m.id DESC LIMIT 1`, [me.id])).rows[0];
    res.json({ unread: dm + support, dm, support, latest: latest ? { from: latest.username, text: latest.kind === 'image' ? 'Photo' : latest.body } : null });
  }));

  // ----- conversation list (direct messages + shop support)
  app.get('/api/msg/conversations', ...M, wrap(async (req, res) => {
    const me = req.user, key = 'CASE WHEN m.sender_id=$1 THEN m.recipient_id ELSE m.sender_id END';
    const rows = (await q(`SELECT u.id,u.username,u.role,l.sender_id=$1 mine,l.kind,LEFT(l.body,80) body,l.deleted_at IS NOT NULL deleted,l.created_at,
        COALESCE(s.pinned,false) pinned,COALESCE(s.muted,false) muted,COALESCE(s.archived,false) archived,COALESCE(s.nickname,'') nickname,
        COALESCE(pf.show_last_seen,true) visible,
        (SELECT COUNT(*)::int FROM dm_messages x WHERE x.sender_id=u.id AND x.recipient_id=$1 AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.id>COALESCE(s.cleared_before,0)) unread
      FROM (SELECT DISTINCT ON (${key}) m.*, ${key} peer FROM dm_messages m LEFT JOIN dm_state c ON c.user_id=$1 AND c.peer_id=(${key})
            WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND m.id>COALESCE(c.cleared_before,0) ORDER BY ${key}, m.id DESC) l
      JOIN users u ON u.id=l.peer LEFT JOIN dm_state s ON s.user_id=$1 AND s.peer_id=u.id LEFT JOIN dm_prefs pf ON pf.user_id=u.id
      ORDER BY COALESCE(s.pinned,false) DESC, l.id DESC LIMIT 300`, [me.id])).rows;
    const dms = rows.map((r) => ({ type: 'dm', id: r.id, username: r.username, role: r.role, name: r.nickname || r.username, mine: r.mine, kind: r.kind, preview: excerpt(r.kind, r.body, r.deleted), at: r.created_at,
      pinned: r.pinned, muted: r.muted, archived: r.archived, unread: r.unread, online: r.visible && online(r.id) }));
    let support = [];
    if (isStaff(me)) {
      support = (await q(`SELECT u.id,u.username,LEFT(m.body,80) last,m.created_at,m.from_staff,
          (SELECT COUNT(*)::int FROM chat_messages x WHERE x.user_id=u.id AND NOT x.from_staff AND NOT x.read_by_staff) unread
        FROM (SELECT DISTINCT ON (user_id) * FROM chat_messages ORDER BY user_id,id DESC) m JOIN users u ON u.id=m.user_id ORDER BY unread DESC, m.id DESC LIMIT 100`)).rows
        .map((r) => ({ type: 'support', id: r.id, username: r.username, role: 'customer', name: r.username, mine: r.from_staff, preview: r.last, at: r.created_at, unread: r.unread }));
    } else {
      const r = (await q('SELECT LEFT(body,80) last,created_at,from_staff,(SELECT COUNT(*)::int FROM chat_messages x WHERE x.user_id=$1 AND x.from_staff AND NOT x.read_by_customer) unread FROM chat_messages WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [me.id])).rows[0];
      support = [{ type: 'support', id: me.id, username: 'Shop support', role: 'shop', name: 'Shop support', mine: r ? !r.from_staff : false, preview: r ? r.last : 'Ask us about an order or a product', at: r ? r.created_at : null, unread: r ? r.unread : 0 }];
    }
    res.json({ dms: me.role === 'customer' ? [] : dms, support });
  }));

  // ----- find people
  app.get('/api/msg/users', ...M, wrap(async (req, res) => {
    const me = req.user, s = clean(req.query.q, 50).replace(/[%_\\]/g, '\\$&');
    if (!s || me.role === 'customer') return res.json([]);
    const exact = !isStaff(me); // customers find shop staff by name, and other customers only by their exact username
    const rows = (await q(`SELECT u.id,u.username,u.role,COALESCE(pf.show_last_seen,true) visible FROM users u LEFT JOIN dm_prefs pf ON pf.user_id=u.id
      WHERE u.id<>$1 AND (lower(u.username) LIKE lower($2) OR ($3 AND u.role<>'customer' AND lower(u.username) LIKE lower($2)) OR lower(u.username)=lower($4))
        AND ($5 OR u.role<>'customer' OR lower(u.username)=lower($4)) AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.user_id=u.id AND b.blocked_id=$1)
      ORDER BY (u.role<>'customer') DESC, u.username LIMIT 15`, [me.id, '%' + s + '%', exact, clean(req.query.q, 50), !exact])).rows;
    res.json(rows.map((u) => ({ id: u.id, username: u.username, role: u.role, online: u.visible && online(u.id) })));
  }));

  // ----- one conversation
  app.get('/api/msg/thread/:peer', ...M, wrap(async (req, res) => {
    const me = req.user, peerId = pid(req.params.peer), peer = await person(peerId);
    if (!peer) throw bad('Unknown person.', 404);
    const st = (await q('SELECT * FROM dm_state WHERE user_id=$1 AND peer_id=$2', [me.id, peerId])).rows[0] || {};
    const pp = await prefsOf(peerId), limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50)), before = parseInt(req.query.before) || null;
    const rows = (await q(MSG_SQL + ` WHERE ((m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)) AND m.id>$3 AND ($4::bigint IS NULL OR m.id<$4) ORDER BY m.id DESC LIMIT $5`,
      [me.id, peerId, st.cleared_before || 0, before, limit + 1])).rows;
    const more = rows.length > limit; if (more) rows.pop(); rows.reverse();
    const firstUnread = (await q('SELECT MIN(id) id FROM dm_messages WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL AND id>$3', [peerId, me.id, st.cleared_before || 0])).rows[0].id;
    if (!before) await q('UPDATE dm_messages SET read_at=now(), delivered_at=COALESCE(delivered_at,now()) WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL', [peerId, me.id]);
    const myPrefs = await prefsOf(me.id), tk = peerId + '>' + me.id;
    const pinned = st.pinned_msg ? (await q('SELECT id,kind,body,deleted_at FROM dm_messages WHERE id=$1', [st.pinned_msg])).rows[0] : null;
    const count = (await q('SELECT COUNT(*)::int n FROM dm_messages WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) AND id>$3', [me.id, peerId, st.cleared_before || 0])).rows[0].n;
    const scheduled = (await q('SELECT id,body,send_at FROM dm_scheduled WHERE sender_id=$1 AND recipient_id=$2 ORDER BY send_at', [me.id, peerId])).rows;
    res.json({
      messages: rows.map((m) => shape(m, me.id, pp.read_receipts && myPrefs.read_receipts)), more, first_unread: firstUnread ? Number(firstUnread) : null,
      peer: { id: peer.id, username: peer.username, role: peer.role, joined: peer.created_at, nickname: st.nickname || '', pinned: !!st.pinned, muted: !!st.muted, archived: !!st.archived,
        online: pp.show_last_seen && myPrefs.show_last_seen && online(peerId), typing: pp.typing && myPrefs.typing && Date.now() - (typing.get(tk) || 0) < 5000, count,
        blocked_by_me: !!(await q('SELECT 1 FROM dm_blocks WHERE user_id=$1 AND blocked_id=$2', [me.id, peerId])).rowCount, cant: await gate(me, peer) },
      pinned: pinned ? { id: pinned.id, text: excerpt(pinned.kind, pinned.body, pinned.deleted_at) } : null, scheduled });
  }));

  app.post('/api/msg/send', ...M, wrap(async (req, res) => {
    const b = req.body || {}, to = await person(pid(b.to));
    const id = await deliver(req, to, { body: b.body, kind: b.kind === 'image' ? 'image' : 'text', reply_to: parseInt(b.reply_to) || null });
    res.status(201).json(await one(id, req.user.id));
  }));
  app.post('/api/msg/message/:id/forward', ...M, wrap(async (req, res) => {
    const m = await mine(shortId(req.params.id), req.user.id), to = await person(pid(req.body && req.body.to));
    if (m.deleted_at || m.kind === 'auto') throw bad('That message cannot be forwarded.');
    res.status(201).json(await one(await deliver(req, to, { body: m.body, kind: m.kind === 'image' ? 'image' : 'text', forwarded: true }), req.user.id));
  }));

  // ----- scheduled sending
  app.post('/api/msg/schedule', ...M, wrap(async (req, res) => {
    const b = req.body || {}, to = await person(pid(b.to)), body = clean(b.body), at = new Date(b.send_at);
    if (!body) throw bad('Write a message first.');
    if (isNaN(at) || at < Date.now() + 30e3 || at > Date.now() + 30 * 864e5) throw bad('Pick a time between one minute and 30 days from now.');
    const reason = await gate(req.user, to); if (reason) throw bad(reason, 403);
    if ((await q('SELECT COUNT(*)::int n FROM dm_scheduled WHERE sender_id=$1', [req.user.id])).rows[0].n >= 20) throw bad('You can keep up to 20 scheduled messages.');
    res.status(201).json((await q('INSERT INTO dm_scheduled (sender_id,recipient_id,body,send_at) VALUES ($1,$2,$3,$4) RETURNING id,body,send_at', [req.user.id, to.id, body, at])).rows[0]);
  }));
  app.delete('/api/msg/schedule/:id', ...M, wrap(async (req, res) => { await q('DELETE FROM dm_scheduled WHERE id=$1 AND sender_id=$2', [shortId(req.params.id), req.user.id]); res.json({ ok: true }); }));

  // ----- edit, delete, react, star, pin, report
  app.put('/api/msg/message/:id', ...M, wrap(async (req, res) => {
    const m = await mine(shortId(req.params.id), req.user.id, true), body = clean(req.body && req.body.body);
    if (m.deleted_at || m.broadcast || m.kind !== 'text') throw bad('That message cannot be edited.');
    if (!body) throw bad('A message cannot be empty.');
    if (Date.now() - new Date(m.created_at) > EDIT_MIN * 60e3) throw bad('Messages can be edited for ' + EDIT_MIN + ' minutes.');
    await q('UPDATE dm_messages SET body=$1, edited_at=now() WHERE id=$2', [body, m.id]);
    res.json(await one(m.id, req.user.id));
  }));
  app.delete('/api/msg/message/:id', ...M, wrap(async (req, res) => {
    const id = shortId(req.params.id), mod = req.user.role === 'admin';
    const m = mod ? (await q('SELECT * FROM dm_messages WHERE id=$1', [id])).rows[0] : await mine(id, req.user.id, true);
    if (!m) throw bad('Unknown message.', 404);
    await q("UPDATE dm_messages SET body='', deleted_at=now(), kind='text' WHERE id=$1", [m.id]);
    await q('DELETE FROM dm_reactions WHERE message_id=$1', [m.id]);
    if (mod && m.sender_id !== req.user.id) audit(req, 'removed message ' + m.id);
    res.json({ ok: true });
  }));
  app.post('/api/msg/message/:id/react', ...M, wrap(async (req, res) => {
    const m = await mine(shortId(req.params.id), req.user.id), e = String(req.body && req.body.emoji || '');
    if (m.deleted_at || !REACTIONS.includes(e)) throw bad('Pick one of the reactions.');
    const had = (await q('SELECT emoji FROM dm_reactions WHERE message_id=$1 AND user_id=$2', [m.id, req.user.id])).rows[0];
    if (had && had.emoji === e) await q('DELETE FROM dm_reactions WHERE message_id=$1 AND user_id=$2', [m.id, req.user.id]);
    else await q('INSERT INTO dm_reactions (message_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT (message_id,user_id) DO UPDATE SET emoji=$3', [m.id, req.user.id, e]);
    res.json(await one(m.id, req.user.id));
  }));
  app.post('/api/msg/message/:id/star', ...M, wrap(async (req, res) => {
    const m = await mine(shortId(req.params.id), req.user.id);
    const r = await q('DELETE FROM dm_stars WHERE user_id=$1 AND message_id=$2', [req.user.id, m.id]);
    if (!r.rowCount) await q('INSERT INTO dm_stars (user_id,message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, m.id]);
    res.json({ starred: !r.rowCount });
  }));
  app.get('/api/msg/starred', ...M, wrap(async (req, res) => {
    res.json((await q(`SELECT m.id,m.kind,CASE WHEN m.deleted_at IS NULL THEN LEFT(m.body,200) ELSE '' END body,m.created_at,m.sender_id=$1 mine,u.id peer,u.username FROM dm_stars st JOIN dm_messages m ON m.id=st.message_id
      JOIN users u ON u.id=CASE WHEN m.sender_id=$1 THEN m.recipient_id ELSE m.sender_id END WHERE st.user_id=$1 ORDER BY m.id DESC LIMIT 100`, [req.user.id])).rows);
  }));
  app.post('/api/msg/message/:id/report', ...M, wrap(async (req, res) => {
    const m = await mine(shortId(req.params.id), req.user.id);
    if (m.sender_id === req.user.id) throw bad('You cannot report your own message.');
    await q('INSERT INTO dm_reports (message_id,reporter_id,reported_id,excerpt,reason) VALUES ($1,$2,$3,$4,$5)', [m.id, req.user.id, m.sender_id, m.kind === 'image' ? '(photo)' : m.body.slice(0, 300), clean(req.body && req.body.reason, 200)]);
    res.json({ ok: true });
  }));

  // ----- per-conversation settings: pin, mute, archive, nickname, pinned message
  app.put('/api/msg/chat/:peer', ...M, wrap(async (req, res) => {
    const peerId = pid(req.params.peer), b = req.body || {};
    if (!(await person(peerId))) throw bad('Unknown person.', 404);
    await q('INSERT INTO dm_state (user_id,peer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, peerId]);
    const set = [], v = [req.user.id, peerId];
    for (const k of ['pinned', 'muted', 'archived']) if (typeof b[k] === 'boolean') { v.push(b[k]); set.push(`${k}=$${v.length}`); }
    if (typeof b.nickname === 'string') { v.push(clean(b.nickname, 40)); set.push(`nickname=$${v.length}`); }
    if ('pinned_msg' in b) {
      let id = b.pinned_msg == null ? null : parseInt(b.pinned_msg);
      if (id && !(await q('SELECT 1 FROM dm_messages WHERE id=$1 AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2))', [id, req.user.id, peerId])).rowCount) id = null;
      v.push(id); set.push(`pinned_msg=$${v.length}`);
    }
    if (set.length) await q(`UPDATE dm_state SET ${set.join(',')} WHERE user_id=$1 AND peer_id=$2`, v);
    res.json({ ok: true });
  }));
  app.delete('/api/msg/chat/:peer', ...M, wrap(async (req, res) => {
    const peerId = pid(req.params.peer);
    const top = (await q('SELECT COALESCE(MAX(id),0) id FROM dm_messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)', [req.user.id, peerId])).rows[0].id;
    await q('INSERT INTO dm_state (user_id,peer_id,cleared_before) VALUES ($1,$2,$3) ON CONFLICT (user_id,peer_id) DO UPDATE SET cleared_before=$3, pinned_msg=NULL', [req.user.id, peerId, top]);
    res.json({ ok: true });
  }));
  app.post('/api/msg/typing/:peer', ...M, wrap(async (req, res) => { typing.set(req.user.id + '>' + pid(req.params.peer), Date.now()); res.json({ ok: true }); }));

  // ----- blocking
  app.get('/api/msg/blocks', ...M, wrap(async (req, res) => { res.json((await q('SELECT u.id,u.username,u.role FROM dm_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=$1 ORDER BY u.username', [req.user.id])).rows); }));
  app.post('/api/msg/block/:uid', ...M, wrap(async (req, res) => {
    const id = pid(req.params.uid); if (id === req.user.id) throw bad('You cannot block yourself.');
    if (!(await person(id))) throw bad('Unknown person.', 404);
    await q('INSERT INTO dm_blocks (user_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]); res.json({ ok: true });
  }));
  app.delete('/api/msg/block/:uid', ...M, wrap(async (req, res) => { await q('DELETE FROM dm_blocks WHERE user_id=$1 AND blocked_id=$2', [req.user.id, pid(req.params.uid)]); res.json({ ok: true }); }));

  // ----- my message settings and saved replies
  app.get('/api/msg/prefs', ...M, wrap(async (req, res) => { const p = await prefsOf(req.user.id); delete p.user_id; res.json(p); }));
  app.put('/api/msg/prefs', ...M, wrap(async (req, res) => {
    const b = req.body || {}, cur = await prefsOf(req.user.id);
    const n = {
      read_receipts: typeof b.read_receipts === 'boolean' ? b.read_receipts : cur.read_receipts, typing: typeof b.typing === 'boolean' ? b.typing : cur.typing,
      show_last_seen: typeof b.show_last_seen === 'boolean' ? b.show_last_seen : cur.show_last_seen,
      allow_from: ['everyone', 'staff', 'nobody'].includes(b.allow_from) ? b.allow_from : cur.allow_from,
      auto_reply_on: typeof b.auto_reply_on === 'boolean' ? b.auto_reply_on : cur.auto_reply_on, auto_reply: typeof b.auto_reply === 'string' ? clean(b.auto_reply, 500) : cur.auto_reply };
    await q(`INSERT INTO dm_prefs (user_id,read_receipts,typing,show_last_seen,allow_from,auto_reply_on,auto_reply) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id) DO UPDATE SET read_receipts=$2,typing=$3,show_last_seen=$4,allow_from=$5,auto_reply_on=$6,auto_reply=$7`, [req.user.id, n.read_receipts, n.typing, n.show_last_seen, n.allow_from, n.auto_reply_on, n.auto_reply]);
    res.json(n);
  }));
  app.get('/api/msg/canned', ...M, wrap(async (req, res) => { res.json((await q('SELECT id,title,body FROM dm_canned WHERE user_id=$1 ORDER BY id', [req.user.id])).rows); }));
  app.post('/api/msg/canned', ...M, wrap(async (req, res) => {
    const title = clean(req.body && req.body.title, 40), body = clean(req.body && req.body.body, 500);
    if (!title || !body) throw bad('Give the reply a title and some text.');
    if ((await q('SELECT COUNT(*)::int n FROM dm_canned WHERE user_id=$1', [req.user.id])).rows[0].n >= 30) throw bad('You can keep up to 30 saved replies.');
    res.status(201).json((await q('INSERT INTO dm_canned (user_id,title,body) VALUES ($1,$2,$3) RETURNING id,title,body', [req.user.id, title, body])).rows[0]);
  }));
  app.delete('/api/msg/canned/:id', ...M, wrap(async (req, res) => { await q('DELETE FROM dm_canned WHERE id=$1 AND user_id=$2', [shortId(req.params.id), req.user.id]); res.json({ ok: true }); }));

  // ----- search across all my conversations
  app.get('/api/msg/search', ...M, wrap(async (req, res) => {
    const s = clean(req.query.q, 60).replace(/[%_\\]/g, '\\$&'); if (s.length < 2) return res.json([]);
    res.json((await q(`SELECT m.id,m.created_at,m.sender_id=$1 mine,u.id peer,u.username,LEFT(m.body,160) body FROM dm_messages m
      JOIN users u ON u.id=CASE WHEN m.sender_id=$1 THEN m.recipient_id ELSE m.sender_id END LEFT JOIN dm_state c ON c.user_id=$1 AND c.peer_id=u.id
      WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND m.kind IN ('text','auto') AND m.deleted_at IS NULL AND m.id>COALESCE(c.cleared_before,0) AND m.body ILIKE $2 ORDER BY m.id DESC LIMIT 30`, [req.user.id, '%' + s + '%'])).rows);
  }));

  // ----- admin: broadcast, reports, numbers
  app.post('/api/msg/broadcast', auth, admin, wrap(async (req, res) => {
    const body = clean(req.body && req.body.body, 1000), who = req.body && req.body.audience;
    if (!body) throw bad('Write a message first.');
    if (!['customers', 'sellers', 'all'].includes(who)) throw bad('Choose who should receive it.');
    const r = await q(`INSERT INTO dm_messages (sender_id,recipient_id,kind,body,broadcast) SELECT $1,u.id,'text',$2,true FROM users u
      WHERE u.id<>$1 AND ($3='all' OR ($3='customers' AND u.role='customer') OR ($3='sellers' AND u.role='seller'))
        AND NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE b.user_id=u.id AND b.blocked_id=$1) LIMIT 5000`, [req.user.id, body, who]);
    audit(req, `broadcast to ${who}: ${r.rowCount}`);
    res.json({ sent: r.rowCount });
  }));
  app.get('/api/msg/admin/reports', auth, admin, nocache, wrap(async (req, res) => {
    res.json((await q(`SELECT r.id,r.message_id,r.excerpt,r.reason,r.status,r.created_at,a.username reporter,b.username reported FROM dm_reports r
      LEFT JOIN users a ON a.id=r.reporter_id LEFT JOIN users b ON b.id=r.reported_id ORDER BY (r.status='open') DESC, r.id DESC LIMIT 100`)).rows);
  }));
  app.post('/api/msg/admin/reports/:id/resolve', auth, admin, wrap(async (req, res) => {
    const r = (await q("UPDATE dm_reports SET status='resolved' WHERE id=$1 RETURNING message_id", [shortId(req.params.id)])).rows[0];
    if (r && req.body && req.body.remove && r.message_id) await q("UPDATE dm_messages SET body='', deleted_at=now(), kind='text' WHERE id=$1", [r.message_id]);
    audit(req, 'resolved report ' + req.params.id); res.json({ ok: true });
  }));

  // ----- diagnostics: open to every signed-in user (their own numbers), with shop-wide counts for the admin
  app.get('/api/msg/diag', ...M, wrap(async (req, res) => {
    const t = Date.now(), me = req.user.id; await q('SELECT 1'); const ms = Date.now() - t;
    const mineN = (await q(`SELECT (SELECT COUNT(*)::int FROM dm_messages WHERE sender_id=$1 OR recipient_id=$1) messages,(SELECT COUNT(*)::int FROM dm_messages WHERE recipient_id=$1 AND read_at IS NULL) unread,
      (SELECT COUNT(*)::int FROM dm_scheduled WHERE sender_id=$1) scheduled,(SELECT COUNT(*)::int FROM dm_blocks WHERE user_id=$1) blocked,(SELECT COUNT(*)::int FROM dm_canned WHERE user_id=$1) saved_replies`, [me])).rows[0];
    const out = { ok: true, server_time: new Date().toISOString(), database_ms: ms, role: req.user.role, you_are_online: online(me), online_now: [...seen.values()].filter((x) => Date.now() - x < 70e3).length, limits: { text_chars: TEXT_MAX, picture_kb: Math.round(IMG_MAX * 0.75 / 1024), edit_minutes: EDIT_MIN, keep_days: KEEP_DAYS }, mine: mineN };
    if (req.user.role === 'admin') out.shop = (await q(`SELECT (SELECT COUNT(*)::int FROM dm_messages) messages,(SELECT COUNT(*)::int FROM dm_messages WHERE created_at>now()-interval '24 hours') last_24h,
      (SELECT COUNT(*)::int FROM dm_scheduled) scheduled_waiting,(SELECT COUNT(*)::int FROM dm_reports WHERE status='open') open_reports,(SELECT COUNT(*)::int FROM dm_blocks) blocks`)).rows[0];
    res.json(out);
  }));

  // ----- housekeeping: send due scheduled messages, forget old presence, delete messages after KEEP_DAYS
  setInterval(() => {
    q(`WITH due AS (DELETE FROM dm_scheduled WHERE send_at<=now() RETURNING *)
       INSERT INTO dm_messages (sender_id,recipient_id,kind,body,reply_to) SELECT d.sender_id,d.recipient_id,'text',d.body,NULL FROM due d
       WHERE NOT EXISTS (SELECT 1 FROM dm_blocks b WHERE (b.user_id=d.recipient_id AND b.blocked_id=d.sender_id) OR (b.user_id=d.sender_id AND b.blocked_id=d.recipient_id))`).catch(() => {});
    const now = Date.now(); for (const [k, v] of typing) if (now - v > 30e3) typing.delete(k); for (const [k, v] of seen) if (now - v > 36e5) seen.delete(k);
  }, 20e3).unref();
  setInterval(() => q(`DELETE FROM dm_messages WHERE created_at<now()-interval '${KEEP_DAYS} days'`).catch(() => {}), 6 * 3600e3).unref();
};
