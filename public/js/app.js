'use strict';
/* ==========================================================
   Jpara Jewels: storefront logic
   ========================================================== */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = n => `₹${Number(n).toLocaleString('en-IN')}`;
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

const ICON = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const state = {
  config: null,
  products: [],
  offers: [],
  user: null,
  cart: store.get('gj_cart', []),   // [{ id, qty }]
  wish: store.get('gj_wish', []),   // [id]
  filter: { category: 'All', q: '', sort: 'featured', inStock: false },
  drawer: 'cart',                   // cart | wish | checkout | done
  lastOrder: null,
  afterLogin: null,
};

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const imgOf = p => p.image || JewelArt.url(p.category, p.id);

/* ---------------- Highlights & specs ---------------- */

// One small icon per highlight group (material, stone, skin, durability, fit, occasion)
const HIGHLIGHT_ICONS = {
  material: '<svg viewBox="0 0 24 24"><path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 18 3-18"/></svg>',
  stone: '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/></svg>',
  skin: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/></svg>',
  durability: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>',
  occasion: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z"/></svg>',
};

// Product's own highlights, or category defaults so nothing is ever empty
function highlightsOf(p) {
  if (Array.isArray(p.highlights) && p.highlights.length) return p.highlights;
  return state.config.categoryHighlights?.[p.category] || ['Skin Friendly', 'Anti-Tarnish'];
}

function highlightIcon(label) {
  const groups = state.config.highlightOptions || {};
  const group = Object.keys(groups).find(g => groups[g].includes(label));
  return HIGHLIGHT_ICONS[group] || '<span class="hl-spark">✦</span>';
}

function specRows(p) {
  const fields = state.config.specFields || {};
  return Object.entries(fields)
    .filter(([key]) => p.specs?.[key])
    .map(([key, label]) => `<tr><th>${esc(label)}</th><td>${esc(p.specs[key])}</td></tr>`)
    .join('');
}
const byId = id => state.products.find(p => p.id === id);
const discountPct = p => (p.mrp > p.finalPrice ? Math.round((1 - p.finalPrice / p.mrp) * 100) : 0);

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------------- Modals / drawer ---------------- */

let lastFocus = null;
function open(el) {
  if (!$('.modal.open, .drawer.open')) lastFocus = document.activeElement;
  el.classList.add('open');
  document.body.classList.add('locked');
  // Move focus inside after the content has rendered
  requestAnimationFrame(() => {
    if (!el.contains(document.activeElement)) el.querySelector('.modal-card button, .drawer-panel button, input, a[href]')?.focus();
  });
}
function close(el) {
  if (!el) return;
  el.classList.remove('open');
  if (el.id === 'authModal') state.afterLogin = null;
  if (!$('.modal.open, .drawer.open')) {
    document.body.classList.remove('locked');
    lastFocus?.focus?.();
    lastFocus = null;
  }
}

/* ---------------- Rendering ---------------- */

function renderTicker() {
  const items = state.offers.map(o =>
    `<span>✦ <b>${o.discount}% OFF</b> ${esc(o.title)}${o.category !== 'All' ? ` on ${esc(o.category)}` : ' sitewide'}</span>`);
  items.push(`<span>✦ <b>FREE SHIPPING</b> on orders above ${rupee(state.config.shipping.freeShippingAbove)}</span>`);
  items.push('<span>✦ <b>CASH ON DELIVERY</b> available across India</span>');
  $('#tickerTrack').innerHTML = items.join('');
}

function renderAuth() {
  const u = state.user;
  if (!u) {
    $('#authArea').innerHTML = `
      <button class="btn btn-ghost btn-sm" data-auth="login">Sign In</button>
      <button class="btn btn-primary btn-sm btn-signup" data-auth="signup">Sign Up</button>`;
    $('#navAuth').innerHTML = `
      <button class="btn btn-outline btn-block" data-auth="login">Sign In</button>
      <button class="btn btn-primary btn-block" data-auth="signup">Create Account</button>`;
    return;
  }
  const initials = u.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  $('#authArea').innerHTML = `
    <div class="user-menu" id="userMenu">
      <button class="user-chip" id="userChip" aria-haspopup="true" aria-expanded="false">
        <span class="avatar">${esc(initials)}</span><span class="user-name">Hi, ${esc(u.name.split(' ')[0])}</span>
      </button>
      <div class="user-dropdown">
        <div class="who"><strong>${esc(u.name)}</strong>${esc(u.email)}</div>
        <button data-action="orders">📦 My Orders</button>
        <button data-action="wishlist">💖 My Wishlist</button>
        <button data-action="logout">↩ Sign Out</button>
      </div>
    </div>`;
  $('#navAuth').innerHTML = `
    <p style="margin:0;font-size:.9rem">Signed in as <strong>${esc(u.name)}</strong></p>
    <button class="btn btn-outline btn-block" data-action="orders">My Orders</button>
    <button class="btn btn-ghost btn-block" data-action="logout">Sign Out</button>`;
}

function renderHero() {
  const picks = [...state.products].filter(p => p.inStock).sort((a, b) => !!b.badge - !!a.badge).slice(0, 3);
  const best = state.offers.reduce((m, o) => Math.max(m, o.discount), 0);
  $('#heroArt').innerHTML = picks.map((p, i) => `
    <div class="float-card fc-${i + 1}" data-view="${p.id}" role="button" tabindex="0" aria-label="View ${esc(p.name)}">
      <img src="${esc(imgOf(p))}" alt="${esc(p.name)}">
      <div class="fc-label"><span>${esc(p.name)}</span><b>${rupee(p.finalPrice)}</b></div>
    </div>`).join('') + (best ? `<div class="hero-sticker"><div>UP TO<strong>${best}%</strong>OFF</div></div>` : '');
}

// "Find your sparkle" section: heading and tiles come from Admin > Homepage
function renderCategories() {
  const { eyebrow, title, highlight, tiles } = state.config.categorySection;
  const shown = tiles.filter(t => t.visible);
  $('#collections').style.display = shown.length ? '' : 'none';
  $('#catEyebrow').textContent = eyebrow;
  $('#catEyebrow').style.display = eyebrow ? '' : 'none';
  $('#catTitle').innerHTML = [esc(title), highlight ? `<em>${esc(highlight)}</em>` : ''].filter(Boolean).join(' ');
  $('#catGrid').style.setProperty('--cols', Math.min(8, shown.length || 1));
  $('#catGrid').innerHTML = shown.map(({ category: cat, label, image }) => {
    const count = state.products.filter(p => p.category === cat).length;
    return `
      <button class="cat reveal" data-cat="${esc(cat)}">
        <div class="cat-img"><img src="${esc(image || state.config.categoryImages?.[cat] || JewelArt.url(cat, cat))}" alt="" loading="lazy"></div>
        <span class="cat-name">${esc(label || cat)}</span>
        <span class="cat-count">${count} ${count === 1 ? 'design' : 'designs'}</span>
      </button>`;
  }).join('');
}

function renderOffers() {
  const themes = state.config.offerThemes;
  $('#offerGrid').innerHTML = state.offers.length ? state.offers.map(o => `
    <article class="offer reveal" style="background:${themes[o.theme] || themes.rose}">
      <div class="offer-pct">${o.discount}%<small>OFF</small></div>
      <h3>${esc(o.title)}</h3>
      <p>${esc(o.subtitle || '')}</p>
      <div class="offer-foot">
        <span class="offer-tag">${o.category === 'All' ? 'On everything' : esc(o.category)}${o.endsAt ? ` · till ${new Date(o.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span>
        <button class="btn btn-light" data-cat="${esc(o.category)}">Shop now →</button>
      </div>
    </article>`).join('')
    : '<p class="empty-offers">New offers are on their way. Check back soon! ✨</p>';
}

function renderChips() {
  const cats = ['All', ...state.config.categories];
  $('#chips').innerHTML = cats.map(c =>
    `<button class="chip ${state.filter.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

function visibleProducts() {
  const { category, q, sort, inStock } = state.filter;
  const term = q.trim().toLowerCase();
  const list = state.products.filter(p =>
    (category === 'All' || p.category === category)
    && (!inStock || p.inStock)
    && (!term || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(term)));
  const sorters = {
    featured: (a, b) => (b.inStock - a.inStock) || (!!b.badge - !!a.badge),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    'price-asc': (a, b) => a.finalPrice - b.finalPrice,
    'price-desc': (a, b) => b.finalPrice - a.finalPrice,
    discount: (a, b) => discountPct(b) - discountPct(a),
  };
  return list.sort(sorters[sort]);
}

function productCard(p) {
  const off = discountPct(p);
  const wished = state.wish.includes(p.id);
  return `
    <article class="card">
      <div class="card-media">
        <img src="${esc(imgOf(p))}" alt="${esc(p.name)}" loading="lazy">
        <div class="badges">
          ${p.offer ? `<span class="badge badge-offer">${p.offer.discount}% OFF</span>` : ''}
          ${p.badge ? `<span class="badge badge-${esc(p.badge)}">${esc(p.badge)}</span>` : ''}
        </div>
        <button class="wish-btn ${wished ? 'on' : ''}" data-wish="${p.id}" aria-label="Wishlist: ${esc(p.name)}" aria-pressed="${wished}">${ICON.heart}</button>
        ${p.inStock ? '' : '<div class="soldout"><span>Sold Out</span></div>'}
        <button class="quick-btn" data-view="${p.id}">Quick View</button>
      </div>
      <div class="card-body">
        <span class="card-cat">${esc(p.category)}</span>
        <h3><a href="#" data-view="${p.id}">${esc(p.name)}</a></h3>
        <div class="card-tags">${highlightsOf(p).slice(0, 2).map(h => `<span>${esc(h)}</span>`).join('')}</div>
        <div class="price">
          <strong>${rupee(p.finalPrice)}</strong>
          ${off ? `<s>${rupee(p.mrp)}</s><em>${off}% off</em>` : ''}
        </div>
        <div class="stock-note">${p.inStock && p.stock <= 3 ? `Only ${p.stock} left!` : ''}</div>
        <button class="btn btn-primary btn-block" data-add="${p.id}" ${p.inStock ? '' : 'disabled'}>${p.inStock ? 'Add to Bag' : 'Sold Out'}</button>
      </div>
    </article>`;
}

function renderProducts() {
  const list = visibleProducts();
  const { category, q } = state.filter;
  $('#productGrid').innerHTML = list.length ? list.map(productCard).join('') : `
    <div class="empty"><span class="empty-icon">🔍</span>No pieces match your search.<br>
      <button class="btn btn-outline btn-sm" style="margin-top:14px" data-cat="All" data-reset>Show everything</button></div>`;
  $('#resultNote').textContent = `${list.length} ${list.length === 1 ? 'piece' : 'pieces'}`
    + `${category !== 'All' ? ` in ${category}` : ''}${q.trim() ? ` matching “${q.trim()}”` : ''}`;
}

function renderCounts() {
  const cartQty = state.cart.reduce((s, i) => s + i.qty, 0);
  $('#cartCount').textContent = cartQty || '';
  $('#wishCount').textContent = state.wish.length || '';
}

function renderAll() {
  renderTicker();
  renderAuth();
  renderHero();
  renderCategories();
  renderOffers();
  renderChips();
  renderProducts();
  renderCounts();
  const { freeShippingAbove } = state.config.shipping;
  $('#shipNote').textContent = `Free delivery on orders above ${rupee(freeShippingAbove)}. Cash on Delivery available.`;
  // Footer contact column follows Admin > Pages > Store details
  const b = state.config.business;
  if (b) {
    $('#footerContact').innerHTML = [
      b.email && `<a href="mailto:${esc(b.email)}" style="display:inline">${esc(b.email)}</a>`,
      b.phone && `<a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}" style="display:inline">${esc(b.phone)}</a>`,
      b.hours && esc(b.hours),
    ].filter(Boolean).join('<br>');
  }
  observeReveal();
}

/* ---------------- Cart & wishlist ---------------- */

const saveCart = () => { store.set('gj_cart', state.cart); renderCounts(); };
const saveWish = () => { store.set('gj_wish', state.wish); renderCounts(); };

function bump(sel) {
  const el = $(sel);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function addToCart(id) {
  const p = byId(id);
  if (!p || !p.inStock) return toast('Sorry, this piece is sold out', 'err');
  const line = state.cart.find(i => i.id === id);
  const max = Math.min(10, p.stock);
  if (line) {
    if (line.qty >= max) return toast(`Only ${max} available for this piece`, 'err');
    line.qty += 1;
  } else {
    state.cart.push({ id, qty: 1 });
  }
  saveCart();
  bump('#cartBtn');
  toast(`✨ ${p.name} added to your bag`);
  if ($('#drawer').classList.contains('open')) renderDrawer();
}

function setQty(id, delta) {
  const line = state.cart.find(i => i.id === id);
  const p = byId(id);
  if (!line || !p) return;
  line.qty = Math.min(Math.min(10, p.stock), line.qty + delta);
  if (line.qty <= 0) state.cart = state.cart.filter(i => i.id !== id);
  saveCart();
  renderDrawer();
}

function toggleWish(id) {
  const had = state.wish.includes(id);
  state.wish = had ? state.wish.filter(w => w !== id) : [...state.wish, id];
  saveWish();
  bump('#wishBtn');
  $$(`.wish-btn[data-wish="${id}"]`).forEach(b => { b.classList.toggle('on', !had); b.setAttribute('aria-pressed', String(!had)); });
  if (!had) toast('💖 Saved to your wishlist');
  if ($('#drawer').classList.contains('open') && state.drawer === 'wish') renderDrawer();
}

function cartLines() {
  return state.cart.map(i => ({ ...i, p: byId(i.id) })).filter(l => l.p);
}

function cartTotals() {
  const sub = cartLines().filter(l => l.p.inStock).reduce((s, l) => s + l.p.finalPrice * l.qty, 0);
  const { freeShippingAbove, shippingFee } = state.config.shipping;
  const ship = sub === 0 || sub >= freeShippingAbove ? 0 : shippingFee;
  return { sub, ship, total: sub + ship };
}

function openDrawer(view) {
  state.drawer = view;
  renderDrawer();
  open($('#drawer'));
}

function renderDrawer() {
  const body = $('#drawerBody');
  const foot = $('#drawerFoot');
  const view = state.drawer;

  if (view === 'wish') {
    $('#drawerTitle').textContent = 'Your Wishlist';
    const items = state.wish.map(byId).filter(Boolean);
    body.innerHTML = items.length ? items.map(p => `
      <div class="line">
        <img src="${esc(imgOf(p))}" alt="">
        <div>
          <h4>${esc(p.name)}</h4>
          <div class="price"><strong>${rupee(p.finalPrice)}</strong></div>
          ${p.inStock ? `<button class="btn btn-primary btn-sm" data-add="${p.id}">Add to Bag</button>` : '<span class="line-oos">Sold out</span>'}
        </div>
        <button class="remove-btn" data-wish="${p.id}" aria-label="Remove ${esc(p.name)} from wishlist">${ICON.trash}</button>
      </div>`).join('')
      : '<div class="drawer-empty"><span class="empty-icon">💖</span><p>Your wishlist is empty.<br>Tap the heart on any piece to save it.</p></div>';
    foot.innerHTML = '';
    return;
  }

  if (view === 'checkout') {
    $('#drawerTitle').textContent = 'Checkout';
    const t = cartTotals();
    body.innerHTML = `
      <form class="form" id="checkoutForm">
        <p class="form-error" id="checkoutError" role="alert" style="margin:0"></p>
        <label>Full name<input name="name" required value="${esc(state.user?.name || '')}" autocomplete="name"></label>
        <label>Mobile number<input name="phone" required inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit number" autocomplete="tel-national"></label>
        <label>Address<input name="line" required placeholder="House no., street, area" autocomplete="street-address"></label>
        <div class="form-row">
          <label>City<input name="city" required autocomplete="address-level2"></label>
          <label>Pincode<input name="pincode" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="postal-code"></label>
        </div>
        <div class="pay-box">💵 <div><strong>Cash on Delivery</strong><br><small>Pay when your jewellery arrives</small></div></div>
      </form>`;
    foot.innerHTML = `
      <div class="sum-row total" style="margin-top:0;border:0;padding:0"><span>To pay</span><span>${rupee(t.total)}</span></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" form="checkoutForm" id="placeBtn" style="margin-top:12px">Place Order</button>
      <button class="btn btn-ghost btn-block" data-drawer="cart" style="margin-top:4px">← Back to bag</button>`;
    return;
  }

  if (view === 'done') {
    $('#drawerTitle').textContent = 'Order Placed';
    const o = state.lastOrder;
    body.innerHTML = `
      <div class="success">
        <div class="success-icon">✓</div>
        <h3>Thank you, ${esc(o.address.name.split(' ')[0])}!</h3>
        <p>Your order <code>${esc(o.id)}</code> has been placed.<br>We'll deliver to ${esc(o.address.city)} soon. Amount payable on delivery: <strong>${rupee(o.total)}</strong>.</p>
      </div>`;
    foot.innerHTML = `
      <button class="btn btn-primary btn-block" data-action="orders">View My Orders</button>
      <button class="btn btn-ghost btn-block" data-close style="margin-top:4px">Continue Shopping</button>`;
    return;
  }

  // Cart
  $('#drawerTitle').textContent = 'Your Bag';
  const lines = cartLines();
  if (!lines.length) {
    body.innerHTML = '<div class="drawer-empty"><span class="empty-icon">🛍️</span><p>Your bag is empty.<br>Let\'s find something sparkly!</p></div>';
    foot.innerHTML = '<button class="btn btn-primary btn-block" data-close data-goto="#shop">Start Shopping</button>';
    return;
  }
  const t = cartTotals();
  const { freeShippingAbove } = state.config.shipping;
  const remaining = freeShippingAbove - t.sub;
  body.innerHTML = `
    <div class="ship-progress">
      ${remaining > 0 ? `Add <strong>${rupee(remaining)}</strong> more for <strong>FREE shipping</strong> 🚚` : '🎉 Yay! You\'ve unlocked <strong>FREE shipping</strong>'}
      <div class="ship-bar"><i style="width:${Math.min(100, (t.sub / freeShippingAbove) * 100)}%"></i></div>
    </div>
    ${lines.map(({ p, qty }) => `
      <div class="line">
        <img src="${esc(imgOf(p))}" alt="">
        <div>
          <h4>${esc(p.name)}</h4>
          <div class="price"><strong>${rupee(p.finalPrice)}</strong>${p.mrp > p.finalPrice ? `<s>${rupee(p.mrp)}</s>` : ''}</div>
          ${p.inStock ? `<div class="qty"><button data-qty="-1" data-id="${p.id}" aria-label="Decrease quantity of ${esc(p.name)}">−</button><span>${qty}</span><button data-qty="1" data-id="${p.id}" aria-label="Increase quantity of ${esc(p.name)}">+</button></div>`
            : '<span class="line-oos">Sold out. Please remove this item.</span>'}
        </div>
        <button class="remove-btn" data-remove="${p.id}" aria-label="Remove ${esc(p.name)} from bag">${ICON.trash}</button>
      </div>`).join('')}`;
  const blocked = lines.some(l => !l.p.inStock);
  foot.innerHTML = `
    <div class="sum-row"><span>Subtotal</span><span>${rupee(t.sub)}</span></div>
    <div class="sum-row"><span>Shipping</span><span>${t.ship ? rupee(t.ship) : 'FREE'}</span></div>
    <div class="sum-row total"><span>Total</span><span>${rupee(t.total)}</span></div>
    <button class="btn btn-primary btn-block btn-lg" data-action="checkout" style="margin-top:12px" ${blocked ? 'disabled' : ''}>Checkout</button>`;
}

async function placeOrder(form) {
  const btn = $('#placeBtn');
  const data = Object.fromEntries(new FormData(form));
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  try {
    const { order } = await api('/api/orders', { method: 'POST', body: { items: state.cart, address: data } });
    state.lastOrder = order;
    state.cart = [];
    saveCart();
    state.drawer = 'done';
    renderDrawer();
    refreshProducts().catch(() => {}); // best-effort: the order is already placed
  } catch (err) {
    $('#checkoutError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Place Order';
    if (/sign in/i.test(err.message)) {
      state.user = null;
      renderAuth();
      requireLogin(() => openDrawer('checkout'), 'Your session expired. Please sign in again to place your order');
    }
  }
}

async function refreshProducts() {
  const { products } = await api('/api/products');
  state.products = products;
  renderHero();
  renderProducts();
}

/* ---------------- Auth ---------------- */

function openAuth(tab = 'login', message) {
  switchTab(tab);
  $('#authError').textContent = '';
  $('#authTitle').textContent = message || 'Welcome! Sign in for faster checkout and to track your orders.';
  open($('#authModal'));
  setTimeout(() => $(`[data-form="${tab}"] input`)?.focus(), 250);
}

function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
  $('#authError').textContent = '';
}

async function submitAuth(form) {
  const mode = form.dataset.form;
  const btn = form.querySelector('[type=submit]');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    const { user } = await api(`/api/auth/${mode}`, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    state.user = user;
    form.reset();
    renderAuth();
    const next = state.afterLogin; // read before close(), which clears it
    close($('#authModal'));
    toast(mode === 'signup' ? `🎉 Welcome to Jpara Jewels, ${user.name.split(' ')[0]}!` : `Welcome back, ${user.name.split(' ')[0]}! ✨`);
    if (next) next();
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  renderAuth();
  document.body.classList.remove('nav-open');
  toast('You have been signed out');
}

function requireLogin(action, message) {
  if (state.user) return action();
  state.afterLogin = action;
  close($('#drawer'));
  document.body.classList.remove('nav-open');
  openAuth('login', message);
}

async function showOrders() {
  requireLogin(async () => {
    close($('#drawer'));
    document.body.classList.remove('nav-open');
    $('#ordersBody').innerHTML = '<p style="color:var(--muted)">Loading your orders…</p>';
    open($('#ordersModal'));
    try {
      const { orders } = await api('/api/orders/mine');
      $('#ordersBody').innerHTML = orders.length ? orders.map(o => `
        <div class="order">
          <div class="order-head">
            <div><strong>${esc(o.id)}</strong><small>${new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div>
            <span class="status status-${esc(o.status)}">${esc(o.status)}</span>
          </div>
          <ul>${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} · ${rupee(i.price * i.qty)}</li>`).join('')}</ul>
          <div class="order-total">Total ${rupee(o.total)} · ${esc(o.payment)}</div>
        </div>`).join('')
        : '<div class="drawer-empty"><span class="empty-icon">📦</span><p>No orders yet. Your sparkle journey starts in the shop!</p></div>';
    } catch (err) {
      $('#ordersBody').innerHTML = `<p class="form-error" style="margin:0">${esc(err.message)}</p>`;
    }
  }, 'Sign in to see your orders');
}

/* ---------------- Quick view ---------------- */

function showProduct(id) {
  const p = byId(id);
  if (!p) return;
  const off = discountPct(p);
  const specs = specRows(p);
  $('#productModalBody').innerHTML = `
    <button class="icon-btn modal-x" data-close aria-label="Close">${ICON.close}</button>
    <div class="pv-media"><img src="${esc(imgOf(p))}" alt="${esc(p.name)}"></div>
    <div class="pv-info">
      <span class="card-cat">${esc(p.category)}${p.badge ? ` · ${esc(p.badge)}` : ''}</span>
      <h3>${esc(p.name)}</h3>
      <div class="price"><strong>${rupee(p.finalPrice)}</strong>${off ? `<s>${rupee(p.mrp)}</s><em>${off}% off</em>` : ''}</div>
      ${p.offer ? `<div class="pv-offer">🎉 <strong>${esc(p.offer.title)}</strong> applied: extra ${p.offer.discount}% off</div>` : ''}
      <div class="pv-block">
        <h4 class="pv-block-title">Product Highlights</h4>
        <ul class="highlights">
          ${highlightsOf(p).map(h => `<li class="highlight-pill">${highlightIcon(h)}<span>${esc(h)}</span></li>`).join('')}
        </ul>
      </div>
      <p>${esc(p.description || 'A beautiful piece from the Jpara collection.')}</p>
      ${specs ? `
      <details class="specs">
        <summary>Specifications</summary>
        <table class="specs-table"><tbody>${specs}</tbody></table>
      </details>` : ''}
      <ul class="pv-meta">
        <li>✓ ${p.inStock ? (p.stock <= 3 ? `<strong style="color:var(--danger)">Only ${p.stock} left</strong>` : 'In stock, ready to ship') : '<strong style="color:var(--danger)">Currently sold out</strong>'}</li>
        <li>✓ Cash on Delivery available</li>
        <li>✓ Free shipping above ${rupee(state.config.shipping.freeShippingAbove)}</li>
      </ul>
      <div class="pv-actions">
        <button class="btn btn-primary btn-lg" data-add="${p.id}" ${p.inStock ? '' : 'disabled'}>${p.inStock ? 'Add to Bag' : 'Sold Out'}</button>
        <button class="icon-btn wish-btn ${state.wish.includes(p.id) ? 'on' : ''}" style="position:static;width:50px;height:50px;border:1.5px solid var(--line)" data-wish="${p.id}" aria-label="Wishlist: ${esc(p.name)}" aria-pressed="${state.wish.includes(p.id)}">${ICON.heart}</button>
      </div>
    </div>`;
  open($('#productModal'));
}

/* ---------------- Filters ---------------- */

function setCategory(cat) {
  state.filter.category = cat;
  renderChips();
  renderProducts();
  $('#shop').scrollIntoView({ behavior: 'smooth' });
}

/* ---------------- Events ---------------- */

function bindEvents() {
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a, [data-view], [data-close], [data-close-nav]');
    if (!t) {
      $('#userMenu')?.classList.remove('open');
      return;
    }
    const d = t.dataset;

    if (t.id !== 'userChip' && !t.closest('.user-dropdown')) $('#userMenu')?.classList.remove('open');

    if ('close' in d) {
      close(t.closest('.modal, .drawer'));
      if (d.goto) $(d.goto).scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if ('closeNav' in d) return document.body.classList.remove('nav-open');
    if (d.add) { e.preventDefault(); return addToCart(d.add); }
    if (d.wish) { e.preventDefault(); return toggleWish(d.wish); }
    if (d.view) {
      e.preventDefault();
      return showProduct(d.view);
    }
    if (d.remove) {
      state.cart = state.cart.filter(i => i.id !== d.remove);
      saveCart();
      return renderDrawer();
    }
    if (d.qty) return setQty(d.id, Number(d.qty));
    if (d.cat) {
      e.preventDefault();
      if ('reset' in d) {
        state.filter.q = '';
        state.filter.inStock = false;
        $('#searchInput').value = '';
        $('#inStockOnly').checked = false;
      }
      return setCategory(d.cat);
    }
    if (d.auth) {
      document.body.classList.remove('nav-open');
      return openAuth(d.auth);
    }
    if (d.tab) {
      e.preventDefault();
      return switchTab(d.tab);
    }
    if (d.drawer) {
      state.drawer = d.drawer;
      return renderDrawer();
    }
    if (d.action === 'logout') return logout();
    if (d.action === 'orders') return showOrders();
    if (d.action === 'wishlist') { $('#userMenu')?.classList.remove('open'); return openDrawer('wish'); }
    if (d.action === 'checkout') {
      return requireLogin(() => openDrawer('checkout'), 'Sign in or create an account to place your order');
    }
    if (t.id === 'userChip') return t.setAttribute('aria-expanded', $('#userMenu').classList.toggle('open'));

    // Close mobile nav when a nav link is used
    if (t.closest('.nav') && t.tagName === 'A') document.body.classList.remove('nav-open');
  });

  // Keyboard support for the hero cards (role="button")
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal.open, .drawer.open').forEach(close);
      document.body.classList.remove('nav-open');
      $('#userMenu')?.classList.remove('open');
      $('#userChip')?.setAttribute('aria-expanded', 'false');
    }
    if (e.key === 'Tab') {
      const box = $('.modal.open .modal-card, .drawer.open .drawer-panel');
      const f = box ? $$('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]', box).filter(x => x.offsetParent) : [];
      if (f.length) {
        if (!box.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.float-card')) {
      e.preventDefault();
      showProduct(e.target.dataset.view);
    }
  });

  $('#menuBtn').addEventListener('click', () => document.body.classList.add('nav-open'));
  $('#cartBtn').addEventListener('click', () => openDrawer('cart'));
  $('#wishBtn').addEventListener('click', () => openDrawer('wish'));
  $('#searchBtn').addEventListener('click', () => {
    const bar = $('#searchBar');
    bar.classList.toggle('open');
    if (bar.classList.contains('open')) $('#searchInput').focus();
  });

  let searchTimer;
  $('#searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.q = e.target.value;
      renderProducts();
    }, 180);
  });
  $('#searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#shop').scrollIntoView({ behavior: 'smooth' });
  });
  $('#sortSelect').addEventListener('change', e => { state.filter.sort = e.target.value; renderProducts(); });
  $('#inStockOnly').addEventListener('change', e => { state.filter.inStock = e.target.checked; renderProducts(); });

  $$('#loginForm, #signupForm').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); submitAuth(f); }));
  document.addEventListener('submit', e => {
    if (e.target.id === 'checkoutForm') { e.preventDefault(); placeOrder(e.target); }
  });

  window.addEventListener('scroll', () => $('#header').classList.toggle('scrolled', window.scrollY > 10), { passive: true });
  $('#year').textContent = new Date().getFullYear();
}

let revealObserver;
function observeReveal() {
  if (!('IntersectionObserver' in window)) return $$('.reveal').forEach(el => el.classList.add('in'));
  revealObserver ??= new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); }
  }), { threshold: .12 });
  $$('.reveal:not(.in)').forEach(el => revealObserver.observe(el));
}

/* ---------------- Boot ---------------- */

async function init() {
  bindEvents();
  $('#productGrid').innerHTML = '<div class="skeleton"></div>'.repeat(8);
  try {
    const [config, { products }, { offers }, { user }] = await Promise.all([
      api('/api/config'), api('/api/products'), api('/api/offers'), api('/api/auth/me'),
    ]);
    Object.assign(state, { config, products, offers, user });
  } catch {
    $('#productGrid').innerHTML = '<div class="empty"><span class="empty-icon">😢</span>We couldn\'t load the store. Please refresh the page.</div>';
    return;
  }
  // Drop bag/wishlist entries for products that were deleted
  state.cart = state.cart.filter(i => byId(i.id));
  state.wish = state.wish.filter(id => byId(id));
  saveCart();
  saveWish();
  renderAll();
}

init();
