const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '₱';
const money = (n) => CURRENCY + Number(n).toFixed(2);
// Price after the product's % discount (the server works it out again when you order).
const fin = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_percent) || 0))) / 100;
const LOW_STOCK = 5;
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
let ordersCache = [], shownOrders = [], ordStatus = 'active', ordRange = 'all', ordDay = '', custHtml = '';
let promo = null, cartNote = '', settings = { banner: '', stamp_reward: 'a free snack' }, promoAdminHtml = '', myOrders = [];
let sig = '', lastOrderId = null, mineHtml = '', adminHtml = '', statusMap = null, adminTab = 'products', pendingCount = 0;
let ordSearch = '', costMap = {}, repData = null;
let customHtml = '', customAdminHtml = '', crMap = null, crList = [], lastCrId = null, pendingCustom = 0;

// A random ID this browser keeps, so the server can limit how many accounts one device makes.
const deviceId = () => {
  try {
    if (!localStorage.deviceId) localStorage.deviceId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    return localStorage.deviceId;
  } catch (e) { return 'nostorage-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
};
async function api(url, { json, ...opt } = {}) {
  const headers = { ...(opt.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (json) { headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(json); }
  const r = await fetch(url, { ...opt, headers });
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 403 && /new password first/i.test(d.error || '')) changePwDialog();
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
      ${!p.is_sold_out && p.stock != null && p.stock <= LOW_STOCK ? `<p class="muted"><b>Only ${p.stock} left</b></p>` : ''}
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
    <td><b>${esc(p.title)}</b><br>${money(p.price)}${p.discount_percent ? ` (-${p.discount_percent}%)` : ''} | ${CATS[p.category] || 'Snacks'}${mine && costMap[p.id] != null ? ` | Profit ${money(fin(p) - Number(costMap[p.id]))} each` : ''}${p.stock != null ? ` | Stock: ${p.stock}${p.stock > 0 && p.stock <= LOW_STOCK ? ' (low!)' : ''}` : ''}${p.is_sold_out ? ' - sold out' : ''}${ownerName(p.owner_id) ? ` | by ${esc(ownerName(p.owner_id))}` : ''}</td>
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
  const lb = $('#lowbox');
  if (lb) {
    const m = myProducts().filter((p) => p.stock != null), out = m.filter((p) => p.stock === 0), low = m.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK);
    lb.innerHTML = out.length || low.length ? `<section class="panel glass">${low.length ? `<p style="margin:0"><b>Running low:</b> ${low.map((p) => `${esc(p.title)} (${p.stock})`).join(', ')}</p>` : ''}${out.length ? `<p style="margin:0"><b>Sold out:</b> ${out.map((p) => esc(p.title)).join(', ')}</p>` : ''}</section>` : '';
  }
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

// The status that matters to me: my own part on a shared order, otherwise the order's status.
const statusOf = (o) => {
  if (o.status === 'cancelled') return 'cancelled';
  const me = (o.parts || []).length > 1 ? o.parts.find((x) => x.owner_id === user.id) : null;
  return me ? me.status : o.status;
};

const paidTag = (o) => (o.paid_by ? `<span class="pill st-packed">Paid - ${esc(o.paid_name || '')}</span>`
  : ['packed', 'completed'].includes(o.status) ? `<span class="pill st-cancelled">Not paid yet</span>` : '');
const paidBtn = (o) => (!['packed', 'completed'].includes(o.status) ? ''
  : !o.paid_by ? `<button class="primary" data-act="paid" data-id="${o.id}" data-paid="1">Mark paid (cash in hand)</button>`
  : o.paid_by === user.id || isRaven() ? `<button data-act="paid" data-id="${o.id}" data-paid="0">Undo paid</button>` : '');
const orderCard = (o) => `
    <section class="panel glass">
      <div class="between"><b>#${o.id} - ${esc(o.username)}</b><span>${paidTag(o)} <span class="pill st-${statusOf(o)}">${STATUS[statusOf(o)] || esc(statusOf(o))}</span></span></div>
      <p class="muted" style="margin:2px 0 10px">${new Date(o.created_at).toLocaleString()}</p>
      ${orderLines(o)}
      ${partsLine(o)}
      ${o.note ? `<p class="muted" style="margin:8px 0 0">Note: ${esc(o.note)}</p>` : ''}
      <div class="actions" style="margin-top:12px">${adminBtns(o)}${paidBtn(o)}<button data-act="print-order" data-id="${o.id}">Print receipt</button>${o.user_id ? `<button class="danger" data-act="cust-block" data-id="${o.user_id}" data-name="${esc(o.username)}">Block customer</button>` : ''}</div>
    </section>`;

const dayLabel = (d) => {
  const t = new Date(), y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const hourLabel = (d) => {
  const f = (x) => x.toLocaleTimeString([], { hour: 'numeric' });
  const start = new Date(d); start.setMinutes(0, 0, 0);
  return `${f(start)} - ${f(new Date(start.getTime() + 3600000))}`;
};

function paintOrderFilters() {
  document.querySelectorAll('#ofilters [data-st]').forEach((b) => b.classList.toggle('primary', b.dataset.st === ordStatus));
  if ($('#orange')) $('#orange').value = ordRange;
  if ($('#oday')) $('#oday').value = ordDay;
  if ($('#onlymine')) $('#onlymine').checked = mineOnly();
  if ($('#osearch')) $('#osearch').value = ordSearch;
}

function drawOrders() {
  const el = $('#olist');
  if (!el) return;
  const now = new Date(), startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const inRange = (o) => {
    const d = new Date(o.created_at);
    if (ordDay) return d.toDateString() === new Date(ordDay + 'T00:00:00').toDateString();
    if (ordRange === 'today') return d >= startOf(now);
    if (ordRange === 'yesterday') { const y = startOf(now); y.setDate(y.getDate() - 1); return d >= y && d < startOf(now); }
    if (ordRange === 'week') return d >= new Date(now.getTime() - 7 * 86400000);
    return true;
  };
  const q = ordSearch.trim().toLowerCase().replace(/^#/, ''); // searching looks through every order, whatever the filters say
  shownOrders = q ? ordersCache.filter((o) => String(o.id) === q || String(o.username).toLowerCase().includes(q)) : ordersCache.filter((o) => inRange(o) && (ordStatus === 'all' || (ordStatus === 'active' ? ['pending', 'packed'].includes(statusOf(o)) : statusOf(o) === ordStatus)));
  const c = $('#ocount');
  if (c) c.textContent = `${shownOrders.length} order${shownOrders.length === 1 ? '' : 's'} shown`;

  const perDay = {}, perHour = {};
  shownOrders.forEach((o) => {
    const d = new Date(o.created_at), dk = d.toDateString();
    perDay[dk] = (perDay[dk] || 0) + 1;
    perHour[dk + d.getHours()] = (perHour[dk + d.getHours()] || 0) + 1;
  });
  let html = '', day = '', hour = '', open = false;
  for (const o of shownOrders) {
    const d = new Date(o.created_at), dk = d.toDateString(), hk = dk + d.getHours();
    if (dk !== day) {
      if (open) html += '</div>';
      open = false; day = dk; hour = '';
      html += `<h3 class="day-title">${esc(dayLabel(d))} <span class="muted">(${perDay[dk]})</span></h3>`;
    }
    if (hk !== hour) {
      if (open) html += '</div>';
      hour = hk; open = true;
      html += `<h4 class="hour-title">${esc(hourLabel(d))} <span>(${perHour[hk]})</span></h4><div class="ogrid">`;
    }
    html += orderCard(o);
  }
  if (open) html += '</div>';
  html = html || '<p>No orders for this filter.</p>';
  if (html !== adminHtml) { adminHtml = html; el.innerHTML = html; }
}

const mineOnly = () => { try { return isRaven() && localStorage.onlyMine === '1'; } catch (e) { return false; } };

// Raven's view of an order: only his own items, his own total, and his share of the promo discount.
function myView(o) {
  const all = o.items || [];
  const items = all.filter((i) => i.owner_id === user.id);
  const sum = (list) => list.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
  const mine = sum(items), whole = sum(all);
  let discount = 0;
  if (Number(o.discount) > 0) {
    if (o.promo_owner === user.id) discount = Number(o.discount);
    else if (o.promo_wide && whole) discount = Math.round(Number(o.discount) * mine / whole * 100) / 100;
  }
  return { ...o, items, discount, total: Math.round((mine - discount) * 100) / 100, hidden: all.length - items.length };
}

// A printable page: Save as PDF from the print window, or print it. Works for one order (receipt) or many (packing list).
function printOrders(list, mode) {
  if (!list.length) return toast('Nothing to print for this filter.');
  const mine = mineOnly();
  if (mine) {
    list = list.map(myView).filter((o) => (o.items || []).length);
    if (!list.length) return toast('None of these orders have your items.');
  }
  const single = mode === 'receipt';
  const shop = ($('.nav h1') || {}).textContent || 'Shop';
  const wantDone = ordStatus === 'completed';
  const live = list.filter((o) => (wantDone ? statusOf(o) === 'completed' : ['pending', 'packed'].includes(statusOf(o))));
  const tally = new Map();
  if (!single) live.forEach((o) => (o.items || []).forEach((i) => tally.set(i.title, (tally.get(i.title) || 0) + i.quantity)));
  const summary = [...tally].sort((x, y) => x[0].localeCompare(y[0]))
    .map(([t, q]) => `<li>${esc(t)} <b>x${q}</b></li>`).join('');
  if (!single && !live.length) return toast('Nothing left to pack for this filter.');
  // Packing list: one short row per order (who has what), not a big box each.
  const when = (o) => { const d = new Date(o.created_at); return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
  const rows = live.map((o) => `<tr><td>#${o.id}</td><td><b>${esc(o.username)}</b><br><span class="s">${when(o)}</span></td>
      <td>${(o.items || []).map((i) => `${i.quantity} ${esc(i.title)}`).join(', ')}${o.note ? `<br><span class="s">Note: ${esc(o.note)}</span>` : ''}</td>
      <td class="r"><b>${money(o.total)}</b></td><td>[&nbsp;&nbsp;&nbsp;]</td></tr>`).join('');
  const sumTotal = live.reduce((s, o) => s + Number(o.total), 0);
  const listHtml = `<h2>${wantDone ? 'Items' : 'To pack'}</h2><ul class="sum">${summary}</ul>
    <h2>Who has what</h2><table><tr><th>Order</th><th>Customer</th><th>Items</th><th class="r">Total</th><th>Packed</th></tr>${rows}</table>
    <div class="foot">${live.length} order${live.length === 1 ? '' : 's'} | Total ${money(sumTotal)} | Cash on delivery</div>`;
  const block = (o) => `<div class="order">
      <div class="head"><span>Order #${o.id} - ${esc(o.username)}</span><span>${esc(STATUS[statusOf(o)] || statusOf(o))}</span></div>
      <div>${new Date(o.created_at).toLocaleString()}</div>
      <table>${(o.items || []).map((i) => `<tr><td>${i.quantity} x ${esc(i.title)}</td><td class="r"><b>${money(i.unit_price * i.quantity)}</b></td></tr>`).join('')}</table>
      ${Number(o.discount) > 0 ? `<div class="tot small">Promo ${esc(o.promo_code)}: -${money(o.discount)}</div>` : ''}
      <div class="tot">Total: ${money(o.total)}</div>
      ${o.note ? `<div class="note">Note: ${esc(o.note)}</div>` : ''}
      ${o.hidden ? '<div class="small">Items from other sellers are not on this receipt.</div>' : ''}
      <div>Payment: cash on delivery</div>
      ${single ? '' : '<div class="check">[ &nbsp; ] Packed &nbsp;&nbsp;&nbsp; [ &nbsp; ] Delivered</div>'}
    </div>`;
  const filt = [{ active: 'Active', pending: 'To pack', packed: 'Packed', completed: 'Completed' }[ordStatus] || 'All orders',
    ordDay ? new Date(ordDay + 'T00:00:00').toLocaleDateString() : { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days' }[ordRange] || 'All time'].join(' | ');
  const title = single ? `${shop} receipt order ${list[0].id}` : `${shop} packing list ${new Date().toLocaleDateString()}`;
  const css = `body{font:14px/1.45 Arial,sans-serif;color:#000;margin:24px}h1{margin:0 0 4px;font-size:22px}h2{font-size:16px;margin:18px 0 6px}
    .meta{color:#444;margin:0 0 14px}.bar{margin-bottom:16px}.bar button{font-size:15px;padding:10px 16px;margin-right:8px}
    table{width:100%;border-collapse:collapse}td{padding:5px 4px;border-bottom:1px solid #bbb}.r{text-align:right}
    .order{border:1.5px solid #000;border-radius:6px;padding:12px;margin:0 0 12px;page-break-inside:avoid}
    .head{display:flex;justify-content:space-between;font-weight:700;font-size:15px}.tot{text-align:right;font-weight:700;font-size:16px;margin-top:6px}
    .small{font-size:13px}.note{background:#eee;padding:6px;margin:6px 0}.check{margin-top:8px}
    .sum{columns:2;margin:0 0 6px;padding-left:18px}.sum li{margin:0 0 2px}
    .compact{font-size:12px;margin:16px}.compact h1{font-size:18px}.compact h2{font-size:14px;margin:12px 0 4px}
    .compact td,.compact th{padding:3px 4px;border-bottom:1px solid #ccc;vertical-align:top;text-align:left}.compact th.r{text-align:right}
    .s{color:#555;font-size:11px}.foot{text-align:right;font-weight:700;margin-top:8px}
    @media print{.bar{display:none}body{margin:0}.compact{margin:0}}`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site, then try again.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title><style>${css}</style></head><body class="${single ? '' : 'compact'}">
    <div class="bar"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
    <h1>${esc(shop)}</h1>
    <p class="meta">${single ? 'Receipt' : 'Packing list'} | ${esc(isRaven() ? (mine ? 'My items only' : 'All sellers') : 'Seller: ' + user.username)}${single ? '' : ' | ' + esc(filt)} | Printed ${new Date().toLocaleString()}</p>
    ${single ? list.map(block).join('') : listHtml}</body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* use the button */ } }, 500);
}

async function refreshCustomers() {
  const list = await api('/api/customers');
  const el = $('#custlist');
  if (!el) return;
  const html = list.map((c) => `<div class="req">
      <div class="between"><b>${esc(c.username)}</b>${c.blocked_shop ? '<span class="pill st-cancelled">Blocked everywhere</span>' : c.blocked_by_me ? '<span class="pill st-cancelled">Blocked by you</span>' : ''}</div>
      <p class="muted" style="margin:2px 0 8px">${c.orders} order${c.orders === 1 ? '' : 's'} | ${c.completed} completed | ${c.cancelled} cancelled${c.my_reason ? ` | Reason: ${esc(c.my_reason)}` : ''}${isRaven() && c.last_reset ? ` | Password reset ${new Date(c.last_reset).toLocaleDateString()}` : ''}</p>
      ${c.blocked_by_me ? `<button data-act="cust-unblock" data-id="${c.id}">Unblock</button>`
        : `<button class="danger" data-act="cust-block" data-id="${c.id}" data-name="${esc(c.username)}">Block</button>`}
      ${isRaven() ? `<button data-act="cust-reset" data-id="${c.id}" data-name="${esc(c.username)}">Reset password</button>` : ''}
    </div>`).join('') || '<p>No customers yet.</p>';
  if (html !== custHtml) { custHtml = html; el.innerHTML = html; }
}

async function refreshOrders() {
  const orders = await api('/api/orders');
  const top = orders.reduce((m, o) => Math.max(m, o.id), 0);
  if (lastOrderId !== null && top > lastOrderId) toast('New order received.');
  lastOrderId = top;
  pendingCount = orders.filter((o) => o.status === 'pending').length;
  const tb = $('#tab-orders');
  if (tb) tb.textContent = 'Orders' + (pendingCount ? ` (${pendingCount})` : '');
  ordersCache = orders;
  drawOrders();
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

const comboState = (c) => {
  const ap = c.approvals || [];
  const no = ap.find((x) => x.status === 'declined');
  if (no) return `Declined by ${esc(no.username)}`;
  const wait = ap.filter((x) => x.status === 'pending');
  if (wait.length) return `Waiting for ${wait.map((x) => esc(x.username)).join(', ')}`;
  return c.is_active ? 'Visible' : 'Hidden';
};

async function refreshAdminCombos() {
  const list = await api('/api/admin/combos');
  const el = $('#combolist');
  if (!el) return;
  const html = list.length ? `<table>${list.map((c) => {
    const my = (c.approvals || []).find((x) => x.owner_id === user.id);
    return `<tr>
      <td><b>${esc(c.title)}</b><br><span class="muted">${c.items.map((x) => `${x.quantity}x ${esc(x.title)}`).join(', ')}${ownerName(c.owner_id) ? ` | made by ${esc(ownerName(c.owner_id))}` : ''}</span></td>
      <td>${money(c.price)}</td><td><span class="pill">${comboState(c)}</span></td>
      <td><div class="actions">
        ${my && my.status !== 'approved' ? `<button class="primary" data-act="combo-approve" data-id="${c.id}" data-yes="1">Approve</button>` : ''}
        ${my && my.status !== 'declined' ? `<button class="danger" data-act="combo-approve" data-id="${c.id}" data-yes="0">Decline</button>` : ''}
        ${canEdit(c.owner_id) ? `<button data-act="combo-toggle" data-id="${c.id}">${c.is_active ? 'Hide' : 'Show'}</button>
        <button class="danger" data-act="combo-delete" data-id="${c.id}">Delete</button>` : ''}</div></td></tr>`;
  }).join('')}</table>` : '<p>No combos yet.</p>';
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

const promoScope = (p) => p.shop_wide ? "Shop-wide: every seller's items" : (p.product_ids && p.product_ids.length
  ? 'Only: ' + p.product_ids.map((id) => { const x = products.find((q) => q.id === id); return x ? esc(x.title) : 'removed product'; }).join(', ')
  : 'Everything ' + (p.owner ? esc(p.owner) + ' sells' : 'in the shop'));

async function refreshAdminPromos() {
  const list = await api('/api/admin/promos');
  const el = $('#promolist');
  if (!el) return;
  const html = list.length ? `<table>${list.map((p) => `<tr><td><b>${esc(p.code)}</b><br><span class="muted">${promoScope(p)}</span></td><td>${p.percent}% off</td>
      <td>${p.used_count}${p.max_uses ? ' / ' + p.max_uses : ''} used</td><td><span class="pill">${p.is_active ? 'On' : 'Off'}</span></td>
      <td>${canEdit(p.owner_id) ? `<div class="actions"><button data-act="promo-toggle" data-id="${p.id}">${p.is_active ? 'Turn off' : 'Turn on'}</button>
        ${isRaven() ? `<button data-act="promo-wide" data-id="${p.id}">${p.shop_wide ? 'Make mine only' : 'Make shop-wide'}</button>` : ''}
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

async function refreshCosts() { costMap = await api('/api/admin/costs'); fillProducts(); }
async function refreshReport() { repData = await api('/api/admin/report?days=30'); drawReport(); }
function drawReport() {
  const el = $('#reportbox'); if (!el || !repData) return;
  const t = repData.days.find((d) => d.day === repData.today) || { orders: 0, revenue: 0, profit: 0 };
  const who = (repData.people || []).map((x) => `<tr><td><b>${esc(x.username)}</b>${x.role === 'admin' ? ' <span class="muted">(admin)</span>' : ''}</td><td>Potential income <b>${money(x.potential)}</b> <span class="muted">(${x.open} open order${x.open === 1 ? '' : 's'})</span></td><td>Gross <b>${money(x.gross)}</b> <span class="muted">(${x.done} completed)</span></td></tr>`).join('');
  el.innerHTML = `<h3>${isRaven() ? 'Income per seller' : 'Your income'}</h3><p class="muted">Potential income = pending and packed orders still to come. Gross = completed orders. Each person's own items only, all time.</p>${who ? `<table>${who}</table>` : ''}
    <h3>Today</h3><p><b>${t.orders}</b> completed orders | Sales <b>${money(t.revenue)}</b> | Profit <b>${money(t.profit)}</b></p>
    ${repData.missing_cost ? `<p class="muted">${repData.missing_cost} order lines have no cost price, so profit is too high. Set a cost on each product (Products tab, Edit). Only new orders pick it up.</p>` : ''}
    <h3>Last 30 days</h3>${repData.days.length ? `<table>${repData.days.map((d) => `<tr><td><b>${esc(d.day)}</b></td><td>${d.orders} order${d.orders === 1 ? '' : 's'}</td><td>Sales ${money(d.revenue)}</td><td>Profit <b>${money(d.profit)}</b></td></tr>`).join('')}</table>` : '<p>No completed orders yet.</p>'}
    <h3>By item (best profit first)</h3>${repData.items.length ? `<table>${repData.items.map((i) => `<tr><td>${esc(i.title)}</td><td>${i.qty} sold</td><td>Sales ${money(i.revenue)}</td><td>${i.known ? `Profit <b>${money(i.profit)}</b>` : '<span class="muted">Set a cost to see profit</span>'}</td></tr>`).join('')}</table>` : '<p>Nothing yet.</p>'}`;
}
async function refreshBackup() {
  const el = $('#autobk'); if (!el) return;
  const list = await api('/api/admin/backups');
  const when = (d) => new Date(d).toLocaleString();
  el.innerHTML = list.length
    ? `<table>${list.map((b) => `<tr><td>${esc(when(b.created_at))}</td><td>${(b.size / 1048576).toFixed(2)} MB</td><td><button data-act="dlbackup" data-id="${b.id}">Download</button></td></tr>`).join('')}</table>`
    : '<p class="muted">No automatic backup yet. The first one is made shortly after the site starts.</p>';
}

// Cash page: cash still to collect per seller, what each collected, and who owes whom.
let cashData = null;
async function refreshCash() { cashData = await api('/api/admin/cash'); drawCash(); }
const tname = (id) => (team.find((x) => x.id === id) || {}).username || '?';
function drawCash() {
  const el = $('#cashbox'); if (!el || !cashData) return;
  const today = new Date().toDateString(), by = {};
  for (const o of cashData.unpaid) for (const [id, amt] of Object.entries(o.shares)) {
    const r = by[id] ||= { t: 0, tn: 0, e: 0, en: 0, m: 0, mn: 0 };
    if (new Date(o.created_at).toDateString() === today) { r.t += amt; r.tn++; } else { r.e += amt; r.en++; }
    if (o.status === 'completed') { r.m += amt; r.mn++; }
  }
  const rows = Object.entries(by).map(([id, r]) => `<tr><td><b>${esc(tname(Number(id)))}</b></td>
    <td>Today: <b>${money(r.t)}</b> <span class="muted">(${r.tn})</span></td>
    <td>Earlier: <b>${money(r.e)}</b> <span class="muted">(${r.en})</span></td>
    <td>${r.mn ? `<b style="color:#dc2670">Delivered, not marked paid: ${money(r.m)} (${r.mn})</b>` : '<span class="muted">Nothing missing</span>'}</td></tr>`).join('');
  const bal = cashData.balances.map((b) => `<tr><td><b>${esc(b.from_name)}</b> owes <b>${esc(b.to_name)}</b></td><td><b>${money(b.amount)}</b></td>
    <td>${isRaven() || b.to === user.id ? `<button data-act="settle" data-from="${b.from}" data-to="${b.to}" data-amt="${b.amount}" data-names="${esc(b.from_name)} to ${esc(b.to_name)}">Mark paid</button>` : ''}</td></tr>`).join('');
  el.innerHTML = `<h3>Cash still to collect</h3><p class="muted">Unpaid orders by seller. Tick Paid on the order when the money is in your hand.</p>
    ${rows ? `<table>${rows}</table>` : '<p>Nothing to collect.</p>'}
    <h3>What each seller collected</h3>
    ${cashData.collected.length ? `<table>${cashData.collected.map((c) => `<tr><td><b>${esc(c.username)}</b></td><td>${money(c.amount)}</td><td class="muted">${c.orders} order${c.orders === 1 ? '' : 's'}</td></tr>`).join('')}</table>` : '<p>No cash marked paid yet.</p>'}
    <h3>Who owes who</h3>
    ${bal ? `<table>${bal}</table>` : '<p>Everyone is settled up.</p>'}
    ${cashData.settlements.length ? `<h3>Settled so far</h3><p class="muted">${cashData.settlements.map((x) => `${new Date(x.created_at).toLocaleDateString()}: ${esc(x.from_name)} paid ${esc(x.to_name)} ${money(x.amount)}`).join('<br>')}</p>` : ''}`;
}

function renderAdmin() {
  adminHtml = ''; customAdminHtml = '';
  const tab = (id, label, extra = '') =>
    `<button id="tab-${id}" class="${adminTab === id ? 'primary' : ''}" data-act="admintab" data-tab="${id}">${label}${extra}</button>`;
  const tabs = `<div class="tabs">${tab('products', 'Products')}${tab('orders', 'Orders', pendingCount ? ` (${pendingCount})` : '')}${tab('custom', 'Custom orders', pendingCustom ? ` (${pendingCustom})` : '')}${tab('cash', 'Cash')}${tab('report', 'Report')}${tab('combos', 'Combos')}${tab('promos', 'Promos')}${tab('customers', 'Customers')}${isRaven() ? tab('sellers', 'Sellers') + tab('backup', 'Backup') : tab('alerts', 'Alerts')}</div>`;
  const productsView = `
    <section class="panel glass">
      <h2 id="form-title">Add a product</h2>
      <form id="pform">
        <div class="row"><div><label>Title</label><input name="title" required></div>
          <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required></div></div>
        <div id="ownerbox"></div>
        <label>Category</label><select name="category"><option value="drinks">Drinks</option><option value="snacks">Snacks</option></select>
        <label>Discount % (0 for none)</label><input name="discount_percent" type="number" min="0" max="90" value="0">
        <label>Cost price (what it costs you; optional, customers never see it)</label><input name="cost" type="number" step="0.01" min="0">
        <label>Stock (how many you have; leave empty to not count)</label><input name="stock" type="number" min="0" step="1">
        <label>Description</label><textarea name="description" rows="3"></textarea>
        <label>Image (max 5 MB; leave empty to keep the current one)</label><input name="image" type="file" accept="image/*">
        <button class="primary" type="submit" id="save">Add product</button>
        <button type="button" data-act="reset-form">Clear</button>
      </form>
    </section>
    <div id="lowbox"></div>
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
  const ordersView = `<h2>Orders</h2>
    <div class="toolbar" id="ofilters">
      <input type="search" id="osearch" placeholder="Search customer or order #" autocomplete="off" style="max-width:240px">
      <div class="chips">
        <button data-act="ofilter" data-st="active">Active</button><button data-act="ofilter" data-st="pending">To pack</button><button data-act="ofilter" data-st="packed">Packed</button>
        <button data-act="ofilter" data-st="completed">Completed</button><button data-act="ofilter" data-st="all">All</button>
      </div>
      <select id="orange"><option value="all">All time</option><option value="today">Today</option>
        <option value="yesterday">Yesterday</option><option value="week">Last 7 days</option></select>
      <input type="date" id="oday" aria-label="Pick a day">
      <button class="primary" data-act="print-orders">Print packing list</button>
      ${isRaven() ? '<label class="pickrow" style="padding:0"><input type="checkbox" id="onlymine"> Print only my items</label>' : ''}
    </div>
    <p class="muted" id="ocount" style="margin:0 0 4px"></p>
    <div id="olist"><p>Loading...</p></div>`;
  const cashView = '<section class="panel glass"><h2>Cash</h2><div id="cashbox"><p>Loading...</p></div></section>';
  const reportView = '<section class="panel glass table-wrap"><h2>Sales and profit</h2><div id="reportbox"><p>Loading...</p></div></section>';
  const customView = '<section class="panel glass table-wrap"><h2>Custom orders</h2><div id="clist"><p>Loading...</p></div></section>';
  const combosView = `<section class="panel glass">
      <h2>Create a combo</h2>
      <form id="combo-form">
        <label>Combo name</label><input name="title" required maxlength="120" placeholder="e.g. Movie night snack pack">
        <label>Description (optional)</label><input name="description" maxlength="300">
        <label>Combo price</label><input name="price" type="number" step="0.01" min="0" required>
        <label>Tick the products and how many of each</label>
        <p class="muted" style="margin:0 0 8px">You can add other sellers' products too. They must approve before the combo goes live, and each seller approves her own part of every order.</p>
        <div class="picks">${products.map((p) => `<label class="pickrow"><input type="checkbox" name="pid" value="${p.id}"> ${esc(p.title)} (${money(fin(p))})${ownerName(p.owner_id) ? ` - by ${esc(ownerName(p.owner_id))}` : ''}
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
        <label>Only for these products (leave all unticked to discount everything you sell)</label>
        <div class="picks">${myProducts().map((p) => `<label class="pickrow"><input type="checkbox" name="pid" value="${p.id}"> ${esc(p.title)}</label>`).join('') || '<p>Add products first.</p>'}</div>
        ${isRaven() ? '<label class="pickrow" style="padding-left:0"><input type="checkbox" name="shop_wide"> Shop-wide: also discounts every seller\'s items (the sellers get an alert)</label>' : ''}
        <button class="primary" type="submit">Create code</button>
      </form>
      <p class="muted">No products ticked = a universal code for everything you sell. Tick products to limit it to just those. Each customer can use a code once.</p>
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
      <p><b>Automatic backups</b> are saved here every 3 days (the newest 5 are kept). They live in the same database as the shop, so still download one by hand now and then and keep it somewhere safe.</p>
      <div id="autobk"><p>Loading...</p></div>
      <hr style="border:0;border-top:1px solid var(--border);margin:22px 0">
      <p><b>Restore</b> replaces everything on the site with the contents of a backup file. Use it on a new, empty database.</p>
      <input id="bfile" type="file" accept=".json,application/json">
      <button class="danger" data-act="restore">Restore from backup</button>
    </section>`;
  const customersView = `<h2>Customers</h2>
    <p class="muted">Block people who abuse the shop (fake orders, not showing up). ${isRaven() ? 'Your block covers the whole shop.' : 'Your block stops them ordering your items only.'} The list shows the most cancelled orders first.</p>
    <div id="custlist"><p>Loading...</p></div>`;
  $('#app').innerHTML = tabs + (adminTab === 'report' ? reportView : adminTab === 'cash' ? cashView : adminTab === 'orders' ? ordersView : adminTab === 'custom' ? customView : adminTab === 'backup' && isRaven() ? backupView : adminTab === 'sellers' && isRaven() ? sellersView : adminTab === 'alerts' && !isRaven() ? alertsView : adminTab === 'combos' ? combosView : adminTab === 'promos' ? promosView : adminTab === 'customers' ? customersView : productsView);
  fillProducts();
  comboAdminHtml = ''; refreshAdminCombos().catch(() => {});
  promoAdminHtml = ''; refreshAdminPromos().catch(() => {});
  paintOrderFilters();
  custHtml = ''; refreshCustomers().catch(() => {});
  refreshOrders().catch(() => {});
  refreshCustom().catch(() => {});
  refreshTeam().catch(() => {});
  if (adminTab === 'cash') refreshCash().catch(() => {});
  if (adminTab === 'report') refreshReport().catch(() => {});
  refreshCosts().catch(() => {});
  if (isRaven() && adminTab === 'backup') refreshBackup().catch(() => {});
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
let forcePw = false;
function changePwDialog() {
  forcePw = true;
  $('#dlg').innerHTML = `<h2>Choose a new password</h2><p class="muted">You logged in with a temporary password. Pick your own to continue.</p><form data-form="changepw">
    <label>Temporary password</label><input name="current_password" type="password" required autocomplete="current-password">
    <label>New password (8+ characters)</label><input name="new_password" type="password" required minlength="8" autocomplete="new-password">
    <button class="primary">Save new password</button><button type="button" data-act="logout">Log out</button></form>`;
  if (!$('#dlg').open) $('#dlg').showModal();
}
function authDialog() {
  $('#dlg').innerHTML = `<h2>Welcome</h2><form data-form="auth">
    <label>Username</label><input name="username" required autocomplete="username">
    <label>Password (8+ characters to sign up)</label><input name="password" type="password" required autocomplete="current-password">
    <button class="primary" data-mode="login">Log in</button>
    <button data-mode="signup">Create account</button>
    <button type="button" data-act="close">Cancel</button></form>`;
  $('#dlg').showModal();
}
// Splits a combo's price between the sellers whose products are in it (by value), like the server does.
function comboParts(c) {
  const groups = new Map();
  for (const x of c.items) {
    const k = x.owner_id ?? c.owner_id;
    const g = groups.get(k) || { owner: k, value: 0 };
    g.value += fin(x) * x.quantity;
    groups.set(k, g);
  }
  const list = [...groups.values()], worth = list.reduce((s, g) => s + g.value, 0) || 1;
  let left = Number(c.price);
  return list.map((g, n) => {
    const share = n === list.length - 1 ? left : Math.round((Number(c.price) * g.value / worth) * 100) / 100;
    left = Math.round((left - share) * 100) / 100;
    return { owner: g.owner, price: share };
  });
}

function cartLines() {
  return Object.entries(cart).map(([key, q]) => {
    if (key[0] === 'c') {
      const c = combos.find((x) => 'c' + x.id === key);
      return c && { key, title: 'Combo: ' + c.title, price: Number(c.price), q, owner: c.owner_id, parts: comboParts(c) };
    }
    const p = products.find((x) => x.id == key);
    return p && { key, title: p.title, price: fin(p), q, owner: p.owner_id };
  }).filter(Boolean);
}
function cartDialog() {
  const lines = cartLines();
  const sub = lines.reduce((s, l) => s + l.price * l.q, 0);
  // A promo discounts its owner's items, and only the chosen products when it is per-product.
  const perProduct = promo && promo.product_ids && promo.product_ids.length;
  const base = !promo ? sub : lines.reduce((s, l) => {
    if (l.parts) return perProduct ? s : s + l.parts.filter((p) => promo.shop_wide || promo.owner_id == null || p.owner === promo.owner_id).reduce((t, p) => t + p.price, 0) * l.q;
    const ok = (promo.shop_wide || promo.owner_id == null || l.owner === promo.owner_id) && (!perProduct || promo.product_ids.includes(Number(l.key)));
    return ok ? s + l.price * l.q : s;
  }, 0);
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
  'cust-block': async (id, d) => {
    const reason = prompt(`Block ${d.name || 'this customer'}? They will not be able to order ${isRaven() ? 'from anyone' : 'your items'}.\nWhy? (optional)`);
    if (reason === null) return;
    await api(`/api/customers/${id}/block`, { method: 'POST', json: { reason } });
    custHtml = ''; await refreshCustomers(); toast('Customer blocked.');
  },
  'cust-unblock': async (id) => {
    await api(`/api/customers/${id}/block`, { method: 'DELETE' });
    custHtml = ''; await refreshCustomers(); toast('Customer unblocked.');
  },
  ofilter: (id, d) => { ordStatus = d.st; paintOrderFilters(); drawOrders(); },
  'print-orders': () => printOrders(shownOrders, 'list'),
  'print-order': (id) => { const o = ordersCache.find((x) => x.id == id); if (o) printOrders([o], 'receipt'); },
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
  'promo-wide': async (id) => { await api(`/api/promos/${id}/shop-wide`, { method: 'PATCH' }); await refreshAdminPromos(); toast('Updated. Sellers are alerted when a code goes shop-wide.'); },
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
  'combo-approve': async (id, d) => {
    await api(`/api/combos/${id}/approval`, { method: 'PATCH', json: { approve: d.yes === '1' } });
    await refreshAdminCombos(); await loadProductsQuiet(); toast(d.yes === '1' ? 'Approved.' : 'Declined.');
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
  dlbackup: async (id) => {
    const r = await fetch(`/api/admin/backups/${encodeURIComponent(id)}/download`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Download failed.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await r.blob());
    link.download = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'shop-backup.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
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
  paid: async (id, d) => {
    await api(`/api/orders/${id}/paid`, { method: 'PATCH', json: { paid: d.paid === '1' } });
    await refreshOrders(); if (adminTab === 'cash') await refreshCash(); toast(d.paid === '1' ? 'Marked paid.' : 'Paid tick removed.');
  },
  settle: async (id, d) => {
    const v = prompt(`How much did ${d.names} hand over?`, d.amt);
    if (v === null) return;
    await api('/api/admin/settlements', { method: 'POST', json: { from_id: d.from, to_id: d.to, amount: v } });
    await refreshCash(); toast('Recorded.');
  },
  setstatus: async (id, d) => {
    if (d.status === 'cancelled' && !confirm('Cancel this order?')) return;
    const r = await api(`/api/orders/${id}/status`, { method: 'PATCH', json: { status: d.status } });
    const o0 = ordersCache.find((x) => x.id == id);
    if (d.status === 'completed' && o0 && !o0.paid_by && confirm('Did you collect the cash?\nOK = tick Paid. Cancel = not yet.')) {
      try { await api(`/api/orders/${id}/paid`, { method: 'PATCH', json: { paid: true } }); } catch (e) { toast(e.message); }
    }
    await refreshOrders();
    toast(r.waiting && r.waiting.length ? `Saved. Waiting for ${r.waiting.join(', ')} to approve too.`
      : d.status === 'packed' ? 'Marked packed. The customer is notified.' : 'Order updated.');
  },
  close: () => $('#dlg').close(),
  auth: authDialog,
  cart: cartDialog,
  logout: () => { forcePw = false; $('#dlg').close(); clearSession(); view = 'shop'; render(); toast('Logged out.'); },
  'cust-reset': (id, d) => {
    $('#dlg').innerHTML = `<h2>Reset password for ${esc(d.name)}</h2><p class="muted">Type your own admin password to confirm. This is logged and sent to your phone.</p><form data-form="reset" data-id="${id}">
      <label>Your admin password</label><input name="admin_password" type="password" required autocomplete="current-password">
      <button class="primary">Reset and show temporary password</button><button type="button" data-act="close">Cancel</button></form>`;
    $('#dlg').showModal();
  },
  copytemp: async () => {
    const i = $('#temppw'); i.select();
    try { await navigator.clipboard.writeText(i.value); toast('Copied.'); } catch (e) { document.execCommand('copy'); toast('Copied.'); }
  },
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
    f.dataset.id = id; f.title.value = p.title; f.price.value = p.price; f.description.value = p.description; f.category.value = p.category || 'snacks'; f.discount_percent.value = p.discount_percent || 0; f.stock.value = p.stock ?? ''; f.cost.value = costMap[id] ?? ''; if (f.owner_id) f.owner_id.value = p.owner_id || user.id;
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
      const d = await api(`/api/auth/${mode}`, { method: 'POST', json: { ...Object.fromEntries(new FormData(e.target)), device_id: deviceId() } });
      setSession(d.token, d.user);
      if (d.must_change) { changePwDialog(); render(); return; }
      $('#dlg').close(); render(); toast(`Welcome, ${d.user.username}.`);
    } else if (e.target.dataset.form === 'changepw') {
      const d = await api('/api/auth/change-password', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      setSession(d.token, d.user); forcePw = false; $('#dlg').close(); render(); toast('Password changed.');
    } else if (e.target.dataset.form === 'reset') {
      const d = await api(`/api/admin/customers/${e.target.dataset.id}/reset-password`, { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      $('#dlg').innerHTML = `<h2>Temporary password</h2><p>For <b>${esc(d.username)}</b>. It is shown <b>once</b>, works for 24 hours, and they must choose their own password when they log in.</p>
        <input id="temppw" readonly value="${esc(d.password)}" style="font-size:1.2rem;letter-spacing:1px">
        <button class="primary" type="button" data-act="copytemp">Copy</button><button type="button" data-act="close">Done</button>`;
      custHtml = ''; refreshCustomers().catch(() => {});
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
      const made = await api('/api/combos', { method: 'POST', json: { title: fd.title, description: fd.description, price: fd.price, items: picked } });
      e.target.reset(); updateComboSum(); await refreshAdminCombos(); await loadProductsQuiet(); toast(made.waiting ? 'Combo created. It goes live once the other seller approves.' : 'Combo created.');
    } else if (e.target.id === 'alerts-form') {
      await api('/api/staff/alerts', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
      toast('Alert settings saved.');
    } else if (e.target.id === 'seller-form') {
      await api('/api/admin/sellers', { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      e.target.reset(); await refreshSellers(); toast('Seller created.');
    } else if (e.target.id === 'promo-form') {
      await api('/api/promos', { method: 'POST', json: { ...Object.fromEntries(new FormData(e.target)), product_ids: [...e.target.querySelectorAll('input[name="pid"]:checked')].map((b) => Number(b.value)), shop_wide: !!e.target.querySelector('[name="shop_wide"]:checked') } });
      e.target.reset(); await refreshAdminPromos(); toast('Promo code created.');
    } else if (e.target.id === 'settings-form') {
      await api('/api/admin/settings', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
      await loadProductsQuiet(); toast('Saved.');
    } else if (e.target.id === 'pform') {
      const id = e.target.dataset.id;
      const fd = new FormData(e.target);
      if (!fd.get('image').size) fd.delete('image');
      await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: fd });
      await loadProducts(); refreshCosts().catch(() => {}); toast(id ? 'Changes saved.' : 'Product added.');
    }
  } catch (err) { toast(err.message); }
});

// Close the dialog when clicking the dimmed backdrop
$('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg') && !forcePw) $('#dlg').close(); });
$('#dlg').addEventListener('cancel', (e) => { if (forcePw) e.preventDefault(); }); // Esc cannot skip the forced password change

document.addEventListener('input', (e) => { if (e.target.id === 'osearch') { ordSearch = e.target.value; drawOrders(); } });

document.addEventListener('change', (e) => {
  if (e.target.id === 'onlymine') {
    try { localStorage.onlyMine = e.target.checked ? '1' : ''; } catch (err) { /* ignore */ }
    toast(e.target.checked ? 'Receipts and packing lists will show only your items.' : 'Receipts and packing lists will show every seller\'s items.');
    return;
  }
  if (e.target.id === 'orange') { ordRange = e.target.value; ordDay = ''; paintOrderFilters(); drawOrders(); return; }
  if (e.target.id === 'oday') { ordDay = e.target.value; drawOrders(); return; }
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

/* iPhone/iPad: Safari has no install button, so show the steps once (from the second visit). */
(() => {
  try {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (!ios || navigator.standalone || localStorage.a2hsDone) return;
    const visits = (Number(localStorage.visits) || 0) + 1;
    localStorage.visits = visits;
    if (visits < 2) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="a2hs" class="glass">
      <b>Get the shop on your Home Screen</b>
      <p>Tap the Share button <span class="share-ic">&#8679;</span> in Safari, then <b>Add to Home Screen</b>. It opens like an app.</p>
      <button class="primary" id="a2hs-ok" type="button">Got it</button></div>`);
    $('#a2hs-ok').addEventListener('click', () => { localStorage.a2hsDone = '1'; $('#a2hs').remove(); });
  } catch (e) { /* private browsing */ }
})();

loadProducts().catch((e) => toast(e.message));
