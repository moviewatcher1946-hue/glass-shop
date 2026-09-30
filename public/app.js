const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '$';
const money = (n) => CURRENCY + Number(n).toFixed(2);

let token = localStorage.token || '';
let user = JSON.parse(localStorage.user || 'null');
let cart = JSON.parse(localStorage.cart || '{}');
let products = [];
let view = 'shop';

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
const setSession = (t, u) => { token = t; user = u; localStorage.token = t; localStorage.user = JSON.stringify(u); };
const clearSession = () => { token = ''; user = null; localStorage.removeItem('token'); localStorage.removeItem('user'); };
const isAdmin = () => user && user.role === 'admin';

/* ---------- Rendering ---------- */
function renderNav() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  $('#nav').innerHTML =
    `<button data-act="shop">Shop</button><button data-act="cart">Cart (${count})</button>` +
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

async function renderAdmin() {
  const orders = await api('/api/orders').catch(() => []);
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
    <section class="panel glass table-wrap"><h2>Products</h2><table>
      ${products.map((p) => `<tr>
        <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}</td>
        <td><b>${esc(p.title)}</b><br>${money(p.price)}${p.is_sold_out ? ' - sold out' : ''}</td>
        <td><div class="actions">
          <button data-act="edit" data-id="${p.id}">Edit</button>
          <button data-act="toggle" data-id="${p.id}">${p.is_sold_out ? 'Mark available' : 'Mark sold out'}</button>
          <button class="danger" data-act="delete" data-id="${p.id}">Delete</button></div></td></tr>`).join('')}
    </table></section>
    <section class="panel glass table-wrap"><h2>Orders</h2>${orders.length ? `<table>
      ${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.username)}</td>
        <td>${(o.items || []).map((i) => `${i.quantity} x ${esc(i.title)}`).join(', ')}</td>
        <td>${money(o.total)}</td><td>${esc(o.status)}</td></tr>`).join('')}</table>` : '<p>No orders yet.</p>'}</section>`;
}

function render() {
  renderNav();
  if (view === 'admin' && isAdmin()) renderAdmin(); else { view = 'shop'; renderShop(); }
}
async function loadProducts() {
  products = await api('/api/products');
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
    cart = {}; saveCart(); $('#dlg').close(); toast(`Order #${o.id} placed.`);
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
  try { await actions[b.dataset.act](b.dataset.id); } catch (err) { toast(err.message); }
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

loadProducts().catch((e) => toast(e.message));
