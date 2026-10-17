// MAGI console (admin only), loaded by index.html for the admin role.
//  - It lives INSIDE the admin Dashboard (above the numbers) and appears only while NERV mode is on.
//  - NERV mode recolours the whole site (black / orange / red). Switch it with the NERV button in the header
//    or, on a phone, with the strip at the top of the Dashboard. The choice is remembered on this device.
//  - Every node (Melchior / Balthasar / Casper) can be linked to any AI provider that has a key on the server.
// Uses textContent for everything that comes from the server, so an AI answer can never inject HTML.
// Colours are CSS variables on #magi-dash (--mg-or, --mg-no, ...): change them there to retune the look.
(function () {
  if (window.__magi) return;
  window.__magi = true;

  var el = function (tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  var tok = function () { try { return localStorage.getItem('token') || ''; } catch (e) { return ''; } };
  var me = function () { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { return null; } };
  var isAdminNow = function () { var u = me(); return !!(u && u.role === 'admin' && tok()); };
  function api(url, method, body) {
    var h = { Authorization: 'Bearer ' + tok() };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); });
  }

  var DISPLAY = { melchior: 'MELCHIOR\u20221', balthasar: 'BALTHASAR\u20222', caspar: 'CASPER\u20223' };
  var KATA = { melchior: '\u30e1\u30eb\u30ad\u30aa\u30fc\u30eb', balthasar: '\u30d0\u30eb\u30bf\u30b6\u30fc\u30eb', caspar: '\u30ab\u30b9\u30d1\u30fc' };
  var KANJI = { APPROVED: '\u627f\u8a8d', DENIED: '\u5426\u6c7a', UNCLEAR: '\u4e0d\u660e', 'NO CONSENSUS': '\u6c7a\u8b70\u4e0d\u80fd' };
  var K_WAIT = '\u5be9\u8b70\u4e2d', K_IDLE = '\u5f85\u6a5f', K_OFF = '\u672a\u63a5\u7d9a', K_NONE = '\u5fdc\u7b54\u306a\u3057', K_RES = '\u6c7a\u8b70';
  var K_MAGI = '\u9b54\u8853\u5e2b', K_LINK = '\u63a5\u7d9a', K_WARN = '\u8b66\u544a';

  var HEX = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='%23ff7a00' stroke-opacity='.16' stroke-width='1.5'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='%23ff7a00' stroke-opacity='.16' stroke-width='1.5'/%3E%3C/svg%3E";
  var CUT = 'polygon(5% 0,95% 0,100% 50%,95% 100%,5% 100%,0 50%)';
  var CHAMFER = 'polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))';

  var css = [
    // ===== NERV theme: recolours the whole site for this admin only =====
    'html.nerv,html.nerv[data-theme],html.nerv.nerv{--bg:#0a0502;--txt:#ffd9b3;--muted:#c98a4f;--glass:rgba(255,110,0,.07);--glass2:rgba(255,110,0,.15);--edge:rgba(255,140,40,.5);--edge2:rgba(255,120,0,.2);--field:rgba(24,9,2,.85);--solid:#120803;--o1:rgba(255,100,0,.3);--o2:rgba(255,50,0,.2);--o3:rgba(255,170,0,.14);--a1:#ff7a00;--a2:#ff3d00;--acc:linear-gradient(135deg,#ff8a1f,#ff4d00 60%,#b52a00);--ok:#ffb347;--warn:#ffd23f;--bad:#ff3d00;--info:#ffa040;--font:ui-monospace,"Cascadia Mono",Menlo,Consolas,"Courier New",monospace;--blur:10px;--sh1:0 0 0 transparent;--sh2:0 0 24px #ff6a0033;--sh3:0 0 48px #ff6a0040;color-scheme:dark}',
    'html.nerv body{background:var(--bg) url("__HEX__")}',
    'html.nerv body:before{animation:none!important;inset:0;background:radial-gradient(60vmax 50vmax at 50% 0%,var(--o1),transparent 70%),radial-gradient(45vmax 40vmax at 100% 100%,var(--o2),transparent 70%)!important}',
    'html.nerv h1,html.nerv h2,html.nerv h3{text-transform:uppercase;letter-spacing:.06em}',
    'html.nerv .hero h2{background:none!important;-webkit-text-fill-color:var(--a1);color:var(--a1)}',
    'html.nerv .panel,html.nerv .glass,html.nerv .card,html.nerv .stat,html.nerv .kpi,html.nerv dialog,html.nerv main,html.nerv .nav,html.nerv .hero,html.nerv input,html.nerv select,html.nerv textarea,html.nerv button{border-radius:6px!important}',
    'html.nerv .nav{box-shadow:0 0 24px #ff6a0026}',
    'html.nerv .pill,html.nerv .badge,html.nerv .tag,html.nerv .stag{border-radius:3px!important}',
    'html.nerv .cat-title:before,html.nerv .tile.on,html.nerv .primary{box-shadow:0 0 16px #ff6a0066}',
    'html.nerv ::selection{background:#ff7a00;color:#120803}',

    // ===== NERV button in the header =====
    '.mg-hdr{min-height:0;padding:6px 10px;font:800 .7rem/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;white-space:nowrap;color:inherit;background:transparent;border:1px solid currentColor;border-radius:999px;cursor:pointer;box-shadow:none}',
    '.mg-hdr:before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border:1.5px solid currentColor;border-radius:50%;vertical-align:1px}',
    '.mg-hdr.is-on:before{background:currentColor;box-shadow:0 0 8px currentColor}',
    'html.nerv .mg-hdr{color:#ff7a00;background:#000;border:2px solid #ff7a00;border-radius:0!important}',

    // ===== the MAGI block in the Dashboard =====
    '#magi-dash{--mg-or:#ff7a00;--mg-hi:#ffb347;--mg-no:#e5231b;--mg-dim:#8a4300;--mg-bk:#000;--mg-gr:#7dff4a;--mg-pu:#9b4dff;margin:0 0 18px;color:var(--mg-or);font:700 14px/1.35 "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","MS PMincho",Georgia,"Times New Roman",serif;text-transform:uppercase}',
    '#magi-dash *{box-sizing:border-box;border-radius:0!important}',
    '#magi-dash button,#magi-dash select,#magi-dash input,#magi-dash textarea{font-family:inherit}',
    '#magi-dash .mg-btn{min-height:0;padding:8px 14px;color:var(--mg-or);background:#000;border:2px solid var(--mg-or);font-weight:800;font-size:.72rem;letter-spacing:.18em;cursor:pointer;box-shadow:none;text-transform:uppercase}',
    '#magi-dash .mg-btn:hover{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn.solid{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn:disabled{opacity:.45;cursor:default}',

    // NERV off: only a thin strip with the switch
    '.mg-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;background:#0a0502;border:1px solid #5b2d00;color:#ffb347}',
    '.mg-strip span{font-size:.72rem;letter-spacing:.2em}',
    '#magi-dash.on .mg-strip{display:none}',

    // NERV on: the panel
    '.mg-panel{position:relative;display:none;padding:14px;background:#000 url("__HEX__");border:2px solid var(--mg-or);box-shadow:0 0 28px #ff6a0040,inset 0 0 40px #ff6a001a;overflow:hidden;clip-path:__CHAMFER__}',
    '#magi-dash.on .mg-panel{display:block}',
    '.mg-panel:after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px)}',
    '.mg-sweep{position:absolute;left:0;right:0;top:0;height:60px;pointer-events:none;background:linear-gradient(to bottom,transparent,rgba(255,122,0,.11),transparent);animation:mgSweep 7s linear infinite}',
    '@keyframes mgSweep{from{transform:translateY(-100%)}to{transform:translateY(1800%)}}',
    '#magi-dash.alert .mg-panel{animation:mgAlert .45s steps(2) 5}',
    '@keyframes mgAlert{50%{border-color:var(--mg-no);box-shadow:0 0 44px #e5231b99,inset 0 0 60px #e5231b55}}',
    '.mg-panel>*{position:relative;z-index:1}',
    '.mg-panel>.mg-sweep{position:absolute;z-index:0}',

    // hexagon-ended bar: the outer element is the orange frame, .mg-in is the black (or filled) inside
    '.mg-hx{position:relative;display:flex;background:var(--mg-or);clip-path:__CUT__;padding:3px}',
    '.mg-hx>.mg-in{position:relative;flex:1;min-width:0;background:var(--mg-bk);clip-path:__CUT__;padding:12px 8%;display:flex;flex-direction:column;justify-content:center;gap:2px}',
    '.mg-hx.ap>.mg-in{background:var(--mg-or);color:#000}',
    '.mg-hx.dn{background:var(--mg-no)}',
    '.mg-hx.dn>.mg-in{background:var(--mg-no);color:#000}',
    '.mg-hx.off{background:var(--mg-dim)}',
    '.mg-hx.off>.mg-in{color:var(--mg-dim)}',

    // hazard strip and ticker
    '.mg-haz{height:9px;margin:0 0 10px;background:repeating-linear-gradient(-45deg,var(--mg-or) 0 9px,#000 9px 18px)}',
    '.mg-tick{overflow:hidden;white-space:nowrap;font-size:.64rem;letter-spacing:.3em;color:var(--mg-dim);margin:0 0 12px;border-top:1px solid var(--mg-dim);border-bottom:1px solid var(--mg-dim);padding:4px 0}',
    '.mg-tick i{display:inline-block;font-style:normal;padding-left:100%;animation:mgTick 34s linear infinite}',
    '@keyframes mgTick{to{transform:translateX(-100%)}}',

    // header: title | core | buttons + data
    '.mg-head{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:16px;align-items:center;margin:0 0 14px}',
    '.mg-title{min-height:104px}',
    '.mg-title .mg-in{align-items:center;text-align:center}',
    '.mg-title b{font-size:clamp(1.3rem,3.2vw,2.8rem);letter-spacing:.12em;line-height:1;font-weight:900;transform:scaleX(.82);white-space:nowrap}',
    '.mg-title small{font-size:.6rem;letter-spacing:.2em;color:var(--mg-hi);text-align:center}',
    '.mg-title em{font-style:normal;font-size:.62rem;letter-spacing:.4em;color:var(--mg-dim)}',
    '.mg-side{display:flex;flex-direction:column;gap:10px;align-items:flex-end}',
    '.mg-side .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
    '.mg-data{padding:8px 14px;border:2px solid var(--mg-or);font-size:.72rem;letter-spacing:.14em;line-height:1.5;background:#000}',
    '.mg-data div:first-child{color:var(--mg-hi)}',

    // the AI core: rings turn faster while the nodes deliberate
    '.mg-core{width:150px;height:150px}',
    '.mg-core svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 8px #ff6a0066)}',
    '.mg-core .r1,.mg-core .r2,.mg-core .r3,.mg-core .pulse{transform-origin:100px 100px}',
    '.mg-core .r1{animation:mgSpin 26s linear infinite}',
    '.mg-core .r2{animation:mgSpin 18s linear infinite reverse}',
    '.mg-core .r3{animation:mgSpin 11s linear infinite}',
    '.mg-core .pulse{animation:mgPulse 2.4s ease-in-out infinite}',
    '.mg-core .tri{animation:mgDash 2.4s linear infinite}',
    '#magi-dash.busy .r1{animation-duration:4s}#magi-dash.busy .r2{animation-duration:3s}#magi-dash.busy .r3{animation-duration:2s}#magi-dash.busy .pulse{animation-duration:.6s}#magi-dash.busy .tri{animation-duration:.5s}',
    '.mg-core .nd{fill:var(--mg-or)}.mg-core .nd.dn{fill:var(--mg-no)}.mg-core .nd.off{fill:var(--mg-dim)}',
    '@keyframes mgSpin{to{transform:rotate(360deg)}}',
    '@keyframes mgPulse{50%{transform:scale(1.35);opacity:.45}}',
    '@keyframes mgDash{to{stroke-dashoffset:-24}}',

    // the three nodes
    '.mg-nodes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}',
    '.mg-node{display:flex;flex-direction:column;gap:8px;min-width:0}',
    '.mg-node .mg-hx{min-height:196px}',
    '.mg-nm{font-size:1.02rem;letter-spacing:.12em;font-weight:900;text-align:center}',
    '.mg-kt{font-size:.58rem;letter-spacing:.34em;text-align:center;color:var(--mg-dim)}',
    '.mg-hx.ap .mg-kt,.mg-hx.dn .mg-kt{color:#000}',
    '.mg-st{font-size:clamp(2.2rem,6vw,3.6rem);line-height:1.05;text-align:center;font-weight:900;letter-spacing:.08em}',
    '.mg-st.small{font-size:clamp(1.3rem,3.6vw,2rem)}',
    '.mg-en{font-size:.72rem;letter-spacing:.3em;text-align:center}',
    '.mg-sub{font-size:.6rem;letter-spacing:.14em;text-align:center;opacity:.85;word-break:break-all}',
    '.mg-hx.busy .mg-st{animation:mgBlink .7s steps(2) infinite}',
    '@keyframes mgBlink{50%{opacity:.15}}',
    '.mg-wave{display:none;gap:3px;height:14px;align-items:flex-end;justify-content:center;margin-top:2px}',
    '.mg-hx.busy .mg-wave{display:flex}',
    '.mg-wave i{width:4px;height:100%;background:var(--mg-hi);transform-origin:bottom;animation:mgWave .9s ease-in-out infinite}',
    '.mg-wave i:nth-child(2){animation-delay:.1s}.mg-wave i:nth-child(3){animation-delay:.2s}.mg-wave i:nth-child(4){animation-delay:.3s}.mg-wave i:nth-child(5){animation-delay:.4s}.mg-wave i:nth-child(6){animation-delay:.5s}',
    '@keyframes mgWave{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(1)}}',
    '.mg-meter{height:4px;background:#2a1300;margin-top:6px}',
    '.mg-meter b{display:block;height:100%;width:var(--w,0%);background:currentColor;transition:width .6s steps(8)}',
    '.mg-log{max-height:150px;overflow:auto;padding:8px 10px;border-left:3px solid var(--mg-or);background:#000;color:var(--mg-hi);font:500 12px/1.45 ui-monospace,Menlo,Consolas,monospace;text-transform:none;white-space:pre-wrap;word-break:break-word}',
    '.mg-log:empty{display:none}',
    '.mg-log.err{color:#ff6a4d;border-color:var(--mg-no)}',

    // provider switch under each node
    '.mg-ctl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;align-items:center;padding:8px;border:1px solid var(--mg-dim);background:#050200}',
    '.mg-ctl label{font-size:.58rem;letter-spacing:.22em;color:var(--mg-hi)}',
    '.mg-ctl select,.mg-ctl input{width:100%;min-height:0;margin:0;padding:6px 8px;color:var(--mg-hi);background:#000;border:1px solid var(--mg-or);font:500 12px/1.3 ui-monospace,Menlo,Consolas,monospace;text-transform:none;box-shadow:none}',
    '.mg-ctl select option{background:#000;color:var(--mg-hi)}',
    '.mg-ctl select:focus,.mg-ctl input:focus{outline:none;box-shadow:0 0 0 2px #ff7a0066}',
    '.mg-acts{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}',
    '#magi-dash .mg-acts .mg-btn{padding:6px 10px;font-size:.64rem}',
    '.mg-out{grid-column:1/-1;font:500 11px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;color:var(--mg-hi);min-height:1.4em;word-break:break-word}',
    '.mg-out.err{color:#ff6a4d}.mg-out.ok{color:var(--mg-gr)}',

    // resolution: one wide hexagon, like the resolution panel
    '.mg-res{max-width:760px;margin:20px auto 0}',
    '.mg-res .mg-in{flex-direction:row;align-items:center;justify-content:space-between;gap:16px;padding:14px 9%}',
    '.mg-res-l{font-size:1.4rem;letter-spacing:.3em;font-weight:900}',
    '.mg-res-c{text-align:right}',
    '.mg-res-c .mg-st{text-align:right;font-size:clamp(2rem,6vw,3.2rem)}',
    '.mg-res-c .mg-en{text-align:right}',
    '.mg-res.ap .mg-st,.mg-res.dn .mg-st{animation:mgStamp .35s steps(5) 1}',
    '@keyframes mgStamp{from{transform:scale(1.7);opacity:0}}',
    '.mg-pips{display:flex;gap:10px;justify-content:center;margin:10px 0 0}',
    '.mg-pips i{width:11px;height:11px;border:2px solid var(--mg-or);transform:rotate(45deg)}',
    '.mg-pips i.ap{background:var(--mg-or)}.mg-pips i.dn{background:var(--mg-no);border-color:var(--mg-no)}.mg-pips i.off{border-color:var(--mg-dim)}',

    // query bar
    '.mg-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;max-width:760px;margin:18px auto 0;align-items:stretch}',
    '.mg-form textarea{width:100%;margin:0;min-height:64px;padding:10px 12px;color:var(--mg-hi);background:#000;border:2px solid var(--mg-or);font:500 14px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;resize:vertical;box-shadow:none}',
    '.mg-form textarea:focus{outline:none;box-shadow:0 0 0 2px #ff7a0066}',
    '.mg-run{min-height:0;padding:0 26px;color:#000;background:var(--mg-or);border:0;font:900 .95rem/1 inherit;letter-spacing:.24em;cursor:pointer;clip-path:__CUT__}',
    '.mg-run:disabled{opacity:.5}',
    '.mg-chips{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}',
    '#magi-dash .mg-chips .mg-btn{padding:5px 10px;font-size:.6rem;border-width:1px;text-transform:none;letter-spacing:.06em;font-weight:600}',
    '.mg-hint{grid-column:1/-1;font-size:.62rem;letter-spacing:.2em;color:var(--mg-dim)}',

    // expanded: fills the whole screen
    '#magi-dash.max{position:fixed;inset:0;z-index:700;margin:0;padding:16px 16px 56px;overflow:auto;background:#000 url("__HEX__")}',
    '#magi-dash.max .mg-panel{max-width:1180px;margin:0 auto}',

    '@media (max-width:860px){.mg-nodes{grid-template-columns:1fr}.mg-head{grid-template-columns:minmax(0,1fr) 96px}.mg-core{width:96px;height:96px}.mg-side{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:flex-start}.mg-form{grid-template-columns:1fr}.mg-run{min-height:48px}.mg-res .mg-in{padding:12px 7%}.mg-res-l{font-size:1.05rem;letter-spacing:.12em}}',
    '@media (prefers-reduced-motion:reduce){#magi-dash *{animation:none!important}}',
  ].join('\n').split('__HEX__').join(HEX).split('__CUT__').join(CUT).split('__CHAMFER__').join(CHAMFER);
  var style = document.createElement('style');
  style.id = 'magi-css';
  style.textContent = css;
  document.head.appendChild(style);

  // ===== NERV mode (remembered on this device; on unless it was switched off) =====
  var PREF = 'magi_nerv';
  function nervOn() { try { return localStorage.getItem(PREF) !== '0'; } catch (e) { return true; } }

  // ===== the block that sits in the Dashboard =====
  var root = el('div');
  root.id = 'magi-dash';

  var strip = el('div', 'mg-strip');
  strip.appendChild(el('span', null, 'NERV MODE OFF \u00b7 MAGI SYSTEM STANDBY'));
  var stripBtn = el('button', 'mg-btn solid', 'ACTIVATE NERV MODE');
  stripBtn.type = 'button';
  strip.appendChild(stripBtn);
  root.appendChild(strip);

  var panel = el('div', 'mg-panel');
  panel.appendChild(el('div', 'mg-sweep'));
  root.appendChild(panel);

  panel.appendChild(el('div', 'mg-haz'));

  var head = el('div', 'mg-head');
  var title = el('div', 'mg-hx mg-title');
  var titleIn = el('div', 'mg-in');
  titleIn.appendChild(el('b', null, 'MAGI SYSTEM'));
  titleIn.appendChild(el('small', null, 'DECISION PROTOCOL \u00b7 MAJORITY 2 OF 3'));
  titleIn.appendChild(el('em', null, K_MAGI + ' \u00b7 ' + K_LINK));
  title.appendChild(titleIn);
  head.appendChild(title);

  var core = el('div', 'mg-core');
  core.setAttribute('aria-hidden', 'true');
  // static artwork, no user data: three turning hexagon rings, the triangle between the three nodes and a pulsing core
  core.innerHTML = '<svg viewBox="0 0 200 200">' +
    '<g class="r1"><polygon points="100,10 177.9,55 177.9,145 100,190 22.1,145 22.1,55" fill="none" stroke="#ff7a00" stroke-width="2" stroke-dasharray="14 6"/></g>' +
    '<g class="r2"><polygon points="100,34 157.2,67 157.2,133 100,166 42.8,133 42.8,67" fill="none" stroke="#9b4dff" stroke-width="2"/></g>' +
    '<g class="r3"><polygon points="100,58 136.4,79 136.4,121 100,142 63.6,121 63.6,79" fill="none" stroke="#ffb347" stroke-width="1.5" stroke-dasharray="4 4"/></g>' +
    '<polygon class="tri" points="100,38 150,126 50,126" fill="none" stroke="#ff7a00" stroke-width="1.5" stroke-dasharray="6 6" opacity=".75"/>' +
    '<circle class="nd" cx="100" cy="38" r="6"/><circle class="nd" cx="150" cy="126" r="6"/><circle class="nd" cx="50" cy="126" r="6"/>' +
    '<circle class="pulse" cx="100" cy="100" r="12" fill="#7dff4a"/><circle cx="100" cy="100" r="5" fill="#000"/></svg>';
  head.appendChild(core);
  var dots = core.querySelectorAll('.nd');

  var side = el('div', 'mg-side');
  var sideRow = el('div', 'row');
  var maxBtn = el('button', 'mg-btn', 'EXPAND');
  maxBtn.type = 'button';
  var offBtn = el('button', 'mg-btn', 'NERV: ON');
  offBtn.type = 'button';
  sideRow.appendChild(maxBtn);
  sideRow.appendChild(offBtn);
  var data = el('div', 'mg-data');
  ['CODE:473', 'FILE:MAGI_SYS', 'EXTENTION:3003', 'EX_MODE:OFF', 'PRIORITY:AAA'].forEach(function (t) { data.appendChild(el('div', null, t)); });
  side.appendChild(sideRow);
  side.appendChild(data);
  head.appendChild(side);
  panel.appendChild(head);

  var tick = el('div', 'mg-tick');
  tick.appendChild(el('i', null, 'MAGI SYSTEM ONLINE  \u00b7  ' + K_WARN + ': VERDICTS ARE ADVICE, YOU DECIDE  \u00b7  PROVIDER LINK: SWITCH ANY NODE BELOW  \u00b7  MELCHIOR \u00b7 BALTHASAR \u00b7 CASPER  \u00b7  '));
  panel.appendChild(tick);

  var nodesWrap = el('div', 'mg-nodes');
  panel.appendChild(nodesWrap);

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
  panel.appendChild(res);
  var pips = el('div', 'mg-pips');
  panel.appendChild(pips);

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
  var chips = el('div', 'mg-chips');
  ['Should I run a promo this weekend?', 'Is it safe to raise prices by 5%?', 'Should I restock the best seller now?'].forEach(function (t) {
    var c = el('button', 'mg-btn', t);
    c.type = 'button';
    c.addEventListener('click', function () { ta.value = t; ta.focus(); });
    chips.appendChild(c);
  });
  form.appendChild(chips);
  form.appendChild(el('div', 'mg-hint', 'CTRL+ENTER TO EXECUTE \u00b7 ESC TO COLLAPSE'));
  panel.appendChild(form);

  // ===== header switch =====
  var hdrTgl = el('button', 'mg-hdr');
  hdrTgl.type = 'button';
  var tools = document.querySelector('.nav .tools') || document.querySelector('.tools');
  if (tools) tools.insertBefore(hdrTgl, document.getElementById('theme') || null);

  function syncToggles() {
    var on = root.classList.contains('on');
    hdrTgl.textContent = 'NERV';
    hdrTgl.classList.toggle('is-on', on);
    hdrTgl.setAttribute('aria-pressed', on ? 'true' : 'false');
    hdrTgl.setAttribute('aria-label', 'NERV mode ' + (on ? 'on, switch to the normal theme' : 'off, switch to NERV'));
    hdrTgl.title = on ? 'Back to the normal colours' : 'NERV mode: new colours and the MAGI system';
  }
  function applyState() {
    var admin = isAdminNow(), on = admin && nervOn();
    document.documentElement.classList.toggle('nerv', on);
    root.classList.toggle('on', on);
    hdrTgl.style.display = admin ? '' : 'none';
    if (!admin || !on) collapse();
    syncToggles();
    place();
  }
  function setNerv(on) {
    try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) { /* storage blocked: it just will not be remembered */ }
    applyState();
  }
  hdrTgl.addEventListener('click', function () { setNerv(!root.classList.contains('on')); });
  stripBtn.addEventListener('click', function () { setNerv(true); });
  offBtn.addEventListener('click', function () { setNerv(false); });

  // ===== expand to full screen =====
  function expand() {
    root.classList.add('max');
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    maxBtn.textContent = 'COLLAPSE';
  }
  function collapse() {
    if (!root.classList.contains('max')) return;
    root.classList.remove('max');
    document.body.style.overflow = '';
    maxBtn.textContent = 'EXPAND';
    place();
  }
  maxBtn.addEventListener('click', function () { if (root.classList.contains('max')) collapse(); else expand(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('max')) collapse(); });

  // ===== keep the block above the Dashboard numbers (the page is rebuilt whenever an admin tab changes) =====
  var loaded = false;
  function place() {
    if (!isAdminNow()) { if (root.parentNode) root.remove(); return; }
    if (root.classList.contains('max')) return;
    var dash = document.getElementById('dashbox');
    if (!dash || !dash.parentNode) { if (root.parentNode) root.remove(); return; }
    if (root.parentNode !== dash.parentNode || root.nextSibling !== dash) dash.parentNode.insertBefore(root, dash);
    if (root.classList.contains('on') && !loaded) load();
  }
  var appEl = document.getElementById('app');
  if (appEl) new MutationObserver(place).observe(appEl, { childList: true });

  // ===== nodes =====
  var cards = {}, built = false, provs = [], hasResult = false;

  function paint(c, mode, kanji, en, sub, log, isErr) {
    c.hx.className = 'mg-hx' + (mode ? ' ' + mode : '');
    c.st.textContent = kanji;
    c.st.className = 'mg-st' + (kanji.length > 2 ? ' small' : '');
    c.en.textContent = en;
    c.sub.textContent = sub || '';
    c.log.textContent = log || '';
    c.log.className = 'mg-log' + (isErr ? ' err' : '');
  }
  function setDot(c, mode) { if (c.dot) c.dot.setAttribute('class', 'nd' + (mode ? ' ' + mode : '')); }
  var defOf = function (id) { for (var i = 0; i < provs.length; i++) if (provs[i].id === id) return provs[i].model || ''; return ''; };

  function fillProviders(c) {
    c.sel.textContent = '';
    provs.forEach(function (p) {
      var o = el('option', null, p.label + (p.ready ? '' : ' \u00b7 NO KEY'));
      o.value = p.id;
      if (!p.ready && p.id !== c.n.provider_id) o.disabled = true;
      c.sel.appendChild(o);
    });
    c.sel.value = c.n.provider_id;
  }
  function note(c, msg, kind) { c.out.textContent = msg || ''; c.out.className = 'mg-out' + (kind ? ' ' + kind : ''); }

  // Show a node's saved link (provider and model) on its card.
  function applyNode(c, n) {
    c.n = n;
    c.enabled = n.enabled;
    c.tag = n.role + ' \u00b7 ' + n.provider + ' \u00b7 ' + (n.model || '');
    fillProviders(c);
    c.model.value = n.model || '';
    c.model.placeholder = n.default_model || 'model name';
    if (!c.shown) {
      if (n.enabled) { paint(c, '', K_IDLE, 'STANDBY', c.tag); setDot(c, ''); }
      else { paint(c, 'off', K_OFF, 'NO KEY', c.tag); setDot(c, 'off'); }
    }
  }

  function buildNodes(list) {
    nodesWrap.textContent = '';
    cards = {};
    list.forEach(function (n, i) {
      var wrap = el('div', 'mg-node');
      var hx = el('div', 'mg-hx');
      var inn = el('div', 'mg-in');
      var nm = el('div', 'mg-nm', DISPLAY[n.id] || n.name);
      var kt = el('div', 'mg-kt', KATA[n.id] || '');
      var st = el('div', 'mg-st');
      var en = el('div', 'mg-en');
      var sub = el('div', 'mg-sub');
      var wave = el('div', 'mg-wave');
      for (var k = 0; k < 6; k++) wave.appendChild(el('i'));
      var meter = el('div', 'mg-meter');
      var mb = el('b');
      meter.appendChild(mb);
      [nm, kt, st, en, sub, wave, meter].forEach(function (x) { inn.appendChild(x); });
      hx.appendChild(inn);
      var log = el('div', 'mg-log');

      // provider switch
      var ctl = el('div', 'mg-ctl');
      var l1 = el('label', null, 'LINK'), sel = el('select');
      sel.setAttribute('aria-label', 'AI provider for ' + n.name);
      var l2 = el('label', null, 'MODEL'), model = el('input');
      model.type = 'text';
      model.maxLength = 120;
      model.spellcheck = false;
      model.setAttribute('aria-label', 'Model for ' + n.name);
      var acts = el('div', 'mg-acts');
      var bSave = el('button', 'mg-btn solid', 'SAVE LINK'), bTest = el('button', 'mg-btn', 'TEST'), bDef = el('button', 'mg-btn', 'DEFAULT');
      [bSave, bTest, bDef].forEach(function (b) { b.type = 'button'; acts.appendChild(b); });
      var out = el('div', 'mg-out');
      [l1, sel, l2, model, acts, out].forEach(function (x) { ctl.appendChild(x); });

      wrap.appendChild(hx);
      wrap.appendChild(log);
      wrap.appendChild(ctl);
      nodesWrap.appendChild(wrap);

      var c = { n: n, hx: hx, st: st, en: en, sub: sub, log: log, sel: sel, model: model, out: out, meter: meter, mb: mb, dot: dots[i] || null, shown: false };
      cards[n.id] = c;
      applyNode(c, n);

      // picking another provider puts that provider's default model in the box (a model name rarely works on another provider)
      sel.addEventListener('change', function () { model.value = defOf(sel.value); model.placeholder = defOf(sel.value) || 'model name'; note(c, ''); });
      bSave.addEventListener('click', function () {
        var m = model.value.trim();
        if (m === defOf(sel.value)) m = '';
        bSave.disabled = true;
        note(c, 'SAVING...');
        api('/api/admin/magi/node', 'POST', { node: n.id, provider: sel.value, model: m }).then(function (r) {
          applyNode(c, r.node);
          note(c, 'LINK SAVED \u00b7 ' + r.node.provider + ' \u00b7 ' + r.node.model, 'ok');
        }).catch(function (e) { note(c, e.message, 'err'); }).then(function () { bSave.disabled = false; });
      });
      bDef.addEventListener('click', function () {
        bDef.disabled = true;
        api('/api/admin/magi/node', 'POST', { node: n.id, reset: true }).then(function (r) {
          applyNode(c, r.node);
          note(c, 'BACK TO THE BUILT-IN LINK \u00b7 ' + r.node.provider, 'ok');
        }).catch(function (e) { note(c, e.message, 'err'); }).then(function () { bDef.disabled = false; });
      });
      bTest.addEventListener('click', function () {
        bTest.disabled = true;
        note(c, 'TESTING LINK...');
        api('/api/admin/magi/test', 'POST', { node: n.id }).then(function (r) {
          if (r.ok) note(c, 'LINK OK \u00b7 ' + (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + r.model, 'ok');
          else note(c, 'LINK FAILED \u00b7 ' + (r.error || 'no answer'), 'err');
        }).catch(function (e) { note(c, e.message, 'err'); }).then(function () { bTest.disabled = false; });
      });
    });
    built = true;
  }

  function setPips(list) {
    pips.textContent = '';
    (list || []).forEach(function (r) {
      var i = el('i', !r.ok ? 'off' : r.verdict === 'APPROVED' ? 'ap' : r.verdict === 'DENIED' ? 'dn' : '');
      i.title = (DISPLAY[r.id] || r.name) + ': ' + (r.ok ? r.verdict : 'NO RESPONSE');
      pips.appendChild(i);
    });
  }

  function idleLine(list) {
    if (hasResult) return;
    var live = list.filter(function (n) { return n.enabled; }).length;
    res.className = 'mg-hx mg-res';
    resBig.textContent = live < 2 ? K_OFF : K_IDLE;
    resBig.className = 'mg-st small';
    resEn.textContent = (live < 2 ? 'NO QUORUM' : 'STANDBY') + ' \u00b7 NODES ONLINE ' + live + ' / ' + list.length;
  }

  function load() {
    return api('/api/admin/magi/status').then(function (d) {
      loaded = true;
      provs = d.providers || [];
      var list = d.nodes || [];
      if (!built) buildNodes(list);
      else list.forEach(function (n) { if (cards[n.id]) applyNode(cards[n.id], n); });
      idleLine(list);
    }).catch(function (e) {
      resEn.textContent = e.message || 'Could not load MAGI status';
    });
  }

  function setBusy(c) { c.shown = false; paint(c, 'busy', K_WAIT, 'DELIBERATING', c.tag, ''); setDot(c, ''); c.mb.style.setProperty('--w', '0%'); }

  function showResult(r) {
    var c = cards[r.id];
    if (!c) return;
    c.shown = true;
    if (r.ok) {
      var mode = r.verdict === 'APPROVED' ? 'ap' : r.verdict === 'DENIED' ? 'dn' : '';
      var sub = (r.revised ? 'REVISED FROM ' + r.initial + ' \u00b7 ' : '') + (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + (r.provider || '') + ' \u00b7 ' + (r.model || '');
      paint(c, mode, KANJI[r.verdict] || KANJI.UNCLEAR, r.verdict, sub, r.text || '');
      setDot(c, r.verdict === 'DENIED' ? 'dn' : '');
      c.mb.style.setProperty('--w', Math.max(6, Math.min(100, Math.round(100 - r.ms / 250))) + '%');
    } else {
      paint(c, 'off', K_NONE, 'NO RESPONSE', c.tag, r.error || 'Node did not respond.', true);
      setDot(c, 'off');
    }
  }

  function setResolution(d) {
    var mode = d.decision === 'APPROVED' ? 'ap' : d.decision === 'DENIED' ? 'dn' : '';
    res.className = 'mg-hx mg-res' + (mode ? ' ' + mode : '');
    resBig.textContent = KANJI[d.decision] || d.decision;
    resBig.className = 'mg-st' + ((KANJI[d.decision] || '').length > 2 ? ' small' : '');
    resEn.textContent = d.decision + ' \u00b7 ' + d.approved + ' APPROVED / ' + d.denied + ' DENIED \u00b7 ' + d.responded + ' RESPONDED';
    if (d.decision === 'DENIED') {
      root.classList.add('alert');
      setTimeout(function () { root.classList.remove('alert'); }, 2400);
    }
  }

  var busy = false;
  function execute() {
    var q = ta.value.trim();
    if (!q || busy || !built) return;
    busy = true;
    hasResult = true;
    run.disabled = true;
    run.textContent = 'RUNNING';
    root.classList.add('busy');
    pips.textContent = '';
    res.className = 'mg-hx mg-res busy';
    resBig.textContent = K_WAIT;
    resBig.className = 'mg-st small';
    resEn.textContent = 'DELIBERATING';
    Object.keys(cards).forEach(function (id) { if (cards[id].enabled) setBusy(cards[id]); });
    api('/api/admin/magi', 'POST', { question: q }).then(function (d) {
      (d.results || []).forEach(showResult);
      setPips(d.results);
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
      root.classList.remove('busy');
    });
  }
  run.addEventListener('click', execute);
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); execute(); } });

  // ===== start, and follow sign-in / sign-out without a page reload =====
  var wasAdmin = isAdminNow();
  applyState();
  setTimeout(place, 400);
  setTimeout(place, 1500);
  setInterval(function () {
    var a = isAdminNow();
    if (a !== wasAdmin) { wasAdmin = a; applyState(); }
  }, 1500);
})();
