'use strict';
/* ==========================================================
   Glamora Jewels: admin panel
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

const openModal = el => el.classList.add('open');
const closeModal = el => el.classList.remove('open');

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
}

async function loadAll() {
  const [config, p, o, ord, stats, sec] = await Promise.all([
    state.config ? { ...state.config } : api('/api/config'),
    api('/api/admin/products'), api('/api/admin/offers'), api('/api/admin/orders'), api('/api/admin/stats'),
    api('/api/admin/category-section'),
  ]);
  Object.assign(state, { config, products: p.products, offers: o.offers, orders: ord.orders, stats, section: sec.section });
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
    orders: `<select id="orderStatus"><option value="All">All orders</option>${orderStatuses.map(s => `<option ${s === state.orderStatus ? 'selected' : ''}>${s}</option>`).join('')}</select>`,
    settings: '',
  };
  $('#topActions').innerHTML = actions[state.view];
}

function renderView() {
  ({ dashboard: renderDashboard, products: renderProducts, offers: renderOffers, homepage: renderSection, orders: renderOrders, settings: renderSettings })[state.view]();
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
            <td><label class="toggle"><input type="checkbox" data-avail="${p.id}" ${p.available ? 'checked' : ''}><span class="sw"></span></label></td>
            <td>${p.inStock ? '<span class="tag tag-ok">On sale</span>' : !p.available ? '<span class="tag tag-off">Hidden</span>' : '<span class="tag tag-off">Sold out</span>'}</td>
            <td><div class="row-actions">
              <button class="icon-action" data-edit="${p.id}" title="Edit">✏️</button>
              <button class="icon-action del" data-del="${p.id}" title="Delete">🗑️</button>
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
          <label class="toggle" title="Active"><input type="checkbox" data-offer-toggle="${o.id}" ${o.active ? 'checked' : ''}><span class="sw"></span></label>
          <button class="icon-action" data-offer-edit="${o.id}" title="Edit">✏️</button>
          <button class="icon-action del" data-offer-del="${o.id}" title="Delete">🗑️</button>
        </div>
      </div>
    </article>`).join('')}</div>
    <p class="muted" style="margin-top:14px">When several offers match a product, the biggest discount is applied automatically.</p>`
    : '<div class="table-wrap"><div class="empty-state"><div>🎉</div>No offers yet. Create one to start a sale!</div></div>';
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
              <td><label class="toggle" title="Show on store"><input type="checkbox" data-tile-show="${i}" ${t.visible ? 'checked' : ''}><span class="sw"></span></label></td>
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
            <td><select class="status-select" data-order="${o.id}" ${o.status === 'Cancelled' ? 'disabled' : ''}>
              ${state.config.orderStatuses.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
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

function updatePreview() {
  const form = $('#productForm');
  const file = $('#imgFile').files[0];
  const url = $('#imgUrl').value.trim();
  const p = state.editingProduct;
  let src;
  if (file) src = URL.createObjectURL(file);
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
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
    renderView();
  }
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
  try {
    await api(o ? `/api/admin/offers/${o.id}` : '/api/admin/offers', { method: o ? 'PUT' : 'POST', body: offerBody(e.target) });
    closeModal($('#offerModal'));
    toast(o ? 'Offer updated 🎉' : 'Offer created 🎉');
    await refresh();
  } catch (err) {
    $('#offerError').textContent = err.message;
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
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-close]');
    if (!t) return;
    const d = t.dataset;
    if ('close' in d && t.closest('#productModal, #offerModal')) return closeModal(t.closest('.modal'));
    if (d.view) return switchView(d.view);
    if (d.go) return switchView(d.go);
    if (d.act === 'new-product') return openProductForm();
    if (d.act === 'new-offer') return openOfferForm();
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
    if (t.dataset.stock) return patchProduct(t.dataset.stock, { stock: Number(t.value) }, 'Stock updated');
    if (t.dataset.offerToggle) return toggleOffer(t.dataset.offerToggle, t.checked);
    if (t.dataset.order) return updateOrderStatus(t);
    if (t.dataset.tileShow) { state.sectionDraft.tiles[t.dataset.tileShow].visible = t.checked; return t.closest('tr').classList.toggle('tile-off', !t.checked); }
    if (t.dataset.tileFile && t.files[0]) return setTilePhoto(Number(t.dataset.tileFile), t.files[0]);
    if (t.id === 'productCat') { state.productCat = t.value; return renderProducts(); }
    if (t.id === 'productStock') { state.productStock = t.value; return renderProducts(); }
    if (t.id === 'orderStatus') { state.orderStatus = t.value; return renderOrders(); }
  });

  document.addEventListener('input', e => {
    const d = e.target.dataset;
    if (e.target.id === 'productSearch') { state.productQuery = e.target.value; renderProducts(); }
    if (d.sectionField) { state.sectionDraft[d.sectionField] = e.target.value; updateSectionPreview(); }
    if (d.tileLabel) state.sectionDraft.tiles[d.tileLabel].label = e.target.value;
  });

  document.addEventListener('submit', e => {
    if (e.target.id === 'passwordForm') { e.preventDefault(); changePassword(e.target); }
    if (e.target.id === 'sectionForm') { e.preventDefault(); saveSection(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') $$('#productModal.open, #offerModal.open').forEach(closeModal);
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
