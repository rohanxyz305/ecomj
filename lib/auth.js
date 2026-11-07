// Password hashing (scrypt) and signed session tokens (HMAC) using only Node's crypto
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { DATA_DIR } = require('./db');

const scrypt = promisify(crypto.scrypt);
const MAX_PASSWORD = 200; // longer inputs are rejected before hashing

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const secretFile = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();

// Async versions run on the thread pool, so a burst of logins can't freeze the store
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(String(password), salt, 64)).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  password = String(password);
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash || password.length > MAX_PASSWORD) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Used once at startup (seeding) where blocking doesn't matter
function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
function verifyPasswordSync(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const hmac = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function sign(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  // Compare byte lengths (not string lengths): non-ASCII input would otherwise make timingSafeEqual throw
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch { /* ignore malformed cookie */ }
    }
  }
  return cookies;
}

module.exports = {
  MAX_PASSWORD, hashPassword, verifyPassword, hashPasswordSync, verifyPasswordSync, sign, verify, parseCookies,
};
