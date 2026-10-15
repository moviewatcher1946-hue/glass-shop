// Snackify AI "spotlight": one assistant on every page. Always visible (no close button on the launcher),
// opens with Ctrl+K / Cmd+K or by tapping the bar. Two tabs: Ask (chat, order, inquire, admin actions) and Dashboard (its own page).
(function () {
  'use strict';
  if (window.__spotlight) return; window.__spotlight = true;

  var LS = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var LSET = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var LDEL = function (k) { try { localStorage.removeItem(k); } catch (e) {} };
  var me = function () { try { return JSON.parse(LS('user') || 'null'); } catch (e) { return null; } };
  var HIST_KEY = 'spot_hist';
  var MAX_HIST = 40;

  function api(url, method, body) {
    var h = {}; var t = LS('token'); if (t) h.Authorization = 'Bearer ' + t;
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; }); });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function history() { try { return JSON.parse(LS(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(list) { LSET(HIST_KEY, JSON.stringify(list.slice(-MAX_HIST))); }

  // ---------- styles
  var css = document.createElement('style');
  css.textContent = [
    '#sp-dock{position:fixed;right:16px;bottom:calc(16px + var(--bn,0px) + var(--sa,0px) + var(--cb,0px));z-index:46;display:flex;align-items:center;gap:8px;',
    'min-height:0;padding:11px 18px 11px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.4);color:#fff;font:700 14px system-ui,-apple-system,sans-serif;cursor:pointer;',
    'background:linear-gradient(120deg,rgba(94,92,230,.85),rgba(10,132,255,.8) 50%,rgba(191,90,242,.8));background-size:200% 200%;animation:spGrad 9s ease infinite;',
    'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 14px 40px rgba(10,132,255,.35);max-width:calc(100vw - 24px);white-space:nowrap}',
    '#sp-dock .orb{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,rgba(255,255,255,.2) 60%,transparent 70%);animation:spPulse 2.4s ease-in-out infinite;flex:0 0 auto}',
    '#sp-dock kbd{font:600 11px ui-monospace,monospace;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.22)}',
    '#sp-dock span.t{overflow:hidden;text-overflow:ellipsis}',
    '@keyframes spGrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
    '@keyframes spPulse{0%,100%{transform:scale(1);opacity:.95}50%{transform:scale(1.12);opacity:1}}',
    '@keyframes spIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}',
    '#sp-wrap{position:fixed;inset:0;z-index:9600;display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px 12px;background:rgba(10,10,16,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '#sp-panel{width:min(760px,100%);max-height:88vh;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;color:#1d1d1f;background:rgba(250,250,252,.86);border:1px solid rgba(255,255,255,.5);box-shadow:0 30px 80px rgba(0,0,0,.35);backdrop-filter:blur(28px) saturate(1.4);-webkit-backdrop-filter:blur(28px) saturate(1.4);font:15px system-ui,-apple-system,sans-serif;animation:spIn .28s ease both}',
    '@media(prefers-color-scheme:dark){#sp-panel{color:#f2f2f4;background:rgba(28,28,34,.86);border-color:rgba(255,255,255,.12)}}',
    'html[data-theme="dark"] #sp-panel{color:#f2f2f4;background:rgba(28,28,34,.86);border-color:rgba(255,255,255,.12)}',
    'html[data-theme="light"] #sp-panel{color:#1d1d1f;background:rgba(250,250,252,.86)}',
    '#sp-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(128,128,128,.22)}',
    '#sp-top .brand{font-weight:800;letter-spacing:.2px;flex:1;display:flex;align-items:center;gap:8px}',
    '#sp-top .brand i{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,#0a84ff 70%);display:inline-block;animation:spPulse 2.4s ease-in-out infinite}',
    '.sp-tabs{display:flex;gap:4px;padding:4px;border-radius:12px;background:rgba(128,128,128,.14)}',
    '.sp-tabs button{border:0;background:none;color:inherit;font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:9px;cursor:pointer;opacity:.7}',
    '.sp-tabs button[aria-selected="true"]{background:rgba(255,255,255,.9);color:#1d1d1f;opacity:1;box-shadow:0 2px 8px rgba(0,0,0,.12)}',
    '@media(prefers-color-scheme:dark){.sp-tabs button[aria-selected="true"]{background:rgba(255,255,255,.16);color:#fff}}',
    'html[data-theme="dark"] .sp-tabs button[aria-selected="true"]{background:rgba(255,255,255,.16);color:#fff}',
    '#sp-x{border:0;background:rgba(128,128,128,.16);color:inherit;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px}',
    '#sp-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:260px}',
    '.sp-msg{max-width:86%;padding:10px 13px;border-radius:16px;line-height:1.42;white-space:pre-wrap;word-break:break-word;animation:spIn .2s ease both}',
    '.sp-msg.me{align-self:flex-end;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#fff;border-bottom-right-radius:6px}',
    '.sp-msg.ai{align-self:flex-start;background:rgba(128,128,128,.13);border-bottom-left-radius:6px}',
    '.sp-msg.err{align-self:flex-start;background:rgba(229,72,77,.14);color:#c4252a}',
    '.sp-dots{display:inline-flex;gap:4px}.sp-dots i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.3;animation:spDot 1.1s infinite}.sp-dots i:nth-child(2){animation-delay:.15s}.sp-dots i:nth-child(3){animation-delay:.3s}',
    '@keyframes spDot{0%,100%{opacity:.25}50%{opacity:1}}',
    '.sp-act{align-self:flex-start;max-width:90%;border:1px solid rgba(10,132,255,.45);border-radius:14px;padding:10px 12px;background:rgba(10,132,255,.08);display:flex;flex-direction:column;gap:8px}',
    '.sp-act .row{display:flex;gap:8px}.sp-act button{border:0;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;background:#0a84ff;color:#fff}',
    '.sp-act button.no{background:rgba(128,128,128,.2);color:inherit}',
    '#sp-chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 10px}',
    '#sp-chips button{border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.08);color:inherit;border-radius:999px;padding:6px 12px;font:500 13px system-ui,sans-serif;cursor:pointer}',
    '#sp-foot{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(128,128,128,.22)}',
    '#sp-in{flex:1;resize:none;height:46px;max-height:140px;padding:11px 13px;border-radius:14px;border:1px solid rgba(128,128,128,.35);background:rgba(255,255,255,.7);color:inherit;font:inherit}',
    '@media(prefers-color-scheme:dark){#sp-in{background:rgba(255,255,255,.08)}}',
    'html[data-theme="dark"] #sp-in{background:rgba(255,255,255,.08)}',
    '#sp-send{border:0;border-radius:14px;padding:0 18px;background:#0a84ff;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}',
    '#sp-send:disabled{opacity:.5;cursor:default}',
    '#sp-dash{padding:16px;display:grid;gap:14px;overflow-y:auto}',
    '#sp-dash h3{margin:0 0 4px;font-size:15px}#sp-dash .muted{opacity:.65;font-size:13px}',
    '.sp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.sp-card{border-radius:16px;padding:14px;background:rgba(128,128,128,.11);border:1px solid rgba(128,128,128,.18);display:flex;flex-direction:column;gap:6px;text-align:left;color:inherit;font:inherit;cursor:pointer}',
    '.sp-card b{font-size:22px}.sp-card span{font-size:13px;opacity:.75}',
    '.sp-list button{display:block;width:100%;text-align:left;border:0;background:rgba(128,128,128,.09);color:inherit;border-radius:12px;padding:10px 12px;margin-bottom:6px;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sp-empty{padding:18px;text-align:center;opacity:.7}',
    '@media(max-width:600px){#sp-dock kbd{display:none}#sp-dock{padding:11px 14px 11px 10px}#sp-wrap{padding:0;align-items:stretch}#sp-panel{width:100%;max-height:none;height:100%;border-radius:0}}'
  ].join('');
  document.head.appendChild(css);

  // ---------- launcher (always on screen)
  var dock = el('button'); dock.id = 'sp-dock'; dock.type = 'button';
  dock.setAttribute('aria-label', 'Ask Snackify AI (Ctrl+K)');
  dock.appendChild(el('span', 'orb'));
  dock.appendChild(el('span', 't', 'Ask AI'));
  var kbd = el('kbd', '', '\u2318K'); if (!/Mac|iPhone|iPad/.test(navigator.platform || '')) kbd.textContent = 'Ctrl K';
  dock.appendChild(kbd);
  dock.onclick = function () { open('ask'); };

  // Same line as Admin+: measured from its button, placed just to its left. Without Admin+ it sits in the same bottom corner.
  function placeDock() {
    if (!dock.isConnected) document.body.appendChild(dock);
    var ref = document.getElementById('ap-fab'), r = ref && ref.getBoundingClientRect();
    if (r && r.width) {
      dock.style.bottom = Math.round(innerHeight - r.bottom) + 'px';
      dock.style.right = Math.round(innerWidth - r.left + 8) + 'px';
    } else {
      dock.style.bottom = 'calc(16px + var(--bn,0px) + var(--sa,0px) + var(--cb,0px))';
      dock.style.right = '16px';
    }
  }
  placeDock();
  setInterval(placeDock, 1000);
  window.addEventListener('resize', placeDock);

  // ---------- panel
  var wrap = null, tab = 'ask', busy = false, pending = null;

  function open(which) {
    if (wrap) { if (which) { tab = which; render(); } return; }
    wrap = el('div'); wrap.id = 'sp-wrap';
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    tab = which || tab;
    render();
    setTimeout(function () { var i = document.getElementById('sp-in'); if (i && tab === 'ask') i.focus(); }, 60);
  }
  function close() { if (wrap) wrap.remove(); wrap = null; }

  function signedIn() { return !!(LS('token') && me()); }
  function isAdmin() { var u = me(); return !!(u && u.role === 'admin'); }

  function render() {
    if (!wrap) return;
    wrap.textContent = '';
    var panel = el('div'); panel.id = 'sp-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Snackify AI');
    var top = el('div'); top.id = 'sp-top';
    var brand = el('div', 'brand'); brand.appendChild(el('i')); brand.appendChild(document.createTextNode('Snackify AI'));
    top.appendChild(brand);
    var tabs = el('div', 'sp-tabs');
    [['ask', 'Ask'], ['dash', 'Dashboard']].forEach(function (t) {
      var b = el('button', '', t[1]); b.type = 'button'; b.setAttribute('aria-selected', String(tab === t[0]));
      b.onclick = function () { tab = t[0]; render(); }; tabs.appendChild(b);
    });
    top.appendChild(tabs);
    var x = el('button', '', '\u00D7'); x.id = 'sp-x'; x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = close; top.appendChild(x);
    panel.appendChild(top);
    if (tab === 'dash') renderDash(panel); else renderAsk(panel);
    wrap.appendChild(panel);
  }

  // ---------- Ask tab
  function renderAsk(panel) {
    var body = el('div'); body.id = 'sp-body';
    var hist = history();
    if (!hist.length) {
      body.appendChild(el('div', 'sp-msg ai', signedIn()
        ? (isAdmin()
          ? 'Hi! I am your AI assistant for the shop. Ask about sales, stock, orders or customers, or tell me to do something and I will ask you to confirm first.'
          : 'Hi! I can help with products, stock, prices, ordering, your orders, delivery and anything else you need. What can I do for you?')
        : 'Sign in to use the assistant. Once you are signed in, it can check products, take your order and answer questions.'));
    }
    hist.forEach(function (m) { renderMsg(body, m); });
    panel.appendChild(body);

    var chipsWrap = el('div'); chipsWrap.id = 'sp-chips';
    var chips = isAdmin()
      ? ['What am I looking at?', 'What needs my attention today?', 'Which items are low on stock?', 'Summarize today\u2019s sales', 'Show pending orders']
      : ['What am I looking at?', 'What is popular right now?', 'Track my latest order', 'Help me order a snack', 'Cancel my latest order', 'Talk to the shop team'];
    chips.forEach(function (c) { var b = el('button', '', c); b.type = 'button'; b.onclick = function () { send(c); }; chipsWrap.appendChild(b); });
    if (!hist.length || signedIn()) panel.appendChild(chipsWrap);

    var foot = el('div'); foot.id = 'sp-foot';
    var input = el('textarea'); input.id = 'sp-in'; input.rows = 1; input.maxLength = 2000;
    input.placeholder = signedIn() ? 'Ask anything, or tell me what you need\u2026' : 'Sign in to ask';
    input.disabled = !signedIn();
    input.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } };
    var go = el('button', '', 'Send'); go.id = 'sp-send'; go.type = 'button'; go.disabled = !signedIn();
    go.onclick = function () { send(input.value); };
    foot.appendChild(input); foot.appendChild(go);
    panel.appendChild(foot);
    setTimeout(function () { body.scrollTop = body.scrollHeight; }, 0);
    if (busy) showThinking(body);
    if (pending) renderActions(body, pending);
  }

  function renderMsg(parent, m) {
    var d = el('div', 'sp-msg ' + (m.role === 'user' ? 'me' : m.error ? 'err' : 'ai'), m.content);
    parent.appendChild(d);
  }
  function showThinking(body) {
    var d = el('div', 'sp-msg ai'); var dots = el('span', 'sp-dots'); dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
    d.appendChild(dots); d.id = 'sp-think'; body.appendChild(d); body.scrollTop = body.scrollHeight;
  }
  function renderActions(body, list) {
    list.forEach(function (a) {
      var box = el('div', 'sp-act'); box.appendChild(el('div', '', a.summary));
      var typed = null;
      if (a.phrase) { typed = el('input'); typed.type = 'text'; typed.placeholder = 'Type exactly: ' + a.phrase; typed.setAttribute('aria-label', 'Type ' + a.phrase + ' to confirm'); typed.style.cssText = 'padding:8px 10px;border-radius:10px;border:1px solid rgba(128,128,128,.4);background:rgba(255,255,255,.7);color:inherit;font:inherit'; box.appendChild(typed); }
      var row = el('div', 'row');
      var yes = el('button', '', 'Confirm'); yes.type = 'button';
      var no = el('button', 'no', 'Cancel'); no.type = 'button';
      var done = function (msg) { box.textContent = ''; box.appendChild(el('div', '', msg)); };
      var fail = function (e) { yes.disabled = no.disabled = false; var n = el('div', '', e.message); box.appendChild(n); };
      yes.onclick = function () { if (typed && typed.value.trim() !== a.phrase) { fail({ message: 'Type exactly: ' + a.phrase }); return; } yes.disabled = no.disabled = true; confirmAction(a.id, true, typed ? typed.value : '').then(done, fail); };
      no.onclick = function () { yes.disabled = no.disabled = true; confirmAction(a.id, false, '').then(done, fail); };
      row.appendChild(yes); row.appendChild(no); box.appendChild(row); body.appendChild(box);
    });
    body.scrollTop = body.scrollHeight;
  }
  function confirmAction(id, ok, typed) {
    return api('/api/ai/confirm', 'POST', { id: id, ok: ok, typed: typed || '' }).then(function (r) { return r.message || 'Done.'; });
  }

  // What is on screen right now. Reads the app's own variables (view, cart, searchText, catFilter) and the open product window, if any.
  function screenContext() {
    var s = {};
    try {
      s.page = typeof view !== 'undefined' ? view : 'shop';
      s.search = typeof searchText !== 'undefined' ? searchText : '';
      s.category = typeof catFilter !== 'undefined' ? catFilter : 'all';
      s.cart = typeof cart !== 'undefined' && cart ? Object.keys(cart).map(function (id) { return { id: Number(id), qty: Number(cart[id]) }; }) : [];
    } catch (e) { /* the app may not be ready yet */ }
    var d = document.querySelector('#dlg[open]');
    if (d) s.dialog = (d.innerText || d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    return s;
  }

  // Opens a page of the site the way a person would: the app's own nav button. Then the panel steps aside.
  function goTo(page) {
    var b = document.querySelector('#nav [data-act="' + page + '"]') || document.querySelector('[data-act="' + page + '"]');
    if (!b) return false;
    close(); b.click(); return true;
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || busy || !signedIn()) return;
    var hist = history();
    var prior = hist.slice(-10).map(function (m) { return { role: m.role, content: m.content }; });
    hist.push({ role: 'user', content: text, at: Date.now() });
    saveHistory(hist);
    busy = true; pending = null; render();
    api('/api/ai/ask', 'POST', { message: text, history: prior, screen: screenContext() }).then(function (r) {
      var h = history();
      h.push({ role: 'assistant', content: r.reply || 'I could not find an answer to that.', actions: r.actions || [], at: Date.now() });
      saveHistory(h);
      pending = (r.actions && r.actions.length) ? r.actions : null;
      busy = false; render();
      if (r.navigate) goTo(r.navigate);
    }).catch(function (e) {
      var h = history();
      h.push({ role: 'assistant', content: e.message || 'The AI could not answer right now.', error: true, at: Date.now() });
      saveHistory(h); busy = false; render();
    });
  }

  // ---------- Dashboard tab
  function renderDash(panel) {
    var dash = el('div'); dash.id = 'sp-dash'; panel.appendChild(dash);
    var h = el('div'); h.appendChild(el('h3', '', 'Your Snackify AI')); h.appendChild(el('div', 'muted', 'Everything the assistant can do, and what it has been doing for you.'));
    dash.appendChild(h);

    var status = el('div', 'muted', 'Checking status\u2026'); dash.appendChild(status);
    api('/api/ai/status').then(function (s) {
      status.textContent = (s.enabled ? 'Online' : 'Offline: the shop owner has not turned on an AI provider yet.') +
        (s.enabled ? (s.scope === 'shop' ? ' \u00B7 Shop topics only' : ' \u00B7 General help and shop help') : '') +
        (s.ordering === 'on' ? ' \u00B7 Ordering in chat is on' : '');
    }).catch(function () { status.textContent = 'Status unavailable right now.'; });

    var grid = el('div', 'sp-grid'); dash.appendChild(grid);
    var quick = isAdmin()
      ? [['Pending orders', 'Show pending orders'], ['Low stock', 'Which items are low on stock?'], ['Sales today', 'Summarize today\u2019s sales'], ['Customer chats', 'Who is waiting for a reply?']]
      : [['My orders', 'Track my latest order'], ['Popular now', 'What is popular right now?'], ['Start an order', 'Help me order a snack'], ['Shop team', 'Talk to the shop team']];
    quick.forEach(function (q) {
      var c = el('button', 'sp-card'); c.type = 'button'; c.appendChild(el('b', '', isAdmin() && (q[0] === 'Pending orders' || q[0] === 'Low stock' || q[0] === 'Customer chats') ? '\u2026' : '')); c.appendChild(el('span', '', q[1]));
      c.onclick = function () { tab = 'ask'; render(); setTimeout(function () { send(q[1]); }, 0); };
      grid.appendChild(c);
    });

    if (isAdmin()) {
      var brief = el('div', 'muted', 'Loading the shop brief\u2026'); dash.appendChild(brief);
      api('/api/admin/agent/brief').then(function (b) {
        brief.textContent = '';
        brief.appendChild(document.createTextNode(b.pending_orders + ' pending order(s) \u00B7 ' + b.unread_chats + ' customer chat(s) waiting \u00B7 ' + b.handoffs + ' handed to the team \u00B7 ' + b.low_stock + ' low or sold-out item(s)'));
        var nums = grid.querySelectorAll('.sp-card b');
        var vals = [b.pending_orders, b.low_stock, null, b.unread_chats];
        for (var i = 0; i < nums.length; i++) if (vals[i] != null) nums[i].textContent = String(vals[i]);
      }).catch(function () { brief.textContent = ''; });
    }

    var hd = el('div'); hd.appendChild(el('h3', '', 'Recent conversations'));
    dash.appendChild(hd);
    var list = el('div', 'sp-list'); dash.appendChild(list);
    var recent = history().filter(function (m) { return m.role === 'user'; }).slice(-12).reverse();
    if (!recent.length) list.appendChild(el('div', 'sp-empty', 'No conversations yet. Try asking something from the Ask tab.'));
    recent.forEach(function (m) {
      var b = el('button', '', m.content); b.type = 'button';
      b.title = new Date(m.at || Date.now()).toLocaleString();
      b.onclick = function () { tab = 'ask'; render(); };
      list.appendChild(b);
    });
    if (recent.length) {
      var clear = el('button', 'sp-card', 'Clear history'); clear.type = 'button'; clear.style.alignSelf = 'flex-start';
      clear.onclick = function () { LDEL(HIST_KEY); pending = null; render(); };
      dash.appendChild(clear);
    }
  }

  // ---------- keyboard: Ctrl/Cmd+K opens, Esc closes
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (wrap) close(); else open('ask'); return; }
    if (e.key === 'Escape' && wrap) close();
  });

  // Other scripts can open it: window.SnackifyAI.open('dash') or .ask('some question')
  window.SnackifyAI = { open: open, close: close, ask: function (q) { open('ask'); setTimeout(function () { send(q); }, 50); } };
  // Used by the tutorial's "Ask the guide" box: same AI, returns the text instead of showing the panel.
  window.SnackifyAI.answer = function (q, where) {
    if (!signedIn()) return Promise.reject(new Error('Sign in to ask the guide.'));
    var msg = where ? 'I am on the tutorial step "' + where + '". My question: ' + q : q;
    return api('/api/ai/ask', 'POST', { message: msg, history: [], screen: screenContext() }).then(function (r) { return r.reply || 'No answer came back.'; });
  };
})();
