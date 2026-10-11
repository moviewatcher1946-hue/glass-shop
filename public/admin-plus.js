// Admin+ : 20 extra admin tools (main admin only) + shop announcement banner for everyone.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var tok = function () { try { return localStorage.getItem('token') || ''; } catch (e) { return ''; } };
  var me = function () { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { return null; } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function api(url, method, body) {
    var h = { Authorization: 'Bearer ' + tok() }; if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Failed'); return d; }); });
  }
  var money = function (n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var table = function (rows, cols) { return rows.length ? '<div class="ap-tbl"><table><tr>' + cols.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(c[1](r)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>' : '<p class="muted">Nothing yet.</p>'; };

  // Site-wide performance modes (set by the admin, applied for every visitor)
  var perf = {}; try { perf = JSON.parse(localStorage.ap_perf || '{}') || {}; } catch (e) {}
  var revCache = { t: 0, txt: null };
  var realFetch = window.fetch;
  window.fetch = function (u) {
    var rev = typeof u === 'string' && u.indexOf('/api/rev') === 0;
    if (rev && perf.slowrefresh && revCache.txt != null && Date.now() - revCache.t < 15000) return Promise.resolve(new Response(revCache.txt, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    var p = realFetch.apply(this, arguments);
    if (rev) p.then(function (r) { if (r.ok) r.clone().text().then(function (t) { revCache = { t: Date.now(), txt: t }; }); }).catch(function () {});
    return p;
  };
  document.addEventListener('pointermove', function (e) { if (perf.nohover) e.stopImmediatePropagation(); }, true);
  function lazyImgs(root) { (root.querySelectorAll ? root.querySelectorAll('img:not([loading])') : []).forEach(function (i) { i.loading = 'lazy'; i.decoding = 'async'; }); }
  var lazyObs = null;
  function applyPerf(p) {
    perf = p || {}; var h = document.documentElement;
    h.classList.toggle('ap-lite', !!perf.lite); h.classList.toggle('ap-nomotion', !!perf.nomotion); h.classList.toggle('ap-noglow', !!perf.noglow); h.classList.toggle('ap-nohover', !!perf.nohover);
    if (perf.lazy && !lazyObs && window.MutationObserver) { lazyImgs(document); lazyObs = new MutationObserver(function (m) { m.forEach(function (x) { x.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.tagName === 'IMG' && !n.loading) { n.loading = 'lazy'; n.decoding = 'async'; } else lazyImgs(n); } }); }); }); lazyObs.observe(document.body, { childList: true, subtree: true }); }
    if (!perf.lazy && lazyObs) { lazyObs.disconnect(); lazyObs = null; }
  }
  applyPerf(perf);

  // Announcement banner + maintenance notice (everyone)
  function banner() {
    fetch('/api/plus/public').then(function (r) { return r.json(); }).then(function (d) {
      if (d.perf) { applyPerf(d.perf); try { localStorage.ap_perf = JSON.stringify(d.perf); } catch (e) {} }
      var b = $('#ap-banner'); var t = d.maintenance ? 'Shop is paused for maintenance. Orders are temporarily off.' : d.announcement;
      if (!t) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('div'); b.id = 'ap-banner'; document.body.prepend(b); }
      b.textContent = t;
    }).catch(function () {});
  }
  banner(); setInterval(function () { if (!document.hidden) banner(); }, 60000);

  var tools = [
    ['Announcement banner', function (b) { b.innerHTML = '<input id="a1" maxlength="300" placeholder="Message for all visitors (empty = hide)"><button data-go>Save</button>'; $('[data-go]', b).onclick = function () { run(api('/api/plus/announcement', 'PUT', { text: $('#a1').value }).then(banner), 'Saved'); }; }],
    ['Maintenance mode', function (b) { b.innerHTML = '<p class="muted">Blocks customers from placing orders.</p><button data-on>Turn on</button> <button data-off>Turn off</button>'; $('[data-on]', b).onclick = function () { run(api('/api/plus/maintenance', 'PUT', { on: true }).then(banner), 'Maintenance on'); }; $('[data-off]', b).onclick = function () { run(api('/api/plus/maintenance', 'PUT', { on: false }).then(banner), 'Maintenance off'); }; }],
    ['Bulk sold-out / in stock', function (b) { b.innerHTML = '<input id="a3" placeholder="Product IDs, comma separated"><button data-so>Mark sold out</button> <button data-in>Mark in stock</button>'; var f = function (v) { return function () { run(api('/api/plus/products/soldout', 'POST', { ids: $('#a3').value.split(/[ ,]+/), soldOut: v }), 'Updated'); }; }; $('[data-so]', b).onclick = f(true); $('[data-in]', b).onclick = f(false); }],
    ['Bulk price change %', function (b) { b.innerHTML = '<input id="a4" type="number" placeholder="Percent, e.g. 10 or -15"><input id="a4i" placeholder="Product IDs (empty = ALL products)"><button data-go>Apply</button>'; $('[data-go]', b).onclick = function () { if (confirm('Change prices?')) run(api('/api/plus/products/price', 'POST', { percent: $('#a4').value, ids: $('#a4i').value.split(/[ ,]+/) }), 'Prices updated'); }; }],
    ['Duplicate product', function (b) { b.innerHTML = '<input id="a5" placeholder="Product ID"><button data-go>Duplicate</button>'; $('[data-go]', b).onclick = function () { run(api('/api/plus/products/' + encodeURIComponent($('#a5').value) + '/duplicate', 'POST'), 'Duplicated'); }; }],
    ['Bulk order status', function (b) { b.innerHTML = '<input id="a6" placeholder="Order IDs, comma separated"><input id="a6s" placeholder="Status, e.g. packed"><button data-go>Apply</button>'; $('[data-go]', b).onclick = function () { run(api('/api/plus/orders/status', 'POST', { ids: $('#a6').value.split(/[ ,]+/), status: $('#a6s').value.trim() }), 'Updated'); }; }],
    ['Purge old cancelled orders', function (b) { b.innerHTML = '<input id="a7" type="number" value="30"><button data-go>Delete older than N days</button>'; $('[data-go]', b).onclick = function () { if (confirm('Permanently delete?')) run(api('/api/plus/orders/purge-cancelled', 'POST', { days: $('#a7').value }), 'Purged'); }; }],
    ['Customer search', function (b) { b.innerHTML = '<input id="a8" placeholder="Username"><button data-go>Search</button><div id="a8o"></div>'; var go = function () { api('/api/plus/customers?q=' + encodeURIComponent($('#a8').value)).then(function (r) { $('#a8o').innerHTML = table(r, [['ID', function (x) { return x.id; }], ['User', function (x) { return x.username; }], ['Orders', function (x) { return x.orders; }], ['Spent', function (x) { return money(x.spent); }]]); }); }; $('[data-go]', b).onclick = go; go(); }],
    ['Customer detail + order history', function (b) { b.innerHTML = '<input id="a9" placeholder="Customer ID"><button data-go>Open</button><div id="a9o"></div>'; $('[data-go]', b).onclick = function () { api('/api/plus/customers/' + encodeURIComponent($('#a9').value)).then(function (d) { $('#a9o').innerHTML = '<h4>' + esc(d.user.username) + '</h4>' + table(d.orders, [['Order', function (x) { return '#' + x.id; }], ['Total', function (x) { return money(x.total); }], ['Status', function (x) { return x.status; }]]); }).catch(function (e) { toast(e.message); }); }; }],
    ['Top customers', function (b) { api('/api/plus/top-customers').then(function (r) { b.innerHTML = table(r, [['User', function (x) { return x.username; }], ['Orders', function (x) { return x.orders; }], ['Spent', function (x) { return money(x.spent); }]]); }); }],
    ['Customer notes', function (b) { b.innerHTML = '<input id="a11" placeholder="Customer ID"><textarea id="a11n" maxlength="1000" placeholder="Private note"></textarea><button data-go>Save note</button>'; $('[data-go]', b).onclick = function () { run(api('/api/plus/customers/' + encodeURIComponent($('#a11').value) + '/note', 'PUT', { note: $('#a11n').value }), 'Saved'); }; }],
    ['Inactive customers (60+ days)', function (b) { api('/api/plus/inactive').then(function (r) { b.innerHTML = table(r, [['ID', function (x) { return x.id; }], ['User', function (x) { return x.username; }], ['Last order', function (x) { return x.last_order ? x.last_order.slice(0, 10) : 'never'; }]]); }); }],
    ['Sales summary', function (b) { api('/api/plus/summary').then(function (s) { b.innerHTML = '<div class="ap-stats"><div><b>' + money(s.today) + '</b>Today</div><div><b>' + money(s.week) + '</b>7 days</div><div><b>' + money(s.month) + '</b>30 days</div><div><b>' + s.pending + '</b>Pending</div></div>'; }); }],
    ['Best sellers', function (b) { api('/api/plus/best-sellers').then(function (r) { b.innerHTML = table(r, [['Item', function (x) { return x.title; }], ['Sold', function (x) { return x.sold; }], ['Revenue', function (x) { return money(x.revenue); }]]); }); }],
    ['Revenue, last 14 days', function (b) { api('/api/plus/daily').then(function (r) { var m = Math.max.apply(null, r.map(function (x) { return x.revenue; }).concat([1])); b.innerHTML = '<div class="ap-bars">' + r.map(function (x) { return '<i title="' + x.day + ': ' + money(x.revenue) + '" style="height:' + Math.max(4, x.revenue / m * 100) + '%"><span>' + x.day.slice(3) + '</span></i>'; }).join('') + '</div>'; }); }],
    ['Database stats', function (b) { api('/api/plus/db-stats').then(function (r) { b.innerHTML = table(r, [['Table', function (x) { return x.name; }], ['Rows', function (x) { return x.rows; }], ['Size', function (x) { return x.size; }]]); }); }],
    ['Server health', function (b) { api('/api/plus/health').then(function (h) { b.innerHTML = table([['Uptime', h.uptimeMin + ' min'], ['Memory', h.rssMB + ' MB (heap ' + h.heapMB + ')'], ['DB ping', h.dbPingMs + ' ms'], ['Node', h.node], ['CPU load', h.load], ['DB pool', h.pool.total + ' total, ' + h.pool.idle + ' idle, ' + h.pool.waiting + ' waiting']], [['Metric', function (x) { return x[0]; }], ['Value', function (x) { return x[1]; }]]); }); }],
    ['Trim activity log', function (b) { b.innerHTML = '<input id="a18" type="number" value="30"><button data-go>Delete older than N days</button>'; $('[data-go]', b).onclick = function () { if (confirm('Delete old log lines?')) run(api('/api/plus/audit/trim', 'POST', { days: $('#a18').value }), 'Trimmed'); }; }],
    ['Export orders CSV', function (b) { b.innerHTML = '<button data-go>Download</button>'; $('[data-go]', b).onclick = function () { fetch('/api/plus/orders.csv', { headers: { Authorization: 'Bearer ' + tok() } }).then(function (r) { return r.blob(); }).then(function (bl) { var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'orders.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); }); }; }],
    ['Optimize database', function (b) { b.innerHTML = '<p class="muted">Refreshes query statistics so pages load faster.</p><button data-go>Run now</button>'; $('[data-go]', b).onclick = function () { run(api('/api/plus/optimize', 'POST'), 'Optimized'); }; }]
  ];

  function toast(m) { var t = $('#toast'); if (t) { t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2500); } else alert(m); }
  function run(p, ok) { p.then(function (d) { toast(ok + (d && d.changed != null ? ' (' + d.changed + ')' : d && d.deleted != null ? ' (' + d.deleted + ')' : '')); }).catch(function (e) { toast(e.message); }); }

  // ----- helpers for the extra tools -----
  var C = function (h, f) { return [h, f]; };
  function listTool(title, url, cols) { return [title, function (b) { b.innerHTML = '<p class="muted">Loading...</p>'; api(url).then(function (r) { b.innerHTML = table(r, cols); }).catch(function (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }); }]; }
  function statTool(title, url, defs) { return [title, function (b) { api(url).then(function (r) { r = Array.isArray(r) ? r[0] || {} : r; b.innerHTML = '<div class="ap-stats">' + defs.map(function (d) { return '<div><b>' + esc(d[2] ? d[2](r[d[1]]) : r[d[1]]) + '</b>' + d[0] + '</div>'; }).join('') + '</div>'; }); }]; }
  function barTool(title, url, lab, val, fmt) { return [title, function (b) { api(url).then(function (r) { var m = Math.max.apply(null, r.map(function (x) { return Number(x[val]); }).concat([1])); b.innerHTML = r.length ? '<div class="ap-hbars">' + r.map(function (x) { return '<div><span>' + esc(x[lab]) + '</span><i style="width:' + Math.max(3, Number(x[val]) / m * 100) + '%"></i><b>' + esc(fmt ? fmt(x[val]) : x[val]) + '</b></div>'; }).join('') + '</div>' : '<p class="muted">Nothing yet.</p>'; }); }]; }
  function formTool(title, fields, btn, url, method, confirmMsg, mk) { return [title, function (b) { b.innerHTML = fields.map(function (f, i) { return '<input data-f="' + i + '" placeholder="' + f[0] + '"' + (f[1] ? ' type="' + f[1] + '"' : '') + (f[2] != null ? ' value="' + f[2] + '"' : '') + '>'; }).join('') + '<button data-go>' + btn + '</button>'; $('[data-go]', b).onclick = function () { var v = Array.prototype.map.call(b.querySelectorAll('[data-f]'), function (x) { return x.value; }); if (confirmMsg && !confirm(confirmMsg)) return; run(api(url(v), method, mk ? mk(v) : undefined), 'Done'); }; }]; }
  var idl = function (x) { return x.split(/[ ,]+/).filter(Boolean); };
  var d10 = function (x) { return x ? String(x).slice(0, 10) : ''; };

  tools.push(
    listTool('Low stock (5 or fewer)', '/api/plus/low-stock?n=5', [C('ID', function (x) { return x.id; }), C('Product', function (x) { return x.title; }), C('Stock', function (x) { return x.stock; })]),
    formTool('Set stock', [['Product IDs, comma separated'], ['New stock', 'number', 0]], 'Set stock', function () { return '/api/plus/products/stock'; }, 'POST', null, function (v) { return { ids: idl(v[0]), stock: v[1] }; }),
    formTool('Adjust stock +/-', [['Product IDs, comma separated'], ['Change, e.g. 10 or -3', 'number']], 'Adjust', function () { return '/api/plus/products/stock-adjust'; }, 'POST', null, function (v) { return { ids: idl(v[0]), delta: v[1] }; }),
    listTool('Sold-out products', '/api/plus/sold-out', [C('ID', function (x) { return x.id; }), C('Product', function (x) { return x.title; }), C('Price', function (x) { return money(x.price); })]),
    listTool('Never sold', '/api/plus/never-sold', [C('ID', function (x) { return x.id; }), C('Product', function (x) { return x.title; }), C('Price', function (x) { return money(x.price); })]),
    statTool('Price overview', '/api/plus/price-overview', [['Products', 'products'], ['Cheapest', 'cheapest', money], ['Priciest', 'priciest', money], ['Average', 'average', money]]),
    barTool('Most favorited', '/api/plus/favorited', 'title', 'hearts'),
    listTool('Pending over 24 hours', '/api/plus/stale-pending', [C('Order', function (x) { return '#' + x.id; }), C('Customer', function (x) { return x.username; }), C('Total', function (x) { return money(x.total); }), C('Placed', function (x) { return d10(x.created_at); })]),
    barTool('Orders by status', '/api/plus/status-counts', 'status', 'orders'),
    barTool('Peak hours', '/api/plus/peak-hours', 'label', 'orders'),
    barTool('Orders by weekday', '/api/plus/weekdays', 'label', 'orders'),
    barTool('Revenue, last 12 months', '/api/plus/monthly', 'label', 'revenue', money),
    barTool('New signups, 14 days', '/api/plus/signups', 'label', 'signups'),
    statTool('Repeat vs one-time buyers', '/api/plus/repeat-customers', [['One-time', 'one_time'], ['Repeat', 'repeat'], ['All buyers', 'buyers']]),
    listTool('Customers who never ordered', '/api/plus/never-ordered', [C('ID', function (x) { return x.id; }), C('User', function (x) { return x.username; }), C('Joined', function (x) { return d10(x.created_at); })]),
    [ 'Find order by ID', function (b) { b.innerHTML = '<input id="o35" placeholder="Order ID"><button data-go>Look up</button><div id="o35o"></div>'; $('[data-go]', b).onclick = function () { api('/api/plus/orders/' + encodeURIComponent($('#o35').value) + '/detail').then(function (d) { $('#o35o').innerHTML = '<h4>#' + d.order.id + ' - ' + esc(d.order.username) + ' - ' + esc(d.order.status) + ' - ' + money(d.order.total) + '</h4>' + table(d.items, [C('Item', function (x) { return x.title; }), C('Qty', function (x) { return x.quantity; }), C('Price', function (x) { return money(x.unit_price); })]); }).catch(function (e) { toast(e.message); }); }; }],
    formTool('Mark orders completed', [['Order IDs, comma separated']], 'Complete', function () { return '/api/plus/orders/complete'; }, 'POST', null, function (v) { return { ids: idl(v[0]) }; }),
    [ 'Pin / unpin products', function (b) { b.innerHTML = '<input id="p37" placeholder="Product IDs, comma separated"><button data-pin>Pin</button> <button data-unpin>Unpin</button>'; var f = function (v) { return function () { run(api('/api/plus/products/pin', 'POST', { ids: idl($('#p37').value), pinned: v }), 'Done'); }; }; $('[data-pin]', b).onclick = f(true); $('[data-unpin]', b).onclick = f(false); }],
    formTool('Bulk discount', [['Percent off (0-90)', 'number', 10], ['Days', 'number', 7], ['Product IDs (empty = ALL)']], 'Apply discount', function () { return '/api/plus/products/discount'; }, 'POST', 'Apply this discount?', function (v) { return { percent: v[0], days: v[1], ids: idl(v[2]) }; }),
    ['Clear all discounts', function (b) { b.innerHTML = '<button data-go>Remove every discount</button>'; $('[data-go]', b).onclick = function () { if (confirm('Remove all discounts?')) run(api('/api/plus/products/clear-discounts', 'POST'), 'Cleared'); }; }],
    listTool('Category summary', '/api/plus/categories', [C('Category', function (x) { return x.category; }), C('Products', function (x) { return x.products; }), C('Revenue', function (x) { return money(x.revenue); })]),
    formTool('Move category', [['From category'], ['To category']], 'Move products', function () { return '/api/plus/products/move-category'; }, 'POST', 'Move all products?', function (v) { return { from: v[0], to: v[1] }; }),
    listTool('Recent activity', '/api/plus/recent-activity', [C('When', function (x) { return String(x.at).replace('T', ' ').slice(5, 16); }), C('Who', function (x) { return x.username; }), C('Action', function (x) { return x.action; }), C('Detail', function (x) { return x.detail; })]),
    listTool('Activity by user (7 days)', '/api/plus/activity-users', [C('User', function (x) { return x.username; }), C('Actions', function (x) { return x.actions; }), C('Last', function (x) { return d10(x.last); })]),
    barTool('Revenue by owner', '/api/plus/owner-revenue', 'owner', 'revenue', money),
    statTool('Profit estimate', '/api/plus/profit', [['Revenue', 'revenue', money], ['Cost', 'cost', money], ['Profit', 'profit', money]]),
    listTool('Products missing images', '/api/plus/missing-images', [C('ID', function (x) { return x.id; }), C('Product', function (x) { return x.title; })]),
    listTool('Duplicate titles', '/api/plus/duplicate-titles', [C('Title', function (x) { return x.title; }), C('Copies', function (x) { return x.copies; }), C('IDs', function (x) { return x.ids; })]),
    ['Export products CSV', function (b) { b.innerHTML = '<button data-go>Download</button>'; $('[data-go]', b).onclick = function () { fetch('/api/plus/products.csv', { headers: { Authorization: 'Bearer ' + tok() } }).then(function (r) { return r.blob(); }).then(function (bl) { var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'products.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); }); }; }],
    statTool('Order value stats', '/api/plus/aov', [['Average order', 'avg_order', money], ['Items per order', 'items_per_order'], ['Biggest order', 'biggest', money]])
  );

  // ----- icons (no emoji) -----
  var I = {
    store: '<path d="M3 9l2-5h14l2 5"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
    box: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 8v.01"/>',
    cart: '<path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .7 3.5 2.4 3.5 5.5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
    userplus: '<circle cx="10" cy="8" r="4"/><path d="M3 20c0-4 3-6 7-6M17 8v6M14 11h6"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13v.01M15 13v.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M9 6l6 6-6 6"/>'
  };
  var ico = function (n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[n] + '</svg>'; };

  // ----- performance + system tools -----
  var PERFK = ['lite', 'nomotion', 'noglow', 'lazy', 'nohover', 'slowrefresh'];
  var PRESETS = [['Balanced', {}], ['Fast', { lite: 1, lazy: 1 }], ['Rush hour', { lite: 1, lazy: 1, slowrefresh: 1 }], ['Ultra light', { lite: 1, lazy: 1, nomotion: 1, noglow: 1, nohover: 1 }], ['Battery saver', { lite: 1, lazy: 1, nomotion: 1, noglow: 1, nohover: 1, slowrefresh: 1 }]];
  var PSW = [
    ['lite', 'Lite glass', 'Turns off blur and see-through panels. The biggest speed gain on older phones.'],
    ['nomotion', 'Reduce animations', 'Removes most movement and transitions across the whole shop.'],
    ['noglow', 'Hide background glow', 'Removes the coloured glow behind every page.'],
    ['lazy', 'Lazy-load images', 'Loads pictures only when they scroll into view.'],
    ['nohover', 'Disable hover effects', 'Stops the lift and highlight effects that follow the pointer.'],
    ['slowrefresh', 'Slow live refresh', 'Checks for new orders every 15 seconds instead of every 5.']
  ];
  var sw = function (attrs, danger) { return '<span class="sh-sw' + (danger ? ' danger' : '') + '"><input type="checkbox" role="switch" ' + attrs + '><i></i></span>'; };
  var swrow = function (title, desc, inner) { return '<label class="sh-row"><span class="sh-txt"><b>' + title + '</b><small>' + desc + '</small></span>' + inner + '</label>'; };
  function putPerf(patch) { return api('/api/plus/perf', 'PUT', patch).then(function (p) { applyPerf(p); try { localStorage.ap_perf = JSON.stringify(p); } catch (e) {} return p; }); }
  function perfTool(title, seg) {
    return [title, function (b) {
      function draw(p) {
        var cur = -1; PRESETS.forEach(function (x, i) { if (PERFK.every(function (k) { return !!p[k] === !!x[1][k]; })) cur = i; });
        b.innerHTML = seg ? '<div class="hy-seg">' + PRESETS.map(function (x, i) { return '<button type="button" data-p="' + i + '" class="' + (i === cur ? 'on' : '') + '">' + x[0] + '</button>'; }).join('') + '</div><p class="muted">' + (cur < 0 ? 'A custom mix is active.' : PRESETS[cur][0] + ' is active for every visitor.') + '</p>'
          : PSW.map(function (x) { return swrow(x[1], x[2], sw('data-k="' + x[0] + '"' + (p[x[0]] ? ' checked' : ''))); }).join('');
        b.querySelectorAll('[data-p]').forEach(function (btn) { btn.onclick = function () { var o = {}; PERFK.forEach(function (k) { o[k] = !!PRESETS[btn.dataset.p][1][k]; }); putPerf(o).then(draw).catch(function (e) { toast(e.message); }); }; });
        b.querySelectorAll('[data-k]').forEach(function (i) { i.onchange = function () { var o = {}; o[i.dataset.k] = i.checked; putPerf(o).catch(function (e) { toast(e.message); i.checked = !i.checked; }); }; });
      }
      api('/api/plus/perf').then(draw);
    }];
  }
  function sysTool(title, desc, onKey, nums, extra) {
    return [title, function (b) {
      api('/api/plus/sys').then(function (d) {
        var s = d.sys;
        b.innerHTML = swrow(title, desc, sw('data-k="' + onKey + '"' + (s[onKey] ? ' checked' : ''))) + nums.map(function (n) { return '<label class="hy-num"><span>' + n[1] + '</span><input type="number" data-n="' + n[0] + '" min="' + n[2] + '" max="' + n[3] + '" value="' + s[n[0]] + '"></label>'; }).join('') + (extra ? extra(d) : '');
        var put = function (key, val) { return api('/api/plus/sys', 'PUT', { key: key, value: val }).then(function () { toast('Saved'); }).catch(function (e) { toast(e.message); }); };
        b.querySelector('[data-k]').onchange = function (e) { put(onKey, e.target.checked); };
        b.querySelectorAll('[data-n]').forEach(function (i) { i.onchange = function () { put(i.dataset.n, Number(i.value)); }; });
      });
    }];
  }
  tools.push(
    perfTool('Performance presets', true),
    perfTool('Performance switches', false),
    sysTool('Shop hours', 'Customers can only place orders between these hours (Philippine time).', 'hours', [['open', 'Opens at hour (0-23)', 0, 23], ['close', 'Closes at hour (1-24)', 1, 24]]),
    sysTool('Slow request log', 'Records requests that take too long so you can spot what is slowing the shop.', 'slowlog', [['slowms', 'Log requests slower than (ms)', 100, 30000]], function (d) { return table(d.slow, [C('When', function (x) { return String(x.at).replace('T', ' ').slice(5, 19); }), C('ms', function (x) { return x.ms; }), C('Request', function (x) { return x.method + ' ' + x.path; })]); }),
    sysTool('Auto-trim activity log', 'Deletes old activity lines once a day.', 'trim', [['trimdays', 'Keep days', 1, 3650]]),
    sysTool('Auto-optimize database', 'Refreshes the database statistics once a day so pages stay quick.', 'optimize', []),
    sysTool('Auto-clean cancelled orders', 'Permanently deletes old cancelled orders once a day.', 'purge', [['purgedays', 'Older than days', 1, 3650]]),
    sysTool('Keep server awake', 'Pings the shop every 10 minutes so free hosting does not put it to sleep. Uses the RENDER_EXTERNAL_URL setting that Render provides.', 'awake', [])
  );

  // ----- 50 more tools (v3) -----
  var base = tools.length;
  var K = function (a) { return a.map(function (c) { return C(c[0], function (x) { var v = x[c[1]]; return c[2] ? c[2](v) : v; }); }); };
  var dt = function (v) { return String(v || '').replace('T', ' ').slice(5, 16); };
  var yn = function (v) { return v ? 'yes' : 'no'; };
  var noEnd = function (v) { return v ? d10(v) : 'no end'; };
  var num0 = function (v) { return v == null ? 'none' : v; };
  var kb = function (v) { return Math.max(1, Math.round(Number(v || 0) / 1024)) + ' KB'; };
  var ord = function (v) { return '#' + v; };
  var dur = function (s) { return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days'; };
  function btnTool(title, note, label, url, confirmMsg, okMsg) {
    return [title, function (b) {
      b.innerHTML = '<p class="muted">' + note + '</p><button data-go>' + label + '</button>';
      $('[data-go]', b).onclick = function () { if (!confirmMsg || confirm(confirmMsg)) run(api(url, 'POST'), okMsg || 'Done'); };
    }];
  }
  var statsHtml = function (rows) { return '<div class="ap-stats">' + rows.map(function (r) { return '<div><b>' + esc(r[1]) + '</b>' + esc(r[0]) + '</div>'; }).join('') + '</div>'; };

  // Software protection: live status of the server's self-defence (src/guard.js)
  function guardTool() {
    return ['Software protection', function (b) {
      function paint(g) {
        var i = g.integrity || {}, shed = g.shed || {};
        b.innerHTML = statsHtml([
          ['Status', g.ready ? (g.overloaded ? 'Busy, shedding' : 'Healthy') : 'Starting'],
          ['Database answer', g.dbMs < 0 ? 'Not answering' : g.dbMs + ' ms'],
          ['Event loop delay', g.lagMs + ' ms (peak ' + g.peakLag + ')'],
          ['Memory', g.rssMb + ' of ' + g.limits.rssMb + ' MB'],
          ['Requests running', g.inflight + ' (peak ' + g.peakInflight + ')'],
          ['Up for', dur(g.uptime)],
          ['Started in', g.bootSeconds == null ? '-' : g.bootSeconds + ' s'],
          ['Files', i.ok === false ? 'CHANGED' : 'Unchanged']
        ]) +
          swrow('Load shedding', 'When the server is overloaded, extra requests get a polite "try again" instead of slowing everyone down. Your admin pages are never refused.', sw('data-shed' + (g.shedding ? ' checked' : ''))) +
          '<h4>Turned away so far</h4>' + statsHtml([['Still starting', shed.starting], ['Too many at once', shed.busy], ['Overloaded', shed.lag], ['Memory full', shed.memory], ['Database down', shed.db], ['Too slow', shed.timeout]]) +
          '<p class="muted">Database pool: ' + g.pool.total + ' open, ' + g.pool.idle + ' idle, ' + g.pool.waiting + ' waiting. Breaker opened ' + g.breaker.opened + ' time(s)' + (g.breaker.open ? ' (open now)' : '') + '. Auto restart on memory limit: ' + (g.limits.autoRestart ? 'on' : 'off') + '.' + (g.restartReason ? ' Last restart reason: ' + esc(g.restartReason) + '.' : '') + '</p>' +
          '<button data-refresh>Refresh</button>';
        b.querySelector('[data-shed]').onchange = function (e) { api('/api/admin/guard/shedding', 'POST', { on: e.target.checked }).then(paint).catch(function (x) { toast(x.message); }); };
        b.querySelector('[data-refresh]').onclick = load;
      }
      function load() { b.insertAdjacentHTML('afterbegin', ''); api('/api/admin/guard').then(paint).catch(function (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }); }
      load();
    }];
  }
  function integrityTool() {
    return ['File integrity check', function (b) {
      function paint(g) {
        var i = g.integrity || {}, bad = (i.changed || []).concat(i.added || [], i.removed || []);
        b.innerHTML = '<p class="muted">Every app file gets a fingerprint when the server starts and is checked again every 10 minutes. On Render the files only change when you deploy, so a change means something modified the code.</p>' +
          statsHtml([['Result', i.ok === false ? 'FILES CHANGED' : 'All unchanged'], ['Files watched', i.files || 0], ['Fingerprint', i.digest || '-'], ['Last check', i.checkedAt ? new Date(i.checkedAt).toLocaleTimeString() : 'not yet']]) +
          (bad.length ? '<h4>Different since start</h4>' + table(bad.map(function (f) { return { f: f, w: (i.changed || []).indexOf(f) > -1 ? 'changed' : (i.added || []).indexOf(f) > -1 ? 'new' : 'removed' }; }), K([['File', 'f'], ['What', 'w']])) : '') +
          '<button data-scan>Check now</button>';
        b.querySelector('[data-scan]').onclick = function () { api('/api/admin/guard/scan', 'POST').then(function (r) { paint(r); toast(r.integrity.ok ? 'Files unchanged' : 'Files changed!'); }).catch(function (e) { toast(e.message); }); };
      }
      api('/api/admin/guard').then(paint).catch(function (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
    }];
  }
  function healthTool() {
    return ['Health check test', function (b) {
      b.innerHTML = '<p class="muted">Asks /healthz (the page your host checks) three times from this device. Render fails a health check that takes longer than 5 seconds.</p><button data-go>Run test</button><div class="hc-out"></div>';
      $('[data-go]', b).onclick = function () {
        var out = $('.hc-out', b), times = [], n = 0; out.innerHTML = '<p class="muted">Testing...</p>';
        function one() {
          var t = performance.now();
          fetch('/healthz', { cache: 'no-store' }).then(function (r) { return r.text().then(function (x) { times.push({ ms: Math.round(performance.now() - t), ok: r.ok && x === 'ok' }); }); }).catch(function () { times.push({ ms: -1, ok: false }); }).then(function () { if (++n < 3) one(); else done(); });
        }
        function done() {
          var worst = Math.max.apply(null, times.map(function (x) { return x.ms; })), allOk = times.every(function (x) { return x.ok; });
          api('/api/admin/guard').then(function (g) {
            out.innerHTML = statsHtml([['Verdict', allOk && worst < 5000 ? 'PASS' : 'FAIL'], ['Slowest answer', worst + ' ms'], ['Time to spare', allOk ? Math.max(0, 5000 - worst) + ' ms' : '-'], ['Ready for visitors', g.ready ? 'yes' : 'no'], ['Database answer', g.dbMs < 0 ? 'down' : g.dbMs + ' ms'], ['Server started in', g.bootSeconds == null ? '-' : g.bootSeconds + ' s']]);
          }).catch(function () { out.innerHTML = statsHtml([['Verdict', allOk && worst < 5000 ? 'PASS' : 'FAIL'], ['Slowest answer', worst + ' ms']]); });
        }
        one();
      };
    }];
  }
  function auditSearchTool() {
    return ['Search activity log', function (b) {
      b.innerHTML = '<input id="al-q" placeholder="Word to find (person, action or detail)"><button data-go>Search</button><div id="al-o"></div>';
      var go = function () { var v = $('#al-q').value.trim(); if (!v) return; api('/api/plus/audit-search?q=' + encodeURIComponent(v)).then(function (r) { $('#al-o').innerHTML = table(r, K([['When', 'at', dt], ['Who', 'username'], ['Action', 'action'], ['Detail', 'detail']])); }).catch(function (e) { toast(e.message); }); };
      $('[data-go]', b).onclick = go; $('#al-q').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    }];
  }
  var ORDER_COLS = K([['Order', 'id', ord], ['Customer', 'username'], ['Total', 'total', money], ['Status', 'status'], ['Placed', 'created_at', dt]]);
  tools.push(
    // Catalog (10)
    listTool('Free or zero-price products', '/api/plus/free-products', K([['ID', 'id'], ['Product', 'title'], ['Price', 'price', money]])),
    listTool('Active discounts', '/api/plus/active-discounts', K([['ID', 'id'], ['Product', 'title'], ['Off %', 'pct'], ['Until', 'discount_until', noEnd]])),
    listTool('Discounts ending within 7 days', '/api/plus/discounts-ending', K([['ID', 'id'], ['Product', 'title'], ['Off %', 'pct'], ['Ends', 'discount_until', dt]])),
    listTool('Lowest margins', '/api/plus/low-margin', K([['ID', 'id'], ['Product', 'title'], ['Price', 'price', money], ['Cost', 'cost', money], ['Margin %', 'margin']])),
    listTool('Products with no cost set', '/api/plus/no-cost', K([['ID', 'id'], ['Product', 'title'], ['Price', 'price', money]])),
    listTool('Bulk-deal products', '/api/plus/bulk-deals', K([['ID', 'id'], ['Product', 'title'], ['From qty', 'bulk_min'], ['Off %', 'bulk_percent']])),
    listTool('Newest products', '/api/plus/newest-products', K([['ID', 'id'], ['Product', 'title'], ['Price', 'price', money], ['Added', 'created_at', d10]])),
    barTool('Products per owner', '/api/plus/products-per-owner', 'owner', 'products'),
    btnTool('Unpin all products', 'Removes the pin from every pinned product so the shop order is back to normal.', 'Unpin everything', '/api/plus/products/unpin-all', 'Unpin all products?', 'Unpinned'),
    listTool('Products hidden by seller', '/api/plus/hidden-products', K([['ID', 'id'], ['Product', 'title'], ['Seller', 'owner']])),
    // Inventory (6)
    listTool('Out of stock (0 left)', '/api/plus/out-of-stock', K([['ID', 'id'], ['Product', 'title'], ['Marked sold out', 'is_sold_out', yn]])),
    statTool('Stock value', '/api/plus/stock-value', [['Units in stock', 'units'], ['Products tracked', 'tracked'], ['Worth at cost', 'at_cost', money], ['Worth at price', 'at_price', money]]),
    listTool('Overstocked (50 or more)', '/api/plus/overstocked', K([['ID', 'id'], ['Product', 'title'], ['Stock', 'stock']])),
    listTool('Days of stock left', '/api/plus/stock-runway', K([['ID', 'id'], ['Product', 'title'], ['Stock', 'stock'], ['Sold 30d', 'sold30'], ['Days left', 'days_left']])),
    btnTool('Sync sold-out with stock', 'Marks products with 0 stock as sold out, and puts products that have stock back in stock.', 'Sync now', '/api/plus/products/sync-soldout', 'Update every sold-out flag to match the stock numbers?', 'Synced'),
    listTool('Products not tracking stock', '/api/plus/untracked-stock', K([['ID', 'id'], ['Product', 'title'], ['Price', 'price', money]])),
    // Orders (10)
    listTool("Today's orders", '/api/plus/orders-today', ORDER_COLS),
    listTool('Unpaid orders', '/api/plus/unpaid-orders', ORDER_COLS),
    listTool('Recent cancelled orders', '/api/plus/cancelled-recent', K([['Order', 'id', ord], ['Customer', 'username'], ['Total', 'total', money], ['Reason', 'reason'], ['Placed', 'created_at', dt]])),
    barTool('Cancellation reasons', '/api/plus/cancel-reasons', 'reason', 'orders'),
    listTool('Biggest orders', '/api/plus/biggest-orders', ORDER_COLS),
    listTool('Orders with customer notes', '/api/plus/orders-with-notes', K([['Order', 'id', ord], ['Customer', 'username'], ['Note', 'note'], ['Status', 'status']])),
    barTool('Pending orders by age', '/api/plus/pending-age', 'label', 'orders'),
    statTool('Today vs yesterday', '/api/plus/today-vs-yesterday', [['Today', 'today', money], ['Yesterday', 'yesterday', money], ['Same day last week', 'last_week', money], ['Orders today', 'orders_today'], ['Orders yesterday', 'orders_yesterday']]),
    barTool('Items sold today', '/api/plus/items-today', 'title', 'qty'),
    listTool('Promo code performance', '/api/plus/promo-performance', K([['Code', 'code'], ['Off %', 'percent'], ['Used', 'used_count'], ['Limit', 'max_uses', num0], ['Active', 'is_active', yn]])),
    // People (8)
    listTool('New customers (7 days)', '/api/plus/new-customers', K([['ID', 'id'], ['User', 'username'], ['Joined', 'created_at', dt]])),
    listTool('Sellers overview', '/api/plus/sellers-overview', K([['ID', 'id'], ['Seller', 'username'], ['Products', 'products'], ['Revenue', 'revenue', money], ['Hidden', 'hidden', yn]])),
    listTool('Top spenders (30 days)', '/api/plus/top-spenders-30', K([['User', 'username'], ['Orders', 'orders'], ['Spent', 'spent', money]])),
    listTool('Must change password', '/api/plus/must-change', K([['ID', 'id'], ['User', 'username'], ['Role', 'role'], ['Temp password ends', 'temp_expires', dt]])),
    listTool('Recent password resets', '/api/plus/recent-resets', K([['User', 'username'], ['When', 'created_at', dt], ['Reset by', 'reset_by']])),
    listTool('Blocked customers', '/api/plus/blocked-customers', K([['User', 'username'], ['Shop-wide', 'shop_wide', yn], ['Reason', 'reason'], ['Blocked by', 'blocker'], ['When', 'created_at', d10]])),
    listTool('Many accounts, one sign-up address (5+)', '/api/plus/shared-signup-ip', K([['Address', 'ip'], ['Accounts', 'accounts'], ['Users', 'users']])),
    listTool('Custom requests waiting', '/api/plus/requests-waiting', K([['ID', 'id'], ['Customer', 'username'], ['Request', 'request'], ['Sent', 'created_at', dt]])),
    // Insights (8)
    barTool('Revenue, last 7 days', '/api/plus/revenue-week', 'label', 'revenue', money),
    barTool('Orders by hour today', '/api/plus/sales-by-hour-today', 'label', 'orders'),
    barTool('Best sellers (7 days)', '/api/plus/best-sellers-7', 'title', 'sold'),
    listTool('Slow movers (30 days)', '/api/plus/slow-movers', K([['ID', 'id'], ['Product', 'title'], ['Sold 30d', 'sold30']])),
    listTool('Favorited but never sold', '/api/plus/fav-never-sold', K([['ID', 'id'], ['Product', 'title'], ['Hearts', 'hearts']])),
    barTool('Revenue by category (30 days)', '/api/plus/category-30', 'label', 'revenue', money),
    statTool('This month vs last month', '/api/plus/month-compare', [['This month', 'this_month', money], ['Last month', 'last_month', money], ['Orders this month', 'orders_this'], ['Orders last month', 'orders_last']]),
    statTool('Discounts given (30 days)', '/api/plus/discount-given', [['Money discounted', 'given', money], ['Orders with a discount', 'orders_with_discount'], ['All orders', 'orders']]),
    // System (8)
    guardTool(),
    integrityTool(),
    healthTool(),
    listTool('Security events (latest 50)', '/api/admin/guard/events', K([['When', 'at', dt], ['Type', 'type'], ['IP', 'ip'], ['User', 'user'], ['Detail', 'detail']])),
    listTool('Environment check', '/api/admin/guard/env', K([['Setting', 'name'], ['OK', 'ok', yn], ['Note', 'note']])),
    listTool('Saved backups', '/api/plus/backup-list', K([['ID', 'id'], ['Size', 'size', kb], ['Made', 'created_at', dt]])),
    barTool('Top actions (7 days)', '/api/plus/top-actions', 'label', 'n'),
    auditSearchTool()
  );
  var R = function (a, n) { var o = []; for (var j = 0; j < n; j++) o.push(base + a + j); return o; };

  var GROUPS = [
    ['Store', 'store', 25, [0, 1, 52]],
    ['Catalog', 'tag', 215, [2, 3, 4, 37, 38, 39, 40, 41, 25, 46, 47, 48].concat(R(0, 10))],
    ['Inventory', 'box', 170, [20, 21, 22, 23, 24].concat(R(10, 6))],
    ['Orders', 'cart', 265, [5, 6, 18, 27, 28, 35, 36].concat(R(16, 10))],
    ['People', 'users', 335, [7, 8, 9, 10, 11, 33, 34].concat(R(26, 8))],
    ['Insights', 'chart', 140, [12, 13, 14, 26, 29, 30, 31, 32, 44, 45, 49].concat(R(34, 8))],
    ['Performance', 'bolt', 45, [50, 51, 53]],
    ['System', 'gear', 205, [15, 16, 17, 19, 42, 43, 54, 55, 56, 57].concat(R(42, 8))]
  ];

  // Admin+ Pack: more tools, listed by the server (/api/plus/pack). Columns come from the data itself.
  var packP = null;
  function loadPack() {
    if (packP) return packP;
    var lab = function (k) { k = String(k).replace(/_/g, ' '); return k.charAt(0).toUpperCase() + k.slice(1); };
    function auto(t) {
      if (t.k === 'b') return barTool(t.t, t.u, 'label', 'value')[1];
      if (t.k === 'a') return function (b) { b.innerHTML = '<button type="button" data-go>Run</button> <span class="muted" data-msg></span>'; $('[data-go]', b).onclick = function () { if (!confirm(t.t + '?')) return; var m = $('[data-msg]', b); m.textContent = 'Working...'; api(t.u, 'POST', {}).then(function (r) { m.textContent = r.message || 'Done.'; }).catch(function (e) { m.textContent = e.message; }); }; };
      return function (b) {
        b.innerHTML = '<p class="muted">Loading...</p>';
        api(t.u).then(function (r) {
          if (!r.length) { b.innerHTML = '<p class="muted">Nothing to show.</p>'; return; }
          var ks = Object.keys(r[0]), f = function (k) { return /(^at$|_at$)/.test(k) ? dt : typeof r[0][k] === 'number' && r[0][k] % 1 ? money : null; };
          if (t.k === 's') { var rows = ks.map(function (k) { var v = r[0][k]; return { s: lab(k), v: f(k) && v != null ? f(k)(v) : v == null ? '-' : v }; }); b.innerHTML = table(rows, K([['Measure', 's'], ['Value', 'v']])); return; }
          b.innerHTML = table(r, K(ks.map(function (k) { return [lab(k), k, f(k)]; })));
        }).catch(function (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
      };
    }
    packP = api('/api/plus/pack').then(function (d) {
      var hue = { 'Security': 5, 'Data health': 190, 'Orders+': 265, 'Catalog+': 215, 'People+': 335, 'Insights+': 140, 'System+': 205 }, by = {}, order = [];
      d.tools.forEach(function (t) { var i = tools.push([t.t, auto(t)]) - 1; if (!by[t.g]) { by[t.g] = []; order.push(t.g); } by[t.g].push(i); });
      order.forEach(function (g) { GROUPS.push([g, 'gear', hue[g] || 205, by[g]]); });
    }).catch(function () { packP = null; });
    return packP;
  }

  function close() { var o = $('#ap-dlg'); if (o) o.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() { loadPack().then(openNow, openNow); }
  function openNow() {
    close();
    var d = document.createElement('div'); d.id = 'ap-dlg';
    d.innerHTML = '<div class="hy-sheet" role="dialog" aria-label="Admin+"><div class="hy-bar"><div><h2>Admin+</h2><p>' + tools.length + ' tools and settings</p></div><button class="hy-x" type="button" aria-label="Close">' + ico('close') + '</button></div>' +
      '<label class="hy-search">' + ico('search') + '<input type="search" placeholder="Search ' + tools.length + ' tools" aria-label="Search tools"></label><div class="hy-chips"></div>' +
      '<div class="hy-scroll"><div class="hy-kpis"></div><div class="hy-groups"></div><p class="muted hy-none" hidden>No tools match.</p></div></div>';
    document.body.appendChild(d); document.body.style.overflow = 'hidden'; document.addEventListener('keydown', onKey);
    d.onclick = function (e) { if (e.target === d) close(); };
    $('.hy-x', d).onclick = close;
    api('/api/plus/summary').then(function (k) { $('.hy-kpis', d).innerHTML = [['Today', money(k.today), 25], ['7 days', money(k.week), 215], ['30 days', money(k.month), 265], ['Pending', k.pending, 45], ['Orders', k.orders, 140]].map(function (x) { return '<div class="hy-kpi" style="--h:' + x[2] + '"><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join(''); }).catch(function () {});
    var host = $('.hy-groups', d), chips = $('.hy-chips', d), cur = 'all', find = $('.hy-search input', d);
    chips.innerHTML = '<button type="button" class="on" data-g="all">All</button>' + GROUPS.map(function (g) { return '<button type="button" data-g="' + g[0] + '">' + g[0] + '</button>'; }).join('');
    GROUPS.forEach(function (g) {
      var sec = document.createElement('section'); sec.className = 'hy-group'; sec.dataset.g = g[0]; sec.style.setProperty('--h', g[2]);
      sec.innerHTML = '<h3>' + g[0] + '<span>' + g[3].length + '</span></h3><div class="hy-card"></div>';
      var card = $('.hy-card', sec);
      g[3].forEach(function (i) {
        var t = tools[i], it = document.createElement('div'); it.className = 'hy-item'; it.dataset.n = t[0].toLowerCase();
        it.innerHTML = '<button class="hy-row" type="button"><span class="hy-ic">' + ico(g[1]) + '</span><b>' + t[0] + '</b><span class="hy-chev">' + ico('chev') + '</span></button><div class="ap-b hy-body" hidden></div>';
        var body = $('.hy-body', it), done = false;
        $('.hy-row', it).onclick = function () { var op = body.hidden; body.hidden = !op; it.classList.toggle('open', op); if (op && !done) { done = true; t[1](body); } };
        card.appendChild(it);
      });
      host.appendChild(sec);
    });
    function apply() {
      var v = find.value.trim().toLowerCase(), shown = 0;
      d.querySelectorAll('.hy-group').forEach(function (g) {
        var any = 0; g.querySelectorAll('.hy-item').forEach(function (c) { var ok = !v || c.dataset.n.indexOf(v) > -1; c.style.display = ok ? '' : 'none'; if (ok) any++; });
        g.style.display = any && (cur === 'all' || v || g.dataset.g === cur) ? '' : 'none'; if (g.style.display === '') shown += any;
      });
      $('.hy-none', d).hidden = shown > 0;
    }
    find.oninput = apply;
    chips.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; cur = b.dataset.g; chips.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); find.value = ''; apply(); };
  }

  function mountBtn() {
    var u = me(), b = $('#ap-fab');
    if (!u || u.role !== 'admin') { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('button'); b.id = 'ap-fab'; b.type = 'button'; b.innerHTML = ico('bolt') + '<span>Admin+</span>'; b.onclick = open; document.body.appendChild(b);
  }
  mountBtn(); setInterval(mountBtn, 2000);

  // ----- Security switches (shown inside Admin > System > Security) -----
  var SW = [
    ['throttle', 'bolt', 'Throttle mode', 'Keeps the shop running near max if an attack gets through: caches public data, limits anonymous visitors, sheds overload, serves logged-in users first.', false],
    ['throttleauto', 'bolt', 'Auto-throttle', 'Turns Throttle mode on by itself when the server is overloaded, and off 60 seconds after it calms down.', false],
    ['lockdown', 'alert', 'Lockdown', 'Shuts the shop for everyone except you. Customers and sellers see a maintenance message.', true],
    ['firewall', 'shield', 'Firewall mode', 'Strict filter: blocks attack patterns and requests with no browser ID, and caps each visitor at 120 requests a minute.', false],
    ['readonly', 'lock', 'Read-only mode', 'Everyone can browse but nobody except you can order or change anything.', true],
    ['nosignup', 'userplus', 'Pause sign-ups', 'Stops new accounts from being created.', false],
    ['nobots', 'bot', 'Block bots', 'Refuses scripts and scanners such as curl, python and sqlmap.', false],
    ['ctypecheck', 'shield', 'Content-type check', 'Rejects submissions that are not normal JSON, form or picture data.', false],
    ['jsondepth', 'shield', 'Deep-data guard', 'Rejects submitted data nested more than 10 levels (crash attacks).', false],
    ['uaguard', 'bot', 'Browser-ID check', 'Blocks oversized or code-filled browser identifiers.', false],
    ['hdrspoof', 'lock', 'Header spoof guard', 'Strips forged X-Original-URL, X-Forwarded-Host and method-override headers.', false],
    ['apinostore', 'lock', 'No-cache API', 'Stops browsers and proxies storing any API answer.', false],
    ['tarpit', 'bot', 'Tarpit', 'Slows every answer by 1.5 s for visitors who keep getting blocked.', false],
    ['maxparams', 'alert', 'Parameter cap', 'Rejects addresses with more than 40 query parameters.', false],
    ['rangeguard', 'alert', 'Range-request guard', 'Blocks abusive multi-range download requests.', false],
    ['tokenurl', 'lock', 'Secrets-in-URL block', 'Refuses addresses carrying token, password or jwt.', false],
    ['logindelay', 'lock', 'Login slow-down', 'Adds 0.7 s to every login attempt to make guessing slow.', false],
    ['geoblock', 'shield', 'Country block', 'Blocks countries listed in BLOCK_COUNTRIES (e.g. RU,CN). Needs a host that sends the country, such as Cloudflare.', false],
    ['corsstrict', 'lock', 'Strict CORS', 'Refuses any request that comes from another website.', false],
    ['referercheck', 'lock', 'Referer check', 'Changes must come from your own pages.', false],
    ['dotfiles', 'lock', 'Hide secret files', 'Blocks .env, .git, backups, .sql, source folders and key files.', false],
    ['methodlock', 'lock', 'Method lock', 'Only normal web methods are allowed (no TRACE, CONNECT and similar).', false],
    ['hpp', 'shield', 'Parameter pollution guard', 'Rejects repeated or stuffed query parameters.', false],
    ['longurl', 'alert', 'Long URL block', 'Rejects addresses over 2000 characters.', false],
    ['protopollution', 'shield', 'Prototype pollution guard', 'Blocks __proto__ and constructor tricks in submitted data.', false],
    ['nullbyte', 'shield', 'Null-byte block', 'Blocks %00 file-path tricks.', false],
    ['burst', 'alert', 'Burst guard', 'Max 25 requests per second per visitor.', false],
    ['conip', 'alert', 'Connection cap', 'Max 25 simultaneous requests per visitor.', false],
    ['hostcheck', 'lock', 'Host check', 'Only answers for your own domain. Needs the ALLOWED_HOSTS setting (comma list), otherwise does nothing.', false],
    ['slowloris', 'alert', 'Slow-attack guard', 'Drops connections that send data too slowly (Slowloris).', false],
    ['ddos', 'alert', 'DDoS shield', 'Tight flood limit: 60 requests per 10 seconds per visitor, then they are slowed down.', false],
    ['datashield', 'shield', 'Data protection shield', 'Strips passwords, tokens and secrets from every answer and stops browsers caching private data.', false],
    ['sqlguard', 'shield', 'SQL injection guard', 'Blocks database-attack text in addresses and forms.', false],
    ['xssguard', 'shield', 'Script injection guard (XSS)', 'Blocks script and iframe code hidden in addresses and forms.', false],
    ['origin', 'lock', 'Cross-site request block (CSRF)', 'Refuses changes sent from other websites.', false],
    ['honeypot', 'bot', 'Honeypot traps', 'Hacker bait pages like /.env and /wp-admin: anyone who touches them is banned for 1 hour.', false],
    ['autoban', 'lock', 'Auto-ban repeat attackers', 'Bans an address for 1 hour after 8 blocked attempts.', false],
    ['scrape', 'bot', 'Anti-scraping', 'Limits browsing to 90 data requests a minute per visitor.', false],
    ['slowlogin', 'lock', 'Login and sign-up throttle', 'Max 12 login or sign-up attempts per 5 minutes per visitor.', false],
    ['bigbody', 'alert', 'Block oversized requests', 'Rejects anything over 2 MB.', false],
    ['noupload', 'lock', 'Block uploads', 'Turns off picture and file uploads.', true],
    ['nohotlink', 'shield', 'Hotlink protection', 'Other websites cannot embed your pictures.', false],
    ['forcehttps', 'lock', 'Force HTTPS', 'Redirects insecure visits to the secure address.', false],
    ['secheaders', 'shield', 'Strict security headers', 'HSTS, no framing, no sniffing, locked camera, mic and location.', false]
  ];
  var LBL = { ctypecheck: 'Content type', jsondepth: 'Deep data', uaguard: 'Browser ID', hdrspoof: 'Header spoof', apinostore: 'No-cache', tarpit: 'Tarpit', maxparams: 'Param cap', rangeguard: 'Range abuse', tokenurl: 'Secret in URL', logindelay: 'Login delay', geoblock: 'Country', corsstrict: 'CORS', referercheck: 'Referer', dotfiles: 'Secret files', methodlock: 'Method lock', hpp: 'Param pollution', longurl: 'Long URL', protopollution: 'Proto pollution', nullbyte: 'Null byte', burst: 'Burst', conip: 'Connections', hostcheck: 'Host', slowloris: 'Slow attack', spill: 'RAM exports', memory: 'RAM alarms', throttle: 'Throttled', throttleauto: 'Auto-throttle', ddos: 'DDoS shield', datashield: 'Data fields hidden', sqlguard: 'SQL injection', xssguard: 'Script injection', origin: 'Cross-site', honeypot: 'Honeypot', autoban: 'Auto-banned', scrape: 'Scraping', bigbody: 'Oversized', noupload: 'Uploads', slowlogin: 'Login throttle', forcehttps: 'HTTPS', nohotlink: 'Hotlink', secheaders: 'Headers', lockdown: 'Lockdown', firewall: 'Firewall', readonly: 'Read-only', nosignup: 'Sign-ups paused', nobots: 'Bots', ip: 'Blocked IP', session: 'Old logins ended' };
  function shield(box) {
    var u = me(); if (!box || !u || u.role !== 'admin') return;
    var old = $('#shieldbox', box); if (old) old.remove();
    var sec = document.createElement('section'); sec.id = 'shieldbox'; sec.className = 'panel glass sh';
    sec.innerHTML = '<p class="muted">Loading security switches...</p>'; box.insertBefore(sec, box.firstChild);
    function paint(d) {
      var on = SW.filter(function (x) { return d.state[x[0]]; }).length;
      sec.innerHTML = '<div class="sh-head"><div><h2>Security controls</h2><p class="muted">Flip a switch and it takes effect instantly. You stay logged in and keep full access.</p>' + (d.live ? '<p class="muted"><b>Throttle:</b> ' + (d.live.throttle ? (d.live.auto ? 'ACTIVE (auto)' : 'ACTIVE') : 'standby') + ' &middot; lag ' + d.live.lag + 'ms &middot; ' + d.live.open + ' open &middot; ' + d.live.cached + ' cached &middot; ' + d.live.shed + ' shed</p>' : '') + '</div><span class="sh-pill' + (on ? ' hot' : '') + '">' + (on ? on + ' active' : 'All normal') + '</span></div>' +
        SW.map(function (x) { return '<label class="sh-row' + (d.state[x[0]] ? ' on' : '') + '"><em class="sh-ic">' + ico(x[1]) + '</em><span class="sh-txt"><b>' + x[2] + '</b><small>' + x[3] + '</small></span><span class="sh-sw' + (x[4] ? ' danger' : '') + '"><input type="checkbox" role="switch" data-k="' + x[0] + '"' + (d.state[x[0]] ? ' checked' : '') + '><i></i></span></label>'; }).join('') +
        '<div class="sh-ips"><b>Blocked IP addresses</b><small>One per line. Blocked visitors get "Access blocked".</small><textarea id="sh-ips" rows="3" placeholder="e.g. 203.0.113.7">' + esc(d.state.ips.join('\n')) + '</textarea><button type="button" id="sh-save">Save IP list</button></div>' +
        '<div class="sh-btns"><button type="button" id="sh-out" class="sh-warn">Log everyone else out</button><button type="button" id="sh-clr">Clear blocked log</button></div>' +
        '<div class="sh-btns"><button type="button" id="sh-all">Turn ON all safe defences</button></div><h3>Blocked so far</h3><div class="ap-stats">' + Object.keys(d.stats).filter(function (k) { return d.stats[k]; }).map(function (k) { return '<div><b>' + d.stats[k] + '</b>' + (LBL[k] || k) + '</div>'; }).join('') + '</div>' +
        (d.blocked.length ? table(d.blocked.slice(0, 15), [C('When', function (x) { return String(x.at).replace('T', ' ').slice(5, 19); }), C('Type', function (x) { return LBL[x.type] || x.type; }), C('IP', function (x) { return x.ip; }), C('Path', function (x) { return x.path; })]) : '<p class="muted">Nothing blocked since the last restart.</p>');
      sec.querySelectorAll('input[data-k]').forEach(function (i) {
        i.onchange = function () {
          var k = i.dataset.k, v = i.checked, w = SW.filter(function (x) { return x[0] === k; })[0];
          if (w[4] && v && !confirm('Turn on ' + w[2] + '? Customers will be affected right away.')) { i.checked = false; return; }
          api('/api/shield/toggle', 'PUT', { key: k, on: v }).then(paint).catch(function (e) { toast(e.message); i.checked = !v; });
        };
      });
      $('#sh-save', sec).onclick = function () { api('/api/shield/ips', 'PUT', { text: $('#sh-ips', sec).value }).then(function (r) { paint(r); toast('IP list saved'); }).catch(function (e) { toast(e.message); }); };
      $('#sh-out', sec).onclick = function () { if (confirm('Log out every customer and seller? You stay logged in.')) api('/api/shield/logout-all', 'POST').then(function (r) { paint(r); toast('Everyone else was logged out'); }).catch(function (e) { toast(e.message); }); };
      $('#sh-all', sec).onclick = function () { var ks = SW.filter(function (x) { return !x[4] && x[0] !== 'nosignup' && x[0] !== 'nobots' && x[0] !== 'throttle' && x[0] !== 'hostcheck' && x[0] !== 'geoblock' && x[0] !== 'referercheck' && x[0] !== 'corsstrict'; }).map(function (x) { return x[0]; }); ks.reduce(function (p, k) { return p.then(function () { return api('/api/shield/toggle', 'PUT', { key: k, on: true }); }); }, Promise.resolve()).then(function () { toast('All safe defences are ON'); shield(box); }).catch(function (e) { toast(e.message); }); };
      function bulk(keys, on, msg) { keys.reduce(function (p, k) { return p.then(function () { return api('/api/shield/toggle', 'PUT', { key: k, on: on }); }); }, Promise.resolve()).then(function () { toast(msg); shield(box); }).catch(function (e) { toast(e.message); }); }
      var P1 = function (x) { return x[0] !== 'lockdown' && x[0] !== 'readonly' && x[0] !== 'nosignup' && x[0] !== 'hostcheck' && x[0] !== 'geoblock'; };
      if ($('#sh-panic', sec)) $('#sh-panic', sec).onclick = function () { if (confirm('Panic mode turns on every defence except lockdown, read-only and sign-up pause. Continue?')) bulk(SW.filter(P1).map(function (x) { return x[0]; }), true, 'Panic mode: all defences ON'); };
      if ($('#sh-off', sec)) $('#sh-off', sec).onclick = function () { if (confirm('Turn every switch OFF?')) bulk(SW.map(function (x) { return x[0]; }).filter(function (k) { return d.state[k]; }), false, 'All switches OFF'); };
      $('#sh-clr', sec).onclick = function () { api('/api/shield/clear-log', 'POST').then(paint); };
    }
    api('/api/shield').then(paint).catch(function (e) { sec.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }

  // ----- Performance mode bar (shows at the top of every Admin page) -----
  var PM = [['low', 'Low power', 'Saves RAM and CPU: long caching, tight limits'], ['balanced', 'Balanced', 'Normal everyday setting'], ['max', 'Max', 'Highest capacity, caching on']];
  function perfBar() {
    var u = me(), app = $('#app'); if (!u || u.role !== 'admin' || !app || !$('#attn', app)) { var o = $('#perfbar'); if (o && !(app && $('#attn', app))) o.remove(); return; }
    if ($('#perfbar')) return;
    var b = document.createElement('section'); b.id = 'perfbar'; b.className = 'panel glass sh'; b.innerHTML = '<p class="muted">Loading performance mode...</p>';
    app.insertBefore(b, $('#attn', app));
    function paint(d) {
      var l = d.live || {}, r = l.ram || {};
      b.innerHTML = '<div class="sh-head"><div><h2>Performance mode</h2><p class="muted">RAM ' + (r.mb || 0) + ' / ' + (r.limit || 0) + ' MB (' + (r.pct || 0) + '%). If RAM runs short, logs, bans and caches are exported to the database and freed' + (r.spills ? ' (' + r.spills + ' export' + (r.spills > 1 ? 's' : '') + ' so far)' : '') + '.</p></div></div>' +
        '<div class="sh-btns">' + PM.map(function (m) { return '<button type="button" data-m="' + m[0] + '" title="' + m[2] + '"' + (d.state.perf === m[0] ? ' style="background:var(--acc);color:#fff"' : '') + '>' + m[1] + '</button>'; }).join('') + '<button type="button" id="pf-spill">Export RAM to database now</button></div>';
      b.querySelectorAll('[data-m]').forEach(function (x) { x.onclick = function () { api('/api/shield/perf', 'PUT', { mode: x.dataset.m }).then(function (r2) { paint(r2); toast(x.textContent + ' mode on'); }).catch(function (e) { toast(e.message); }); }; });
      $('#pf-spill', b).onclick = function () { api('/api/shield/spill-now', 'POST').then(function (r2) { paint(r2); toast('Exported to database'); }).catch(function (e) { toast(e.message); }); };
    }
    api('/api/shield').then(paint).catch(function (e) { b.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  setInterval(perfBar, 1500);
  window.AdminPlus = { shield: shield };
})();
