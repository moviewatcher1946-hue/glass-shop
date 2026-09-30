const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Render's Postgres requires SSL; local Postgres usually doesn't.
const local = /localhost|127\.0\.0\.1/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));

  const name = process.env.ADMIN_USERNAME || 'raven';
  const pass = process.env.ADMIN_PASSWORD || 'MAMA5577';
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [name]);
  if (!rowCount) {
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'admin')", [
      name,
      await bcrypt.hash(pass, 12),
    ]);
    console.log(`Seeded admin user "${name}"`);
  }
}

module.exports = { pool, init };
