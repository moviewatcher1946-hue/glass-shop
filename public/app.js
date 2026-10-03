const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '$';
const money = (n) => CURRENCY + Number(n).toFixed(2);
// Price after the product's % discount (the server works it out again when you order).
const fin = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_percent) || 0))) / 100;
const CATS = { drinks: 'Drinks', snacks: 'Snacks' };
const STATUS = { pending: 'Pending', packed: 'Packed', completed: 'Completed', cancelled: 'Cancelled' };
const CR_STATUS = { pending: 'Waiting for a price', quoted: 'Price offered', accepted: 'Accepted', declined: 'Declined', unavailable: "Can't provide" };

let token = localStorage.token || '';
let user = JSON.parse(localStorage.user || 'null');
let cart = JSON.parse(localStorage.cart || '{}');
let products = [];
let view = 'shop';
let searchText = '', catFilter = 'all';
const selected = new Set(); // products ticked in Admin for bulk changes
let combos = [], comboAdminHtml = '';
let promo = null, cartNote = '', settings = { banner: '', stamp_reward: 'a free snack' }, promoAdminHtml = '', myOrders = [];
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
// isAdmin = any staff account (raven or a seller); isRaven = the main admin, who controls everything.
const isAdmin = () => user && (user.role === 'admin' || user.role === 'seller');
const isRaven = () => user && user.role === 'admin';
let sellers = [], team = [];
const myProducts = () => (isRaven() ? products : products.filter((p) => p.owner_id === user.id));
const ownerName = (id) => (!user || id === user.id ? '' : (team.find((x) => x.id === id) || {}).username || '');
const canEdit = (ownerId) => isRaven() || (user && ownerId === user.id); // everyone on staff can look; only owners (and raven) can change

/* ---------- Rendering ---------- */
// Phone layout: big labelled buttons at the bottom, Log in + Cart on top, small extras in the footer.
function renderMobileNav() {
  const bn = $('#bottomnav');
  if (!bn) return;
  const on = (v) => (view === v ? 'on' : '');
  bn.innerHTML = `<button class="${on('shop')}" data-act="shop">Home</button>` + (isAdmin()
    ? `<button class="${on('admin')}" data-act="admin">Admin</button>`
    : `<button class="${on('custom')}" data-act="custom">Custom order</button>` +
      (user ? `<button class="${on('orders')}" data-act="orders">My orders</button>` : ''));
  $('#acct').innerHTML = user ? `<span class="pill">${esc(user.username)}</span>` : '<button class="primary" data-act="auth">Log in</button>';
  $('#foot').innerHTML = `<button id="foot-theme" type="button">${document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>` +
    (user ? '<button data-act="logout">Log out</button>' : '');
}

function renderNav() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const q = $('#cartq');
  if (q) q.textContent = `Cart (${count})`;
  $('#nav').innerHTML =
    `<button data-act="shop">Shop</button>${isAdmin() ? '' : '<button data-act="custom">Custom order</button>'}<button data-act="cart">Cart (${count})</button>` +
    (user && !isAdmin() ? '<button data-act="orders">My orders</button>' : '') +
    (isAdmin() ? '<button data-act="admin">Admin</button>' : '') +
    (user ? `<span class="pill">${esc(user.username)}</span><button data-act="logout">Log out</button>`
          : '<button class="primary" data-act="auth">Log in / Sign up</button>');
  renderMobileNav();
}

const productCard = (p) => {
  const off = Number(p.discount_percent) || 0;
  return `
    <article class="card glass">
      <div class="img">${p.image_url ? `<img loading="lazy" src="${esc(p.image_url)}" alt="${esc(p.title)}">` : ''}
        ${p.is_sold_out ? '<span class="badge">Sold out</span>' : ''}${off ? `<span class="badge off">-${off}%</span>` : ''}</div>
      <h3>${esc(p.title)}</h3><p>${esc(p.description)}</p>
      <footer><span>${off ? `<span class="was">${money(p.price)}</span> ` : ''}<b>${money(fin(p))}</b></span>
        <button class="primary" data-act="add" data-id="${p.id}" ${p.is_sold_out ? 'disabled' : ''}>Add to cart</button></footer>
    </article>`;
};

const comboCard = (c) => {
  const out = c.items.some((x) => x.is_sold_out);
  const regular = c.items.reduce((s, x) => s + fin(x) * x.quantity, 0);
  const save = regular - Number(c.price);
  const imgs = c.items.filter((x) => x.image_url).slice(0, 4).map((x) => `<img loading="lazy" src="${esc(x.image_url)}" alt="">`).join('');
  return `
    <article class="card glass">
      <div class="img"><div class="combo-imgs">${imgs}</div>
        ${out ? '<span class="badge">Sold out</span>' : save > 0 ? `<span class="badge off">Save ${money(save)}</span>` : ''}</div>
      <h3>${esc(c.title)}</h3>
      <p>${c.items.map((x) => `${x.quantity}x ${esc(x.title)}`).join(', ')}${c.description ? ' - ' + esc(c.description) : ''}</p>
      <footer><span>${save > 0 ? `<span class="was">${money(regular)}</span> ` : ''}<b>${money(c.price)}</b></span>
        <button class="primary" data-act="addcombo" data-id="${c.id}" ${out ? 'disabled' : ''}>Add to cart</button></footer>
    </article>`;
};

// Redraws only the product list, so the search box keeps focus while typing.
function fillGrid() {
  const el = $('#grid');
  if (!el) return;
  const text = searchText.trim().toLowerCase();
  const match = (p) => !text || `${p.title} ${p.description}`.toLowerCase().includes(text);
  const catOf = (p) => (CATS[p.category] ? p.category : 'snacks');
  const comboList = catFilter === 'all' || catFilter === 'combos'
    ? combos.filter((c) => match({ title: c.title, description: `${c.description} ${c.items.map((x) => x.title).join(' ')}` })) : [];
  const groups = Object.keys(CATS)
    .filter((c) => catFilter === 'all' || catFilter === c)
    .map((c) => ({ c, list: products.filter((p) => catOf(p) === c && match(p)) }))
    .filter((g) => g.list.length);
  el.innerHTML = (comboList.length ? `<h2 class="cat-title">Combos</h2><section class="grid">${comboList.map(comboCard).join('')}</section>` : '')
    + groups.map((g) => `<h2 class="cat-title">${CATS[g.c]}</h2><section class="grid">${g.list.map(productCard).join('')}</section>`).join('')
    || `<p class="panel glass">${products.length || combos.length ? 'No products match your search.' : 'No products yet.'}</p>`;
}

function fillBanner() {
  const el = $('#banner');
  if (el) el.innerHTML = settings.banner ? `<div class="banner glass">${esc(settings.banner)}</div>` : '';
}

function renderShop() {
  const chip = (id, label) => `<button class="${catFilter === id ? 'primary' : ''}" data-act="cat" data-cat="${id}">${label}</button>`;
  $('#app').innerHTML = `<div id="banner"></div><div class="toolbar">
      <input id="search" type="search" placeholder="Search products..." value="${esc(searchText)}" autocomplete="off">
      <div class="chips">${chip('all', 'All')}${chip('combos', 'Combos')}${Object.entries(CATS).map(([id, label]) => chip(id, label)).join('')}</div>
    </div><div id="grid"></div>`;
  fillBanner();
  fillGrid();
}

const productTable = () => `<table>${products.map((p) => {
  const mine = canEdit(p.owner_id);
  return `<tr>
    <td>${mine ? `<input type="checkbox" class="pick" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>` : ''}</td>
    <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}</td>
    <td><b>${esc(p.title)}</b><br>${money(p.price)}${p.discount_percent ? ` (-${p.discount_percent}%)` : ''} | ${CATS[p.category] || 'Snacks'}${p.is_sold_out ? ' - sold out' : ''}${ownerName(p.owner_id) ? ` | by ${esc(ownerName(p.owner_id))}` : ''}</td>
    <td>${mine ? `<div class="actions">
      <button data-act="edit" data-id="${p.id}">Edit</button>
      <button data-act="toggle" data-id="${p.id}">${p.is_sold_out ? 'Mark available' : 'Mark sold out'}</button>
      <button class="danger" data-act="delete" data-id="${p.id}">Delete</button></div>` : '<span class="muted">View only</span>'}</td></tr>`;
}).join('')}</table>`;

function updatePicks() {
  const n = $('#pickcount'); if (n) n.textContent = `${selected.size} selected`;
  const all = $('#pickall'); if (all) all.checked = myProducts().length > 0 && selected.size === myProducts().length;
}
function fillProducts() {
  for (const id of [...selected]) if (!myProducts().some((p) => p.id === id)) selected.delete(id);
  const el = $('#plist');
  if (el) el.innerHTML = productTable();
  updatePicks();
}

const adminBtns = (o) => {
  const btn = (st, label, cls) => `<button class="${cls}" data-act="setstatus" data-id="${o.id}" data-status="${st}">${label}</button>`;
  const parts = o.parts || [];
  // On a shared order each owner approves their own part; otherwise the buttons change the order directly.
  const me = parts.length > 1 ? parts.find((x) => x.owner_id === user.id) : null;
  if (me && o.status === 'cancelled') return '';
  const st = me ? me.status : o.status;
  if (st === 'pending') return btn('packed', me ? 'Approve: packed' : 'Mark packed', 'primary') + btn('cancelled', me ? 'Cancel my part' : 'Cancel', 'danger');
  if (st === 'packed') return btn('completed', me ? 'Approve: complete' : 'Complete', 'primary') + btn('cancelled', me ? 'Cancel my part' : 'Cancel', 'danger');
  return '';
};
const partsLine = (o) => ((o.parts || []).length > 1
  ? `<p class="muted" style="margin:8px 0 0">Shared order, needs approval from each seller: ${o.parts.map((x) => `${esc(x.username)} (${STATUS[x.status] || esc(x.status)})`).join(', ')}</p>` : '');

// One line per item with a bold amount, then promo and total.
const orderLines = (o) => `<ul class="lines">${(o.items || []).map((i) =>
    `<li><span>${i.quantity} x ${esc(i.title)}</span><b>${money(i.unit_price * i.quantity)}</b></li>`).join('')}</ul>
  ${Number(o.discount) > 0 ? `<div class="between muted" style="margin-top:6px"><span>Promo ${esc(o.promo_code)}</span><b>-${money(o.discount)}</b></div>` : ''}
  <div class="between total"><span>Total</span><b>${money(o.total)}</b></div>`;

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
  const html = orders.length ? orders.map((o) => `
    <section class="panel glass">
      <div class="between"><b>#${o.id} - ${esc(o.username)}</b><span class="pill st-${o.status}">${STATUS[o.status] || esc(o.status)}</span></div>
      <p class="muted" style="margin:2px 0 10px">${new Date(o.created_at).toLocaleString()}</p>
      ${orderLines(o)}
      ${partsLine(o)}
      ${o.note ? `<p class="muted" style="margin:8px 0 0">Note: ${esc(o.note)}</p>` : ''}
      <div class="actions" style="margin-top:12px">${adminBtns(o)}</div>
    </section>`).join('') : '<p>No orders yet.</p>';
  if (html !== adminHtml) { adminHtml = html; el.innerHTML = html; }
}

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
  const html = crList.length ? crList.map((r) => `<div class="req">
    <div class="between"><b>#${r.id} - ${esc(r.username)}</b><span class="pill st-${r.status}">${CR_STATUS[r.status] || esc(r.status)}</span></div>
    <p class="muted" style="margin:2px 0 8px">${new Date(r.created_at).toLocaleString()}</p>
    <p style="white-space:pre-wrap;margin:0 0 8px">${esc(r.description)}</p>
    ${r.quoted_price != null ? `<div class="between"><span>Price quoted</span><b>${money(r.quoted_price)}</b></div>` : ''}
    ${r.admin_note ? `<p class="muted" style="margin:6px 0 0">Your note: ${esc(r.admin_note)}</p>` : ''}
    ${r.status === 'pending' || r.status === 'quoted'
      ? `<div class="actions" style="margin-top:10px"><button class="primary" data-act="quote" data-id="${r.id}">${r.status === 'pending' ? 'Set price' : 'Change price'}</button></div>` : ''}
  </div>`).join('') : '<p>No custom requests yet.</p>';
  if (html !== customAdminHtml) { customAdminHtml = html; el.innerHTML = html; }
}

async function refreshAdminCombos() {
  const list = await api('/api/admin/combos');
  const el = $('#combolist');
  if (!el) return;
  const html = list.length ? `<table>${list.map((c) => `<tr>
      <td><b>${esc(c.title)}</b><br><span class="muted">${c.items.map((x) => `${x.quantity}x ${esc(x.title)}`).join(', ')}</span></td>
      <td>${money(c.price)}</td><td><span class="pill">${c.is_active ? 'Visible' : 'Hidden'}</span></td>
      <td><div class="actions"><button data-act="combo-toggle" data-id="${c.id}">${c.is_active ? 'Hide' : 'Show'}</button>
        <button class="danger" data-act="combo-delete" data-id="${c.id}">Delete</button></div></td></tr>`).join('')}</table>` : '<p>No combos yet.</p>';
  if (html !== comboAdminHtml) { comboAdminHtml = html; el.innerHTML = html; }
}

function updateComboSum() {
  const el = $('#combo-sum');
  if (!el) return;
  let sum = 0;
  document.querySelectorAll('#combo-form input[name="pid"]:checked').forEach((b) => {
    const p = products.find((x) => x.id == b.value);
    const q = Number(document.querySelector(`[data-qty="${b.value}"]`).value) || 1;
    if (p) sum += fin(p) * q;
  });
  el.textContent = sum ? `These items add up to ${money(sum)} at today's prices. Set the combo price lower to give a saving.` : '';
}

async function refreshAdminPromos() {
  const list = await api('/api/admin/promos');
  const el = $('#promolist');
  if (!el) return;
  const html = list.length ? `<table>${list.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${p.percent}% off</td>
      <td>${p.used_count}${p.max_uses ? ' / ' + p.max_uses : ''} used</td><td><span class="pill">${p.is_active ? 'On' : 'Off'}</span></td>
      <td>${canEdit(p.owner_id) ? `<div class="actions"><button data-act="promo-toggle" data-id="${p.id}">${p.is_active ? 'Turn off' : 'Turn on'}</button>
        <button class="danger" data-act="promo-delete" data-id="${p.id}">Delete</button></div>` : `<span class="muted">View only${p.owner ? ' (' + esc(p.owner) + ')' : ''}</span>`}</td></tr>`).join('')}</table>` : '<p>No promo codes yet.</p>';
  if (html !== promoAdminHtml) { promoAdminHtml = html; el.innerHTML = html; }
}

async function refreshTeam() {
  team = await api('/api/staff/team');
  fillProducts(); promoAdminHtml = ''; refreshAdminPromos().catch(() => {});
}
async function loadAlerts() {
  const a = await api('/api/staff/alerts');
  const i = $('#alert-topic'); if (i) i.value = a.ntfy_topic || '';
}

async function refreshSellers() {
  sellers = await api('/api/admin/sellers');
  const el = $('#sellerlist');
  if (el) el.innerHTML = sellers.length ? `<table>${sellers.map((x) => `<tr><td><b>${esc(x.username)}</b></td>
    <td><div class="actions"><button data-act="seller-pw" data-id="${x.id}">New password</button>
    <button class="danger" data-act="seller-del" data-id="${x.id}">Remove</button></div></td></tr>`).join('')}</table>` : '<p>No sellers yet.</p>';
  const ob = $('#ownerbox');
  if (ob) {
    const cur = ob.querySelector('select') ? ob.querySelector('select').value : '';
    ob.innerHTML = sellers.length ? `<label>Owner</label><select name="owner_id"><option value="${user.id}">Me (${esc(user.username)})</option>${sellers.map((x) => `<option value="${x.id}">${esc(x.username)}</option>`).join('')}</select>` : '';
    if (cur && ob.querySelector('select')) ob.querySelector('select').value = cur;
  }
  fillProducts();
}

function renderAdmin() {
  adminHtml = ''; customAdminHtml = '';
  const tab = (id, label, extra = '') =>
    `<button id="tab-${id}" class="${adminTab === id ? 'primary' : ''}" data-act="admintab" data-tab="${id}">${label}${extra}</button>`;
  const tabs = `<div class="tabs">${tab('products', 'Products')}${tab('orders', 'Orders', pendingCount ? ` (${pendingCount})` : '')}${tab('custom', 'Custom orders', pendingCustom ? ` (${pendingCustom})` : '')}${tab('combos', 'Combos')}${tab('promos', 'Promos')}${isRaven() ? tab('sellers', 'Sellers') + tab('backup', 'Backup') : tab('alerts', 'Alerts')}</div>`;
  const productsView = `
    <section class="panel glass">
      <h2 id="form-title">Add a product</h2>
      <form id="pform">
        <div class="row"><div><label>Title</label><input name="title" required></div>
          <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required></div></div>
        <div id="ownerbox"></div>
        <label>Category</label><select name="category"><option value="drinks">Drinks</option><option value="snacks">Snacks</option></select>
        <label>Discount % (0 for none)</label><input name="discount_percent" type="number" min="0" max="90" value="0">
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
        <input id="discpct" type="number" min="0" max="90" placeholder="% off" style="width:90px;margin:0">
        <button data-act="bulkdisc">Apply discount</button>
      </div>
      <div id="plist"></div></section>`;
  const ordersView = '<h2>Orders</h2><div id="olist"><p>Loading...</p></div>';
  const customView = '<section class="panel glass table-wrap"><h2>Custom orders</h2><div id="clist"><p>Loading...</p></div></section>';
  const combosView = `<section class="panel glass">
      <h2>Create a combo</h2>
      <form id="combo-form">
        <label>Combo name</label><input name="title" required maxlength="120" placeholder="e.g. Movie night snack pack">
        <label>Description (optional)</label><input name="description" maxlength="300">
        <label>Combo price</label><input name="price" type="number" step="0.01" min="0" required>
        <label>Tick the products and how many of each</label>
        <div class="picks">${myProducts().map((p) => `<label class="pickrow"><input type="checkbox" name="pid" value="${p.id}"> ${esc(p.title)} (${money(fin(p))})
          <input type="number" min="1" max="20" value="1" data-qty="${p.id}"></label>`).join('') || '<p>Add products first.</p>'}</div>
        <p class="muted" id="combo-sum"></p>
        <button class="primary" type="submit">Create combo</button>
      </form>
    </section>
    <section class="panel glass table-wrap"><h2>Combos</h2><div id="combolist"><p>Loading...</p></div></section>`;
  const promosView = `${isRaven() ? `<section class="panel glass">
      <h2>Announcement banner</h2>
      <form id="settings-form">
        <label>Text shown at the top of the shop (leave empty to hide)</label><input name="banner" maxlength="200" value="${esc(settings.banner)}">
        <label>Stamp card reward (earned after every 10 completed orders)</label><input name="stamp_reward" maxlength="80" value="${esc(settings.stamp_reward)}">
        <button class="primary" type="submit">Save</button>
      </form>
    </section>` : ''}
    <section class="panel glass">
      <h2>Create a promo code</h2>
      <form id="promo-form">
        <div class="row"><div><label>Code</label><input name="code" required maxlength="30" placeholder="e.g. WELCOME10"></div>
          <div><label>% off your items in the order</label><input name="percent" type="number" min="1" max="90" required></div></div>
        <label>Max uses in total (optional)</label><input name="max_uses" type="number" min="1">
        <button class="primary" type="submit">Create code</button>
      </form>
      <p class="muted">A code only discounts the items you sell. Each customer can use a code once.</p>
    </section>
    <section class="panel glass table-wrap"><h2>Promo codes</h2><div id="promolist"><p>Loading...</p></div></section>`;
  const sellersView = `<section class="panel glass">
      <h2>Add a seller</h2>
      <p class="muted">A seller can add and manage her own products, combos and promo codes and see orders for them. You can see and edit all of it.</p>
      <form id="seller-form">
        <label>Username</label><input name="username" required maxlength="30" autocomplete="off">
        <label>Password (8+ characters)</label><input name="password" type="password" required minlength="8" autocomplete="new-password">
        <button class="primary" type="submit">Create seller</button>
      </form>
    </section>
    <section class="panel glass table-wrap"><h2>Sellers</h2><div id="sellerlist"><p>Loading...</p></div></section>`;
  const alertsView = `<section class="panel glass">
      <h2>Phone alerts</h2>
      <p class="muted">Get an alert on your phone when someone orders your items, or when the other seller needs your approval on a shared order. Install the free ntfy app, subscribe to a topic name that only you know (make it long and random, like a password), then type the same name here.</p>
      <form id="alerts-form">
        <label>Your ntfy topic (empty turns alerts off)</label>
        <input id="alert-topic" name="ntfy_topic" maxlength="64" autocomplete="off" placeholder="e.g. her-shop-7f3k2m9x">
        <button class="primary" type="submit">Save</button>
      </form>
    </section>`;
  const backupView = `<section class="panel glass">
      <h2>Backup and restore</h2>
      <p>Download everything (products with photos, accounts, orders and custom requests) as one file. Keep it private, because it contains customer accounts.</p>
      <button class="primary" data-act="backup">Download backup</button>
      <hr style="border:0;border-top:1px solid var(--border);margin:22px 0">
      <p><b>Restore</b> replaces everything on the site with the contents of a backup file. Use it on a new, empty database.</p>
      <input id="bfile" type="file" accept=".json,application/json">
      <button class="danger" data-act="restore">Restore from backup</button>
    </section>`;
  $('#app').innerHTML = tabs + (adminTab === 'orders' ? ordersView : adminTab === 'custom' ? customView : adminTab === 'backup' && isRaven() ? backupView : adminTab === 'sellers' && isRaven() ? sellersView : adminTab === 'alerts' && !isRaven() ? alertsView : adminTab === 'combos' ? combosView : adminTab === 'promos' ? promosView : productsView);
  fillProducts();
  comboAdminHtml = ''; refreshAdminCombos().catch(() => {});
  promoAdminHtml = ''; refreshAdminPromos().catch(() => {});
  refreshOrders().catch(() => {});
  refreshCustom().catch(() => {});
  refreshTeam().catch(() => {});
  if (isRaven()) refreshSellers().catch(() => {}); else loadAlerts().catch(() => {});
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
  myOrders = orders;
  if (!el) return;
  const goal = 10, done = orders.filter((o) => o.status === 'completed').length, stamps = done % goal;
  const card = isAdmin() ? '' : `<section class="panel glass"><b>Stamp card</b>
      <p class="stamps">${'●'.repeat(stamps)}${'○'.repeat(goal - stamps)}</p>
      <p class="muted" style="margin:0">${done && !stamps
        ? `Reward ready! Show this to the seller to get ${esc(settings.stamp_reward)}.`
        : `${goal - stamps} more completed order${goal - stamps === 1 ? '' : 's'} to earn ${esc(settings.stamp_reward)}.`}</p></section>`;
  const html = card + (orders.map((o) => `
    <section class="panel glass">
      <div class="between"><b>Order #${o.id}</b><span class="pill st-${o.status}">${STATUS[o.status] || esc(o.status)}</span></div>
      <p class="muted" style="margin:2px 0 10px">${new Date(o.created_at).toLocaleString()}</p>
      ${o.status === 'packed' ? '<p class="ready">Your order is packed and ready!</p>' : ''}
      ${orderLines(o)}
      ${o.note ? `<p class="muted" style="margin:8px 0 0">Your note: ${esc(o.note)}</p>` : ''}
      <div class="actions" style="margin-top:12px">
        ${o.status === 'pending' ? `<button class="danger" data-act="cancel" data-id="${o.id}">Cancel order</button>` : ''}
        ${(o.items || []).some((i) => i.product_id) ? `<button data-act="reorder" data-id="${o.id}">Order again</button>` : ''}
      </div>
    </section>`).join('') || '<section class="panel glass"><p>You have no orders yet. Add something to your cart and place an order.</p></section>');
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
  else if (view === 'orders' && user && !isAdmin()) renderOrders();
  else if (view === 'custom' && !isAdmin()) renderCustom();
  else { view = 'shop'; renderShop(); }
}
async function loadProductsQuiet() {
  [products, combos, settings] = await Promise.all([api('/api/products'), api('/api/combos'), api('/api/settings')]);
  sig = JSON.stringify([products, combos, settings]);
}
async function loadProducts() {
  await loadProductsQuiet();
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
function cartLines() {
  return Object.entries(cart).map(([key, q]) => {
    if (key[0] === 'c') {
      const c = combos.find((x) => 'c' + x.id === key);
      return c && { key, title: 'Combo: ' + c.title, price: Number(c.price), q, owner: c.owner_id };
    }
    const p = products.find((x) => x.id == key);
    return p && { key, title: p.title, price: fin(p), q, owner: p.owner_id };
  }).filter(Boolean);
}
function cartDialog() {
  const lines = cartLines();
  const sub = lines.reduce((s, l) => s + l.price * l.q, 0);
  // A promo only discounts the items its owner sells.
  const base = !promo || promo.owner_id == null ? sub : lines.filter((l) => l.owner === promo.owner_id).reduce((s, l) => s + l.price * l.q, 0);
  const off = promo ? Math.round(base * promo.percent) / 100 : 0;
  $('#dlg').innerHTML = `<h2>Your cart</h2>${lines.map((l) => `<div class="cline"><span>${l.q} x ${esc(l.title)}</span><b>${money(l.price * l.q)}</b><button data-act="remove" data-id="${l.key}">Remove</button></div>`).join('') || '<p>Your cart is empty.</p>'}
    ${lines.length ? `<label>Promo code (optional)</label>
      <div class="actions"><input id="promoin" value="${esc(promo ? promo.code : '')}" placeholder="Enter code" style="flex:1;margin:0"><button data-act="applypromo">Apply</button></div>
      <label style="display:block;margin-top:12px">Note for the seller (your name, seat, anything helpful)</label>
      <input id="ordernote" maxlength="300" value="${esc(cartNote)}">` : ''}
    <p>Subtotal: <b>${money(sub)}</b>${off ? `<br>Promo ${esc(promo.code)} (-${promo.percent}%): <b>-${money(off)}</b>` : ''}<br><b>Total: ${money(sub - off)}</b></p>
    <p class="notice">Cash on delivery: you pay when your order is handed to you in class.</p>
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
  applypromo: async () => {
    if (!user) { authDialog(); return toast('Log in to use a promo code.'); }
    const code = $('#promoin').value.trim();
    if (!code) { promo = null; return cartDialog(); }
    promo = await api('/api/promos/check?code=' + encodeURIComponent(code));
    cartDialog(); toast(`${promo.percent}% off applied.`);
  },
  reorder: (id) => {
    const o = myOrders.find((x) => x.id == id);
    let added = 0;
    ((o && o.items) || []).forEach((i) => {
      const p = i.product_id && products.find((x) => x.id == i.product_id);
      if (p && !p.is_sold_out) { cart[p.id] = (cart[p.id] || 0) + i.quantity; added++; }
    });
    if (!added) return toast('Those items are not available right now.');
    saveCart(); cartDialog();
  },
  'seller-pw': async (id) => {
    const pw = prompt('New password for this seller (8+ characters):');
    if (!pw) return;
    await api(`/api/admin/sellers/${id}/password`, { method: 'PATCH', json: { password: pw } }); toast('Password changed.');
  },
  'seller-del': async (id) => {
    if (!confirm('Remove this seller? Her products, combos and promos will become yours.')) return;
    await api(`/api/admin/sellers/${id}`, { method: 'DELETE' }); await refreshSellers(); await loadProducts(); toast('Seller removed.');
  },
  'promo-toggle': async (id) => { await api(`/api/promos/${id}/active`, { method: 'PATCH' }); await refreshAdminPromos(); },
  'promo-delete': async (id) => {
    if (!confirm('Delete this promo code?')) return;
    await api(`/api/promos/${id}`, { method: 'DELETE' }); await refreshAdminPromos(); toast('Deleted.');
  },
  addcombo: (id) => { const k = 'c' + id; cart[k] = (cart[k] || 0) + 1; saveCart(); toast('Added to cart.'); },
  bulkdisc: async () => {
    if (!selected.size) return toast('Tick the products first.');
    const pct = $('#discpct').value;
    if (pct === '') return toast('Type the discount % first (0 removes it).');
    await api('/api/products/discount', { method: 'PATCH', json: { ids: [...selected], percent: pct } });
    selected.clear(); await loadProducts(); toast(Number(pct) ? `${pct}% discount applied.` : 'Discount removed.');
  },
  'combo-toggle': async (id) => { await api(`/api/combos/${id}/active`, { method: 'PATCH' }); await refreshAdminCombos(); await loadProductsQuiet(); },
  'combo-delete': async (id) => {
    if (!confirm('Delete this combo?')) return;
    await api(`/api/combos/${id}`, { method: 'DELETE' }); await refreshAdminCombos(); await loadProductsQuiet(); toast('Combo deleted.');
  },
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
    const r = await api(`/api/orders/${id}/status`, { method: 'PATCH', json: { status: d.status } });
    await refreshOrders();
    toast(r.waiting && r.waiting.length ? `Saved. Waiting for ${r.waiting.join(', ')} to approve too.`
      : d.status === 'packed' ? 'Marked packed. The customer is notified.' : 'Order updated.');
  },
  close: () => $('#dlg').close(),
  auth: authDialog,
  cart: cartDialog,
  logout: () => { clearSession(); view = 'shop'; render(); toast('Logged out.'); },
  add: (id) => { cart[id] = (cart[id] || 0) + 1; saveCart(); toast('Added to cart.'); },
  remove: (id) => { delete cart[id]; saveCart(); cartDialog(); },
  checkout: async () => {
    if (!user) { authDialog(); return toast('Log in to place your order.'); }
    const items = cartLines().map((l) => (l.key[0] === 'c' ? { combo_id: l.key.slice(1), quantity: l.q } : { product_id: l.key, quantity: l.q }));
    const o = await api('/api/orders', { method: 'POST', json: { items, promo: promo ? promo.code : '', note: cartNote } });
    cart = {}; promo = null; cartNote = ''; saveCart(); $('#dlg').close(); toast(`Order #${o.id} placed.`); view = 'orders'; render();
  },
  toggle: async (id) => { await api(`/api/products/${id}/sold-out`, { method: 'PATCH' }); await loadProducts(); },
  delete: async (id) => { if (confirm('Delete this product?')) { await api(`/api/products/${id}`, { method: 'DELETE' }); await loadProducts(); toast('Deleted.'); } },
  edit: (id) => {
    const p = products.find((x) => x.id == id), f = $('#pform');
    f.dataset.id = id; f.title.value = p.title; f.price.value = p.price; f.description.value = p.description; f.category.value = p.category || 'snacks'; f.discount_percent.value = p.discount_percent || 0; if (f.owner_id) f.owner_id.value = p.owner_id || user.id;
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
    } else if (e.target.id === 'combo-form') {
      const fd = Object.fromEntries(new FormData(e.target));
      const picked = [...e.target.querySelectorAll('input[name="pid"]:checked')]
        .map((b) => ({ product_id: b.value, quantity: Number(e.target.querySelector(`[data-qty="${b.value}"]`).value) || 1 }));
      if (!picked.length) throw new Error('Tick at least one product for the combo.');
      await api('/api/combos', { method: 'POST', json: { title: fd.title, description: fd.description, price: fd.price, items: picked } });
      e.target.reset(); updateComboSum(); await refreshAdminCombos(); await loadProductsQuiet(); toast('Combo created.');
    } else if (e.target.id === 'alerts-form') {
      await api('/api/staff/alerts', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
      toast('Alert settings saved.');
    } else if (e.target.id === 'seller-form') {
      await api('/api/admin/sellers', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      e.target.reset(); await refreshSellers(); toast('Seller created.');
    } else if (e.target.id === 'promo-form') {
      await api('/api/promos', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      e.target.reset(); await refreshAdminPromos(); toast('Promo code created.');
    } else if (e.target.id === 'settings-form') {
      await api('/api/admin/settings', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
      await loadProductsQuiet(); toast('Saved.');
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
    if (e.target.checked) myProducts().forEach((p) => selected.add(p.id));
    fillProducts();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { searchText = e.target.value; fillGrid(); }
  else if (e.target.id === 'ordernote') cartNote = e.target.value;
  else if (e.target.closest('#combo-form')) updateComboSum();
});

/* ---------- Live updates (checks the server every 5 seconds) ---------- */
async function poll() {
  if (document.hidden) return;
  try {
    const [fresh, freshCombos, freshSettings] = await Promise.all([api('/api/products'), api('/api/combos'), api('/api/settings')]);
    const now = JSON.stringify([fresh, freshCombos, freshSettings]);
    if (now !== sig) {
      sig = now; products = fresh; combos = freshCombos; settings = freshSettings;
      if (view === 'shop') { fillBanner(); fillGrid(); } else if (view === 'admin') fillProducts();
    }
    if (isAdmin()) { await refreshOrders(); await refreshCustom(); }
    if (user && !isAdmin()) {
      if (view === 'orders') await fillMine(); else await loadMine();
      if (view === 'custom') await fillCustomMine(); else await loadCustomMine();
    }
  } catch (e) { /* ignore network hiccups */ }
}
setInterval(poll, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

/* Phone layout elements (hidden on computers by the stylesheet). */
(() => {
  document.querySelector('.nav').insertAdjacentHTML('beforeend',
    '<div id="acct"></div><button id="cartq" class="primary" type="button" data-act="cart">Cart (0)</button>');
  document.body.insertAdjacentHTML('beforeend', '<footer id="foot"></footer><div id="bottomnav" class="glass"></div><button id="helpfab" type="button">Tutorial</button>');
  document.addEventListener('click', (e) => {
    if (e.target.closest('#helpfab')) $('#tour-btn').click();
    const th = e.target.closest('#foot-theme');
    if (th) { $('#theme').click(); th.textContent = document.documentElement.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; }
  });
  renderNav();
})();

loadProducts().catch((e) => toast(e.message));
