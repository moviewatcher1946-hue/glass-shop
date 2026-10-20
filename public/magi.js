// MAGI console (admin only), loaded by index.html for the admin role.
//  - Lives INSIDE the admin Dashboard (above the numbers) and appears only while NERV mode is on.
//  - Layout follows the MAGI screen: Balthasar top, Casper left, Melchior right, MAGI in the middle.
//  - The CONTROL button (top right of the panel) is where you change how the nodes act:
//      * MODE: VERDICT (approved / denied, majority wins), DISCUSS (no yes or no, they talk it through),
//              or LINK (the nodes assist each other in a chain: Melchior drafts, Balthasar reviews, Casper finishes),
//      * CHAIN ENDS WITH (link mode only): VERDICT (the last link rules APPROVED / DENIED) or DISCUSSION (no yes or no),
//      * 3-ROUND MODE (optional, off by default): round 2 = the convincing round, round 3 = the final ruling,
//        3-ROUND MODE and CONVINCING ROUND are hidden in LINK mode, because the chain has no rounds.
//      * STANDING ORDERS that every node must follow, a personality box per node, MUTE per node, and CREATIVITY.
//    The DECREE box next to EXECUTE lets you force APPROVED or DENIED for one run, whatever the nodes say.
//    The decree is shown in VERDICT mode, and in LINK mode when the chain ends with a verdict.
//  - The LINKS button opens the provider / model switches for each node.
//  - The HISTORY button lists the last 50 runs (saved by the server). Click one to put it back on the board.
//  - The COPY button copies the last ruling and every node's answer to the clipboard.
//  - Hover a node screen to read its answer; with more than one round you see every round it spoke.
//    In LINK mode each screen shows its link (DRAFT, REVIEW, FINAL) and the full chain answer appears under the board.
//  - Sound (Web Audio, nothing to download), Evangelion MAGI style (dry computer chirps, relay clicks, alarm buzz):
//      * a low control-room hum with faint data chirps plays while the console is idle (starts on your first tap / click, because browsers block audio before that),
//      * a fast storm of data chirps and relay clicks while the nodes think,
//      * chirp burst + three beeps + long tone on APPROVED, chirp mess + alarm siren + low buzz on DENIED.
//    The SOUND button mutes everything (remembered on this device).
//  - EXPAND covers the whole page (a fixed full-viewport layer, scrollable) and also requests real browser fullscreen where the browser allows it.
// Uses textContent for everything that comes from the server, so an AI answer can never inject HTML.
// Colours are CSS variables on #magi-dash (--mg-or, --mg-gn, --mg-no, ...).
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
  var ORDER = { caspar: 1, balthasar: 2, melchior: 3 };
  var KANJI = { APPROVED: '\u627f\u8a8d', DENIED: '\u5426\u6c7a', UNCLEAR: '\u4e0d\u660e', 'NO CONSENSUS': '\u6c7a\u8b70\u4e0d\u80fd', OPEN: '\u898b\u89e3', DISCUSSED: '\u5354\u8b70', LINKED: '\u9023\u643a', 'NO ANSWER': '\u7121\u56de\u7b54' };
  var K_WAIT = '\u5be9\u8b70\u4e2d', K_IDLE = '\u5f85\u6a5f', K_OFF = '\u672a\u63a5\u7d9a', K_NONE = '\u5fdc\u7b54\u306a\u3057';
  var K_Q = '\u8cea\u554f', K_A = '\u89e3\u6c7a';
  // link mode: the kanji and name for each link in the chain (draft, review, final)
  var CHAIN_KANJI = ['\u8349\u6848', '\u518d\u8003', '\u7d50\u8ad6'];
  var CHAIN_NAME = ['DRAFT', 'REVIEW', 'FINAL'];
  var CHAIN_KIND = ['draft', 'review', 'final'];

  // the admin's settings (the server is the source of truth; this is the copy the screen uses)
  var cfg = { mode: 'verdict', linkOut: 'verdict', rounds: 1, convince: true, temperature: 0.4, directive: '' };
  var lastNodes = [], pCols = {};
  var lastMode = 'verdict';
  // does a run with these settings end in an APPROVED / DENIED decision (so the decree makes sense)?
  var hasVotes = function () { return cfg.mode === 'verdict' || (cfg.mode === 'link' && cfg.linkOut === 'verdict'); };

  // the three screen shapes (from the reference stylesheet)
  var SHAPE = {
    balthasar: 'polygon(0 0,100% 0,100% 80%,75% 100%,25% 100%,0 80%)',
    caspar: 'polygon(0 0,65% 0,100% 44%,100% 100%,0 100%)',
    melchior: 'polygon(35% 0,100% 0,100% 100%,0 100%,0 44%)'
  };

  var css = [
    // ===== NERV theme: recolours the whole site for this admin only =====
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

    // ===== NERV button in the header =====
    '.mg-hdr{min-height:0;padding:6px 10px;font:800 .7rem/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;white-space:nowrap;color:inherit;background:transparent;border:1px solid currentColor;border-radius:999px;cursor:pointer;box-shadow:none}',
    '.mg-hdr:before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border:1.5px solid currentColor;border-radius:50%;vertical-align:1px}',
    '.mg-hdr.is-on:before{background:currentColor;box-shadow:0 0 8px currentColor}',
    'html.nerv .mg-hdr{color:#ff7a00;background:#000;border:2px solid #ff7a00;border-radius:0!important}',

    // ===== the MAGI block =====
    '#magi-dash{--mg-or:#ff8d00;--mg-hi:#ffb347;--mg-no:#e5231b;--mg-dim:#8a4300;--mg-gn:#5ef0a0;--mg-gd:#1f6b46;--mg-bl:#4fb6e6;--mg-bd:#1b5a86;margin:0 0 18px;color:var(--mg-or);font:700 14px/1.35 "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","MS PMincho",Georgia,"Times New Roman",serif;text-transform:uppercase}',
    '#magi-dash *{box-sizing:border-box;border-radius:0!important}',
    '#magi-dash button,#magi-dash select,#magi-dash input,#magi-dash textarea{font-family:inherit}',
    '#magi-dash .mg-btn{min-height:0;padding:8px 14px;color:var(--mg-or);background:#000;border:2px solid var(--mg-or);font-weight:800;font-size:.9rem;letter-spacing:.18em;cursor:pointer;box-shadow:none;text-transform:uppercase}',
    '#magi-dash .mg-btn:hover{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn.solid{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn:disabled{opacity:.45;cursor:default}',

    '.mg-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;background:#0a0502;border:1px solid #5b2d00;color:#ffb347}',
    '.mg-strip span{font-size:.72rem;letter-spacing:.2em}',
    '#magi-dash.on .mg-strip{display:none}',

    // the panel: black, orange frame with an inner hairline, like the reference
    '.mg-panel{position:relative;display:none;padding:15px;background:#000;border:2px solid var(--mg-or);box-shadow:0 0 28px #ff8a1f40,inset 0 0 40px #ff8a1f14;overflow:hidden}',
    '#magi-dash.on .mg-panel{display:block}',
    '.mg-sweep{position:absolute;left:0;right:0;top:0;height:90px;pointer-events:none;background:linear-gradient(to bottom,transparent,rgba(94,240,160,.1),transparent);animation:mgSweep 7s linear infinite}',
    '@keyframes mgSweep{from{transform:translateY(-100%)}to{transform:translateY(1800%)}}',
    '#magi-dash.alert .mg-panel{animation:mgAlert .45s steps(2) 5}',
    '@keyframes mgAlert{50%{border-color:var(--mg-no);box-shadow:0 0 44px #e5231b99,inset 0 0 60px #e5231b55}}',
    '.mg-panel>*{position:relative;z-index:1}',
    '.mg-panel>.mg-sweep{position:absolute;z-index:0}',

    '.mg-bar{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:0 0 10px}',

    // the MAGI board: the grid from the reference stylesheet (2:1, sized in cqw / cqh so it scales as one piece)
    '.mg-magi{display:grid;width:100%;margin:0;aspect-ratio:2/1;container-type:size;border:2px solid var(--mg-or);grid-template-columns:[left-header-start] 20px [casper-start status] 2fr [left-header-end balthasar-start casper-balthasar-connection] 0.5fr [casper-end title casper-melchior-connection] 1fr [balthasar-melchior-connection melchior-start] 0.5fr [right-header-start balthasar-end response] 2fr [melchior-end] 20px [right-header-end];grid-template-rows:20px [header balthasar-start] 2fr [status response] 2fr [casper-start melchior-start casper-balthasar-connection balthasar-melchior-connection] 1fr [balthasar-end title casper-melchior-connection] 3fr [casper-end melchior-end] 20px}',
    '.mg-magi>.mg-title{grid-area:title/title;color:var(--mg-or);text-align:center;font:900 9cqh/1.1 "Hiragino Mincho ProN","Yu Mincho",Georgia,serif;text-shadow:0 0 10px #ff8d0088}',
    '.mg-magi>.mg-hd{overflow:hidden}',
    '.mg-magi>.mg-hd>hr{border:2px solid #277547;height:4px;margin:2px;background:none}',
    '.mg-magi>.mg-hd>span{color:var(--mg-or);font-size:10cqh;display:flex;justify-content:center;font-weight:bold;transform:scaleX(2);text-shadow:0 0 10px #ff8d0066}',
    '.mg-magi>.mg-hl{grid-area:header/left-header-start/auto/left-header-end}',
    '.mg-magi>.mg-hr{grid-area:header/right-header-start/auto/right-header-end}',
    '.mg-magi>.mg-status{grid-area:status;font-family:"Lucida Console",Menlo,Consolas,monospace;color:var(--mg-or)}',
    '.mg-magi>.mg-status>div{font-size:3cqh;margin-left:4cqw;transform:scaleX(1.2);transform-origin:left}',
    '.mg-magi>.mg-status>div:first-child{font-size:6cqh;margin-left:0}',

    // response box (shows the verdict): blue idle, dark blue deciding, green approved, red denied
    '.mg-magi>.mg-res{grid-area:response;justify-self:flex-end;align-self:center;position:relative;border:solid 2px;padding:2px;color:var(--mg-bl)}',
    '.mg-magi>.mg-res.ap{color:var(--mg-gn)}',
    '.mg-magi>.mg-res.dn{color:var(--mg-no)}',
    '.mg-magi>.mg-res.busy{color:var(--mg-bd)}',
    '.mg-res>.mg-inner{white-space:nowrap;border:solid 2px;padding:2px 10px;font-weight:bold;text-align:center}',
    '.mg-res .mg-st{font-size:8cqh;line-height:1.1;font-weight:900;letter-spacing:.08em}',
    '.mg-res .mg-st.small{font-size:5.4cqh}',
    '.mg-res>.mg-en{position:absolute;bottom:100%;right:0;font:700 2.6cqh/1.2 Arial,Helvetica,sans-serif;letter-spacing:.14em;white-space:nowrap}',
    '.mg-res>.mg-sub{position:absolute;top:100%;right:0;font:600 2.2cqh/1.3 Arial,Helvetica,sans-serif;letter-spacing:.1em;white-space:nowrap;opacity:.85}',
    '.mg-res.busy .mg-st{animation:mgBlink .7s steps(2) infinite}',
    '@keyframes mgBlink{50%{opacity:.15}}',

    // connections and the three screens
    '.mg-magi>.mg-conn{height:10px;background:var(--mg-or);align-self:center;margin:-10%}',
    '.mg-magi>.mg-conn.cb{grid-area:casper-balthasar-connection;transform:rotate(-54deg)}',
    '.mg-magi>.mg-conn.cm{grid-area:casper-melchior-connection}',
    '.mg-magi>.mg-conn.bm{grid-area:balthasar-melchior-connection;transform:rotate(54deg)}',
    '.mg-magi>.mg-wm{display:flex;min-width:0;min-height:0;filter:drop-shadow(0 0 6px rgba(94,240,160,.3))}',
    '.mg-wm.melchior{grid-area:melchior-start/melchior-start/melchior-end/melchior-end}',
    '.mg-wm.balthasar{grid-area:balthasar-start/balthasar-start/balthasar-end/balthasar-end}',
    '.mg-wm.caspar{grid-area:casper-start/casper-start/casper-end/casper-end}',
    '.mg-hx{display:flex;flex:1;min-width:0;background:var(--mg-or);padding:2px;clip-path:var(--shape)}',
    '.mg-hx>.mg-in{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--mg-bl);color:#000;clip-path:var(--shape);font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-transform:uppercase;overflow:hidden}',
    '.mg-hx.ap>.mg-in{background:var(--mg-gn)}',
    '.mg-hx.dn>.mg-in{background:var(--mg-no)}',
    '.mg-hx.off>.mg-in{background:#0c1a12;color:var(--mg-gd)}',
    '.mg-hx.busy>.mg-in{background:var(--flick,var(--mg-bd))}',
    '.mg-wm .mg-nm{font-size:6.6cqh;line-height:1.1;white-space:nowrap;text-align:center}',
    '.mg-wm .mg-st{font-size:5.4cqh;line-height:1.1;margin-top:1.2cqh;letter-spacing:.06em;text-align:center}',
    '.mg-wm .mg-st.small{font-size:4cqh}',
    '.mg-wm .mg-en{font-size:3cqh;line-height:1.2;letter-spacing:.16em;text-align:center}',
    '.mg-wm .mg-kt,.mg-wm .mg-sub,.mg-wm .mg-meter{display:none}',
    '.mg-ctls{display:none!important}',
    '.mg-magi>.mg-wm{position:relative}',
    '.mg-magi>.mg-wm:hover{z-index:30}',
    '.mg-wm>.mg-log{display:none;position:absolute;z-index:31;left:3%;right:3%;top:6%;bottom:6%;max-height:none;overflow:auto;padding:1.4cqh 1.8cqh;background:#000;border:2px solid var(--mg-gn);border-left-width:2px;color:var(--mg-gn);font:500 clamp(11px,2.7cqh,18px)/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;box-shadow:0 0 18px #000}',
    '.mg-wm:hover>.mg-log:not(:empty){display:block}',
    '.mg-hx.dn+.mg-log{color:#ff9a8c;border-color:var(--mg-no)}',

    // per-node answers and provider switches
    '.mg-ctls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0 0}',
    '.mg-col{display:flex;flex-direction:column;gap:8px;min-width:0}',
    '.mg-col>.mg-kt{color:var(--mg-hi);opacity:1;letter-spacing:.22em;font-size:.62rem}',
    '.mg-log{max-height:110px;overflow:auto;padding:8px 10px;border-left:3px solid var(--mg-gn);background:#000;color:var(--mg-gn);font:500 14px/1.45 ui-monospace,Menlo,Consolas,monospace;text-transform:none;white-space:pre-wrap;word-break:break-word}',
    '.mg-log:empty{display:none}',
    '.mg-log.err{color:#ff6a4d;border-color:var(--mg-no)}',
    '.mg-ctl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;align-items:center;padding:8px;border:1px solid var(--mg-dim);background:#050200}',
    '.mg-ctl label{font-size:.7rem;letter-spacing:.22em;color:var(--mg-hi)}',
    '.mg-ctl select,.mg-ctl input{width:100%;min-height:0;margin:0;padding:6px 8px;color:var(--mg-hi);background:#000;border:1px solid var(--mg-or);font:500 12px/1.3 ui-monospace,Menlo,Consolas,monospace;text-transform:none;box-shadow:none}',
    '.mg-ctl select option{background:#000;color:var(--mg-hi)}',
    '.mg-ctl select:focus,.mg-ctl input:focus{outline:none;box-shadow:0 0 0 2px #ff8a1f66}',
    '.mg-acts{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}',
    '#magi-dash .mg-acts .mg-btn{padding:6px 10px;font-size:.8rem}',
    '.mg-out{grid-column:1/-1;font:500 13px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;color:var(--mg-hi);min-height:1.4em;word-break:break-word}',
    '.mg-out.err{color:#ff6a4d}.mg-out.ok{color:var(--mg-gn)}',
    '.mg-lcol:has(.mg-log:empty)>.mg-kt{display:none}',
    '.mg-ctls:not(:has(.mg-log:not(:empty))){display:none}',
    '.mg-panel>.mg-links{display:none;position:absolute;z-index:7;top:64px;right:20px;width:min(760px,calc(100% - 40px));margin:0;padding:0;background:#000;border:2px solid var(--mg-or);color:var(--mg-or);font-family:"Lucida Console",Menlo,Consolas,monospace}',
    '#magi-dash.links .mg-panel>.mg-links{display:block}',
    '.mg-lh{display:flex;border-bottom:2px solid var(--mg-or)}',
    '.mg-lt{flex:1;padding:5px 8px;font-size:.8rem;letter-spacing:.2em;background:repeating-linear-gradient(45deg,#000 0 10px,#211200 10px 20px)}',
    '#magi-dash .mg-lx{min-height:0;padding:5px 12px;color:var(--mg-or);background:#000;border:0;border-left:2px solid var(--mg-or);font-weight:900;cursor:pointer;box-shadow:none}',
    '.mg-lb{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:10px}',
    '.mg-pips{display:flex;gap:10px;justify-content:center;margin:14px 0 0}',
    '.mg-pips i{width:11px;height:11px;border:2px solid var(--mg-gn);transform:rotate(45deg)}',
    '.mg-pips i.ap{background:var(--mg-gn)}.mg-pips i.dn{background:var(--mg-no);border-color:var(--mg-no)}.mg-pips i.off{border-color:var(--mg-dim)}',

    // the final answer of a link-mode run (shown under the board, hidden until there is one)
    '.mg-final-lbl{display:none;margin:14px 0 0;font-size:.72rem;letter-spacing:.2em;color:var(--mg-hi)}',
    '.mg-final{display:none;margin:6px 0 0;padding:10px 12px;background:#000;border:1px solid var(--mg-gn);color:var(--mg-hi);font:500 14px/1.45 ui-monospace,Menlo,Consolas,monospace;text-transform:none;white-space:pre-wrap;word-break:break-word;max-height:18vh;overflow:auto}',

    // the CONTROL panel: how the nodes act
    '.mg-panel>.mg-ctrl{display:none;position:absolute;z-index:8;top:64px;right:20px;width:min(900px,calc(100% - 40px));max-height:calc(100% - 84px);overflow:auto;margin:0;padding:0;background:#000;border:2px solid var(--mg-or);color:var(--mg-or);font-family:"Lucida Console",Menlo,Consolas,monospace}',
    '#magi-dash.ctrl .mg-panel>.mg-ctrl{display:block}',
    '.mg-cb{display:grid;gap:12px;padding:12px}',
    '.mg-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 12px;align-items:center}',
    '.mg-row>label,.mg-pcol>label{font-size:.72rem;letter-spacing:.2em;color:var(--mg-hi)}',
    '.mg-seg{display:flex;gap:6px;flex-wrap:wrap}',
    '#magi-dash .mg-seg .mg-btn{padding:6px 12px;font-size:.8rem}',
    '#magi-dash .mg-seg .mg-btn.sel{background:var(--mg-or);color:#000}',
    '.mg-note{font:500 12px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;color:var(--mg-hi);opacity:.85}',
    '.mg-cb textarea{width:100%;margin:0;min-height:70px;padding:6px 8px;color:var(--mg-hi);background:#000;border:1px solid var(--mg-or);font:500 12px/1.35 ui-monospace,Menlo,Consolas,monospace;text-transform:none;resize:vertical;box-shadow:none}',
    '.mg-cb textarea:focus,.mg-cb input[type=range]:focus{outline:none;box-shadow:0 0 0 2px #ff8a1f66}',
    '.mg-cb input[type=range]{width:100%;margin:0;padding:0;min-height:0;accent-color:var(--mg-or)}',
    '.mg-pgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '.mg-pcol{display:flex;flex-direction:column;gap:6px;min-width:0;padding:8px;border:1px solid var(--mg-dim);background:#050200}',
    '.mg-pcol textarea{min-height:150px}',
    '.mg-pcol .mg-acts{display:flex}',
    '.mg-dec{margin-left:auto;min-height:0;padding:5px 8px;color:var(--mg-or);background:#000;border:1px solid var(--mg-or);font:700 .75rem/1.2 inherit;letter-spacing:.08em;text-transform:uppercase}',
    '.mg-dec option{background:#000;color:var(--mg-hi)}',

    // the HISTORY panel: the last runs, click one to put it back on the board
    '.mg-panel>.mg-hist{display:none;position:absolute;z-index:9;top:64px;right:20px;width:min(760px,calc(100% - 40px));margin:0;padding:0;background:#000;border:2px solid var(--mg-or);color:var(--mg-or);font-family:"Lucida Console",Menlo,Consolas,monospace;overflow:auto;overscroll-behavior:contain}',
    '#magi-dash.hist .mg-panel>.mg-hist{display:block}',
    '.mg-hi{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border-bottom:1px solid var(--mg-dim);cursor:pointer;text-transform:none;font:500 13px/1.3 ui-monospace,Menlo,Consolas,monospace;color:var(--mg-hi)}',
    '.mg-hi:hover{background:#1f1203}',
    '.mg-hi b{font:800 .72rem/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase}',
    '.mg-hi.ap b{color:var(--mg-gn)}.mg-hi.dn b{color:var(--mg-no)}',
    '.mg-hi span:last-child{opacity:.6;font-size:11px;white-space:nowrap}',
    '.mg-hi span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mg-hist .mg-note{padding:10px}',

    // bottom row, like the reference: question: [ input ] EXECUTE
    '.mg-form{position:relative;z-index:4;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;margin:18px 0 0;padding-top:12px;border-top:1px solid var(--mg-dim)}',
    '.mg-form .mg-ql{font-size:.9rem;letter-spacing:.14em;color:var(--mg-or);white-space:nowrap}',
    '.mg-form textarea{width:100%;margin:0;min-height:38px;padding:8px 10px;color:var(--mg-or);background:#1f1203;border:2px solid var(--mg-or);font:500 14px/1.3 ui-monospace,Menlo,Consolas,monospace;text-transform:none;resize:vertical;box-shadow:none}',
    '.mg-form textarea:focus{outline:none;box-shadow:0 0 0 2px #ff8a1f66}',
    '.mg-run{min-height:38px;padding:0 22px;color:#000;background:var(--mg-or);border:0;font:900 .9rem/1 inherit;letter-spacing:.2em;cursor:pointer}',
    '.mg-run:disabled{opacity:.5}',
    '.mg-chips{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}',
    '#magi-dash .mg-chips .mg-btn{padding:5px 10px;font-size:.75rem;border-width:1px;text-transform:none;letter-spacing:.06em;font-weight:600}',

    // EXPANDED: a fixed layer covering the whole viewport (it scrolls, so the bottom row is always reachable)
    '#magi-dash.max{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:none!important;margin:0!important;padding:0!important;overflow:auto!important;z-index:2147483000!important;transform:none!important;background:repeating-linear-gradient(45deg,#000 0,#000 20px,#140b02 20px,#140b02 40px)!important;border:0!important;display:flex!important;align-items:flex-start!important;justify-content:center!important}',
    '#magi-dash.max .mg-panel{max-width:none!important;margin:0 auto!important;min-height:0!important;border:0!important;outline:0!important;box-shadow:none!important}',
    '#magi-dash.max .mg-magi{width:1500px;max-width:100%;margin:0 auto}',
    '#magi-dash:fullscreen,#magi-dash:-webkit-full-screen{background:#000;overflow:auto;display:flex;align-items:flex-start;justify-content:center}',
    '#magi-dash:fullscreen .mg-panel,#magi-dash:-webkit-full-screen .mg-panel{max-width:none;margin:0 auto}',

    // effects
    '#magi-dash.boot .mg-panel{animation:mgBoot 1.2s steps(12) 1}',
    '@keyframes mgBoot{0%{opacity:0;filter:brightness(3)}20%{opacity:.6}35%{opacity:.1}50%{opacity:1}65%{opacity:.4}100%{opacity:1;filter:none}}',
    '.mg-res.glitch .mg-st{animation:mgGlitch .5s steps(2) 1}',
    '@keyframes mgGlitch{0%{text-shadow:3px 0 #ff3d00,-3px 0 #62f7a2;transform:translateX(3px)}50%{text-shadow:-4px 0 #ff3d00,4px 0 #62f7a2;transform:translateX(-3px)}100%{text-shadow:none;transform:none}}',
    '.mg-log{animation:mgFade .35s ease-out both}',
    '@keyframes mgFade{from{opacity:0;transform:translateY(4px)}}',
    '#magi-dash .mg-btn:hover{text-shadow:0 0 8px currentColor}',
    '.mg-panel:after{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.3) 0 1px,transparent 1px 3px);animation:mgFlick 5s linear infinite}',
    '@keyframes mgFlick{0%,100%{opacity:1}92%{opacity:1}93%{opacity:.6}94%{opacity:1}97%{opacity:.85}98%{opacity:1}}',
    '.mg-hx.dn{filter:none}',
    '.mg-panel>.mg-links,.mg-panel>.mg-ctrl{overflow:auto;overscroll-behavior:contain}',
    '.mg-panel>.mg-links .mg-lh,.mg-panel>.mg-ctrl .mg-lh,.mg-panel>.mg-hist .mg-lh{position:sticky;top:0;z-index:2;background:#000}',
    '#magi-dash .mg-lx{min-width:46px;min-height:34px;font-size:1rem}',
    '@media (max-width:860px){.mg-ctls{grid-template-columns:1fr}.mg-form{grid-template-columns:1fr}.mg-run{min-height:44px}.mg-lb{grid-template-columns:1fr}.mg-pgrid{grid-template-columns:1fr}.mg-row{grid-template-columns:1fr}.mg-dec{margin-left:0}.mg-hi{grid-template-columns:auto minmax(0,1fr)}.mg-hi span:last-child{grid-column:1/-1}}',
    '@media (prefers-reduced-motion:reduce){#magi-dash *{animation:none!important}}',
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'magi-css';
  style.textContent = css;
  document.head.appendChild(style);

  // ===== sound: all synthesized, nothing to load =====
  // Design: a small speaker in a control room. Everything is dry and a bit rough:
  //  - non-musical terminal pitches, clumped irregular chatter, tiny pitch / timing / volume wobble (never the same twice),
  //  - every beep has a key-click on its front edge and goes through a narrow "small speaker" filter,
  //  - relays are noise clacks with a small thump, not pure tones,
  //  - idle is a quiet 50 Hz mains hum plus air noise, with rare clacks and short data bursts (no pad, no reverb tails).
  var SND = 'magi_snd';
  function soundOn() { try { return localStorage.getItem(SND) !== '0'; } catch (e) { return true; } }
  var AC = window.AudioContext || window.webkitAudioContext, ctx = null, bus = null, spk = null, room = null, noiseBuf = null, hum = null, amb = null;
  var AMB_LEVEL = 0.06;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  // terminal pitches: deliberately not a musical scale
  var FREQS = [931, 1108, 1337, 1622, 1913, 2284, 2731];
  var pick = function () { return FREQS[Math.floor(Math.random() * FREQS.length)]; };

  function audio() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor(), master = ctx.createGain();
      master.gain.value = 0.9;
      comp.connect(master);
      master.connect(ctx.destination);
      bus = comp;

      // the small console speaker: narrow band, a little boxy
      spk = ctx.createBiquadFilter();
      spk.type = 'bandpass'; spk.frequency.value = 2000; spk.Q.value = 0.55;
      var spkG = ctx.createGain();
      spkG.gain.value = 1.6;
      spk.connect(spkG); spkG.connect(bus);

      // a tiny dry room (under half a second), just enough to stop it sounding like it is inside your head
      room = ctx.createGain();
      var rv = ctx.createConvolver(), rg = ctx.createGain(), len = Math.floor(ctx.sampleRate * 0.45), imp = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = imp.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      rv.buffer = imp; rg.gain.value = 0.5;
      room.connect(rv); rv.connect(rg); rg.connect(bus);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var nd = noiseBuf.getChannelData(0);
      for (var j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // short envelope: fast attack, exponential decay (never ramps to 0)
  function env(g, t, peak, att, dur) {
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }
  // a key-click: a few milliseconds of band-passed noise
  function click(t, vol, freq) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq || rnd(2200, 3800); f.Q.value = 1.4;
    env(g, t, vol, 0.0008, 0.012 + rnd(0, 0.01));
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, rnd(0, 1.5)); s.stop(t + 0.05);
  }
  // a relay: two noise clacks and a small thump
  function relay(t, vol) {
    click(t, vol * 0.5, rnd(1500, 2600));
    click(t + rnd(0.012, 0.022), vol * 0.35, rnd(2800, 4200));
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(rnd(120, 160), t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.045);
    env(g, t, vol * 0.25, 0.002, 0.06);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.08);
  }
  // one terminal beep: tiny pitch wobble, key-click on the front, through the small speaker
  function blip(t, f, dur, vol, type, send) {
    var o = ctx.createOscillator(), g = ctx.createGain(), rg = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f * rnd(0.994, 1.006), t);
    env(g, t, vol, 0.001, dur);
    o.connect(g); g.connect(spk);
    rg.gain.value = send == null ? 0.08 : send; g.connect(rg); rg.connect(room);
    o.start(t); o.stop(t + dur + 0.02);
    click(t, vol * 0.6, 3000);
  }
  // a clump of data chatter: uneven gaps, uneven lengths, uneven volume. returns when it ends
  function dataBurst(t, n, vol) {
    var at = t;
    for (var i = 0; i < n; i++) {
      blip(at, pick(), rnd(0.02, 0.05), vol * rnd(0.6, 1), 'square', 0.05);
      at += rnd(0.05, 0.11);
    }
    return at;
  }
  // human-ish timing for a deliberate beep
  var hz = function (t) { return t + rnd(-0.006, 0.006); };

  // the quiet room: 50 Hz mains hum plus air noise
  function roomBed(out, t, oscs, level) {
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    lp.connect(out);
    [[50, 'sawtooth', 0.5], [100, 'sine', 0.35], [150, 'triangle', 0.12]].forEach(function (p) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = p[1]; o.frequency.value = p[0] * rnd(0.999, 1.001); g.gain.value = p[2] * level;
      o.connect(g); g.connect(lp); o.start(t); oscs.push(o);
    });
    var ns = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    ns.buffer = noiseBuf; ns.loop = true; nf.type = 'lowpass'; nf.frequency.value = 500; ng.gain.value = 0.3 * level;
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); oscs.push(ns);
  }

  // while the nodes think: clumped bursts of chatter with relay clacks between
  function startHum() {
    if (!soundOn() || hum || !audio()) return;
    var t = ctx.currentTime, out = ctx.createGain(), oscs = [];
    out.gain.setValueAtTime(0.001, t);
    out.gain.linearRampToValueAtTime(0.05, t + 0.6);
    out.connect(bus);
    roomBed(out, t, oscs, 1);
    var h = { out: out, oscs: oscs, alive: true, timer: null };
    function loop() {
      if (!h.alive || !ctx) return;
      var now = ctx.currentTime;
      var end = dataBurst(now, Math.floor(rnd(4, 11)), 0.045);
      if (Math.random() < 0.5) relay(now + rnd(0, 0.2), 0.35);
      h.timer = setTimeout(loop, (end - now) * 1000 + rnd(120, 520));
    }
    loop();
    hum = h;
  }
  function stopHum() {
    if (!hum || !ctx) { hum = null; return; }
    var h = hum, t = ctx.currentTime;
    hum = null; h.alive = false; clearTimeout(h.timer);
    h.out.gain.cancelScheduledValues(t);
    h.out.gain.setValueAtTime(Math.max(0.001, h.out.gain.value), t);
    h.out.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    setTimeout(function () { h.oscs.forEach(function (o) { try { o.stop(); } catch (e) { } }); }, 400);
  }

  // idle: quiet hum and air, with a rare relay clack or a short data burst at random
  function startAmbient() {
    if (!soundOn() || amb || document.hidden || !root.classList.contains('on') || !isAdminNow() || !audio()) return;
    var t = ctx.currentTime, out = ctx.createGain(), oscs = [];
    out.gain.setValueAtTime(0.001, t);
    out.gain.linearRampToValueAtTime(AMB_LEVEL, t + 3);
    out.connect(bus);
    roomBed(out, t, oscs, 1);
    var a = { out: out, oscs: oscs, alive: true, timer: null };
    function next() {
      if (!a.alive || !ctx) return;
      var now = ctx.currentTime;
      if (Math.random() < 0.55) relay(now, 0.2);
      else dataBurst(now, Math.floor(rnd(3, 8)), 0.02);
      a.timer = setTimeout(next, rnd(1800, 6000));
    }
    a.timer = setTimeout(next, rnd(1500, 3500));
    amb = a;
  }
  // pull the idle bed down for a moment so a sound on top comes through clearly, then bring it back
  function duckAmbient(t, level, hold, back) {
    if (!amb || !ctx) return;
    var g = amb.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.001, level), t + 0.12);
    g.setValueAtTime(Math.max(0.001, level), t + hold);
    g.linearRampToValueAtTime(AMB_LEVEL, t + hold + back);
  }
  function stopAmbient() {
    if (!amb || !ctx) { amb = null; return; }
    var a = amb, t = ctx.currentTime;
    amb = null; a.alive = false; clearTimeout(a.timer);
    a.out.gain.cancelScheduledValues(t);
    a.out.gain.setValueAtTime(Math.max(0.001, a.out.gain.value), t);
    a.out.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    setTimeout(function () { a.oscs.forEach(function (o) { try { o.stop(); } catch (e) { } }); }, 800);
  }
  // browsers only allow sound after a tap / click / key press, so the idle sound starts on the first one
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { startAmbient(); }, { passive: true });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopAmbient(); else startAmbient(); });

  // a soft key-click that follows the screens flickering while the nodes think
  function tick() {
    if (!soundOn() || !ctx || ctx.state !== 'running') return;
    if (Math.random() < 0.35) click(ctx.currentTime, 0.1);
  }

  var flickT = null;
  function flickerStep() {
    var any = false;
    Object.keys(cards).forEach(function (id) {
      var c = cards[id];
      if (!c.hx.classList.contains('busy')) return;
      any = true;
      c.hx.style.setProperty('--flick', 'hsl(208,' + Math.round(60 + Math.random() * 30) + '%,' + Math.round(18 + Math.random() * 22) + '%)');
    });
    if (any) tick();
    flickT = setTimeout(flickerStep, 40 + Math.random() * 80);
  }
  function startFlicker() { stopFlicker(); flickerStep(); }
  function stopFlicker() {
    clearTimeout(flickT); flickT = null;
    Object.keys(cards).forEach(function (id) { cards[id].hx.style.removeProperty('--flick'); });
  }

  // one node being counted in: a relay clack
  function tally(t) { relay(t, 0.55); }

  // ===== the verdict =====
  // chatter first, then the call itself. Approved: three even pulses and a held tone. Denied: a harsh two-tone buzzer and a sinking growl.
  function approvedSound(hit) {
    relay(hit, 0.6);
    var end = dataBurst(hit, 7, 0.06);
    var s = end + 0.12;
    blip(hz(s), 1760, 0.09, 0.12, 'square', 0.1);
    blip(hz(s + 0.15), 1760, 0.09, 0.12, 'square', 0.1);
    blip(hz(s + 0.30), 1760, 0.09, 0.12, 'square', 0.1);
    blip(hz(s + 0.52), 1760, 0.6, 0.1, 'square', 0.15);
  }
  function deniedSound(hit) {
    relay(hit, 0.6);
    var end = dataBurst(hit, 6, 0.05);
    var s = end + 0.12;
    for (var i = 0; i < 4; i++) blip(hz(s + i * 0.19), i % 2 ? 294 : 392, 0.16, 0.14, 'sawtooth', 0.1);
    var t = s + 0.85;
    var o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 500;
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(65, t + 0.7);
    env(g, t, 0.16, 0.01, 0.75);
    o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.8);
    click(t, 0.2, 800);
  }
  // linked: a data run, then three rising tones (a chain completing, neither yes nor no)
  function linkedSound(hit) {
    relay(hit, 0.6);
    var end = dataBurst(hit, 5, 0.05);
    var s = end + 0.1;
    blip(hz(s), 1337, 0.1, 0.11, 'square', 0.1);
    blip(hz(s + 0.16), 1622, 0.1, 0.11, 'square', 0.1);
    blip(hz(s + 0.32), 1913, 0.4, 0.1, 'square', 0.12);
  }
  // no consensus / test / discussion: two flat beeps
  function unclearSound(hit) {
    blip(hz(hit), 1108, 0.1, 0.1, 'square', 0.08);
    blip(hz(hit + 0.2), 1108, 0.1, 0.1, 'square', 0.08);
  }
  function ding(verdict) {
    if (!soundOn() || !audio()) return;
    var t = ctx.currentTime;
    duckAmbient(t, 0.01, 3, 2.5);
    for (var i = 0; i < 3; i++) tally(t + i * 0.22 + rnd(-0.01, 0.01));   // the three nodes clack in one by one
    var hit = t + 0.8;
    if (verdict === 'APPROVED') approvedSound(hit);
    else if (verdict === 'DENIED') deniedSound(hit);
    else if (verdict === 'LINKED') linkedSound(hit);
    else unclearSound(hit);
  }
  // each AI has its own pitch so the three votes can be told apart by ear
  var PING = { melchior: { ap: 1568, dn: 520 }, balthasar: { ap: 1245, dn: 440 }, caspar: { ap: 1760, dn: 600 } };
  function pingBase(id, k) { return (PING[id] || PING.melchior)[k]; }

  // one AI approved: relay click and two short beeps
  function approvedPing(id) {
    var t = ctx.currentTime, f = pingBase(id, 'ap');
    relay(t, 0.35);
    blip(t + 0.03, f, 0.05, 0.1, 'square');
    blip(t + 0.11 + rnd(0, 0.01), f * 1.19, 0.08, 0.1, 'square');
  }
  // one AI denied: relay click and two low buzzy tones
  function deniedPing(id) {
    var t = ctx.currentTime, f = pingBase(id, 'dn');
    relay(t, 0.35);
    blip(t + 0.03, f, 0.1, 0.12, 'sawtooth');
    blip(t + 0.17, f * 0.8, 0.16, 0.12, 'sawtooth');
  }
  // one AI has spoken in discuss or link mode (no yes or no): relay click and one beep
  function openPing(id) {
    var t = ctx.currentTime;
    relay(t, 0.35);
    blip(t + 0.03, pingBase(id, 'ap'), 0.08, 0.1, 'square');
  }
  // one AI has decided
  function nodePing(verdict, id) {
    if (!soundOn() || !audio()) return;
    duckAmbient(ctx.currentTime, 0.02, 0.9, 2);
    if (verdict === 'DENIED') deniedPing(id);
    else if (verdict === 'OPEN') openPing(id);
    else approvedPing(id);
  }

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

  var bar = el('div', 'mg-bar');
  var ctrlBtn = el('button', 'mg-btn', 'CONTROL');
  var linksBtn = el('button', 'mg-btn', 'LINKS');
  var histBtn = el('button', 'mg-btn', 'HISTORY');
  var copyBtn = el('button', 'mg-btn', 'COPY');
  var sndBtn = el('button', 'mg-btn', 'SOUND: ON');
  var maxBtn = el('button', 'mg-btn', 'EXPAND');
  var offBtn = el('button', 'mg-btn', 'NERV: ON');
  var lastRun = null;   // the last run on the board (a fresh run or one replayed from the history), used by COPY
  [ctrlBtn, linksBtn, histBtn, copyBtn, sndBtn, maxBtn, offBtn].forEach(function (b) { b.type = 'button'; bar.appendChild(b); });
  panel.appendChild(bar);

  // the board: header rules, code block, response box, title and the three screens all sit in one grid
  var nodesWrap = el('div', 'mg-magi');
  [['mg-hd mg-hl', K_Q], ['mg-hd mg-hr', K_A]].forEach(function (h) {
    var d = el('div', h[0]);
    d.appendChild(el('hr'));
    d.appendChild(el('span', null, h[1]));
    d.appendChild(el('hr'));
    nodesWrap.appendChild(d);
  });
  var statusBox = el('div', 'mg-status');
  ['CODE:473', 'FILE:MAGI_SYS', 'EXTENTION:3023', 'EX_MODE:VERDICT/R1', 'PRIORITY:AAA'].forEach(function (s) { statusBox.appendChild(el('div', null, s)); });
  var exModeEl = statusBox.children[3];
  nodesWrap.appendChild(statusBox);
  nodesWrap.appendChild(el('div', 'mg-title', 'MAGI'));
  var res = el('div', 'mg-res');
  var resEn = el('div', 'mg-en', 'STANDBY');
  var resIn = el('div', 'mg-inner');
  var resBig = el('div', 'mg-st', K_IDLE);
  var resSub = el('div', 'mg-sub');
  resIn.appendChild(resBig);
  res.appendChild(resEn);
  res.appendChild(resIn);
  res.appendChild(resSub);
  nodesWrap.appendChild(res);
  panel.appendChild(nodesWrap);
  var ctlWrap = el('div', 'mg-ctls');
  panel.appendChild(ctlWrap);
  var pips = el('div', 'mg-pips');
  panel.appendChild(pips);

  // the full answer of a link-mode run (hidden in the other modes)
  var finalLbl = el('div', 'mg-final-lbl', 'FINAL ANSWER \u00b7 MELCHIOR \u2192 BALTHASAR \u2192 CASPER');
  var finalBox = el('div', 'mg-final');
  panel.appendChild(finalLbl);
  panel.appendChild(finalBox);
  function showFinal(text) {
    var on = !!text;
    finalBox.textContent = text || '';
    finalLbl.style.display = on ? 'block' : 'none';
    finalBox.style.display = on ? 'block' : 'none';
  }
  showFinal('');

  // bottom row: question: [ input ] EXECUTE, then the decree box
  var form = el('div', 'mg-form');
  var ql = el('span', 'mg-ql', 'QUESTION:');
  var ta = el('textarea');
  ta.rows = 1;
  ta.maxLength = 1000;
  ta.setAttribute('aria-label', 'Query for the MAGI');
  var run = el('button', 'mg-run', 'EXECUTE');
  run.type = 'button';
  form.appendChild(ql);
  form.appendChild(ta);
  form.appendChild(run);
  var chips = el('div', 'mg-chips');
  // the decree: force the result of the next run (it resets to AUTO after every run)
  var dec = el('select', 'mg-dec');
  dec.setAttribute('aria-label', 'Admin decree for the next run');
  [['', 'DECREE: AUTO (THEY VOTE)'], ['APPROVED', 'DECREE: FORCE APPROVED'], ['DENIED', 'DECREE: FORCE DENIED']].forEach(function (o) {
    var op = el('option', null, o[1]);
    op.value = o[0];
    dec.appendChild(op);
  });
  chips.appendChild(dec);
  form.appendChild(chips);
  panel.appendChild(form);
  var linkWrap = el('div', 'mg-links');
  var linkHead = el('div', 'mg-lh');
  linkHead.appendChild(el('div', 'mg-lt', 'LINKS'));
  var linkX = el('button', 'mg-lx', 'X');
  linkX.type = 'button';
  linkX.setAttribute('aria-label', 'Close links');
  linkHead.appendChild(linkX);
  var linkBody = el('div', 'mg-lb');
  linkWrap.appendChild(linkHead);
  linkWrap.appendChild(linkBody);
  panel.appendChild(linkWrap);

  // ===== CONTROL panel: how the nodes act =====
  var ctrlWrap = el('div', 'mg-ctrl');
  var ctrlHead = el('div', 'mg-lh');
  ctrlHead.appendChild(el('div', 'mg-lt', 'CONTROL'));
  var ctrlX = el('button', 'mg-lx', 'X');
  ctrlX.type = 'button';
  ctrlX.setAttribute('aria-label', 'Close control');
  ctrlHead.appendChild(ctrlX);
  var ctrlBody = el('div', 'mg-cb');
  ctrlWrap.appendChild(ctrlHead);
  ctrlWrap.appendChild(ctrlBody);
  panel.appendChild(ctrlWrap);

  // ===== HISTORY panel: the last runs, saved by the server =====
  var histWrap = el('div', 'mg-hist');
  var histHead = el('div', 'mg-lh');
  histHead.appendChild(el('div', 'mg-lt', 'HISTORY'));
  var histX = el('button', 'mg-lx', 'X');
  histX.type = 'button';
  histX.setAttribute('aria-label', 'Close history');
  histHead.appendChild(histX);
  var histBody = el('div');
  histWrap.appendChild(histHead);
  histWrap.appendChild(histBody);
  panel.appendChild(histWrap);

  var ctrlOut = el('div', 'mg-out');
  function ctrlNote(msg, kind) { ctrlOut.textContent = msg || ''; ctrlOut.className = 'mg-out' + (kind ? ' ' + kind : ''); }

  // a row of buttons where one is lit; opts is [[value, text], ...]
  function seg(label, opts, onPick) {
    var row = el('div', 'mg-row'), box = el('div', 'mg-seg'), btns = {};
    row.appendChild(el('label', null, label));
    opts.forEach(function (o) {
      var b = el('button', 'mg-btn', o[1]);
      b.type = 'button';
      b.addEventListener('click', function () { onPick(o[0]); });
      btns[o[0]] = b;
      box.appendChild(b);
    });
    row.appendChild(box);
    ctrlBody.appendChild(row);
    return {
      row: row,
      mark: function (v) { Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('sel', String(k) === String(v)); }); }
    };
  }
  var segMode = seg('MODE', [
    ['verdict', 'VERDICT \u00b7 APPROVE / DENY'],
    ['discuss', 'DISCUSS \u00b7 NO YES OR NO'],
    ['link', 'LINK \u00b7 THEY ASSIST EACH OTHER']
  ], function (v) { quick({ mode: v }); });
  // link mode only: does the chain finish with APPROVED / DENIED, or with a discussion?
  var segOut = seg('CHAIN ENDS WITH', [
    ['verdict', 'VERDICT \u00b7 APPROVE / DENY'],
    ['discuss', 'DISCUSSION \u00b7 NO YES OR NO']
  ], function (v) { quick({ linkOut: v }); });
  var segRounds = seg('3-ROUND MODE', [[1, 'OFF \u00b7 ONE QUICK ROUND'], [3, 'ON \u00b7 THREE ROUNDS']], function (v) { quick({ rounds: v }); });
  var segConv = seg('CONVINCING ROUND', [['1', 'ON'], ['0', 'OFF']], function (v) { quick({ convince: v === '1' }); });
  var roundNote = el('div', 'mg-note', '3-ROUND MODE OFF: each node answers once, alone (fast). ON: Round 1: each node answers alone. Round 2: the convincing round, where each node reads the others and argues to win them over (switch it off and round 2 is a plain debate). Round 3: the final ruling, after every node has heard every appeal. These buttons save at once.');
  ctrlBody.appendChild(roundNote);
  var linkNote = el('div', 'mg-note', 'LINK MODE: the nodes assist each other in a chain. Melchior drafts an answer, Balthasar reviews and improves it, and Casper writes the final answer. There are no rounds. CHAIN ENDS WITH VERDICT: every link answers APPROVED or DENIED and the last link\u2019s verdict is the decision (the decree can override it). CHAIN ENDS WITH DISCUSSION: no yes or no, the chain just builds one analysis. A muted or failed node is skipped. Each node shows its link when you hover it, and the final answer appears under the board.');
  linkNote.style.display = 'none';
  ctrlBody.appendChild(linkNote);

  var tRow = el('div', 'mg-row'), tLab = el('label', null, 'CREATIVITY 0.4'), tr = el('input');
  tr.type = 'range'; tr.min = '0'; tr.max = '1.5'; tr.step = '0.1'; tr.value = '0.4';
  tr.setAttribute('aria-label', 'Creativity of the nodes');
  tRow.appendChild(tLab);
  tRow.appendChild(tr);
  ctrlBody.appendChild(tRow);
  tr.addEventListener('input', function () { tLab.textContent = 'CREATIVITY ' + Number(tr.value).toFixed(1); });
  tr.addEventListener('change', function () { quick({ temperature: Number(tr.value) }); });

  var ordRow = el('div', 'mg-row'), ordTa = el('textarea');
  ordTa.maxLength = 1200;
  ordTa.placeholder = 'Orders every node must follow, for example: "Our shop is small, so be careful with money." Leave empty for none.';
  ordTa.setAttribute('aria-label', 'Standing orders for every node');
  ordRow.appendChild(el('label', null, 'STANDING ORDERS'));
  ordRow.appendChild(ordTa);
  ctrlBody.appendChild(ordRow);

  var pGrid = el('div', 'mg-pgrid');
  ctrlBody.appendChild(pGrid);
  ctrlBody.appendChild(el('div', 'mg-note', 'Each box is that node\u2019s personality. Rewrite it however you like, then press SAVE. MUTE silences a node (it stops voting, or drops out of the chain) and saves at once. DEFAULT puts the built-in personality back in the box.'));

  var cAct = el('div', 'mg-acts');
  var bSaveCtrl = el('button', 'mg-btn solid', 'SAVE ORDERS + PERSONALITIES');
  var bResetCtrl = el('button', 'mg-btn', 'RESET ALL');
  [bSaveCtrl, bResetCtrl].forEach(function (b) { b.type = 'button'; cAct.appendChild(b); });
  ctrlBody.appendChild(cAct);
  ctrlBody.appendChild(ctrlOut);

  // build the personality boxes (once the node list is known)
  function buildCtrl(list) {
    pGrid.textContent = '';
    pCols = {};
    list.slice().sort(function (a, b) { return (ORDER[a.id] || 9) - (ORDER[b.id] || 9); }).forEach(function (n) {
      var col = el('div', 'mg-pcol'), pta = el('textarea');
      pta.maxLength = 1500;
      pta.setAttribute('aria-label', 'Personality for ' + n.name);
      var acts = el('div', 'mg-acts'), bMute = el('button', 'mg-btn', 'MUTE'), bDef = el('button', 'mg-btn', 'DEFAULT');
      [bMute, bDef].forEach(function (b) { b.type = 'button'; acts.appendChild(b); });
      col.appendChild(el('label', null, (DISPLAY[n.id] || n.name) + ' \u00b7 PERSONALITY'));
      col.appendChild(pta);
      col.appendChild(acts);
      pGrid.appendChild(col);
      var pc = { ta: pta, mute: bMute, def: '', muted: false };
      pCols[n.id] = pc;
      bMute.addEventListener('click', function () { var o = {}; o[n.id] = { muted: !pc.muted }; quick({ nodes: o }); });
      bDef.addEventListener('click', function () { pta.value = pc.def; });
    });
  }
  // put the saved values into the control panel (text = also overwrite the text boxes)
  function fillCtrl(list, text) {
    (list || []).forEach(function (n) {
      var pc = pCols[n.id];
      if (!pc) return;
      pc.def = n.default_persona || '';
      pc.muted = !!n.muted;
      pc.mute.textContent = pc.muted ? 'UNMUTE' : 'MUTE';
      pc.mute.classList.toggle('solid', pc.muted);
      if (text) pc.ta.value = n.persona || pc.def;
    });
    if (text) ordTa.value = cfg.directive || '';
  }
  // reflect the mode, link ending, rounds and creativity everywhere they show
  function syncMode() {
    var isLink = cfg.mode === 'link';
    segMode.mark(cfg.mode);
    segOut.mark(cfg.linkOut);
    segRounds.mark(cfg.rounds > 1 ? 3 : 1);
    segConv.mark(cfg.convince ? '1' : '0');
    // the chain ending only matters in link mode; the round controls mean nothing there
    segOut.row.style.display = isLink ? '' : 'none';
    segRounds.row.style.display = isLink ? 'none' : '';
    segConv.row.style.display = isLink ? 'none' : '';
    roundNote.style.display = isLink ? 'none' : '';
    linkNote.style.display = isLink ? '' : 'none';
    tr.value = String(cfg.temperature);
    tLab.textContent = 'CREATIVITY ' + Number(cfg.temperature).toFixed(1);
    exModeEl.textContent = 'EX_MODE:' + (isLink ? 'LINK/' + (cfg.linkOut === 'verdict' ? 'VERDICT' : 'DISCUSS') : (cfg.mode === 'discuss' ? 'DISCUSS' : 'VERDICT') + '/R' + cfg.rounds);
    dec.style.display = hasVotes() ? '' : 'none';
    if (isLink) ta.placeholder = cfg.linkOut === 'verdict' ? 'Ask a yes or no question. Melchior drafts, Balthasar reviews, Casper rules.' : 'Ask anything. Melchior drafts, Balthasar reviews, Casper finishes.';
    else ta.placeholder = cfg.mode === 'discuss' ? 'Ask anything. The nodes will talk it through without a yes or no.' : 'Ask a yes or no question.';
  }
  function takeSettings(d, text) {
    if (d.settings) cfg = d.settings;
    if (d.nodes) {
      lastNodes = d.nodes;
      d.nodes.forEach(function (n) { if (cards[n.id]) applyNode(cards[n.id], n); });
      idleLine(d.nodes);
    }
    syncMode();
    fillCtrl(lastNodes, text);
  }
  function saveSettings(body, msg, text) {
    ctrlNote('SAVING...');
    return api('/api/admin/magi/settings', 'POST', body).then(function (d) {
      takeSettings(d, text);
      ctrlNote(msg || 'SAVED', 'ok');
    }).catch(function (e) { ctrlNote(e.message, 'err'); });
  }
  function quick(patch) { return saveSettings(patch, 'SAVED'); }
  bSaveCtrl.addEventListener('click', function () {
    var nodes = {};
    Object.keys(pCols).forEach(function (id) {
      var pc = pCols[id], v = pc.ta.value.trim();
      nodes[id] = { persona: v === pc.def.trim() ? '' : v };   // the built-in text is saved as "no change"
    });
    saveSettings({ directive: ordTa.value, nodes: nodes }, 'ORDERS AND PERSONALITIES SAVED', true);
  });
  bResetCtrl.addEventListener('click', function () { saveSettings({ reset: true }, 'EVERYTHING BACK TO DEFAULT', true); });
  syncMode();

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
    sndBtn.textContent = 'SOUND: ' + (soundOn() ? 'ON' : 'OFF');
  }
  function applyState() {
    var admin = isAdminNow(), on = admin && nervOn();
    document.documentElement.classList.toggle('nerv', on);
    root.classList.toggle('on', on);
    if (on && !root.classList.contains('boot')) { root.classList.add('boot'); setTimeout(function () { root.classList.remove('boot'); }, 1400); }
    hdrTgl.style.display = admin ? '' : 'none';
    if (!admin || !on) { closePanels(); collapse(); stopHum(); stopAmbient(); stopFlicker(); }
    syncToggles();
    place();
  }
  function setNerv(on) {
    try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) { }
    applyState();
    if (on) startAmbient();   // this came from a click, so the browser allows sound right away
  }
  hdrTgl.addEventListener('click', function () { setNerv(!root.classList.contains('on')); });
  stripBtn.addEventListener('click', function () { setNerv(true); });
  offBtn.addEventListener('click', function () { setNerv(false); });

  // the three pop-up panels (LINKS, CONTROL, HISTORY): only one is open at a time
  function setLinks(open) {
    root.classList.toggle('links', open);
    linksBtn.textContent = open ? 'LINKS \u25b4' : 'LINKS';
    if (open) { root.classList.remove('hist'); histBtn.textContent = 'HISTORY'; setCtrl(false); placePanels(); }
  }
  function setCtrl(open) {
    root.classList.toggle('ctrl', open);
    ctrlBtn.textContent = open ? 'CONTROL \u25b4' : 'CONTROL';
    if (open) { root.classList.remove('hist'); histBtn.textContent = 'HISTORY'; root.classList.remove('links'); linksBtn.textContent = 'LINKS'; placePanels(); }
  }
  function setHist(open) {
    if (open) {
      root.classList.remove('links'); linksBtn.textContent = 'LINKS';
      root.classList.remove('ctrl'); ctrlBtn.textContent = 'CONTROL';
    }
    root.classList.toggle('hist', open);
    histBtn.textContent = open ? 'HISTORY \u25b4' : 'HISTORY';
    if (open) { placePanels(); loadHist(); }
  }
  var anyPanel = function () { return root.classList.contains('links') || root.classList.contains('ctrl') || root.classList.contains('hist'); };
  linksBtn.addEventListener('click', function () { setLinks(!root.classList.contains('links')); });
  linkX.addEventListener('click', function () { setLinks(false); });
  ctrlBtn.addEventListener('click', function () { setCtrl(!root.classList.contains('ctrl')); });
  ctrlX.addEventListener('click', function () { setCtrl(false); });
  histBtn.addEventListener('click', function () { setHist(!root.classList.contains('hist')); });
  histX.addEventListener('click', function () { setHist(false); });
  // the pop-up panels sit just under the button bar (never over it) and scroll inside if they are taller than the console
  function placePanels() {
    var top = (bar.offsetTop || 0) + (bar.offsetHeight || 0) + 6;
    [linkWrap, ctrlWrap, histWrap].forEach(function (w) {
      w.style.top = top + 'px';
      w.style.maxHeight = Math.max(200, (panel.clientHeight || 600) - top - 10) + 'px';
    });
  }
  function closePanels() { setLinks(false); setCtrl(false); setHist(false); }
  // several ways out: the X, the same button again, a click anywhere outside the panel, or the Escape key
  root.addEventListener('click', function (e) {
    if (!anyPanel()) return;
    var t = e.target;
    if (linkWrap.contains(t) || ctrlWrap.contains(t) || histWrap.contains(t) || bar.contains(t)) return;
    closePanels();
  });
  window.addEventListener('resize', function () { if (anyPanel()) placePanels(); });
  sndBtn.addEventListener('click', function () {
    var next = !soundOn();
    try { localStorage.setItem(SND, next ? '1' : '0'); } catch (e) { }
    if (!next) { stopHum(); stopAmbient(); }
    else { ding('UNCLEAR'); startAmbient(); }
    syncToggles();
  });

  // ===== EXPAND: design height as a minimum, scaled to fit. The expanded layer scrolls, so the question row is always reachable =====
  var DESIGN_H = 1000; // raise in steps of 20 if there is too much empty space at the bottom, lower if the board is cut off
  function fit() {
    if (!root.classList.contains('max') || window.innerWidth < 860) { panel.style.zoom = ''; panel.style.width = ''; panel.style.height = ''; panel.style.minHeight = ''; panel.style.overflow = ''; return; }
    var pad = 16, vw = window.innerWidth - pad * 2, vh = window.innerHeight - pad * 2;
    var s = Math.min(vw / 1560, vh / DESIGN_H);
    panel.style.width = Math.round(vw / s) + 'px'; // stretch sideways to use the full screen width
    panel.style.height = '';
    panel.style.minHeight = DESIGN_H + 'px';
    panel.style.overflow = 'visible';
    panel.style.zoom = s.toFixed(3);
  }
  window.addEventListener('resize', fit);

  function expand() {
    root.classList.add('max');
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    maxBtn.textContent = 'COLLAPSE';
    fit();
    var rf = root.requestFullscreen || root.webkitRequestFullscreen;
    if (rf) {
      try {
        var p = rf.call(root);
        if (p && p.catch) p.catch(function (e) { console.warn('MAGI fullscreen refused:', e && e.message); });
      } catch (e) { console.warn('MAGI fullscreen error:', e && e.message); }
    }
  }
  function collapse() {
    if (!root.classList.contains('max')) return;
    root.classList.remove('max');
    document.body.style.overflow = '';
    maxBtn.textContent = 'EXPAND';
    fit();
    var fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) {
      var ef = document.exitFullscreen || document.webkitExitFullscreen;
      try { var p = ef.call(document); if (p && p.catch) p.catch(function () { }); } catch (e) { }
    }
    place();
  }
  maxBtn.addEventListener('click', function () { if (root.classList.contains('max')) collapse(); else expand(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (anyPanel()) { closePanels(); return; }
    if (root.classList.contains('max')) collapse();
  });
  function fsChange() {
    if (!(document.fullscreenElement || document.webkitFullscreenElement) && root.classList.contains('max')) collapse();
  }
  document.addEventListener('fullscreenchange', fsChange);
  document.addEventListener('webkitfullscreenchange', fsChange);

  // ===== keep the block above the Dashboard numbers =====
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

  function applyNode(c, n) {
    if (c.muted !== !!n.muted) c.shown = false;   // a node that was just muted or unmuted goes back to its standby screen
    c.n = n;
    c.enabled = n.enabled;
    c.muted = !!n.muted;
    c.tag = n.role + ' \u00b7 ' + n.provider + ' \u00b7 ' + (n.model || '');
    fillProviders(c);
    c.model.value = n.model || '';
    c.model.placeholder = n.default_model || 'model name';
    if (!c.shown) {
      if (n.enabled) paint(c, '', K_IDLE, 'STANDBY', c.tag);
      else paint(c, 'off', K_OFF, n.muted ? 'MUTED' : 'NO KEY', c.tag);
    }
  }

  function buildNodes(list) {
    Array.prototype.slice.call(nodesWrap.querySelectorAll('.mg-wm,.mg-conn')).forEach(function (x) { x.remove(); });
    ctlWrap.textContent = '';
    linkBody.textContent = '';
    cards = {};

    ['cb', 'cm', 'bm'].forEach(function (k) { nodesWrap.appendChild(el('div', 'mg-conn ' + k)); });

    list.forEach(function (n) {
      var wrap = el('div', 'mg-wm ' + n.id);
      var hx = el('div', 'mg-hx');
      hx.style.setProperty('--shape', SHAPE[n.id] || SHAPE.balthasar);
      var inn = el('div', 'mg-in');
      var nm = el('div', 'mg-nm', DISPLAY[n.id] || n.name);
      var kt = el('div', 'mg-kt', KATA[n.id] || '');
      var st = el('div', 'mg-st');
      var en = el('div', 'mg-en');
      var sub = el('div', 'mg-sub');
      var meter = el('div', 'mg-meter');
      var mb = el('b');
      meter.appendChild(mb);
      [nm, kt, st, en, sub, meter].forEach(function (x) { inn.appendChild(x); });
      hx.appendChild(inn);
      wrap.appendChild(hx);
      nodesWrap.appendChild(wrap);

      var col = el('div', 'mg-col mg-lcol');
      col.style.order = ORDER[n.id] || 9;
      col.appendChild(el('div', 'mg-kt', DISPLAY[n.id] || n.name));
      var log = el('div', 'mg-log');
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
      wrap.appendChild(log);
      var lcol = el('div', 'mg-col');
      lcol.style.order = ORDER[n.id] || 9;
      lcol.appendChild(el('div', 'mg-kt', DISPLAY[n.id] || n.name));
      lcol.appendChild(ctl);
      linkBody.appendChild(lcol);

      var c = { n: n, hx: hx, st: st, en: en, sub: sub, log: log, sel: sel, model: model, out: out, meter: meter, mb: mb, shown: false };
      cards[n.id] = c;
      applyNode(c, n);

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
      i.title = (DISPLAY[r.id] || r.name) + ': ' + (r.ok ? (r.verdict === 'OPEN' ? 'SPOKE' : r.verdict) : 'NO RESPONSE');
      pips.appendChild(i);
    });
  }

  function idleLine(list) {
    if (hasResult) return;
    var live = list.filter(function (n) { return n.enabled; }).length;
    res.className = 'mg-res';
    resBig.textContent = live < 2 ? K_OFF : K_IDLE;
    resBig.className = 'mg-st small';
    resEn.textContent = live < 2 ? 'NO QUORUM' : 'STANDBY';
    resSub.textContent = 'NODES ONLINE ' + live + ' / ' + list.length;
  }

  function load() {
    return api('/api/admin/magi/status').then(function (d) {
      loaded = true;
      provs = d.providers || [];
      var list = d.nodes || [];
      if (d.settings) cfg = d.settings;
      lastNodes = list;
      if (!built) { buildNodes(list); buildCtrl(list); }
      else list.forEach(function (n) { if (cards[n.id]) applyNode(cards[n.id], n); });
      fillCtrl(list, true);
      syncMode();
      idleLine(list);
    }).catch(function (e) {
      resSub.textContent = e.message || 'Could not load MAGI status';
    });
  }

  function setBusy(c) { c.shown = false; paint(c, 'busy', K_WAIT, 'DELIBERATING', c.tag, ''); c.mb.style.setProperty('--w', '0%'); }

  var ROUND_NAME = { independent: 'ALONE', debate: 'DEBATE', convince: 'CONVINCING', final: 'FINAL' };
  // what the node screen shows when you hover it: every round the node spoke in
  function logOf(r) {
    var h = r.history || [];
    if (h.length < 2) return r.text || '';
    return h.map(function (x) {
      var tag = 'ROUND ' + x.round + ' \u00b7 ' + (ROUND_NAME[x.kind] || '') + (x.verdict && x.verdict !== 'OPEN' ? ' \u00b7 ' + x.verdict : '');
      return tag + '\n' + (x.text || '');
    }).join('\n\n');
  }

  function showResult(r) {
    var c = cards[r.id];
    if (!c) return;
    c.shown = true;
    if (r.ok) {
      if (lastMode === 'link') {
        // link mode: each screen is one link of the chain (draft, review, final), coloured by its verdict when the chain ends in a verdict
        var idx = Math.max(0, CHAIN_KIND.indexOf(r.kind));
        var vm = r.verdict === 'DENIED' ? 'dn' : r.verdict === 'APPROVED' ? 'ap' : '';
        var lsub = (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + (r.provider || '') + ' \u00b7 ' + (r.model || '');
        paint(c, vm, CHAIN_KANJI[idx], CHAIN_NAME[idx] + (vm ? ' \u00b7 ' + r.verdict : ''), lsub, r.text || '');
        c.mb.style.setProperty('--w', Math.max(6, Math.min(100, Math.round(100 - r.ms / 250))) + '%');
        return;
      }
      var mode = r.verdict === 'DENIED' ? 'dn' : r.verdict === 'APPROVED' ? 'ap' : '';
      var sub = (r.revised ? 'REVISED FROM ' + r.initial + ' \u00b7 ' : '') + (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + (r.provider || '') + ' \u00b7 ' + (r.model || '');
      paint(c, mode, KANJI[r.verdict] || KANJI.UNCLEAR, r.verdict === 'OPEN' ? 'ANALYSIS' : r.verdict, sub, logOf(r));
      c.mb.style.setProperty('--w', Math.max(6, Math.min(100, Math.round(100 - r.ms / 250))) + '%');
    } else {
      paint(c, 'off', K_NONE, lastMode === 'link' ? 'LINK SKIPPED' : 'NO RESPONSE', c.tag, r.error || 'Node did not respond.', true);
    }
  }

  function setResolution(d) {
    var mode = d.decision === 'APPROVED' ? 'ap' : d.decision === 'DENIED' ? 'dn' : '';
    res.className = 'mg-res' + (mode ? ' ' + mode : '');
    resBig.textContent = KANJI[d.decision] || d.decision;
    resBig.className = 'mg-st' + ((KANJI[d.decision] || '').length > 2 ? ' small' : '');
    if (d.mode === 'link' && (d.linkOut !== 'verdict' || d.decision === 'NO ANSWER')) {
      // a chain that ends in a discussion (or produced nothing): no verdict to show
      resEn.textContent = d.decision === 'LINKED' ? 'CHAIN COMPLETE' : 'NO ANSWER';
      resSub.textContent = d.responded + ' OF 3 LINKS \u00b7 NO VOTE';
    } else if (d.overridden) {
      resEn.textContent = 'ADMIN DECREE';
      resSub.textContent = d.mode === 'link'
        ? 'FORCED BY ADMIN \u00b7 CHAIN RULED ' + (d.vote || 'NO CONSENSUS')
        : 'FORCED BY ADMIN \u00b7 NODES VOTED ' + d.approved + ' APPROVED / ' + d.denied + ' DENIED';
    } else if (d.decision === 'DISCUSSED') {
      resEn.textContent = 'DISCUSSION CLOSED';
      resSub.textContent = d.responded + ' NODES SPOKE \u00b7 ' + (d.rounds || 1) + ' ROUND' + (d.rounds > 1 ? 'S' : '') + ' \u00b7 NO VOTE';
    } else {
      resEn.textContent = d.decision === 'APPROVED' ? 'ALL GREEN' : d.decision === 'DENIED' ? 'ALL RED' : d.decision;
      resSub.textContent = d.mode === 'link'
        ? 'CHAIN RULING \u00b7 ' + d.responded + ' OF 3 LINKS'
        : d.approved + ' APPROVED / ' + d.denied + ' DENIED \u00b7 ' + d.responded + ' RESPONDED';
    }
    res.classList.add('glitch');
    setTimeout(function () { res.classList.remove('glitch'); }, 500);
    if (d.decision === 'DENIED') {
      root.classList.add('alert');
      setTimeout(function () { root.classList.remove('alert'); }, 2400);
    }
  }

  // ===== history: list the saved runs, put one back on the board, copy the last ruling =====
  function loadHist() {
    histBody.textContent = '';
    histBody.appendChild(el('div', 'mg-note', 'LOADING...'));
    api('/api/admin/magi/history').then(function (d) {
      histBody.textContent = '';
      var rows = d.items || [];
      if (!rows.length) { histBody.appendChild(el('div', 'mg-note', 'NO RUNS YET')); return; }
      rows.forEach(function (it) {
        var row = el('div', 'mg-hi ' + (it.decision === 'APPROVED' ? 'ap' : it.decision === 'DENIED' ? 'dn' : ''));
        row.appendChild(el('b', null, it.decision));
        row.appendChild(el('span', null, it.question));
        row.appendChild(el('span', null, new Date(it.ts).toLocaleString()));
        row.title = it.question;
        row.addEventListener('click', function () { replay(it.id); });
        histBody.appendChild(row);
      });
      var clr = el('button', 'mg-btn', 'CLEAR HISTORY');
      clr.type = 'button';
      clr.style.margin = '10px';
      clr.addEventListener('click', function () {
        api('/api/admin/magi/history', 'DELETE').then(loadHist).catch(function (e) { histBody.textContent = ''; histBody.appendChild(el('div', 'mg-note', e.message)); });
      });
      histBody.appendChild(clr);
    }).catch(function (e) { histBody.textContent = ''; histBody.appendChild(el('div', 'mg-note', e.message)); });
  }
  function replay(id) {
    if (busy) return;
    api('/api/admin/magi/history/' + id).then(function (d) {
      var r = d.run;
      if (!r) return;
      lastRun = r;
      hasResult = true;
      lastMode = r.mode;
      ta.value = r.question;
      (r.results || []).forEach(showResult);
      setPips(r.results);
      setResolution(r);
      showFinal(r.mode === 'link' ? (r.final || '') : '');
      setHist(false);
    }).catch(function (e) { resSub.textContent = e.message; });
  }
  copyBtn.addEventListener('click', function () {
    var flash = function (t) { copyBtn.textContent = t; setTimeout(function () { copyBtn.textContent = 'COPY'; }, 1300); };
    if (!lastRun) { flash('NOTHING YET'); return; }
    var t = 'QUESTION: ' + lastRun.question + '\nRESULT: ' + lastRun.decision + '\n\n' +
      (lastRun.mode === 'link' && lastRun.final ? 'FINAL: ' + lastRun.final + '\n\n' : '') +
      (lastRun.results || []).filter(function (r) { return r.ok; }).map(function (r) {
        return (DISPLAY[r.id] || r.name) + (r.verdict && r.verdict !== 'OPEN' ? ' [' + r.verdict + ']' : '') + ':\n' + r.text;
      }).join('\n\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { flash('COPIED'); }, function () { flash('FAILED'); });
    else flash('NO CLIPBOARD');
  });

  var busy = false;
  function execute() {
    var q = ta.value.trim();
    if (!q || busy || !built) return;
    busy = true;
    hasResult = true;
    lastMode = cfg.mode;
    run.disabled = true;
    run.textContent = 'RUNNING';
    root.classList.add('busy');
    pips.textContent = '';
    showFinal('');
    res.className = 'mg-res busy';
    resBig.textContent = K_WAIT;
    resBig.className = 'mg-st small';
    resEn.textContent = lastMode === 'link' ? 'CHAIN \u00b7 3 LINKS' : 'DELIBERATING \u00b7 ' + cfg.rounds + ' ROUND' + (cfg.rounds > 1 ? 'S' : '');
    resSub.textContent = '';
    Object.keys(cards).forEach(function (id) { if (cards[id].enabled) setBusy(cards[id]); });
    startAmbient();   // in case the first tap never started it
    startHum();
    startFlicker();
    var decree = hasVotes() ? dec.value : '';
    api('/api/admin/magi', 'POST', { question: q, override: decree }).then(function (d) {
      lastRun = d;
      // link mode reveals the chain in order (Melchior, Balthasar, Casper); the other modes go by speed
      var list = d.mode === 'link'
        ? (d.results || []).slice()
        : (d.results || []).slice().sort(function (a, b) { return (a.ms || 0) - (b.ms || 0); });
      var GAP = 900;   // time between one AI showing its colour and the next
      list.forEach(function (r, i) {
        setTimeout(function () { showResult(r); nodePing(r.ok ? r.verdict : 'DENIED', r.id); }, i * GAP);
      });
      return new Promise(function (resolve) {
        setTimeout(function () {
          stopHum();
          stopFlicker();
          setPips(d.results);
          setResolution(d);
          if (d.mode === 'link') showFinal(d.final || 'No final answer was produced.');
          ding(d.decision);
          resolve();
        }, list.length * GAP + 300);
      });
    }).catch(function (e) {
      stopHum();
      stopFlicker();
      res.className = 'mg-res dn';
      resBig.textContent = 'ERROR';
      resBig.className = 'mg-st small';
      resEn.textContent = 'ALL RED';
      resSub.textContent = e.message || 'Request failed';
    }).then(function () {
      busy = false;
      dec.value = '';   // a decree only lasts for one run
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
