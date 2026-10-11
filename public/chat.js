// In-site chat. Customers: "Chat" button opens a private conversation with the shop. Staff: "Inbox" button lists customers who wrote.
(function () {
  var LS = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var me = function () { try { return JSON.parse(LS('user') || 'null'); } catch (e) { return null; } };
  function api(url, method, body) {
    var h = { Authorization: 'Bearer ' + (LS('token') || '') }; if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; });
    });
  }
  var css = document.createElement('style');
  css.textContent = '#ch-btn{position:fixed;left:16px;bottom:16px;z-index:9000;padding:11px 16px;border:1px solid rgba(255,255,255,.35);border-radius:12px;background:rgba(30,30,34,.72);color:#fff;font:600 14px system-ui,sans-serif;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:pointer}' +
    '#ch-btn b{margin-left:8px;padding:1px 7px;border-radius:6px;background:#e5484d;font-size:12px}' +
    '#ch-box{position:fixed;left:16px;bottom:68px;z-index:9001;width:min(370px,calc(100vw - 32px));height:min(520px,calc(100vh - 100px));display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.35);border-radius:16px;background:rgba(250,250,252,.82);color:#1d1d1f;font:14px system-ui,sans-serif;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden}' +
    '@media(prefers-color-scheme:dark){#ch-box{background:rgba(28,28,32,.86);color:#f2f2f4;border-color:rgba(255,255,255,.14)}#ch-box .m.o{background:rgba(255,255,255,.12)!important}#ch-box textarea,#ch-box .r{background:rgba(255,255,255,.08)!important;color:#f2f2f4!important}}' +
    '#ch-box header{display:flex;align-items:center;gap:8px;padding:12px 14px;font-weight:700;border-bottom:1px solid rgba(128,128,128,.25)}#ch-box header span{flex:1}#ch-box header button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:4px 8px;border-radius:8px}' +
    '#ch-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}#ch-list .m{max-width:82%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.35}' +
    '#ch-list .m.me{align-self:flex-end;background:#0a84ff;color:#fff}#ch-list .m.o{align-self:flex-start;background:rgba(0,0,0,.07)}#ch-list .m small{display:block;opacity:.6;font-size:11px;margin-top:3px}' +
    '#ch-list .r{display:flex;gap:8px;align-items:center;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:12px;background:rgba(0,0,0,.05);color:inherit;font:inherit;cursor:pointer}#ch-list .r span{flex:1;min-width:0}#ch-list .r em{display:block;font-style:normal;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ch-list .r b.n{padding:1px 7px;border-radius:6px;background:#e5484d;color:#fff;font-size:12px}' +
    '#ch-box footer{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(128,128,128,.25)}#ch-box textarea{flex:1;resize:none;height:42px;padding:9px 10px;border:1px solid rgba(128,128,128,.35);border-radius:10px;background:rgba(255,255,255,.7);color:#1d1d1f;font:inherit}#ch-box footer button{padding:0 16px;border:0;border-radius:10px;background:#0a84ff;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}' +
    '#ch-note{padding:6px 12px;font-size:12px;opacity:.65}';
  document.head.appendChild(css);

  var btn = null, box = null, staff = false, uid = null, uname = '', last = 0, view = 'list', unread = 0, timer = null, sending = false;
  var el = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  var hhmm = function (s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

  function setBadge(n) { unread = n; if (btn) { btn.textContent = staff ? 'Inbox' : 'Chat'; if (n > 0) btn.appendChild(el('b', '', n > 9 ? '9+' : String(n))); } }
  function pollUnread() { if (box || document.hidden || !LS('token')) return; api(staff ? '/api/chat/staff-unread' : '/api/chat/unread').then(function (r) { setBadge(r.n || 0); }).catch(function () {}); }

  function addMsgs(list, msgs) {
    var stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    msgs.forEach(function (m) {
      var mine = staff ? m.from_staff : !m.from_staff, d = el('div', 'm ' + (mine ? 'me' : 'o'), m.body);
      d.appendChild(el('small', '', (staff ? m.sender : (m.from_staff ? 'Shop' : 'You')) + ' - ' + hhmm(m.created_at))); list.appendChild(d); if (m.id > last) last = m.id;
    });
    if (stick || last === 0) list.scrollTop = list.scrollHeight;
  }
  function loadThread(first) {
    var list = document.getElementById('ch-list'); if (!list) return;
    api((staff ? '/api/chat/thread/' + uid : '/api/chat') + '?after=' + last).then(function (r) { if (first) list.textContent = ''; if (r.messages.length) addMsgs(list, r.messages); else if (first) list.appendChild(el('div', 'm o', staff ? 'No messages yet.' : 'Hi! Ask us anything about your order or a product. Please do not share passwords.')); }).catch(function () {});
  }
  function loadInbox() {
    var list = document.getElementById('ch-list'); if (!list || view !== 'list') return;
    api('/api/chat/inbox').then(function (rows) {
      list.textContent = ''; if (!rows.length) list.appendChild(el('div', 'm o', 'No messages from customers yet.'));
      rows.forEach(function (r) { var b = el('button', 'r'), s = el('span'); s.appendChild(document.createTextNode(r.username)); s.appendChild(el('em', '', (r.from_staff ? 'You: ' : '') + r.last)); b.appendChild(s); if (r.unread) b.appendChild(el('b', 'n', String(r.unread))); b.onclick = function () { openThread(r.id, r.username); }; list.appendChild(b); });
    }).catch(function () {});
  }
  function frame(title, back) {
    box.textContent = ''; var h = el('header'); if (back) { var bb = el('button', '', 'Back'); bb.onclick = function () { view = 'list'; render(); }; h.appendChild(bb); }
    h.appendChild(el('span', '', title)); var x = el('button', '', 'Close'); x.onclick = closeBox; h.appendChild(x); box.appendChild(h);
    var list = el('div'); list.id = 'ch-list'; box.appendChild(list);
  }
  function composer() {
    var f = el('footer'), t = el('textarea'), s = el('button', '', 'Send'); t.placeholder = 'Write a message'; t.maxLength = 1000;
    function send() { var v = t.value.trim(); if (!v || sending) return; sending = true; api(staff ? '/api/chat/thread/' + uid : '/api/chat', 'POST', { body: v }).then(function () { t.value = ''; loadThread(false); }).catch(function (e) { var l = document.getElementById('ch-list'); if (l) { l.appendChild(el('div', 'm o', e.message)); l.scrollTop = l.scrollHeight; } }).then(function () { sending = false; });  }
    s.onclick = send; t.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }; f.appendChild(t); f.appendChild(s); box.appendChild(f); setTimeout(function () { t.focus(); }, 50);
  }
  function openThread(id, name) { uid = id; uname = name; view = 'thread'; last = 0; render(); }
  function render() {
    clearInterval(timer);
    if (staff && view === 'list') { frame('Customer messages'); loadInbox(); timer = setInterval(loadInbox, 8000); return; }
    frame(staff ? uname : 'Message the shop', staff); last = 0; loadThread(true); composer();
    timer = setInterval(function () { if (!document.hidden) loadThread(false); }, 4000);
  }
  function closeBox() { clearInterval(timer); if (box) box.remove(); box = null; pollUnread(); }
  function toggle() { if (box) return closeBox(); box = el('div'); box.id = 'ch-box'; document.body.appendChild(box); view = 'list'; setBadge(0); render(); }

  // The button appears only while someone is signed in (the shop is a single page, so this is checked regularly).
  setInterval(function () {
    var u = me(), on = !!(u && LS('token'));
    if (on && !btn) { staff = u.role !== 'customer'; btn = el('button'); btn.id = 'ch-btn'; btn.type = 'button'; btn.onclick = toggle; document.body.appendChild(btn); setBadge(0); pollUnread(); }
    if (!on && btn) { closeBox(); btn.remove(); btn = null; }
  }, 2000);
  setInterval(pollUnread, 30000);
})();
