// Tiny JSON-file store: each collection lives in data/<name>.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const file = name => path.join(DATA_DIR, `${name}.json`);

function read(name, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Write to a temp file first so a crash never leaves half-written JSON behind
function write(name, data) {
  const tmp = `${file(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file(name));
}

const exists = name => fs.existsSync(file(name));
const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = { DATA_DIR, read, write, exists, newId };
