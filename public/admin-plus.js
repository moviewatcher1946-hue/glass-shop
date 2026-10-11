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

  // Announcement banner + maintenance notice (everyone)
  function banner() {
    fetch('/api/plus/public').then(function (r) { return r.json(); }).then(function (d) {
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

  function open() {
    var old = $('#ap-dlg'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'ap-dlg';
    d.innerHTML = '<div class="ap-box glass"><div class="ap-head"><h2>Admin+</h2><button class="ap-x" aria-label="Close">&times;</button></div><div class="ap-list"></div></div>';
    var list = $('.ap-list', d);
    tools.forEach(function (t, i) {
      var s = document.createElement('section'); s.className = 'ap-item';
      s.innerHTML = '<button class="ap-t"><span>' + (i + 1) + '</span>' + t[0] + '</button><div class="ap-b" hidden></div>';
      var body = $('.ap-b', s), done = false;
      $('.ap-t', s).onclick = function () { body.hidden = !body.hidden; if (!body.hidden && !done) { done = true; t[1](body); } };
      list.appendChild(s);
    });
    d.onclick = function (e) { if (e.target === d || e.target.className === 'ap-x') d.remove(); };
    document.body.appendChild(d);
  }

  function mountBtn() {
    var u = me(), b = $('#ap-fab');
    if (!u || u.role !== 'admin') { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('button'); b.id = 'ap-fab'; b.type = 'button'; b.textContent = 'Admin+'; b.onclick = open; document.body.appendChild(b);
  }
  mountBtn(); setInterval(mountBtn, 2000);
})();
