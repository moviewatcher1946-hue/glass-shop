const $ = (s) => document.querySelector(s);
const HAPTICS = () => { try { return localStorage.haptics !== 'off'; } catch (e) { return true; } };
if (navigator.vibrate) { const v = navigator.vibrate.bind(navigator); navigator.vibrate = (pat) => (HAPTICS() ? v(pat) : false); }
let usualIds = null, usualUser = null, stockSeen = null, deepDone = false, flashBusy = false;
const LS = (k, d) => { try { return localStorage[k] ?? d; } catch (e) { return d; } };
const SAVER = () => LS('saver', 'off') === 'on';
const ACCENTS = [['Ocean', '', ''], ['Grape', '#8e5bff', '#ff5bd6'], ['Sunset', '#ff7a18', '#ff375f'], ['Mint', '#00a67e', '#0a84ff'], ['Rose', '#ff375f', '#ff9f0a'], ['Forest', '#16a34a', '#0d9488'], ['Slate', '#475569', '#7c3aed']];
function applyAccent(i) {
  const r = document.documentElement.style, c = ACCENTS[i] || ACCENTS[0];
  let glow = document.getElementById('accent-glow');
  if (!c[1]) { ['--a1', '--a2', '--acc'].forEach((k) => r.removeProperty(k)); if (glow) glow.remove(); return; }
  r.setProperty('--a1', c[1]); r.setProperty('--a2', c[2]); r.setProperty('--acc', `linear-gradient(135deg,${c[1]},${c[2]})`);
  // The soft coloured glow behind the page follows the colour too (dark and light themes have their own strength). Skipped on browsers too old to mix colours.
  if (window.CSS && CSS.supports && CSS.supports('color', 'color-mix(in srgb, red 50%, transparent)')) {
    if (!glow) { glow = document.createElement('style'); glow.id = 'accent-glow'; document.head.appendChild(glow); }
    const mix = (v, p) => `color-mix(in srgb,var(${v}) ${p}%,transparent)`;
    glow.textContent = `:root{--o1:${mix('--a1', 34)};--o2:${mix('--a2', 30)};--o3:${mix('--a1', 22)}}:root[data-theme=light]{--o1:${mix('--a1', 50)};--o2:${mix('--a2', 42)};--o3:${mix('--a1', 30)}}`;
  }
}
applyAccent(Number(LS('accent', 0)));
{ const fz = Number(LS('fz', 100)); if (fz !== 100) document.documentElement.style.fontSize = fz + '%'; }
let sortMode = 'featured', inStockOnly = false;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = '₱';
const money = (n) => CURRENCY + Number(n).toFixed(2);

/* ===== Sounds: made with the Web Audio API (no files to download). One mute switch, remembered on the device. ===== */
const SFX = (() => {
  let ctx = null, muted = false, volume = 1;
  try { volume = Number(localStorage.sfxvol || 1); } catch (e) {}
  const vv = () => volume;
  try { muted = localStorage.sfx === 'off'; } catch (e) {}
  const ac = () => {
    if (muted) return null;
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { return null; }
    return ctx;
  };
  const tone = (c, f, t, d, vol, type = 'sine', to = 0) => {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + t;
    o.type = type; o.frequency.setValueAtTime(f, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol * vv(), t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + d + 0.03);
  };
  const noise = (c, t, d, vol, f0, f1) => { // filtered noise burst: the "whoosh" of glass sliding
    const n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + t;
    s.buffer = buf; fl.type = 'bandpass'; fl.Q.value = 0.9; fl.frequency.setValueAtTime(f0, t0); fl.frequency.exponentialRampToValueAtTime(f1, t0 + d);
    g.gain.setValueAtTime(vol * vv(), t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    s.connect(fl); fl.connect(g); g.connect(c.destination); s.start(t0);
  };
  const play = (fn) => () => { const c = ac(); if (c) fn(c); };
  const api = {
    click: play((c) => tone(c, 520, 0, 0.07, 0.06, 'triangle', 340)),
    add: play((c) => { tone(c, 660, 0, 0.09, 0.07); tone(c, 990, 0.07, 0.14, 0.07); }),
    order: play((c) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(c, f, i * 0.09, 0.45, 0.08); tone(c, f * 2, i * 0.09, 0.25, 0.025); })),
    ding: play((c) => { tone(c, 880, 0, 0.5, 0.09); tone(c, 1760, 0, 0.3, 0.03); tone(c, 659.25, 0.28, 0.6, 0.09); }),
    // v20 sound design: noise whooshes, ticks, sparkles, a soft error, and a boot shimmer. Master volume is remembered (SFX.vol).
    swoosh: play((c) => noise(c, 0, 0.32, 0.05, 400, 3200)),
    cartOpen: play((c) => { noise(c, 0, 0.4, 0.05, 300, 2600); tone(c, 392, 0.05, 0.3, 0.05, 'triangle'); tone(c, 587.33, 0.14, 0.4, 0.05, 'triangle'); }),
    cartClose: play((c) => { noise(c, 0, 0.3, 0.04, 2600, 300); tone(c, 440, 0, 0.2, 0.04, 'triangle', 260); }),
    tickUp: play((c) => tone(c, 760, 0, 0.06, 0.05, 'square', 900)),
    tickDown: play((c) => tone(c, 560, 0, 0.06, 0.05, 'square', 420)),
    remove: play((c) => { tone(c, 420, 0, 0.16, 0.07, 'sawtooth', 160); noise(c, 0, 0.12, 0.03, 1800, 600); }),
    undo: play((c) => { tone(c, 440, 0, 0.09, 0.06, 'triangle'); tone(c, 660, 0.07, 0.14, 0.06, 'triangle'); }),
    clear: play((c) => { noise(c, 0, 0.45, 0.06, 2400, 200); tone(c, 330, 0, 0.35, 0.05, 'sine', 110); }),
    promoOk: play((c) => [1318.5, 1568, 2093, 2637].forEach((f, i) => tone(c, f, i * 0.06, 0.28, 0.04))),
    error: play((c) => { tone(c, 220, 0, 0.14, 0.07, 'square'); tone(c, 165, 0.12, 0.2, 0.07, 'square'); }),
    hover: play((c) => tone(c, 1200, 0, 0.025, 0.012, 'sine')),
    charge: play((c) => { tone(c, 280, 0, 0.9, 0.035, 'sine', 880); noise(c, 0, 0.7, 0.015, 600, 2400); }),
    press: play((c) => { tone(c, 300, 0, 0.12, 0.08, 'triangle', 700); tone(c, 1046.5, 0.05, 0.22, 0.05); }),
    error2: play((c) => tone(c, 196, 0, 0.2, 0.05, 'triangle')),
    pop: play((c) => { tone(c, 523.25, 0, 0.12, 0.05); tone(c, 783.99, 0.08, 0.28, 0.05); }),
    get muted() { return muted; },
    set vol(v) { volume = Math.max(0, Math.min(1.5, v)); try { localStorage.sfxvol = String(volume); } catch (e) {} },
    get vol() { return volume; },
    toggle() { muted = !muted; try { localStorage.sfx = muted ? 'off' : 'on'; } catch (e) {} if (!muted) api.click(); return muted; }
  };
  return api;
})();
// Price after the product's % discount (the server works it out again when you order).
const fin = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_percent) || 0))) / 100;
// Bulk discount: buy bulk_min or more, get bulk_percent% off each (the lower of this and the normal discount; the server does the same maths).
const fmtTime = (hm) => { const [h, m] = String(hm).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const bulkOn = (p) => Number(p.bulk_min) >= 2 && Number(p.bulk_percent) > 0;
const unitFor = (p, q) => (bulkOn(p) && q >= Number(p.bulk_min) ? Math.min(fin(p), Math.round(Number(p.price) * (100 - Number(p.bulk_percent))) / 100) : fin(p));
// Smaller copies of product photos for lists and grids (the server makes and remembers them): a fraction of the bytes, same look.
const thumb = (url, w) => (url ? url + (url.includes('?') ? '&' : '?') + 'w=' + (SAVER() ? Math.min(w, 240) : w) : '');
const LOW_STOCK = 5;
const CATS = { drinks: 'Drinks', snacks: 'Snacks' };
const STATUS = { pending: 'Pending', packed: 'Packed', completed: 'Completed', cancelled: 'Cancelled' };
const CR_STATUS = { pending: 'Waiting for a price', quoted: 'Price offered', accepted: 'Accepted', declined: 'Declined', unavailable: "Can't provide" };

// Bug fix: private mode, blocked storage or a damaged saved value used to throw here and leave a blank page. Now the app just starts fresh.
const saved = (k, d) => { try { const v = localStorage.getItem(k); if (v == null || v === '') return d; const p = JSON.parse(v); return p == null ? d : p; } catch (e) { return d; } };
let token = ''; try { token = localStorage.getItem('token') || ''; } catch (e) {}
let user = saved('user', null);
if (!user || typeof user !== 'object' || !user.username) user = null;
let cart = saved('cart', {});
if (!cart || typeof cart !== 'object' || Array.isArray(cart)) cart = {};
let products = [];
let view = 'shop';
let searchText = '', catFilter = 'all';
const selected = new Set(); // products ticked in Admin for bulk changes
let combos = [], comboAdminHtml = '';
let ordLimit = 30, ordHasMore = false, favs = new Set(), auditLast = null, ordersCache = [], shownOrders = [], ordStatus = 'active', ordRange = 'all', ordDay = '', custHtml = '';
let installEvt = null; // Chrome's "install app" offer, kept until the person taps Install
let promo = null, cartNote = '', settings = { banner: '', stamp_reward: 'a free snack' }, promoAdminHtml = '', myOrders = [];
let sig = '', lastOrderId = null, mineHtml = '', adminHtml = '', statusMap = null, adminTab = 'dashboard', pendingCount = 0;
let ordSearch = '', costMap = {}, repData = null, revSig = '';
let customHtml = '', customAdminHtml = '', crMap = null, crList = [], lastCrId = null, pendingCustom = 0;
let arrange = false, dragBusy = false;
let sellerFilter = null, pubSellers = null, paidFlash = 0, slidesHtml = '', spotHtml = '', recentHtml = '', slideTimer = 0, holdUntil = 0;
const recent = (() => { try { return JSON.parse(localStorage.recent || '[]'); } catch (e) { return []; } })(); // product ids the customer tapped, newest first // arrange = Raven's drag-and-pin mode on the shop page; dragBusy pauses live refresh while a card is held

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
  // Only the server's own "not logged in" answer counts (a wrong admin password also answers 401 and must not sign anyone out).
  if (r.status === 401 && token && d.error === 'Log in to continue.') sessionEnded();
  if (!r.ok) throw new Error(d.error || 'Request failed.');
  return d;
}
// The login stopped working (it expired, or the password was changed on another device): sign out, say so once, and show the shop.
let endedAt = 0;
function sessionEnded() {
  if (Date.now() - endedAt < 3000) return; endedAt = Date.now();
  try { clearSession(); view = 'shop'; render(); } catch (e) { /* the page will refresh itself */ }
  toast('Your login ended. Please log in again.');
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
// Replays the soft entrance animation on whatever is below the tab bar (see .fx in style.css).
// Says exactly what the re-pricing found and did, so you can see what happened to pending and packed orders.
const repriceMsg = (r) => {
  if (!r) return '';
  if (r.reprice_error) return `The open orders could not be updated: ${r.reprice_error}`;
  const i = r.reprice_info || { checked: 0, pending: 0, packed: 0, changed_list: [] };
  if (!i.checked) return 'No pending or packed order has this item, so no order needed changing.';
  const n = i.changed_list.length;
  if (n) return `Updated ${n} order${n === 1 ? '' : 's'}: ${i.changed_list.map((x) => `#${x.id} (${x.status})`).join(', ')}.`;
  return `Checked ${i.checked} open order${i.checked === 1 ? '' : 's'} (${i.pending} pending, ${i.packed} packed): already at the current price.`;
};
function animateApp() {
  const a = $('#app'); if (!a) return;
  a.classList.remove('fx'); void a.offsetWidth; a.classList.add('fx');
}
const bumpCart = () => document.querySelectorAll('[data-act="cart"]').forEach((b) => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
const saveCart = () => { localStorage.cart = JSON.stringify(cart); renderNav(); bumpCart(); };
const setSession = (t, u) => { if (window.__onSession) window.__onSession(u); token = t; user = u; favs = new Set(); loadFavs(); statusMap = null; crMap = null; revSig = ''; try { localStorage.token = t; localStorage.user = JSON.stringify(u); } catch (e) { /* storage blocked: the login lasts until the page is closed */ } };
const clearSession = () => { token = ''; user = null; favs = new Set(); if (catFilter === 'favs') catFilter = 'all'; statusMap = null; crMap = null; revSig = ''; try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {} };
// isAdmin = any staff account (raven or a seller); isRaven = the main admin, who controls everything.
const isAdmin = () => user && (user.role === 'admin' || user.role === 'seller');
const isRaven = () => user && user.role === 'admin';
let sellers = [], team = [];
const vis = (l) => (isRaven() ? l.filter((x) => !x.hidden) : l); // hidden items vanish from every tab for the main admin (sellers are never told, so they never get the flag)
let pSearch = '';
const myProducts = () => (isRaven() ? products : products.filter((p) => p.owner_id === user.id));
const sTag = (id) => { const n = ownerName(id); return n ? `<span class="stag" style="--h:${(id * 67) % 360}">${esc(n)}</span>` : ''; }; // each seller keeps one colour
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
    (installEvt ? '<button data-act="install">Install app</button>' : '') +
    (user ? '<button data-act="logout">Log out</button>' : '');
}

const IC = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const ICONS = { shop: '<path d="M5 9h14l-1 11H6zM9 9V7a3 3 0 0 1 6 0v2"/>', custom: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>', cart: '<path d="M3 5h2l2 11h11l2-8H7"/><circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>', orders: '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4"/>', admin: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>', auth: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', logout: '<path d="M10 4H5v16h5M16 8l4 4-4 4M20 12H9"/>' };
const dockBtn = (act, label, extra = '', cls = '') => `<button class="${cls}${view === act ? ' on' : ''}" data-act="${act}" title="${label}" aria-label="${label}">${IC(ICONS[act])}${extra}</button>`;
function renderNav() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const q = $('#cartq');
  if (q) q.textContent = `Cart (${count})`;
  $('#nav').innerHTML = dockBtn('shop', 'Shop') + (isAdmin() ? '' : dockBtn('custom', 'Custom order')) +
    dockBtn('cart', 'Cart', count ? `<i>${count}</i>` : '') +
    (user && !isAdmin() ? dockBtn('orders', 'My orders') : '') + (isAdmin() ? dockBtn('admin', 'Admin') : '') +
    (user ? `<span class="pill" title="${esc(user.username)}">${esc(user.username.charAt(0).toUpperCase())}</span><button data-act="logout" title="Log out" aria-label="Log out">${IC(ICONS.logout)}</button>`
          : `<button class="primary" data-act="auth" title="Log in / Sign up" aria-label="Log in / Sign up">${IC(ICONS.auth)}</button>`);
  renderMobileNav();
  updateCartBar();
}

// Floating cart bar: item count, total and a View cart button, shown on the shop page whenever the cart has something.
function updateCartBar() {
  let bar = $('#cartbar');
  if (!bar) { bar = document.createElement('button'); bar.id = 'cartbar'; bar.dataset.act = 'cart'; bar.type = 'button'; document.body.appendChild(bar); }
  const lines = cartLines(), n = lines.reduce((s, l) => s + l.q, 0), sub = lines.reduce((s, l) => s + l.price * l.q, 0);
  bar.hidden = !n || view !== 'shop';
  bar.innerHTML = `<span class="cb-n">${n}</span><span>View cart</span><b>${money(sub)}</b>`;
}
async function loadFavs() {
  if (!token) return;
  try { favs = new Set(await api('/api/favorites')); if (view === 'shop') fillGrid(); } catch (e) { /* hearts just stay empty */ }
}
// "New" for 3 days after a product is added; "Best seller" from the server. Neither shows on sold-out items.
const tagFor = (p) => (p.is_sold_out || p.hidden ? '' : p.hot ? '<span class="tag hot">Best seller</span>' : Date.now() - new Date(p.created_at) < 3 * 864e5 ? '<span class="tag new">New</span>' : '');
const lowBadge = (p) => (!p.is_sold_out && !p.hidden && p.stock != null && p.stock <= LOW_STOCK ? `<span class="badge low${tagFor(p) || p.pinned ? ' stack' : ''}">Low stock</span>` : '');
const dealOn = (p) => !p.hidden && !p.is_sold_out && (Number(p.discount_percent) > 0 || bulkOn(p));
const EMPTY_ART = '<svg viewBox="0 0 160 130" aria-hidden="true"><defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a84ff"/><stop offset="1" stop-color="#bf5af2"/></linearGradient></defs><path d="M38 52h84l-8 56a10 10 0 0 1-10 9H56a10 10 0 0 1-10-9z" fill="url(#eg)" opacity=".9"/><path d="M60 52c0-16 8-26 20-26s20 10 20 26" fill="none" stroke="url(#eg)" stroke-width="7" stroke-linecap="round"/><circle cx="30" cy="30" r="5" fill="#ff9f0a"/><circle cx="132" cy="22" r="4" fill="#30d158"/><path d="M130 62l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#ff375f"/><path d="M26 74l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#64d2ff"/></svg>';
// a soft glow that blooms across the screen and fades when an order is placed (skipped if animations are turned off)
function burst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = document.createElement('div'); g.className = 'glow-burst'; g.setAttribute('aria-hidden', 'true');
  document.body.appendChild(g); setTimeout(() => g.remove(), 1800);
}
const heartBtn = (id) => `<button class="fav${favs.has(id) ? ' on' : ''}" data-act="fav" data-id="${id}" aria-pressed="${favs.has(id)}" aria-label="Favorite">${favs.has(id) ? '\u2665' : '\u2661'}</button>`;
const capHtml = (title, sub, price, attrs, dis, desc = '') => `<div class="cap"><div><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ''}${desc ? `<small class="desc">${desc}</small>` : ''}</div><span class="pr">${price}</span><button class="primary add" ${attrs} aria-label="Add ${title} to cart" ${dis ? 'disabled' : ''}>+</button></div>`;
const GRIP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 4H7l3-4z"/></svg>';
const PINMARK = `<span class="pinmark" title="Featured">${PIN_SVG}</span><i class="sheen"></i>`;
const arrangeCtl = (p) => `<div class="arr-ctl"><span class="grip" data-grip role="button" tabindex="0" aria-label="Move ${esc(p.title)}: drag, or use the arrow keys">${GRIP_SVG}</span>`
  + `<button type="button" class="sq pinbtn${p.pinned ? ' on' : ''}" data-act="pin" data-id="${p.id}" aria-pressed="${!!p.pinned}" aria-label="${p.pinned ? 'Unpin' : 'Pin to top'}: ${esc(p.title)}">${PIN_SVG}</button></div>`;
const productCard = (p) => {
  const off = Number(p.discount_percent) || 0;
  const note = bulkOn(p) ? `Buy ${p.bulk_min}+ and save ${p.bulk_percent}%` : (!p.is_sold_out && p.stock != null && p.stock <= LOW_STOCK ? `Only ${p.stock} left` : '');
  return `<article class="card t has-fav${p.pinned ? ' pinned' : ''}" data-sid="${p.id}"><div class="img">${heartBtn(p.id)}${shareBtn(p.id)}${tagFor(p)}${lowBadge(p)}${flashBadge(p)}${p.pinned ? PINMARK : ''}${arrange && isRaven() ? arrangeCtl(p) : ''}${p.image_url ? `<img loading="lazy" decoding="async" src="${esc(thumb(p.image_url, 640))}" srcset="${esc(thumb(p.image_url, 480))} 480w, ${esc(thumb(p.image_url, 800))} 800w, ${esc(thumb(p.image_url, 1000))} 1000w, ${esc(thumb(p.image_url, 1400))} 1400w" sizes="(max-width:560px) 50vw, (max-width:900px) 60vw, 40vw" alt="${esc(p.title)}">` : ''}${p.hidden ? '<span class="badge">Hidden from shop</span>' : p.is_sold_out ? '<span class="badge">Sold out</span>' : ''}${off ? `<span class="badge off chip" tabindex="0" aria-label="${off}% off, now ${money(fin(p))}"><i>-${off}% OFF</i><u>Now ${money(fin(p))}</u></span>` : ''}</div>` +
    capHtml(esc(p.title), note, `${off ? `<span class="was">${money(p.price)}</span> ` : ''}<b>${money(fin(p))}</b>`, `data-act="add" data-id="${p.id}"`, p.is_sold_out, esc(p.description)) + '</article>';
};
const comboCard = (c) => {
  const out = c.items.some((x) => x.is_sold_out);
  const regular = c.items.reduce((s, x) => s + fin(x) * x.quantity, 0);
  const save = regular - Number(c.price);
  const withPic = c.items.filter((x) => x.image_url).slice(0, 4);
  const imgs = withPic.map((x) => `<img loading="lazy" decoding="async" src="${esc(thumb(x.image_url, withPic.length === 1 ? 800 : 480))}" alt="">`).join('');
  return `<article class="card t combo" data-cid="${c.id}"><div class="img"><div class="combo-imgs">${imgs}</div>${out ? '<span class="badge">Sold out</span>' : save > 0 ? `<span class="badge off">Save ${money(save)}</span>` : ''}</div>` +
    capHtml(esc(c.title), '', `${save > 0 ? `<span class="was">${money(regular)}</span> ` : ''}<b>${money(c.price)}</b>`, `data-act="addcombo" data-id="${c.id}"`, out, c.items.map((x) => `${x.quantity}x ${esc(x.title)}`).join(', ')) + '</article>';
};

// Redraws only the product list, so the search box keeps focus while typing.
// Random order in the shop so no seller's items always sit on top. Picked once per page load,
// so the grid doesn't reshuffle while you search, filter or the page refreshes in the background.
const shuffleRank = new Map();
const rank = (key) => { if (!shuffleRank.has(key)) shuffleRank.set(key, Math.random()); return shuffleRank.get(key); };
const shuffled = (list, keyOf) => [...list].sort((a, b) => rank(keyOf(a)) - rank(keyOf(b)));
// Order of one section in the shop. Raven can pin products (they go first) and drag the rest into place; both are saved on the server.
// Products nobody has arranged yet stay in a random order, picked once per page load. If a section has nothing pinned or arranged,
// the old rule applies: up to 3 of Raven's own products are lifted to the top (in-stock ones first).
const PINNED = 3;
const bySort = (a, b) => (a.sort_order == null ? 1e9 : a.sort_order) - (b.sort_order == null ? 1e9 : b.sort_order);
const shuffledPinned = (list) => {
  const pinned = list.filter((p) => p.pinned).sort(bySort);
  const arranged = list.filter((p) => !p.pinned && p.sort_order != null).sort(bySort);
  if (!pinned.length && !arranged.length) {
    const mix = shuffled(list, (p) => 'p' + p.id);
    const mine = mix.filter((p) => settings.main_owner_id != null && p.owner_id === settings.main_owner_id)
      .sort((a, b) => Number(!!a.is_sold_out) - Number(!!b.is_sold_out)); // stable: keeps the random order among equals
    const top = mine.slice(0, PINNED);
    return [...top, ...mix.filter((p) => !top.includes(p))];
  }
  return [...pinned, ...arranged, ...shuffled(list.filter((p) => !p.pinned && p.sort_order == null), (p) => 'p' + p.id)];
};
function fillHero() {
  const chips = $('#herochips'), pics = $('#heropics'); if (!chips || !pics) return;
  const w = settings.order_window, n = products.filter((p) => !p.hidden && !p.is_sold_out).length;
  chips.innerHTML = ['Pay cash on delivery', n ? `${n} items in stock` : '', w && w.cutoff && !w.closed ? `Order before ${fmtTime(w.cutoff)} for same-day delivery` : ''].filter(Boolean).map((t) => `<span class="gchip">${esc(t)}</span>`).join('');
  const withPic = products.filter((p) => p.image_url && !p.hidden && !p.is_sold_out);
  const pick = [...withPic.filter((p) => p.pinned), ...withPic.filter((p) => !p.pinned)].slice(0, 3);
  pics.innerHTML = pick.map((p, i) => `<figure class="hp hp${i + 1}"><img decoding="async" src="${esc(thumb(p.image_url, 480))}" srcset="${esc(thumb(p.image_url, 480))} 480w, ${esc(thumb(p.image_url, 800))} 800w" sizes="260px" alt=""><figcaption><b>${esc(p.title)}</b><span>${money(fin(p))}</span></figcaption></figure>`).join('');
  pics.classList.toggle('empty', !pick.length);
  fillSlides(); fillSpot(); fillRecent();
}
function fillGrid() {
  fillHero(); const el = $('#grid'); if (el) flipRender(el, drawGrid); }
function drawGrid() {
  const el = $('#grid');
  if (!el) return;
  const arranging = arrange && isRaven(); // while arranging, every product of a section is shown (no search / favorites), so the saved order is complete
  el.classList.toggle('arrange', arranging);
  const text = arranging ? '' : searchText.trim().toLowerCase();
  const filter = arranging && (catFilter === 'favs' || catFilter === 'combos' || catFilter === 'deals') ? 'all' : catFilter;
  const match = (p) => (sellerFilter == null || p.owner_id === sellerFilter) && (!text || `${p.title} ${p.description}`.toLowerCase().includes(text));
  const catOf = (p) => (CATS[p.category] ? p.category : 'snacks');
  const comboList = !arranging && sellerFilter == null && (filter === 'all' || filter === 'combos')
    ? shuffled(combos.filter((c) => !c.hidden && match({ title: c.title, description: `${c.description} ${c.items.map((x) => x.title).join(' ')}` })), (c) => 'c' + c.id) : [];
  const groups = Object.keys(CATS)
    .filter((c) => filter === 'all' || filter === 'favs' || filter === 'deals' || filter === c)
    .map((c) => ({ c, list: sortList(shuffledPinned(products.filter((p) => !p.hidden && catOf(p) === c && match(p) && (!inStockOnly || arranging || !p.is_sold_out) && (filter !== 'favs' || favs.has(p.id)) && (filter !== 'deals' || dealOn(p))))) }))
    .filter((g) => g.list.length);
  const who = sellerFilter != null && (pubSellers || []).find((x) => x.id === sellerFilter);
  el.innerHTML = (sellerFilter != null ? `<div class="sfilter glass"><span>Showing items from <b>${esc(who ? who.username : 'this seller')}</b></span><button type="button" class="sq" data-act="seller-clear">Show everyone</button></div>` : '') + (comboList.length ? `<h2 class="cat-title">Combos</h2><section class="grid">${comboList.map(comboCard).join('')}</section>` : '')
    + groups.map((g) => `<h2 class="cat-title">${CATS[g.c]}</h2><section class="grid" data-sortlist="shop">${g.list.map(productCard).join('')}</section>`).join('')
    || `<div class="panel glass empty">${EMPTY_ART}<p>${filter === 'favs' ? 'No favorites yet. Tap the heart on a product to save it here.' : filter === 'deals' ? 'No deals right now. Check back soon!' : products.length || combos.length ? 'No products match your search.' : 'No products yet.'}</p></div>`;
}

// What Raven's order cutoff means for an order placed right now.
function orderNote() {
  const w = settings.order_window; if (!w || !w.cutoff) return '';
  const t = fmtTime(w.cutoff);
  return w.closed ? `Orders are closed for today (they stopped at ${t}). Come back tomorrow!`
    : w.label === 'tomorrow' ? `It's past ${t}, so new orders will be delivered tomorrow.`
    : `Order before ${t} to get it delivered today. Orders after that go out tomorrow.`;
}
function fillBanner() {
  const el = $('#banner'); if (!el) return;
  const n = orderNote();
  el.innerHTML = (settings.banner ? `<div class="banner glass">${esc(settings.banner)}</div>` : '') + (n ? `<div class="banner glass">${esc(n)}</div>` : '');
}

/* ---------- Highlights carousel, seller spotlight, recently viewed ---------- */
function slideData() {
  const ok = products.filter((p) => !p.hidden && !p.is_sold_out && p.image_url), out = [], used = new Set();
  const take = (p) => { used.add(p.id); return p; };
  if (settings.banner && ok.length) { const p = take(ok.find((x) => x.pinned) || ok[0]); out.push({ kind: 'Announcement', title: settings.banner, sub: 'Straight from the shop.', p, btn: 'Browse the shop', act: 'cat', cat: 'all' }); }
  const deal = ok.filter((x) => dealOn(x) && !used.has(x.id)).sort((a, b) => (Number(b.discount_percent) || 0) - (Number(a.discount_percent) || 0))[0];
  if (deal) { take(deal); out.push({ kind: 'Promo', title: Number(deal.discount_percent) > 0 ? `${deal.title} is ${deal.discount_percent}% off` : `Buy ${deal.bulk_min}+ ${deal.title} and save ${deal.bulk_percent}%`, sub: 'More deals are waiting in the Deals tab.', p: deal, btn: 'See all deals', act: 'cat', cat: 'deals' }); }
  const fresh = [...ok].filter((x) => !used.has(x.id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (fresh) { take(fresh); out.push({ kind: 'New arrival', title: fresh.title, sub: fresh.description || 'Just added to the shop.', p: fresh, btn: 'Add to cart', act: 'add' }); }
  const best = ok.find((x) => x.hot && !used.has(x.id));
  if (best) out.push({ kind: 'Best seller', title: best.title, sub: best.description || 'Customers keep coming back for this one.', p: best, btn: 'Add to cart', act: 'add' });
  return out;
}
function fillSlides() {
  const el = $('#slides'); if (!el) return;
  const list = slideData();
  const html = list.length ? `<div class="slides glass" role="region" aria-roledescription="carousel" aria-label="Highlights"><div class="sl-track">${list.map((x, i) => `<article class="slide" data-kind="${x.kind}" aria-label="${i + 1} of ${list.length}"><img decoding="async" src="${esc(thumb(x.p.image_url, 800))}" alt=""><div class="sl-txt"><span class="sl-k">${x.kind}</span><h3>${esc(x.title)}</h3><p>${esc(x.sub)}</p><button type="button" class="primary sq" data-act="${x.act}" ${x.act === 'cat' ? `data-cat="${x.cat}"` : `data-id="${x.p.id}"`}>${x.btn}</button></div></article>`).join('')}</div>${list.length > 1 ? `<div class="sl-dots">${list.map((_, i) => `<button type="button" class="${i ? '' : 'on'}" data-act="slide-go" data-i="${i}" aria-label="Show slide ${i + 1}"></button>`).join('')}</div>` : ''}</div>` : '';
  if (html === slidesHtml) return;
  slidesHtml = html; el.innerHTML = html; clearInterval(slideTimer);
  const tr = el.querySelector('.sl-track'); if (!tr || list.length < 2) return;
  const pause = (ms) => () => { holdUntil = Date.now() + ms; };
  el.addEventListener('pointerenter', pause(9000)); el.addEventListener('pointerdown', pause(9000)); el.addEventListener('focusin', pause(9000)); el.addEventListener('pointerleave', pause(1200));
  tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); el.querySelectorAll('.sl-dots button').forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
  if (!RM) slideTimer = setInterval(() => {
    if (!document.body.contains(tr)) return clearInterval(slideTimer);
    if (document.hidden || Date.now() < holdUntil) return;
    tr.scrollTo({ left: ((Math.round(tr.scrollLeft / tr.clientWidth) + 1) % list.length) * tr.clientWidth, behavior: 'smooth' });
  }, 5500);
}
async function loadPubSellers() { try { pubSellers = await api('/api/sellers/public'); } catch (e) { pubSellers = []; } fillSpot(); }
function fillSpot() {
  const el = $('#spot'); if (!el) return;
  if (pubSellers == null) { pubSellers = []; loadPubSellers(); return; }
  const cards = pubSellers.map((s) => {
    const mine = products.filter((p) => p.owner_id === s.id && !p.hidden && !p.is_sold_out);
    const best = mine.find((p) => p.hot && p.image_url) || mine.find((p) => p.pinned && p.image_url) || mine.find((p) => p.image_url);
    return best ? { s, n: mine.length, best } : null;
  }).filter(Boolean);
  const html = cards.length > 1 ? `<h2 class="cat-title">Meet the sellers</h2><div class="spot">${cards.map(({ s, n, best }) => `<article class="sp glass"><img loading="lazy" decoding="async" src="${esc(thumb(best.image_url, 240))}" alt=""><div><b>${esc(s.username)}</b><small>${n} item${n === 1 ? '' : 's'}. Best pick: ${esc(best.title)}</small><button type="button" class="sq" data-act="seller" data-id="${s.id}">Shop their items</button></div></article>`).join('')}</div>` : '';
  if (html !== spotHtml) { spotHtml = html; el.innerHTML = html; }
}
function markRecent(id) {
  id = Number(id); const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1);
  recent.unshift(id); recent.length = Math.min(recent.length, 10);
  try { localStorage.recent = JSON.stringify(recent); } catch (e) { /* private mode */ }
  fillRecent();
}
function fillRecent() {
  const el = $('#recent'); if (!el) return;
  const list = recent.map((id) => products.find((p) => p.id == id)).filter((p) => p && !p.hidden).slice(0, 8);
  const html = list.length ? `<h2 class="cat-title">Recently viewed</h2><div class="rv">${list.map((p) => `<article class="rv-card">${p.image_url ? `<img loading="lazy" decoding="async" src="${esc(thumb(p.image_url, 240))}" alt="">` : '<div class="ph"></div>'}<div class="rv-b"><b>${esc(p.title)}</b><span>${money(fin(p))}</span></div><button type="button" class="primary add" data-act="add" data-id="${p.id}" aria-label="Add ${esc(p.title)} to cart" ${p.is_sold_out ? 'disabled' : ''}>+</button></article>`).join('')}</div>` : '';
  if (html !== recentHtml) { recentHtml = html; el.innerHTML = html; }
}
const SKEL = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
const CHECK = '<svg class="chk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>';
const ring = (have, need) => { const k = Math.min(1, have / need), c = 2 * Math.PI * 9; return `<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle class="v" cx="12" cy="12" r="9" stroke-dasharray="${(k * c).toFixed(1)} ${c.toFixed(1)}"/>${k >= 1 ? '<path d="M8 12.5l3 3 5-6"/>' : ''}</svg>`; };
const arrBar = () => (arrange
  ? '<div class="arr-bar glass"><div><b>Arrange mode</b><span class="muted">Drag the handle on a card to move it, or focus it and use the arrow keys. The pin features a product at the top. It saves by itself and customers see it live.</span></div><button type="button" class="primary sq" data-act="arrange">Done</button></div>'
  : '<div class="arr-open"><button type="button" class="sq" data-act="arrange">Arrange shop</button></div>');
const CAT_IC = { all: '\u2728', combos: '\u{1F381}', drinks: '\u{1F964}', snacks: '\u{1F37F}' };
// "Your usual": the snacks this person orders most. Uses the page's own Add button, so adding works the same as everywhere else.
let usualData = null, usualAt = 0;
async function loadUsual() {
  const box = document.getElementById('usual');
  if (!box) return;
  if (!token) { box.innerHTML = ''; return; }
  if (!usualData || Date.now() - usualAt > 60000) {
    try { usualData = await api('/api/me/usual'); } catch (e) { usualData = []; }
    usualAt = Date.now();
  }
  if (!usualData.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h2 class="cat-title">Your usual</h2><div class="rv">${usualData.map((p) => `<article class="rv-card">${p.image_url ? `<img loading="lazy" decoding="async" src="${esc(p.image_url)}" alt="">` : ''}<b>${esc(p.title)}</b><span>${money(p.price)}</span><button class="primary" data-act="add" data-id="${p.id}"${p.is_sold_out ? ' disabled' : ''}>${p.is_sold_out ? 'Sold out' : 'Add'}</button></article>`).join('')}</div>`;
}
function renderShop() {
  Promise.resolve().then(loadUsual); // fills #usual once this markup is in place
  const tile = (id, label) => `<button class="tile${catFilter === id ? ' on' : ''}" data-act="cat" data-cat="${id}">${label}</button>`;
  $('#app').innerHTML = `<section class="hero"><h2>What are you craving?</h2><p>Fresh drinks and snacks. Pay cash when it is handed to you.</p>
      <div id="herochips"></div><input id="search" type="search" placeholder="Search snacks and drinks..." value="${esc(searchText)}" autocomplete="off" list="sugg"><datalist id="sugg">${products.filter((x) => !x.hidden).slice(0, 80).map((x) => `<option value="${esc(x.title)}"></option>`).join('')}</datalist><div id="heropics" aria-hidden="true"></div></section>
    <div id="usual"></div>
    <div class="divider" aria-hidden="true"></div>
    ${(() => { const msgs = ['Fresh drinks and snacks', 'Pay cash on delivery', 'New picks added often', 'Tap the heart to save your favorites', orderNote()].filter(Boolean), one = msgs.map((m) => `<span>\u2726 ${esc(m)}</span>`).join('');
      return `<div class="ticker" aria-hidden="true"><div class="ticker-track">${one}${one}</div></div>`; })()}
    <div id="slides"></div><div id="spot"></div><div id="banner"></div>
    <div class="cats">${tile('all', 'All')}${user ? tile('favs', '\u2665 Favorites') : ''}${products.some(dealOn) ? tile('deals', '\uD83D\uDD25 Deals') : ''}${tile('combos', 'Combos')}${Object.entries(CATS).map(([id, label]) => tile(id, label)).join('')}</div>
    ${sortBarHtml()}${isRaven() ? arrBar() : ''}<div id="usual"></div><div id="grid"></div><div id="recent"></div>`;
  slidesHtml = spotHtml = recentHtml = ''; sellerFilter = null;
  fillBanner();
  fillGrid();
  updateCartBar();
  fillUsual();
  tickCutoff();
}

const adminRows = () => { const ix = (p) => Object.keys(CATS).indexOf(CATS[p.category] ? p.category : 'snacks'); const q = pSearch.trim().toLowerCase(), hit = (p) => !q || [p.title, p.description, p.category, ownerName(p.owner_id)].join(' ').toLowerCase().includes(q); return (isRaven() ? [...products].sort((a, b) => ix(a) - ix(b)) : products).filter(hit); }; // owner's list is grouped by section so rows can be dragged within it
const productTable = () => `<table${isRaven() && !pSearch.trim() ? ' data-sortlist="admin"' : ''}>${adminRows().map((p) => {
  const mine = canEdit(p.owner_id);
  return `<tr data-sid="${p.id}" data-cat="${CATS[p.category] ? p.category : 'snacks'}">
    ${isRaven() ? `<td><span class="grip" data-grip role="button" tabindex="0" aria-label="Move ${esc(p.title)}: drag, or use the arrow keys">${GRIP_SVG}</span></td>` : ''}
    <td>${mine ? `<input type="checkbox" class="pick" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>` : ''}</td>
    <td>${p.image_url ? `<img class="thumb" loading="lazy" decoding="async" width="52" height="52" src="${esc(thumb(p.image_url, 160))}" alt="">` : ''}</td>
    <td><b>${esc(p.title)}</b>${stockCtl(p, mine)}${p.pinned ? ' <span class="pill st-packed">Pinned</span>' : ''}<br>${money(p.price)}${p.discount_percent ? ` (-${p.discount_percent}%)` : ''}${bulkOn(p) ? ` | Bulk: ${p.bulk_min}+ = -${p.bulk_percent}%` : ''} | ${CATS[p.category] || 'Snacks'}${mine && costMap[p.id] != null ? ` | Profit ${money(fin(p) - Number(costMap[p.id]))} each` : ''}${p.stock != null ? ` | Stock: ${p.stock}${p.stock > 0 && p.stock <= LOW_STOCK ? ' (low!)' : ''}` : ''}${p.is_sold_out ? ' - sold out' : ''}${ownerName(p.owner_id) ? ` | by ${sTag(p.owner_id)}` : ''}</td>
    <td>${mine ? `<div class="actions">
      <button data-act="flash" data-id="${p.id}">Flash sale</button>${isRaven() ? `<button data-act="pin" data-id="${p.id}">${p.pinned ? 'Unpin' : 'Pin to top'}</button>` : ''}<button data-act="edit" data-id="${p.id}">Edit</button>
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
  if (el) flipRender(el, () => { el.innerHTML = productTable(); });
  const lb = $('#lowbox');
  if (lb) {
    const m = myProducts().filter((p) => p.stock != null), out = m.filter((p) => p.stock === 0), low = m.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK);
    lb.innerHTML = out.length || low.length ? `<section class="panel glass">${low.length ? `<p style="margin:0"><b>Running low:</b> ${low.map((p) => `${esc(p.title)} (${p.stock})`).join(', ')}</p>` : ''}${out.length ? `<p style="margin:0"><b>Sold out:</b> ${out.map((p) => esc(p.title)).join(', ')}</p>` : ''}</section>` : '';
  }
  updatePicks();
}

const adminBtns = (o) => {
  const btn = (st, label, cls, extra = '') => `<button class="${cls}" data-act="setstatus" data-id="${o.id}" data-status="${st}"${extra}>${label}</button>`;
  const parts = o.parts || [];
  // On a shared order each owner approves their own part; otherwise the buttons change the order directly.
  const me = parts.length > 1 ? parts.find((x) => x.owner_id === user.id) : null;
  if (me && o.status === 'cancelled') return '';
  const st = me ? me.status : o.status;
  if (st === 'pending') return btn('packed', me ? 'Approve: packed' : 'Mark packed', 'primary');
  if (st === 'packed') return btn('completed', me ? 'Approve: complete' : 'Complete', 'primary');
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

const forTag = (o) => forTag0(o);
const forTag0 = (o) => {
  const t = (settings.order_window || {}).today;
  if (!t || !o.deliver_for || !['pending', 'packed'].includes(statusOf(o))) return '';
  return `<span class="pill">${o.deliver_for === t ? 'For today' : o.deliver_for > t ? 'For tomorrow' : 'Late: was ' + esc(o.deliver_for)}</span>`;
};
const paidTag = (o) => (o.paid_by ? `<span class="pill st-packed">${o.id === paidFlash ? CHECK : ''}Paid - ${esc(o.paid_name || '')}</span>`
  : ['packed', 'completed'].includes(o.status) ? `<span class="pill st-cancelled">Not paid yet</span>` : '');
const paidBtn = (o) => (!['packed', 'completed'].includes(o.status) ? ''
  : !o.paid_by ? `<button class="primary" data-act="paid" data-id="${o.id}" data-paid="1">Mark paid (cash in hand)</button>`
  : o.paid_by === user.id || isRaven() ? `<button data-act="paid" data-id="${o.id}" data-paid="0">Undo paid</button>` : '');
const orderCard = (o) => `
    <section class="panel glass">
      <div class="between"><b>#${o.id} - ${esc(o.username)}</b><span>${forTag(o)} ${paidTag(o)} <span class="pill st-${statusOf(o)}">${STATUS[statusOf(o)] || esc(statusOf(o))}</span></span></div>
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
  document.querySelectorAll('#ojump [data-r]').forEach((b) => b.classList.toggle('primary', b.dataset.r === ordRange && !ordDay));
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
  // Profit of an order = its total minus what its items cost you (only the items shown: just yours, or all sellers' for Raven's full view).
  const profitOf = (o) => {
    const own = mine || !isRaven();
    const cs = (o.costs || []).filter((c) => !own || c.owner_id === user.id);
    return { p: Number(o.total) - cs.reduce((s, c) => s + c.cost, 0), missing: cs.some((c) => c.missing) };
  };
  const prof = new Map(live.map((o) => [o.id, profitOf(o)]));
  const sumProfit = [...prof.values()].reduce((s, x) => s + x.p, 0), anyMissing = [...prof.values()].some((x) => x.missing);
  // Packing list: one short row per order (who has what), not a big box each.
  const when = (o) => { const d = new Date(o.created_at); return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
  const rows = live.map((o) => `<tr><td>#${o.id}</td><td><b>${esc(o.username)}</b><br><span class="s">${when(o)}</span></td>
      <td>${(o.items || []).map((i) => `${i.quantity} ${esc(i.title)}`).join(', ')}${o.note ? `<br><span class="s">Note: ${esc(o.note)}</span>` : ''}</td>
      <td class="r"><b>${money(o.total)}</b></td><td class="r">${money(prof.get(o.id).p)}${prof.get(o.id).missing ? '*' : ''}</td><td>[&nbsp;&nbsp;&nbsp;]</td></tr>`).join('');
  const sumTotal = live.reduce((s, o) => s + Number(o.total), 0);
  const listHtml = `<h2>${wantDone ? 'Items' : 'To pack'}</h2><ul class="sum">${summary}</ul>
    <h2>Who has what</h2><table><tr><th>Order</th><th>Customer</th><th>Items</th><th class="r">Total</th><th class="r">Profit</th><th>Packed</th></tr>${rows}</table>
    <div class="foot">${live.length} order${live.length === 1 ? '' : 's'} | Total ${money(sumTotal)} | Profit ${money(sumProfit)} | Cash on delivery</div>
    ${anyMissing ? '<div class="s">* Some items have no cost set, so that profit is too high.</div>' : ''}`;
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

// Open orders always come; finished ones come newest first, 30 at a time ("Load more"). While searching or looking at one
// day, the latest 500 finished orders are loaded so older orders can be found.
const finishedWanted = () => (ordSearch || ordDay ? Math.max(500, ordLimit) : ordLimit);
const paintMore = () => {
  const el = $('#omore'); if (!el) return;
  el.innerHTML = !ordHasMore ? '' : (ordSearch || ordDay) && finishedWanted() >= 500 && ordLimit < 500
    ? '<p class="muted">Searching the latest 500 finished orders.</p>'
    : '<button data-act="omore">Load 30 more finished orders</button>';
};
async function refreshAudit(more) {
  const box = $('#auditbox'); if (!box) return;
  const rows = await api('/api/admin/audit' + (more && auditLast ? '?before=' + auditLast : ''));
  if (!more) box.innerHTML = '';
  if (rows.length) auditLast = rows[rows.length - 1].id;
  const html = rows.map((r) => `<div class="req"><div class="between"><b>${esc(r.username)}${r.role === 'admin' ? ' (you)' : ''}</b><span class="muted">${new Date(r.at).toLocaleString()}</span></div>
    <p style="margin:2px 0 0"><b>${esc(r.action)}</b>${r.detail ? `<br><span class="muted">${esc(r.detail)}</span>` : ''}</p></div>`).join('');
  box.insertAdjacentHTML('beforeend', html);
  if (!box.children.length) box.innerHTML = '<p>Nothing recorded yet. Changes made from now on will show here.</p>';
  $('#auditmore').innerHTML = rows.length >= 50 ? '<button data-act="auditmore">Load older</button>' : '';
}
const SEC_LABELS = { login_failed: 'Wrong password', lockout: 'Address locked out', login_blocked: 'Blocked while locked out', staff_login: 'Staff sign-in', password_changed: 'Password changed', rate_limited: 'Too many requests', fake_picture: 'Fake picture refused' };
async function refreshSecurity() {
  const box = $('#secbox'); if (!box) return;
  const d = await api('/api/admin/security');
  const checks = d.checks.map((c) => `<li style="margin:6px 0">${c.ok ? '\u2705' : '\u26a0\ufe0f'} <span${c.ok ? '' : ' style="color:var(--bad);font-weight:700"'}>${esc(c.label)}</span></li>`).join('');
  const rows = d.events.length ? d.events.map((e) => `<div class="req"><div class="between"><b>${esc(SEC_LABELS[e.type] || e.type)}</b><span class="muted">${new Date(e.at).toLocaleString()}</span></div>
    <p style="margin:2px 0 0" class="muted">${e.ip ? 'Address ' + esc(e.ip) : ''}${e.user ? ' \u00b7 ' + esc(e.user) : ''}${e.detail ? '<br>' + esc(e.detail) : ''}</p></div>`).join('')
    : '<p>Nothing suspicious recorded since the shop last started.</p>';
  box.innerHTML = `<section class="panel glass"><h2>Security</h2>
    <p class="muted">The shop checks every request: it limits floods, locks out guessing, refuses fake pictures, and ends old logins when a password changes.</p>
    <ul style="list-style:none;padding:0;margin:10px 0">${checks}</ul>
    <div class="stats"><div class="stat glass"><b>${d.failed24h}</b><span>wrong passwords (24 h)</span></div><div class="stat glass"><b>${d.locked}</b><span>addresses locked out now</span></div></div></section>
    <section class="panel glass"><h3>Recent events</h3><p class="muted">Newest first. This list resets when the server restarts; the server log keeps the full history.</p>${rows}</section>`;
  if (window.AdminPlus && window.AdminPlus.shield) window.AdminPlus.shield(box);
}
async function refreshOrders() {
  const want = finishedWanted();
  const orders = await api('/api/orders?finished=' + want);
  ordHasMore = orders.filter((o) => o.status !== 'pending' && o.status !== 'packed').length >= want;
  const top = orders.reduce((m, o) => Math.max(m, o.id), 0);
  if (lastOrderId !== null && top > lastOrderId) { toast('New order received.'); SFX.ding(); try { navigator.vibrate && navigator.vibrate([40, 60, 40]); } catch (e) {} }
  lastOrderId = top;
  pendingCount = orders.filter((o) => o.status === 'pending').length;
  const tb = $('#tab-orders');
  if (tb) tb.textContent = 'Orders' + (pendingCount ? ` (${pendingCount})` : '');
  ordersCache = orders;
  drawOrders();
  paintMore();
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
    ${r.handled_by_name ? `<p class="muted" style="margin:6px 0 0">Handled by ${esc(r.handled_by_name)}</p>` : ''}
    ${r.status === 'pending' || r.status === 'quoted'
      ? (r.handled_by && r.handled_by !== user.id && !isRaven()
        ? `<p class="muted" style="margin-top:10px">${esc(r.handled_by_name)} is handling this one.</p>`
        : `<div class="actions" style="margin-top:10px"><button class="primary" data-act="quote" data-id="${r.id}">${r.status === 'pending' ? 'Set price' : 'Change price'}</button></div>`) : ''}
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
      <td><b>${esc(c.title)}</b><br><span class="muted">${c.items.map((x) => `${x.quantity}x ${esc(x.title)}`).join(', ')}${ownerName(c.owner_id) ? ` | made by ${sTag(c.owner_id)}` : ''}</span></td>
      <td>${money(c.price)}</td><td><span class="pill">${comboState(c)}</span></td>
      <td><div class="actions">
        ${my && my.status !== 'approved' ? `<button class="primary" data-act="combo-approve" data-id="${c.id}" data-yes="1">Approve</button>` : ''}
        ${my && my.status !== 'declined' ? `<button class="danger" data-act="combo-approve" data-id="${c.id}" data-yes="0">Decline</button>` : ''}
        ${isRaven() ? (c.approvals || []).filter((x) => x.owner_id !== user.id && x.status !== 'approved').map((x) => `<button data-act="combo-approve" data-id="${c.id}" data-yes="1" data-owner="${x.owner_id}">Approve for ${esc(x.username)}</button>`).join('') : ''}
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
  if (el) el.innerHTML = sellers.length ? `<table>${sellers.map((x) => `<tr><td><b>${esc(x.username)}</b>${x.products_hidden ? ' <span class="pill st-cancelled">Hidden from shop</span>' : ''}</td>
    <td><div class="actions"><button data-act="seller-hide" data-id="${x.id}" data-hidden="${x.products_hidden ? 1 : 0}" class="${x.products_hidden ? 'primary' : ''}">${x.products_hidden ? 'Show products' : 'Hide products'}</button><button data-act="seller-rename" data-id="${x.id}">Rename</button><button data-act="seller-pw" data-id="${x.id}">New password</button>
    <button class="danger" data-act="seller-del" data-id="${x.id}">Remove</button><button class="danger" data-act="seller-split" data-id="${x.id}" data-name="${esc(x.username)}">Split off</button></div></td></tr>`).join('')}</table>` : '<p>No sellers yet.</p>';
  const ob = $('#ownerbox');
  if (ob) {
    const cur = ob.querySelector('select') ? ob.querySelector('select').value : '';
    ob.innerHTML = sellers.length ? `<label>Owner</label><select name="owner_id"><option value="${user.id}">Me (${esc(user.username)})</option>${sellers.map((x) => `<option value="${x.id}">${esc(x.username)}</option>`).join('')}</select>` : '';
    if (cur && ob.querySelector('select')) ob.querySelector('select').value = cur;
  }
  fillProducts();
}

// "Needs attention": one quiet row of buttons under the Admin tabs. Shows only what needs doing and disappears when everything is done.
let attnAt = 0, attnCash = null;
async function refreshAttention(force) {
  if (force || !attnCash || Date.now() - attnAt > 60000) { attnAt = Date.now(); attnCash = await api('/api/admin/cash'); }
  drawAttention();
}
function drawAttention() {
  const el = $('#attn'); if (!el) return;
  const today = (settings.order_window || {}).today, pend = ordersCache.filter((o) => statusOf(o) === 'pending');
  const forTomorrow = today ? pend.filter((o) => o.deliver_for && o.deliver_for > today).length : 0, toPack = ordersCache.length || !pendingCount ? pend.length - forTomorrow : pendingCount;
  const low = myProducts().filter((p) => p.stock != null && p.stock <= LOW_STOCK).length;
  const owed = attnCash ? attnCash.unpaid.filter((o) => o.status === 'completed').reduce((t, o) => t + Object.values(o.shares).reduce((a, b) => a + b, 0), 0) : 0;
  const card = (tab, big, label, on, st = '', hot = false) => `<button class="stat${on ? (hot ? ' hot' : ' on') : ''}" data-act="attn-go" data-tab="${tab}" ${st ? `data-st="${st}"` : ''}><b>${big}</b><span>${label}</span></button>`;
  const html = `<div class="stats">${card('orders', toPack, 'to pack today', toPack > 0, 'pending', true)}${card('orders', forTomorrow, 'for tomorrow', forTomorrow > 0, 'pending')}${card('cash', money(owed), 'delivered, not marked paid', owed > 0.004)}${card('products', low, 'items low or sold out', low > 0)}${pendingCustom ? card('custom', pendingCustom, 'custom requests to answer', true) : ''}</div>`;
  if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } // only redraw on a change, so the pop-in doesn't replay every refresh
}
async function refreshCosts() { costMap = await api('/api/admin/costs'); fillProducts(); }
async function refreshReport() { repData = await api('/api/admin/report?days=30'); drawReport(); drawDash(); }
function drawReport() {
  const el = $('#reportbox'); if (!el || !repData) return;
  const t = repData.days.find((d) => d.day === repData.today) || { orders: 0, revenue: 0, profit: 0 };
  const who = (repData.people || []).map((x) => `<tr><td><b>${esc(x.username)}</b>${x.role === 'admin' ? ' <span class="muted">(admin)</span>' : ''}</td><td>Gross <b>${money(x.gross)}</b> <span class="muted">(${x.done} completed)</span></td><td>Income <b>${money(x.income)}</b>${x.missing_cost ? ' <span class="muted">(some costs missing)</span>' : ''}</td><td>Potential income <b>${money(x.potential)}</b> <span class="muted">(${x.open} open)</span></td></tr>`).join('');
  el.innerHTML = `<h3>${isRaven() ? 'Income per seller' : 'Your income'}</h3><p class="muted">Gross = sales of completed orders. Income = gross minus the cost prices (same as Profit below). Potential income = the profit on pending and packed orders still to come (price minus cost, so 50 sold with a cost of 30 = 20). Each person's own items only, all time.</p>${who ? `<table>${who}</table>` : ''}
    <h3>Today</h3><p><b>${t.orders}</b> completed orders | Sales <b>${money(t.revenue)}</b> | Profit <b>${money(t.profit)}</b></p>
    ${repData.missing_cost ? `<p class="muted">${repData.missing_cost} order lines have no cost price, so profit is too high. Set a cost on each product (Products tab, Edit).</p>` : ''}
    <h3>Last 30 days</h3>${repData.days.length ? `<table>${repData.days.map((d) => `<tr><td><b>${esc(d.day)}</b></td><td>${d.orders} order${d.orders === 1 ? '' : 's'}</td><td>Sales ${money(d.revenue)}</td><td>Profit <b>${money(d.profit)}</b></td></tr>`).join('')}</table>` : '<p>No completed orders yet.</p>'}
    <h3>By item (best profit first)</h3>${repData.items.length ? `<table>${repData.items.map((i) => `<tr><td>${esc(i.title)}</td><td>${i.qty} sold</td><td>Sales ${money(i.revenue)}</td><td>${i.known ? `Profit <b>${money(i.profit)}</b>` : '<span class="muted">Set a cost to see profit</span>'}</td></tr>`).join('')}</table>` : '<p>Nothing yet.</p>'}`;
}
// Reminder for the main admin: how long since the last copy that would survive the database being deleted.
let backupInfo = null;
function drawBackupReminder() {
  const el = $('#adminnotes');
  if (!el) return;
  if (!isRaven() || !backupInfo) { el.innerHTML = ''; return; }
  const t = backupInfo.last_safe_backup ? new Date(backupInfo.last_safe_backup).getTime() : null;
  const days = t ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
  if (days !== null && days < 1) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="note-banner ${days === null || days >= 7 ? 'bad' : 'warn'}"><span>${days === null
    ? '<b>No backup saved yet.</b> Render can delete the database, so download one now.'
    : `<b>Last backup was ${days} day${days === 1 ? '' : 's'} ago.</b> Download a fresh one so you never lose orders.`}</span><button class="primary" data-act="backup">Download backup</button></div>`;
}
async function loadBackupInfo() {
  try { backupInfo = await api('/api/admin/backup-status'); } catch (e) { backupInfo = null; }
  drawBackupReminder();
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
  const GROUPS = [
    ['dashboard', 'Dashboard', [['dashboard', 'Overview'], ['report', 'Report']]],
    ['orders', 'Orders', [['orders', 'Orders', pendingCount ? ` (${pendingCount})` : ''], ['custom', 'Custom orders', pendingCustom ? ` (${pendingCustom})` : ''], ['prep', 'Prep list'], ['cash', 'Cash']]],
    ['products', 'Catalog', [['products', 'Products'], ['combos', 'Combos'], ['promos', 'Promos'], ...(isRaven() ? [['popups', 'Pop-ups']] : [])]],
    ['customers', 'People', isRaven() ? [['customers', 'Customers'], ['sellers', 'Sellers']] : [['customers', 'Customers'], ['alerts', 'Alerts']]],
    ...(isRaven() ? [['backup', 'System', [['backup', 'Backup'], ['audit', 'Activity'], ['security', 'Security']]]] : []),
  ];
  const cur = GROUPS.find((g) => g[2].some((x) => x[0] === adminTab)) || GROUPS[0];
  const badge = (g) => { const n = g[0] === 'orders' ? pendingCount + pendingCustom : 0; return n ? ` (${n})` : ''; };
  const tabs = `<div class="tabs">${GROUPS.map((g) => `<button class="${g === cur ? 'primary' : ''}" data-act="admintab" data-tab="${g === cur ? adminTab : g[2][0][0]}">${g[1]}${badge(g)}</button>`).join('')}</div>`;
  const subtabs = cur[2].length > 1 ? `<div class="subrow"><div class="subtabs">${cur[2].map((x) => tab(x[0], x[1], x[2] || '')).join('')}</div>${cur[0] === 'customers' && isRaven() ? '<button data-act="accounts-csv">Download all accounts</button>' : ''}</div>` : '';
  const productsView = `
    <section class="panel glass">
      <h2 id="form-title">Add a product</h2>
      <form id="pform">
        <div class="row"><div><label>Title</label><input name="title" required maxlength="200"></div>
          <div><label>Price</label><input name="price" type="number" step="0.01" min="0" required></div></div>
        <div id="ownerbox"></div>
        <label>Category</label><select name="category"><option value="drinks">Drinks</option><option value="snacks">Snacks</option></select>
        <label>Discount % (0 for none)</label><input name="discount_percent" type="number" min="0" max="90" value="0">
        <div class="row"><div><label>Bulk discount: buy at least (leave empty for none)</label><input name="bulk_min" type="number" min="2" max="999" step="1"></div>
          <div><label>Bulk discount % off each</label><input name="bulk_percent" type="number" min="0" max="90" value="0"></div></div>
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
        <button data-act="reprice">Update open orders to current prices</button>
      </div>
      <input id="psearch" type="search" placeholder="Search products by name, description, section or seller..." autocomplete="off" value="${esc(pSearch)}" style="margin:0 0 12px">
      <div id="plist">${SKEL}</div></section>`;
  const ordersView = `<h2>Orders</h2>
    <div class="toolbar" id="ofilters">
      <div class="chips quick" id="ojump"><button type="button" data-act="ojump" data-r="today">Today</button><button type="button" data-act="ojump" data-r="week">This week</button><button type="button" data-act="ojump" data-r="all">All time</button></div>
      <input type="search" id="osearch" placeholder="Search customer or order #" autocomplete="off" style="max-width:240px">
      <div class="chips">
        <button data-act="ofilter" data-st="active">Active</button><button data-act="ofilter" data-st="pending">To pack</button><button data-act="ofilter" data-st="packed">Packed</button>
        <button data-act="ofilter" data-st="completed">Completed</button><button data-act="ofilter" data-st="all">All</button>
      </div>
      <select id="orange"><option value="all">All time</option><option value="today">Today</option>
        <option value="yesterday">Yesterday</option><option value="week">Last 7 days</option></select>
      <input type="date" id="oday" aria-label="Pick a day">
      <button class="primary" data-act="print-orders">Print packing list</button>
        <button data-act="guest-order">New order for a customer</button>
      ${isRaven() ? '<label class="pickrow" style="padding:0"><input type="checkbox" id="onlymine"> Print only my items</label>' : ''}
    </div>
    <p class="muted" id="ocount" style="margin:0 0 4px"></p>
    <div id="olist">${SKEL}</div>
    <div id="omore" style="text-align:center;margin:14px 0"></div>`;
  const cashView = '<section class="panel glass"><h2>Cash</h2><div id="cashbox"><p>Loading...</p></div></section>';
  const reportView = `<section class="panel glass">
      <h2>Export sales (CSV)</h2>
      <p class="muted">One row per item sold, for Excel or Google Sheets. ${isRaven() ? 'Includes every seller.' : 'Includes only your items.'}</p>
      <div class="toolbar">
        <label>From <input type="date" id="csvfrom"></label><label>To <input type="date" id="csvto"></label>
        <label class="pickrow" style="padding:0"><input type="checkbox" id="csvcancel"> Include cancelled</label>
      </div>
      <div class="actions"><button class="primary" data-act="csv">Download CSV</button><button data-act="csvq" data-q="today">Today</button><button data-act="csvq" data-q="month">This month</button><button data-act="csvq" data-q="last">Last month</button></div>
    </section>
    <section class="panel glass table-wrap"><h2>Sales and profit</h2><div id="reportbox"><p>Loading...</p></div></section>`;
  const customView = '<section class="panel glass table-wrap"><h2>Custom orders</h2><div id="clist"><p>Loading...</p></div></section>';
  const combosView = `<section class="panel glass">
      <h2>Create a combo</h2>
      <form id="combo-form">
        <label>Combo name</label><input name="title" required maxlength="120" placeholder="e.g. Movie night snack pack">
        <label>Description (optional)</label><input name="description" maxlength="300">
        <label>Combo price</label><input name="price" type="number" step="0.01" min="0" required>
        <label>Tick the products and how many of each</label>
        <p class="muted" style="margin:0 0 8px">You can add other sellers' products too. They must approve before the combo goes live, and each seller approves her own part of every order.</p>
        <div class="picks">${products.map((p) => `<label class="pickrow"><input type="checkbox" name="pid" value="${p.id}"> ${esc(p.title)} (${money(fin(p))})${ownerName(p.owner_id) ? ` - by ${sTag(p.owner_id)}` : ''}
          <input type="number" min="1" max="20" value="1" data-qty="${p.id}"></label>`).join('') || '<p>Add products first.</p>'}</div>
        <p class="muted" id="combo-sum"></p>
        <button class="primary" type="submit">Create combo</button>
      </form>
    </section>
    <section class="panel glass table-wrap"><h2>Combos</h2><div id="combolist"><p>Loading...</p></div></section>`;
  const popupsView = `<section class="panel glass"><h2>Add a pop-up</h2>
      <form id="popup-form"><label>Title</label><input name="title" maxlength="80" required>
        <label>Message</label><textarea name="text" maxlength="300" rows="3" required></textarea>
        <label>Button text (optional)</label><input name="btn" maxlength="30">
        <label>Button link (optional: https://... or a path like /)</label><input name="url" maxlength="300">
        <label>Show from (optional)</label><input name="from" type="datetime-local">
        <label>Show until (optional)</label><input name="to" type="datetime-local">
        <button class="primary" type="submit">Add pop-up</button></form>
      <p class="muted">Visitors see one random pop-up that is switched on, a few seconds after the shop opens, at most once every 10 minutes. They can close it or choose not to see it again.</p></section>
    <section class="panel glass"><h2>Your pop-ups</h2><div id="popuplist"><p>Loading...</p></div></section>`;
  const promosView = `${isRaven() ? `<section class="panel glass">
      <h2>Announcement banner</h2>
      <form id="settings-form">
        <label>Text shown at the top of the shop (leave empty to hide)</label><input name="banner" maxlength="200" value="${esc(settings.banner)}">
        <label>Stamp card reward (earned after every 10 completed orders)</label><input name="stamp_reward" maxlength="80" value="${esc(settings.stamp_reward)}">
        <label>Customers can change an order for this many minutes after placing it (0 = off)</label><input name="edit_window" type="number" min="0" max="120" step="1" value="${settings.edit_window ?? 10}">
        <label>Order cutoff time (orders after this are for tomorrow; leave empty for no cutoff)</label><input name="order_cutoff" type="time" value="${esc(settings.order_cutoff || '')}">
        <label>After the cutoff</label><select name="after_cutoff"><option value="tomorrow" ${settings.after_cutoff !== 'closed' ? 'selected' : ''}>Accept orders for tomorrow</option><option value="closed" ${settings.after_cutoff === 'closed' ? 'selected' : ''}>Stop taking orders</option></select>
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
      <hr style="border:0;border-top:3px solid var(--ink);margin:22px 0">
      <p><b>Automatic backups</b> are saved here every 3 days (the newest 5 are kept). They live in the same database as the shop, so still download one by hand now and then and keep it somewhere safe.</p>
      <div id="autobk"><p>Loading...</p></div>
      <hr style="border:0;border-top:3px solid var(--ink);margin:22px 0">
      <p><b>Restore</b> replaces everything on the site with the contents of a backup file. Use it on a new, empty database.</p>
      <input id="bfile" type="file" accept=".json,application/json">
      <button class="danger" data-act="restore">Restore from backup</button>
      <hr style="border:0;border-top:3px solid var(--ink);margin:22px 0">
      <p><b>Reset sales</b> starts the sales numbers from zero: it deletes finished orders (history, reports, customer stamps), cash settlements between sellers and the promo "times used" counters. Products, accounts, combos and promo codes stay. A full safety backup is saved first (see Automatic backups above).</p>
      <label class="pickrow" style="padding:0"><input type="checkbox" id="rskeep" checked> Keep orders that are still to pack or packed</label>
      <input id="rsconfirm" placeholder="Type RESET to confirm" autocomplete="off" style="max-width:260px">
      <button class="danger" data-act="salesreset">Reset sales</button>
    </section>`;
  const auditView = `<section class="panel glass"><h2>Activity</h2>
      <p class="muted">Who changed what: products, prices, stock, order status, sellers and settings. Newest first; the last 5000 changes are kept. Passwords are never recorded.</p>
      <div id="auditbox"><p>Loading...</p></div><div id="auditmore" style="text-align:center;margin-top:12px"></div></section>`;
  const customersView = `<h2>Customers</h2>
    <p class="muted">Block people who abuse the shop (fake orders, not showing up). ${isRaven() ? 'Your block covers the whole shop.' : 'Your block stops them ordering your items only.'} The list shows the most cancelled orders first.</p>
    <div id="custlist"><p>Loading...</p></div>`;
  $('#app').innerHTML = tabs + subtabs + '<div id="attn"></div><div id="adminnotes"></div>' + (adminTab === 'dashboard' ? '<section class="dash" id="dashbox"><p class="panel glass muted">Loading your numbers...</p></section>' : adminTab === 'report' ? reportView : adminTab === 'cash' ? cashView : adminTab === 'orders' ? ordersView : adminTab === 'custom' ? customView : adminTab === 'backup' && isRaven() ? backupView : adminTab === 'audit' && isRaven() ? auditView : adminTab === 'sellers' && isRaven() ? sellersView : adminTab === 'alerts' && !isRaven() ? alertsView : adminTab === 'combos' ? combosView : adminTab === 'popups' && isRaven() ? popupsView : adminTab === 'security' && isRaven() ? '<div id="secbox"><section class="panel glass"><h2>Security</h2><p class="muted">Loading...</p></section></div>' : adminTab === 'prep' ? '<div id="prepbox"></div>' : adminTab === 'promos' ? promosView : adminTab === 'customers' ? customersView : productsView);
  fillProducts();
  comboAdminHtml = ''; refreshAdminCombos().catch(() => {});
  promoAdminHtml = ''; refreshAdminPromos().catch(() => {});
  paintOrderFilters();
  custHtml = ''; refreshCustomers().catch(() => {});
  refreshOrders().catch(() => {});
  refreshCustom().catch(() => {});
  refreshTeam().catch(() => {});
  if (adminTab === 'cash') refreshCash().catch(() => {});
  if (adminTab === 'report' || adminTab === 'dashboard') refreshReport().catch(() => {});
  refreshCosts().catch(() => {});
  refreshAttention().catch(() => {});
  if (isRaven() && adminTab === 'backup') refreshBackup().catch(() => {});
  if (isRaven() && adminTab === 'popups') refreshPopups().catch(() => {});
  if (adminTab === 'prep') { drawPrep(); refreshOrders().then(drawPrep).catch(() => {}); }
  if (isRaven() && adminTab === 'audit') refreshAudit(false).catch(() => {});
  if (isRaven() && adminTab === 'security') refreshSecurity().catch(() => {});
  if (isRaven()) loadBackupInfo();
  if (isRaven()) refreshSellers().catch(() => {}); else loadAlerts().catch(() => {});
}

async function loadMine() {
  const orders = await api('/api/orders/mine');
  if (statusMap) orders.forEach((o) => {
    if (statusMap[o.id] && statusMap[o.id] !== o.status) {
      if (o.status === 'packed') { toast(`Order #${o.id} is packed and ready.`); SFX.ding(); }
      else if (o.status === 'completed') { toast(`Order #${o.id} is delivered. Enjoy!`); SFX.order(); }
      else if (o.status === 'cancelled') { toast(o.cancel_reason ? `Order #${o.id} was cancelled: ${o.cancel_reason}` : `Order #${o.id} was cancelled.`); SFX.error2(); }
    }
  });
  statusMap = Object.fromEntries(orders.map((o) => [o.id, o.status]));
  return orders;
}

// Change order: allowed for a few minutes while the order is still pending (orders with combos can only be cancelled).
const changeLeft = (o) => Math.ceil((new Date(o.created_at).getTime() + Number(settings.edit_window ?? 10) * 60000 - Date.now()) / 60000);
const canChange = (o) => o.status === 'pending' && Number(settings.edit_window ?? 10) > 0 && changeLeft(o) > 0 && (o.items || []).length > 0 && (o.items || []).every((i) => i.product_id);
const tracker = (status) => {
  const idx = { pending: 0, packed: 1, completed: 2 }[status] ?? 0;
  return `<div class="track">${['Placed', 'Packed', 'Delivered'].map((l, i) => `<div class="st${i <= idx ? ' done' : ''}"><i>${i <= idx ? '\u2713' : i + 1}</i>${l}</div>`).join('')}</div>`;
};
async function fillMine() {
  const el = $('#mine');
  const orders = await loadMine();
  myOrders = orders;
  if (!el) return;
  const goal = 10, done = orders.filter((o) => o.status === 'completed').length, stamps = done % goal;
  const card = isAdmin() ? '' : `<section class="panel glass"><b>Stamp card</b>
      <div class="stamps${done && !stamps ? ' ready' : ''}">${Array.from({ length: goal }, (_, i) => `<span class="stp${i < stamps || (done && !stamps) ? ' on' : ''}" style="--i:${i}"></span>`).join('')}</div>
      <p class="muted" style="margin:0">${done && !stamps
        ? `Reward ready! Show this to the seller to get ${esc(settings.stamp_reward)}.`
        : `${goal - stamps} more completed order${goal - stamps === 1 ? '' : 's'} to earn ${esc(settings.stamp_reward)}.`}</p></section>`;
  const html = card + (orders.map((o) => `
    <section class="panel glass">
      <div class="between"><b>Order #${o.id}</b><span class="pill st-${o.status}">${STATUS[o.status] || esc(o.status)}</span></div>
      <p class="muted" style="margin:2px 0 10px">${new Date(o.created_at).toLocaleString()}</p>
      ${o.status !== 'cancelled' ? tracker(o.status) : ''}
      ${o.status === 'cancelled' && o.cancel_reason ? `<p class="cancel-why">${esc(o.cancel_reason)}</p>` : ''}
      ${o.status === 'packed' ? '<p class="ready">Your order is packed and ready!</p>' : ''}
      ${orderLines(o)}
      ${o.note ? `<p class="muted" style="margin:8px 0 0">Your note: ${esc(o.note)}</p>` : ''}
      ${canChange(o) ? `<p class="muted" style="margin:8px 0 0">You can change this order for ${changeLeft(o)} more minute${changeLeft(o) === 1 ? '' : 's'}.</p>` : ''}
      <div class="actions" style="margin-top:12px">
        ${canChange(o) ? `<button class="primary" data-act="change" data-id="${o.id}">Change order</button>` : ''}
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
      <p style="padding:10px 14px;border-radius:8px;border:3px dashed var(--ink);background:var(--yellow);color:#000;font-size:.92rem">
        <b>Please note:</b> external charges may apply to custom orders. The price we send back is the one that counts, and you can accept or decline it.</p>
      ${form}
    </section>
    ${user ? '<h2>My custom requests</h2><div id="cmine"></div>' : ''}`;
  if (user) fillCustomMine().catch(() => {});
}

function render() {
  if (view !== 'shop' || !isRaven()) arrange = false;
  renderNav();
  if (view === 'admin' && isAdmin()) renderAdmin();
  else if (view === 'orders' && user && !isAdmin()) renderOrders();
  else if (view === 'custom' && !isAdmin()) renderCustom();
  else { view = 'shop'; renderShop(); }
}
async function loadProductsQuiet() {
  // The first load uses what index.html already fetched while the startup animation played; later refreshes ask the server.
  const pre = window.__pre; window.__pre = null;
  const got = pre ? await pre.catch(() => null) : null;
  [products, combos, settings] = got || await Promise.all([api('/api/products'), api('/api/combos'), api('/api/settings')]);
  sig = JSON.stringify([products, combos, settings]);
  stockWatch();
}
async function loadProducts() {
  await loadProductsQuiet();
  render();
}

/* ---------- Dialogs ---------- */
// Asks how many before adding to the cart. A counted item can't go above what is left in stock.
function deliveryLine() {
  const w = settings.order_window; if (!w || !w.cutoff) return '';
  return `<p class="muted">${w.closed ? 'Orders are closed for today.' : w.label === 'tomorrow' ? 'This order will be delivered <b>tomorrow</b>.' : `Delivered <b>today</b> if you order before ${fmtTime(w.cutoff)}.`}</p>`;
}
function askQty(key, title, stock, hint) {
  const room = Math.min(99, stock != null ? stock - (cart[key] || 0) : 99 - (cart[key] || 0));
  if (room < 1) return toast(stock != null ? `You already have all ${stock} in your cart.` : 'Cart limit reached for this item.');
  $('#dlg').innerHTML = `<h2>${esc(title)}</h2><p class="muted">${stock != null && stock <= LOW_STOCK ? `Only ${stock} left. ` : ''}${esc(hint)}</p>
    <form data-form="qty" data-key="${esc(String(key))}">
      <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin:10px 0">
        <button type="button" data-act="qty-step" data-d="-1">-</button>
        <input name="qty" id="qtyin" type="number" min="1" max="${room}" value="1" inputmode="numeric" style="width:90px;text-align:center;font-size:1.3rem">
        <button type="button" data-act="qty-step" data-d="1">+</button>
      </div>
      <button class="primary">Add to cart</button><button type="button" data-act="close">Cancel</button></form>`;
  $('#dlg').showModal();
  setTimeout(() => { const i = $('#qtyin'); if (i) i.select(); }, 50);
}
let forcePw = false;
function changePwDialog() {
  forcePw = true;
  const dlg = $('#dlg');
  // Background requests can ask for this again while the form is open. Rebuilding it would wipe what the person is typing and close the phone keyboard.
  if (dlg.open && dlg.querySelector('[data-form="changepw"]')) return;
  dlg.innerHTML = `<h2>Choose a new password</h2><p class="muted">You logged in with a temporary password. Pick your own to continue.</p><form data-form="changepw">
    <label>Temporary password</label><input name="current_password" type="password" required autocomplete="current-password">
    <label>New password (8+ characters)</label><input name="new_password" type="password" required minlength="8" autocomplete="new-password">
    <button class="primary">Save new password</button><button type="button" data-act="logout">Log out</button></form>`;
  if (!dlg.open) dlg.showModal();
  setTimeout(() => { const i = dlg.querySelector('input[name="current_password"]'); if (i) i.focus(); }, 80);
}
function rememberLogin(name, pw) {
  try { localStorage.setItem('shop_last_user', name); } catch (e) { /* storage blocked */ }
  try { if (window.PasswordCredential && navigator.credentials) navigator.credentials.store(new PasswordCredential({ id: name, password: pw, name })).catch(() => {}); } catch (e) { /* not supported */ }
}
function authDialog() {
  $('#dlg').innerHTML = `<style>
    .au-tabs{display:flex;gap:6px;padding:4px;border-radius:14px;background:rgba(128,128,128,.16);margin:6px 0 12px}
    .au-tabs button{flex:1;margin:0;padding:10px 8px;border:0;border-radius:11px;background:transparent;font-weight:700;cursor:pointer;color:inherit;opacity:.7}
    .au-tabs button.on{background:var(--acc,#0a84ff);color:#fff;opacity:1}
    .au-hint{margin:0 0 8px;font-size:.95em;opacity:.85}.au-note{display:block;margin:6px 0 12px;opacity:.7}
    .au-pw{position:relative}.au-pw input{width:100%;box-sizing:border-box;padding-right:64px}
    .au-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);margin:0;padding:6px 10px;border:0;border-radius:8px;background:rgba(128,128,128,.2);cursor:pointer;font-size:.85em;color:inherit}
    .au-go{width:100%;margin-top:4px;padding:12px}.au-x{width:100%;margin-top:6px}
  </style>
  <h2>Welcome to the shop</h2>
  <div class="au-tabs" role="tablist"><button type="button" class="on" data-t="login" role="tab">Log in</button><button type="button" data-t="signup" role="tab">New here? Sign up</button></div>
  <p class="au-hint" id="au-hint"></p>
  <form data-form="auth">
    <label for="au-user">Username</label><input id="au-user" name="username" required maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false">
    <label for="au-pass">Password</label><div class="au-pw"><input id="au-pass" name="password" type="password" required autocomplete="current-password"><button type="button" class="au-eye" aria-label="Show or hide password">Show</button></div>
    <small class="au-note" id="au-note"></small>
    <button class="primary au-go" data-mode="login" id="au-go">Log in</button>
    <button type="button" class="au-x" data-act="close">Cancel</button></form>`;
  const dlg = $('#dlg'), tabs = dlg.querySelectorAll('.au-tabs button'), go = dlg.querySelector('#au-go'), pass = dlg.querySelector('#au-pass'), user = dlg.querySelector('#au-user');
  const setMode = (m) => {
    const su = m === 'signup';
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.t === m));
    go.dataset.mode = m; go.textContent = su ? 'Create my account' : 'Log in';
    pass.minLength = su ? 8 : 0; pass.autocomplete = su ? 'new-password' : 'current-password';
    user.placeholder = su ? 'Pick any name you like' : 'Your username';
    pass.placeholder = su ? 'At least 8 characters' : 'Your password';
    dlg.querySelector('#au-hint').textContent = su ? 'Make a shop account in a few seconds.' : 'Welcome back! Enter your username and password.';
    dlg.querySelector('#au-note').textContent = su ? 'No email needed. Just a username and a password you will remember.' : 'Forgot your password? Ask the shop to reset it for you.';
  };
  tabs.forEach((t) => { t.onclick = () => { setMode(t.dataset.t); user.focus(); }; });
  dlg.querySelector('.au-eye').onclick = (e) => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? 'Hide' : 'Show'; };
  setMode('login');
  try { const last = localStorage.getItem('shop_last_user'); if (last) user.value = last; } catch (e) { /* storage blocked */ }
  if (navigator.credentials && window.PasswordCredential) navigator.credentials.get({ password: true, mediation: 'optional' }).then((c) => { if (c && c.type === 'password') { user.value = c.id; pass.value = c.password; } }).catch(() => {});
  $('#dlg').showModal();
  (user.value ? pass : user).focus();
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
      return c && { key, title: 'Combo: ' + c.title, price: Number(c.price), q, owner: c.owner_id, parts: comboParts(c), img: c.image_url || '' };
    }
    const p = products.find((x) => x.id == key);
    if (!p) return null;
    const hit = bulkOn(p) && q >= Number(p.bulk_min);
    const note = hit ? ` <small class="muted bulk">${ring(q, Number(p.bulk_min))} bulk price, ${p.bulk_percent}% off</small>` : bulkOn(p) ? ` <small class="muted bulk">${ring(q, Number(p.bulk_min))} add ${Number(p.bulk_min) - q} more to save ${p.bulk_percent}%</small>` : '';
    return { key, title: p.title, price: unitFor(p, q), q, owner: p.owner_id, note, img: p.image_url || '', list: Number(p.price) };
  }).filter(Boolean);
}
let cartUndo = null; // { items, label }: what the last Remove / Clear took out, so it can be put back
const undoBanner = () => cartUndo ? `<div class="cart-undo"><span>${esc(cartUndo.label)}</span><button type="button" data-act="cart-undo">Undo</button></div>` : '';
const saveLine = (lines) => { const s = lines.reduce((t, l) => t + (l.list ? Math.max(0, l.list - l.price) * l.q : 0), 0); return s > 0.004 ? `<p class="cart-save">You are saving ${money(s)} with deals</p>` : ''; };
// "You might also like": up to 3 in-stock products that are not in the cart yet, one tap to add.
function suggestHtml(lines) {
  const have = new Set(lines.map((l) => String(l.key)));
  const list = products.filter((p) => !p.is_sold_out && !have.has(String(p.id))).slice(0, 3);
  if (!list.length) return '';
  return `<div class="cart-sug"><h3>You might also like</h3><div class="sug-row">${list.map((p) => `<div class="sug">${p.image_url ? `<img loading="lazy" alt="" src="${esc(thumb(p.image_url, 120))}">` : '<span class="ph"></span>'}<div><b>${esc(p.title)}</b><span>${money(fin(p))}</span></div><button type="button" class="primary" data-act="cart-sug" data-id="${p.id}" aria-label="Add ${esc(p.title)}">+</button></div>`).join('')}</div></div>`;
}
function cartDialog() {
  const dlg = $('#dlg'), again = dlg.open && dlg.dataset.kind === 'cart'; // already showing the cart: this is just a refresh after + / - / remove
  const keep = again ? { d: dlg.scrollTop, b: (dlg.querySelector('.cart-body') || {}).scrollTop || 0 } : null;
  const ae = again && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.act === 'cart-step' ? { id: document.activeElement.dataset.id, d: document.activeElement.dataset.d } : null;
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
  const n = lines.reduce((t, l) => t + l.q, 0), total = sub - off;
  dlg.innerHTML = `<div class="cart-head"><div><h2>Your cart</h2><span class="cart-count">${n} item${n === 1 ? '' : 's'}</span></div><button type="button" class="cart-x" data-act="close" aria-label="Close cart">&times;</button></div>
    <div class="cart-body">${lines.length ? '' : `<div class="empty">${EMPTY_ART}<p>Your cart is empty.<br><span class="muted">Tap + on anything you like.</span></p></div>`}${undoBanner()}${lines.map((l) => `<div class="cline">${l.img ? `<img class="cl-i" loading="lazy" alt="" src="${esc(thumb(l.img, 160))}">` : '<span class="cl-i"></span>'}<span class="cl-t">${esc(l.title)}<small class="cl-u">${money(l.price)} each</small>${l.note || ''}</span><div class="qty"><button data-act="cart-step" data-id="${l.key}" data-d="-1" aria-label="One less">-</button><b>${l.q}</b><button data-act="cart-step" data-id="${l.key}" data-d="1" aria-label="One more">+</button></div><b class="cl-p">${money(l.price * l.q)}</b><button class="cl-r" data-act="remove" data-id="${l.key}">Remove</button></div>`).join('')}
    ${lines.length ? `<div class="cart-tools"><button type="button" data-act="cart-clear">Clear cart</button></div>
      <div class="cart-extra"><label>Promo code (optional)</label>
      <div class="actions"><input id="promoin" value="${esc(promo ? promo.code : '')}" placeholder="Enter code" style="flex:1;margin:0"><button data-act="applypromo">Apply</button></div>
      <label style="display:block;margin-top:12px">Note for the seller (your name, seat, anything helpful)</label>
      <input id="ordernote" maxlength="300" value="${esc(cartNote)}">
      <div class="cart-chips">${['Please pack separately', 'Call me when ready', 'No need for change'].map((t) => `<button type="button" data-act="note-chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      ${suggestHtml(lines)}` : ''}</div>
    <div class="cart-foot">${saveLine(lines)}
    <p class="sum-m">Subtotal: <b>${money(sub)}</b>${off ? `<br>Promo ${esc(promo.code)} (-${promo.percent}%): <b>-${money(off)}</b>` : ''}<br><b>Total: ${money(total)}</b></p>
    <div class="sum-d"><div><span>Subtotal</span><b>${money(sub)}</b></div>${off ? `<div class="sum-off"><span>Promo ${esc(promo.code)} (-${promo.percent}%)</span><b>-${money(off)}</b></div>` : ''}<div class="sum-total"><span>Total</span><b>${money(total)}</b></div></div>${deliveryLine()}
    <p class="notice">Cash on delivery: you pay when your order is handed to you in class.</p>
    <button class="primary" data-act="checkout" ${lines.length ? '' : 'disabled'}>Place order</button>
    <button class="close-btn" data-act="close">Close</button><p class="cart-keys">Esc closes the cart</p></div>`;
  if (!again) { cartUndo = null; SFX.cartOpen(); }
  dlg.dataset.kind = 'cart'; // desktop shows the cart as a side drawer, phones as a bottom sheet
  dlg.showModal();
  // A refresh must not throw the person back to the top of the list or drop the keyboard focus.
  if (keep) { dlg.scrollTop = keep.d; const cb = dlg.querySelector('.cart-body'); if (cb) cb.scrollTop = keep.b; }
  if (ae) { const t = dlg.querySelector(`[data-act="cart-step"][data-id="${ae.id}"][data-d="${ae.d}"]`); if (t) t.focus({ preventScroll: true }); }
  cartMotion(again, total);
}
// Desktop drawer motion (GSAP): rows slide in, the footer rises, and the total counts to its new value. Phones keep the plain sheet.
let gsapP = null, lastCartTotal = null;
const wideMotion = () => matchMedia('(min-width:641px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.glass !== 'lite';
const loadGsap = () => window.gsap ? Promise.resolve(window.gsap) : (gsapP = gsapP || new Promise((ok) => { const sc = document.createElement('script'); sc.src = '/vendor/gsap.min.js'; sc.onload = () => ok(window.gsap || null); sc.onerror = () => ok(null); document.head.appendChild(sc); }));
function cartMotion(again, total) {
  const from = again && lastCartTotal !== null ? lastCartTotal : total;
  lastCartTotal = total;
  if (!wideMotion()) return;
  const g = window.gsap;
  if (!g) { loadGsap(); return; } // first open: fetch it quietly so the next opening is animated
  const dlg = $('#dlg');
  if (!again) {
    g.from(dlg.querySelectorAll('.cline'), { opacity: 0, x: 26, duration: .5, stagger: .06, delay: .1, ease: 'power3.out', clearProps: 'all' });
    g.from(dlg.querySelectorAll('.cart-extra, .cart-foot'), { opacity: 0, y: 14, duration: .45, stagger: .08, delay: .2, ease: 'power3.out', clearProps: 'all' });
  }
  const t = dlg.querySelector('.sum-total b');
  if (t && from !== total) { const o = { v: from }; g.to(o, { v: total, duration: .5, ease: 'power2.out', onUpdate: () => { t.textContent = money(o.v); }, onComplete: () => { t.textContent = money(total); } }); }
}
if (wideMotion()) setTimeout(loadGsap, 4000); // prefetch after the shop has settled
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
  shop: () => { view = 'shop'; render(); animateApp(); },
  cat: (id, d) => {
    catFilter = d.cat;
    if ($('#grid')) { document.querySelectorAll('.cats .tile').forEach((t) => t.classList.toggle('on', t.dataset.cat === catFilter)); fillGrid(); } // cards glide to their new places
    else renderShop();
  },
  arrange: () => {
    if (!isRaven()) return;
    arrange = !arrange;
    if (arrange) { searchText = ''; if (catFilter === 'favs' || catFilter === 'combos') catFilter = 'all'; }
    renderShop();
  },
  pin: async (id) => {
    const p = products.find((x) => x.id == id);
    if (!p || !isRaven()) return;
    const on = !p.pinned;
    await api(`/api/products/${id}/pin`, { method: 'PATCH', json: { pinned: on } });
    await syncProducts();
    view === 'shop' ? fillGrid() : fillProducts();
    toast(on ? `${p.title} is pinned to the top.` : `${p.title} is unpinned.`);
  },
  fav: async (id) => {
    const pid = Number(id);
    if (!user) return toast('Log in to save favorites.');
    const on = !favs.has(pid);
    on ? favs.add(pid) : favs.delete(pid);
    if (on) document.querySelectorAll(`[data-act="fav"][data-id="${pid}"]`).forEach((b) => { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); });
    document.querySelectorAll(`[data-act="fav"][data-id="${pid}"]`).forEach((b) => { b.classList.toggle('on', on); b.textContent = on ? '\u2665' : '\u2661'; b.setAttribute('aria-pressed', on); });
    try { await api(`/api/favorites/${pid}`, { method: on ? 'POST' : 'DELETE' }); if (catFilter === 'favs') fillGrid(); }
    catch (e) { on ? favs.delete(pid) : favs.add(pid); fillGrid(); toast('Could not save that. Try again.'); }
  },
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
  omore: async () => { ordLimit += 30; await refreshOrders(); },
  ojump: (id, d) => { ordRange = d.r; ordDay = ''; paintOrderFilters(); drawOrders(); },
  'slide-go': (id, d) => { const tr = $('.sl-track'); if (tr) { holdUntil = Date.now() + 9000; tr.scrollTo({ left: Number(d.i) * tr.clientWidth, behavior: 'smooth' }); } },
  seller: (id) => { sellerFilter = Number(id); catFilter = 'all'; document.querySelectorAll('.cats .tile').forEach((t) => t.classList.toggle('on', t.dataset.cat === 'all')); fillGrid(); const g = $('#grid'); if (g) smoothTo(g); },
  'seller-clear': () => { sellerFilter = null; fillGrid(); },
  ofilter: (id, d) => { ordStatus = d.st; paintOrderFilters(); drawOrders(); },
  'print-orders': () => printOrders(shownOrders, 'list'),
  'print-order': (id) => { const o = ordersCache.find((x) => x.id == id); if (o) printOrders([o], 'receipt'); },
  applypromo: async () => {
    if (!user) { authDialog(); return toast('Log in to use a promo code.'); }
    const code = $('#promoin').value.trim();
    if (!code) { promo = null; return cartDialog(); }
    promo = await api('/api/promos/check?code=' + encodeURIComponent(code));
    cartDialog(); SFX.promoOk(); toast(`${promo.percent}% off applied.`);
  },
  change: async (id) => {
    const o = myOrders.find((x) => x.id == id); if (!o) return;
    if (!confirm('Change this order? It will be cancelled and its items put back in your cart so you can edit them and place it again.')) return;
    await api(`/api/orders/${id}/cancel`, { method: 'PATCH', json: { change: true } });
    await loadProductsQuiet(); // the cancel gave the stock back
    let skipped = 0;
    (o.items || []).forEach((i) => { const p = products.find((x) => x.id == i.product_id); if (p && !p.is_sold_out) cart[p.id] = Math.min(99, (cart[p.id] || 0) + i.quantity); else skipped++; });
    saveCart(); await fillMine().catch(() => {});
    toast(skipped ? 'Some items are no longer available.' : o.promo_code ? `Back in your cart. Re-enter promo ${o.promo_code}.` : 'Back in your cart. Edit it and place it again.');
    cartDialog();
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
  'seller-hide': async (id, d) => {
    const hide = d.hidden !== '1';
    await api(`/api/admin/sellers/${id}/hidden`, { method: 'PATCH', json: { hidden: hide } });
    await refreshSellers(); await loadProducts(); toast(hide ? 'Hidden from the shop until you turn it back on.' : 'Visible in the shop again.');
  },
  'guest-order': () => {
    const list = myProducts().filter((p) => !p.is_sold_out && !p.hidden);
    $('#dlg').innerHTML = `<h2>New order for a customer</h2><p class="muted">For someone who cannot log in. It appears in Orders under their name, like any other order.</p><form data-form="guestorder">
      <label>Customer name</label><input name="customer_name" required minlength="2" maxlength="30" autocomplete="off">
      <label>How they message you (optional)</label><input name="contact" maxlength="120" autocomplete="off" placeholder="Messenger, phone...">
      <label>Items: set how many</label><div class="picks">${list.map((p) => `<label class="pickrow">${esc(p.title)} (${money(fin(p))})<input type="number" name="q_${p.id}" min="0" max="99" value="0" inputmode="numeric"></label>`).join('') || '<p>No products available.</p>'}</div>
      <label>Note (optional)</label><input name="note" maxlength="200" autocomplete="off">
      <button class="primary">Place order</button><button type="button" data-act="close">Cancel</button></form>`;
    $('#dlg').showModal();
  },
  'seller-rename': async (id) => {
    const cur = (sellers.find((x) => x.id == id) || {}).username || '';
    const name = prompt('New username for this seller (3-30 letters, numbers or _):', cur);
    if (!name || name.trim() === cur) return;
    await api(`/api/admin/sellers/${id}`, { method: 'PATCH', json: { username: name.trim() } });
    await refreshSellers(); await loadProducts(); toast('Seller renamed.');
  },
  'seller-pw': async (id) => {
    const pw = prompt('New password for this seller (8+ characters):');
    if (!pw) return;
    await api(`/api/admin/sellers/${id}/password`, { method: 'PATCH', json: { password: pw } }); toast('Password changed.');
  },
  'seller-split': (id, d) => {
    $('#dlg').innerHTML = `<h2>Split off from ${esc(d.name)}</h2>
      <p>This <b>permanently deletes</b> all of ${esc(d.name)}'s products, combos and promo codes, and her account. Past orders stay in your history. Other sellers' combos that use her products are switched off.</p>
      <p class="muted">It is refused while she has open orders or money is unsettled between you. Type your admin password to confirm.</p>
      <form data-form="split" data-id="${id}"><label>Your admin password</label><input name="admin_password" type="password" required autocomplete="current-password">
      <button class="danger">Split off for good</button><button type="button" data-act="close">Cancel</button></form>`;
    $('#dlg').showModal();
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
  addcombo: (id) => { const c = combos.find((x) => x.id == id); quickAdd('c' + id, c ? c.title : 'Combo', null); },
  reprice: async () => {
    const r = await api('/api/orders/reprice', { method: 'POST' });
    await refreshOrders().catch(() => {});
    toast(repriceMsg(r));
  },
  bulkdisc: async () => {
    if (!selected.size) return toast('Tick the products first.');
    const pct = $('#discpct').value;
    if (pct === '') return toast('Type the discount % first (0 removes it).');
    const r = await api('/api/products/discount', { method: 'PATCH', json: { ids: [...selected], percent: pct } });
    selected.clear(); await loadProducts();
    if (r && r.repriced_orders) await refreshOrders().catch(() => {});
    toast((Number(pct) ? `${pct}% discount applied. ` : 'Discount removed. ') + repriceMsg(r));
  },
  'combo-approve': async (id, d) => {
    await api(`/api/combos/${id}/approval`, { method: 'PATCH', json: { approve: d.yes === '1', ...(d.owner ? { owner_id: d.owner } : {}) } });
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
  admin: () => { view = 'admin'; render(); animateApp(); },
  orders: () => { view = 'orders'; render(); animateApp(); },
  custom: () => { view = 'custom'; render(); animateApp(); },
  admintab: (id, d) => {
    // Keep the page where it was: remember the scroll position and how far the tab bar was scrolled sideways,
    // and hold the page height while the new tab loads so the browser doesn't jump up.
    const app = $('#app'), y = window.scrollY, tx = ($('.tabs') || {}).scrollLeft || 0;
    app.style.minHeight = app.offsetHeight + 'px';
    adminTab = d.tab; renderAdmin();
    const bar = $('.tabs'); if (bar) bar.scrollLeft = tx;
    window.scrollTo(0, y);
    animateApp();
    setTimeout(() => { app.style.minHeight = ''; }, 900);
  },
  quote: (id) => quoteDialog(id),
  salesreset: async () => {
    if (($('#rsconfirm').value || '').trim() !== 'RESET') return toast('Type RESET in the box first.');
    if (!confirm('Delete the sales history now? A safety backup is saved first.')) return;
    const r = await api('/api/admin/sales-reset', { method: 'POST', json: { confirm: 'RESET', keepOpen: $('#rskeep').checked } });
    $('#rsconfirm').value = '';
    await refreshOrders().catch(() => {}); refreshBackup().catch(() => {});
    toast(`Sales reset: ${r.removed} order${r.removed === 1 ? '' : 's'} removed. A backup was saved first.`);
  },
  csvq: (id, d) => {
    const now = new Date(), ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    let a = now, b = now;
    if (d.q === 'month') a = new Date(now.getFullYear(), now.getMonth(), 1);
    if (d.q === 'last') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    $('#csvfrom').value = ymd(a); $('#csvto').value = ymd(b);
  },
  csv: async () => {
    const from = $('#csvfrom').value, to = $('#csvto').value;
    if (!from || !to) return toast('Pick a start day and an end day, or tap Today / This month / Last month.');
    const r = await fetch(`/api/admin/sales.csv?from=${from}&to=${to}&cancelled=${$('#csvcancel').checked ? 1 : 0}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await r.blob());
    link.download = `sales-${from}_to_${to}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    toast('Sales file downloaded.');
  },
  'accounts-csv': async () => {
    if (!confirm('This file lists every account (customers, sellers and you) with their details and their passwords in scrambled form. Keep it private. Download it?')) return;
    const r = await fetch('/api/admin/accounts.csv', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Download failed.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await r.blob());
    link.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    toast('Accounts file downloaded.');
  },
  auditmore: () => refreshAudit(true),
  backup: async () => {
    const r = await fetch('/api/admin/export', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Backup failed.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await r.blob());
    link.download = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    backupInfo = { ...(backupInfo || {}), last_safe_backup: new Date().toISOString() }; drawBackupReminder();
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
    if (d.paid === '1') { paidFlash = Number(id); setTimeout(() => { paidFlash = 0; }, 1800); }
    refreshAttention(true).catch(() => {});
    await refreshOrders(); if (adminTab === 'cash') await refreshCash(); toast(d.paid === '1' ? 'Marked paid.' : 'Paid tick removed.');
  },
  settle: async (id, d) => {
    const v = prompt(`How much did ${d.names} hand over?`, d.amt);
    if (v === null) return;
    await api('/api/admin/settlements', { method: 'POST', json: { from_id: d.from, to_id: d.to, amount: v } });
    await refreshCash(); toast('Recorded.');
  },
  setstatus: async (id, d) => {
    let reason = '';
    if (d.status === 'cancelled') {
      if (d.reason === 'ask') { const why = prompt("Why can't this order be delivered? The customer will see this.", 'Out of stock today'); if (why === null) return; reason = why; }
      else if (!confirm('Cancel this order?')) return;
    }
    const r = await api(`/api/orders/${id}/status`, { method: 'PATCH', json: { status: d.status, reason } });
    const o0 = ordersCache.find((x) => x.id == id);
    if (d.status === 'completed' && o0 && !o0.paid_by && confirm('Did you collect the cash?\nOK = tick Paid. Cancel = not yet.')) {
      try { await api(`/api/orders/${id}/paid`, { method: 'PATCH', json: { paid: true } }); } catch (e) { toast(e.message); }
    }
    await refreshOrders();
    toast(r.waiting && r.waiting.length ? `Saved. Waiting for ${r.waiting.join(', ')} to approve too.`
      : d.status === 'packed' ? 'Marked packed. The customer is notified.' : 'Order updated.');
  },
  close: () => { if ($('#dlg').dataset.kind === 'cart') SFX.cartClose(); $('#dlg').close(); },
  auth: authDialog,
  cart: cartDialog,
  install: () => installApp(),
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
  // One tap adds one (change the amount in the cart). Products with a bulk deal still ask first, so the offer is seen.
  add: (id) => { const p = products.find((x) => x.id == id); if (!p) return; if (bulkOn(p)) askQty(id, p.title, p.stock, `Buy ${p.bulk_min} or more for ${p.bulk_percent}% off each.`); else quickAdd(id, p.title, p.stock); },
  'qty-step': (_, d) => { const i = $('#qtyin'); i.value = Math.max(1, Math.min(Number(i.max) || 99, (parseInt(i.value) || 1) + Number(d.d))); },
  remove: (id) => {
    const l = cartLines().find((x) => x.key === String(id)), q = cart[id];
    const go = () => { cartUndo = { items: { [id]: q }, label: `Removed ${l ? l.title : 'item'}.` }; delete cart[id]; saveCart(); cartDialog(); };
    SFX.remove();
    const row = $('#dlg').querySelector(`.cline [data-act="remove"][data-id="${id}"]`);
    if (row && !matchMedia('(prefers-reduced-motion: reduce)').matches) { row.closest('.cline').classList.add('leaving'); setTimeout(go, 260); } else go();
  },
  'cart-clear': () => { if (!Object.keys(cart).length) return; cartUndo = { items: { ...cart }, label: 'Cart cleared.' }; cart = {}; SFX.clear(); saveCart(); cartDialog(); },
  flash: (id) => flashDialog(id),
  surprise: () => surprise(),
  stock: async (id, d) => {
    const r = await api(`/api/products/${id}/stock`, { method: 'PATCH', json: { delta: Number(d.d) } });
    const pr = products.find((x) => x.id == id); if (pr) { pr.stock = r.stock; pr.is_sold_out = r.is_sold_out; }
    const b = document.querySelector(`.stk[data-id="${id}"] b`); if (b) b.textContent = r.stock;
  },
  'flash-end': async (id) => { await api(`/api/products/${id}/flash`, { method: 'PATCH', json: { percent: 0, minutes: 0 } }); $('#dlg').close(); await loadProducts(); toast('Flash sale ended.'); },
  share: async (id) => {
    const pr = products.find((x) => x.id == id); if (!pr) return;
    const url = location.origin + location.pathname + '?p=' + id;
    try { if (navigator.share) await navigator.share({ title: pr.title, text: `${pr.title} at Snackify`, url }); else { await navigator.clipboard.writeText(url); toast('Link copied.'); } } catch (er) { /* cancelled */ }
  },
  'popup-prev': (id) => { const p = popupAdmin.find((x) => x.id === id); if (p) showPopup(p); },
  'popup-on': async (id) => { const p = popupAdmin.find((x) => x.id === id); if (p) { p.on = !p.on; await savePopups(); } },
  'popup-del': async (id) => { if (!confirm('Delete this pop-up?')) return; popupAdmin = popupAdmin.filter((x) => x.id !== id); await savePopups(); toast('Pop-up deleted.'); },
  'cart-undo': () => { if (!cartUndo) return; Object.entries(cartUndo.items).forEach(([k, q]) => { cart[k] = Math.min(99, (cart[k] || 0) + q); }); cartUndo = null; SFX.undo(); saveCart(); cartDialog(); },
  'note-chip': (_, d) => { const i = $('#ordernote'); if (!i) return; const t = d.t; i.value = i.value.includes(t) ? i.value : (i.value ? i.value + '. ' : '') + t; cartNote = i.value.slice(0, 300); i.value = cartNote; },
  'cart-sug': (id) => { const p = products.find((x) => x.id == id); if (!p) return; const have = cart[id] || 0; if (p.stock != null && have >= p.stock) return toast(`Only ${p.stock} in stock.`); cart[id] = have + 1; SFX.add(); saveCart(); cartDialog(); },
  'cart-step': (id, d) => {
    const n = (cart[id] || 0) + Number(d.d), p = String(id).startsWith('c') ? null : products.find((x) => x.id == id);
    const max = Math.min(99, p && p.stock != null ? p.stock : 99);
    if (n < 1) return; // use Remove to take an item out
    (Number(d.d) > 0 ? SFX.tickUp : SFX.tickDown)();
    if (n > max) return toast(max < 99 ? `Only ${max} in stock.` : 'Max 99 per item.');
    cart[id] = n; saveCart(); cartDialog();
  },
  'attn-go': (_, d) => {
    adminTab = d.tab;
    if (d.st) { ordStatus = d.st; ordRange = 'all'; ordDay = ''; ordSearch = ''; }
    renderAdmin(); window.scrollTo(0, 0);
  },
  checkout: async () => {
    if (!user) { authDialog(); return toast('Log in to place your order.'); }
    const items = cartLines().map((l) => (l.key[0] === 'c' ? { combo_id: l.key.slice(1), quantity: l.q } : { product_id: l.key, quantity: l.q }));
    const fx = orderProgress(); // a ring fills while the order is sent, turns into a check, then glows
    let o;
    try { [o] = await Promise.all([api('/api/orders', { method: 'POST', json: { items, promo: promo ? promo.code : '', note: cartNote } }), new Promise((r) => setTimeout(r, 900))]); }
    catch (e) { fx.fail(); throw e; }
    cart = {}; promo = null; cartNote = ''; usualIds = null; saveCart(); $('#dlg').close(); toast(`Order #${o.id} placed.`); burst(); fx.done(o.id); view = 'orders'; render();
  },
  toggle: async (id) => { await api(`/api/products/${id}/sold-out`, { method: 'PATCH' }); await loadProducts(); },
  delete: async (id) => { if (confirm('Delete this product?')) { await api(`/api/products/${id}`, { method: 'DELETE' }); await loadProducts(); toast('Deleted.'); } },
  edit: (id) => {
    const p = products.find((x) => x.id == id), f = $('#pform');
    f.dataset.id = id; f.title.value = p.title; f.price.value = p.price; f.description.value = p.description; f.category.value = p.category || 'snacks'; f.discount_percent.value = p.discount_percent || 0; f.bulk_min.value = p.bulk_min ?? ''; f.bulk_percent.value = p.bulk_percent || 0; f.stock.value = p.stock ?? ''; f.cost.value = costMap[id] ?? ''; if (f.owner_id) f.owner_id.value = p.owner_id || user.id;
    $('#form-title').textContent = 'Edit product'; $('#save').textContent = 'Save changes';
    smoothTo(f);
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
      const fd0 = Object.fromEntries(new FormData(e.target));
      const d = await api(`/api/auth/${mode}`, { method: 'POST', json: { ...fd0, device_id: deviceId() } });
      setSession(d.token, d.user);
      if (d.must_change) { changePwDialog(); render(); return; }
      rememberLogin(d.user.username, fd0.password);
      $('#dlg').close(); render(); toast(`Welcome, ${d.user.username}.`);
    } else if (e.target.dataset.form === 'qty') {
      const key = e.target.dataset.key, max = Number($('#qtyin').max) || 99;
      const q = Math.max(1, Math.min(max, parseInt(new FormData(e.target).get('qty')) || 1));
      cart[key] = Math.min(99, (cart[key] || 0) + q); saveCart(); $('#dlg').close(); flyToCart(key); toast(`Added ${q} to cart.`);
    } else if (e.target.dataset.form === 'changepw') {
      const fdp = Object.fromEntries(new FormData(e.target));
      const d = await api('/api/auth/change-password', { method: 'POST', json: fdp });
      setSession(d.token, d.user); rememberLogin(d.user.username, fdp.new_password); forcePw = false; $('#dlg').close(); render(); toast('Password changed.');
    } else if (e.target.dataset.form === 'guestorder') {
      const fd = Object.fromEntries(new FormData(e.target));
      const items = Object.keys(fd).filter((k) => k.startsWith('q_') && parseInt(fd[k]) > 0).map((k) => ({ product_id: +k.slice(2), quantity: parseInt(fd[k]) }));
      if (!items.length) throw new Error('Set a quantity for at least one item.');
      const o = await api('/api/staff/orders', { method: 'POST', json: { customer_name: fd.customer_name, contact: fd.contact, note: fd.note, items } });
      $('#dlg').close(); await Promise.all([refreshOrders(), loadProductsQuiet()]); toast(`Order #${o.id} placed for ${fd.customer_name}.`);
    } else if (e.target.dataset.form === 'split') {
      const d = await api(`/api/admin/sellers/${e.target.dataset.id}/split-off`, { method: 'POST', json: Object.fromEntries(new FormData(e.target)) });
      $('#dlg').close(); await refreshSellers(); await loadProducts();
      toast(`Done. ${d.products} product${d.products === 1 ? '' : 's'} removed${d.switched_off ? `, ${d.switched_off} combo${d.switched_off === 1 ? '' : 's'} switched off` : ''}.`);
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
    } else if (e.target.id === 'popup-form') {
      const pf = Object.fromEntries(new FormData(e.target)); pf.from = pf.from ? new Date(pf.from).toISOString() : ''; pf.to = pf.to ? new Date(pf.to).toISOString() : '';
      popupAdmin.push({ ...pf, on: true });
      await savePopups(); e.target.reset(); toast('Pop-up added.');
    } else if (e.target.id === 'flash-form') {
      const ff = Object.fromEntries(new FormData(e.target));
      await api(`/api/products/${e.target.dataset.id}/flash`, { method: 'PATCH', json: { percent: ff.percent, minutes: ff.minutes } });
      $('#dlg').close(); await loadProducts(); toast('Flash sale started.');
    } else if (e.target.id === 'settings-form') {
      await api('/api/admin/settings', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
      await loadProductsQuiet(); toast('Saved.');
    } else if (e.target.id === 'pform') {
      const id = e.target.dataset.id;
      const fd = new FormData(e.target);
      if (!fd.get('image').size) fd.delete('image');
      const saved = await api(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: fd });
      await loadProducts(); refreshCosts().catch(() => {});
      if (id) { if (saved && saved.repriced_orders) await refreshOrders().catch(() => {}); toast('Changes saved. ' + repriceMsg(saved)); }
      else toast('Product added.');
    }
  } catch (err) { toast(err.message); }
});

// Close the dialog when clicking the dimmed backdrop
$('#dlg').addEventListener('click', (e) => { if (e.target === $('#dlg') && !forcePw) $('#dlg').close(); });
$('#dlg').addEventListener('cancel', (e) => { if (forcePw) e.preventDefault(); });
$('#dlg').addEventListener('close', () => { delete $('#dlg').dataset.kind; }); // Esc cannot skip the forced password change

let searchTimer = 0;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'osearch') return;
  const was = finishedWanted(); ordSearch = e.target.value; drawOrders();
  if (finishedWanted() !== was) { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshOrders().catch(() => {}), 350); } // load older orders only when searching needs them
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'onlymine') {
    try { localStorage.onlyMine = e.target.checked ? '1' : ''; } catch (err) { /* ignore */ }
    toast(e.target.checked ? 'Receipts and packing lists will show only your items.' : 'Receipts and packing lists will show every seller\'s items.');
    return;
  }
  if (e.target.id === 'orange') { ordRange = e.target.value; ordDay = ''; paintOrderFilters(); drawOrders(); return; }
  if (e.target.id === 'oday') { const was = finishedWanted(); ordDay = e.target.value; drawOrders(); if (finishedWanted() !== was) refreshOrders().catch(() => {}); return; }
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

/* ---------- Live updates ---------- */
// Every 5 seconds the phone asks /api/rev, a tiny answer that changes only when something in the shop was changed.
// The real lists (products, combos, orders...) are downloaded only when it moved, so quiet moments cost almost no data.
// A full check still happens at least once a minute as a safety net, and whenever /api/rev can't be reached.
let lastFull = 0, revFail = false;
async function poll() {
  if (document.hidden || dragBusy) return;
  try {
    let key = null;
    revFail = true; try { const r = await fetch('/api/rev' + (revSig ? '?wait=1&since=' + encodeURIComponent(revSig) : '')); if (r.ok) { const d = await r.json(); key = d.r + '|' + d.w; revFail = false; } } catch (e) { /* fall back to a full check */ }
    if (key && key === revSig && Date.now() - lastFull < 60000) return;
    lastFull = Date.now();
    const [fresh, freshCombos, freshSettings] = await Promise.all([api('/api/products'), api('/api/combos'), api('/api/settings')]);
    const now = JSON.stringify([fresh, freshCombos, freshSettings]);
    if (now !== sig) {
      sig = now; products = vis(fresh); combos = vis(freshCombos); settings = freshSettings;
      if (view === 'shop') { fillBanner(); fillGrid(); } else if (view === 'admin') { fillProducts(); refreshAttention().catch(() => {}); }
    }
    if (isAdmin()) { await refreshOrders(); await refreshCustom(); }
    if (user && !isAdmin()) {
      if (view === 'orders') await fillMine(); else await loadMine();
      if (view === 'custom') await fillCustomMine(); else await loadCustomMine();
    }
    if (key) revSig = key;
  } catch (e) { /* ignore network hiccups */ }
}
loadFavs();
// Long-poll loop: /api/rev answers the moment something changes (or after 15 s), so updates feel instant and quiet shops cost almost nothing.
(async function liveLoop() { for (;;) { const t = Date.now(); try { await poll(); } catch (e) { /* ignore */ } const spent = Date.now() - t; await new Promise((ok) => setTimeout(ok, !navigator.onLine || revFail ? 5000 : document.hidden || dragBusy ? 2500 : spent < 1200 ? 1500 : 300)); } })();
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

/* Android (Chrome): the browser offers to install the shop as an app. We keep that offer and show our own card
   (the same one the iPhone tip uses) plus an "Install app" button in the footer. */
async function installApp() {
  if (!installEvt) return;
  const ev = installEvt; installEvt = null;
  const card = $('#a2hs'); if (card) card.remove();
  try { ev.prompt(); await ev.userChoice; } catch (e) { /* closed without choosing */ }
  renderMobileNav();
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e;
  let snoozed = false;
  try { snoozed = Date.now() - Number(localStorage.installSnooze || 0) < 7 * 864e5; } catch (err) { /* private browsing */ }
  if (!snoozed && !$('#a2hs')) document.body.insertAdjacentHTML('beforeend', `<div id="a2hs" class="glass">
    <b>Install the shop as an app</b>
    <p>Put it on your home screen. It opens full screen, like a real app.</p>
    <button class="primary" id="a2hs-install" type="button">Install</button> <button id="a2hs-later" type="button">Not now</button></div>`);
  renderMobileNav();
});
window.addEventListener('appinstalled', () => { installEvt = null; const c = $('#a2hs'); if (c) c.remove(); renderMobileNav(); toast('Installed. Open it from your home screen.'); });
document.addEventListener('click', (e) => {
  if (e.target.id === 'a2hs-install') installApp();
  else if (e.target.id === 'a2hs-later') { try { localStorage.installSnooze = Date.now(); } catch (err) { /* ignore */ } const c = $('#a2hs'); if (c) c.remove(); }
});
// The service worker is what lets Chrome treat the shop as an installable app, and keeps the shell opening if the signal drops.
// app.js now loads after the startup animation, so the page's load event may already have fired.
setInterval(() => { if (view === 'orders' && myOrders.some((o) => o.status === 'pending')) fillMine().catch(() => {}); }, 30000); // keeps the change-order countdown fresh
if ('serviceWorker' in navigator) {
  const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
}
window.addEventListener('bootdone', animateApp); // replay the page entrance once the startup animation lifts

loadProducts().catch((e) => toast(e.message));

// Tap a product tile to read its description (it stays out of the way until then).
document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('.card.t');
  if (c && !e.target.closest('button, a, input, select')) c.classList.toggle('open');
});


/* ---------- Motion: FLIP moves, drag-to-reorder, fly-to-cart, card tilt ---------- */
// Everything below animates transform and opacity only (compositor work, no layout), and stays still for people who ask for less motion.
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const keyOf = (n) => (n.dataset.sid ? 's' + n.dataset.sid : n.dataset.cid ? 'c' + n.dataset.cid : null);

// Redraws a list, then slides every card that was already there from its old place to its new one (FLIP).
// New cards fade in; this is what makes filtering, searching, pinning and live updates glide instead of jump.
function flipRender(el, draw) {
  if (!el) return;
  if (RM) { draw(); return; }
  const first = new Map();
  el.querySelectorAll('[data-sid],[data-cid]').forEach((n) => first.set(keyOf(n), n.getBoundingClientRect()));
  if (first.size) el.classList.add('flip'); // later redraws must not replay the page-load entrance
  draw();
  if (!first.size) return;
  let fresh = 0;
  el.querySelectorAll('[data-sid],[data-cid]').forEach((n) => {
    const f = first.get(keyOf(n)), r = n.getBoundingClientRect();
    if (f) {
      const dx = f.left - r.left, dy = f.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 2) n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
    } else if (r.bottom > 0 && r.top < innerHeight) {
      n.animate([{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE, delay: Math.min(fresh++, 8) * 30, fill: 'backwards' });
    }
  });
}
// Same idea for moving existing elements around inside a list (used while dragging).
function flipMove(els, mutate) {
  const first = els.map((n) => n.getBoundingClientRect());
  els.forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
  mutate();
  if (RM) return;
  els.forEach((n, i) => {
    const r = n.getBoundingClientRect(), dx = first[i].left - r.left, dy = first[i].top - r.top;
    if (Math.abs(dx) + Math.abs(dy) > 1) n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 260, easing: EASE });
  });
}

async function syncProducts() { // fetch the saved list and remember it, so the live refresh sees "nothing changed" and does not redraw
  const fresh = await api('/api/products');
  products = vis(fresh); sig = JSON.stringify([fresh, combos, settings]);
}

// Saves the order after a drop. Pinned products always stay in front of the others within their section.
async function commitOrder(zone, list) {
  try {
    const items = [...list.children].filter((c) => c.dataset.sid);
    const pinned = new Set(products.filter((p) => p.pinned).map((p) => p.id));
    const catIx = (n) => Object.keys(CATS).indexOf(n.dataset.cat);
    const want = [...items].sort((a, b) => (catIx(a) - catIx(b)) || (pinned.has(+a.dataset.sid) ? 0 : 1) - (pinned.has(+b.dataset.sid) ? 0 : 1));
    if (want.some((n, i) => n !== items[i])) flipMove(items, () => want.forEach((n) => list.appendChild(n)));
    await api('/api/products/reorder', { method: 'PATCH', json: { ids: want.map((n) => Number(n.dataset.sid)) } });
    await syncProducts();
  } catch (err) {
    toast(err.message || 'Could not save the order.');
    try { await syncProducts(); } catch (e) { /* ignore */ }
    view === 'shop' ? fillGrid() : fillProducts();
  } finally { dragBusy = false; }
}

// Drag a card (shop, arrange mode) or a row (Admin > Products) by its handle. Touch, mouse and pen all work.
document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-grip]');
  if (!grip || dragBusy || !isRaven() || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const item = grip.closest('[data-sid]');
  if (!item) return;
  e.preventDefault();
  startDrag(item, grip, e);
});
function startDrag(item, grip, e) {
  const list = item.parentElement, zone = item.closest('[data-sortlist]');
  const peers = () => [...list.children].filter((c) => c.dataset.sid && c.dataset.cat === item.dataset.cat); // rows only trade places within their own section
  const r0 = item.getBoundingClientRect(), gx = e.clientX - (r0.left + r0.width / 2), gy = e.clientY - (r0.top + r0.height / 2); // grab point, measured from the card's centre (it is scaled around its centre)
  let px = e.clientX, py = e.clientY, tx = 0, ty = 0, raf = 0, live = true;
  dragBusy = true;
  item.classList.add('dragging'); document.body.classList.add('dragmode');
  try { grip.setPointerCapture(e.pointerId); } catch (_) { /* fine without */ }
  const place = () => {
    const r = item.getBoundingClientRect(), cx = r.left + r.width / 2 - tx, cy = r.top + r.height / 2 - ty; // centre of the card's slot, with no transform
    tx = px - gx - cx; ty = py - gy - cy;
    item.style.transform = `translate(${tx}px,${ty}px) scale(1.04)`;
  };
  const tick = () => {
    if (!live) return;
    const edge = 90;
    if (py < edge) scrollBy({ top: -Math.ceil((edge - py) / 4), behavior: 'instant' });
    else if (py > innerHeight - edge) scrollBy({ top: Math.ceil((py - (innerHeight - edge)) / 4), behavior: 'instant' });
    const others = peers().filter((c) => c !== item);
    const rects = others.map((c) => c.getBoundingClientRect());
    const stacked = rects.every((r) => Math.abs(r.left - rects[0].left) < 2); // one column (Admin list): only the height matters; a grid: the pointer must be over the tile
    const hit = others.find((c, i) => { // the pointer must be well inside a card before they swap, so cards do not flicker back and forth
      const r = rects[i], mx = r.width * .22, my = r.height * .22;
      return (stacked || (px > r.left + mx && px < r.right - mx)) && py > r.top + my && py < r.bottom - my;
    });
    if (hit) {
      const kids = [...list.children];
      flipMove(others, () => list.insertBefore(item, kids.indexOf(hit) > kids.indexOf(item) ? hit.nextSibling : hit));
    }
    place();
    raf = requestAnimationFrame(tick);
  };
  const move = (ev) => { px = ev.clientX; py = ev.clientY; };
  const end = () => {
    if (!live) return;
    live = false; cancelAnimationFrame(raf);
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end); grip.removeEventListener('lostpointercapture', end);
    const from = `translate(${tx}px,${ty}px) scale(1.04)`;
    item.style.transform = ''; item.classList.remove('dragging'); document.body.classList.remove('dragmode');
    if (!RM) item.animate([{ transform: from }, { transform: 'none' }], { duration: 320, easing: EASE });
    commitOrder(zone, list);
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end); grip.addEventListener('lostpointercapture', end);
  place(); raf = requestAnimationFrame(tick);
}
// Keyboard: focus a handle, then arrow keys move the card (same save as dragging).
let kbTimer = 0;
document.addEventListener('keydown', (e) => {
  const grip = e.target.closest && e.target.closest('[data-grip]');
  if (!grip || !/^Arrow/.test(e.key) || !isRaven()) return;
  e.preventDefault();
  const item = grip.closest('[data-sid]'), list = item.parentElement, dir = /Left|Up/.test(e.key) ? -1 : 1;
  const same = [...list.children].filter((c) => c.dataset.sid && c.dataset.cat === item.dataset.cat), t = same[same.indexOf(item) + dir];
  if (!t) return;
  dragBusy = true;
  flipMove([...list.children].filter((c) => c.dataset.sid), () => list.insertBefore(item, dir > 0 ? t.nextSibling : t));
  grip.focus();
  clearTimeout(kbTimer); kbTimer = setTimeout(() => commitOrder(item.closest('[data-sortlist]'), list), 700);
});

// One tap adds one: the product's picture flies into the cart.
function quickAdd(key, title, stock) {
  const have = cart[key] || 0, max = Math.min(99, stock != null ? stock : 99);
  if (have >= max) return toast(stock != null && stock <= 99 ? `You already have all ${stock} in your cart.` : 'Cart limit reached for this item.');
  cart[key] = have + 1; saveCart(); flyToCart(key);
  toast(`${title} added. In your cart: ${have + 1}.`);
}
function flyToCart(key) {
  try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* not supported (iPhone) */ } // tiny tap on phones that allow it
  if (RM) return;
  const id = String(key), card = document.querySelector(id.startsWith('c') ? `.card[data-cid="${id.slice(1)}"]` : `.card[data-sid="${id}"]`);
  if (!card) return;
  requestAnimationFrame(() => { // after the cart bar has appeared, so we aim at where it really is
    const vis = (n) => n && n.getClientRects().length > 0;
    const target = ['#cartbar', '.nav [data-act="cart"]', '#cartq'].map((q) => document.querySelector(q)).find(vis);
    const pic = card.querySelector('.img img'), from = (pic || card.querySelector('.img') || card).getBoundingClientRect();
    if (!target || !from.width) return;
    const t = target.getBoundingClientRect(), size = 56;
    const fx = from.left + from.width / 2, fy = from.top + Math.min(from.height / 2, 140), dx = t.left + t.width / 2 - fx, dy = t.top + t.height / 2 - fy;
    const dot = document.createElement('div');
    dot.className = 'fly';
    dot.style.cssText = `left:${fx - size / 2}px;top:${fy - size / 2}px;width:${size}px;height:${size}px`;
    if (pic && pic.currentSrc) dot.style.backgroundImage = `url("${pic.currentSrc}")`;
    document.body.appendChild(dot);
    const a = dot.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0, easing: 'ease-out' },
      { transform: `translate(${dx * .5}px,${Math.min(dy, 0) * .5 - 80}px) scale(.8)`, opacity: 1, offset: .45, easing: 'ease-in' },
      { transform: `translate(${dx}px,${dy}px) scale(.25)`, opacity: .6, offset: 1 },
    ], { duration: 700, easing: 'linear' });
    a.onfinish = a.oncancel = () => { dot.remove(); target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); };
  });
}

// Soft 3D tilt under a mouse pointer (the existing glow already follows it). Not on touch, not while arranging.
let tiltEl = null, tiltRaf = 0;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || RM || dragBusy) return;
  const c = e.target.closest && e.target.closest('.grid>.card');
  if (tiltEl && tiltEl !== c) { tiltEl.classList.remove('tilting'); tiltEl.style.removeProperty('--rx'); tiltEl.style.removeProperty('--ry'); tiltEl = null; }
  if (!c || c.closest('#grid.arrange')) return;
  tiltEl = c;
  if (tiltRaf) return;
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  tiltRaf = requestAnimationFrame(() => { tiltRaf = 0; c.classList.add('tilting'); c.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg'); c.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg'); });
}, { passive: true });
document.addEventListener('pointerout', (e) => {
  const c = e.target.closest && e.target.closest('.grid>.card');
  if (c && !c.contains(e.relatedTarget)) { c.classList.remove('tilting'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); if (tiltEl === c) tiltEl = null; }
});

/* ===== Dashboard: KPI cards and charts drawn as inline SVG (no libraries) ===== */
const PALETTE = ['#0a84ff', '#bf5af2', '#5e5ce6', '#64d2ff', '#ff7ab6', '#8e93b8'];
const short = (v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : String(Math.round(v)));
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(Math.max(v, 1))); return Math.max(1, Math.ceil((v / p) * 2) / 2 * p); };
function lastDays(n, today) {
  const out = [], d = new Date(today + 'T00:00:00');
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
  return out;
}
function lineChart(labels, series, w = 640, h = 290) {
  const pad = { l: 46, r: 14, t: 14, b: 28 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const top = niceMax(Math.max(1, ...series.flatMap((s) => s.vals))), X = (i) => pad.l + (labels.length > 1 ? (i * iw) / (labels.length - 1) : iw / 2), Y = (v) => pad.t + ih - (v / top) * ih;
  const grid = [0, 1, 2, 3, 4].map((g) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y((top * g) / 4)}" y2="${Y((top * g) / 4)}" class="gl"/><text x="${pad.l - 8}" y="${Y((top * g) / 4) + 4}" class="ax" text-anchor="end">${short((top * g) / 4)}</text>`).join('');
  const xl = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].map((i) => `<text x="${X(i)}" y="${h - 8}" class="ax" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${labels[i].slice(5)}</text>`).join('');
  const paths = series.map((s, k) => {
    const pts = s.vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    const area = k === 0 ? `<path d="${pts}L${X(labels.length - 1)} ${Y(0)}L${X(0)} ${Y(0)}Z" fill="url(#ga${k})" class="area"/>` : '';
    const dots = s.vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="9" fill="transparent"><title>${labels[i]}: ${money(v)} (${s.name})</title></circle>`).join('');
    return `<defs><linearGradient id="ga${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>${area}<path d="${pts}" class="ln" pathLength="1" style="stroke:${s.color};animation-delay:${k * 0.25}s"/>${dots}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">${grid}${xl}${paths}</svg>`;
}
function barChart(labels, vals, w = 640, h = 200) {
  const pad = { l: 34, r: 8, t: 10, b: 26 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, top = niceMax(Math.max(1, ...vals)), bw = iw / vals.length;
  const grid = [0, 2, 4].map((g) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih - (ih * g) / 4}" y2="${pad.t + ih - (ih * g) / 4}" class="gl"/><text x="${pad.l - 6}" y="${pad.t + ih - (ih * g) / 4 + 4}" class="ax" text-anchor="end">${Math.round((top * g) / 4)}</text>`).join('');
  const bars = vals.map((v, i) => `<rect x="${pad.l + i * bw + bw * 0.18}" width="${bw * 0.64}" y="${pad.t + ih - (v / top) * ih}" height="${Math.max(v ? 2 : 0, (v / top) * ih)}" rx="${Math.min(6, bw * 0.3)}" class="bar" style="--i:${i}"><title>${labels[i]}: ${v} order${v === 1 ? '' : 's'}</title></rect>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img"><defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs>${grid}${bars}<text x="${pad.l}" y="${h - 8}" class="ax">${labels[0].slice(5)}</text><text x="${w - pad.r}" y="${h - 8}" class="ax" text-anchor="end">${labels[labels.length - 1].slice(5)}</text></svg>`;
}
const hBars = (rows) => { const mx = Math.max(1, ...rows.map((r) => r.v)); return rows.length ? `<div class="hbars">${rows.map((r, i) => `<div class="hb" style="--i:${i}"><span class="hl">${esc(r.label)}</span><span class="ht"><i style="width:${(r.v / mx) * 100}%;background:${PALETTE[i % PALETTE.length]}"></i></span><b>${money(r.v)}</b></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'; };
function donut(rows) {
  const total = rows.reduce((a, r) => a + r.v, 0); if (!total) return '<p class="muted">Nothing yet.</p>';
  let off = 0; const R = 54, C = 2 * Math.PI * R;
  const arcs = rows.map((r, i) => { const len = (r.v / total) * C, el = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" class="arc" style="--i:${i}"><title>${esc(r.label)}: ${Math.round((r.v / total) * 100)}%</title></circle>`; off += len; return el; }).join('');
  return `<div class="donutbox"><svg viewBox="0 0 140 140" class="donut" role="img"><g transform="rotate(-90 70 70)">${arcs}</g><text x="70" y="72" text-anchor="middle" class="dt">${short(total)}</text><text x="70" y="90" text-anchor="middle" class="ax">sales</text></svg><ul class="legend">${rows.map((r, i) => `<li><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r.label)} <b>${Math.round((r.v / total) * 100)}%</b></li>`).join('')}</ul></div>`;
}
function countUp(el) {
  const to = parseFloat(el.dataset.to), money_ = el.dataset.money === '1', t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 800), v = to * (1 - (1 - k) ** 3); el.textContent = money_ ? money(v) : Math.round(v); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let dashShown = false;
function drawDash() {
  const el = $('#dashbox'); if (!el || !repData) return;
  const days = lastDays(30, repData.today), by = Object.fromEntries(repData.days.map((d) => [d.day, d]));
  const rev = days.map((d) => (by[d] ? by[d].revenue : 0)), prof = days.map((d) => (by[d] ? by[d].profit : 0)), ord = days.map((d) => (by[d] ? by[d].orders : 0));
  const sum = (a) => a.reduce((x, y) => x + y, 0), S = sum(rev), P = sum(prof), O = sum(ord), td = by[repData.today] || { revenue: 0, orders: 0 };
  const items = [...repData.items].sort((a, b) => b.revenue - a.revenue), top5 = items.slice(0, 5).map((i) => ({ label: i.title, v: i.revenue })), rest = sum(items.slice(5).map((i) => i.revenue));
  const kpi = (label, val, isMoney, sub = '') => `<div class="kpi glass"><span>${label}</span><b data-to="${val}" data-money="${isMoney ? 1 : 0}">${isMoney ? money(val) : val}</b><small>${sub}</small></div>`;
  const people = (repData.people || []).filter((x) => x.gross > 0).map((x) => ({ label: x.username, v: x.gross }));
  el.innerHTML = `<div class="kpis">${kpi('Sales, last 30 days', S, true, `${O} completed order${O === 1 ? '' : 's'}`)}${kpi('Profit, last 30 days', P, true, S ? `${Math.round((P / S) * 100)}% margin` : '')}${kpi('Today', td.revenue, true, `${td.orders} completed order${td.orders === 1 ? '' : 's'}`)}${kpi('Average order', O ? S / O : 0, true, 'last 30 days')}</div>
    <div class="dgrid"><section class="panel glass"><h3>Sales and profit</h3><p class="legendline"><i style="background:${PALETTE[0]}"></i>Sales <i style="background:${PALETTE[1]}"></i>Profit</p>${lineChart(days, [{ name: 'Sales', color: PALETTE[0], vals: rev }, { name: 'Profit', color: PALETTE[1], vals: prof }])}</section>
      <section class="panel glass"><h3>Where the sales come from</h3>${donut(rest > 0 ? [...top5, { label: 'Everything else', v: rest }] : top5)}</section>
      <section class="panel glass"><h3>This week vs last week</h3><p class="legendline"><i style="background:${PALETTE[0]}"></i>This week <i style="background:${PALETTE[2] || PALETTE[1]}"></i>Last week</p>${lineChart(days.slice(-7).map((d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })), [{ name: 'This week', color: PALETTE[0], vals: rev.slice(-7) }, { name: 'Last week', color: PALETTE[2] || PALETTE[1], vals: rev.slice(-14, -7) }])}<p class="muted" style="margin:6px 0 0">${(() => { const a1 = sum(rev.slice(-7)), a0 = sum(rev.slice(-14, -7)); return a0 ? `${a1 >= a0 ? 'Up' : 'Down'} ${Math.abs(Math.round(((a1 - a0) / a0) * 100))}% on last week.` : 'No sales last week to compare with yet.'; })()}</p></section>
      <section class="panel glass"><h3>Orders per day</h3>${barChart(days, ord)}</section>
      <section class="panel glass"><h3>Best sellers</h3>${hBars(items.slice(0, 6).map((i) => ({ label: `${i.title} (${i.qty})`, v: i.revenue })))}${isRaven() && people.length ? `<h3 class="sub">Income per seller</h3>${hBars(people)}` : ''}</section></div>
    <p class="muted dnote">Completed orders only. Profit needs a cost price on each product.</p>`;
  el.querySelectorAll('.kpi b').forEach((b) => (dashShown ? 0 : countUp(b)));
  dashShown = true;
}

/* ===== Liquid glass: a sliding blob behind the active dock button, plus a ripple on every press ===== */
function placeLiquid() {
  const nav = document.querySelector('header.nav'); if (!nav) return;
  let b = nav.querySelector('.liquid'); if (!b) { b = document.createElement('span'); b.className = 'liquid'; b.setAttribute('aria-hidden', 'true'); nav.prepend(b); }
  const on = nav.querySelector('button.on:not(.primary)'); if (!on) { b.style.opacity = 0; return; }
  const nr = nav.getBoundingClientRect(), r = on.getBoundingClientRect(), x = r.left - nr.left, y = r.top - nr.top, moved = b.dataset.x !== String(Math.round(x)) || b.dataset.y !== String(Math.round(y));
  b.style.opacity = 1; b.style.width = r.width + 'px'; b.style.height = r.height + 'px'; b.style.transform = `translate(${x}px,${y}px)`;
  if (moved && b.dataset.x !== undefined) { b.classList.remove('squish'); void b.offsetWidth; b.classList.add('squish'); }
  b.dataset.x = Math.round(x); b.dataset.y = Math.round(y);
}
const _renderNav = renderNav; renderNav = function () { _renderNav(); requestAnimationFrame(placeLiquid); };
addEventListener('resize', placeLiquid); addEventListener('load', placeLiquid);
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest && e.target.closest('button'); if (!btn || btn.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2, d = document.createElement('span');
  d.className = 'rip'; d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  btn.appendChild(d); d.addEventListener('animationend', () => d.remove());
});

/* ===== Everything slides in as you scroll to it (only right after you open a screen) ===== */
const rvIO = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('rv-in'); rvIO.unobserve(en.target); } }), { rootMargin: '0px 0px -6% 0px' }) : null;
new MutationObserver(() => {
  const app = $('#app'); if (!rvIO || !app || !app.classList.contains('fx')) return;
  app.querySelectorAll('.panel:not([data-rv]), .stat:not([data-rv]), .kpi:not([data-rv]), .cat-title:not([data-rv]), .req:not([data-rv])').forEach((n, i) => { n.dataset.rv = '1'; n.style.setProperty('--rd', (i % 6) * 55 + 'ms'); rvIO.observe(n); });
  setTimeout(() => app.querySelectorAll('[data-rv]:not(.rv-in)').forEach((n) => n.classList.add('rv-in')), 1500);
}).observe(document.body, { childList: true, subtree: true });

// Search box in Admin > Products.
document.addEventListener('input', (e) => { if (e.target.id === 'psearch') { pSearch = e.target.value; fillProducts(); } });

/* ===== Liquid pills: one glass pill slides (and squishes) between the buttons of a tab bar, even when the screen is redrawn ===== */
const pillMemo = {};
function placePills() {
  document.querySelectorAll('.subtabs, #app > .tabs, #app .cats, #app .chips').forEach((bar) => {
    const key = bar.classList.contains('subtabs') ? 'sub' : bar.classList.contains('cats') ? 'cats' : bar.classList.contains('chips') ? 'chips' : 'tabs';
    const on = bar.querySelector(':scope > button.primary, :scope > button.on'); let pill = bar.querySelector(':scope > .lq');
    if (!on) { if (pill) pill.style.opacity = 0; return; }
    if (!pill) { pill = document.createElement('span'); pill.className = 'lq'; pill.setAttribute('aria-hidden', 'true'); bar.prepend(pill); }
    const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight, r: getComputedStyle(on).borderRadius };
    const put = (p) => { pill.style.width = p.w + 'px'; pill.style.height = p.h + 'px'; pill.style.transform = `translate(${p.x}px,${p.y}px)`; pill.style.borderRadius = p.r; };
    const from = pillMemo[key];
    if (!pill.dataset.on) { pill.style.transition = 'none'; put(from || to); pill.style.opacity = 1; void pill.offsetWidth; pill.style.transition = ''; } // new bar: start where the pill was
    const moved = from && (from.x !== to.x || from.y !== to.y || from.w !== to.w);
    put(to); pill.style.opacity = 1; pill.dataset.on = '1';
    if (moved) { pill.classList.remove('squish'); void pill.offsetWidth; pill.classList.add('squish'); }
    pillMemo[key] = to;
    const sc = bar.scrollWidth > bar.clientWidth + 2 ? bar : (bar.parentElement && bar.parentElement.classList.contains('subrow') && bar.parentElement.scrollWidth > bar.parentElement.clientWidth + 2 ? bar.parentElement : null);
    if (sc && (moved || !from)) sc.scrollTo({ left: Math.max(0, (sc === bar ? 0 : bar.offsetLeft) + on.offsetLeft - (sc.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' });
  });
}
let pillRaf = 0;
const queuePills = () => { cancelAnimationFrame(pillRaf); pillRaf = requestAnimationFrame(placePills); };
new MutationObserver((ms) => { if (!ms.every((m) => m.target.classList && m.target.classList.contains('lq'))) queuePills(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
addEventListener('resize', queuePills); addEventListener('load', queuePills); if (document.fonts && document.fonts.ready) document.fonts.ready.then(queuePills);


/* ---------- Heart tooltip and "recently viewed" tracking ---------- */
let tipEl = null;
const hideTip = () => tipEl && tipEl.classList.remove('on');
function showTip(b) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  tipEl.textContent = token ? 'Saved to your account, so your favorites sync across your devices.' : 'Log in and your favorites will sync across your devices.';
  const r = b.getBoundingClientRect();
  tipEl.style.left = Math.min(innerWidth - 120, Math.max(120, r.left + r.width / 2)) + 'px'; tipEl.style.top = r.top - 10 + 'px';
  tipEl.classList.add('on');
}
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch') return; const b = e.target.closest && e.target.closest('.fav'); b ? showTip(b) : hideTip(); });
document.addEventListener('focusin', (e) => { const b = e.target.closest && e.target.closest('.fav'); b ? showTip(b) : hideTip(); });
document.addEventListener('focusout', hideTip);
document.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('click', (e) => { // tapping a product counts as viewing it
  const c = e.target.closest && e.target.closest('.grid>.card[data-sid]');
  if (c && !arrange && !e.target.closest('[data-grip],.pinbtn')) markRecent(c.dataset.sid);
});

/* ===== While the cart or any popup is open the page behind it cannot move (works on Android and iPhone too) ===== */
let scrollLockY = null;
const lockScroll = () => { if (scrollLockY !== null) return; scrollLockY = window.scrollY; document.body.style.cssText += `;position:fixed;top:${-scrollLockY}px;left:0;right:0;width:100%`; if (window.__lenis) window.__lenis.stop(); };
const unlockScroll = () => {
  if (scrollLockY === null || document.querySelector('dialog[open]')) return;
  const y = scrollLockY; scrollLockY = null;
  const st = document.body.style; st.position = st.top = st.left = st.right = st.width = '';
  window.scrollTo({ top: y, behavior: 'instant' });
  if (window.__lenis) window.__lenis.start();
};
const _showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () { lockScroll(); return _showModal.call(this); };
document.addEventListener('close', (e) => { if (e.target && e.target.tagName === 'DIALOG') unlockScroll(); }, true);

/* ===== Desktop polish: wide screens with a mouse only. Phones and tablets are untouched. ===== */
(() => {
  const desk = matchMedia('(min-width:901px) and (pointer:fine)');
  const on = () => desk.matches && !matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.glass !== 'lite';
  // A glow ring pulses out of every button you press.
  document.addEventListener('pointerdown', (e) => {
    if (!on()) return;
    const b = e.target.closest && e.target.closest('button:not(:disabled)');
    if (!b || !b.animate) return;
    b.animate([
      { outline: '2px solid rgba(10,132,255,.9)', outlineOffset: '0px' },
      { outline: '2px solid rgba(125,107,255,0)', outlineOffset: '14px' }
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, { passive: true });
  // The header gets a deeper shadow once the page has scrolled.
  addEventListener('scroll', () => { document.documentElement.classList.toggle('scrolled', scrollY > 12); }, { passive: true });
  // Dashboard numbers count up. Only when the value is new or changed, so a quiet refresh never replays it.
  const seen = {};
  const countUps = () => {
    if (!on()) return;
    const g = window.gsap;
    if (!g) { loadGsap().then((x) => { if (x) countUps(); }); return; }
    document.querySelectorAll('#app .kpi').forEach((k) => {
      const lab = k.querySelector('span'), b = k.querySelector('b');
      if (!lab || !b || b.dataset.cu) return;
      b.dataset.cu = '1';
      const txt = b.textContent.trim(), m = txt.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/);
      if (!m) return;
      const to = parseFloat(m[2].replace(/,/g, '')), key = lab.textContent, from = key in seen ? seen[key] : 0;
      seen[key] = to;
      if (from === to) return;
      const dec = (m[2].split('.')[1] || '').length, grp = m[2].includes(','), o = { v: from };
      g.to(o, { v: to, duration: .9, ease: 'power2.out',
        onUpdate: () => { b.textContent = m[1] + o.v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grp }) + m[3]; },
        onComplete: () => { b.textContent = txt; } });
    });
  };
  const app = document.getElementById('app');
  let tm = 0;
  if (app) new MutationObserver(() => { clearTimeout(tm); tm = setTimeout(countUps, 80); }).observe(app, { childList: true, subtree: true });
})();

/* ===== Order placed: a full-screen check, confetti, a chime and a buzz on phones ===== */
function orderCelebrate(id) {
  SFX.order();
  try { navigator.vibrate && navigator.vibrate([25, 50, 25, 50, 60]); } catch (e) {}
  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches, cols = ['#0a84ff', '#bf5af2', '#ffd60a', '#30d158', '#ff375f', '#64d2ff'];
  const bits = rm ? '' : Array.from({ length: 26 }, (_, i) => `<i style="--a:${Math.round((i * 360) / 26)}deg;--d:${110 + Math.round(Math.random() * 110)}px;--r:${Math.round(Math.random() * 360)}deg;--c:${cols[i % 6]}"></i>`).join('');
  const o = document.createElement('div'); o.id = 'ordfx'; o.setAttribute('role', 'status');
  o.innerHTML = `<div class="ordfx-card"><div class="ordfx-burst">${bits}</div><svg viewBox="0 0 52 52" class="ordfx-check" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l8 8 14-16"/></svg><h3>Order placed!</h3><p>Order #${Number(id)} is on its way to the seller.</p></div>`;
  document.body.appendChild(o);
  const done = () => { o.classList.add('out'); setTimeout(() => o.remove(), 400); };
  o.addEventListener('click', done); setTimeout(done, 2600);
}

/* ===== Button sounds and the sound switch (works on phones too) ===== */
(() => {
  const btn = document.getElementById('sfx-btn');
  const ON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>', OFF = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>';
  const paint = () => { if (!btn) return; btn.innerHTML = SFX.muted ? OFF : ON; btn.title = SFX.muted ? 'Sounds are off' : 'Sounds are on'; btn.setAttribute('aria-pressed', String(!SFX.muted)); };
  paint();
  if (btn) btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const old = $('#sfxpanel'); if (old) { old.remove(); return; }
    const r = btn.getBoundingClientRect(), pn = document.createElement('div'); pn.id = 'sfxpanel'; pn.className = 'glass';
    pn.style.top = Math.min(r.bottom + 10, Math.max(8, innerHeight - 120)) + 'px'; pn.style.maxHeight = 'calc(100dvh - ' + (Math.min(r.bottom + 10, Math.max(8, innerHeight - 120)) + 12) + 'px)';
    pn.innerHTML = `<label class="sp-row"><span>Sounds</span><input type="checkbox" id="sfx-on" ${SFX.muted ? '' : 'checked'}></label><label class="sp-row"><span>Volume</span><input type="range" id="sfx-vol" min="0" max="150" value="${Math.round(SFX.vol * 100)}"></label><label class="sp-row"><span>Vibration</span><input type="checkbox" id="hap-on" ${HAPTICS() ? 'checked' : ''}></label>
      <div class="sp-row"><span>Colour</span><span class="sws">${ACCENTS.map((c, i) => `<button type="button" class="sw${Number(LS('accent', 0)) === i ? ' on' : ''}" data-i="${i}" aria-label="${c[0]} colours" style="background:linear-gradient(135deg,${c[1] || '#0a84ff'},${c[2] || '#bf5af2'})"></button>`).join('')}</span></div>
      <div class="sp-row"><span>Text size</span><span class="fzs"><button type="button" data-fz="-10" aria-label="Smaller text">A-</button><b id="fz-val">${Number(LS('fz', 100))}%</b><button type="button" data-fz="10" aria-label="Larger text">A+</button></span></div>
      <label class="sp-row"><span>Data saver</span><input type="checkbox" id="saver-on" ${SAVER() ? 'checked' : ''}></label>`;
    document.body.appendChild(pn);
    pn.addEventListener('click', (e2) => e2.stopPropagation());
    $('#sfx-on').onchange = (e2) => { if (e2.target.checked === SFX.muted) SFX.toggle(); paint(); };
    $('#sfx-vol').oninput = (e2) => { SFX.vol = Number(e2.target.value) / 100; };
    $('#sfx-vol').onchange = () => SFX.tickUp();
    $('#hap-on').onchange = (e2) => { try { localStorage.haptics = e2.target.checked ? 'on' : 'off'; } catch (er) {} if (e2.target.checked) try { navigator.vibrate && navigator.vibrate(15); } catch (er) {} };
    pn.querySelectorAll('.sw').forEach((b) => { b.onclick = () => { try { localStorage.accent = b.dataset.i; } catch (er) {} applyAccent(Number(b.dataset.i)); pn.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === b)); }; });
    pn.querySelectorAll('[data-fz]').forEach((b) => { b.onclick = () => { const nx = Math.max(90, Math.min(130, Number(LS('fz', 100)) + Number(b.dataset.fz))); try { localStorage.fz = String(nx); } catch (er) {} document.documentElement.style.fontSize = nx === 100 ? '' : nx + '%'; $('#fz-val').textContent = nx + '%'; }; });
    $('#saver-on').onchange = (e2) => {
      try { localStorage.saver = e2.target.checked ? 'on' : 'off'; if (e2.target.checked) { localStorage.glass = 'lite'; document.documentElement.dataset.glass = 'lite'; } else { localStorage.removeItem('glass'); delete document.documentElement.dataset.glass; } } catch (er) {}
      toast(e2.target.checked ? 'Data saver on. Pictures are smaller.' : 'Data saver off.'); try { render(); } catch (er) {}
    };
    setTimeout(() => document.addEventListener('click', function off() { const q = $('#sfxpanel'); if (q) q.remove(); document.removeEventListener('click', off); }), 0);
  });
  // A click starts audio on phones (they only allow sound after a tap); the capture phase means it runs for every button.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b || b.disabled || b.id === 'sfx-btn') return;
    (b.matches('.add,[data-act="add"]') ? SFX.add : SFX.click)();
  }, true);
})();

/* ===== v20: soft hover ticks on buttons and cards (mouse only, throttled) ===== */
(() => {
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  let last = 0;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('button:not(:disabled), .card');
    if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
    const now = performance.now(); if (now - last < 90) return; last = now; SFX.hover();
  }, true);
})();

/* ===== v22: order progress ring -> check -> glow ===== */
function orderProgress() {
  SFX.charge();
  const o = document.createElement('div'); o.id = 'ordfx'; o.className = 'prog'; o.setAttribute('role', 'status');
  o.innerHTML = '<div class="ordfx-card"><div class="ordfx-burst"></div><svg viewBox="0 0 52 52" class="ordfx-ring" aria-hidden="true"><circle class="rt" cx="26" cy="26" r="23"/><circle class="rp" cx="26" cy="26" r="23"/><path d="M15 27l8 8 14-16"/></svg><h3>Placing your order</h3><p>Hold on a moment.</p></div>';
  o.setAttribute('popover', 'manual'); // top layer, so it sits above the open cart
  document.body.appendChild(o);
  try { o.showPopover(); } catch (e) {}
  const rp = o.querySelector('.rp'), h3 = o.querySelector('h3'), p = o.querySelector('p');
  const dismiss = () => { if (!o.isConnected) return; o.classList.add('out'); setTimeout(() => o.remove(), 400); };
  return {
    fail: dismiss,
    done(id) {
      const cur = getComputedStyle(rp).strokeDashoffset; // finish the ring from wherever it is
      rp.style.animation = 'none'; rp.style.strokeDashoffset = cur; void rp.getBoundingClientRect();
      rp.style.transition = 'stroke-dashoffset .5s cubic-bezier(.3,.7,.2,1)'; rp.style.strokeDashoffset = '0';
      setTimeout(() => {
        o.classList.add('done'); h3.textContent = 'Order placed!'; p.textContent = `Order #${Number(id)} is on its way to the seller.`;
        const cols = ['#30d158', '#0a84ff', '#bf5af2', '#ffd60a', '#64d2ff'];
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) o.querySelector('.ordfx-burst').innerHTML = Array.from({ length: 22 }, (_, i) => `<i style="--a:${Math.round((i * 360) / 22)}deg;--d:${90 + Math.round(Math.random() * 90)}px;--r:${Math.round(Math.random() * 360)}deg;--c:${cols[i % 5]}"></i>`).join('');
        SFX.order(); try { navigator.vibrate && navigator.vibrate([25, 50, 25, 50, 60]); } catch (e) {}
        o.addEventListener('click', dismiss); setTimeout(dismiss, 2800);
      }, 520);
    }
  };
}

/* ===== v22: rewarding presses on important buttons (ripple, pop, glow ring, sparks, sound) ===== */
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button.primary');
  if (!b || b.disabled || b.closest('.tabs,.subtabs,.chips,.cats,.nav,.tour')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = b.getBoundingClientRect(), x = e.clientX || r.left + r.width / 2, y = e.clientY || r.top + r.height / 2;
  const pos = getComputedStyle(b).position; if (pos === 'static') b.style.position = 'relative';
  const rip = document.createElement('span'); rip.className = 'rip'; rip.style.left = (x - r.left) + 'px'; rip.style.top = (y - r.top) + 'px'; b.appendChild(rip);
  b.classList.remove('reward'); void b.offsetWidth; b.classList.add('reward');
  const fx = document.createElement('div'); fx.className = 'pfx'; fx.style.left = (r.left + r.width / 2) + 'px'; fx.style.top = (r.top + r.height / 2) + 'px';
  fx.innerHTML = Array.from({ length: 8 }, (_, i) => `<i style="--a:${i * 45 + Math.round(Math.random() * 20)}deg;--d:${Math.min(60, 26 + r.width / 4)}px"></i>`).join('');
  document.body.appendChild(fx);
  if (!b.matches('.add,[data-act="add"],[data-act="checkout"]')) SFX.press();
  try { navigator.vibrate && navigator.vibrate(12); } catch (er) {}
  setTimeout(() => { rip.remove(); fx.remove(); b.classList.remove('reward'); if (pos === 'static') b.style.position = ''; }, 700);
}, true);

/* ===== v22: leaving animations: popups/cart animate out, cart rows slide away ===== */
(() => {
  const realClose = HTMLDialogElement.prototype.close, realShow = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.close = function (rv) {
    const d = this;
    if (!d.open || d.classList.contains('closing') || matchMedia('(prefers-reduced-motion: reduce)').matches) return realClose.call(d, rv);
    d.classList.add('closing'); d.__cancelClose = false;
    const fin = () => { d.classList.remove('closing'); if (d.__cancelClose) { d.__cancelClose = false; return; } realClose.call(d, rv); };
    d.addEventListener('animationend', function h(ev) { if (ev.target === d) { d.removeEventListener('animationend', h); fin(); } });
    setTimeout(() => { if (d.classList.contains('closing')) fin(); }, 450);
  };
  // opening again while it is still leaving cancels the leave, so new content is never closed by an old animation
  HTMLDialogElement.prototype.showModal = function () {
    if (this.classList.contains('closing')) { this.__cancelClose = true; this.classList.remove('closing'); }
    if (this.open) return;
    return realShow.call(this);
  };
  document.addEventListener('cancel', (e) => { if (e.target instanceof HTMLDialogElement && e.target.open) { e.preventDefault(); e.target.close(); } }, true); // Esc
})();

/* ===== v23: random pop-ups the main admin adds (Admin > Catalog > Pop-ups) ===== */
let popupAdmin = [];
async function refreshPopups() {
  popupAdmin = await api('/api/admin/popups');
  const box = $('#popuplist'); if (!box) return;
  box.innerHTML = popupAdmin.length ? popupAdmin.map((p) => `<div class="req"><div class="between"><b>${esc(p.title)}</b><span class="muted">${p.on ? 'On' : 'Off'}</span></div>
    <p style="margin:4px 0 8px">${esc(p.text)}${p.btn ? `<br><span class="muted">Button: ${esc(p.btn)}${p.url ? ' to ' + esc(p.url) : ''}</span>` : ''}${p.from || p.to ? `<br><span class="muted">${p.from ? 'From ' + esc(new Date(p.from).toLocaleString()) : ''}${p.to ? ' until ' + esc(new Date(p.to).toLocaleString()) : ''}</span>` : ''}</p>
    <div class="actions"><button data-act="popup-prev" data-id="${esc(p.id)}">Preview</button><button data-act="popup-on" data-id="${esc(p.id)}">${p.on ? 'Turn off' : 'Turn on'}</button><button data-act="popup-del" data-id="${esc(p.id)}">Delete</button></div></div>`).join('') : '<p>No pop-ups yet. Add one above.</p>';
}
async function savePopups() { popupAdmin = await api('/api/admin/popups', { method: 'PUT', json: { popups: popupAdmin } }); await refreshPopups(); loadProductsQuiet().catch(() => {}); }

let popupTimer = null;
const popupLive = (p) => (!p.from || Date.now() >= Date.parse(p.from)) && (!p.to || Date.now() <= Date.parse(p.to));
const popupHidden = () => { try { return JSON.parse(localStorage.popupHide || '[]'); } catch (e) { return []; } };
function showPopup(p) {
  const old = document.querySelector('.site-pop'); if (old) old.remove();
  const el = document.createElement('div'); el.className = 'site-pop glass'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', p.title);
  const link = p.btn && p.url ? `<a class="sp-go primary" href="${esc(p.url)}" ${/^https?:/.test(p.url) ? 'target="_blank" rel="noopener"' : ''}>${esc(p.btn)}</a>` : '';
  el.innerHTML = `<button type="button" class="sp-x" aria-label="Close">&times;</button><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p><div class="sp-act">${link}<button type="button" class="sp-no">Don't show again</button></div>`;
  document.body.appendChild(el);
  SFX.pop();
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  el.querySelector('.sp-x').onclick = close;
  el.querySelector('.sp-no').onclick = () => { try { localStorage.popupHide = JSON.stringify([...popupHidden(), p.id]); } catch (e) {} close(); };
  if (link) el.querySelector('.sp-go').onclick = close;
  setTimeout(() => { if (el.isConnected && !el.matches(':hover')) close(); }, 15000);
}
function popupSchedule() {
  const list = (settings.popups || []).filter((p) => p.on !== false && popupLive(p));
  if (!list.length || popupTimer) return;
  try { if (Date.now() - Number(localStorage.popupAt || 0) < 600000) return; } catch (e) {}
  popupTimer = setTimeout(function tryShow() {
    if (document.getElementById('gw') || document.querySelector('dialog[open], .site-pop') || view === 'admin') return (popupTimer = setTimeout(tryShow, 3000));
    popupTimer = null;
    let seen = []; try { seen = JSON.parse(sessionStorage.popupSeen || '[]'); } catch (e) {}
    const hide = popupHidden(), pool = (settings.popups || []).filter((p) => p.on !== false && popupLive(p) && !hide.includes(p.id) && !seen.includes(p.id));
    if (!pool.length) return;
    const p = pool[Math.floor(Math.random() * pool.length)];
    try { sessionStorage.popupSeen = JSON.stringify([...seen, p.id]); localStorage.popupAt = String(Date.now()); } catch (e) {}
    showPopup(p);
  }, 4000 + Math.random() * 8000);
}
window.addEventListener('bootdone', popupSchedule);
setTimeout(popupSchedule, 1500);

/* ===== v25: your usual, share links, flash sales, prep list, stock alerts, offline banner ===== */
async function fillUsual() {
  const el = $('#usual'); if (!el || !user || isAdmin()) return;
  try {
    if (!usualIds || usualUser !== user.id) {
      const os = await loadMine(), n = {};
      os.filter((o) => o.status !== 'cancelled').forEach((o) => (o.items || []).forEach((i) => { if (i.product_id) n[i.product_id] = (n[i.product_id] || 0) + i.quantity; }));
      usualIds = Object.entries(n).sort((x, y) => y[1] - x[1]).slice(0, 4).map((x) => Number(x[0])); usualUser = user.id;
    }
  } catch (e) { return; }
  const list = usualIds.map((id) => products.find((x) => x.id == id)).filter((x) => x && !x.is_sold_out);
  const box = $('#usual'); if (!box || !list.length) return;
  box.innerHTML = `<h2 class="cat-title">Your usual</h2><div class="rv">${list.map((x) => `<article class="rv-card">${x.image_url ? `<img loading="lazy" decoding="async" src="${esc(thumb(x.image_url, 240))}" alt="">` : '<div class="ph"></div>'}<div class="rv-b"><b>${esc(x.title)}</b><span>${money(fin(x))}</span></div><button type="button" class="primary add" data-act="add" data-id="${x.id}" aria-label="Add ${esc(x.title)} to cart">+</button></article>`).join('')}</div>`;
}

function shareBtn(id) { return `<button type="button" class="share" data-act="share" data-id="${id}" aria-label="Share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M5 12v7h14v-7"/></svg></button>`; }
function openDeepLink() {
  if (deepDone) return; const id = new URLSearchParams(location.search).get('p'); if (!id) return; deepDone = true;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (view === 'shop') { searchText = ''; catFilter = 'all'; try { fillGrid(); } catch (e) {} }
  setTimeout(() => {
    const el = document.querySelector(`.card[data-sid="${String(id).replace(/[^0-9]/g, '')}"]`);
    if (!el) return toast('That item is not available right now.');
    if (window.smoothTo) window.smoothTo(el, { block: 'center' }); else el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('deep-hi'); setTimeout(() => el.classList.remove('deep-hi'), 4500);
  }, 500);
}
window.addEventListener('bootdone', () => setTimeout(openDeepLink, 700));
setTimeout(() => { if (!document.getElementById('gw')) openDeepLink(); }, 2500);

function flashLeft(pr) {
  const t = pr.discount_until ? Date.parse(pr.discount_until) - Date.now() : 0; if (t <= 0) return '';
  const s = Math.floor(t / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
function flashBadge(pr) { const l = Number(pr.discount_percent) > 0 && pr.discount_until ? flashLeft(pr) : ''; return l ? `<span class="flash-badge" data-until="${esc(pr.discount_until)}"><b>Flash -${pr.discount_percent}%</b> <i>${l}</i></span>` : ''; }
setInterval(() => {
  document.querySelectorAll('.flash-badge').forEach((el) => {
    const l = flashLeft({ discount_until: el.dataset.until });
    if (l) { const i = el.querySelector('i'); if (i) i.textContent = l; return; }
    el.remove();
    if (!flashBusy) { flashBusy = true; loadProductsQuiet().then(() => { if (view === 'shop') fillGrid(); }).catch(() => {}).finally(() => setTimeout(() => { flashBusy = false; }, 5000)); }
  });
}, 1000);
function flashDialog(id) {
  const pr = products.find((x) => x.id == id); if (!pr) return;
  const on = pr.discount_until && Number(pr.discount_percent) > 0, dlg = $('#dlg');
  delete dlg.dataset.kind;
  dlg.innerHTML = `<h2>Flash sale: ${esc(pr.title)}</h2><p class="muted">A timed discount. When the time is up, the price goes back to normal by itself.</p>
    <form id="flash-form" data-id="${pr.id}"><label>Discount (%)</label><input name="percent" type="number" min="1" max="90" value="${on ? pr.discount_percent : 20}" required>
    <label>Lasts</label><select name="minutes">${[[30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day'], [4320, '3 days']].map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select>
    <button class="primary">${on ? 'Restart the sale' : 'Start flash sale'}</button>${on ? `<button type="button" data-act="flash-end" data-id="${pr.id}">End it now</button>` : ''}<button type="button" data-act="close">Cancel</button></form>`;
  dlg.showModal();
}

function drawPrep() {
  const el = $('#prepbox'); if (!el) return;
  const open = (ordersCache || []).filter((o) => ['pending', 'packed'].includes(statusOf(o)));
  if (!open.length) { el.innerHTML = '<section class="panel glass"><h2>Prep list</h2><p class="muted">No open orders to prepare right now.</p></section>'; return; }
  const groups = { all: open };
  el.innerHTML = '<section class="panel glass"><h2>Prep list</h2><p class="muted">What to pack for all open orders.</p></section>' + ['all'].map((k) => {
    const tot = {};
    groups[k].forEach((o) => (o.items || []).forEach((i) => { const key = i.title + (isRaven() && i.owner_id && ownerName(i.owner_id) ? ` (${ownerName(i.owner_id)})` : ''); tot[key] = (tot[key] || 0) + i.quantity; }));
    return `<section class="panel glass"><div class="between"><h3>Open orders</h3><span class="muted">${groups[k].length} order${groups[k].length === 1 ? '' : 's'}</span></div><ul class="lines">${Object.entries(tot).sort((x, y) => y[1] - x[1]).map(([t, q]) => `<li><span>${esc(t)}</span><b>${q}</b></li>`).join('')}</ul><p class="muted" style="margin:6px 0 0">${groups[k].map((o) => '#' + o.id + ' ' + esc(o.username)).join(', ')}</p></section>`;
  }).join('');
}

function stockWatch() {
  if (!user || !isAdmin()) { stockSeen = null; return; }
  const cur = {}; products.forEach((x) => { if (x.stock != null && (isRaven() || x.owner_id === user.id)) cur[x.id] = x.stock; });
  if (stockSeen) for (const [id, n] of Object.entries(cur)) {
    const prev = stockSeen[id];
    if (prev !== undefined && n < prev && n <= LOW_STOCK) { const x = products.find((q) => q.id == id); toast(n === 0 ? `Sold out: ${x.title}` : `Low stock: ${x.title} (${n} left)`); SFX.ding(); }
  }
  stockSeen = cur;
}
setInterval(stockWatch, 15000);

(() => {
  const bar = document.createElement('div'); bar.id = 'offline'; bar.className = 'glass'; bar.setAttribute('role', 'status'); bar.hidden = true;
  bar.textContent = 'You are offline. Reconnecting...'; document.body.appendChild(bar);
  const set = (off) => { bar.hidden = !off; if (!off) { toast('Back online.'); loadProductsQuiet().catch(() => {}); } };
  addEventListener('offline', () => set(true)); addEventListener('online', () => set(false)); if (!navigator.onLine) bar.hidden = false;
})();

/* ===== v26: sort and filter, surprise me, quick view, shortcuts, back to top, order countdown, quick stock ===== */
function sortBarHtml() {
  return `<div class="sortbar"><label class="sb-f"><span>Sort</span><select id="sortsel">${[['featured', 'Featured'], ['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low']].map(([v, l]) => `<option value="${v}" ${sortMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="sb-c"><input type="checkbox" id="instock" ${inStockOnly ? 'checked' : ''}> In stock only</label><button type="button" class="sb-s" data-act="surprise">Surprise me</button><span id="cutoffpill" class="pill" hidden></span></div>`;
}
function sortList(list) {
  if (sortMode === 'featured' || (arrange && isRaven())) return list;
  const l = [...list];
  if (sortMode === 'low') l.sort((x, y) => fin(x) - fin(y)); else if (sortMode === 'high') l.sort((x, y) => fin(y) - fin(x));
  else l.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  return l;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'sortsel') { sortMode = e.target.value; SFX.tickUp(); fillGrid(); }
  else if (e.target.id === 'instock') { inStockOnly = e.target.checked; SFX.tickUp(); fillGrid(); }
});
function surprise() {
  const list = products.filter((x) => !x.hidden && !x.is_sold_out);
  if (!list.length) return toast('Nothing in stock right now.');
  SFX.pop(); quickView(list[Math.floor(Math.random() * list.length)].id);
}
function quickView(id) {
  const pr = products.find((x) => x.id == id); if (!pr) return;
  const room = Math.min(99, pr.stock != null ? pr.stock - (cart[pr.id] || 0) : 99 - (cart[pr.id] || 0)), off = Number(pr.discount_percent) > 0, dlg = $('#dlg');
  delete dlg.dataset.kind;
  dlg.innerHTML = `${pr.image_url ? `<img class="qv-img" src="${esc(thumb(pr.image_url, 1000))}" alt="${esc(pr.title)}">` : ''}<div class="between"><h2 style="margin:0">${esc(pr.title)}</h2><span class="qv-price">${off ? `<s class="muted">${money(pr.price)}</s> ` : ''}<b>${money(fin(pr))}</b></span></div>
    ${pr.description ? `<p class="muted">${esc(pr.description)}</p>` : ''}
    ${pr.stock != null && pr.stock <= LOW_STOCK && !pr.is_sold_out ? `<p class="muted">Only ${pr.stock} left.</p>` : ''}
    ${bulkOn(pr) ? `<p class="muted">Buy ${pr.bulk_min}+ and save ${pr.bulk_percent}% on each.</p>` : ''}
    ${pr.is_sold_out ? '<p class="cancel-why">Sold out right now.</p>' : room < 1 ? '<p class="muted">You already have the most you can in your cart.</p>' : `<form data-form="qty" data-key="${pr.id}"><div style="display:flex;justify-content:center;align-items:center;gap:12px;margin:10px 0"><button type="button" data-act="qty-step" data-d="-1">-</button><input name="qty" id="qtyin" type="number" min="1" max="${room}" value="1" inputmode="numeric" style="width:90px;text-align:center;font-size:1.3rem"><button type="button" data-act="qty-step" data-d="1">+</button></div><button class="primary">Add to cart</button></form>`}
    <div class="qv-actions">${user ? `<button type="button" data-act="fav" data-id="${pr.id}">${favs.has(pr.id) ? 'Unfavorite' : 'Favorite'}</button>` : ''}<button type="button" data-act="share" data-id="${pr.id}">Share</button><button type="button" data-act="close">Close</button></div>`;
  dlg.showModal();
}
document.addEventListener('click', (e) => { // tap a product card to see it bigger
  const card = e.target.closest && e.target.closest('.card[data-sid]');
  if (!card || e.target.closest('button,a,input,select,textarea,.arr-ctl') || (arrange && isRaven()) || document.querySelector('dialog[open]')) return;
  quickView(card.dataset.sid);
});
function shortcutsDialog() {
  const dlg = $('#dlg'); delete dlg.dataset.kind;
  dlg.innerHTML = '<h2>Keyboard shortcuts</h2><ul class="lines"><li><span>Search</span><b>/</b></li><li><span>Open the cart</span><b>C</b></li><li><span>Surprise me</span><b>S</b></li><li><span>This list</span><b>?</b></li><li><span>Close a pop-up</span><b>Esc</b></li></ul><button type="button" class="primary" data-act="close">Got it</button>';
  dlg.showModal();
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === '?') { e.preventDefault(); if (!document.querySelector('dialog[open]')) shortcutsDialog(); return; }
  if (document.querySelector('dialog[open]') || !document.querySelector('#app')) return;
  if (e.key === '/') { const s = $('#search'); if (s) { e.preventDefault(); s.focus(); } }
  else if (e.key === 'c' || e.key === 'C') cartDialog();
  else if ((e.key === 's' || e.key === 'S') && view === 'shop') surprise();
});

(() => { // back to top, with a ring that fills as you scroll
  const b = document.createElement('button'); b.id = 'totop'; b.type = 'button'; b.setAttribute('aria-label', 'Back to top');
  b.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" class="tt-bg"/><circle cx="24" cy="24" r="21" class="tt-fg"/></svg><svg viewBox="0 0 24 24" class="tt-arrow" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  document.body.appendChild(b);
  const fg = b.querySelector('.tt-fg'); let raf = 0;
  const upd = () => { raf = 0; const max = document.documentElement.scrollHeight - innerHeight, r = max > 0 ? Math.min(1, scrollY / max) : 0; b.classList.toggle('show', scrollY > 600); fg.style.strokeDashoffset = String(132 * (1 - r)); };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
  b.onclick = () => { if (window.__lenis) window.__lenis.scrollTo(0); else scrollTo({ top: 0, behavior: 'smooth' }); };
})();

function tickCutoff() {
  const el = $('#cutoffpill'); if (!el) return;
  const w = settings.order_window;
  if (!w || !w.cutoff || w.closed || w.label === 'tomorrow') { el.hidden = true; return; }
  const [h, m] = String(w.cutoff).split(':').map(Number), now = new Date(), mins = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
  if (!(mins > 0)) { el.hidden = true; return; }
  el.hidden = false; el.textContent = 'Orders close in ' + (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`); el.classList.toggle('urgent', mins <= 30);
}
setInterval(tickCutoff, 20000);
function stockCtl(pr, mine) {
  return mine && pr.stock != null ? `<span class="stk" data-id="${pr.id}"><button type="button" data-act="stock" data-id="${pr.id}" data-d="-1" aria-label="One less in stock">-</button><b>${pr.stock}</b><button type="button" data-act="stock" data-id="${pr.id}" data-d="1" aria-label="One more in stock">+</button></span>` : '';
}
