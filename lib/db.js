// Tiny JSON-file store: each collection lives in data/<name>.json
// Note: this is safe only while the app runs as ONE Node process with synchronous handlers
// around each read-modify-write. Do not run it in cluster mode or behind several instances;
// move to SQLite (e.g. better-sqlite3) before you need that.
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

// Busy-wait helper for the rare Windows rename retry (keeps write() synchronous)
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Write to a unique temp file, flush it to disk, then rename over the real file,
// so a crash or power loss never leaves half-written or empty JSON behind.
function write(name, data) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // On Windows, antivirus or indexers can briefly lock the target file (EPERM/EBUSY)
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err;
      }
      pause(20 * (attempt + 1));
    }
  }
}

const exists = name => fs.existsSync(file(name));
const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = { DATA_DIR, read, write, exists, newId };
