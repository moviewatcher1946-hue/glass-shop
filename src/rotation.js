// Rotating stock: the shop shows only some products at a time and swaps them on a schedule.
// The admin AI sets the rules (see the rotation tools in agent.js); this file does the work and keeps the schedule.
//
// How it works:
//  - products.resting = true means "not on the shelf right now". Customers do not see or buy a resting product; the admin and staff still see everything.
//  - Each rotation shows `count` products: pinned ones first (if keepPinned), then the products that have been on the shelf the LONGEST ago, so everything gets a turn.
//    Sold-out products and products of hidden sellers are never picked.
//  - The rules live in the settings table under the key "rotation". The server checks every 5 minutes whether it is time, and catches up after a sleep.
module.exports = function mount(app, { pool, auth, admin, wrap }) {
  const q = (text, params) => pool.query(text, params);
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
  const KEY = 'rotation';
  const DEFAULTS = { enabled: false, count: 12, everyHours: 24, keepPinned: true, nextAt: null, lastAt: null };
  const num = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  async function load() {
    try {
      const r = (await q('SELECT value FROM settings WHERE key=$1', [KEY])).rows[0];
      return { ...DEFAULTS, ...(r ? JSON.parse(r.value) : {}) };
    } catch (e) { return { ...DEFAULTS }; }
  }
  const save = (s) => q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [KEY, JSON.stringify(s)]);
  const audit = (req, action, detail) => q('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)',
    [req.user.id, req.user.username, req.user.role, action, String(detail || '').slice(0, 500)]).catch(() => {});

  // Which products should be on the shelf next.
  async function pickIds(count, keepPinned) {
    const ids = [];
    if (keepPinned) {
      ids.push(...(await q('SELECT id FROM products WHERE pinned ORDER BY sort_order ASC NULLS LAST, id LIMIT $1', [count])).rows.map((r) => r.id));
    }
    const room = count - ids.length;
    if (room > 0) {
      const { rows } = await q(
        `SELECT id FROM products
         WHERE NOT is_sold_out AND (stock IS NULL OR stock > 0)
           AND NOT COALESCE((SELECT products_hidden FROM users WHERE users.id = products.owner_id), false)
           AND NOT (id = ANY($1::int[]))
         ORDER BY last_shown ASC NULLS FIRST, random() LIMIT $2`, [ids, room]);
      ids.push(...rows.map((r) => r.id));
    }
    return ids;
  }

  // Puts exactly these products on the shelf; everything else rests.
  const apply = (ids) => q(
    `UPDATE products SET resting = NOT (id = ANY($1::int[])),
       last_shown = CASE WHEN id = ANY($1::int[]) THEN now() ELSE last_shown END`, [ids]);

  async function rotate(s) {
    const ids = await pickIds(s.count, s.keepPinned);
    if (!ids.length) return { skipped: true, shown: 0 }; // nothing eligible: never empty the shop
    await apply(ids);
    s.lastAt = new Date().toISOString();
    s.nextAt = new Date(Date.now() + s.everyHours * 3600e3).toISOString();
    await save(s);
    return { skipped: false, shown: ids.length };
  }

  async function status() {
    const s = await load();
    const { rows } = await q('SELECT id, title, resting, pinned, is_sold_out, stock FROM products ORDER BY resting, pinned DESC, title LIMIT 1000');
    return {
      settings: s,
      total: rows.length,
      showing: rows.filter((r) => !r.resting).map((r) => ({ id: r.id, title: r.title, pinned: r.pinned })),
      resting: rows.filter((r) => r.resting).map((r) => ({ id: r.id, title: r.title, sold_out: r.is_sold_out })),
    };
  }

  app.get('/api/admin/rotation', auth, admin, wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await status()); }));

  // Rules: enabled, count, everyHours, keepPinned. rotateNow swaps the shelf immediately.
  app.put('/api/admin/rotation/settings', auth, admin, wrap(async (req, res) => {
    const b = req.body || {};
    const s = await load();
    const wasOn = s.enabled;
    if (b.count !== undefined) s.count = num(b.count, 1, 500, s.count);
    if (b.everyHours !== undefined) { s.everyHours = num(b.everyHours, 1, 720, s.everyHours); if (s.lastAt) s.nextAt = new Date(Date.parse(s.lastAt) + s.everyHours * 3600e3).toISOString(); }
    if (b.keepPinned !== undefined) s.keepPinned = !!b.keepPinned;
    if (b.enabled !== undefined) s.enabled = !!b.enabled;
    let r = null;
    if (b.rotateNow || (s.enabled && !wasOn)) r = await rotate(s);
    else { if (s.enabled && !s.nextAt) s.nextAt = new Date(Date.now() + s.everyHours * 3600e3).toISOString(); await save(s); }
    const parts = [];
    parts.push(s.enabled ? `Rotation is ON: ${s.count} products at a time, changing every ${s.everyHours} hour${s.everyHours === 1 ? '' : 's'}${s.keepPinned ? ', pinned products always shown' : ''}.` : 'Rotation is OFF.');
    if (r) parts.push(r.skipped ? 'Nothing could be rotated because no product is available to show.' : `The shelf was changed now: ${r.shown} products are showing.`);
    await audit(req, 'Changed stock rotation', parts.join(' '));
    res.json({ message: parts.join(' '), ...(await status()) });
  }));

  // The admin picks exactly which products to show now; the rest rest. (The schedule, if on, keeps running and will rotate again later.)
  app.put('/api/admin/rotation/show', auth, admin, wrap(async (req, res) => {
    const raw = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    if (!ids.length) throw fail('Pick at least one product to show.');
    const { rows } = await q('SELECT id FROM products WHERE id = ANY($1::int[])', [ids]);
    if (!rows.length) throw fail('None of those products exist.', 404);
    await apply(rows.map((r) => r.id));
    const msg = `Now showing ${rows.length} product${rows.length === 1 ? '' : 's'}; the others are resting.`;
    await audit(req, 'Chose which products to show', msg);
    res.json({ message: msg, ...(await status()) });
  }));

  // Back to normal: every product shows and rotation stops.
  app.post('/api/admin/rotation/off', auth, admin, wrap(async (req, res) => {
    const s = await load();
    s.enabled = false; s.nextAt = null;
    await q('UPDATE products SET resting = false WHERE resting');
    await save(s);
    await audit(req, 'Turned off stock rotation', 'All products are showing again');
    res.json({ message: 'Rotation is OFF and every product is showing again.', ...(await status()) });
  }));

  const tick = async () => {
    try {
      const s = await load();
      if (!s.enabled || (s.nextAt && Date.now() < Date.parse(s.nextAt))) return;
      const r = await rotate(s);
      console.log('[rotation]', r.skipped ? 'nothing to rotate' : `shelf changed, ${r.shown} products showing`);
    } catch (e) { console.error('[rotation]', e.message); }
  };
  setTimeout(tick, 60e3).unref(); // soon after start (a host that sleeps catches up when it wakes)
  setInterval(tick, 5 * 60e3).unref();
  return { rotate: async () => rotate(await load()), status };
};
