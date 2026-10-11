const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Render's Postgres requires SSL; local Postgres usually doesn't.
const local = /localhost|127\.0\.0\.1/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

// Bug fix: when the database restarts, an idle connection reports an error. With no listener Node treats that as fatal and the whole shop went down.
pool.on('error', (e) => console.error('Database connection error (idle client):', e.message));

async function init() {
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
