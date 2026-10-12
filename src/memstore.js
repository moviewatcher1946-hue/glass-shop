// Memory store: keeps only a small "hot" set in RAM; everything else lives in Postgres and is fetched in packets on demand.
// - put/get/del: key-value cold storage (hot LRU in RAM, capped by bytes)
// - append/page: append-only logs, read back in packets (keyset paging by id)
// - release(): drop RAM caches registered with onRelease (picture cache, hot LRU...)
let pool = null, ready = null;
const HOT_MAX = Number(process.env.MEMSTORE_HOT_KB || 512) * 1024;
const hot = new Map(); let hotBytes = 0;
const releasers = [];
const logBuf = []; let flushing = false;

function init(p) {
  if (ready) return ready;
  pool = p;
  ready = pool.query(`CREATE TABLE IF NOT EXISTS mem_store (
      bucket TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, size INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (bucket, key));
    CREATE TABLE IF NOT EXISTS mem_log (
      id BIGSERIAL PRIMARY KEY, bucket TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mem_log_bucket ON mem_log (bucket, id);`).then(() => true);
  ready.catch((e) => { console.error('memstore init:', e.message); ready = null; });
  setInterval(() => flush().catch(() => {}), 5000).unref();
  return ready;
}
const need = async () => { if (!pool) throw new Error('memstore not initialised'); await (ready || init(pool)); };
const hk = (b, k) => b + '\u0001' + k;
function heat(b, k, v, n) {
  const key = hk(b, k); const old = hot.get(key); if (old) { hotBytes -= old.n; hot.delete(key); }
  if (n > HOT_MAX / 4) return; // too big to keep in RAM at all
  hot.set(key, { v, n }); hotBytes += n;
  for (const [kk, e] of hot) { if (hotBytes <= HOT_MAX) break; hot.delete(kk); hotBytes -= e.n; }
}
async function put(bucket, key, value) {
  await need(); const s = JSON.stringify(value);
  await pool.query('INSERT INTO mem_store (bucket,key,data,size) VALUES ($1,$2,$3,$4) ON CONFLICT (bucket,key) DO UPDATE SET data=EXCLUDED.data,size=EXCLUDED.size,updated_at=now()', [bucket, String(key), s, s.length]);
  heat(bucket, String(key), value, s.length);
}
async function get(bucket, key) {
  const h = hot.get(hk(bucket, String(key))); if (h) return h.v;
  await need(); const r = await pool.query('SELECT data FROM mem_store WHERE bucket=$1 AND key=$2', [bucket, String(key)]);
  if (!r.rows[0]) return null; const v = JSON.parse(r.rows[0].data); heat(bucket, String(key), v, r.rows[0].data.length); return v;
}
async function del(bucket, key) {
  await need(); hot.delete(hk(bucket, String(key))); await pool.query('DELETE FROM mem_store WHERE bucket=$1 AND key=$2', [bucket, String(key)]);
}
// Append-only log: buffered in RAM (tiny), written to the database in one batch, read back in packets.
function append(bucket, value) { logBuf.push([bucket, JSON.stringify(value)]); if (logBuf.length >= 25) flush().catch(() => {}); }
async function flush() {
  if (flushing || !logBuf.length || !pool) return; flushing = true;
  const batch = logBuf.splice(0, logBuf.length);
  try {
    await need();
    const vals = [], ph = batch.map((b, i) => { vals.push(b[0], b[1]); return `($${i * 2 + 1},$${i * 2 + 2})`; });
    await pool.query(`INSERT INTO mem_log (bucket,data) VALUES ${ph.join(',')}`, vals);
  } catch (e) { logBuf.unshift(...batch.slice(0, 200)); console.error('memstore flush:', e.message); throw e; } finally { flushing = false; }
}
// A packet of the newest entries first; pass `before` (the id of the oldest one you already have) for the next packet.
async function page(bucket, { before = null, limit = 50 } = {}) {
  await flush().catch(() => {}); await need(); limit = Math.max(1, Math.min(200, Number(limit) || 50));
  const r = await pool.query(`SELECT id, at, data FROM mem_log WHERE bucket=$1 ${before ? 'AND id<$3' : ''} ORDER BY id DESC LIMIT $2`, before ? [bucket, limit + 1, before] : [bucket, limit + 1]);
  const more = r.rows.length > limit, rows = r.rows.slice(0, limit).map((x) => ({ id: Number(x.id), at: x.at, ...JSON.parse(x.data) }));
  return { rows, more, next: rows.length ? rows[rows.length - 1].id : null };
}
async function trim(bucket, keep = 2000) { await need(); await pool.query('DELETE FROM mem_log WHERE bucket=$1 AND id < (SELECT COALESCE(MAX(id),0) - $2 FROM mem_log WHERE bucket=$1)', [bucket, keep]); }
function onRelease(fn) { releasers.push(fn); }
function release() { hot.clear(); hotBytes = 0; for (const f of releasers) { try { f(); } catch (e) { /* keep going */ } } if (global.gc) global.gc(); }
const stats = () => ({ hot_entries: hot.size, hot_kb: Math.round(hotBytes / 1024), pending_log: logBuf.length });
module.exports = { init, put, get, del, append, flush, page, trim, onRelease, release, stats };
