'use strict';
/* ==========================================================
   Jpara Jewels: admin panel
   ========================================================== */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = n => `₹${Number(n).toLocaleString('en-IN')}`;
const fmtDate = iso => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const imgOf = p => p.image || JewelArt.url(p.category, p.id);

const state = {
  config: null,
  products: [],
  offers: [],
  orders: [],
  posts: [],
  subscribers: [],
  subscriberQuery: '',
  sitePages: [],
  business: null,
  pageTokens: [],
  editingPage: null,
  editingPost: null,
  removePostImage: false,
  slugTouched: false,
  stats: null,
  view: 'dashboard',
  productQuery: '',
  productCat: 'All',
  productStock: 'all',
  orderStatus: 'All',
  editingProduct: null,
  removeImage: false,
  editingOffer: null,
  offerTheme: 'rose',
  section: null,       // saved "Find your sparkle" section
  sectionDraft: null,  // unsaved edits on the Homepage view
};

async function api(url, { method = 'GET', body, form } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) {
    showLogin();
    throw new Error('Your session has expired. Please log in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

let lastFocus = null;
function openModal(el) {
  if (!$('.modal.open')) lastFocus = document.activeElement;
  el.classList.add('open');
  requestAnimationFrame(() => {
    if (!el.contains(document.activeElement)) el.querySelector('.modal-card input, .modal-card select, .modal-card button')?.focus();
  });
}
function closeModal(el) {
  el.classList.remove('open');
  if (!$('.modal.open')) { lastFocus?.focus?.(); lastFocus = null; }
}

function confirmDialog(title, text, okLabel = 'Delete') {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel;
  openModal($('#confirmModal'));
  return new Promise(resolve => {
    const finish = ok => {
      closeModal($('#confirmModal'));
      $('#confirmOk').onclick = null;
      $('#confirmModal').onclick = null;
      resolve(ok);
    };
    $('#confirmOk').onclick = () => finish(true);
    $('#confirmModal').onclick = e => { if ('close' in e.target.dataset) finish(false); };
  });
}

/* ---------------- Auth ---------------- */

function showLogin() {
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $$('.modal.open').forEach(closeModal);
}

async function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  await loadAll();
  switchView(state.view);
  try {
    const me = await api('/api/admin/me');
    $('#pwWarning').hidden = !me.defaultPassword;
  } catch { /* banner is optional */ }
}

async function loadAll() {
  const [config, p, o, ord, stats, sec, blog, pg, nl] = await Promise.all([
    state.config ? { ...state.config } : api('/api/config'),
    api('/api/admin/products'), api('/api/admin/offers'), api('/api/admin/orders'), api('/api/admin/stats'),
    api('/api/admin/category-section'), api('/api/admin/blog'), api('/api/admin/pages'),
    api('/api/admin/subscribers'),
  ]);
  Object.assign(state, { config, products: p.products, offers: o.offers, orders: ord.orders, stats, section: sec.section, posts: blog.posts,
    sitePages: pg.pages, business: pg.business, pageTokens: pg.tokens, subscribers: nl.subscribers });
  const pending = stats.pendingOrders;
  $('#pendingPill').hidden = !pending;
  $('#pendingPill').textContent = pending;
}

// Reload data after a change and redraw the current view without losing filters
async function refresh() {
  await loadAll();
  renderView();
}

/* ---------------- Views ---------------- */

const VIEWS = {
  dashboard: ['Dashboard', 'Here\'s what\'s happening in your store.'],
  products: ['Products', 'Add, edit, delete products and manage stock & availability.'],
  offers: ['Offers', 'Create discounts that appear automatically on the store.'],
  homepage: ['Homepage', 'Edit the "Find your sparkle" category section on the store.'],
  blog: ['Blog', 'Write posts with images, titles and meta descriptions for Google.'],
  pages: ['Pages', 'Edit About, Contact, Privacy Policy, Terms and FAQ, and your store details.'],
  newsletter: ['Newsletter', 'People who signed up in the website footer.'],
  orders: ['Orders', 'Track customer orders and update their status.'],
  settings: ['Settings', 'Manage your admin account.'],
};

function switchView(view) {
  state.view = view;
  state.sectionDraft = null; // leaving or re-opening Homepage drops unsaved edits
  $$('.side-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = VIEWS[view][0];
  $('#viewSub').textContent = VIEWS[view][1];
  renderTopActions();
  renderView();
  window.scrollTo({ top: 0 });
}

function renderTopActions() {
  const { categories, orderStatuses } = state.config;
  const actions = {
    dashboard: '<button class="btn btn-primary" data-act="new-product">＋ Add Product</button>',
    products: `
      <input type="search" id="productSearch" placeholder="Search products…" value="${esc(state.productQuery)}">
      <select id="productCat"><option value="All">All categories</option>${categories.map(c => `<option ${c === state.productCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="productStock">
        <option value="all">All stock</option>
        <option value="live" ${state.productStock === 'live' ? 'selected' : ''}>On sale</option>
        <option value="low" ${state.productStock === 'low' ? 'selected' : ''}>Low stock (≤5)</option>
        <option value="out" ${state.productStock === 'out' ? 'selected' : ''}>Unavailable / sold out</option>
      </select>
      <button class="btn btn-primary" data-act="new-product">＋ Add Product</button>`,
    offers: '<button class="btn btn-primary" data-act="new-offer">＋ New Offer</button>',
    homepage: '<a class="btn btn-soft" href="/#collections" target="_blank" rel="noopener">View on store ↗</a>',
    blog: '<a class="btn btn-soft" href="/blog" target="_blank" rel="noopener">View blog ↗</a><button class="btn btn-primary" data-act="new-post">＋ New Post</button>',
    orders: `<select id="orderStatus"><option value="All">All orders</option>${orderStatuses.map(s => `<option ${s === state.orderStatus ? 'selected' : ''}>${s}</option>`).join('')}</select>`,
    pages: '',
    newsletter: `<input type="search" id="subscriberSearch" placeholder="Search emails…" value="${esc(state.subscriberQuery)}" aria-label="Search subscribers"><a class="btn btn-primary" href="/api/admin/subscribers.csv" download>⬇ Download CSV</a>`,
    settings: '',
  };
  $('#topActions').innerHTML = actions[state.view];
}

function renderView() {
  ({ dashboard: renderDashboard, products: renderProducts, offers: renderOffers, homepage: renderSection, blog: renderBlog, pages: renderPages, newsletter: renderNewsletter, orders: renderOrders, settings: renderSettings })[state.view]();
}

function renderDashboard() {
  const s = state.stats;
  const attention = state.products
    .filter(p => !p.available || p.stock <= 5)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6);
  const recent = state.orders.slice(0, 6);
  $('#view').innerHTML = `
    <div class="stats">
      <div class="stat s1"><small>Products</small><strong>${s.products}</strong><span>${s.outOfStock} unavailable · ${s.lowStock} low stock</span></div>
      <div class="stat s2"><small>Live offers</small><strong>${s.liveOffers}</strong><span>shown on the store now</span></div>
      <div class="stat s3"><small>Orders</small><strong>${s.orders}</strong><span>${s.pendingOrders} pending</span></div>
      <div class="stat s4"><small>Revenue</small><strong>${rupee(s.revenue)}</strong><span>${s.customers} registered customers</span></div>
    </div>
    <div class="panels">
      <section class="panel">
        <h3>Needs attention <button data-go="products">Manage →</button></h3>
        ${attention.length ? attention.map(p => `
          <div class="mini-row">
            <img src="${esc(imgOf(p))}" alt="">
            <span class="grow">${esc(p.name)}</span>
            ${!p.available ? '<span class="tag tag-off">Hidden</span>' : p.stock === 0 ? '<span class="tag tag-off">Sold out</span>' : `<span class="tag tag-warn">${p.stock} left</span>`}
          </div>`).join('') : '<p class="muted">All products are well stocked ✨</p>'}
      </section>
      <section class="panel">
        <h3>Recent orders <button data-go="orders">View all →</button></h3>
        ${recent.length ? recent.map(o => `
          <div class="mini-row">
            <span class="grow"><strong>${esc(o.id)}</strong> · ${esc(o.customer.name)}<br><span class="muted">${fmtDate(o.createdAt)}</span></span>
            <strong>${rupee(o.total)}</strong>
            <span class="tag ${statusTag(o.status)}">${esc(o.status)}</span>
          </div>`).join('') : '<p class="muted">No orders yet. They\'ll show up here.</p>'}
      </section>
    </div>`;
}

const statusTag = s => ({ Delivered: 'tag-ok', Cancelled: 'tag-off', Pending: 'tag-warn' }[s] || '');

function filteredProducts() {
  const q = state.productQuery.trim().toLowerCase();
  return state.products.filter(p =>
    (state.productCat === 'All' || p.category === state.productCat)
    && (!q || p.name.toLowerCase().includes(q))
    && ({
      all: true,
      live: p.inStock,
      low: p.available && p.stock > 0 && p.stock <= 5,
      out: !p.inStock,
    })[state.productStock]);
}

function renderProducts() {
  const list = filteredProducts();
  if (!list.length) {
    $('#view').innerHTML = `<div class="table-wrap"><div class="empty-state"><div>💍</div>
      ${state.products.length ? 'No products match these filters.' : 'No products yet. Add your first one!'}</div></div>`;
    return;
  }
  $('#view').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Available</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(p => `
          <tr data-id="${p.id}">
            <td><div class="prod-cell"><img src="${esc(imgOf(p))}" alt=""><div><strong>${esc(p.name)}</strong><small>${esc(p.category)}${p.badge ? ` · ${esc(p.badge)}` : ''}</small></div></div></td>
            <td class="price-cell"><strong>${rupee(p.price)}</strong>${p.mrp > p.price ? `<s>${rupee(p.mrp)}</s>` : ''}${p.offer ? `<em>${rupee(p.finalPrice)} with ${p.offer.discount}% offer</em>` : ''}</td>
            <td><input type="number" min="0" class="stock-input ${p.stock <= 5 ? 'stock-low' : ''}" value="${p.stock}" data-stock="${p.id}" aria-label="Stock for ${esc(p.name)}"></td>
            <td><label class="toggle"><input type="checkbox" data-avail="${p.id}" aria-label="Available for sale: ${esc(p.name)}" ${p.available ? 'checked' : ''}><span class="sw"></span></label></td>
            <td>${p.inStock ? '<span class="tag tag-ok">On sale</span>' : !p.available ? '<span class="tag tag-off">Hidden</span>' : '<span class="tag tag-off">Sold out</span>'}</td>
            <td><div class="row-actions">
              <button class="icon-action" data-edit="${p.id}" title="Edit" aria-label="Edit ${esc(p.name)}">✏️</button>
              <button class="icon-action del" data-del="${p.id}" title="Delete" aria-label="Delete ${esc(p.name)}">🗑️</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:12px">${list.length} of ${state.products.length} products. Change the stock number or flip the switch to update availability instantly.</p>`;
}

function renderOffers() {
  const themes = state.config.offerThemes;
  $('#view').innerHTML = state.offers.length ? `<div class="offer-cards">${state.offers.map(o => `
    <article class="offer-card">
      <div class="offer-banner ${o.live ? '' : 'off'}" style="background:${themes[o.theme] || themes.rose}">
        <div class="pct">${o.discount}% OFF</div>
        <h4>${esc(o.title)}</h4>
        <p>${esc(o.subtitle)}</p>
      </div>
      <div class="offer-meta">
        <div>
          <span class="tag ${o.live ? 'tag-ok' : 'tag-off'}">${o.live ? 'Live' : o.active ? 'Expired' : 'Paused'}</span>
          <div class="info">${o.category === 'All' ? 'All products' : esc(o.category)}${o.endsAt ? ` · ends ${new Date(o.endsAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ' · no end date'}</div>
        </div>
        <div class="row-actions">
          <label class="toggle" title="Active"><input type="checkbox" data-offer-toggle="${o.id}" aria-label="Offer active: ${esc(o.title)}" ${o.active ? 'checked' : ''}><span class="sw"></span></label>
          <button class="icon-action" data-offer-edit="${o.id}" title="Edit" aria-label="Edit offer ${esc(o.title)}">✏️</button>
          <button class="icon-action del" data-offer-del="${o.id}" title="Delete" aria-label="Delete offer ${esc(o.title)}">🗑️</button>
        </div>
      </div>
    </article>`).join('')}</div>
    <p class="muted" style="margin-top:14px">When several offers match a product, the biggest discount is applied automatically.</p>`
    : '<div class="table-wrap"><div class="empty-state"><div>🎉</div>No offers yet. Create one to start a sale!</div></div>';
}


/* ---------------- Blog ---------------- */

const postUrl = p => `/blog/${encodeURIComponent(p.slug)}`;
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function renderBlog() {
  const posts = state.posts;
  $('#view').innerHTML = posts.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Post</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${posts.map(p => `
          <tr>
            <td><div class="prod-cell">
              ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span class="post-thumb-empty" aria-hidden="true">📝</span>'}
              <div><strong>${esc(p.title)}</strong><small>${esc(postUrl(p))}${p.metaDescription ? '' : ' · <span class="warn-text">no meta description</span>'}</small></div>
            </div></td>
            <td>${p.published ? '<span class="tag tag-ok">Published</span>' : '<span class="tag tag-warn">Draft</span>'}</td>
            <td><span class="muted">${fmtDate(p.publishedAt || p.createdAt)}</span></td>
            <td><div class="row-actions">
              <a class="icon-action" href="${esc(postUrl(p))}" target="_blank" rel="noopener" title="${p.published ? 'View' : 'Preview'}" aria-label="${p.published ? 'View' : 'Preview'} ${esc(p.title)}">👁️</a>
              <button class="icon-action" data-post-edit="${p.id}" title="Edit" aria-label="Edit ${esc(p.title)}">✏️</button>
              <button class="icon-action del" data-post-del="${p.id}" title="Delete" aria-label="Delete ${esc(p.title)}">🗑️</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`
    : '<div class="table-wrap"><div class="empty-state"><div>📝</div>No blog posts yet. Write your first one!</div></div>';
}

function openPostForm(post = null) {
  const form = $('#postForm');
  form.reset();
  state.editingPost = post;
  state.removePostImage = false;
  state.slugTouched = !!post;
  $('#postError').textContent = '';
  $('#postFormTitle').textContent = post ? 'Edit Post' : 'New Blog Post';
  if (post) {
    for (const key of ['title', 'slug', 'metaDescription', 'content']) form.elements[key].value = post[key] ?? '';
    form.elements.published.checked = post.published;
    form.elements.imageUrl.value = /^https?:/.test(post.image) ? post.image : '';
  } else {
    form.elements.published.checked = false;
  }
  updatePostImage();
  updateSeoPreview();
  openModal($('#postModal'));
  setTimeout(() => form.elements.title.focus(), 200);
}

let postPreviewUrl = '';
function updatePostImage() {
  const file = $('#postImgFile').files[0];
  const url = $('#postImgUrl').value.trim();
  const p = state.editingPost;
  if (postPreviewUrl) { URL.revokeObjectURL(postPreviewUrl); postPreviewUrl = ''; }
  let src = '';
  if (file) src = postPreviewUrl = URL.createObjectURL(file);
  else if (/^https?:\/\//.test(url)) src = url;
  else if (p?.image && !state.removePostImage) src = p.image;
  $('#postImgPreview').hidden = !src;
  $('#postImgEmpty').hidden = !!src;
  if (src) $('#postImgPreview').src = src;
  $('#postImgRemove').hidden = !src;
}

// Live character counts and a Google-style search result preview
function updateSeoPreview() {
  const form = $('#postForm');
  const title = form.elements.title.value.trim();
  const meta = form.elements.metaDescription.value.trim();
  if (!state.slugTouched) form.elements.slug.value = slugify(title);
  const slug = slugify(form.elements.slug.value) || 'your-post';
  const n = meta.length;
  const counter = $('#metaCount');
  counter.textContent = `${n} / 160`;
  counter.className = `char-count ${n === 0 ? '' : n < 70 ? 'warn' : n <= 160 ? 'ok' : 'bad'}`;
  $('#metaHint').textContent = n === 0 ? 'Empty: the first lines of the post will be used.'
    : n < 70 ? 'A bit short. Aim for 120 to 160 characters.' : n <= 160 ? 'Good length.' : 'Too long: Google will cut it off.';
  $('#titleCount').textContent = `${title.length} / 120`;
  $('#seoPreview').innerHTML = `
    <div class="seo-url">${esc(location.host)} › blog › ${esc(slug)}</div>
    <div class="seo-title">${esc((title || 'Your post title') + ' | Jpara Jewels')}</div>
    <div class="seo-desc">${esc(meta || 'Write a meta description to control the text shown here in Google results.')}</div>`;
}

// Formatting toolbar: wraps the selection or inserts a line
function formatContent(kind, toolbar) {
  const ta = $(`#${toolbar?.dataset.target || 'postContent'}`);
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const insert = (text, cursorFrom, cursorTo) => {
    ta.setRangeText(text, s, e, 'end');
    if (cursorFrom != null) ta.setSelectionRange(s + cursorFrom, s + cursorTo);
    ta.focus();
  };
  const prefixLine = prefix => {
    ta.setRangeText(prefix, lineStart, lineStart, 'end');
    ta.focus();
  };
  if (kind === 'h2') return prefixLine('## ');
  if (kind === 'h3') return prefixLine('### ');
  if (kind === 'ul') return prefixLine('- ');
  if (kind === 'quote') return prefixLine('> ');
  if (kind === 'bold') return insert(`**${sel || 'bold text'}**`, 2, 2 + (sel || 'bold text').length);
  if (kind === 'italic') return insert(`*${sel || 'italic text'}*`, 1, 1 + (sel || 'italic text').length);
  if (kind === 'link') return insert(`[${sel || 'link text'}](https://)`, (sel || 'link text').length + 3, (sel || 'link text').length + 11);
  if (kind === 'image') return toolbar.querySelector('input[type="file"]').click();
}

async function insertContentImage(file, ta = $('#postContent')) {
  const fd = new FormData();
  fd.append('image', file);
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Image';
  try {
    toast('Uploading image…');
    const { url } = await api('/api/admin/blog/upload-image', { method: 'POST', form: fd });
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const text = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}![${alt}](${url})\n\n`;
    ta.setRangeText(text, pos, ta.selectionEnd, 'end');
    ta.focus();
    toast('Image added to the post ✨');
  } catch (err) { toast(err.message, 'err'); }
}

async function savePost(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  if (!$('#postImgFile').files.length) fd.delete('image');
  fd.set('published', form.elements.published.checked ? 'true' : 'false');
  if (state.removePostImage) fd.set('removeImage', 'true');
  const btn = $('#postSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const p = state.editingPost;
    const { post } = await api(p ? `/api/admin/blog/${p.id}` : '/api/admin/blog', { method: p ? 'PUT' : 'POST', form: fd });
    closeModal($('#postModal'));
    toast(post.published ? 'Post published ✨' : 'Draft saved');
    await refresh();
  } catch (err) {
    $('#postError').textContent = err.message;
    $('#postModal .modal-body').scrollTop = 0;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Post';
  }
}

async function deletePost(id) {
  const p = state.posts.find(x => x.id === id);
  if (!p || !(await confirmDialog('Delete post?', `"${p.title}" will be removed from the blog permanently.`))) return;
  try {
    await api(`/api/admin/blog/${id}`, { method: 'DELETE' });
    toast('Post deleted');
    await refresh();
  } catch (err) { toast(err.message, 'err'); }
}


/* ---------------- Pages (About, Contact, Privacy, Terms, FAQ) ---------------- */

const BUSINESS_LABELS = {
  name: ['Store name', 'text', 60, ''],
  email: ['Email', 'email', 120, 'hello@yourstore.com'],
  phone: ['Phone', 'text', 30, '+91 98765 43210'],
  whatsapp: ['WhatsApp number', 'text', 20, '919876543210 (with country code)'],
  hours: ['Opening hours', 'text', 80, 'Monday to Saturday, 10am to 7pm'],
  address: ['Address', 'text', 200, 'Leave empty to hide'],
  instagram: ['Instagram link', 'url', 200, 'https://instagram.com/yourstore'],
  deliveryTime: ['Delivery time', 'text', 60, '3 to 7 working days'],
  returnDays: ['Days to report a damaged item', 'number', 3, '7'],
};

function renderPages() {
  const b = state.business || {};
  $('#view').innerHTML = `
    <div class="pages-layout">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Page</th><th>Last edited</th><th>Actions</th></tr></thead>
          <tbody>${state.sitePages.map(p => `
            <tr>
              <td><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.path)}</span></td>
              <td>${p.isDefault ? '<span class="tag">Default text</span>' : `<span class="muted">${fmtDate(p.updatedAt)}</span>`}</td>
              <td><div class="row-actions">
                <a class="icon-action" href="${esc(p.path)}" target="_blank" rel="noopener" title="View" aria-label="View ${esc(p.name)}">👁️</a>
                <button class="icon-action" data-page-edit="${esc(p.key)}" title="Edit" aria-label="Edit ${esc(p.name)}">✏️</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <form class="settings-card business-card" id="businessForm">
        <h3>Store details</h3>
        <p class="muted">Used on the Contact page, in the footer, and wherever a page uses a placeholder such as {phone}.</p>
        <p class="error" id="businessError" role="alert"></p>
        ${Object.entries(BUSINESS_LABELS).map(([key, [label, type, max, ph]]) => `
          <label>${label}<input name="${key}" type="${type}" ${type === 'number' ? 'min="0" max="365"' : `maxlength="${max}"`} value="${esc(b[key] ?? '')}" placeholder="${esc(ph)}" ${key === 'name' ? 'required' : ''}></label>`).join('')}
        <button class="btn btn-primary" type="submit">Save store details</button>
      </form>
    </div>`;
}

async function saveBusiness(form) {
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const { business } = await api('/api/admin/business', { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
    state.business = business;
    $('#businessError').textContent = '';
    toast('Store details saved ✨');
  } catch (err) {
    $('#businessError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function openPageForm(key) {
  const page = state.sitePages.find(p => p.key === key);
  if (!page) return;
  const form = $('#pageForm');
  form.reset();
  state.editingPage = page;
  $('#pageError').textContent = '';
  $('#pageFormTitle').textContent = `Edit ${page.name}`;
  for (const field of ['eyebrow', 'heading', 'title', 'metaDescription', 'content']) form.elements[field].value = page[field] ?? '';
  $('#pageReset').hidden = page.isDefault;
  $('#pageFaqHint').hidden = key !== 'faq';
  $('#pageTokens').innerHTML = state.pageTokens.map(t => `<button type="button" data-token="${t}">{${t}}</button>`).join('');
  updatePageSeo();
  openModal($('#pageModal'));
  setTimeout(() => form.elements.heading.focus(), 200);
}

function updatePageSeo() {
  const form = $('#pageForm');
  const p = state.editingPage;
  const meta = form.elements.metaDescription.value.trim();
  const n = meta.length;
  $('#pageMetaCount').textContent = `${n} / 160`;
  $('#pageMetaCount').className = `char-count ${n === 0 ? '' : n < 70 ? 'warn' : n <= 160 ? 'ok' : 'bad'}`;
  // Show placeholders filled in, like the live page
  const b = state.business || {};
  const fill = s => s.replace(/\{(\w+)\}/g, (m, k) => ({ storeName: b.name }[k] ?? b[k] ?? m));
  $('#pageSeoPreview').innerHTML = `
    <div class="seo-url">${esc(location.host)} › ${esc(p.path.slice(1))}</div>
    <div class="seo-title">${esc(fill(form.elements.title.value.trim() || p.name) + ' | ' + (b.name || 'Jpara Jewels'))}</div>
    <div class="seo-desc">${esc(fill(meta) || 'Write a meta description to control the text shown in Google results.')}</div>`;
}

async function savePageForm(e) {
  e.preventDefault();
  const p = state.editingPage;
  const body = Object.fromEntries(new FormData(e.target));
  const btn = $('#pageSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await api(`/api/admin/pages/${p.key}`, { method: 'PUT', body });
    closeModal($('#pageModal'));
    toast(`${p.name} updated ✨`);
    await refresh();
  } catch (err) {
    $('#pageError').textContent = err.message;
    $('#pageModal .modal-body').scrollTop = 0;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Page';
  }
}

async function resetPageForm() {
  const p = state.editingPage;
  if (!(await confirmDialog('Reset to default?', `Your changes to "${p.name}" will be replaced with the original text. This can't be undone.`, 'Reset page'))) return;
  try {
    await api(`/api/admin/pages/${p.key}`, { method: 'DELETE' });
    closeModal($('#pageModal'));
    toast(`${p.name} reset to default`);
    await refresh();
  } catch (err) { $('#pageError').textContent = err.message; }
}


/* ---------------- Newsletter subscribers ---------------- */

function renderNewsletter() {
  const q = state.subscriberQuery.trim().toLowerCase();
  const subs = state.subscribers.filter(s => !q || s.email.includes(q));
  $('#view').innerHTML = state.subscribers.length ? `
    <p class="muted" style="margin:0 0 12px">${state.subscribers.length} ${state.subscribers.length === 1 ? 'subscriber' : 'subscribers'}${q ? ` · ${subs.length} matching` : ''}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Signed up</th><th>From page</th><th>Actions</th></tr></thead>
        <tbody>${subs.map(s => `
          <tr>
            <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
            <td><span class="muted">${fmtDate(s.createdAt)}</span></td>
            <td><span class="muted">${esc(s.source || '')}</span></td>
            <td><div class="row-actions"><button class="icon-action del" data-sub-del="${esc(s.id)}" title="Remove" aria-label="Remove ${esc(s.email)}">🗑️</button></div></td>
          </tr>`).join('') || '<tr><td colspan="4"><div class="empty-state">No subscribers match your search.</div></td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:14px">Download the CSV and import it into your email tool (Mailchimp, Brevo, Zoho Campaigns…) to send newsletters. Remove anyone who asks to unsubscribe.</p>`
    : '<div class="table-wrap"><div class="empty-state"><div>📧</div>No subscribers yet. The signup form is in the footer of every page.</div></div>';
}

async function deleteSubscriber(id) {
  const s = state.subscribers.find(x => x.id === id);
  if (!s || !(await confirmDialog('Remove subscriber?', `${s.email} will be removed from your newsletter list.`, 'Remove'))) return;
  try {
    await api(`/api/admin/subscribers/${id}`, { method: 'DELETE' });
    toast('Subscriber removed');
    await refresh();
  } catch (err) { toast(err.message, 'err'); }
}

/* ---------------- Homepage: "Find your sparkle" section ---------------- */

const draftFrom = s => ({
  eyebrow: s.eyebrow, title: s.title, highlight: s.highlight,
  tiles: s.tiles.map(t => ({ ...t, file: null, preview: '', reset: false })),
});

// Photo the tile will show: new upload, then its saved photo, then the default category photo
const tilePhoto = t => t.preview || (!t.reset && t.image) || state.config.categoryImages[t.category] || JewelArt.url(t.category, t.category);

function renderSection() {
  const d = (state.sectionDraft ??= draftFrom(state.section));
  $('#view').innerHTML = `
    <form class="section-editor" id="sectionForm">
      <div class="settings-card">
        <h3>Section heading</h3>
        <p class="error" id="sectionError"></p>
        <label>Small text above the heading<input name="eyebrow" data-section-field="eyebrow" maxlength="60" value="${esc(d.eyebrow)}" placeholder="Leave empty to hide"></label>
        <div class="grid-2">
          <label>Heading<input data-section-field="title" maxlength="60" value="${esc(d.title)}" placeholder="e.g. Find your"></label>
          <label>Highlighted word (gold italics)<input data-section-field="highlight" maxlength="40" value="${esc(d.highlight)}" placeholder="e.g. sparkle"></label>
        </div>
        <div class="section-preview" id="sectionPreview"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Photo</th><th>Category</th><th>Name on store</th><th>Show</th><th>Order</th></tr></thead>
          <tbody>${d.tiles.map((t, i) => {
            const count = state.products.filter(p => p.category === t.category).length;
            const custom = t.file || (t.image && !t.reset);
            return `
            <tr class="${t.visible ? '' : 'tile-off'}">
              <td><div class="tile-photo">
                <img src="${esc(tilePhoto(t))}" alt="">
                <div class="tile-photo-actions">
                  <label class="btn btn-soft btn-sm file-btn">📷 Change<input type="file" data-tile-file="${i}" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"></label>
                  ${custom ? `<button type="button" class="link-btn" data-tile-reset="${i}">Use default photo</button>` : ''}
                </div>
              </div></td>
              <td><strong>${esc(t.category)}</strong><br><span class="muted">${count} ${count === 1 ? 'design' : 'designs'}</span></td>
              <td><input class="tile-label" data-tile-label="${i}" maxlength="40" value="${esc(t.label)}" placeholder="${esc(t.category)}" aria-label="Name for ${esc(t.category)}"></td>
              <td><label class="toggle" title="Show on store"><input type="checkbox" data-tile-show="${i}" aria-label="Show ${esc(t.category)} on store" ${t.visible ? 'checked' : ''}><span class="sw"></span></label></td>
              <td><div class="row-actions">
                <button type="button" class="icon-action" data-tile-move="${i}:-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="icon-action" data-tile-move="${i}:1" title="Move down" ${i === d.tiles.length - 1 ? 'disabled' : ''}>↓</button>
              </div></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
      <div class="section-actions">
        <span class="muted">Leave "Name on store" empty to use the category name. Square photos look best (JPG, PNG or WEBP up to 5 MB).</span>
        <button type="button" class="btn btn-ghost" data-act="section-discard">Discard changes</button>
        <button type="submit" class="btn btn-primary" id="sectionSave">Save Changes</button>
      </div>
    </form>`;
  updateSectionPreview();
}

function updateSectionPreview() {
  const d = state.sectionDraft;
  $('#sectionPreview').innerHTML = `
    ${d.eyebrow.trim() ? `<small>${esc(d.eyebrow)}</small>` : ''}
    <h4>${esc(d.title)} ${d.highlight.trim() ? `<em>${esc(d.highlight)}</em>` : ''}</h4>`;
}

function moveTile(i, step) {
  const tiles = state.sectionDraft.tiles;
  const j = i + step;
  if (j < 0 || j >= tiles.length) return;
  [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  renderSection();
}

function setTilePhoto(i, file, reset = false) {
  const t = state.sectionDraft.tiles[i];
  if (t.preview) URL.revokeObjectURL(t.preview);
  Object.assign(t, { file, preview: file ? URL.createObjectURL(file) : '', reset });
  renderSection();
}

async function saveSection() {
  const d = state.sectionDraft;
  const fd = new FormData();
  for (const key of ['eyebrow', 'title', 'highlight']) fd.set(key, d[key]);
  fd.set('tiles', JSON.stringify(d.tiles.map(({ category, label, visible, reset }) => ({ category, label, visible, reset }))));
  d.tiles.forEach(t => { if (t.file) fd.set(`photo_${state.config.categories.indexOf(t.category)}`, t.file); });

  const btn = $('#sectionSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await api('/api/admin/category-section', { method: 'PUT', form: fd });
    state.sectionDraft = null;
    toast('Homepage section updated ✨');
    await refresh();
  } catch (err) {
    $('#sectionError').textContent = err.message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

function renderOrders() {
  const list = state.orders.filter(o => state.orderStatus === 'All' || o.status === state.orderStatus);
  if (!list.length) {
    $('#view').innerHTML = '<div class="table-wrap"><div class="empty-state"><div>📦</div>No orders to show.</div></div>';
    return;
  }
  $('#view').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${list.map(o => `
          <tr>
            <td><strong>${esc(o.id)}</strong><br><span class="muted">${fmtDate(o.createdAt)}</span></td>
            <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.email)}</span></td>
            <td><details><summary>${o.items.reduce((s, i) => s + i.qty, 0)} item(s)</summary>
              <ul>${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} · ${rupee(i.price * i.qty)}</li>`).join('')}</ul>
              <div class="addr">📍 ${esc(o.address.name)}, ${esc(o.address.line)}, ${esc(o.address.city)} - ${esc(o.address.pincode)}<br>📞 ${esc(o.address.phone)}</div>
            </details></td>
            <td><strong>${rupee(o.total)}</strong><br><span class="muted">${esc(o.payment)}</span></td>
            <td><select class="status-select" data-order="${o.id}" aria-label="Status of order ${esc(o.id)}" ${(state.config.orderFlow?.[o.status] || []).length ? '' : 'disabled'}>
              ${[o.status, ...(state.config.orderFlow?.[o.status] || [])].map(s => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderSettings() {
  $('#view').innerHTML = `
    <form class="settings-card" id="passwordForm">
      <h3>Change password</h3>
      <p class="error" id="pwError"></p>
      <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
      <label>New password<input type="password" name="next" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <label>Confirm new password<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-primary" type="submit">Update Password</button>
    </form>`;
}

/* ---------------- Product form ---------------- */

function fillSelects() {
  const { categories, badges } = state.config;
  $('#categorySelect').innerHTML = categories.map(c => `<option>${esc(c)}</option>`).join('');
  $('#badgeSelect').innerHTML = badges.map(b => `<option value="${esc(b)}">${b || 'None'}</option>`).join('');
  $('#offerCategory').innerHTML = `<option value="All">All products</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}`;
  const groupNames = { material: 'Material', stone: 'Stones & style', skin: 'Skin', durability: 'Durability', fit: 'Fit', occasion: 'Occasion' };
  $('#hlPicker').innerHTML = Object.entries(state.config.highlightOptions).map(([group, options]) => `
    <div class="hl-group">
      <span>${groupNames[group] || group}</span>
      ${options.map(h => `<label class="hl-opt"><input type="checkbox" name="highlights" value="${esc(h)}"><i>${esc(h)}</i></label>`).join('')}
    </div>`).join('');
  $('#specFields').innerHTML = Object.entries(state.config.specFields).map(([key, label]) =>
    `<label>${esc(label)}<input name="spec_${key}" maxlength="200"></label>`).join('');
  const themes = state.config.offerThemes;
  $('#themePicker').innerHTML = Object.entries(themes).map(([key, bg]) =>
    `<button type="button" class="theme-dot" data-theme="${key}" style="background:${bg}" aria-label="${key}"></button>`).join('');
}

function openProductForm(product = null) {
  const form = $('#productForm');
  form.reset();
  state.editingProduct = product;
  state.removeImage = false;
  $('#productError').textContent = '';
  $('#productFormTitle').textContent = product ? 'Edit Product' : 'Add Product';
  if (product) {
    for (const key of ['name', 'category', 'badge', 'price', 'mrp', 'stock', 'description']) form.elements[key].value = product[key] ?? '';
    form.elements.available.checked = product.available;
    form.elements.imageUrl.value = /^https?:/.test(product.image) ? product.image : '';
    $$('#hlPicker input').forEach(cb => { cb.checked = (product.highlights || []).includes(cb.value); });
    for (const key of Object.keys(state.config.specFields)) form.elements[`spec_${key}`].value = product.specs?.[key] || '';
  }
  limitHighlights();
  updatePreview();
  openModal($('#productModal'));
  setTimeout(() => form.elements.name.focus(), 200);
}

// Allow at most 6 highlights: grey out the rest once 6 are ticked
function limitHighlights() {
  const boxes = $$('#hlPicker input');
  const picked = boxes.filter(b => b.checked).length;
  boxes.forEach(b => { b.disabled = !b.checked && picked >= 6; });
  $('#hlCount').textContent = picked
    ? `(${picked} of 6 selected)`
    : '(pick up to 6; if none, category defaults are shown)';
}

let previewUrl = '';
function updatePreview() {
  const form = $('#productForm');
  const file = $('#imgFile').files[0];
  const url = $('#imgUrl').value.trim();
  const p = state.editingProduct;
  let src;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  if (file) src = previewUrl = URL.createObjectURL(file);
  else if (/^https?:\/\//.test(url)) src = url;
  else if (p?.image && !state.removeImage) src = p.image;
  else src = JewelArt.url(form.elements.category.value, p?.id || 'new');
  $('#imgPreview').src = src;
  $('#imgRemove').hidden = !(file || url || (p?.image && !state.removeImage));
}

async function saveProduct(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  if (!$('#imgFile').files.length) fd.delete('image');
  fd.set('available', form.elements.available.checked ? 'true' : 'false');
  if (state.removeImage) fd.set('removeImage', 'true');
  if (state.editingProduct) fd.set('stockWas', String(state.editingProduct.stock));

  const btn = $('#productSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const p = state.editingProduct;
    await api(p ? `/api/admin/products/${p.id}` : '/api/admin/products', { method: p ? 'PUT' : 'POST', form: fd });
    closeModal($('#productModal'));
    toast(p ? 'Product updated ✨' : 'Product added ✨');
    await refresh();
  } catch (err) {
    $('#productError').textContent = err.message;
    $('#productModal .modal-body').scrollTop = 0;
    // Stock moved while editing: pick up the live value so the next save compares against it
    const p = state.editingProduct;
    if (p && /stock changed/i.test(err.message)) {
      try {
        const { products } = await api('/api/admin/products');
        const live = products.find(x => x.id === p.id);
        if (live) { p.stock = live.stock; $('#productForm').elements.stock.value = live.stock; }
      } catch { /* keep the message */ }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Product';
  }
}

async function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p || !(await confirmDialog('Delete product?', `"${p.name}" will be removed from the store permanently.`))) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    toast('Product deleted');
    await refresh();
  } catch (err) { toast(err.message, 'err'); }
}

async function patchProduct(id, body, message) {
  try {
    await api(`/api/admin/products/${id}`, { method: 'PATCH', body });
    toast(message);
    const [{ products }, stats] = await Promise.all([api('/api/admin/products'), api('/api/admin/stats')]);
    Object.assign(state, { products, stats });
  } catch (err) {
    toast(err.message, 'err');
  }
  // Redraw, but put focus back where the admin was working
  const active = document.activeElement;
  const keep = active?.dataset?.stock ? `[data-stock="${active.dataset.stock}"]`
    : active?.dataset?.avail ? `[data-avail="${active.dataset.avail}"]` : null;
  renderView();
  if (keep) $(keep)?.focus();
}

/* ---------------- Offer form ---------------- */

function openOfferForm(offer = null) {
  const form = $('#offerForm');
  form.reset();
  state.editingOffer = offer;
  $('#offerError').textContent = '';
  $('#offerFormTitle').textContent = offer ? 'Edit Offer' : 'New Offer';
  state.offerTheme = offer?.theme || 'rose';
  if (offer) {
    for (const key of ['title', 'subtitle', 'discount', 'category', 'endsAt']) form.elements[key].value = offer[key] ?? '';
    form.elements.active.checked = offer.active;
  }
  updateOfferPreview();
  openModal($('#offerModal'));
  setTimeout(() => form.elements.title.focus(), 200);
}

function updateOfferPreview() {
  const f = $('#offerForm').elements;
  $$('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === state.offerTheme));
  $('#offerPreview').style.background = state.config.offerThemes[state.offerTheme];
  $('#offerPreview').innerHTML = `
    <div class="pct">${esc(f.discount.value || 0)}% OFF</div>
    <h4>${esc(f.title.value || 'Your offer title')}</h4>
    <p>${esc(f.subtitle.value || 'Subtitle shows here')} · ${f.category.value === 'All' ? 'All products' : esc(f.category.value)}</p>`;
}

const offerBody = (form, extra = {}) => ({
  title: form.elements.title.value,
  subtitle: form.elements.subtitle.value,
  discount: Number(form.elements.discount.value),
  category: form.elements.category.value,
  endsAt: form.elements.endsAt.value,
  active: form.elements.active.checked,
  theme: state.offerTheme,
  ...extra,
});

async function saveOffer(e) {
  e.preventDefault();
  const o = state.editingOffer;
  const btn = e.submitter || e.target.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    await api(o ? `/api/admin/offers/${o.id}` : '/api/admin/offers', { method: o ? 'PUT' : 'POST', body: offerBody(e.target) });
    closeModal($('#offerModal'));
    toast(o ? 'Offer updated 🎉' : 'Offer created 🎉');
    await refresh();
  } catch (err) {
    $('#offerError').textContent = err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleOffer(id, active) {
  const o = state.offers.find(x => x.id === id);
  try {
    await api(`/api/admin/offers/${id}`, { method: 'PUT', body: { ...o, active } });
    toast(active ? 'Offer activated' : 'Offer paused');
    await refresh();
  } catch (err) { toast(err.message, 'err'); renderView(); }
}

async function deleteOffer(id) {
  const o = state.offers.find(x => x.id === id);
  if (!o || !(await confirmDialog('Delete offer?', `"${o.title}" will be removed and prices will go back to normal.`))) return;
  try {
    await api(`/api/admin/offers/${id}`, { method: 'DELETE' });
    toast('Offer deleted');
    await refresh();
  } catch (err) { toast(err.message, 'err'); }
}

/* ---------------- Orders & settings ---------------- */

async function updateOrderStatus(select) {
  const id = select.dataset.order;
  const status = select.value;
  if (status === 'Cancelled' && !(await confirmDialog('Cancel order?', `Order ${id} will be cancelled and its items returned to stock. This can't be undone.`, 'Cancel order'))) {
    renderView();
    return;
  }
  try {
    await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status } });
    toast(`Order ${id} → ${status}`);
    await refresh();
  } catch (err) { toast(err.message, 'err'); renderView(); }
}

async function changePassword(form) {
  const { current, next, confirm } = Object.fromEntries(new FormData(form));
  if (next !== confirm) { $('#pwError').textContent = 'New passwords do not match'; return; }
  try {
    await api('/api/admin/password', { method: 'POST', body: { current, next } });
    form.reset();
    $('#pwError').textContent = '';
    toast('Password updated 🔒');
    $('#pwWarning').hidden = true;
  } catch (err) { $('#pwError').textContent = err.message; }
}

/* ---------------- Events ---------------- */

function bindEvents() {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      $('#loginError').textContent = '';
      await showApp();
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch { toast('Network error, but you are signed out on this screen', 'err'); }
    showLogin();
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-close]');
    if (!t) return;
    const d = t.dataset;
    if ('close' in d && t.closest('#productModal, #offerModal, #postModal, #pageModal')) return closeModal(t.closest('.modal'));
    if (d.view) return switchView(d.view);
    if (d.go) return switchView(d.go);
    if (d.act === 'new-product') return openProductForm();
    if (d.act === 'new-offer') return openOfferForm();
    if (d.act === 'new-post') return openPostForm();
    if (d.postEdit) return openPostForm(state.posts.find(p => p.id === d.postEdit));
    if (d.postDel) return deletePost(d.postDel);
    if (d.md) return formatContent(d.md, t.closest('.md-toolbar'));
    if (d.pageEdit) return openPageForm(d.pageEdit);
    if (d.subDel) return deleteSubscriber(d.subDel);
    if (d.token) {
      const ta = $('#pageContent');
      ta.setRangeText(`{${d.token}}`, ta.selectionStart, ta.selectionEnd, 'end');
      return ta.focus();
    }
    if (d.edit) return openProductForm(state.products.find(p => p.id === d.edit));
    if (d.del) return deleteProduct(d.del);
    if (d.offerEdit) return openOfferForm(state.offers.find(o => o.id === d.offerEdit));
    if (d.offerDel) return deleteOffer(d.offerDel);
    if (d.theme) { state.offerTheme = d.theme; return updateOfferPreview(); }
    if (d.tileMove) { const [i, step] = d.tileMove.split(':').map(Number); return moveTile(i, step); }
    if (d.tileReset) return setTilePhoto(Number(d.tileReset), null, true);
    if (d.act === 'section-discard') { state.sectionDraft = null; return renderSection(); }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.avail) return patchProduct(t.dataset.avail, { available: t.checked }, t.checked ? 'Product is now available' : 'Product hidden from sale');
    if (t.dataset.stock) {
      const n = t.valueAsNumber;
      if (t.value.trim() === '' || !Number.isInteger(n) || n < 0) { toast('Enter a whole number, 0 or more', 'err'); return renderView(); }
      return patchProduct(t.dataset.stock, { stock: n }, 'Stock updated');
    }
    if (t.dataset.offerToggle) return toggleOffer(t.dataset.offerToggle, t.checked);
    if (t.dataset.order) return updateOrderStatus(t);
    if (t.dataset.tileShow) { state.sectionDraft.tiles[t.dataset.tileShow].visible = t.checked; return t.closest('tr').classList.toggle('tile-off', !t.checked); }
    if (t.dataset.tileFile && t.files[0]) return setTilePhoto(Number(t.dataset.tileFile), t.files[0]);
    if (t.id === 'productCat') { state.productCat = t.value; return renderProducts(); }
    if (t.id === 'productStock') { state.productStock = t.value; return renderProducts(); }
    if (t.id === 'orderStatus') { state.orderStatus = t.value; return renderOrders(); }
  });

  let searchTimer;
  document.addEventListener('input', e => {
    const d = e.target.dataset;
    if (e.target.id === 'productSearch') {
      state.productQuery = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        renderProducts();
        const box = $('#productSearch');
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }, 180);
    }
    if (e.target.id === 'subscriberSearch') {
      state.subscriberQuery = e.target.value;
      renderNewsletter();
    }
    if (d.sectionField) { state.sectionDraft[d.sectionField] = e.target.value; updateSectionPreview(); }
    if (d.tileLabel) state.sectionDraft.tiles[d.tileLabel].label = e.target.value;
  });

  document.addEventListener('submit', e => {
    if (e.target.id === 'passwordForm') { e.preventDefault(); changePassword(e.target); }
    if (e.target.id === 'sectionForm') { e.preventDefault(); saveSection(); }
    if (e.target.id === 'businessForm') { e.preventDefault(); saveBusiness(e.target); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#confirmModal.open')) return $('#confirmModal .btn-ghost').click(); // resolves "cancel"
      $$('#productModal.open, #offerModal.open, #postModal.open, #pageModal.open').forEach(closeModal);
    }
    if (e.key === 'Tab') {
      const box = $('.modal.open .modal-card');
      const f = box ? $$('button:not([disabled]), a[href], input:not([disabled]), select, textarea', box).filter(x => x.offsetParent) : [];
      if (f.length) {
        if (!box.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    }
    // Save stock with Enter instead of waiting for blur
    if (e.key === 'Enter' && e.target.dataset.stock) e.target.blur();
  });

  // Product form
  $('#productForm').addEventListener('submit', saveProduct);
  $('#imgFile').addEventListener('change', () => { $('#imgUrl').value = ''; state.removeImage = false; updatePreview(); });
  $('#imgUrl').addEventListener('input', () => { $('#imgFile').value = ''; updatePreview(); });
  $('#categorySelect').addEventListener('change', updatePreview);
  $('#hlPicker').addEventListener('change', limitHighlights);
  $('#imgRemove').addEventListener('click', () => {
    $('#imgFile').value = '';
    $('#imgUrl').value = '';
    state.removeImage = true;
    updatePreview();
  });

  // Blog post form
  $('#postForm').addEventListener('submit', savePost);
  $('#postForm').addEventListener('input', e => {
    if (e.target.name === 'slug') state.slugTouched = e.target.value.trim() !== '';
    if (['title', 'slug', 'metaDescription'].includes(e.target.name)) updateSeoPreview();
  });
  $('#postSlug').addEventListener('blur', e => { e.target.value = slugify(e.target.value); updateSeoPreview(); });
  $('#postImgFile').addEventListener('change', () => { $('#postImgUrl').value = ''; state.removePostImage = false; updatePostImage(); });
  $('#postImgUrl').addEventListener('input', () => { $('#postImgFile').value = ''; updatePostImage(); });
  $('#postImgRemove').addEventListener('click', () => {
    $('#postImgFile').value = '';
    $('#postImgUrl').value = '';
    state.removePostImage = true;
    updatePostImage();
  });
  $$('.md-toolbar input[type="file"]').forEach(input => input.addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) insertContentImage(file, $(`#${input.closest('.md-toolbar').dataset.target}`));
  }));

  // Page form
  $('#pageForm').addEventListener('submit', savePageForm);
  $('#pageForm').addEventListener('input', e => { if (['title', 'metaDescription'].includes(e.target.name)) updatePageSeo(); });
  $('#pageReset').addEventListener('click', resetPageForm);

  // Offer form
  $('#offerForm').addEventListener('submit', saveOffer);
  $('#offerForm').addEventListener('input', updateOfferPreview);
}

async function init() {
  bindEvents();
  try {
    state.config = await api('/api/config');
    fillSelects();
    const res = await fetch('/api/admin/me');
    if (res.ok) await showApp();
    else showLogin();
  } catch (err) {
    showLogin();
    $('#loginError').textContent = 'Could not reach the server. Is it running?';
  }
}

init();
