// Data store with two backends, chosen automatically:
//
// 1. JSON files in data/<name>.json (local development, a single-server host).
//    Safe only while the app runs as ONE Node process.
//
// 2. Redis (Upstash, e.g. on Vercel), when UPSTASH_REDIS_REST_URL or KV_REST_API_URL is set.
//    Each request loads all collections once (one round trip) into a request-scoped snapshot,
//    so db.read()/db.write() stay synchronous for the route code. Writes are buffered and saved
//    just before the response is sent. Requests that change data (POST/PUT/PATCH/DELETE) hold a
//    global lock while they run, so concurrent orders can never oversell stock.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const DATA_DIR = path.join(__dirname, '..', 'data');
const newId = () => crypto.randomBytes(6).toString('hex');

/* ---------------- Backend 1: JSON files ---------------- */

const file = name => path.join(DATA_DIR, `${name}.json`);
if (!USE_REDIS) fs.mkdirSync(DATA_DIR, { recursive: true });

function fileRead(name, fallback) {
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
function fileWrite(name, data) {
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

/* ---------------- Backend 2: Redis (request-scoped snapshot) ---------------- */

// Every collection the app stores; each is one Redis key holding JSON
const COLLECTIONS = ['admin', 'products', 'offers', 'orders', 'users', 'blog', 'pages', 'settings', 'subscribers', 'categorySection'];
const PREFIX = 'jp:';
const LOCK_KEY = `${PREFIX}lock`;
const LOCK_TTL_MS = 20000;   // a crashed request can't hold the lock longer than this
const LOCK_WAIT_MS = 15000;  // give up (503) after waiting this long

let redis = null;
function client() {
  if (!redis) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN, automaticDeserialization: false });
  }
  return redis;
}

const als = new AsyncLocalStorage();
const ctxOrThrow = () => {
  const ctx = als.getStore();
  if (!ctx) throw new Error('db used outside a request (Redis mode)');
  return ctx;
};
const clone = v => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

async function loadAll(ctx) {
  const values = await client().mget(...COLLECTIONS.map(c => PREFIX + c));
  ctx.data = new Map();
  COLLECTIONS.forEach((c, i) => ctx.data.set(c, values[i] == null ? undefined : JSON.parse(values[i])));
}

async function acquireLock() {
  const token = crypto.randomBytes(12).toString('hex');
  const started = Date.now();
  for (let wait = 40; Date.now() - started < LOCK_WAIT_MS; wait = Math.min(wait * 1.5, 400)) {
    if (await client().set(LOCK_KEY, token, { nx: true, px: LOCK_TTL_MS })) return token;
    await new Promise(r => setTimeout(r, wait));
  }
  throw Object.assign(new Error('The store is busy right now. Please try again in a moment.'), { status: 503 });
}

// Delete the lock only if we still own it
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
async function releaseLock(ctx) {
  const token = ctx.lockToken;
  if (!token) return;
  ctx.lockToken = null;
  try { await client().eval(RELEASE_LUA, [LOCK_KEY], [token]); } catch { /* expires on its own */ }
}

async function flush(ctx) {
  if (!ctx.dirty.size) return;
  if (!ctx.lockToken) throw new Error('db.write in a request without the write lock');
  const pipe = client().pipeline();
  for (const name of ctx.dirty) pipe.set(PREFIX + name, JSON.stringify(ctx.data.get(name)));
  await pipe.exec();
  ctx.dirty.clear();
}

/**
 * Express middleware (Redis mode only; a no-op with JSON files).
 * onMissing(): called inside the request context when core collections are missing (first run),
 * e.g. to create the admin account and sample data.
 */
function middleware({ onMissing, core = [] } = {}) {
  return async (req, res, next) => {
    if (!USE_REDIS) return next();
    const ctx = { data: new Map(), dirty: new Set(), lockToken: null, saving: false };
    req.dbContext = ctx;
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    try {
      if (writes) ctx.lockToken = await acquireLock();
      await loadAll(ctx);
      if (onMissing && core.some(c => ctx.data.get(c) === undefined)) {
        if (!ctx.lockToken) { ctx.lockToken = await acquireLock(); await loadAll(ctx); }
        await als.run(ctx, () => onMissing());
        await flush(ctx);
      }
    } catch (err) {
      await releaseLock(ctx);
      return next(err);
    }

    // Save buffered writes right before the response goes out
    const send = res.send.bind(res);
    res.send = body => {
      if (ctx.saving) return send(body);
      ctx.saving = true;
      flush(ctx)
        .then(() => releaseLock(ctx).then(() => send(body)))
        .catch(err => {
          console.error('Saving to Redis failed:', err);
          releaseLock(ctx).finally(() => {
            res.status(500).set('Content-Type', 'application/json');
            send(JSON.stringify({ error: 'Could not save your changes. Please try again.' }));
          });
        });
      return res;
    };
    // Safety net: never keep the lock past the end of the request
    res.on('close', () => { releaseLock(ctx); });

    als.run(ctx, next);
  };
}

// Body parsers such as multer finish on stream events, which lose the request context;
// put this right after them to restore it.
const rebind = (req, res, next) => (USE_REDIS && req.dbContext ? als.run(req.dbContext, next) : next());

/* ---------------- Public API (same for both backends) ---------------- */

function read(name, fallback = []) {
  if (!USE_REDIS) return fileRead(name, fallback);
  const v = ctxOrThrow().data.get(name);
  return v === undefined ? fallback : clone(v);
}

function write(name, data) {
  if (!USE_REDIS) return fileWrite(name, data);
  const ctx = ctxOrThrow();
  ctx.data.set(name, clone(data));
  ctx.dirty.add(name);
}

function exists(name) {
  if (!USE_REDIS) return fs.existsSync(file(name));
  return ctxOrThrow().data.get(name) !== undefined;
}

module.exports = { DATA_DIR, USE_REDIS, COLLECTIONS, PREFIX, read, write, exists, newId, middleware, rebind, client };
