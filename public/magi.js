// MAGI console (admin only): NERV colour theme and the three-node MAGI display (Melchior / Balthasar / Casper).
// Loaded by index.html only for the admin role. Uses textContent everywhere, so answers can never inject HTML.
// Colours are CSS variables on #magi (--mg-or, --mg-no, ...): change them there to retune the look.
(function () {
  if (window.__magi) return;
  window.__magi = true;

  var el = function (tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  var tok = function () { try { return localStorage.getItem('token') || ''; } catch (e) { return ''; } };
  function api(url, method, body) {
    var h = { Authorization: 'Bearer ' + tok() };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); });
  }

  var DISPLAY = { melchior: 'MELCHIOR\u20221', balthasar: 'BALTHASAR\u20222', caspar: 'CASPER\u20223' };
  var KANJI = { APPROVED: '\u627f\u8a8d', DENIED: '\u5426\u6c7a', UNCLEAR: '\u4e0d\u660e', 'NO CONSENSUS': '\u6c7a\u8b70\u4e0d\u80fd' };
  var K_WAIT = '\u5be9\u8b70\u4e2d', K_IDLE = '\u5f85\u6a5f', K_OFF = '\u672a\u63a5\u7d9a', K_NONE = '\u5fdc\u7b54\u306a\u3057', K_RES = '\u6c7a\u8b70';

  var HEX = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='%23ff7a00' stroke-opacity='.16' stroke-width='1.5'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='%23ff7a00' stroke-opacity='.16' stroke-width='1.5'/%3E%3C/svg%3E";
  var CUT = 'polygon(5% 0,95% 0,100% 50%,95% 100%,5% 100%,0 50%)';

  var css = [
    // ---- NERV theme: applied to every page for this admin only.
    'html.nerv,html.nerv[data-theme],html.nerv.nerv{--bg:#0a0502;--txt:#ffd9b3;--muted:#c98a4f;--glass:rgba(255,110,0,.07);--glass2:rgba(255,110,0,.15);--edge:rgba(255,140,40,.5);--edge2:rgba(255,120,0,.2);--field:rgba(24,9,2,.85);--solid:#120803;--o1:rgba(255,100,0,.3);--o2:rgba(255,50,0,.2);--o3:rgba(255,170,0,.14);--a1:#ff7a00;--a2:#ff3d00;--acc:linear-gradient(135deg,#ff8a1f,#ff4d00 60%,#b52a00);--ok:#ffb347;--warn:#ffd23f;--bad:#ff3d00;--info:#ffa040;--font:ui-monospace,"Cascadia Mono",Menlo,Consolas,"Courier New",monospace;--blur:10px;--sh1:0 0 0 transparent;--sh2:0 0 24px #ff6a0033;--sh3:0 0 48px #ff6a0040;color-scheme:dark}',
    'html.nerv body{background:var(--bg)}',
    'html.nerv body:before{animation:none!important;inset:0;background:radial-gradient(60vmax 50vmax at 50% 0%,var(--o1),transparent 70%),radial-gradient(45vmax 40vmax at 100% 100%,var(--o2),transparent 70%)!important}',
    'html.nerv h1,html.nerv h2,html.nerv h3{text-transform:uppercase;letter-spacing:.06em}',
    'html.nerv .hero h2{background:none!important;-webkit-text-fill-color:var(--a1);color:var(--a1)}',
    'html.nerv .panel,html.nerv .glass,html.nerv .card,html.nerv .stat,html.nerv .kpi,html.nerv dialog,html.nerv main,html.nerv .nav,html.nerv .hero,html.nerv input,html.nerv select,html.nerv textarea,html.nerv button{border-radius:6px!important}',
    'html.nerv .nav{box-shadow:0 0 24px #ff6a0026}',
    'html.nerv .pill,html.nerv .badge,html.nerv .tag,html.nerv .stag{border-radius:3px!important}',
    'html.nerv .cat-title:before,html.nerv .tile.on,html.nerv .primary{box-shadow:0 0 16px #ff6a0066}',
    'html.nerv ::selection{background:#ff7a00;color:#120803}',

    // ---- Open button and NERV on/off switch
    '#magi-bar{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:46;display:flex;gap:8px;align-items:center}',
    '#magi-fab{min-height:0;padding:7px 26px;font-weight:800;letter-spacing:.3em;color:#000;background:#ff7a00;border:0;border-radius:0!important;clip-path:' + CUT + ';box-shadow:none}',
    '#nerv-tgl{min-height:0;padding:6px 12px;font:800 .72rem/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;white-space:nowrap;color:#fff;background:rgba(20,20,40,.82);border:1px solid rgba(255,255,255,.45);border-radius:999px;box-shadow:none}',
    'html.nerv #nerv-tgl{color:#ff7a00;background:#000;border:2px solid #ff7a00;border-radius:0!important}',

    // ---- MAGI display
    '#magi{--mg-or:#ff7a00;--mg-hi:#ffb347;--mg-no:#e5231b;--mg-dim:#8a4300;--mg-bk:#000;position:fixed;inset:0;z-index:700;display:none;overflow:auto;padding:16px 16px 56px;color:var(--mg-or);background:#000 url("' + HEX + '");font:700 14px/1.35 "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","MS PMincho",Georgia,"Times New Roman",serif;text-transform:uppercase}',
    '#magi.on{display:block;animation:mgIn .3s steps(4)}',
    '@keyframes mgIn{from{opacity:0}}',
    '#magi *{box-sizing:border-box;border-radius:0!important}',

    // hexagon-ended bar: the outer element is the orange frame, .mg-in is the black (or filled) inside
    '.mg-hx{position:relative;background:var(--mg-or);clip-path:' + CUT + ';padding:3px}',
    '.mg-hx>.mg-in{position:relative;height:100%;background:var(--mg-bk);clip-path:' + CUT + ';padding:12px 8%;display:flex;flex-direction:column;justify-content:center;gap:2px}',
    '.mg-hx.ap>.mg-in{background:var(--mg-or);color:#000}',
    '.mg-hx.dn{background:var(--mg-no)}',
    '.mg-hx.dn>.mg-in{background:var(--mg-no);color:#000}',
    '.mg-hx.off{background:var(--mg-dim)}',
    '.mg-hx.off>.mg-in{color:var(--mg-dim)}',

    // top row: title bar and the system data block
    '.mg-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:stretch;margin:0 0 18px}',
    '.mg-title{min-height:104px}',
    '.mg-title .mg-in{align-items:center;text-align:center}',
    '.mg-title b{font-size:clamp(1.8rem,6vw,3.4rem);letter-spacing:.14em;line-height:1;font-weight:900;transform:scaleX(.82)}',
    '.mg-title small{font-size:.7rem;letter-spacing:.3em;color:var(--mg-hi)}',
    '.mg-data{align-self:center;padding:8px 14px;border:2px solid var(--mg-or);font-size:.78rem;letter-spacing:.14em;line-height:1.5;background:#000}',
    '.mg-data div:first-child{color:var(--mg-hi)}',
    '.mg-close{align-self:start;min-height:0;padding:8px 14px;color:var(--mg-or);background:#000;border:2px solid var(--mg-or);font:inherit;font-size:.78rem;letter-spacing:.2em;cursor:pointer}',

    // the three nodes
    '.mg-nodes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:start}',
    '.mg-node{display:flex;flex-direction:column;gap:8px;min-width:0}',
    '.mg-node .mg-hx{min-height:170px}',
    '.mg-nm{font-size:1.05rem;letter-spacing:.12em;font-weight:900;text-align:center}',
    '.mg-st{font-size:clamp(2.4rem,7vw,4rem);line-height:1.05;text-align:center;font-weight:900;letter-spacing:.08em}',
    '.mg-st.small{font-size:clamp(1.4rem,4vw,2.2rem)}',
    '.mg-en{font-size:.74rem;letter-spacing:.3em;text-align:center}',
    '.mg-sub{font-size:.62rem;letter-spacing:.16em;text-align:center;opacity:.85}',
    '.mg-hx.busy .mg-st{animation:mgBlink .7s steps(2) infinite}',
    '@keyframes mgBlink{50%{opacity:.15}}',
    '.mg-log{max-height:150px;overflow:auto;padding:8px 10px;border-left:3px solid var(--mg-or);background:#000;color:var(--mg-hi);font:500 12px/1.45 ui-monospace,Menlo,Consolas,monospace;text-transform:none;white-space:pre-wrap;word-break:break-word}',
    '.mg-log:empty{display:none}',
    '.mg-log.err{color:#ff6a4d;border-color:var(--mg-no)}',

    // consensus: one wide hexagon, like the resolution panel
    '.mg-res{max-width:760px;margin:22px auto 0}',
    '.mg-res .mg-in{flex-direction:row;align-items:center;justify-content:space-between;gap:16px;padding:14px 9%}',
    '.mg-res-l{font-size:1.5rem;letter-spacing:.3em;font-weight:900}',
    '.mg-res-c{text-align:right}',
    '.mg-res-c .mg-st{text-align:right;font-size:clamp(2.2rem,7vw,3.6rem)}',
    '.mg-res-c .mg-en{text-align:right}',

    // query bar
    '.mg-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;max-width:760px;margin:22px auto 0;align-items:stretch}',
    '.mg-form textarea{width:100%;margin:0;min-height:64px;padding:10px 12px;color:var(--mg-hi);background:#000;border:2px solid var(--mg-or);font:500 14px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;resize:vertical;box-shadow:none}',
    '.mg-form textarea:focus{outline:none;box-shadow:0 0 0 2px #ff7a0066}',
    '.mg-run{min-height:0;padding:0 26px;color:#000;background:var(--mg-or);border:0;font:900 .95rem/1 inherit;letter-spacing:.24em;cursor:pointer;clip-path:' + CUT + '}',
    '.mg-run:disabled{opacity:.5}',
    '.mg-hint{grid-column:1/-1;font-size:.64rem;letter-spacing:.2em;color:var(--mg-dim)}',

    '@media (max-width:860px){.mg-nodes{grid-template-columns:1fr}.mg-head{grid-template-columns:1fr}.mg-data{justify-self:start}.mg-form{grid-template-columns:1fr}.mg-run{min-height:48px}.mg-res .mg-in{padding:12px 7%}}',
    '@media (prefers-reduced-motion:reduce){.mg-hx.busy .mg-st,#magi.on{animation:none}}',
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'magi-css';
  style.textContent = css;
  document.head.appendChild(style);
  var PREF = 'magi_nerv';
  function nervOn() { try { return localStorage.getItem(PREF) !== '0'; } catch (e) { return true; } }
  function applyNerv(on) { document.documentElement.classList.toggle('nerv', on); try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) {} }
  document.documentElement.classList.toggle('nerv', nervOn());

  // ---- Open button and overlay
  var bar = el('div');
  bar.id = 'magi-bar';
  var fab = el('button', null, 'MAGI');
  fab.id = 'magi-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open MAGI system');
  var tgl = el('button');
  tgl.id = 'nerv-tgl';
  tgl.type = 'button';
  function label() { var on = document.documentElement.classList.contains('nerv'); tgl.textContent = on ? 'NERV: ON' : 'NERV: OFF'; tgl.setAttribute('aria-pressed', on ? 'true' : 'false'); tgl.setAttribute('aria-label', 'NERV colours ' + (on ? 'on, switch to the normal theme' : 'off, switch to NERV')); }
  label();
  tgl.addEventListener('click', function () { applyNerv(!document.documentElement.classList.contains('nerv')); label(); });
  bar.appendChild(fab);
  bar.appendChild(tgl);
  document.body.appendChild(bar);

  var box = el('div');
  box.id = 'magi';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'MAGI system');
  document.body.appendChild(box);

  // header: title bar + system data block + close
  var head = el('div', 'mg-head');
  var title = el('div', 'mg-hx mg-title');
  var titleIn = el('div', 'mg-in');
  titleIn.appendChild(el('b', null, 'MAGI SYSTEM'));
  titleIn.appendChild(el('small', null, 'DECISION PROTOCOL \u00b7 MAJORITY 2 OF 3'));
  title.appendChild(titleIn);
  var side = el('div');
  var data = el('div', 'mg-data');
  ['CODE:473', 'FILE:MAGI_SYS', 'EXTENTION:3003', 'EX_MODE:OFF', 'PRIORITY:AAA'].forEach(function (t) { data.appendChild(el('div', null, t)); });
  var close = el('button', 'mg-close', 'CLOSE');
  close.type = 'button';
  side.appendChild(data);
  var headRight = el('div');
  headRight.style.cssText = 'display:flex;flex-direction:column;gap:10px;align-items:flex-end';
  headRight.appendChild(close);
  headRight.appendChild(data);
  head.appendChild(title);
  head.appendChild(headRight);
  box.appendChild(head);

  var nodesWrap = el('div', 'mg-nodes');
  box.appendChild(nodesWrap);

  // resolution panel
  var res = el('div', 'mg-hx mg-res');
  var resIn = el('div', 'mg-in');
  var resL = el('div', 'mg-res-l', K_RES);
  var resC = el('div', 'mg-res-c');
  var resBig = el('div', 'mg-st', K_IDLE);
  var resEn = el('div', 'mg-en', 'STANDBY');
  resC.appendChild(resBig);
  resC.appendChild(resEn);
  resIn.appendChild(resL);
  resIn.appendChild(resC);
  res.appendChild(resIn);
  box.appendChild(res);

  // query bar
  var form = el('div', 'mg-form');
  var ta = el('textarea');
  ta.placeholder = 'ENTER QUERY FOR THE MAGI (yes / no question works best)';
  ta.maxLength = 1000;
  ta.setAttribute('aria-label', 'Query for the MAGI');
  var run = el('button', 'mg-run', 'EXECUTE');
  run.type = 'button';
  form.appendChild(ta);
  form.appendChild(run);
  form.appendChild(el('div', 'mg-hint', 'CTRL+ENTER TO EXECUTE \u00b7 ESC TO CLOSE'));
  box.appendChild(form);

  var cards = {};

  function paint(c, mode, kanji, en, sub, log, isErr) {
    c.hx.className = 'mg-hx' + (mode ? ' ' + mode : '');
    c.st.textContent = kanji;
    c.st.className = 'mg-st' + (kanji.length > 2 ? ' small' : '');
    c.en.textContent = en;
    c.sub.textContent = sub || '';
    c.log.textContent = log || '';
    c.log.className = 'mg-log' + (isErr ? ' err' : '');
  }

  function buildNodes(list) {
    nodesWrap.textContent = '';
    cards = {};
    list.forEach(function (n) {
      var wrap = el('div', 'mg-node');
      var hx = el('div', 'mg-hx');
      var inn = el('div', 'mg-in');
      var nm = el('div', 'mg-nm', DISPLAY[n.id] || n.name);
      var st = el('div', 'mg-st');
      var en = el('div', 'mg-en');
      var sub = el('div', 'mg-sub');
      inn.appendChild(nm);
      inn.appendChild(st);
      inn.appendChild(en);
      inn.appendChild(sub);
      hx.appendChild(inn);
      var log = el('div', 'mg-log');
      wrap.appendChild(hx);
      wrap.appendChild(log);
      nodesWrap.appendChild(wrap);
      var c = { hx: hx, st: st, en: en, sub: sub, log: log, enabled: n.enabled, tag: n.role + ' \u00b7 ' + n.provider + ' \u00b7 ' + (n.model || '') };
      cards[n.id] = c;
      if (n.enabled) paint(c, '', K_IDLE, 'STANDBY', c.tag); else paint(c, 'off', K_OFF, 'NO KEY', c.tag);
    });
  }

  function setBusy(c) { paint(c, 'busy', K_WAIT, 'DELIBERATING', c.tag, ''); }

  function showResult(r) {
    var c = cards[r.id];
    if (!c) return;
    if (r.ok) {
      var mode = r.verdict === 'APPROVED' ? 'ap' : r.verdict === 'DENIED' ? 'dn' : '';
      var sub = (r.revised ? 'REVISED FROM ' + r.initial + ' \u00b7 ' : '') + (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + (r.model || '');
      paint(c, mode, KANJI[r.verdict] || KANJI.UNCLEAR, r.verdict, sub, r.text || '');
    } else {
      paint(c, 'off', K_NONE, 'NO RESPONSE', c.tag, r.error || 'Node did not respond.', true);
    }
  }

  function setResolution(d) {
    var mode = d.decision === 'APPROVED' ? 'ap' : d.decision === 'DENIED' ? 'dn' : '';
    res.className = 'mg-hx mg-res' + (mode ? ' ' + mode : '');
    resBig.textContent = KANJI[d.decision] || d.decision;
    resBig.className = 'mg-st' + ((KANJI[d.decision] || '').length > 2 ? ' small' : '');
    resEn.textContent = d.decision + ' \u00b7 ' + d.approved + ' APPROVED / ' + d.denied + ' DENIED \u00b7 ' + d.responded + ' RESPONDED';
  }

  var busy = false;
  function execute() {
    var q = ta.value.trim();
    if (!q || busy) return;
    busy = true;
    run.disabled = true;
    run.textContent = 'RUNNING';
    res.className = 'mg-hx mg-res busy';
    resBig.textContent = K_WAIT;
    resBig.className = 'mg-st small';
    resEn.textContent = 'DELIBERATING';
    Object.keys(cards).forEach(function (id) { if (cards[id].enabled) setBusy(cards[id]); });
    api('/api/admin/magi', 'POST', { question: q }).then(function (d) {
      (d.results || []).forEach(showResult);
      setResolution(d);
    }).catch(function (e) {
      res.className = 'mg-hx mg-res dn';
      resBig.textContent = 'ERROR';
      resBig.className = 'mg-st small';
      resEn.textContent = e.message || 'Request failed';
    }).then(function () {
      busy = false;
      run.disabled = false;
      run.textContent = 'EXECUTE';
    });
  }

  function open() {
    box.classList.add('on');
    document.body.style.overflow = 'hidden';
    api('/api/admin/magi/status').then(function (d) {
      buildNodes(d.nodes || []);
      var live = (d.nodes || []).filter(function (n) { return n.enabled; }).length;
      res.className = 'mg-hx mg-res';
      resBig.textContent = live < 2 ? K_OFF : K_IDLE;
      resBig.className = 'mg-st small';
      resEn.textContent = live < 2 ? 'NO QUORUM \u00b7 NODES ONLINE ' + live + ' / ' + (d.nodes || []).length : 'STANDBY \u00b7 NODES ONLINE ' + live + ' / ' + (d.nodes || []).length;
    }).catch(function (e) {
      resEn.textContent = e.message || 'Could not load MAGI status';
    });
    setTimeout(function () { ta.focus(); }, 60);
  }
  function shut() {
    box.classList.remove('on');
    document.body.style.overflow = '';
    fab.focus();
  }

  fab.addEventListener('click', open);
  close.addEventListener('click', shut);
  run.addEventListener('click', execute);
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); execute(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('on')) shut(); });
})();
