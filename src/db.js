const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// The database is chosen ONLY by the connection string, so swapping to a new database is: change DATABASE_URL, redeploy. Nothing else in the code changes.
// Common alternative names that hosts use are accepted too, so a new provider works without renaming anything.
const url = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
if (!url) throw new Error('DATABASE_URL is not set');

// Different hosts write the secure-connection setting differently (?sslmode=require, ?ssl=true, nothing at all). Read it once here, remove it from the
// address (so the driver cannot override our setting), and decide: secure connection on, except for your own computer or an explicit sslmode=disable / PGSSL=off.
function describe(raw) {
  let clean = raw, label = 'the database', ssl = true;
  try {
    const u = new URL(raw);
    label = `${u.hostname}${u.pathname || ''}`;
    if (u.searchParams.get('sslmode') === 'disable' || /^(false|0|off)$/i.test(u.searchParams.get('ssl') || '')) ssl = false;
    for (const k of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(k);
    clean = u.toString();
    if (/^(localhost|127\.0\.0\.1|::1)$/.test(u.hostname)) ssl = false;
  } catch (e) {
    if (/localhost|127\.0\.0\.1/.test(raw)) ssl = false;
  }
  if (/^(off|false|0|disable)$/i.test(process.env.PGSSL || '')) ssl = false;
  return { clean, label, ssl };
}
const target = describe(url);
console.log(`Database: ${target.label} (${target.ssl ? 'secure connection' : 'no SSL'})`); // never prints the password

// Protection: never wait forever for a connection or a query. A sleeping or unreachable database now fails fast (10 s) instead of
// piling up requests until the whole shop stops answering. Safe limits, tunable with PG_POOL_MAX.
const pool = new Pool({
  connectionString: target.clean,
  ssl: target.ssl ? { rejectUnauthorized: false } : false,
  max: Math.max(2, Math.min(30, Number(process.env.PG_POOL_MAX) || 10)),
  connectionTimeoutMillis: 10e3,
  idleTimeoutMillis: 30e3,
  keepAlive: true,
  statement_timeout: 60e3,
  query_timeout: 70e3,
});

// Bug fix: when the database restarts, an idle connection reports an error. With no listener Node treats that as fatal and the whole shop went down.
pool.on('error', (e) => console.error('Database connection error (idle client):', e.message));

// Turns the driver's cryptic errors into something that says what to do. (An expired free database is the usual cause.)
function explain(e) {
  const code = String(e && e.code || ''), msg = String(e && e.message || e);
  let why = null;
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) why = 'its address no longer exists (an expired or deleted database looks like this)';
  else if (/^(ECONNREFUSED|ETIMEDOUT|ECONNRESET)$/.test(code) || /timeout exceeded when trying to connect|Connection terminated/i.test(msg)) why = 'it is not answering (it may be asleep, suspended or expired)';
  else if (code === '28P01' || code === '28000') why = 'the username or password was rejected';
  else if (code === '3D000') why = 'that database name does not exist on the server';
  else if (/SSL|TLS/i.test(msg)) why = 'the secure-connection setting does not match (set PGSSL=off only if this host really has no SSL)';
  if (!why) return e;
  const err = new Error(`Cannot use ${target.label}: ${why}. To switch to a new database, put its connection string in DATABASE_URL and redeploy. (${msg})`);
  err.code = e.code; err.cause = e;
  return err;
}

async function init() {
  try { await pool.query('SELECT 1'); } catch (e) { throw explain(e); }
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));

  const name = process.env.ADMIN_USERNAME || 'raven';
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [name]);
  if (!rowCount) {
    // No password is built into the code. In production ADMIN_PASSWORD must be set; on your own computer a random one is made and printed once.
    let pass = process.env.ADMIN_PASSWORD;
    if (!pass) {
      if (process.env.NODE_ENV === 'production') throw new Error('ADMIN_PASSWORD must be set to create the first admin account');
      pass = require('crypto').randomBytes(9).toString('base64url');
      console.log(`No ADMIN_PASSWORD set. Temporary admin password for "${name}": ${pass}`);
    }
    if (pass.length < 10) console.warn('[security] ADMIN_PASSWORD is short. Use at least 10 characters.');
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'admin')", [
      name,
      await bcrypt.hash(pass, 12),
    ]);
    console.log(`Seeded admin user "${name}"`);
  }
}

module.exports = { pool, init };
