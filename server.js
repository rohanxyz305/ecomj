'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const db = require('./lib/db');
const auth = require('./lib/auth');
const blog = require('./lib/blog');
const pages = require('./lib/pages');
const {
  CATEGORIES, CATEGORY_IMAGES, CATEGORY_SECTION, BADGES, SHIPPING, OFFER_THEMES,
  HIGHLIGHT_OPTIONS, CATEGORY_HIGHLIGHTS, SPEC_FIELDS, seed,
} = require('./lib/seed');

seed();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ORDER_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (status, message) => Object.assign(new Error(message), { status });

// Express 4 doesn't catch rejected promises, so async handlers go through this
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Which status an order may move to next. Cancelling returns the items to stock.
const ORDER_FLOW = {
  Pending: ['Confirmed', 'Shipped', 'Cancelled'],
  Confirmed: ['Shipped', 'Cancelled'],
  Shipped: ['Delivered', 'Cancelled'], // e.g. COD parcel refused and returned
  Delivered: [],
  Cancelled: [],
};

const MAX_PRICE = 10000000; // ₹1 crore
const MAX_STOCK = 100000;

/* ---------------- Rate limiting (in memory, single process) ---------------- */

function limiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.reset < now) hits.delete(key);
  }, windowMs).unref();
  return {
    blocked: key => { const h = hits.get(key); return !!h && h.reset > Date.now() && h.n >= max; },
    hit: key => {
      const now = Date.now();
      let h = hits.get(key);
      if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
      h.n += 1;
    },
    clear: key => hits.delete(key),
  };
}
const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 10 }); // failed logins per IP and per account
const signupLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 5 }); // new accounts per IP per hour
const newsletterLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 5 }); // newsletter signups per IP per hour
const tooMany = () => fail(429, 'Too many attempts. Please wait 15 minutes and try again.');

// Compared against when the email/username doesn't exist, so response time doesn't reveal accounts
const DUMMY_HASH = auth.hashPasswordSync(require('crypto').randomBytes(16).toString('hex'));
const log = (...args) => console.log(new Date().toISOString(), ...args);

app.disable('x-powered-by');
// Behind cPanel/Passenger the proxy connects from loopback; this makes req.ip and req.secure correct
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.json({ limit: '1mb' }));

// CSRF defence: browsers send Origin on cross-site POST/PUT/PATCH/DELETE; reject other sites
const EXTRA_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || EXTRA_ORIGINS.includes(origin)) return next();
  let host = null;
  try { host = new URL(origin).host; } catch { /* invalid origin */ }
  if (host && (host === req.get('host') || host === req.get('x-forwarded-host'))) return next();
  log('Blocked cross-site request', req.method, req.originalUrl, 'from', origin);
  res.status(403).json({ error: 'Request blocked: it did not come from this site' });
});
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] })); // "/admin" serves admin.html

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${db.newId()}${IMAGE_TYPES[file.mimetype]}`), // type checked in fileFilter
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    Object.hasOwn(IMAGE_TYPES, file.mimetype) ? cb(null, true) : cb(fail(400, 'Please upload a JPG, PNG, WEBP, GIF or AVIF image')),
});

// The browser-declared type can be faked, so check the file's first bytes too
function looksLikeImage(filePath, mimetype) {
  const head = Buffer.alloc(32);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, head, 0, 32, 0); } finally { fs.closeSync(fd); }
  const ascii = (from, to) => head.toString('latin1', from, to);
  switch (mimetype) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif': return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/avif': return ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 32));
    default: return false;
  }
}
function checkUploads(files) {
  for (const f of files) {
    if (!looksLikeImage(f.path, f.mimetype)) throw fail(400, `"${String(f.originalname).slice(0, 60)}" is not a valid image file`);
  }
}

function removeUpload(image) {
  if (image && image.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, path.basename(image)), () => {});
}

/* ---------------- Pricing ---------------- */

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const isLive = offer => offer.active && (!offer.endsAt || offer.endsAt >= today());

// Applies the best live offer to each product and adds finalPrice / inStock
function withPricing(products) {
  const offers = db.read('offers').filter(isLive);
  return products.map(p => {
    const best = offers
      .filter(o => o.category === 'All' || o.category === p.category)
      .reduce((top, o) => (!top || o.discount > top.discount ? o : top), null);
    return {
      ...p,
      finalPrice: best ? Math.round(p.price * (1 - best.discount / 100)) : p.price,
      offer: best ? { title: best.title, discount: best.discount } : null,
      inStock: p.available && p.stock > 0,
    };
  });
}

/* ---------------- Sessions ---------------- */

const USER_COOKIE = 'gj_user';
const ADMIN_COOKIE = 'gj_admin';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

// Secure cookies whenever the request came over HTTPS (directly or via the proxy),
// in production, or when forced with COOKIE_SECURE=1
const secureCookie = req => req.secure || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';

function startSession(req, res, cookie, payload, ttl = SESSION_MS) {
  res.cookie(cookie, auth.sign(payload, ttl), { httpOnly: true, sameSite: 'lax', secure: secureCookie(req), maxAge: ttl });
}
function endSession(req, res, cookie) {
  res.clearCookie(cookie, { httpOnly: true, sameSite: 'lax', secure: secureCookie(req) });
}
const readSession = (req, cookie) => auth.verify(auth.parseCookies(req.headers.cookie)[cookie]);
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

function sessionUser(req) {
  const session = readSession(req, USER_COOKIE);
  if (!session || session.role !== 'customer') return null;
  const user = db.read('users').find(u => u.id === session.id);
  return user && (session.sv || 0) === (user.sv || 0) ? user : null;
}

function requireCustomer(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const session = readSession(req, ADMIN_COOKIE);
  const admin = db.read('admin', null);
  // version changes when the password changes, which logs out old sessions
  if (!session || !admin || session.role !== 'admin' || session.v !== admin.version) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  next();
}

/* ---------------- Category section ("Find your sparkle") ---------------- */

// Saved settings merged with the category list, so new categories show up and removed ones drop out.
// tile.image is '' when the tile uses its default photo from CATEGORY_IMAGES.
function categorySection() {
  const saved = db.read('categorySection', {});
  const tiles = (Array.isArray(saved.tiles) ? saved.tiles : [])
    .filter((t, i, all) => CATEGORIES.includes(t.category) && all.findIndex(x => x.category === t.category) === i);
  for (const category of CATEGORIES) {
    if (!tiles.some(t => t.category === category)) tiles.push({ category, label: '', image: '', visible: true });
  }
  return { ...CATEGORY_SECTION, ...saved, tiles };
}

/* ---------------- Public store API ---------------- */

app.get('/api/config', (req, res) => {
  res.json({
    categories: CATEGORIES, categoryImages: CATEGORY_IMAGES, categorySection: categorySection(),
    badges: BADGES, offerThemes: OFFER_THEMES,
    orderStatuses: ORDER_STATUSES, orderFlow: ORDER_FLOW, shipping: SHIPPING, business: pages.publicBusiness(),
    highlightOptions: HIGHLIGHT_OPTIONS, categoryHighlights: CATEGORY_HIGHLIGHTS, specFields: SPEC_FIELDS,
  });
});

app.get('/api/products', (req, res) => res.json({ products: withPricing(db.read('products')) }));

app.get('/api/offers', (req, res) => res.json({ offers: db.read('offers').filter(isLive) }));

/* ---------------- Customer accounts ---------------- */

app.post('/api/auth/signup', wrap(async (req, res) => {
  const ipKey = `signup:${req.ip}`;
  if (signupLimiter.blocked(ipKey)) throw fail(429, 'Too many new accounts from this network. Please try again later.');
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw fail(400, 'Please enter your full name');
  if (!EMAIL_RE.test(email)) throw fail(400, 'Please enter a valid email address');
  if (password.length < 6) throw fail(400, 'Password must be at least 6 characters');
  if (password.length > auth.MAX_PASSWORD) throw fail(400, `Password must be at most ${auth.MAX_PASSWORD} characters`);

  const hash = await auth.hashPassword(password);
  // Read after the (async) hash so a parallel signup can't slip in between check and write
  const users = db.read('users');
  if (users.some(u => u.email === email)) throw fail(409, 'An account with this email already exists. Please sign in.');
  const user = { id: db.newId(), name, email, password: hash, sv: 0, createdAt: new Date().toISOString() };
  users.push(user);
  db.write('users', users);
  signupLimiter.hit(ipKey);

  startSession(req, res, USER_COOKIE, { id: user.id, role: 'customer', sv: 0 });
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
  const ipKey = `login:${req.ip}`;
  const acctKey = `login:${email}`;
  if (loginLimiter.blocked(ipKey) || loginLimiter.blocked(acctKey)) throw tooMany();

  const found = db.read('users').find(u => u.email === email);
  // Always run the hash, even for unknown emails, so timing doesn't reveal who has an account
  const ok = await auth.verifyPassword(String(req.body.password || ''), found ? found.password : DUMMY_HASH);
  if (!found || !ok) {
    loginLimiter.hit(ipKey);
    loginLimiter.hit(acctKey);
    throw fail(401, 'Incorrect email or password');
  }
  loginLimiter.clear(acctKey);
  const user = db.read('users').find(u => u.id === found.id) || found;
  startSession(req, res, USER_COOKIE, { id: user.id, role: 'customer', sv: user.sv || 0 });
  res.json({ user: publicUser(user) });
}));

// Logging out bumps the session version, so a copied cookie stops working too
app.post('/api/auth/logout', (req, res) => {
  const user = sessionUser(req);
  if (user) {
    const users = db.read('users');
    const u = users.find(x => x.id === user.id);
    if (u) { u.sv = (u.sv || 0) + 1; db.write('users', users); }
  }
  endSession(req, res, USER_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = sessionUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

/* ---------------- Customer orders ---------------- */

app.post('/api/orders', requireCustomer, (req, res) => {
  const a = req.body.address || {};
  const address = {
    name: String(a.name || '').trim().slice(0, 60),
    phone: String(a.phone || '').replace(/\D/g, ''),
    line: String(a.line || '').trim().slice(0, 200),
    city: String(a.city || '').trim().slice(0, 60),
    pincode: String(a.pincode || '').trim(),
  };
  if (!address.name || !address.line || !address.city) throw fail(400, 'Please complete your delivery address');
  if (!/^\d{10}$/.test(address.phone)) throw fail(400, 'Please enter a valid 10-digit phone number');
  if (!/^\d{6}$/.test(address.pincode)) throw fail(400, 'Please enter a valid 6-digit pincode');

  // Merge duplicate lines and clamp quantities
  const wanted = new Map();
  for (const item of Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : []) {
    if (!item || typeof item.id !== 'string') throw fail(400, 'Your bag has an invalid item. Please refresh the page.');
    const qty = Math.min(10, Math.max(1, parseInt(item.qty, 10) || 1));
    wanted.set(item.id, Math.min(10, (wanted.get(item.id) || 0) + qty));
  }
  if (!wanted.size) throw fail(400, 'Your bag is empty');

  const products = db.read('products');
  const priced = new Map(withPricing(products).map(p => [p.id, p]));
  const items = [];
  for (const [id, qty] of wanted) {
    const p = priced.get(id);
    if (!p) throw fail(409, 'An item in your bag is no longer sold. Please remove it and try again.');
    if (!p.inStock) throw fail(409, `${p.name} is sold out. Please remove it from your bag.`);
    if (p.stock < qty) throw fail(409, `Only ${p.stock} left of ${p.name}. Please reduce the quantity.`);
    items.push({ id, name: p.name, category: p.category, image: p.image, price: p.finalPrice, qty });
  }

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping = subtotal >= SHIPPING.freeShippingAbove ? 0 : SHIPPING.shippingFee;
  const order = {
    id: `JP${Date.now().toString(36).toUpperCase()}${db.newId().slice(0, 4).toUpperCase()}`, // random part: no collisions, not guessable
    userId: req.user.id,
    customer: publicUser(req.user),
    items, address, subtotal, shipping, total: subtotal + shipping,
    payment: 'Cash on Delivery',
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };
  // Save the order first: if the stock write then fails, the admin still sees the order
  // (and can fix stock), instead of stock silently vanishing with no order.
  const orders = db.read('orders');
  orders.unshift(order);
  db.write('orders', orders);
  for (const item of items) products.find(p => p.id === item.id).stock -= item.qty;
  db.write('products', products);
  res.status(201).json({ order });
});

app.get('/api/orders/mine', requireCustomer, (req, res) => {
  res.json({ orders: db.read('orders').filter(o => o.userId === req.user.id) });
});

/* ---------------- Admin: auth ---------------- */

const DEFAULT_ADMIN_PASSWORD = 'admin@123';
let adminUsesDefaultPassword = auth.verifyPasswordSync(DEFAULT_ADMIN_PASSWORD, db.read('admin', null)?.password);
if (adminUsesDefaultPassword) {
  console.warn('\n  WARNING: the admin password is still the default "admin@123".');
  console.warn('  Anyone can log in to /admin. Change it now in Admin > Settings.\n');
}

app.post('/api/admin/login', wrap(async (req, res) => {
  const ipKey = `admin-login:${req.ip}`;
  if (loginLimiter.blocked(ipKey)) throw tooMany();
  const admin = db.read('admin', null);
  const username = String(req.body.username || '').trim();
  const pwOk = await auth.verifyPassword(String(req.body.password || ''), admin.password);
  if (!(username === admin.username && pwOk)) {
    loginLimiter.hit(ipKey);
    log('Failed admin login from', req.ip);
    throw fail(401, 'Incorrect username or password');
  }
  loginLimiter.clear(ipKey);
  log('Admin logged in from', req.ip);
  startSession(req, res, ADMIN_COOKIE, { role: 'admin', v: admin.version }, ADMIN_SESSION_MS);
  res.json({ username: admin.username });
}));

// Logging out ends every admin session (there is one admin account), so a copied cookie stops working
app.post('/api/admin/logout', (req, res) => {
  const session = readSession(req, ADMIN_COOKIE);
  const admin = db.read('admin', null);
  if (session && admin && session.role === 'admin' && session.v === admin.version) {
    admin.version += 1;
    db.write('admin', admin);
    log('Admin logged out from', req.ip);
  }
  endSession(req, res, ADMIN_COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: db.read('admin', null).username, defaultPassword: adminUsesDefaultPassword });
});

app.post('/api/admin/password', requireAdmin, wrap(async (req, res) => {
  const ipKey = `admin-pw:${req.ip}`;
  if (loginLimiter.blocked(ipKey)) throw tooMany();
  const admin = db.read('admin', null);
  if (!(await auth.verifyPassword(String(req.body.current || ''), admin.password))) {
    loginLimiter.hit(ipKey);
    throw fail(400, 'Current password is incorrect');
  }
  const next = String(req.body.next || '');
  if (next.length < 8) throw fail(400, 'New password must be at least 8 characters');
  if (next.length > auth.MAX_PASSWORD) throw fail(400, `New password must be at most ${auth.MAX_PASSWORD} characters`);
  if (next === DEFAULT_ADMIN_PASSWORD) throw fail(400, 'Please choose a password other than the default one');
  const hash = await auth.hashPassword(next);
  const fresh = db.read('admin', null);
  fresh.password = hash;
  fresh.version += 1;
  db.write('admin', fresh);
  adminUsesDefaultPassword = false;
  log('Admin password changed from', req.ip);
  startSession(req, res, ADMIN_COOKIE, { role: 'admin', v: fresh.version }, ADMIN_SESSION_MS);
  res.json({ ok: true });
}));

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const products = db.read('products');
  const orders = db.read('orders');
  res.json({
    products: products.length,
    outOfStock: products.filter(p => !p.available || p.stock <= 0).length,
    lowStock: products.filter(p => p.available && p.stock > 0 && p.stock <= 5).length,
    liveOffers: db.read('offers').filter(isLive).length,
    customers: db.read('users').length,
    orders: orders.length,
    pendingOrders: orders.filter(o => o.status === 'Pending').length,
    // Confirmed, shipped and delivered orders; Pending and Cancelled aren't counted yet
    revenue: orders.filter(o => !['Pending', 'Cancelled'].includes(o.status)).reduce((sum, o) => sum + o.total, 0),
  });
});

/* ---------------- Admin: products ---------------- */

const ALL_HIGHLIGHTS = Object.values(HIGHLIGHT_OPTIONS).flat();
const MAX_HIGHLIGHTS = 6;

// Form posts send each ticked highlight as a repeated "highlights" field and specs as spec_<key>
function readHighlights(body) {
  const picked = [].concat(body.highlights || []).map(String);
  return [...new Set(picked)].filter(h => ALL_HIGHLIGHTS.includes(h)).slice(0, MAX_HIGHLIGHTS);
}

function readSpecs(body) {
  const specs = {};
  for (const key of Object.keys(SPEC_FIELDS)) {
    const value = String(body[`spec_${key}`] || '').trim().slice(0, 200);
    if (value) specs[key] = value;
  }
  return specs;
}

function readProduct(body) {
  const product = {
    name: String(body.name || '').trim().slice(0, 120),
    category: String(body.category || ''),
    price: Math.round(Number(body.price)),
    mrp: Math.round(Number(body.mrp) || 0),
    stock: Math.min(MAX_STOCK, Math.max(0, parseInt(body.stock, 10) || 0)),
    available: String(body.available) === 'true',
    badge: BADGES.includes(body.badge) ? body.badge : '',
    description: String(body.description || '').trim().slice(0, 1000),
    highlights: readHighlights(body),
    specs: readSpecs(body),
  };
  if (!product.name) throw fail(400, 'Product name is required');
  if (!CATEGORIES.includes(product.category)) throw fail(400, 'Please choose a valid category');
  if (!(product.price > 0 && product.price <= MAX_PRICE)) throw fail(400, 'Selling price must be between ₹1 and ₹1,00,00,000');
  if (!Number.isFinite(product.mrp) || product.mrp > MAX_PRICE || product.mrp < product.price) product.mrp = product.price;
  return product;
}

// Uploaded file wins, then a pasted URL, then "remove", otherwise keep the current image
function resolveImage(req, current = '') {
  if (req.file) return `/uploads/${req.file.filename}`;
  const url = String(req.body.imageUrl || '').trim();
  if (url) {
    if (!/^https?:\/\//i.test(url)) throw fail(400, 'Image URL must start with http:// or https://');
    return url;
  }
  return req.body.removeImage === 'true' ? '' : current;
}

app.get('/api/admin/products', requireAdmin, (req, res) => res.json({ products: withPricing(db.read('products')) }));

app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  try {
    checkUploads(req.file ? [req.file] : []);
    const products = db.read('products');
    const product = { id: db.newId(), ...readProduct(req.body), image: resolveImage(req), createdAt: new Date().toISOString() };
    products.unshift(product);
    db.write('products', products);
    res.status(201).json({ product });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw err;
  }
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  try {
    const products = db.read('products');
    const i = products.findIndex(p => p.id === req.params.id);
    if (i < 0) throw fail(404, 'Product not found');
    checkUploads(req.file ? [req.file] : []);
    const old = products[i];
    const fields = readProduct(req.body);
    // The form sends the stock it was opened with. If the admin didn't change it, keep the live
    // value (orders may have sold some meanwhile). If both changed, ask them to check again.
    if ('stockWas' in req.body) {
      const was = parseInt(req.body.stockWas, 10);
      if (fields.stock === was) fields.stock = old.stock;
      else if (was !== old.stock) {
        throw fail(409, `Stock changed to ${old.stock} while you were editing (orders came in). Check the stock and save again.`);
      }
    }
    const image = resolveImage(req, old.image);
    products[i] = { ...old, ...fields, image, updatedAt: new Date().toISOString() };
    db.write('products', products);
    if (image !== old.image) removeUpload(old.image);
    res.json({ product: products[i] });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw err;
  }
});

// Quick availability / stock update from the products table
app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = db.read('products');
  const product = products.find(p => p.id === req.params.id);
  if (!product) throw fail(404, 'Product not found');
  if ('available' in req.body) product.available = req.body.available === true;
  if ('stock' in req.body) product.stock = Math.min(MAX_STOCK, Math.max(0, parseInt(req.body.stock, 10) || 0));
  db.write('products', products);
  res.json({ product });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = db.read('products');
  const product = products.find(p => p.id === req.params.id);
  if (!product) throw fail(404, 'Product not found');
  db.write('products', products.filter(p => p.id !== product.id));
  removeUpload(product.image);
  res.json({ ok: true });
});

/* ---------------- Admin: offers ---------------- */

// YYYY-MM-DD that is a real calendar date (rejects 2026-02-31, 2026-99-99)
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function readOffer(body) {
  const offer = {
    title: String(body.title || '').trim().slice(0, 80),
    subtitle: String(body.subtitle || '').trim().slice(0, 160),
    discount: Math.round(Number(body.discount)),
    category: String(body.category || 'All'),
    theme: Object.hasOwn(OFFER_THEMES, body.theme) ? body.theme : 'rose',
    endsAt: validDate(body.endsAt) ? body.endsAt : '',
    active: body.active !== false,
  };
  if (!offer.title) throw fail(400, 'Offer title is required');
  if (!(offer.discount >= 1 && offer.discount <= 90)) throw fail(400, 'Discount must be between 1% and 90%');
  if (offer.category !== 'All' && !CATEGORIES.includes(offer.category)) throw fail(400, 'Please choose a valid category');
  return offer;
}

app.get('/api/admin/offers', requireAdmin, (req, res) => {
  res.json({ offers: db.read('offers').map(o => ({ ...o, live: isLive(o) })) });
});

app.post('/api/admin/offers', requireAdmin, (req, res) => {
  const offers = db.read('offers');
  const offer = { id: db.newId(), ...readOffer(req.body) };
  offers.unshift(offer);
  db.write('offers', offers);
  res.status(201).json({ offer });
});

app.put('/api/admin/offers/:id', requireAdmin, (req, res) => {
  const offers = db.read('offers');
  const i = offers.findIndex(o => o.id === req.params.id);
  if (i < 0) throw fail(404, 'Offer not found');
  offers[i] = { id: offers[i].id, ...readOffer(req.body) };
  db.write('offers', offers);
  res.json({ offer: offers[i] });
});

app.delete('/api/admin/offers/:id', requireAdmin, (req, res) => {
  const offers = db.read('offers');
  if (!offers.some(o => o.id === req.params.id)) throw fail(404, 'Offer not found');
  db.write('offers', offers.filter(o => o.id !== req.params.id));
  res.json({ ok: true });
});

/* ---------------- Admin: homepage category section ---------------- */

// One optional photo per category, sent as photo_<index in CATEGORIES>
const sectionPhotos = upload.fields(CATEGORIES.map((c, i) => ({ name: `photo_${i}`, maxCount: 1 })));

app.get('/api/admin/category-section', requireAdmin, (req, res) => res.json({ section: categorySection() }));

app.put('/api/admin/category-section', requireAdmin, sectionPhotos, (req, res) => {
  const files = Object.values(req.files || {}).flat();
  try {
    checkUploads(files);
    let sent;
    try { sent = JSON.parse(req.body.tiles || '[]'); } catch { sent = null; }
    if (!Array.isArray(sent)) throw fail(400, 'Invalid category list');

    const current = categorySection();
    const tiles = [];
    for (const t of sent) {
      const old = current.tiles.find(x => x.category === t?.category);
      if (!old || tiles.some(x => x.category === old.category)) continue;
      const file = req.files?.[`photo_${CATEGORIES.indexOf(old.category)}`]?.[0];
      tiles.push({
        category: old.category,
        label: String(t.label || '').trim().slice(0, 40),
        // New photo wins, then "use default photo", otherwise keep the current one
        image: file ? `/uploads/${file.filename}` : t.reset === true ? '' : old.image,
        visible: t.visible !== false,
      });
    }
    // Categories missing from the request keep their settings, at the end
    for (const old of current.tiles) if (!tiles.some(t => t.category === old.category)) tiles.push(old);

    const section = {
      eyebrow: String(req.body.eyebrow || '').trim().slice(0, 60),
      title: String(req.body.title || '').trim().slice(0, 60),
      highlight: String(req.body.highlight || '').trim().slice(0, 40),
      tiles,
    };
    if (!section.title && !section.highlight) throw fail(400, 'Please enter a heading');
    db.write('categorySection', section);

    // Delete replaced photos, and any upload that didn't match a category
    const kept = new Set(tiles.map(t => t.image));
    for (const old of current.tiles) if (!kept.has(old.image)) removeUpload(old.image);
    for (const f of files) if (!kept.has(`/uploads/${f.filename}`)) removeUpload(`/uploads/${f.filename}`);
    res.json({ section: categorySection() });
  } catch (err) {
    files.forEach(f => removeUpload(`/uploads/${f.filename}`));
    throw err;
  }
});

/* ---------------- Admin: orders ---------------- */

app.get('/api/admin/orders', requireAdmin, (req, res) => res.json({ orders: db.read('orders') }));

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const status = req.body.status;
  if (!ORDER_STATUSES.includes(status)) throw fail(400, 'Invalid status');
  const orders = db.read('orders');
  const order = orders.find(o => o.id === req.params.id);
  if (!order) throw fail(404, 'Order not found');
  if (status !== order.status && !ORDER_FLOW[order.status]?.includes(status)) {
    throw fail(400, `An order that is ${order.status} can't be changed to ${status}`);
  }
  if (status !== order.status) log(`Order ${order.id}: ${order.status} -> ${status}`);

  // Cancelling puts the items back in stock
  if (status === 'Cancelled' && order.status !== 'Cancelled') {
    const products = db.read('products');
    for (const item of order.items) {
      const p = products.find(x => x.id === item.id);
      if (p) p.stock += item.qty;
    }
    db.write('products', products);
  }
  order.status = status;
  db.write('orders', orders);
  res.json({ order });
});

/* ---------------- Information pages (About, Contact, Privacy, Terms, FAQ) ---------------- */

for (const [route, key] of Object.entries(pages.ROUTES)) {
  app.get(route, (req, res) => res.type('html').send(pages.renderPage(key, `${req.protocol}://${req.get('host')}`)));
}

app.get('/api/admin/pages', requireAdmin, (req, res) => {
  res.json({ pages: pages.allPages(), business: pages.business(), tokens: pages.TOKEN_HELP });
});

app.put('/api/admin/pages/:key', requireAdmin, (req, res) => {
  if (!pages.getPage(req.params.key)) throw fail(404, 'Page not found');
  const page = pages.savePage(req.params.key, pages.readPage(req.body, fail));
  log(`Page edited: ${page.path}`);
  res.json({ page });
});

// "Reset to default" removes the saved text so the built-in version is shown again
app.delete('/api/admin/pages/:key', requireAdmin, (req, res) => {
  if (!pages.getPage(req.params.key)) throw fail(404, 'Page not found');
  const page = pages.resetPage(req.params.key);
  log(`Page reset to default: ${page.path}`);
  res.json({ page });
});

app.put('/api/admin/business', requireAdmin, (req, res) => {
  const business = pages.saveBusiness(pages.readBusiness(req.body, fail));
  log('Store details updated');
  res.json({ business });
});

/* ---------------- Newsletter ---------------- */

app.post('/api/newsletter', (req, res) => {
  // Hidden "website" field: real people leave it empty, bots fill it in
  if (String(req.body.website || '').trim()) return res.status(201).json({ ok: true });
  const ipKey = `newsletter:${req.ip}`;
  if (newsletterLimiter.blocked(ipKey)) throw fail(429, 'Too many signups from this network. Please try again later.');
  const email = String(req.body.email || '').trim().toLowerCase();
  if (email.length > 200 || !EMAIL_RE.test(email)) throw fail(400, 'Please enter a valid email address');
  newsletterLimiter.hit(ipKey);
  const subs = db.read('subscribers');
  // Same reply whether or not the email was already on the list, so the form can't be used to check who subscribed
  if (!subs.some(s => s.email === email)) {
    subs.unshift({ id: db.newId(), email, source: String(req.body.source || '').slice(0, 80), createdAt: new Date().toISOString() });
    db.write('subscribers', subs);
    log('Newsletter signup');
  }
  res.status(201).json({ ok: true });
});

app.get('/api/admin/subscribers', requireAdmin, (req, res) => res.json({ subscribers: db.read('subscribers') }));

// Spreadsheet-safe CSV (cells starting with = + - @ are prefixed so Excel doesn't run them as formulas)
app.get('/api/admin/subscribers.csv', requireAdmin, (req, res) => {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['email', 'signed_up', 'source'], ...db.read('subscribers').map(s => [s.email, s.createdAt, s.source])];
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="newsletter-subscribers-${today()}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.send(`\uFEFF${rows.map(r => r.map(cell).join(',')).join('\r\n')}\r\n`);
});

app.delete('/api/admin/subscribers/:id', requireAdmin, (req, res) => {
  const subs = db.read('subscribers');
  if (!subs.some(s => s.id === req.params.id)) throw fail(404, 'Subscriber not found');
  db.write('subscribers', subs.filter(s => s.id !== req.params.id));
  log('Newsletter subscriber removed');
  res.json({ ok: true });
});

/* ---------------- Blog ---------------- */

const siteOrigin = req => `${req.protocol}://${req.get('host')}`;
const byNewest = (a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt));

function isAdminRequest(req) {
  const session = readSession(req, ADMIN_COOKIE);
  const admin = db.read('admin', null);
  return !!(session && admin && session.role === 'admin' && session.v === admin.version);
}

// Unique slug: "my-post", then "my-post-2", "my-post-3"… (ignoring the post being edited)
function uniqueSlug(base, posts, selfId) {
  const root = base || `post-${db.newId().slice(0, 6)}`;
  let slug = root;
  for (let n = 2; posts.some(p => p.slug === slug && p.id !== selfId); n++) slug = `${root}-${n}`;
  return slug;
}

function readPost(body) {
  const post = {
    title: String(body.title || '').trim().slice(0, blog.LIMITS.title),
    metaDescription: String(body.metaDescription || '').replace(/\s+/g, ' ').trim(),
    content: String(body.content || '').replace(/\r\n?/g, '\n').trim(),
    published: String(body.published) === 'true',
  };
  if (!post.title) throw fail(400, 'Post title is required');
  if (post.metaDescription.length > blog.LIMITS.meta) throw fail(400, `Meta description must be at most ${blog.LIMITS.meta} characters`);
  if (!post.content) throw fail(400, 'Post content is required');
  if (post.content.length > blog.LIMITS.content) throw fail(400, 'Post content is too long (max 50,000 characters)');
  return post;
}

// Public pages (server-rendered for SEO)
app.get('/blog', (req, res) => {
  const posts = db.read('blog').filter(p => p.published).sort(byNewest);
  res.type('html').send(blog.renderIndex(posts, siteOrigin(req)));
});

app.get('/blog/:slug', (req, res) => {
  const posts = db.read('blog');
  const post = posts.find(p => p.slug === req.params.slug);
  const preview = !!post && !post.published && isAdminRequest(req);
  if (!post || (!post.published && !preview)) return res.status(404).type('html').send(blog.renderNotFound(siteOrigin(req)));
  if (preview) res.set('Cache-Control', 'no-store');
  const related = posts.filter(p => p.published && p.id !== post.id).sort(byNewest).slice(0, 3);
  res.type('html').send(blog.renderPost(post, siteOrigin(req), { preview, related }));
});

// Admin API
app.get('/api/admin/blog', requireAdmin, (req, res) => res.json({ posts: db.read('blog').sort(byNewest) }));

app.post('/api/admin/blog', requireAdmin, upload.single('image'), (req, res) => {
  try {
    checkUploads(req.file ? [req.file] : []);
    const posts = db.read('blog');
    const fields = readPost(req.body);
    const now = new Date().toISOString();
    const id = db.newId();
    const post = {
      id, ...fields,
      slug: uniqueSlug(blog.slugify(req.body.slug || fields.title), posts, id),
      image: resolveImage(req),
      createdAt: now, updatedAt: now, publishedAt: fields.published ? now : null,
    };
    posts.unshift(post);
    db.write('blog', posts);
    log(`Blog post created: ${post.slug}${post.published ? ' (published)' : ' (draft)'}`);
    res.status(201).json({ post });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw err;
  }
});

app.put('/api/admin/blog/:id', requireAdmin, upload.single('image'), (req, res) => {
  try {
    checkUploads(req.file ? [req.file] : []);
    const posts = db.read('blog');
    const i = posts.findIndex(p => p.id === req.params.id);
    if (i < 0) throw fail(404, 'Post not found');
    const old = posts[i];
    const fields = readPost(req.body);
    const wanted = blog.slugify(req.body.slug || '') || old.slug;
    const image = resolveImage(req, old.image);
    posts[i] = {
      ...old, ...fields, image,
      slug: uniqueSlug(wanted, posts, old.id),
      updatedAt: new Date().toISOString(),
      // first publish sets the date; unpublishing and re-publishing keeps it
      publishedAt: fields.published ? (old.publishedAt || new Date().toISOString()) : old.publishedAt,
    };
    db.write('blog', posts);
    if (image !== old.image) removeUpload(old.image);
    res.json({ post: posts[i] });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw err;
  }
});

// Photos inside a post's content: upload, then the editor inserts ![alt](url)
app.post('/api/admin/blog/upload-image', requireAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) throw fail(400, 'Please choose an image');
    checkUploads([req.file]);
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    throw err;
  }
});

app.delete('/api/admin/blog/:id', requireAdmin, (req, res) => {
  const posts = db.read('blog');
  const post = posts.find(p => p.id === req.params.id);
  if (!post) throw fail(404, 'Post not found');
  db.write('blog', posts.filter(p => p.id !== post.id));
  removeUpload(post.image);
  log(`Blog post deleted: ${post.slug}`);
  res.json({ ok: true });
});

/* ---------------- Errors ---------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 5 MB' : err.message;
  }
  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong. Please try again.';
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`  Jpara Jewels store  -> http://localhost:${PORT}`);
  console.log(`  Admin panel           -> http://localhost:${PORT}/admin`);
});
