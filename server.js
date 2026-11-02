'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const db = require('./lib/db');
const auth = require('./lib/auth');
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

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] })); // "/admin" serves admin.html

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${db.newId()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(fail(400, 'Please upload a JPG, PNG, WEBP, GIF or AVIF image')),
});

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

function startSession(res, cookie, payload) {
  res.cookie(cookie, auth.sign(payload, SESSION_MS), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MS,
  });
}
const readSession = (req, cookie) => auth.verify(auth.parseCookies(req.headers.cookie)[cookie]);
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

function requireCustomer(req, res, next) {
  const session = readSession(req, USER_COOKIE);
  const user = session && db.read('users').find(u => u.id === session.id);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const session = readSession(req, ADMIN_COOKIE);
  const admin = db.read('admin', null);
  // version changes when the password changes, which logs out old sessions
  if (!session || session.role !== 'admin' || session.v !== admin.version) {
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
    orderStatuses: ORDER_STATUSES, shipping: SHIPPING,
    highlightOptions: HIGHLIGHT_OPTIONS, categoryHighlights: CATEGORY_HIGHLIGHTS, specFields: SPEC_FIELDS,
  });
});

app.get('/api/products', (req, res) => res.json({ products: withPricing(db.read('products')) }));

app.get('/api/offers', (req, res) => res.json({ offers: db.read('offers').filter(isLive) }));

/* ---------------- Customer accounts ---------------- */

app.post('/api/auth/signup', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw fail(400, 'Please enter your full name');
  if (!EMAIL_RE.test(email)) throw fail(400, 'Please enter a valid email address');
  if (password.length < 6) throw fail(400, 'Password must be at least 6 characters');

  const users = db.read('users');
  if (users.some(u => u.email === email)) throw fail(409, 'An account with this email already exists. Please sign in.');
  const user = { id: db.newId(), name, email, password: auth.hashPassword(password), createdAt: new Date().toISOString() };
  users.push(user);
  db.write('users', users);

  startSession(res, USER_COOKIE, { id: user.id, role: 'customer' });
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.read('users').find(u => u.email === email);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password)) {
    throw fail(401, 'Incorrect email or password');
  }
  startSession(res, USER_COOKIE, { id: user.id, role: 'customer' });
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(USER_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req, USER_COOKIE);
  const user = session && db.read('users').find(u => u.id === session.id);
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
  for (const item of Array.isArray(req.body.items) ? req.body.items : []) {
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

  for (const item of items) products.find(p => p.id === item.id).stock -= item.qty;
  db.write('products', products);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping = subtotal >= SHIPPING.freeShippingAbove ? 0 : SHIPPING.shippingFee;
  const order = {
    id: `GJ${Date.now().toString(36).toUpperCase()}`,
    userId: req.user.id,
    customer: publicUser(req.user),
    items, address, subtotal, shipping, total: subtotal + shipping,
    payment: 'Cash on Delivery',
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };
  const orders = db.read('orders');
  orders.unshift(order);
  db.write('orders', orders);
  res.status(201).json({ order });
});

app.get('/api/orders/mine', requireCustomer, (req, res) => {
  res.json({ orders: db.read('orders').filter(o => o.userId === req.user.id) });
});

/* ---------------- Admin: auth ---------------- */

app.post('/api/admin/login', (req, res) => {
  const admin = db.read('admin', null);
  const ok = String(req.body.username || '').trim() === admin.username
    && auth.verifyPassword(String(req.body.password || ''), admin.password);
  if (!ok) throw fail(401, 'Incorrect username or password');
  startSession(res, ADMIN_COOKIE, { role: 'admin', v: admin.version });
  res.json({ username: admin.username });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: db.read('admin', null).username }));

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const admin = db.read('admin', null);
  if (!auth.verifyPassword(String(req.body.current || ''), admin.password)) throw fail(400, 'Current password is incorrect');
  const next = String(req.body.next || '');
  if (next.length < 8) throw fail(400, 'New password must be at least 8 characters');
  admin.password = auth.hashPassword(next);
  admin.version += 1;
  db.write('admin', admin);
  startSession(res, ADMIN_COOKIE, { role: 'admin', v: admin.version });
  res.json({ ok: true });
});

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
    revenue: orders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + o.total, 0),
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
    stock: Math.max(0, parseInt(body.stock, 10) || 0),
    available: String(body.available) === 'true',
    badge: BADGES.includes(body.badge) ? body.badge : '',
    description: String(body.description || '').trim().slice(0, 1000),
    highlights: readHighlights(body),
    specs: readSpecs(body),
  };
  if (!product.name) throw fail(400, 'Product name is required');
  if (!CATEGORIES.includes(product.category)) throw fail(400, 'Please choose a valid category');
  if (!(product.price > 0)) throw fail(400, 'Selling price must be greater than 0');
  if (product.mrp < product.price) product.mrp = product.price;
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
    const old = products[i];
    const image = resolveImage(req, old.image);
    products[i] = { ...old, ...readProduct(req.body), image, updatedAt: new Date().toISOString() };
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
  if ('stock' in req.body) product.stock = Math.max(0, parseInt(req.body.stock, 10) || 0);
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

function readOffer(body) {
  const offer = {
    title: String(body.title || '').trim().slice(0, 80),
    subtitle: String(body.subtitle || '').trim().slice(0, 160),
    discount: Math.round(Number(body.discount)),
    category: String(body.category || 'All'),
    theme: OFFER_THEMES[body.theme] ? body.theme : 'rose',
    endsAt: /^\d{4}-\d{2}-\d{2}$/.test(body.endsAt || '') ? body.endsAt : '',
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
  if (order.status === 'Cancelled' && status !== 'Cancelled') throw fail(400, 'Cancelled orders cannot be reopened');

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
  console.log(`  Glamora Jewels store  -> http://localhost:${PORT}`);
  console.log(`  Admin panel           -> http://localhost:${PORT}/admin`);
});
