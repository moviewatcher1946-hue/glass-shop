const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '₱';
const money = (n) => CURRENCY + Number(n).toFixed(2);
const STATUS = { pending: 'Pending', packed: 'Packed - ready', completed: 'Completed', cancelled: 'Cancelled' };

let token = localStorage.token || '';
let user = JSON.parse(localStorage.user || 'null');
let cart = JSON.parse(localStorage.cart || '{}');
let products = [];
let view = 'shop';
let sig = '', lastOrderId = null, mineHtml = '', adminHtml = '', statusMap = null;

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
const setSession = (t, u) => { token = t; user = u; statusMap = null; localStorage.token = t; localStorage.user = JSON.stringify(u); };
const clearSession = () => { token = ''; user = null; statusMap = null; localStorage.removeItem('token'); localStorage.removeItem('user'); };
const isAdmin = () => user && user.role === 'admin';

/* ---------- Rendering ---------- */
function renderNav() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  $('#nav').innerHTML =
    `<button data-act="shop">Shop</button><button data-act="cart">Cart (${count})</button>` +
    (user ? '<button data-act="orders">My orders</button>' : '') +
    (isAdmin() ? '<button data-act="admin">Admin</button>' : '') +
    (user ? `<span class="pill">${esc(user.username)}</span><button data-act="logout">Log out</button>`
          : '<button class="primary" data-act="auth">Log in / Sign up</button>');
}

function renderShop() {
  $('#app').innerHTML = `<section class="grid">${products.map((p) => `
    <article class="card glass">
      <div class="img">${p.image_url ? `<img loading="lazy" src="${esc(p.image_url)}" alt="${esc(p.title)}">` : ''}
        ${p.is_sold_out ? '<span class="badge">Sold out</span>' : ''}</div>
      <h3>${esc(p.title)}</h3><p>${esc(p.description)}</p>
      <footer><b>${money(p.price)}</b>
        <button class="primary" data-act="add" data-id="${p.id}" ${p.is_sold_out ? 'disabled' : ''}>Add to cart</button></footer>
    </article>`).join('') || '<p class="panel glass">No products yet.</p>'}</section>`;
}

const productTable = () => `<table>${products.map((p) => `<tr>
    <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}</td>
    <td><b>${esc(p.title)}</b><br>${money(p.price)}${p.is_sold_out ? ' - sold out' : ''}</td>
    <td><div class="actions">
      <button data-act="edit" data-id="${p.id}">Edit</button>
      <button data-act="toggle" data-id="${p.id}">${p.is_sold_out ? 'Mark available' : 'Mark sold out'}</button>
      <button class="danger" data-act="delete" data-id="${p.id}">Delete</button></div></td></tr>`).join('')}</table>`;

function fillProducts() { const el = $('#plist'); if (el) el.innerHTML = productTable(); }

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
  const el = $('#olist');
  if (!el) return;
  const html = orders.length ? `<table>${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.username)}</td>
    <td>${(o.items || []).map((i) => `${i.quantity} x ${esc(i.title)}`).join(', ')}</td>
    <td>${money(o.total)}</td><td><span class="pill">${STATUS[o.status] || esc(o.status)}</span></td>
    <td><div class="actions">${adminBtns(o)}</div></td></tr>`).join('')}</table>` : '<p>No orders yet.</p>';
  if (html !== adminHtml) { adminHtml = html; el.innerHTML = html; }
}

function renderAdmin() {
  adminHtml = '';
  $('#app').innerHTML = `
    <section class="panel glass">
      <h2 id="form-title">Add a product</h2>
      <form id="pform">
        <div class="row"><div><label>Title</label><input name="title" required></div>
          <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required></div></div>
        <label>Description</label><textarea name="description" rows="3"></textarea>
        <label>Image (max 5 MB; leave empty to keep the current one)</label><input name="image" type="file" accept="image/*">
        <button class="primary" type="submit" id="save">Add product</button>
        <button type="button" data-act="reset-form">Clear</button>
      </form>
    </section>
    <section class="panel glass table-wrap"><h2>Products</h2><div id="plist"></div></section>
    <section class="panel glass table-wrap"><h2>Orders</h2><div id="olist"><p>Loading...</p></div></section>`;
  fillProducts();
  refreshOrders().catch(() => {});
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

function render() {
  renderNav();
  if (view === 'admin' && isAdmin()) renderAdmin();
  else if (view === 'orders' && user) renderOrders();
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

/* ---------- Actions ---------- */
const actions = {
  shop: () => { view = 'shop'; render(); },
  admin: () => { view = 'admin'; render(); },
  orders: () => { view = 'orders'; render(); },
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
    f.dataset.id = id; f.title.value = p.title; f.price.value = p.price; f.description.value = p.description;
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

/* ---------- Live updates (checks the server every 5 seconds) ---------- */
async function poll() {
  if (document.hidden) return;
  try {
    const fresh = await api('/api/products');
    const now = JSON.stringify(fresh);
    if (now !== sig) {
      sig = now; products = fresh;
      if (view === 'shop') renderShop(); else if (view === 'admin') fillProducts();
    }
    if (isAdmin()) await refreshOrders();
    if (user) { if (view === 'orders') await fillMine(); else await loadMine(); }
  } catch (e) { /* ignore network hiccups */ }
}
setInterval(poll, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

loadProducts().catch((e) => toast(e.message));
