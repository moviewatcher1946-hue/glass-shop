// Usage: node scripts/decrypt-backup.js shop-backup-2026-10-11.json.gz.enc YOUR_BACKUP_KEY
// Writes the restorable .json next to the file.
const fs = require('fs'), c = require('crypto'), zlib = require('zlib');
const [file, key] = process.argv.slice(2);
if (!file || !key) { console.log('Usage: node scripts/decrypt-backup.js <file.enc> <BACKUP_KEY>'); process.exit(1); }
const b = fs.readFileSync(file);
if (b.slice(0, 4).toString() !== 'GSB1') { console.log('Not an encrypted shop backup.'); process.exit(1); }
const d = c.createDecipheriv('aes-256-gcm', c.scryptSync(key, b.slice(4, 20), 32), b.slice(20, 32)); d.setAuthTag(b.slice(32, 48));
const out = file.replace(/\.gz\.enc$|\.enc$/, '');
fs.writeFileSync(out.endsWith('.json') ? out : out + '.json', zlib.gunzipSync(Buffer.concat([d.update(b.slice(48)), d.final()])));
console.log('Done: wrong key or a damaged file would have failed above.');
