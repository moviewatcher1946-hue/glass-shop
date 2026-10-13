// Messages: send and receive private messages with anyone on the shop (customers, sellers, the admin) plus the shop support thread.
// Button "Messages" bottom-left while signed in. Ctrl+Shift+M opens it. All text is inserted with textContent (never as HTML).
(function () {
  'use strict';
  var LS = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var LSset = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  var me = function () { try { return JSON.parse(LS('user') || 'null'); } catch (e) { return null; } };
  var P = { sound: true, enter: true, theme: 'auto', accent: '#0a84ff', font: 14, compact: false, desk: false, big: false, mic: true, speak: true, wake: false, lang: 'en-US', live: true };
  try { Object.assign(P, JSON.parse(LS('mg_prefs') || '{}')); } catch (e) { /* ignore */ }
  var savePrefs = function () { LSset('mg_prefs', JSON.stringify(P)); };
  var EMOJI = ['😀', '😄', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😉', '🙂', '😢', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🙌', '👋', '🤝', '❤️', '💔', '🔥', '✨', '🎉', '🎁', '🥤', '🍿', '🍫', '🍪', '🍕', '🍔', '☕', '🧋', '🍩', '🍦', '✅', '❌', '⭐', '💯', '📦', '🚚', '💸', '🕐'];
  var REACT = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];
  var ACCENTS = ['#0a84ff', '#30b06b', '#e5484d', '#8e5cf7', '#f08c1a', '#e5489b'];

  function api(url, method, body) {
    var h = { Authorization: 'Bearer ' + (LS('token') || '') }; if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var er = new Error(d.error || 'Something went wrong.'); er.http = r.status; throw er; } return d; });
    });
  }
  var el = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  var hhmm = function (s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  var dayKey = function (s) { var d = new Date(s); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  var dayLabel = function (s) { var d = new Date(s), n = new Date(); if (dayKey(d) === dayKey(n)) return 'Today'; n.setDate(n.getDate() - 1); if (dayKey(d) === dayKey(n)) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  var shortTime = function (s) { if (!s) return ''; var d = new Date(s); return dayKey(d) === dayKey(new Date()) ? hhmm(s) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  var hue = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  var ROLE = { admin: 'Admin', seller: 'Seller', shop: '', customer: '' };

  // Clean line icons instead of emoji glyphs
  var SV = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'; };
  var IC = {
    edit: SV('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
    search: SV('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    star: SV('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    gear: SV('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
    more: SV('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    smile: SV('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
    camera: SV('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>'),
    bolt: SV('<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>'),
    clock: SV('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    back: SV('<path d="M15 18l-6-6 6-6"/>'),
    close: SV('<path d="M18 6L6 18M6 6l12 12"/>'),
    send: SV('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
    chat: SV('<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.8 8.8 0 01-3.6-.8L3 21l1.9-5.1A8.4 8.4 0 1121 11.5z"/>')
  };
  var GLYPH = { '\u270E': 'edit', '\uD83D\uDD0D': 'search', '\u2605': 'star', '\u2699': 'gear', '\u22EF': 'more', '\uD83D\uDE0A': 'smile', '\uD83D\uDCF7': 'camera', '\u26A1': 'bolt', '\u23F0': 'clock', '\u2190': 'back', '\u2715': 'close' };
  function iconize(root) {
    if (!root) return;
    var bs = root.querySelectorAll('button.ib');
    for (var i = 0; i < bs.length; i++) { var k = !bs[i].children.length && GLYPH[bs[i].textContent.trim()]; if (k) bs[i].innerHTML = IC[k]; }
  }

  var css = el('style');
  css.textContent = [
    '#mg-btn{position:fixed;left:16px;bottom:16px;z-index:9000;padding:11px 16px;border:1px solid rgba(255,255,255,.35);border-radius:12px;background:rgba(30,30,34,.72);color:#fff;font:600 14px system-ui,sans-serif;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:pointer}',
    '#mg-btn b{margin-left:8px;padding:1px 7px;border-radius:6px;background:#e5484d;font-size:12px}',
    '#mg-box{--a:#0a84ff;--fs:14px;position:fixed;left:16px;bottom:68px;z-index:9001;width:min(390px,calc(100vw - 32px));height:min(600px,calc(100vh - 100px));display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.35);border-radius:16px;background:rgba(250,250,252,.9);color:#1d1d1f;font:var(--fs)/1.35 system-ui,sans-serif;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden}',
    '#mg-box.big{width:min(760px,calc(100vw - 32px));height:calc(100vh - 100px)}',
    '#mg-box.dk{background:rgba(28,28,32,.94);color:#f2f2f4;border-color:rgba(255,255,255,.14)}',
    '#mg-box button,#mg-box input,#mg-box textarea,#mg-box select{font:inherit;color:inherit}',
    '#mg-box header{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.25)}',
    '#mg-box header .t{flex:1;min-width:0;font-weight:700}#mg-box header .t small{display:block;font-weight:400;opacity:.65;font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mg-box .ib{border:0;background:none;cursor:pointer;padding:5px 8px;border-radius:8px;font-size:1.05em;line-height:1}#mg-box .ib:hover{background:rgba(128,128,128,.18)}',
    '.mg-av{flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;position:relative}.mg-av.s{width:30px;height:30px;font-size:.9em}',
    '.mg-av i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:#30b06b;border:2px solid #fff}#mg-box.dk .mg-av i{border-color:#1c1c20}',
    '.mg-tag{margin-left:6px;padding:0 6px;border-radius:5px;background:rgba(128,128,128,.25);font-size:.75em;font-weight:600;vertical-align:1px}',
    '#mg-box .tabs{display:flex;gap:6px;padding:8px 12px 0;overflow-x:auto}#mg-box .tabs button{flex:none;padding:4px 11px;border:0;border-radius:99px;background:rgba(128,128,128,.16);cursor:pointer;font-size:.9em}#mg-box .tabs button.on{background:var(--a);color:#fff}',
    '#mg-box .find{margin:8px 12px 0;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:10px;background:rgba(128,128,128,.1);outline:0}',
    '#mg-body{flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:6px;position:relative}',
    '#mg-box.cp #mg-body{gap:2px}',
    '.mg-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:12px;background:rgba(128,128,128,.08);cursor:pointer}.mg-row:hover{background:rgba(128,128,128,.16)}',
    '.mg-row .x{flex:1;min-width:0}.mg-row .x b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mg-row .x em{display:block;font-style:normal;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.92em}',
    '.mg-row .r{text-align:right;font-size:.78em;opacity:.8;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}.mg-n{padding:0 7px;border-radius:99px;background:var(--a);color:#fff;font-weight:700;font-size:1.05em}',
    '.mg-day{align-self:center;margin:8px 0 2px;padding:2px 10px;border-radius:99px;background:rgba(128,128,128,.2);font-size:.78em;opacity:.85}',
    '.mg-new{align-self:stretch;text-align:center;font-size:.78em;color:var(--a);border-top:1px solid var(--a);margin:8px 0 2px;line-height:0}.mg-new span{background:inherit;padding:0 8px}',
    '.mg-m{max-width:84%;padding:7px 10px;border-radius:14px;white-space:pre-wrap;word-break:break-word;cursor:pointer;position:relative}',
    '.mg-m.me{align-self:flex-end;background:var(--a);color:#fff;border-bottom-right-radius:5px}.mg-m.o{align-self:flex-start;background:rgba(128,128,128,.18);border-bottom-left-radius:5px}',
    '.mg-m.g{margin-top:-3px}.mg-m a{color:inherit;text-decoration:underline}.mg-m.del{opacity:.6;font-style:italic}.mg-m.fail{outline:2px solid #e5484d}.mg-m.hl{animation:mghl 1.4s}@keyframes mghl{30%{box-shadow:0 0 0 4px var(--a)}}',
    '.mg-m img{display:block;max-width:100%;max-height:260px;border-radius:10px;cursor:zoom-in}',
    '.mg-m .q{margin:0 0 5px;padding:4px 8px;border-left:3px solid rgba(255,255,255,.7);border-radius:6px;background:rgba(0,0,0,.14);font-size:.88em;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.mg-m.o .q{border-left-color:var(--a);background:rgba(128,128,128,.18)}.mg-m .f{font-size:.78em;opacity:.75;margin-bottom:2px}',
    '.mg-m .meta{display:flex;gap:6px;justify-content:flex-end;font-size:.72em;opacity:.7;margin-top:2px}.mg-m .meta .rd{color:#9fe0ff;font-weight:700}',
    '.mg-rx{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}.mg-rx span{padding:0 6px;border-radius:99px;background:rgba(0,0,0,.2);font-size:.85em}.mg-rx span.my{outline:1px solid #fff}',
    '.mg-pin{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.08);font-size:.9em;cursor:pointer}.mg-pin span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mg-bar{padding:6px 12px;font-size:.82em;background:rgba(229,72,77,.15);text-align:center}.mg-note{padding:10px 12px;text-align:center;font-size:.9em;opacity:.8}',
    '#mg-box footer{border-top:1px solid rgba(128,128,128,.25);padding:8px 10px}',
    '#mg-box footer .ctx{display:flex;gap:8px;align-items:center;margin-bottom:6px;padding:4px 8px;border-left:3px solid var(--a);background:rgba(128,128,128,.14);border-radius:6px;font-size:.88em}#mg-box footer .ctx span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mg-box footer .cm{display:flex;gap:6px;align-items:flex-end}#mg-box textarea{flex:1;resize:none;height:40px;max-height:120px;padding:9px 10px;border:1px solid rgba(128,128,128,.35);border-radius:10px;background:rgba(128,128,128,.1);outline:0}',
    '#mg-box .snd{padding:0 14px;height:40px;border:0;border-radius:10px;background:var(--a);color:#fff;font-weight:700;cursor:pointer}#mg-box .cnt{font-size:.75em;opacity:.65;text-align:right;margin-top:3px}',
    '.mg-menu{position:absolute;z-index:5;min-width:170px;padding:6px;border-radius:12px;background:rgba(250,250,252,.98);color:#1d1d1f;box-shadow:0 10px 30px rgba(0,0,0,.3);display:flex;flex-direction:column}#mg-box.dk .mg-menu{background:rgba(44,44,50,.98);color:#f2f2f4}',
    '.mg-menu button{border:0;background:none;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer}.mg-menu button:hover{background:rgba(128,128,128,.2)}.mg-menu .d{color:#e5484d}.mg-menu .rr{display:flex;gap:2px;padding:2px 2px 6px}.mg-menu .rr button{padding:4px 5px;font-size:1.2em}',
    '.mg-toast{position:absolute;left:50%;top:60px;transform:translateX(-50%);z-index:8;padding:8px 14px;border-radius:10px;background:rgba(30,30,34,.95);color:#fff;pointer-events:none;font-size:.9em;max-width:90%}',
    '.mg-pop{position:absolute;inset:0;z-index:6;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}.mg-card{width:100%;max-height:100%;overflow:auto;padding:14px;border-radius:14px;background:rgba(250,250,252,.99);color:#1d1d1f}#mg-box.dk .mg-card{background:rgba(40,40,46,.99);color:#f2f2f4}',
    '.mg-card h3{margin:0 0 8px;font-size:1.05em}.mg-card .row{display:flex;gap:8px;align-items:center;margin-top:8px}.mg-card input,.mg-card textarea,.mg-card select{padding:7px 9px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:rgba(128,128,128,.1);width:100%;box-sizing:border-box}.mg-card textarea{height:70px;resize:vertical}',
    '.mg-card button.p{padding:7px 14px;border:0;border-radius:8px;background:var(--a);color:#fff;font-weight:600;cursor:pointer}.mg-card button.s{padding:7px 14px;border:0;border-radius:8px;background:rgba(128,128,128,.25);cursor:pointer}',
    '.mg-emo{display:grid;grid-template-columns:repeat(8,1fr);gap:2px}.mg-emo button{border:0;background:none;font-size:1.4em;padding:4px;border-radius:8px;cursor:pointer}.mg-emo button:hover{background:rgba(128,128,128,.2)}',
    '.mg-set h4{margin:14px 0 4px;font-size:.8em;text-transform:uppercase;letter-spacing:.06em;opacity:.65}.mg-set .st{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(128,128,128,.18)}.mg-set .st>div{flex:1}.mg-set .st small{display:block;opacity:.65}',
    '.mg-set input[type=checkbox]{width:20px;height:20px;accent-color:var(--a)}.mg-set select,.mg-set input[type=text],.mg-set textarea{padding:6px 8px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:rgba(128,128,128,.1)}.mg-set textarea{width:100%;box-sizing:border-box;height:60px}',
    '.mg-sw{display:flex;gap:8px}.mg-sw button{width:24px;height:24px;border-radius:50%;border:2px solid transparent;cursor:pointer}.mg-sw button.on{border-color:currentColor}',
    '.mg-tbl{width:100%;border-collapse:collapse;font-size:.9em}.mg-tbl td{padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.2)}.mg-tbl td:last-child{text-align:right;font-weight:600}',
    '.mg-set .btn{padding:6px 12px;border:0;border-radius:8px;background:rgba(128,128,128,.25);cursor:pointer;margin:4px 6px 4px 0}.mg-set .btn.p{background:var(--a);color:#fff}',
    '.mg-jump{position:sticky;bottom:6px;align-self:center;padding:5px 12px;border:0;border-radius:99px;background:var(--a);color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)}',
    '.mg-lb{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out}.mg-lb img{max-width:94vw;max-height:94vh;border-radius:8px}',
    '@media(max-width:520px){#mg-box,#mg-box.big{left:0;right:0;top:0;bottom:0;width:auto;height:auto;border-radius:0}}',
    `:where(#mg-box) button{border:0;box-shadow:none;min-height:0;overflow:visible;animation:none;transform:none;-webkit-backdrop-filter:none;backdrop-filter:none}`,
    `#mg-box button:hover,#mg-box button:active{transform:none;box-shadow:none}`,
    `#mg-btn{width:54px;height:54px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:#0a84ff;color:#fff;font-size:0;overflow:visible;box-shadow:0 8px 24px rgba(10,132,255,.4),inset 0 1px 0 rgba(255,255,255,.4);-webkit-backdrop-filter:none;backdrop-filter:none}#mg-btn:hover,#mg-btn:active{transform:none;box-shadow:0 8px 24px rgba(10,132,255,.4),inset 0 1px 0 rgba(255,255,255,.4)}`,
    `#mg-btn svg,#mg-box svg{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}#mg-btn svg{width:26px;height:26px}`,
    `#mg-btn b{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;padding:0 4px;margin:0;border-radius:11px;border:2px solid var(--solid,#fff);background:#e5484d;color:#fff;font-size:11px;font-weight:700;text-align:center;box-sizing:content-box}`,
    `#mg-box{bottom:calc(78px + var(--bn,0px) + var(--sa,0px))!important;border:1px solid var(--edge);border-radius:28px;background:var(--glass);color:var(--txt);font-family:var(--font,system-ui,sans-serif);-webkit-backdrop-filter:blur(var(--blur,22px)) saturate(1.4);backdrop-filter:blur(var(--blur,22px)) saturate(1.4);box-shadow:var(--sh2)}#mg-box.dk{background:var(--glass);color:var(--txt);border-color:var(--edge)}`,
    `#mg-box header{padding:16px 14px 12px 20px;border-bottom:1px solid var(--edge);gap:4px}#mg-box header .t{font-size:22px;font-weight:700;letter-spacing:-.02em}#mg-box header .t small{font-size:12px;font-weight:400;opacity:.6;letter-spacing:0}`,
    `#mg-box .ib{width:34px;height:34px;padding:0;border:0;border-radius:50%;display:inline-grid;place-items:center;background:transparent;color:inherit;opacity:.75}#mg-box .ib:hover{background:var(--field);opacity:1}#mg-box .ib svg{width:20px;height:20px}`,
    `#mg-box .ib:not(:has(svg)){width:auto;padding:0 10px;border-radius:8px;font-size:.85em}#mg-box header .ib[title^="Bigger"]{display:none}`,
    `#mg-box .tabs{display:flex;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;margin:0;padding:12px 16px 2px;gap:6px;scrollbar-width:none}#mg-box .tabs::-webkit-scrollbar{display:none}`,
    `#mg-box .tabs button{width:auto;flex:none;margin:0;padding:7px 14px;text-align:center;white-space:nowrap;animation:none;border:1px solid var(--edge);border-radius:999px;background:var(--field);color:var(--txt);font-size:13px;font-weight:600;opacity:.85}#mg-box .tabs button:hover{background:var(--glass2);opacity:1}`,
    `#mg-box .tabs button.on,#mg-box .tabs button.on:hover{background:#0a84ff;color:#fff;border-color:transparent;opacity:1;box-shadow:0 4px 14px rgba(10,132,255,.35),inset 0 1px 0 rgba(255,255,255,.4)}`,
    `#mg-box .find{width:calc(100% - 32px);box-sizing:border-box;margin:10px 16px 6px;padding:10px 16px 10px 40px;border:1px solid var(--edge);border-radius:999px;outline:0;color:var(--txt);background:var(--field) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M21 21l-4.3-4.3'/%3E%3C/svg%3E") no-repeat 14px center/16px}#mg-box .find:focus,#mg-box textarea:focus{box-shadow:0 0 0 3px rgba(10,132,255,.25)}`,
    `#mg-body{padding:4px 12px 12px;gap:6px}#mg-box .mg-row{padding:10px 12px;gap:12px;border:1px solid var(--edge);border-radius:20px;background:var(--field);box-shadow:none}#mg-box .mg-row:hover{background:var(--glass2)}`,
    `.mg-row .mg-av{width:46px;height:46px;font-size:1.1em;box-shadow:0 0 0 2px var(--edge)}.mg-row .x b{font-weight:600;font-size:15px}.mg-row .x em{font-size:13px;opacity:.65}.mg-row .r{font-size:12px;opacity:.6}`,
    `.mg-n{min-width:18px;height:18px;line-height:18px;padding:0 5px;text-align:center;font-size:11px;font-weight:700;background:#0a84ff}`,
    `.mg-day{background:var(--field);border:1px solid var(--edge);opacity:1;color:var(--txt)}`,
    `#mg-body .mg-m{max-width:76%;padding:9px 14px;margin-top:2px;border-radius:20px;font-size:15px;line-height:1.3}`,
    `#mg-body .mg-m.me{background:#0a84ff;color:#fff;box-shadow:0 4px 14px rgba(10,132,255,.28),inset 0 1px 0 rgba(255,255,255,.35);border-bottom-right-radius:20px}#mg-body .mg-m.o{background:var(--glass2);color:var(--txt);border:1px solid var(--edge);border-bottom-left-radius:20px}`,
    `#mg-body .mg-m.me.g{border-top-right-radius:6px}#mg-body .mg-m.o.g{border-top-left-radius:6px}`,
    `#mg-box footer{border-top:1px solid var(--edge);padding:10px 12px 14px}#mg-box footer .cm{gap:4px;align-items:center}#mg-box footer .cm .ib{width:32px;height:32px}#mg-box footer .cm .ib svg{width:19px;height:19px}`,
    `#mg-box textarea{flex:1;min-width:0;width:auto;margin:0;padding:11px 16px;border:1px solid var(--edge);border-radius:999px;background:var(--field);color:var(--txt);font-size:15px}`,
    `#mg-box .cm .snd{width:40px;min-width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center;background:#0a84ff;color:#fff;box-shadow:0 4px 14px rgba(10,132,255,.35),inset 0 1px 0 rgba(255,255,255,.4)}#mg-box .cm .snd svg{width:18px;height:18px}#mg-box .cm .snd:not(:has(svg)){width:auto;padding:0 16px;border-radius:999px}#mg-box .snd:hover{background:#0a84ff;filter:brightness(1.08);box-shadow:0 4px 14px rgba(10,132,255,.35),inset 0 1px 0 rgba(255,255,255,.4)}`,
    `#mg-box .mg-menu,#mg-box.dk .mg-menu,#mg-box .mg-card,#mg-box.dk .mg-card{background:var(--solid,rgba(250,250,252,.98));color:var(--txt);border:1px solid var(--edge)}`
  ].join('');
  document.head.appendChild(css);

  var btn = null, box = null, staff = false, timer = null, sumTimer = null, S = {}, lastUnread = 0, lastNotified = 0, sending = {};
  function say(t) { if (!box) return; var d = el('div', 'mg-toast', t); box.appendChild(d); setTimeout(function () { d.remove(); }, 2300); }
  function isDark() { return P.theme === 'dark' || (P.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function skin() { if (!box) return; box.classList.toggle('dk', isDark()); box.classList.toggle('big', !!P.big); box.classList.toggle('cp', !!P.compact); box.style.setProperty('--a', P.accent); box.style.setProperty('--fs', P.font + 'px'); }
  function avatar(name, small, on) { var a = el('div', 'mg-av' + (small ? ' s' : ''), (name || '?').charAt(0).toUpperCase()); a.style.background = 'hsl(' + hue(name || '') + ',55%,45%)'; if (on) a.appendChild(el('i')); return a; }
  function tag(role) { return ROLE[role] ? el('span', 'mg-tag', ROLE[role]) : null; }
  function ping() { if (!P.sound) return; try { var C = window.AudioContext || window.webkitAudioContext, c = new C(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.12, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .25); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + .25); setTimeout(function () { c.close(); }, 400); } catch (e) { /* no audio */ } }
  function copy(t) { try { navigator.clipboard.writeText(t).then(function () { say('Copied'); }, function () { say('Could not copy'); }); } catch (e) { say('Could not copy'); } }
  function lightbox(src) { var d = el('div', 'mg-lb'), i = el('img'); i.src = src; d.appendChild(i); d.onclick = function () { d.remove(); }; document.body.appendChild(d); }

  // ---------- button, badge, notifications
  function setBadge(n) {
    if (btn) { btn.innerHTML = IC.chat; btn.setAttribute('aria-label', n > 0 ? 'Messages, ' + n + ' unread' : 'Messages'); btn.title = 'Messages'; if (n > 0) btn.appendChild(el('b', '', n > 9 ? '9+' : String(n))); }
    try { if (navigator.setAppBadge) { if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) { /* not supported */ }
  }
  function pollSummary() {
    if (!LS('token') || (document.hidden && !P.desk)) return;
    api('/api/msg/summary').then(function (s) {
      if (s.unread > lastUnread && s.latest && Date.now() - lastNotified > 4000 && !(box && S.view === 'thread')) {
        lastNotified = Date.now(); ping();
        if (P.desk && document.hidden && window.Notification && Notification.permission === 'granted') { try { new Notification('New message from ' + s.latest.from, { body: s.latest.text }); } catch (e) { /* ignore */ } }
      }
      lastUnread = s.unread; setBadge(s.unread);
    }).catch(function () {});
  }

  // ---------- popups and menus
  function closeMenu() { var m = box && box.querySelector('.mg-menu'); if (m) m.remove(); }
  function closePop() { var p = box && box.querySelector('.mg-pop'); if (p) p.remove(); }
  function pop(build) {
    closePop(); var o = el('div', 'mg-pop'), c = el('div', 'mg-card'); o.appendChild(c); o.onclick = function (e) { if (e.target === o) o.remove(); }; build(c, function () { o.remove(); }); box.appendChild(o); return c;
  }
  function menu(items, ev, top) {
    closeMenu(); var m = el('div', 'mg-menu'); if (top) m.appendChild(top);
    items.forEach(function (it) { if (!it) return; var b = el('button', it.d ? 'd' : '', it.t); b.onclick = function () { closeMenu(); it.f(); }; m.appendChild(b); });
    box.appendChild(m); var r = box.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    m.style.left = Math.max(6, Math.min(x, r.width - m.offsetWidth - 6)) + 'px'; m.style.top = Math.max(6, Math.min(y, r.height - m.offsetHeight - 6)) + 'px';
    setTimeout(function () { document.addEventListener('click', closeMenu, { once: true }); }, 0);
  }
  function emojiPop(onPick) { pop(function (c, close) { c.appendChild(el('h3', '', 'Emoji')); var g = el('div', 'mg-emo'); EMOJI.forEach(function (e) { var b = el('button', '', e); b.onclick = function () { close(); onPick(e); }; g.appendChild(b); }); c.appendChild(g); }); }

  // ---------- views
  function go(v) { S.view = v; render(); }
  function frame(title, sub, opts) {
    box.textContent = ''; var h = el('header');
    if (opts && opts.back) { var b = el('button', 'ib', '←'); b.title = 'Back'; b.onclick = function () { closePop(); if (typeof opts.back === 'function') opts.back(); else go('list'); }; h.appendChild(b); }
    if (opts && opts.av) h.appendChild(opts.av);
    var t = el('div', 't'); t.appendChild(document.createTextNode(title)); if (opts && opts.tag) t.appendChild(opts.tag); var sm = el('small', '', sub || ''); sm.id = 'mg-sub'; t.appendChild(sm); h.appendChild(t);
    (opts && opts.btns || []).forEach(function (x) { var bb = el('button', 'ib', x[0]); bb.title = x[1]; bb.onclick = x[2]; h.appendChild(bb); });
    var xb = el('button', 'ib', '✕'); xb.title = 'Close (Esc)'; xb.onclick = closeBox; h.appendChild(xb); box.appendChild(h);
    if (!navigator.onLine) box.appendChild(el('div', 'mg-bar', 'You are offline. Messages will send when you reconnect.'));
  }
  function render() {
    clearInterval(timer); closeMenu(); skin(); if (box && !box._ic) { box._ic = new MutationObserver(function () { iconize(box); }); box._ic.observe(box, { childList: true, subtree: true }); }
    // Customers only ever see one built-in chat: the shop support thread (answered by the shop team). No list, no people search.
    if (!staff && S.view !== 'thread') { openConv({ type: 'support', id: me().id, name: 'Shop support', role: 'shop' }); return; }
    ({ list: viewList, assistant: viewAssistant, thread: viewThread, settings: viewSettings, people: viewPeople, starred: viewStarred, search: viewSearch })[S.view || 'list']();
  }
  function bodyBox() { var b = el('div'); b.id = 'mg-body'; box.appendChild(b); return b; }
  function btns(extra) { return [['✎', 'New message', function () { S.pick = null; go('people'); }], ['🔍', 'Search all messages', function () { go('search'); }], ['★', 'Starred messages', function () { go('starred'); }], ['⚙', 'Settings', function () { go('settings'); }], [P.big ? '⤡' : '⤢', 'Bigger / smaller', function () { P.big = !P.big; savePrefs(); skin(); render(); }]].concat(extra || []); }

  // ----- conversation list
  function viewList() {
    S.tab = S.tab || 'all'; frame('Chats', '', { btns: btns() });
    var tabs = el('div', 'tabs'), list = [['all', 'All'], ['unread', 'Unread'], ['pinned', 'Pinned'], ['archived', 'Archived']]; if (staff) list.splice(1, 0, ['support', 'Support']);
    list.forEach(function (t) { var b = el('button', S.tab === t[0] ? 'on' : '', t[1]); b.onclick = function () { S.tab = t[0]; render(); }; tabs.appendChild(b); }); box.appendChild(tabs);
    var f = el('input', 'find'); f.placeholder = 'Search chats'; f.value = S.filter || ''; f.oninput = function () { S.filter = f.value; paintRows(); }; box.appendChild(f);
    bodyBox(); paintRows(); loadList(); timer = setInterval(function () { if (!document.hidden) { loadList(); pollSummary(); } }, 6000);
  }
  function loadList() { api('/api/msg/conversations').then(function (r) { S.dms = r.dms; S.support = r.support; if (S.view === 'list') paintRows(); }).catch(function (e) { var b = document.getElementById('mg-body'); if (b && !S.dms) { b.textContent = ''; b.appendChild(el('div', 'mg-note', e.message)); } }); }
  function paintRows() {
    var b = document.getElementById('mg-body'); if (!b || S.view !== 'list') return; if (!S.dms) { b.textContent = ''; b.appendChild(el('div', 'mg-note', 'Loading...')); return; }
    var q = (S.filter || '').toLowerCase(), rows = [];
    (S.support || []).forEach(function (r) { r.pinned = !staff; rows.push(r); }); (S.dms || []).forEach(function (r) { rows.push(r); });
    if (me() && me().role === 'admin') rows.push({ type: 'assistant', id: 0, name: 'AI assistant', username: 'assistant', role: 'ai', preview: 'Ask, give orders, or talk to it with the mic', at: '9999', pinned: true, unread: 0 });
    rows = rows.filter(function (r) {
      if (q && (r.name + ' ' + r.username).toLowerCase().indexOf(q) < 0) return false;
      if (S.tab === 'archived') return r.archived; if (r.archived) return false;
      if (S.tab === 'unread') return r.unread > 0; if (S.tab === 'pinned') return r.pinned; if (S.tab === 'support') return r.type === 'support'; return true;
    }).sort(function (a, c) { return (c.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(c.at || '').localeCompare(String(a.at || '')); });
    b.textContent = '';
    if (!rows.length) { var n = el('div', 'mg-note', S.tab === 'all' && !q ? 'No messages yet. Tap ✎ to start one.' : 'Nothing here.'); b.appendChild(n); return; }
    rows.forEach(function (r) {
      var row = el('div', 'mg-row'), x = el('div', 'x'), nm = el('b', '', r.name); row.tabIndex = 0; var tg = tag(r.role); if (tg) nm.appendChild(tg); x.appendChild(nm);
      x.appendChild(el('em', '', (r.mine ? 'You: ' : '') + (r.preview || ''))); var rt = el('div', 'r', r.type === 'assistant' ? '' : shortTime(r.at));
      if (r.unread) rt.appendChild(el('span', 'mg-n', String(r.unread))); else if (r.pinned && r.type === 'dm') rt.appendChild(el('span', '', '📌')); if (r.muted) rt.appendChild(el('span', '', '🔕'));
      var mbtn = null; if (r.type === 'dm') { mbtn = el('button', 'ib', '⋯'); mbtn.title = 'Pin, mute, archive'; mbtn.onclick = function (e) { e.stopPropagation(); rowMenu(r, e); }; }
      row.appendChild(avatar(r.name, false, r.online)); row.appendChild(x); row.appendChild(rt); if (mbtn) row.appendChild(mbtn);
      row.onclick = function () { openConv(r); };
      row.oncontextmenu = function (e) { if (r.type !== 'dm') return; e.preventDefault(); rowMenu(r, e); };
      row.onkeydown = function (e) { if (e.key === 'Enter') openConv(r); }; b.appendChild(row);
    });
  }

  // ----- AI assistant (admin only). Active: it can propose actions (you press Confirm), announce new work by itself, and listen through the microphone.
  // Voice uses the browser's built-in speech recognition (Chrome, Edge, Safari). Everything here is skipped unless the signed-in user is the admin.
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var isAdmin = function () { var u = me(); return !!(u && u.role === 'admin' && LS('token')); };
  var A = { msgs: [], busy: false, queue: [] }, V = { rec: null, want: false, denied: false, speaking: false, brief: null, delay: 500, booted: false };
  try { A.msgs = JSON.parse(sessionStorage.getItem('mg_ai') || '[]'); } catch (e) { A.msgs = []; }
  function aiSave() { try { sessionStorage.setItem('mg_ai', JSON.stringify(A.msgs.slice(-30).map(function (m) { return { role: m.role, content: m.content }; }))); } catch (e) { /* storage blocked */ } }
  var LANGS = [['en-US', 'English'], ['en-PH', 'English (PH)'], ['fil-PH', 'Filipino']];
  var vcss = el('style');
  vcss.textContent = '#mg-mic{position:fixed;left:70px;bottom:16px;z-index:9000;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.35);background:rgba(30,30,34,.72);color:#fff;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}#mg-mic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}#mg-mic.on{background:#e5484d;animation:mgp 1.6s infinite}@keyframes mgp{50%{box-shadow:0 0 0 8px rgba(229,72,77,.25)}}#mg-vb{position:fixed;left:16px;bottom:68px;z-index:9000;max-width:min(320px,calc(100vw - 32px));padding:10px 14px;border-radius:14px;background:rgba(30,30,34,.92);color:#fff;font:14px/1.35 system-ui,sans-serif;white-space:pre-wrap}#mg-body .mg-act{margin:4px 0 8px;padding:10px 12px;border-radius:14px;border:1px solid var(--edge);background:var(--field);font-size:14px;color:var(--txt)}#mg-body .mg-act .row{display:flex;gap:8px;margin-top:8px}#mg-body .mg-act button{padding:7px 14px;border-radius:999px;border:1px solid var(--edge);background:var(--glass2);cursor:pointer}#mg-body .mg-act button.p{background:#0a84ff;color:#fff;border-color:transparent}';
  document.head.appendChild(vcss);

  function notice(t) { // small bubble when the Messages panel is closed, toast when it is open
    if (box) { say(t.slice(0, 120)); return; }
    var o = document.getElementById('mg-vb') || el('div'); o.id = 'mg-vb'; o.textContent = t.slice(0, 300); document.body.appendChild(o);
    clearTimeout(V.vbT); V.vbT = setTimeout(function () { o.remove(); }, 9000);
  }
  function speak(t) {
    if (!window.speechSynthesis) return;
    try {
      speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(String(t).slice(0, 600)); u.lang = P.lang || 'en-US'; V.speaking = true;
      if (V.rec) { try { V.rec.abort(); } catch (e) { /* ignore */ } } // do not listen to ourselves
      var done = function () { V.speaking = false; if (V.want && !V.denied && !V.rec) setTimeout(micStart, 300); };
      u.onend = done; u.onerror = done; speechSynthesis.speak(u);
    } catch (e) { V.speaking = false; }
  }
  function micUi() {
    var m = document.getElementById('mg-mic'); if (m) { m.classList.toggle('on', !!V.rec); m.title = V.want ? (V.rec ? 'Microphone is listening (click to turn off)' : 'Microphone on, restarting...') : 'Microphone is off (click to turn on)'; }
    refreshStrip();
  }
  function micStart() {
    if (!SR || !isAdmin() || V.rec || V.speaking || !V.want || V.denied) return;
    var r = new SR(); r.continuous = true; r.interimResults = false; r.lang = P.lang || 'en-US'; r.maxAlternatives = 1;
    r.onresult = function (e) { V.delay = 500; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) { var t = String(e.results[i][0].transcript || '').trim(); if (t && !V.speaking) heard(t); } } };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { V.denied = true; V.want = false; notice('Microphone blocked. Allow it in the browser address bar, then click the mic button.'); }
      else if (e.error === 'network') V.delay = 5000;
    };
    r.onend = function () { if (V.rec === r) V.rec = null; micUi(); if (V.want && !V.denied && isAdmin() && !V.speaking) setTimeout(micStart, V.delay); };
    try { r.start(); V.rec = r; micUi(); } catch (e) { V.rec = null; }
  }
  function setMic(on) {
    if (on && !isAdmin()) return;
    P.mic = !!on; savePrefs(); V.want = !!on; V.denied = false;
    if (on) micStart(); else { if (V.rec) { try { V.rec.abort(); } catch (e) { /* ignore */ } } V.rec = null; if (window.speechSynthesis) speechSynthesis.cancel(); }
    micUi();
  }
  function micStrip() {
    var s = el('div', 'tabs'); s.id = 'mg-ai-mic';
    if (!SR) { s.appendChild(el('div', 'mg-note', 'Voice needs Chrome, Edge or Safari. Typing works everywhere.')); return s; }
    var mk = function (on, label, f) { var b = el('button', on ? 'on' : '', label); b.onclick = f; s.appendChild(b); };
    mk(V.want, V.want ? (V.rec ? 'Mic: listening' : 'Mic: on') : 'Mic: off', function () { setMic(!V.want); });
    mk(P.speak, P.speak ? 'Voice replies: on' : 'Voice replies: off', function () { P.speak = !P.speak; savePrefs(); if (!P.speak && window.speechSynthesis) speechSynthesis.cancel(); refreshStrip(); });
    mk(P.wake, P.wake ? 'Wake word: on' : 'Wake word: off', function () { P.wake = !P.wake; savePrefs(); refreshStrip(); notice(P.wake ? 'Start with "shop" or "assistant", for example: shop, what is pending?' : 'Everything you say is sent to the assistant.'); });
    mk(false, (LANGS.filter(function (l) { return l[0] === P.lang; })[0] || LANGS[0])[1], function () { var i = 0; LANGS.forEach(function (l, k) { if (l[0] === P.lang) i = k; }); P.lang = LANGS[(i + 1) % LANGS.length][0]; savePrefs(); if (V.rec) { try { V.rec.abort(); } catch (e) { /* ignore */ } } refreshStrip(); });
    return s;
  }
  function refreshStrip() { var o = document.getElementById('mg-ai-mic'); if (o && box && S.view === 'assistant') o.replaceWith(micStrip()); }

  function latestPending() { for (var i = A.msgs.length - 1; i >= 0; i--) { var a = A.msgs[i].actions || []; for (var j = a.length - 1; j >= 0; j--) if (a[j].state === 'wait') return a[j]; } return null; }
  function heard(t) {
    var low = t.toLowerCase().replace(/[.,!?]/g, '').trim(), pend = latestPending();
    if (pend) { // voice confirmation: only the plain word "confirm" runs an action
      if (/^confirm\b/.test(low)) { doAction(pend, true); return; }
      if (/^(cancel|never mind|nevermind)\b/.test(low)) { doAction(pend, false); return; }
    }
    if (P.wake) { var m = /^(?:hey |ok |okay )?(?:shop|assistant|snackify)[ ,]*(.*)$/.exec(low); if (!m || m[1].length < 2) return; t = m[1]; }
    if (t.length < 2) return;
    aiAsk(t, true);
  }
  function doAction(a, ok) {
    if (!a || a.state !== 'wait' || a.busy) return; a.busy = true; paintAi();
    api('/api/admin/agent/confirm', 'POST', { id: a.id, ok: !!ok }).then(function (r) { a.state = ok ? 'done' : 'cancel'; a.result = r.message; }).catch(function (e) { a.state = 'error'; a.result = e.message; })
      .then(function () { a.busy = false; paintAi(); notice(a.result || ''); if (V.want && P.speak) speak(a.result || ''); });
  }
  function viewAssistant() {
    frame('AI assistant', '', { back: true, av: avatar('AI', true), btns: [['Clear', 'Clear this conversation', function () { A.msgs = []; aiSave(); paintAi(); }]] });
    box.appendChild(micStrip()); bodyBox();
    var f = el('footer'), row = el('div', 'cm'), ta = el('textarea'), sb = el('button', 'snd'); f.id = 'mg-foot';
    ta.id = 'mg-ta'; ta.rows = 1; ta.placeholder = 'Ask, or tell me what to do...'; sb.type = 'button'; sb.innerHTML = IC.send; sb.title = 'Send (Enter)'; sb.setAttribute('aria-label', 'Send');
    var go1 = function () { var t = ta.value.trim(); if (t) { ta.value = ''; aiAsk(t); } };
    sb.onclick = go1; ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go1(); } };
    row.appendChild(ta); row.appendChild(sb); f.appendChild(row); box.appendChild(f); paintAi(); ta.focus();
  }
  function paintAi() {
    var b = document.getElementById('mg-body'); if (!b || !box || S.view !== 'assistant') return; b.textContent = '';
    if (!A.msgs.length) {
      b.appendChild(el('div', 'mg-note', 'Ask me about sales, stock, orders or support chats, or tell me to act: "mark order 12 packed", "set Choco Chip sold out", "reply to maria that her order is on the way". I always show a card first and nothing changes until you press Confirm (or say "confirm").'));
      var ch = el('div', 'tabs');
      [['Sales this week', 'How were sales in the last 7 days?'], ['Low stock', 'Which products are low or sold out?'], ['Pending orders', 'Show the pending orders'], ['Support inbox', 'What is waiting in support?']].forEach(function (c) { var x = el('button', '', c[0]); x.onclick = function () { aiAsk(c[1]); }; ch.appendChild(x); });
      b.appendChild(ch);
    }
    A.msgs.forEach(function (m) {
      var d = el('div', 'mg-m ' + (m.role === 'user' ? 'me' : 'o'), m.content); d.style.whiteSpace = 'pre-wrap'; b.appendChild(d);
      (m.actions || []).forEach(function (a) {
        var c = el('div', 'mg-act'); c.appendChild(el('div', '', a.summary));
        if (a.state === 'wait') {
          var r = el('div', 'row'), ok = el('button', 'p', a.busy ? 'Working...' : 'Confirm'), no = el('button', '', 'Cancel');
          ok.onclick = function () { doAction(a, true); }; no.onclick = function () { doAction(a, false); }; r.appendChild(ok); r.appendChild(no); c.appendChild(r);
        } else { var s = el('div', '', (a.state === 'done' ? 'Done. ' : a.state === 'cancel' ? 'Cancelled. ' : 'Not done. ') + (a.result || '')); s.style.opacity = '.7'; s.style.marginTop = '6px'; c.appendChild(s); }
        b.appendChild(c);
      });
    });
    if (A.busy) { var t = el('div', 'mg-m o', 'Thinking...'); t.style.opacity = '.6'; b.appendChild(t); }
    b.scrollTop = b.scrollHeight;
  }
  function aiAsk(text, spoken) {
    if (A.busy) { if (spoken && A.queue.length < 3) A.queue.push(text); return; }
    var hist = A.msgs.slice(-10).map(function (m) { return { role: m.role, content: m.content }; });
    A.msgs.push({ role: 'user', content: text }); A.busy = true; aiSave(); paintAi(); if (spoken) notice('Heard: ' + text);
    api('/api/admin/agent', 'POST', { message: text, history: hist }).then(function (r) {
      var acts = (r.actions || []).map(function (a) { return { id: a.id, summary: a.summary, state: 'wait' }; });
      A.msgs.push({ role: 'assistant', content: r.reply, actions: acts });
      notice(r.reply); if (V.want && P.speak) speak(r.reply + (acts.length ? ' Say confirm to do it, or cancel.' : ''));
    }).catch(function (e) { A.msgs.push({ role: 'assistant', content: e.message }); })
      .then(function () { A.busy = false; aiSave(); paintAi(); var n = A.queue.shift(); if (n) aiAsk(n, true); });
  }
  // The "active" part: every 40 seconds the admin's browser asks for plain counts (no AI call) and announces what is new.
  function announce(t) { A.msgs.push({ role: 'assistant', content: t }); aiSave(); paintAi(); ping(); notice(t); if (V.want && P.speak) speak(t); }
  function briefPoll() {
    if (!isAdmin() || P.live === false) return;
    api('/api/admin/agent/brief').then(function (b) {
      var p = V.brief; V.brief = b; if (!p) return; var m = [];
      if (b.newest_pending_order > p.newest_pending_order) m.push('New order number ' + b.newest_pending_order + '. ' + b.pending_orders + ' pending.');
      if (b.handoffs > p.handoffs) m.push('A customer needs a person in support.'); else if (b.unread_chats > p.unread_chats) m.push('New support message.');
      if (m.length) announce(m.join(' '));
    }).catch(function () { /* AI off or offline */ });
  }
  setInterval(briefPoll, 40000);
  // Microphone button next to the Messages button, admin only. It also starts listening after the first click anywhere if the browser needed a gesture.
  function adminBoot(on) {
    var m = document.getElementById('mg-mic');
    if (on && !m) {
      m = el('button'); m.id = 'mg-mic'; m.type = 'button'; m.innerHTML = SV('<path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"/><path d="M19 11a7 7 0 01-14 0M12 18v3"/>'); m.setAttribute('aria-label', 'Microphone');
      m.onclick = function () { setMic(!V.want); }; document.body.appendChild(m);
      V.want = P.mic !== false; V.brief = null; if (V.want) micStart(); micUi();
      if (!V.booted) { V.booted = true; document.addEventListener('click', function () { if (V.want && !V.rec && !V.denied && isAdmin()) micStart(); }, true); }
    }
    if (!on && m) { m.remove(); V.want = false; if (V.rec) { try { V.rec.abort(); } catch (e) { /* ignore */ } } V.rec = null; if (window.speechSynthesis) speechSynthesis.cancel(); var v = document.getElementById('mg-vb'); if (v) v.remove(); A.msgs = []; aiSave(); }
  }
  function rowMenu(r, e) {
    menu([{ t: r.pinned ? 'Unpin chat' : 'Pin chat', f: function () { chatSet(r.id, { pinned: !r.pinned }); } }, { t: r.muted ? 'Unmute' : 'Mute notifications', f: function () { chatSet(r.id, { muted: !r.muted }); } },
      { t: r.archived ? 'Unarchive' : 'Archive', f: function () { chatSet(r.id, { archived: !r.archived }); } }, { t: 'Clear chat for me', d: 1, f: function () { if (confirm('Clear this chat from your side? The other person keeps their copy.')) api('/api/msg/chat/' + r.id, 'DELETE').then(function () { loadList(); }); } }], e);
  }
  function chatSet(id, o) { return api('/api/msg/chat/' + id, 'PUT', o).then(function () { loadList(); if (S.view === 'thread') fetchThread(false); }).catch(function (e) { say(e.message); }); }

  // ----- people picker (new message / forward)
  function viewPeople() {
    frame(S.pick ? 'Forward to...' : 'New message', '', { back: S.pick ? function () { go('thread'); } : true });
    var f = el('input', 'find'); f.placeholder = staff ? 'Search by username' : 'Search shop staff, or type a customer\'s exact username'; box.appendChild(f); var b = bodyBox(), t = null;
    if (!staff && !S.pick) { var sp = el('button', 'mg-row'), x = el('div', 'x'); x.appendChild(el('b', '', 'Shop support')); x.appendChild(el('em', '', 'Ask about an order or a product')); sp.appendChild(avatar('Shop', false, false)); sp.appendChild(x); sp.onclick = function () { openConv({ type: 'support', id: me().id, name: 'Shop support', role: 'shop' }); }; b.appendChild(sp); }
    var out = el('div'); out.style.cssText = 'display:flex;flex-direction:column;gap:6px'; b.appendChild(out);
    function run() { var v = f.value.trim(); if (!v) { out.textContent = ''; return; } api('/api/msg/users?q=' + encodeURIComponent(v)).then(function (rows) { if (f.value.trim() !== v) return; out.textContent = ''; if (!rows.length) out.appendChild(el('div', 'mg-note', 'No one found.')); rows.forEach(function (u) { var r = el('button', 'mg-row'), x2 = el('div', 'x'), nm = el('b', '', u.username), tg = tag(u.role); if (tg) nm.appendChild(tg); x2.appendChild(nm); r.appendChild(avatar(u.username, false, u.online)); r.appendChild(x2); r.onclick = function () { if (S.pick) { var fn = S.pick; S.pick = null; fn(u); } else openConv({ type: 'dm', id: u.id, name: u.username, role: u.role }); }; out.appendChild(r); }); }).catch(function (e) { out.textContent = ''; out.appendChild(el('div', 'mg-note', e.message)); }); }
    f.oninput = function () { clearTimeout(t); t = setTimeout(run, 250); }; setTimeout(function () { f.focus(); }, 40);
  }
  function viewStarred() {
    frame('Starred messages', '', { back: true }); var b = bodyBox(); b.appendChild(el('div', 'mg-note', 'Loading...'));
    api('/api/msg/starred').then(function (rows) { b.textContent = ''; if (!rows.length) b.appendChild(el('div', 'mg-note', 'Star a message to find it here.')); rows.forEach(function (r) { var row = el('button', 'mg-row'), x = el('div', 'x'); x.appendChild(el('b', '', (r.mine ? 'You to ' : '') + r.username)); x.appendChild(el('em', '', r.kind === 'image' ? 'Photo' : r.body)); row.appendChild(avatar(r.username)); row.appendChild(x); row.appendChild(el('div', 'r', shortTime(r.created_at))); row.onclick = function () { openConv({ type: 'dm', id: r.peer, name: r.username }); }; b.appendChild(row); }); }).catch(function (e) { b.textContent = e.message; });
  }
  function viewSearch() {
    frame('Search messages', '', { back: true }); var f = el('input', 'find'); f.placeholder = 'Search all your conversations (2+ letters)'; box.appendChild(f); var b = bodyBox(), t = null;
    f.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = f.value.trim(); if (v.length < 2) { b.textContent = ''; return; } api('/api/msg/search?q=' + encodeURIComponent(v)).then(function (rows) { b.textContent = ''; if (!rows.length) b.appendChild(el('div', 'mg-note', 'No matches.')); rows.forEach(function (r) { var row = el('button', 'mg-row'), x = el('div', 'x'); x.appendChild(el('b', '', r.username)); x.appendChild(el('em', '', (r.mine ? 'You: ' : '') + r.body)); row.appendChild(avatar(r.username)); row.appendChild(x); row.appendChild(el('div', 'r', shortTime(r.created_at))); row.onclick = function () { openConv({ type: 'dm', id: r.peer, name: r.username }); }; b.appendChild(row); }); }).catch(function (e) { b.textContent = e.message; }); }, 300); };
    setTimeout(function () { f.focus(); }, 40);
  }

  // ----- a conversation
  function openConv(c) { if (c.type === 'assistant') { go('assistant'); return; } S.type = c.type; S.cid = c.id; S.name = c.name; S.role = c.role; S.view = 'thread'; S.latest = []; S.older = []; S.info = null; S.pinned = null; S.sched = []; S.reply = null; S.edit = null; S.more = false; S.firstUnread = null; S.pending = []; S.find = ''; S.sig = ''; S.loaded = false; render(); }
  var draftKey = function () { return 'mg_draft_' + (me() ? me().id : 0) + '_' + S.type + S.cid; };
  function allMsgs() { var first = S.latest.length ? S.latest[0].id : Infinity; return S.older.filter(function (m) { return m.id < first; }).concat(S.latest); }
  function mapSupport(m) { return { id: m.id, mine: staff ? m.from_staff : !m.from_staff, kind: 'text', body: (/^Shop assistant/.test(m.sender || '') ? '[AI] ' : '') + m.body, created_at: m.created_at, reactions: {}, support: true, sender: m.sender }; }
  function viewThread() {
    var dm = S.type === 'dm', sup = !dm;
    frame(S.name, '', { back: !!staff, av: avatar(S.name, true), tag: tag(S.role), btns: dm ? [['⋯', 'Chat options', function (e) { chatMenu(e); }]] : [] });
    var pb = el('div', 'mg-pin'); pb.id = 'mg-pinbar'; pb.style.display = 'none'; box.appendChild(pb);
    var fb = el('input', 'find'); fb.id = 'mg-find'; fb.placeholder = 'Find in this chat'; fb.style.display = S.find ? '' : 'none'; fb.value = S.find; fb.oninput = function () { S.find = fb.value; S.sig = ''; paintMsgs(); }; box.appendChild(fb);
    var b = bodyBox(); b.appendChild(el('div', 'mg-note', 'Loading...')); b.onscroll = function () { jumpBtn(); if (b.scrollTop < 40 && S.more && !S.loadingOlder) loadOlder(); };
    buildComposer(); fetchThread(true); timer = setInterval(function () { if (!document.hidden) fetchThread(false); }, 3000);
  }
  function fetchThread(initial, done) {
    var c = S.cid, t = S.type, url = t === 'dm' ? '/api/msg/thread/' + c : staff ? '/api/chat/thread/' + c + '?after=0' : '/api/chat?after=0';
    api(url).then(function (r) {
      if (S.view !== 'thread' || S.cid !== c || S.type !== t) return;
      if (t === 'dm') { S.latest = r.messages; S.info = r.peer; S.pinned = r.pinned; S.sched = r.scheduled; if (initial) { S.firstUnread = r.first_unread; S.more = r.more; } if (r.peer.nickname) S.name = r.peer.nickname; else S.name = r.peer.username; S.role = r.peer.role; }
      else S.latest = r.messages.map(mapSupport);
      if (done) done(); S.loaded = true; paintHead(); paintPinned(); paintMsgs(initial); paintComposer();
    }).catch(function (e) { if (initial) { var b = document.getElementById('mg-body'); if (b) { b.textContent = ''; b.appendChild(el('div', 'mg-note', e.message)); } } });
  }
  function loadOlder() {
    var list = allMsgs(); if (!list.length) return; S.loadingOlder = true; var b = document.getElementById('mg-body'), h0 = b.scrollHeight;
    api('/api/msg/thread/' + S.cid + '?before=' + list[0].id).then(function (r) { S.older = r.messages.concat(S.older); S.more = r.more; S.sig = ''; paintMsgs(false); b.scrollTop = b.scrollHeight - h0; }).catch(function () {}).then(function () { S.loadingOlder = false; });
  }
  function paintHead() {
    var s = document.getElementById('mg-sub'); if (!s) return; var i = S.info;
    s.textContent = S.type === 'support' ? (staff ? 'Support conversation' : 'Replies come from the shop team') : !i ? '' : i.typing ? 'typing...' : i.online ? 'online' : (i.muted ? 'muted' : '');
    var h = box.querySelector('header .t'); if (h && h.firstChild && h.firstChild.nodeType === 3 && h.firstChild.nodeValue !== S.name) h.firstChild.nodeValue = S.name;
  }
  function paintPinned() {
    var p = document.getElementById('mg-pinbar'); if (!p) return; if (!S.pinned) { p.style.display = 'none'; return; }
    p.style.display = ''; p.textContent = ''; p.appendChild(el('span', '', '📌 ' + S.pinned.text)); var x = el('button', 'ib', '✕'); x.title = 'Unpin message'; x.onclick = function (e) { e.stopPropagation(); chatSet(S.cid, { pinned_msg: null }); }; p.appendChild(x); p.onclick = function () { jumpTo(S.pinned.id); };
  }
  function jumpTo(id) { var n = document.querySelector('[data-mid="' + id + '"]'); if (!n) { say('That message is not loaded. Scroll up to load older ones.'); return; } n.scrollIntoView({ block: 'center' }); n.classList.add('hl'); setTimeout(function () { n.classList.remove('hl'); }, 1500); }
  function jumpBtn() {
    var b = document.getElementById('mg-body'); if (!b) return; var far = b.scrollHeight - b.scrollTop - b.clientHeight > 220, j = document.getElementById('mg-jump');
    if (far && !j) { j = el('button', 'mg-jump', '↓ Latest'); j.id = 'mg-jump'; j.onclick = function () { b.scrollTop = b.scrollHeight; }; b.appendChild(j); } else if (!far && j) j.remove();
  }
  function linkify(node, text) {
    var re = /(https?:\/\/[^\s<>"]+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var url = m[1].replace(/[.,!?)]+$/, ''); try { var u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') { var a = el('a', '', url); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.onclick = function (e) { e.stopPropagation(); }; node.appendChild(a); } else node.appendChild(document.createTextNode(url)); } catch (e) { node.appendChild(document.createTextNode(url)); }
      last = m.index + url.length; re.lastIndex = last;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }
  function msgEl(m, prev) {
    var d = el('div', 'mg-m ' + (m.mine ? 'me' : 'o') + (m.deleted ? ' del' : '') + (m.status === 'failed' ? ' fail' : '') + (prev && prev.mine === m.mine && !prev.deleted && dayKey(prev.created_at) === dayKey(m.created_at) ? ' g' : '')); d.dataset.mid = m.id;
    if (m.forwarded) d.appendChild(el('div', 'f', '↪ Forwarded')); if (m.broadcast) d.appendChild(el('div', 'f', '📢 Announcement')); if (m.kind === 'auto') d.appendChild(el('div', 'f', '🤖 Automatic reply'));
    if (m.reply) { var q = el('div', 'q', (m.reply.mine ? 'You: ' : '') + m.reply.text); q.onclick = function (e) { e.stopPropagation(); jumpTo(m.reply.id); }; d.appendChild(q); }
    if (m.deleted) d.appendChild(document.createTextNode('This message was deleted'));
    else if (m.kind === 'image') { var im = el('img'); im.src = m.body; im.alt = 'Photo'; im.loading = 'lazy'; im.onclick = function (e) { e.stopPropagation(); lightbox(m.body); }; d.appendChild(im); }
    else linkify(d, m.body);
    var rx = Object.keys(m.reactions || {}); if (rx.length) { var r = el('div', 'mg-rx'); rx.forEach(function (k) { r.appendChild(el('span', k === m.my_reaction ? 'my' : '', k + ' ' + m.reactions[k])); }); d.appendChild(r); }
    var meta = el('div', 'meta'); if (m.starred) meta.appendChild(el('span', '', '★')); if (m.edited && !m.deleted) meta.appendChild(el('span', '', 'edited')); meta.appendChild(el('span', '', hhmm(m.created_at)));
    if (m.mine && !m.support) meta.appendChild(el('span', m.status === 'read' ? 'rd' : '', m.status === 'sending' ? '...' : m.status === 'failed' ? '!' : m.status === 'sent' ? '✓' : '✓✓'));
    d.appendChild(meta);
    if (m.status === 'failed') { var fx = el('div', 'meta'); var rb = el('button', 'ib', 'Retry'), db = el('button', 'ib', 'Delete'); rb.onclick = function (e) { e.stopPropagation(); m.status = 'sending'; S.sig = ''; paintMsgs(); doSend(m); }; db.onclick = function (e) { e.stopPropagation(); S.pending = S.pending.filter(function (x) { return x !== m; }); S.sig = ''; paintMsgs(); }; fx.appendChild(el('span', '', m.err || 'Not sent')); fx.appendChild(rb); fx.appendChild(db); d.appendChild(fx); }
    else if (!m.pending) d.onclick = function (e) { msgMenu(m, e); };
    return d;
  }
  function paintMsgs(stick) {
    var b = document.getElementById('mg-body'); if (!b || !S.loaded) return;
    var list = allMsgs().concat(S.pending), f = (S.find || '').toLowerCase(); if (f) list = list.filter(function (m) { return m.body && m.body.toLowerCase().indexOf(f) >= 0; });
    var sig = JSON.stringify(list.map(function (m) { return [m.id, m.body.length, m.status, m.edited, m.deleted, m.starred, m.my_reaction, m.reactions, m.err]; })) + S.more + S.firstUnread; if (sig === S.sig && !stick) return; S.sig = sig;
    var near = b.scrollHeight - b.scrollTop - b.clientHeight < 80, top = b.scrollTop; b.textContent = '';
    if (S.more) b.appendChild(el('div', 'mg-note', 'Scroll up for older messages'));
    if (!list.length) b.appendChild(el('div', 'mg-note', f ? 'No matches in this chat.' : S.type === 'support' ? (staff ? 'No messages yet.' : 'Hi! Ask us anything about your order or a product. Please do not share passwords.') : 'No messages yet. Say hello!'));
    var prev = null, lastDay = null, divided = false;
    list.forEach(function (m) {
      var k = dayKey(m.created_at); if (k !== lastDay) { b.appendChild(el('div', 'mg-day', dayLabel(m.created_at))); lastDay = k; prev = null; }
      if (!divided && S.firstUnread && m.id >= S.firstUnread && !m.mine) { var nd = el('div', 'mg-new'); nd.appendChild(el('span', '', 'New messages')); b.appendChild(nd); divided = true; }
      b.appendChild(msgEl(m, prev)); prev = m;
    });
    if (stick || near) b.scrollTop = b.scrollHeight; else b.scrollTop = top; jumpBtn();
  }

  // ----- message actions
  function msgMenu(m, e) {
    if (m.support) { menu([{ t: 'Copy text', f: function () { copy(m.body); } }], e); return; }
    var rr = null, mn = me();
    if (!m.deleted) { rr = el('div', 'rr'); REACT.forEach(function (x) { var b = el('button', '', x); b.onclick = function () { closeMenu(); act(m, 'react', { emoji: x }); }; rr.appendChild(b); }); }
    var canEdit = m.mine && m.kind === 'text' && !m.deleted && Date.now() - new Date(m.created_at) < 15 * 60e3 && !m.broadcast && m.kind !== 'auto';
    var items = m.deleted ? [] : [
      { t: 'Reply', f: function () { S.reply = m; S.edit = null; paintComposer(); focusComposer(); } },
      m.kind === 'image' ? null : { t: 'Copy text', f: function () { copy(m.body); } },
      { t: 'Forward...', f: function () { S.pick = function (u) { fwd(m, u); }; go('people'); } },
      { t: m.starred ? 'Remove star' : 'Star', f: function () { act(m, 'star'); } },
      { t: S.pinned && S.pinned.id === m.id ? 'Unpin from top' : 'Pin to top', f: function () { chatSet(S.cid, { pinned_msg: S.pinned && S.pinned.id === m.id ? null : m.id }); } },
      canEdit ? { t: 'Edit', f: function () { S.edit = m; S.reply = null; paintComposer(); var t = document.getElementById('mg-ta'); if (t) { t.value = m.body; t.focus(); } } } : null,
      m.mine ? { t: 'Delete for everyone', d: 1, f: function () { if (confirm('Delete this message for everyone?')) act(m, 'del'); } } : { t: 'Report', d: 1, f: function () { report(m); } },
      !m.mine && mn && mn.role === 'admin' ? { t: 'Remove (moderator)', d: 1, f: function () { if (confirm('Remove this message for both people?')) act(m, 'del'); } } : null];
    items = items.filter(Boolean); if (!items.length) return; menu(items, e, rr);
  }
  function act(m, what, body) {
    var u = '/api/msg/message/' + m.id; var p = what === 'del' ? api(u, 'DELETE') : api(u + '/' + what, 'POST', body || {});
    p.then(function () { fetchThread(false); }).catch(function (e) { say(e.message); });
  }
  function fwd(m, u) { api('/api/msg/message/' + m.id + '/forward', 'POST', { to: u.id }).then(function () { openConv({ type: 'dm', id: u.id, name: u.username, role: u.role }); say('Forwarded to ' + u.username); }).catch(function (e) { go('thread'); say(e.message); }); }
  function report(m) { pop(function (c, close) { c.appendChild(el('h3', '', 'Report this message')); var t = el('textarea'); t.placeholder = 'What is wrong? (optional)'; c.appendChild(t); var r = el('div', 'row'), s = el('button', 'p', 'Send report'), x = el('button', 's', 'Cancel'); s.onclick = function () { api('/api/msg/message/' + m.id + '/report', 'POST', { reason: t.value }).then(function () { close(); say('Thanks, the shop team will look at it.'); }).catch(function (e) { say(e.message); }); }; x.onclick = close; r.appendChild(s); r.appendChild(x); c.appendChild(r); }); }
  function chatMenu(e) {
    var i = S.info || {}, c = S.cid;
    menu([{ t: 'Contact info', f: info }, { t: i.pinned ? 'Unpin chat' : 'Pin chat', f: function () { chatSet(c, { pinned: !i.pinned }); } }, { t: i.muted ? 'Unmute' : 'Mute notifications', f: function () { chatSet(c, { muted: !i.muted }); } },
      { t: i.archived ? 'Unarchive' : 'Archive chat', f: function () { chatSet(c, { archived: !i.archived }).then(function () { if (!i.archived) go('list'); }); } }, { t: 'Set nickname...', f: nick }, { t: 'Find in chat', f: function () { var f = document.getElementById('mg-find'); if (f) { f.style.display = ''; f.focus(); } } },
      { t: 'Export chat (.txt)', f: exportChat }, i.blocked_by_me ? { t: 'Unblock', f: function () { api('/api/msg/block/' + c, 'DELETE').then(function () { fetchThread(false); say('Unblocked'); }); } } : { t: 'Block', d: 1, f: function () { if (confirm('Block ' + S.name + '? They will not be able to message you.')) api('/api/msg/block/' + c, 'POST').then(function () { fetchThread(false); say('Blocked'); }).catch(function (e) { say(e.message); }); } },
      { t: 'Clear chat for me', d: 1, f: function () { if (confirm('Clear this chat from your side?')) api('/api/msg/chat/' + c, 'DELETE').then(function () { go('list'); }); } }], e);
  }
  function info() { var i = S.info || {}; pop(function (c, close) { c.appendChild(el('h3', '', 'Contact info')); var t = el('table', 'mg-tbl'); [['Username', i.username], ['Role', ROLE[i.role] || 'Customer'], ['Nickname (only you see it)', i.nickname || 'None'], ['Joined', i.joined ? new Date(i.joined).toLocaleDateString() : ''], ['Messages in this chat', i.count], ['Status', i.online ? 'Online' : 'Offline or hidden'], ['Pinned / muted', (i.pinned ? 'pinned' : 'no') + ' / ' + (i.muted ? 'muted' : 'no')]].forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', '', r[0])); tr.appendChild(el('td', '', String(r[1] == null ? '' : r[1]))); t.appendChild(tr); }); c.appendChild(t); var r = el('div', 'row'), x = el('button', 's', 'Close'); x.onclick = close; r.appendChild(x); c.appendChild(r); }); }
  function nick() { pop(function (c, close) { c.appendChild(el('h3', '', 'Nickname')); var t = el('input'); t.maxLength = 40; t.value = (S.info && S.info.nickname) || ''; t.placeholder = S.info ? S.info.username : ''; c.appendChild(t); var r = el('div', 'row'), s = el('button', 'p', 'Save'), x = el('button', 's', 'Cancel'); s.onclick = function () { close(); chatSet(S.cid, { nickname: t.value }); }; x.onclick = close; r.appendChild(s); r.appendChild(x); c.appendChild(r); t.focus(); }); }
  function exportChat() {
    var lines = allMsgs().map(function (m) { return '[' + new Date(m.created_at).toLocaleString() + '] ' + (m.mine ? 'You' : S.name) + ': ' + (m.deleted ? '(deleted)' : m.kind === 'image' ? '(photo)' : m.body); });
    var a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' })); a.download = 'chat-' + S.name.replace(/[^\w-]+/g, '_') + '.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ----- composer
  function focusComposer() { var t = document.getElementById('mg-ta'); if (t) t.focus(); }
  function buildComposer() {
    var f = el('footer'); f.id = 'mg-foot'; box.appendChild(f); paintComposer(true);
  }
  function paintComposer(first) {
    var f = document.getElementById('mg-foot'); if (!f) return; var i = S.info, dm = S.type === 'dm', ta = document.getElementById('mg-ta'), keep = ta ? ta.value : (LS(draftKey()) || '');
    if (!first && ta && !S.ctxChanged && f.dataset.cant === String(!!(i && i.cant)) && f.dataset.ctx === ctxKey()) { return; }
    f.dataset.cant = String(!!(i && i.cant)); f.dataset.ctx = ctxKey(); f.textContent = '';
    if (dm && i && i.cant) { f.appendChild(el('div', 'mg-note', i.cant)); if (i.blocked_by_me) { var ub = el('button', 'snd', 'Unblock'); ub.style.cssText = 'display:block;margin:0 auto'; ub.onclick = function () { api('/api/msg/block/' + S.cid, 'DELETE').then(function () { fetchThread(false); }); }; f.appendChild(ub); } return; }
    var ctxm = S.edit || S.reply; if (ctxm) { var cx = el('div', 'ctx'); cx.appendChild(el('span', '', (S.edit ? 'Editing: ' : 'Replying to ' + (ctxm.mine ? 'yourself' : S.name) + ': ') + (ctxm.kind === 'image' ? 'Photo' : ctxm.body.slice(0, 80)))); var xb = el('button', 'ib', '✕'); xb.onclick = function () { var was = !!S.edit, t0 = document.getElementById('mg-ta'); S.edit = null; S.reply = null; if (was && t0) t0.value = ''; paintComposer(); }; cx.appendChild(xb); f.appendChild(cx); }
    var row = el('div', 'cm'), tb = [];
    tb.push(['😊', 'Emoji', function () { emojiPop(function (e) { insert(e); }); }]);
    if (dm) { tb.push(['📷', 'Send a photo', function () { pickImage(); }]); tb.push(['⚡', 'Saved replies', function () { cannedPop(); }]); tb.push(['⏰', 'Send later', function () { schedulePop(); }]); }
    tb.forEach(function (x) { var b = el('button', 'ib', x[0]); b.title = x[1]; b.type = 'button'; b.onclick = x[2]; row.appendChild(b); });
    var t = el('textarea'); t.id = 'mg-ta'; t.placeholder = S.edit ? 'Edit your message' : 'Write a message'; t.maxLength = 2000; t.value = keep; t.rows = 1; grow(t);
    var lastTyped = 0;
    t.oninput = function () { grow(t); LSset(draftKey(), t.value); cnt.textContent = t.value.length > 1500 ? t.value.length + ' / 2000' : ''; if (dm && Date.now() - lastTyped > 2500 && t.value) { lastTyped = Date.now(); api('/api/msg/typing/' + S.cid, 'POST', {}).catch(function () {}); } };
    t.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey && P.enter && !e.isComposing) { e.preventDefault(); submit(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !P.enter) { e.preventDefault(); submit(); }
      else if (e.key === 'ArrowUp' && !t.value && dm) { var mine = allMsgs().filter(function (m) { return m.mine && m.kind === 'text' && !m.deleted && Date.now() - new Date(m.created_at) < 15 * 60e3; }).pop(); if (mine) { e.preventDefault(); S.edit = mine; S.reply = null; paintComposer(); var t2 = document.getElementById('mg-ta'); t2.value = mine.body; } }
      else if (e.key === 'Escape' && (S.edit || S.reply)) { e.stopPropagation(); S.edit = null; S.reply = null; t.value = ''; paintComposer(); }
    };
    var s = el('button', 'snd', S.edit ? 'Save' : '\u27A4'); s.type = 'button'; s.title = 'Send (Enter)'; s.setAttribute('aria-label', 'Send'); if (!S.edit) s.innerHTML = IC.send; s.onclick = submit; row.appendChild(t); row.appendChild(s); f.appendChild(row); var cnt = el('div', 'cnt'); f.appendChild(cnt); setTimeout(function () { t.focus(); }, 30);
  }
  var ctxKey = function () { return (S.edit ? 'e' + S.edit.id : '') + (S.reply ? 'r' + S.reply.id : ''); };
  function grow(t) { t.style.height = '40px'; t.style.height = Math.max(40, Math.min(120, t.scrollHeight)) + 'px'; }
  function insert(txt) { var t = document.getElementById('mg-ta'); if (!t) return; var a = t.selectionStart || t.value.length, z = t.selectionEnd || t.value.length; t.value = t.value.slice(0, a) + txt + t.value.slice(z); t.focus(); t.selectionStart = t.selectionEnd = a + txt.length; t.oninput(); }
  function slash(v) {
    var n = me() ? me().username : '';
    if (/^\/shrug\b/i.test(v)) return (v.replace(/^\/shrug\s*/i, '') + ' ¯\\_(ツ)_/¯').trim();
    if (/^\/time\b/i.test(v)) return 'It is ' + new Date().toLocaleString() + ' for me';
    if (/^\/me\s+/i.test(v)) return '* ' + n + ' ' + v.replace(/^\/me\s+/i, '');
    if (/^\/(love|heart)\b/i.test(v)) return '❤️ ' + v.replace(/^\/\w+\s*/, '');
    return v;
  }
  function submit() {
    var t = document.getElementById('mg-ta'); if (!t) return; var v = slash(t.value.trim()); if (!v) return;
    if (S.edit) { var m = S.edit; api('/api/msg/message/' + m.id, 'PUT', { body: v }).then(function () { S.edit = null; t.value = ''; LSset(draftKey(), ''); paintComposer(); fetchThread(false); }).catch(function (e) { say(e.message); }); return; }
    t.value = ''; t.style.height = '40px'; try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } var c = box.querySelector('.cnt'); if (c) c.textContent = '';
    queue({ kind: 'text', body: v });
  }
  function queue(o) {
    var rp = S.reply; S.reply = null;
    var m = { pending: true, id: 'p' + Date.now() + Math.random(), mine: true, kind: o.kind, body: o.body, created_at: new Date().toISOString(), status: 'sending', reactions: {}, reply: rp ? { id: rp.id, mine: rp.mine, text: rp.kind === 'image' ? 'Photo' : rp.body.slice(0, 80) } : null, reply_id: rp ? rp.id : null, support: S.type === 'support' };
    S.pending.push(m); S.sig = ''; paintComposer(); paintMsgs(true); doSend(m);
  }
  function doSend(m) {
    if (sending[m.id]) return; sending[m.id] = 1; var c = S.cid, dm = S.type === 'dm';
    var p = dm ? api('/api/msg/send', 'POST', { to: c, body: m.body, kind: m.kind, reply_to: m.reply_id }) : api(staff ? '/api/chat/thread/' + c : '/api/chat', 'POST', { body: m.body });
    p.then(function () { fetchThread(false, function () { S.pending = S.pending.filter(function (x) { return x !== m; }); S.sig = ''; }); setTimeout(function () { var b = document.getElementById('mg-body'); if (b) b.scrollTop = b.scrollHeight; }, 250); })
      .catch(function (e) { m.status = 'failed'; m.err = e.http ? e.message : 'No connection'; m.net = !e.http; S.sig = ''; paintMsgs(); }).then(function () { delete sending[m.id]; });
  }
  addEventListener('online', function () { if (S.pending) S.pending.forEach(function (m) { if (m.status === 'failed' && m.net) { m.status = 'sending'; doSend(m); } }); if (box) render(); });
  addEventListener('offline', function () { if (box) render(); });
  function pickImage() {
    var f = el('input'); f.type = 'file'; f.accept = 'image/*'; f.onchange = function () {
      var file = f.files[0]; if (!file) return; var rd = new FileReader();
      rd.onload = function () { var im = new Image(); im.onload = function () {
        var scale = Math.min(1, 720 / Math.max(im.width, im.height)), q = 0.72, url;
        for (var k = 0; k < 6; k++) { var c = document.createElement('canvas'); c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale); var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', q); if (url.length <= 140000) break; q = Math.max(0.35, q - 0.12); scale *= 0.8; }
        if (url.length > 140000) { say('That picture is too large.'); return; } queue({ kind: 'image', body: url });
      }; im.onerror = function () { say('That file is not a picture.'); }; im.src = rd.result; }; rd.readAsDataURL(file);
    }; f.click();
  }
  function cannedPop() {
    pop(function (c, close) {
      c.appendChild(el('h3', '', 'Saved replies')); var l = el('div'); c.appendChild(l); l.appendChild(el('div', 'mg-note', 'Loading...'));
      api('/api/msg/canned').then(function (rows) { l.textContent = ''; if (!rows.length) l.appendChild(el('div', 'mg-note', 'None yet. Add some in Settings.')); rows.forEach(function (r) { var b = el('button', 'mg-row'), x = el('div', 'x'); x.appendChild(el('b', '', r.title)); x.appendChild(el('em', '', r.body)); b.appendChild(x); b.onclick = function () { close(); insert(r.body.replace(/\{name\}/g, S.name)); }; l.appendChild(b); }); }).catch(function (e) { l.textContent = e.message; });
    });
  }
  function schedulePop() {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; }, loc = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    pop(function (c, close) {
      c.appendChild(el('h3', '', 'Send later')); var ta = document.getElementById('mg-ta'), t = el('textarea'); t.value = ta ? ta.value : ''; c.appendChild(t); var dt = el('input'); dt.type = 'datetime-local'; dt.value = loc(new Date(Date.now() + 36e5)); dt.style.marginTop = '8px'; c.appendChild(dt);
      var q = el('div', 'row'); [['In 1 hour', function () { return new Date(Date.now() + 36e5); }], ['Tomorrow 9am', function () { var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }]].forEach(function (x) { var b = el('button', 's', x[0]); b.onclick = function () { dt.value = loc(x[1]()); }; q.appendChild(b); }); c.appendChild(q);
      if (S.sched && S.sched.length) { c.appendChild(el('h3', '', 'Waiting to send')); S.sched.forEach(function (s) { var r = el('div', 'row'), tx = el('div', '', new Date(s.send_at).toLocaleString() + ': ' + s.body.slice(0, 40)); tx.style.flex = '1'; var x = el('button', 's', 'Cancel'); x.onclick = function () { api('/api/msg/schedule/' + s.id, 'DELETE').then(function () { r.remove(); fetchThread(false); }); }; r.appendChild(tx); r.appendChild(x); c.appendChild(r); }); }
      var r = el('div', 'row'), s = el('button', 'p', 'Schedule'), x = el('button', 's', 'Close'); s.onclick = function () { api('/api/msg/schedule', 'POST', { to: S.cid, body: t.value, send_at: new Date(dt.value).toISOString() }).then(function () { if (ta) ta.value = ''; try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } close(); fetchThread(false); say('Scheduled'); }).catch(function (e) { say(e.message); }); }; x.onclick = close; r.appendChild(s); r.appendChild(x); c.appendChild(r);
    });
  }

  // ----- settings, diagnostics and admin tools
  function viewSettings() {
    frame('Settings', '', { back: true }); var b = bodyBox(); b.className = ''; b.id = 'mg-body'; b.style.display = 'block'; b.classList.add('mg-set');
    var add = function (h) { b.appendChild(el('h4', '', h)); };
    function row(title, desc, ctl) { var r = el('div', 'st'), d = el('div'); d.appendChild(document.createTextNode(title)); if (desc) d.appendChild(el('small', '', desc)); r.appendChild(d); r.appendChild(ctl); b.appendChild(r); }
    function chk(on, fn) { var c = el('input'); c.type = 'checkbox'; c.checked = !!on; c.onchange = function () { fn(c.checked); }; return c; }
    function sel(opts, val, fn) { var s = el('select'); opts.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; if (String(o[0]) === String(val)) op.selected = true; s.appendChild(op); }); s.onchange = function () { fn(s.value); }; return s; }
    var sp = function (k) { return function (v) { var o = {}; o[k] = v; api('/api/msg/prefs', 'PUT', o).then(function (r) { S.prefs = r; }).catch(function (e) { say(e.message); }); }; };
    var lp = function (k) { return function (v) { P[k] = v; savePrefs(); skin(); }; };
    add('Notifications');
    row('Sound for new messages', 'A short ping when something arrives', chk(P.sound, lp('sound')));
    row('Desktop notifications', 'Shows an alert when the shop is in another tab', chk(P.desk, function (v) { P.desk = v; savePrefs(); if (v && window.Notification && Notification.permission === 'default') Notification.requestPermission(); }));
    add('Privacy');
    var holder = el('div'); b.appendChild(holder);
    api('/api/msg/prefs').then(function (p) {
      S.prefs = p; var tmp = b; b = holder;
      row('Read receipts', 'Show blue ticks when you read a message (and see theirs)', chk(p.read_receipts, sp('read_receipts')));
      row('Typing indicator', 'Show when you are typing', chk(p.typing, sp('typing')));
      row('Show when I am online', 'Turn off to hide your online dot', chk(p.show_last_seen, sp('show_last_seen')));
      row('Who can message me', 'Shop support always works', sel([['everyone', 'Everyone'], ['staff', 'Shop team only'], ['nobody', 'Nobody new']], p.allow_from, sp('allow_from')));
      b.appendChild(el('h4', '', 'Away message'));
      row('Automatic reply', 'Sent once every 6 hours to anyone who writes to you', chk(p.auto_reply_on, sp('auto_reply_on')));
      var ta = el('textarea'); ta.maxLength = 500; ta.value = p.auto_reply || ''; ta.placeholder = 'I am away right now and will reply soon.'; b.appendChild(ta); var sv = el('button', 'btn', 'Save away message'); sv.onclick = function () { sp('auto_reply')(ta.value); say('Saved'); }; b.appendChild(sv); b = tmp;
    }).catch(function (e) { holder.appendChild(el('div', 'mg-note', e.message)); });
    add('Blocked people'); var bl = el('div'); b.appendChild(bl);
    api('/api/msg/blocks').then(function (rows) { if (!rows.length) bl.appendChild(el('div', 'mg-note', 'You have not blocked anyone.')); rows.forEach(function (u) { var r = el('div', 'st'); r.appendChild(el('div', '', u.username)); var x = el('button', 'btn', 'Unblock'); x.onclick = function () { api('/api/msg/block/' + u.id, 'DELETE').then(function () { r.remove(); }); }; r.appendChild(x); bl.appendChild(r); }); }).catch(function () {});
    add('Look and feel');
    row('Press Enter to send', 'Off: Enter adds a new line, Ctrl+Enter sends', chk(P.enter, lp('enter')));
    row('Theme', '', sel([['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], P.theme, function (v) { P.theme = v; savePrefs(); skin(); }));
    row('Text size', '', sel([[12, 'Small'], [14, 'Medium'], [16, 'Large'], [18, 'Extra large']], P.font, function (v) { P.font = Number(v); savePrefs(); skin(); }));
    row('Compact messages', 'Tighter spacing', chk(P.compact, lp('compact')));
    var swr = el('div', 'mg-sw'); ACCENTS.forEach(function (a) { var s = el('button', P.accent === a ? 'on' : ''); s.style.background = a; s.title = 'Color'; s.onclick = function () { P.accent = a; savePrefs(); skin(); swr.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === s); }); }; swr.appendChild(s); }); row('Accent color', '', swr);
    add('Saved replies'); var cl = el('div'); b.appendChild(cl);
    function loadCanned() { api('/api/msg/canned').then(function (rows) { cl.textContent = ''; rows.forEach(function (c) { var r = el('div', 'st'), d = el('div'); d.appendChild(document.createTextNode(c.title)); d.appendChild(el('small', '', c.body)); r.appendChild(d); var x = el('button', 'btn', 'Delete'); x.onclick = function () { api('/api/msg/canned/' + c.id, 'DELETE').then(loadCanned); }; r.appendChild(x); cl.appendChild(r); }); }).catch(function () {}); }
    loadCanned(); var ti = el('input'); ti.type = 'text'; ti.placeholder = 'Title'; ti.maxLength = 40; ti.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px'; var tx = el('textarea'); tx.placeholder = 'Text. Use {name} for the other person\'s name.'; tx.maxLength = 500; var ab = el('button', 'btn p', 'Add saved reply'); ab.onclick = function () { api('/api/msg/canned', 'POST', { title: ti.value, body: tx.value }).then(function () { ti.value = ''; tx.value = ''; loadCanned(); }).catch(function (e) { say(e.message); }); }; b.appendChild(ti); b.appendChild(tx); b.appendChild(ab);
    add('Diagnostics'); var dg = el('div'); var rb = el('button', 'btn p', 'Run diagnostics'); rb.onclick = function () { runDiag(dg); }; b.appendChild(rb); b.appendChild(dg);
    var u = me(); if (u && u.role === 'admin') {
      add('Admin: announcement'); var au = sel([['customers', 'All customers'], ['sellers', 'All sellers'], ['all', 'Everyone']], 'customers', function () {}), at = el('textarea'); at.maxLength = 1000; at.placeholder = 'Message to send to many people at once'; var ab2 = el('button', 'btn p', 'Send announcement'); ab2.onclick = function () { if (at.value.trim() && confirm('Send this to ' + au.options[au.selectedIndex].text.toLowerCase() + '?')) api('/api/msg/broadcast', 'POST', { audience: au.value, body: at.value }).then(function (r) { at.value = ''; say('Sent to ' + r.sent + ' people'); }).catch(function (e) { say(e.message); }); }; b.appendChild(au); b.appendChild(at); b.appendChild(ab2);
      add('Admin: reported messages'); var rp = el('div'); b.appendChild(rp);
      var loadRep = function () { api('/api/msg/admin/reports').then(function (rows) { rp.textContent = ''; if (!rows.length) rp.appendChild(el('div', 'mg-note', 'No reports.')); rows.forEach(function (r) { var w = el('div', 'st'), d = el('div'); d.appendChild(document.createTextNode((r.reported || '?') + ' (reported by ' + (r.reporter || '?') + ')')); d.appendChild(el('small', '', r.excerpt + (r.reason ? ' | ' + r.reason : ''))); w.appendChild(d); if (r.status === 'open') { var a = el('button', 'btn', 'Resolve'), c = el('button', 'btn', 'Remove + resolve'); a.onclick = function () { api('/api/msg/admin/reports/' + r.id + '/resolve', 'POST', {}).then(loadRep); }; c.onclick = function () { api('/api/msg/admin/reports/' + r.id + '/resolve', 'POST', { remove: true }).then(loadRep); }; w.appendChild(a); w.appendChild(c); } else w.appendChild(el('small', '', 'resolved')); rp.appendChild(w); }); }).catch(function () {}); }; loadRep();
    }
  }
  function runDiag(out) {
    out.textContent = 'Running...'; var t0 = performance.now(), ls = 'blocked'; try { localStorage.setItem('mg_t', '1'); localStorage.removeItem('mg_t'); ls = 'ok'; } catch (e) { /* blocked */ }
    api('/api/msg/diag').then(function (d) {
      var ms = Math.round(performance.now() - t0), rows = [['Result', 'All good'], ['Round trip to the shop', ms + ' ms' + (ms > 1500 ? ' (slow)' : '')], ['Database answered in', d.database_ms + ' ms'], ['Your connection', navigator.onLine ? 'online' : 'offline'], ['You appear online to others', d.you_are_online ? 'yes' : 'not yet'], ['People online now', d.online_now], ['Notifications', window.Notification ? Notification.permission : 'not supported'], ['Browser storage', ls], ['Your messages', d.mine.messages], ['Unread', d.mine.unread], ['Scheduled', d.mine.scheduled], ['Blocked people', d.mine.blocked], ['Saved replies', d.mine.saved_replies], ['Max message length', d.limits.text_chars + ' characters'], ['Max picture size', d.limits.picture_kb + ' KB'], ['Edit window', d.limits.edit_minutes + ' min'], ['Messages kept for', d.limits.keep_days + ' days']];
      if (d.shop) rows = rows.concat([['Shop: all messages', d.shop.messages], ['Shop: last 24 hours', d.shop.last_24h], ['Shop: scheduled waiting', d.shop.scheduled_waiting], ['Shop: open reports', d.shop.open_reports], ['Shop: blocks', d.shop.blocks]]);
      var tb = el('table', 'mg-tbl'); rows.forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', '', r[0])); tr.appendChild(el('td', '', String(r[1]))); tb.appendChild(tr); }); out.textContent = ''; out.appendChild(tb);
    }).catch(function (e) { out.textContent = 'Failed: ' + e.message + (navigator.onLine ? '' : ' (you are offline)'); });
  }

  // ---------- open, close, start
  function closeBox() { clearInterval(timer); if (box) box.remove(); box = null; S.view = 'list'; pollSummary(); }
  function toggle() {
    if (box) return closeBox(); box = el('div'); box.id = 'mg-box'; document.body.appendChild(box); S = { view: 'list', tab: 'all', pending: [], latest: [], older: [] }; render(); pollSummary();
  }
  document.addEventListener('keydown', function (e) {
    if (!btn) return;
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); toggle(); return; }
    if (!box) return;
    if (e.key === 'Escape') { if (document.querySelector('.mg-lb')) return; if (box.querySelector('.mg-pop')) return closePop(); if (box.querySelector('.mg-menu')) return closeMenu(); if (S.view !== 'list') { go('list'); } else closeBox(); }
    else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); S.pick = null; go('people'); }
  });
  function deepLink() {
    var m = /msg=([\w.\-]+)/.exec(location.hash || ''); if (!m) return;
    api('/api/msg/users?q=' + encodeURIComponent(m[1])).then(function (rows) { var u = rows.filter(function (x) { return x.username.toLowerCase() === m[1].toLowerCase(); })[0]; if (!u) return; if (!box) toggle(); openConv({ type: 'dm', id: u.id, name: u.username, role: u.role }); }).catch(function () {});
  }
  // The button appears only while someone is signed in (the shop is a single page, so this is checked regularly).
  var linked = false;
  setInterval(function () {
    var u = me(), on = !!(u && LS('token'));
    if (on && !btn) { staff = u.role !== 'customer'; btn = el('button'); btn.id = 'mg-btn'; btn.type = 'button'; btn.title = 'Messages (Ctrl+Shift+M)'; btn.onclick = toggle; document.body.appendChild(btn); setBadge(0); pollSummary(); if (!linked) { linked = true; deepLink(); } }
    if (!on && btn) { closeBox(); btn.remove(); btn = null; lastUnread = 0; setBadge(0); }
    adminBoot(on && isAdmin());
  }, 2000);
  setInterval(pollSummary, 25000);
})();
