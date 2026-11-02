// Password hashing (scrypt) and signed session tokens (HMAC) using only Node's crypto
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const secretFile = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret);
  return secret;
}
const SECRET = loadSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const hmac = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function sign(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
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

module.exports = { hashPassword, verifyPassword, sign, verify, parseCookies };
