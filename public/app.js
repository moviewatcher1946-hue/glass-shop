const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '$';
const money = (n) => CURRENCY + Number(n).toFixed(2);
const CATS = { drinks: 'Drinks', snacks: 'Snacks' };
const STATUS = { pending: 'Pending', packed: 'Packed - ready', completed: 'Completed', cancelled: 'Cancelled' };
const CR_STATUS = { pending: 'Waiting for a price', quoted: 'Price offered', accepted: 'Accepted', declined: 'Declined', unavailable: "Can't provide" };

let token = localStorage.token || '';
let user = JSON.parse(localStorage.user || 'null');
let cart = JSON.parse(localStorage.cart || '{}');
let products = [];
let view = 'shop';
let searchText = '', catFilter = 'all';
const selected = new Set(); // products ticked in Admin for bulk changes
let sig = '', lastOrderId = null, mineHtml = '', adminHtml = '', statusMap = null, adminTab = 'products', pendingCount = 0;
let customHtml = '', customAdminHtml = '', crMap = null, crList = [], lastCrId = null, pendingCustom = 0;

async function api(url, { json, ...opt } = {}) {
  const headers = { ...(opt.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (json) { headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(json); }
  const r = await fetch(url, { ...opt, headers });
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed.');
  return d;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
const saveCart = () => { localStorage.cart = JSON.stringify(cart); renderNav(); };
const setSession = (t, u) => { token = t; user = u; statusMap = null; crMap = null; localStorage.token = t; localStorage.user = JSON.stringify(u); };
const clearSession = () => { token = ''; user = null; statusMap = null; crMap = null; localStorage.removeItem('token'); localStorage.removeItem('user'); };
const isAdmin = () => user && user.role === 'admin';

/* ---------- Rendering ---------- */
function renderNav() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  $('#nav').innerHTML =
    `<button data-act="shop">Shop</button><button data-act="custom">Custom order</button><button data-act="cart">Cart (${count})</button>` +
    (user ? '<button data-act="orders">My orders</button>' : '') +
    (isAdmin() ? '<button data-act="admin">Admin</button>' : '') +
    (user ? `<span class="pill">${esc(user.username)}</span><button data-act="logout">Log out</button>`
          : '<button class="primary" data-act="auth">Log in / Sign up</button>');
}

const productCard = (p) => `
    <article class="card glass">
      <div class="img">${p.image_url ? `<img loading="lazy" src="${esc(p.image_url)}" alt="${esc(p.title)}">` : ''}
        ${p.is_sold_out ? '<span class="badge">Sold out</span>' : ''}</div>
      <h3>${esc(p.title)}</h3><p>${esc(p.description)}</p>
      <footer><b>${money(p.price)}</b>
        <button class="primary" data-act="add" data-id="${p.id}" ${p.is_sold_out ? 'disabled' : ''}>Add to cart</button></footer>
    </article>`;

// Redraws only the product list, so the search box keeps focus while typing.
function fillGrid() {
  const el = $('#grid');
  if (!el) return;
  const text = searchText.trim().toLowerCase();
  const match = (p) => !text || `${p.title} ${p.description}`.toLowerCase().includes(text);
  const catOf = (p) => (CATS[p.category] ? p.category : 'snacks');
  const groups = Object.keys(CATS)
    .filter((c) => catFilter === 'all' || catFilter === c)
    .map((c) => ({ c, list: products.filter((p) => catOf(p) === c && match(p)) }))
    .filter((g) => g.list.length);
  el.innerHTML = groups.map((g) => `<h2 class="cat-title">${CATS[g.c]}</h2><section class="grid">${g.list.map(productCard).join('')}</section>`).join('')
    || `<p class="panel glass">${products.length ? 'No products match your search.' : 'No products yet.'}</p>`;
}

function renderShop() {
  const chip = (id, label) => `<button class="${catFilter === id ? 'primary' : ''}" data-act="cat" data-cat="${id}">${label}</button>`;
  $('#app').innerHTML = `<div class="toolbar">
      <input id="search" type="search" placeholder="Search products..." value="${esc(searchText)}" autocomplete="off">
      <div class="chips">${chip('all', 'All')}${Object.entries(CATS).map(([id, label]) => chip(id, label)).join('')}</div>
    </div><div id="grid"></div>`;
  fillGrid();
}

const productTable = () => `<table>${products.map((p) => `<tr>
    <td><input type="checkbox" class="pick" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}></td>
    <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}</td>
    <td><b>${esc(p.title)}</b><br>${money(p.price)} | ${CATS[p.category] || 'Snacks'}${p.is_sold_out ? ' - sold out' : ''}</td>
    <td><div class="actions">
      <button data-act="edit" data-id="${p.id}">Edit</button>
      <button data-act="toggle" data-id="${p.id}">${p.is_sold_out ? 'Mark available' : 'Mark sold out'}</button>
      <button class="danger" data-act="delete" data-id="${p.id}">Delete</button></div></td></tr>`).join('')}</table>`;

function updatePicks() {
  const n = $('#pickcount'); if (n) n.textContent = `${selected.size} selected`;
  const all = $('#pickall'); if (all) all.checked = products.length > 0 && selected.size === products.length;
}
function fillProducts() {
  for (const id of [...selected]) if (!products.some((p) => p.id === id)) selected.delete(id);
  const el = $('#plist');
  if (el) el.innerHTML = productTable();
  updatePicks();
}

const adminBtns = (o) => {
  const btn = (st, label, cls) => `<button class="${cls}" data-act="setstatus" data-id="${o.id}" data-status="${st}">${label}</button>`;
  if (o.status === 'pending') return btn('packed', 'Mark packed', 'primary') + btn('cancelled', 'Cancel', 'danger');
  if (o.status === 'packed') return btn('completed', 'Complete', 'primary') + btn('cancelled', 'Cancel', 'danger');
  return '';
};

async function refreshOrders() {
  const orders = await api('/api/orders');
  const top = orders.reduce((m, o) => Math.max(m, o.id), 0);
  if (lastOrderId !== null && top > lastOrderId) toast('New order received.');
  lastOrderId = top;
  pendingCount = orders.filter((o) => o.status === 'pending').length;
  const tb = $('#tab-orders');
  if (tb) tb.textContent = 'Orders' + (pendingCount ? ` (${pendingCount})` : '');
  const el = $('#olist');
  if (!el) return;
  const html = orders.length ? `<table>${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.username)}</td>
    <td>${(o.items || []).map((i) => `${i.quantity} x ${esc(i.title)}`).join(', ')}</td>
    <td>${money(o.total)}</td><td><span class="pill">${STATUS[o.status] || esc(o.status)}</span></td>
    <td><div class="actions">${adminBtns(o)}</div></td></tr>`).join('')}</table>` : '<p>No orders yet.</p>';
  if (html !== adminHtml) { adminHtml = html; el.innerHTML = html; }
}

/* Admin: custom requests */
async function refreshCustom() {
  crList = await api('/api/custom-requests');
  const top = crList.reduce((m, r) => Math.max(m, r.id), 0);
  if (lastCrId !== null && top > lastCrId) toast('New custom request received.');
  lastCrId = top;
  pendingCustom = crList.filter((r) => r.status === 'pending').length;
  const tb = $('#tab-custom');
  if (tb) tb.textContent = 'Custom orders' + (pendingCustom ? ` (${pendingCustom})` : '');
  const el = $('#clist');
  if (!el) return;
  const html = crList.length ? `<table>${crList.map((r) => `<tr><td>#${r.id}</td><td>${esc(r.username)}</td>
    <td style="white-space:pre-wrap;min-width:200px">${esc(r.description)}${r.admin_note ? `<br><small style="color:var(--muted)">Your note: ${esc(r.admin_note)}</small>` : ''}</td>
    <td>${r.quoted_price != null ? money(r.quoted_price) : ''}</td>
    <td><span class="pill">${CR_STATUS[r.status] || esc(r.status)}</span></td>
    <td><div class="actions">${r.status === 'pending' || r.status === 'quoted'
      ? `<button class="primary" data-act="quote" data-id="${r.id}">${r.status === 'pending' ? 'Set price' : 'Change price'}</button>` : ''}</div></td></tr>`).join('')}</table>`
    : '<p>No custom requests yet.</p>';
  if (html !== customAdminHtml) { customAdminHtml = html; el.innerHTML = html; }
}

function renderAdmin() {
  adminHtml = ''; customAdminHtml = '';
  const tab = (id, label, extra = '') =>
    `<button id="tab-${id}" class="${adminTab === id ? 'primary' : ''}" data-act="admintab" data-tab="${id}">${label}${extra}</button>`;
  const tabs = `<div class="tabs">${tab('products', 'Products')}${tab('orders', 'Orders', pendingCount ? ` (${pendingCount})` : '')}${tab('custom', 'Custom orders', pendingCustom ? ` (${pendingCustom})` : '')}${tab('backup', 'Backup')}</div>`;
  const productsView = `
    <section class="panel glass">
      <h2 id="form-title">Add a product</h2>
      <form id="pform">
        <div class="row"><div><label>Title</label><input name="title" required></div>
          <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required></div></div>
        <label>Category</label><select name="category"><option value="drinks">Drinks</option><option value="snacks">Snacks</option></select>
        <label>Description</label><textarea name="description" rows="3"></textarea>
        <label>Image (max 5 MB; leave empty to keep the current one)</label><input name="image" type="file" accept="image/*">
        <button class="primary" type="submit" id="save">Add product</button>
        <button type="button" data-act="reset-form">Clear</button>
      </form>
    </section>
    <section class="panel glass table-wrap"><h2>Products</h2>
      <div class="bulk">
        <label><input type="checkbox" id="pickall"> Select all</label>
        <span id="pickcount" class="muted">0 selected</span>
        <button data-act="bulk" data-cat="drinks">Move to Drinks</button>
        <button data-act="bulk" data-cat="snacks">Move to Snacks</button>
      </div>
      <div id="plist"></div></section>`;
  const ordersView = '<section class="panel glass table-wrap"><h2>Orders</h2><div id="olist"><p>Loading...</p></div></section>';
  const customView = '<section class="panel glass table-wrap"><h2>Custom orders</h2><div id="clist"><p>Loading...</p></div></section>';
  const backupView = `<section class="panel glass">
      <h2>Backup and restore</h2>
      <p>Download everything (products with photos, accounts, orders and custom requests) as one file. Keep it private, because it contains customer accounts.</p>
      <button class="primary" data-act="backup">Download backup</button>
      <hr style="border:0;border-top:1px solid var(--border);margin:22px 0">
      <p><b>Restore</b> replaces everything on the site with the contents of a backup file. Use it on a new, empty database.</p>
      <input id="bfile" type="file" accept=".json,application/json">
      <button class="danger" data-act="restore">Restore from backup</button>
    </section>`;
  $('#app').innerHTML = tabs + (adminTab === 'orders' ? ordersView : adminTab === 'custom' ? customView : adminTab === 'backup' ? backupView : productsView);
  fillProducts();
  refreshOrders().catch(() => {});
  refreshCustom().catch(() => {});
}

async function loadMine() {
  const orders = await api('/api/orders/mine');
  if (statusMap) orders.forEach((o) => {
    if (statusMap[o.id] && statusMap[o.id] !== o.status && o.status === 'packed') toast(`Order #${o.id} is packed and ready.`);
  });
  statusMap = Object.fromEntries(orders.map((o) => [o.id, o.status]));
  return orders;
}

async function fillMine() {
  const el = $('#mine');
  const orders = await loadMine();
  if (!el) return;
  const html = orders.map((o) => `
    <section class="panel glass">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b>Order #${o.id}</b><span class="pill">${STATUS[o.status] || esc(o.status)}</span></div>
      <p style="color:var(--muted);margin:4px 0 12px">${new Date(o.created_at).toLocaleString()}</p>
      <table>${(o.items || []).map((i) => `<tr><td>${i.quantity} x ${esc(i.title)}</td>
        <td style="text-align:right">${money(i.unit_price * i.quantity)}</td></tr>`).join('')}</table>
      <p style="text-align:right;margin:12px 0 0"><b>Total: ${money(o.total)}</b></p>
      ${o.status === 'pending' ? `<button class="danger" data-act="cancel" data-id="${o.id}">Cancel order</button>` : ''}
    </section>`).join('') || '<section class="panel glass"><p>You have no orders yet. Add something to your cart and place an order.</p></section>';
  if (html !== mineHtml) { mineHtml = html; el.innerHTML = html; }
}

function renderOrders() {
  mineHtml = '';
  $('#app').innerHTML = '<h2>My orders</h2><div id="mine"></div>';
  fillMine().catch(() => {});
}

/* Customer: custom requests */
async function loadCustomMine() {
  const list = await api('/api/custom-requests/mine');
  if (crMap) list.forEach((r) => {
    if (crMap[r.id] && crMap[r.id] !== r.status) {
      if (r.status === 'quoted') toast(`Custom request #${r.id} has a price.`);
      if (r.status === 'unavailable') toast(`Custom request #${r.id}: we can't provide this one.`);
    }
  });
  crMap = Object.fromEntries(list.map((r) => [r.id, r.status]));
  return list;
}

async function fillCustomMine() {
  const el = $('#cmine');
  const list = await loadCustomMine();
  if (!el) return;
  const html = list.map((r) => `
    <section class="panel glass">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b>Request #${r.id}</b><span class="pill">${CR_STATUS[r.status] || esc(r.status)}</span></div>
      <p style="color:var(--muted);margin:4px 0 12px">${new Date(r.created_at).toLocaleString()}</p>
      <p style="white-space:pre-wrap;margin:0 0 12px">${esc(r.description)}</p>
      ${r.status === 'quoted' ? `<p style="margin:0 0 6px"><b>Price: ${money(r.quoted_price)}</b>
        <span style="color:var(--muted);font-size:.9rem"> (external charges may apply)</span></p>` : ''}
      ${r.admin_note ? `<p style="margin:0 0 12px"><span style="color:var(--muted)">Note:</span> ${esc(r.admin_note)}</p>` : ''}
      ${r.status === 'quoted' ? `<button class="primary" data-act="crespond" data-id="${r.id}" data-accept="1">Accept price</button>
        <button class="danger" data-act="crespond" data-id="${r.id}" data-accept="0">Decline</button>` : ''}
    </section>`).join('') || '<section class="panel glass"><p>You have not sent any custom requests yet.</p></section>';
  if (html !== customHtml) { customHtml = html; el.innerHTML = html; }
}

function renderCustom() {
  customHtml = '';
  const form = user ? `<form id="cform">
      <label>What would you like?</label>
      <textarea name="description" rows="5" required minlength="10" maxlength="2000"
        placeholder="Describe it: what it is, size, colors, quantity, anything that matters..."></textarea>
      <button class="primary" type="submit">Send request</button>
    </form>` : `<p>Please log in to send a custom request.</p>
    <button class="primary" data-act="auth">Log in / Sign up</button>`;
  $('#app').innerHTML = `<h2>Custom order</h2>
    <section class="panel glass">
      <p style="margin-top:0">Can't find what you're looking for? Tell us what you want and we'll reply with a price, or let you know if we can't provide it.</p>
      <p style="padding:10px 14px;border-radius:12px;border:1px dashed var(--acc2);background:rgba(124,58,237,.08);font-size:.92rem">
        <b>Please note:</b> external charges may apply to custom orders. The price we send back is the one that counts, and you can accept or decline it.</p>
      ${form}
    </section>
    ${user ? '<h2>My custom requests</h2><div id="cmine"></div>' : ''}`;
  if (user) fillCustomMine().catch(() => {});
}

function render() {
  renderNav();
  if (view === 'admin' && isAdmin()) renderAdmin();
  else if (view === 'orders' && user) renderOrders();
  else if (view === 'custom') renderCustom();
  else { view = 'shop'; renderShop(); }
}
async function loadProducts() {
  products = await api('/api/products');
  sig = JSON.stringify(products);
  render();
}

/* ---------- Dialogs ---------- */
function authDialog() {
  $('#dlg').innerHTML = `<h2>Welcome</h2><form data-form="auth">
    <label>Username</label><input name="username" required autocomplete="username">
    <label>Password (8+ characters to sign up)</label><input name="password" type="password" required autocomplete="current-password">
    <button class="primary" data-mode="login">Log in</button>
    <button data-mode="signup">Create account</button>
    <button type="button" data-act="close">Cancel</button></form>`;
  $('#dlg').showModal();
}
function cartDialog() {
  const lines = Object.entries(cart).map(([id, q]) => ({ p: products.find((x) => x.id == id), q })).filter((l) => l.p);
  const total = lines.reduce((s, l) => s + Number(l.p.price) * l.q, 0);
  $('#dlg').innerHTML = `<h2>Your cart</h2>${lines.map((l) => `<p>${l.q} x ${esc(l.p.title)} - ${money(l.p.price * l.q)}
      <button data-act="remove" data-id="${l.p.id}">Remove</button></p>`).join('') || '<p>Your cart is empty.</p>'}
    <p><b>Total: ${money(total)}</b></p>
    <button class="primary" data-act="checkout" ${lines.length ? '' : 'disabled'}>Place order</button>
    <button data-act="close">Close</button>`;
  $('#dlg').showModal();
}
function quoteDialog(id) {
  const r = crList.find((x) => x.id == id);
  if (!r) return;
  $('#dlg').innerHTML = `<h2>Custom request #${r.id}</h2>
    <p style="color:var(--muted);margin-top:0">From ${esc(r.username)}</p>
    <p style="white-space:pre-wrap">${esc(r.description)}</p>
    <form data-form="quote" data-id="${r.id}">
      <label>Your price (${CURRENCY})</label>
      <input name="price" type="number" step="0.01" min="0" value="${r.quoted_price != null ? esc(r.quoted_price) : ''}">
      <label>Note to the customer (optional)</label>
      <textarea name="note" rows="3">${esc(r.admin_note)}</textarea>
      <button class="primary" data-mode="quote">Send price</button>
      <button class="danger" data-mode="unavailable" formnovalidate>Can't provide this</button>
      <button type="button" data-act="close">Cancel</button>
    </form>`;
  $('#dlg').showModal();
}

/* ---------- Actions ---------- */
const actions = {
  shop: () => { view = 'shop'; render(); },
  cat: (id, d) => { catFilter = d.cat; renderShop(); },
  bulk: async (id, d) => {
    if (!selected.size) return toast('Tick the products you want to move first.');
    await api('/api/products/category', { method: 'PATCH', json: { ids: [...selected], category: d.cat } });
    selected.clear(); await loadProducts(); toast(`Moved to ${CATS[d.cat]}.`);
  },
  admin: () => { view = 'admin'; render(); },
  orders: () => { view = 'orders'; render(); },
  custom: () => { view = 'custom'; render(); },
  admintab: (id, d) => { adminTab = d.tab; renderAdmin(); },
  quote: (id) => quoteDialog(id),
  backup: async () => {
    const r = await fetch('/api/admin/export', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Backup failed.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await r.blob());
    link.download = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    toast('Backup downloaded. Keep the file somewhere safe.');
  },
  restore: async () => {
    const f = $('#bfile').files[0];
    if (!f) return toast('Choose a backup file first.');
    if (!confirm('This REPLACES everything on the site (products, accounts, orders, requests) with the backup. Continue?')) return;
    toast('Restoring... please wait.');
    const r = await fetch('/api/admin/import', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: await f.text(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Restore failed.');
    clearSession(); view = 'shop'; await loadProducts(); toast('Restored. Please log in again.');
  },
  crespond: async (id, d) => {
    const accept = d.accept === '1';
    if (!accept && !confirm('Decline this price?')) return;
    await api(`/api/custom-requests/${id}/respond`, { method: 'PATCH', json: { accept } });
    await fillCustomMine(); toast(accept ? 'Price accepted.' : 'Price declined.');
  },
  cancel: async (id) => {
    if (!confirm('Cancel this order?')) return;
    await api(`/api/orders/${id}/cancel`, { method: 'PATCH' }); await fillMine(); toast('Order cancelled.');
  },
  setstatus: async (id, d) => {
    if (d.status === 'cancelled' && !confirm('Cancel this order?')) return;
    await api(`/api/orders/${id}/status`, { method: 'PATCH', json: { status: d.status } });
    await refreshOrders(); toast(d.status === 'packed' ? 'Marked packed. The customer is notified.' : 'Order updated.');
  },
  close: () => $('#dlg').close(),
  auth: authDialog,
  cart: cartDialog,
  logout: () => { clearSession(); view = 'shop'; render(); toast('Logged out.'); },
  add: (id) => { cart[id] = (cart[id] || 0) + 1; saveCart(); toast('Added to cart.'); },
  remove: (id) => { delete cart[id]; saveCart(); cartDialog(); },
  checkout: async () => {
    if (!user) { authDialog(); return toast('Log in to place your order.'); }
    const items = Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity }));
    const o = await api('/api/orders', { method: 'POST', json: { items } });
    cart = {}; saveCart(); $('#dlg').close(); toast(`Order #${o.id} placed.`); view = 'orders'; render();
  },
  toggle: async (id) => { await api(`/api/products/${id}/sold-out`, { method: 'PATCH' }); await loadProducts(); },
  delete: async (id) => { if (confirm('Delete this product?')) { await api(`/api/products/${id}`, { method: 'DELETE' }); await loadProducts(); toast('Deleted.'); } },
  edit: (id) => {
    const p = products.find((x) => x.id == id), f = $('#pform');
    f.dataset.id = id; f.title.value = p.title; f.price.value = p.price; f.description.value = p.description; f.category.value = p.category || 'snacks';
    $('#form-title').textContent = 'Edit product'; $('#save').textContent = 'Save changes';
    f.scrollIntoView({ behavior: 'smooth' });
  },
  'reset-form': () => renderAdmin(),
};

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !actions[b.dataset.act]) return;
  try { await actions[b.dataset.act](b.dataset.id, b.dataset); } catch (err) { toast(err.message); }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (e.target.dataset.form === 'auth') {
      const mode = e.submitter.dataset.mode;
      const d = await api(`/api/auth/${mode}`, { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      setSession(d.token, d.user); $('#dlg').close(); render(); toast(`Welcome, ${d.user.username}.`);
    } else if (e.target.dataset.form === 'quote') {
      const fd = Object.fromEntries(new FormData(e.target));
      const unavailable = e.submitter.dataset.mode === 'unavailable';
      await api(`/api/custom-requests/${e.target.dataset.id}/quote`, {
        method: 'PATCH', json: { price: fd.price, note: fd.note, unavailable },
      });
      $('#dlg').close(); await refreshCustom();
      toast(unavailable ? 'Marked as not available.' : 'Price sent to the customer.');
    } else if (e.target.id === 'cform') {
      const description = new FormData(e.target).get('description');
      await api('/api/custom-requests', { method: 'POST', json: { description } });
      e.target.reset(); await fillCustomMine(); toast('Request sent. We will reply with a price.');
    } else if (e.target.id === 'pform') {
      const id = e.target.dataset.id;
      const fd = new FormData(e.target);
      if (!fd.get('image').size) fd.delete('image');
      await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: fd });
      await loadProducts(); toast(id ? 'Changes saved.' : 'Product added.');
    }
  } catch (err) { toast(err.message); }
});

// Close the dialog when clicking the dimmed backdrop
$('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg')) $('#dlg').close(); });

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('pick')) {
    const id = Number(e.target.value);
    if (e.target.checked) selected.add(id); else selected.delete(id);
    updatePicks();
  } else if (e.target.id === 'pickall') {
    selected.clear();
    if (e.target.checked) products.forEach((p) => selected.add(p.id));
    fillProducts();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { searchText = e.target.value; fillGrid(); }
});

/* ---------- Live updates (checks the server every 5 seconds) ---------- */
async function poll() {
  if (document.hidden) return;
  try {
    const fresh = await api('/api/products');
    const now = JSON.stringify(fresh);
    if (now !== sig) {
      sig = now; products = fresh;
      if (view === 'shop') fillGrid(); else if (view === 'admin') fillProducts();
    }
    if (isAdmin()) { await refreshOrders(); await refreshCustom(); }
    if (user) {
      if (view === 'orders') await fillMine(); else await loadMine();
      if (view === 'custom') await fillCustomMine(); else await loadCustomMine();
    }
  } catch (e) { /* ignore network hiccups */ }
}
setInterval(poll, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

loadProducts().catch((e) => toast(e.message));
