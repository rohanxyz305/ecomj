// Copies the local data/*.json files (products, offers, blog posts…) into the Redis database used on Vercel.
// Usage:  vercel env pull .env.local --yes   then   npm run import-data
// Existing collections in Redis are skipped unless you pass --force (then they are overwritten).
// The admin account and the cookie secret are NOT copied: on Vercel the admin account is created
// from the ADMIN_USER / ADMIN_PASSWORD environment variables on the first request.
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const SKIP = new Set(['admin']);
const force = process.argv.includes('--force');

(async () => {
  if (!db.USE_REDIS) {
    console.error('No Redis settings found. Run "vercel env pull .env.local --yes" first.');
    process.exit(1);
  }
  const redis = db.client();
  for (const name of db.COLLECTIONS) {
    const file = path.join(db.DATA_DIR, `${name}.json`);
    if (SKIP.has(name) || !fs.existsSync(file)) continue;
    const key = db.PREFIX + name;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const count = Array.isArray(data) ? `${data.length} items` : 'settings';
    if (!force && (await redis.exists(key))) {
      console.log(`skip    ${name.padEnd(16)} (already in Redis; use --force to overwrite)`);
      continue;
    }
    await redis.set(key, JSON.stringify(data));
    console.log(`copied  ${name.padEnd(16)} ${count}`);
  }
  console.log('Done.');
})().catch(err => { console.error(err.message); process.exit(1); });
