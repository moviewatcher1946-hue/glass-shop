// One-time job: shrinks photos that are already stored in the database (new uploads are shrunk automatically).
// Run:  npm run optimize-images            (does it)      |   npm run optimize-images -- --dry   (only shows what would change)
// Works against whatever DATABASE_URL points at, so put your Render database's external URL in .env first. Make a backup first (Admin > Backup).
const { pool } = require('../src/db');
const sharp = require('sharp');
const dry = process.argv.includes('--dry');
(async () => {
  const { rows } = await pool.query("SELECT id, image_data, image_mime FROM products WHERE image_data IS NOT NULL AND image_mime <> 'image/gif' AND length(image_data) > 150000 ORDER BY id");
  let before = 0, after = 0;
  for (const r of rows) {
    const out = await sharp(r.image_data).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer().catch(() => null);
    if (!out || out.length >= r.image_data.length) { console.log(`#${r.id}: left as is`); continue; }
    before += r.image_data.length; after += out.length;
    console.log(`#${r.id}: ${(r.image_data.length / 1024) | 0} KB -> ${(out.length / 1024) | 0} KB`);
    if (!dry) await pool.query("UPDATE products SET image_data=$1, image_mime='image/webp', image_url='/api/products/' || id || '/image?v=' || floor(extract(epoch from now()))::text WHERE id=$2", [out, r.id]);
  }
  console.log(`${dry ? 'Would save' : 'Saved'} ${((before - after) / 1048576).toFixed(1)} MB across ${rows.length} photo(s).`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
