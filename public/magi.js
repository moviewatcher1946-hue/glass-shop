// MAGI console (admin only), loaded by index.html for the admin role.
//  - Lives INSIDE the admin Dashboard (above the numbers) and appears only while NERV mode is on.
//  - Layout follows the MAGI screen: Balthasar top, Casper left, Melchior right, MAGI in the middle.
//  - The LINKS button (top right of the panel) opens the provider / model switches for each node.
//  - Sound (Web Audio, nothing to download): a mechanical machine-room drone with relay clicks and servo whines while the nodes think,
//    and a struck bell with echo and hall reverb on the verdict. The SOUND button mutes it (remembered on this device).
//  - EXPAND covers the whole page (a fixed full-viewport layer) and also requests real browser fullscreen where the browser allows it.
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
  var KANJI = { APPROVED: '\u627f\u8a8d', DENIED: '\u5426\u6c7a', UNCLEAR: '\u4e0d\u660e', 'NO CONSENSUS': '\u6c7a\u8b70\u4e0d\u80fd' };
  var K_WAIT = '\u5be9\u8b70\u4e2d', K_IDLE = '\u5f85\u6a5f', K_OFF = '\u672a\u63a5\u7d9a', K_NONE = '\u5fdc\u7b54\u306a\u3057';
  var K_Q = '\u8cea\u554f', K_A = '\u89e3\u6c7a', K_INFO = '\u60c5\u5831';

  // the three screen shapes, as percentages of each screen's box (matches the reference)
  var SHAPE = {
    balthasar: 'polygon(0 0,100% 0,100% 80%,75% 100%,25% 100%,0 80%)',
    caspar: 'polygon(0 0,65% 0,100% 45%,100% 100%,0 100%)',
    melchior: 'polygon(35% 0,100% 0,100% 100%,0 100%,0 45%)'
  };
  // where each screen sits on the stage, in percent (left, top, width, height)
  var POS = {
    balthasar: { l: 34.75, t: 7, w: 30.6, h: 48.6 },
    caspar: { l: 4.1, t: 45.8, w: 38.4, h: 38.8 },
    melchior: { l: 57.75, t: 45.8, w: 38.5, h: 38.8 }
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
    '#magi-dash{--mg-or:#ff8a1f;--mg-hi:#ffb347;--mg-no:#e5231b;--mg-dim:#8a4300;--mg-gn:#5ef0a0;--mg-gd:#1f6b46;margin:0 0 18px;color:var(--mg-or);font:700 14px/1.35 "Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","MS PMincho",Georgia,"Times New Roman",serif;text-transform:uppercase}',
    '#magi-dash *{box-sizing:border-box;border-radius:0!important}',
    '#magi-dash button,#magi-dash select,#magi-dash input,#magi-dash textarea{font-family:inherit}',
    '#magi-dash .mg-btn{min-height:0;padding:8px 14px;color:var(--mg-or);background:#000;border:2px solid var(--mg-or);font-weight:800;font-size:.72rem;letter-spacing:.18em;cursor:pointer;box-shadow:none;text-transform:uppercase}',
    '#magi-dash .mg-btn:hover{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn.solid{background:var(--mg-or);color:#000}',
    '#magi-dash .mg-btn:disabled{opacity:.45;cursor:default}',

    '.mg-strip{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;background:#0a0502;border:1px solid #5b2d00;color:#ffb347}',
    '.mg-strip span{font-size:.72rem;letter-spacing:.2em}',
    '#magi-dash.on .mg-strip{display:none}',

    // the panel: black, orange frame with an inner hairline, like the reference
    '.mg-panel{position:relative;display:none;padding:22px 26px 24px;background:#000;border:2px solid var(--mg-or);outline:1px solid var(--mg-or);outline-offset:-10px;box-shadow:0 0 28px #ff8a1f40,inset 0 0 40px #ff8a1f14;overflow:hidden}',
    '#magi-dash.on .mg-panel{display:block}',
    '.mg-sweep{position:absolute;left:0;right:0;top:0;height:90px;pointer-events:none;background:linear-gradient(to bottom,transparent,rgba(94,240,160,.1),transparent);animation:mgSweep 7s linear infinite}',
    '@keyframes mgSweep{from{transform:translateY(-100%)}to{transform:translateY(1800%)}}',
    '#magi-dash.alert .mg-panel{animation:mgAlert .45s steps(2) 5}',
    '@keyframes mgAlert{50%{border-color:var(--mg-no);box-shadow:0 0 44px #e5231b99,inset 0 0 60px #e5231b55}}',
    '.mg-panel>*{position:relative;z-index:1}',
    '.mg-panel>.mg-sweep{position:absolute;z-index:0}',

    '.mg-bar{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:0 0 10px}',

    // header: 質問 on the left, 解決 on the right, each with green rules above and below
    '.mg-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;margin:0 0 14px;align-items:start}',
    '.mg-kj{font-size:clamp(1.6rem,4.4vw,3.2rem);line-height:1.1;font-weight:900;letter-spacing:.3em;color:var(--mg-or);padding:14px 0;text-align:center;background:linear-gradient(var(--mg-gn),var(--mg-gn)) 0 0/100% 3px no-repeat,linear-gradient(var(--mg-gn),var(--mg-gn)) 0 7px/100% 2px no-repeat,linear-gradient(var(--mg-gn),var(--mg-gn)) 0 calc(100% - 7px)/100% 2px no-repeat,linear-gradient(var(--mg-gn),var(--mg-gn)) 0 100%/100% 3px no-repeat;text-shadow:0 0 10px #ff8a1f66}',
    '.mg-code{margin-top:10px;font:400 clamp(1.3rem,3vw,2.1rem)/1 Arial,Helvetica,sans-serif;letter-spacing:.06em;color:var(--mg-or)}',
    '.mg-data{margin-top:8px;font:500 .66rem/1.5 Arial,Helvetica,sans-serif;letter-spacing:.14em;color:var(--mg-or)}',

    // the 情報 box (also shows the verdict): green frame, cyan-style corner tag
    '.mg-res{position:relative;margin:14px 0 0 auto;max-width:200px;padding:26px 14px 10px;background:#000;border:2px solid var(--mg-gn);color:var(--mg-gn);text-align:center}',
    '.mg-tag{position:absolute;top:6px;right:6px;font-size:1.1rem;font-weight:900;letter-spacing:.1em;color:var(--mg-gn)}',
    '.mg-res .mg-en{font:700 .6rem/1 Arial,Helvetica,sans-serif;letter-spacing:.14em;text-align:left}',
    '.mg-res .mg-st{font-size:clamp(1.6rem,4.4vw,2.4rem);line-height:1.1;font-weight:900;letter-spacing:.08em}',
    '.mg-res .mg-st.small{font-size:clamp(1.1rem,3vw,1.6rem)}',
    '.mg-res .mg-sub{font:600 .56rem/1.3 Arial,Helvetica,sans-serif;letter-spacing:.12em;opacity:.8}',
    '.mg-res.dn{color:var(--mg-no);border-color:var(--mg-no)}',
    '.mg-res.dn .mg-tag{color:var(--mg-no)}',
    '.mg-res.busy .mg-st{animation:mgBlink .7s steps(2) infinite}',
    '@keyframes mgBlink{50%{opacity:.15}}',

    // the stage: same proportions as the reference (1200 x 685)
    '.mg-map{position:relative;container-type:inline-size;width:100%;aspect-ratio:1200/685;margin:6px 0 0}',
    '.mg-wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}',
    '.mg-wires line{stroke:var(--mg-or);stroke-width:9;stroke-linecap:square}',
    '.mg-mid{position:absolute;left:50%;top:59%;transform:translate(-50%,-50%);z-index:2}',
    '.mg-mid span{display:block;padding:0 1.2cqw;background:#000;font:900 4.4cqw/1 "Hiragino Mincho ProN","Yu Mincho",Georgia,serif;letter-spacing:.04em;color:var(--mg-or);text-shadow:0 0 12px #ff8a1f88}',

    // screens: flat green shapes, black text
    '.mg-node{position:absolute;margin:0}',
    '.mg-hx{position:absolute;inset:0;display:block;background:none;padding:0}',
    '.mg-hx>.mg-in{position:absolute;inset:0;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:0;padding:4% 8%;background:var(--mg-gn);color:#000;clip-path:var(--shape);text-transform:uppercase}',
    '.mg-hx.dn>.mg-in{background:var(--mg-no);color:#000}',
    '.mg-hx.off>.mg-in{background:#0c1a12;color:var(--mg-gd)}',
    '.mg-hx.busy>.mg-in{background:var(--flick,#2dbd77)}',
    '.mg-node .mg-nm{font:900 4.2cqw/1.05 Arial,Helvetica,sans-serif;letter-spacing:.02em;text-align:center}',
    '.mg-node .mg-st{font:900 3.4cqw/1 Arial,Helvetica,sans-serif;letter-spacing:.06em;text-align:center;margin-top:1.4cqw}',
    '.mg-node .mg-st.small{font-size:2.9cqw}',
    '.mg-node .mg-en{font:800 1.5cqw/1.2 Arial,Helvetica,sans-serif;letter-spacing:.16em;text-align:center}',
    '.mg-node .mg-kt,.mg-node .mg-sub,.mg-node .mg-meter{display:none}',

    // per-node answers and provider switches
    '.mg-ctls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0 0}',
    '.mg-col{display:flex;flex-direction:column;gap:8px;min-width:0}',
    '.mg-col>.mg-kt{color:var(--mg-hi);opacity:1;letter-spacing:.22em;font-size:.62rem}',
    '.mg-log{max-height:150px;overflow:auto;padding:8px 10px;border-left:3px solid var(--mg-gn);background:#000;color:var(--mg-gn);font:500 12px/1.45 ui-monospace,Menlo,Consolas,monospace;text-transform:none;white-space:pre-wrap;word-break:break-word}',
    '.mg-log:empty{display:none}',
    '.mg-log.err{color:#ff6a4d;border-color:var(--mg-no)}',
    '.mg-ctl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;align-items:center;padding:8px;border:1px solid var(--mg-dim);background:#050200}',
    '.mg-ctl label{font-size:.58rem;letter-spacing:.22em;color:var(--mg-hi)}',
    '.mg-ctl select,.mg-ctl input{width:100%;min-height:0;margin:0;padding:6px 8px;color:var(--mg-hi);background:#000;border:1px solid var(--mg-or);font:500 12px/1.3 ui-monospace,Menlo,Consolas,monospace;text-transform:none;box-shadow:none}',
    '.mg-ctl select option{background:#000;color:var(--mg-hi)}',
    '.mg-ctl select:focus,.mg-ctl input:focus{outline:none;box-shadow:0 0 0 2px #ff8a1f66}',
    '.mg-acts{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}',
    '#magi-dash .mg-acts .mg-btn{padding:6px 10px;font-size:.64rem}',
    '.mg-out{grid-column:1/-1;font:500 11px/1.4 ui-monospace,Menlo,Consolas,monospace;text-transform:none;color:var(--mg-hi);min-height:1.4em;word-break:break-word}',
    '.mg-out.err{color:#ff6a4d}.mg-out.ok{color:var(--mg-gn)}',
    '.mg-lcol:has(.mg-log:empty)>.mg-kt{display:none}',
    '.mg-ctls:not(:has(.mg-log:not(:empty))){display:none}',
    '.mg-links{display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0 0;padding-top:14px;border-top:2px solid var(--mg-or)}',
    '#magi-dash.links .mg-links{display:grid}',
    '.mg-pips{display:flex;gap:10px;justify-content:center;margin:14px 0 0}',
    '.mg-pips i{width:11px;height:11px;border:2px solid var(--mg-gn);transform:rotate(45deg)}',
    '.mg-pips i.ap{background:var(--mg-gn)}.mg-pips i.dn{background:var(--mg-no);border-color:var(--mg-no)}.mg-pips i.off{border-color:var(--mg-dim)}',

    // bottom row, like the reference: question: [ input ] EXECUTE
    '.mg-form{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;margin:18px 0 0;padding-top:12px;border-top:1px solid var(--mg-dim)}',
    '.mg-form .mg-ql{font-size:.7rem;letter-spacing:.14em;color:var(--mg-or);white-space:nowrap}',
    '.mg-form textarea{width:100%;margin:0;min-height:38px;padding:8px 10px;color:var(--mg-hi);background:#000;border:1px solid var(--mg-or);font:500 14px/1.3 ui-monospace,Menlo,Consolas,monospace;text-transform:none;resize:vertical;box-shadow:none}',
    '.mg-form textarea:focus{outline:none;box-shadow:0 0 0 2px #ff8a1f66}',
    '.mg-run{min-height:38px;padding:0 22px;color:#000;background:var(--mg-or);border:0;font:900 .9rem/1 inherit;letter-spacing:.2em;cursor:pointer}',
    '.mg-run:disabled{opacity:.5}',
    '.mg-chips{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}',
    '#magi-dash .mg-chips .mg-btn{padding:5px 10px;font-size:.6rem;border-width:1px;text-transform:none;letter-spacing:.06em;font-weight:600}',

    // EXPANDED: a fixed layer covering the whole viewport
    '#magi-dash.max{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:none!important;margin:0!important;padding:0!important;overflow:hidden!important;z-index:2147483000!important;transform:none!important;background:#000!important;border:0!important;display:flex!important;align-items:center!important;justify-content:center!important}',
    '#magi-dash.max .mg-panel{max-width:none!important;margin:0!important;min-height:0!important;border:0!important;outline:0!important;box-shadow:none!important}',
    '#magi-dash:fullscreen,#magi-dash:-webkit-full-screen{background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '#magi-dash:fullscreen .mg-panel,#magi-dash:-webkit-full-screen .mg-panel{max-width:none;margin:0}',

    // effects
    '#magi-dash.boot .mg-panel{animation:mgBoot 1.2s steps(12) 1}',
    '@keyframes mgBoot{0%{opacity:0;filter:brightness(3)}20%{opacity:.6}35%{opacity:.1}50%{opacity:1}65%{opacity:.4}100%{opacity:1;filter:none}}',
    '.mg-hx.ap>.mg-in,.mg-hx.dn>.mg-in{animation:mgReveal .5s steps(8) 1}',
    '@keyframes mgReveal{0%{transform:translateX(-6px);filter:hue-rotate(40deg)}30%{transform:translateX(4px)}60%{transform:translateX(-2px);filter:none}100%{transform:none}}',
    '.mg-res.glitch .mg-st{animation:mgGlitch .5s steps(2) 1}',
    '@keyframes mgGlitch{0%{text-shadow:3px 0 #ff3d00,-3px 0 #62f7a2;transform:translateX(3px)}50%{text-shadow:-4px 0 #ff3d00,4px 0 #62f7a2;transform:translateX(-3px)}100%{text-shadow:none;transform:none}}',
    '.mg-log{animation:mgFade .35s ease-out both}',
    '@keyframes mgFade{from{opacity:0;transform:translateY(4px)}}',
    '#magi-dash .mg-btn:hover{text-shadow:0 0 8px currentColor}',
    '.mg-panel:after{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.3) 0 1px,transparent 1px 3px);animation:mgFlick 5s linear infinite}',
    '@keyframes mgFlick{0%,100%{opacity:1}92%{opacity:1}93%{opacity:.6}94%{opacity:1}97%{opacity:.85}98%{opacity:1}}',
    '.mg-node{filter:drop-shadow(0 0 6px rgba(94,240,160,.35))}',
    '.mg-hx.dn{filter:none}',
    '@media (max-width:860px){.mg-top{grid-template-columns:1fr}.mg-res{margin-left:0;max-width:none}.mg-ctls{grid-template-columns:1fr}.mg-form{grid-template-columns:1fr}.mg-run{min-height:44px}.mg-links{grid-template-columns:1fr}.mg-node .mg-nm{font-size:3.4cqw}}',
    '@media (prefers-reduced-motion:reduce){#magi-dash *{animation:none!important}}',
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'magi-css';
  style.textContent = css;
  document.head.appendChild(style);

  // ===== sound: all synthesized, nothing to load =====
  var SND = 'magi_snd';
  function soundOn() { try { return localStorage.getItem(SND) !== '0'; } catch (e) { return true; } }
  var AC = window.AudioContext || window.webkitAudioContext, ctx = null, bus = null, fx = null, noiseBuf = null, hum = null;

  function audio() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor(), master = ctx.createGain();
      master.gain.value = 0.9;
      comp.connect(master);
      master.connect(ctx.destination);
      bus = comp;

      fx = ctx.createGain();
      var dly = ctx.createDelay(1), fb = ctx.createGain(), tone = ctx.createBiquadFilter(), eo = ctx.createGain();
      dly.delayTime.value = 0.31; fb.gain.value = 0.45; eo.gain.value = 0.55;
      tone.type = 'lowpass'; tone.frequency.value = 3000;
      fx.connect(dly); dly.connect(tone); tone.connect(fb); fb.connect(dly); tone.connect(eo); eo.connect(bus);
      var rv = ctx.createConvolver(), rg = ctx.createGain(), len = Math.floor(ctx.sampleRate * 2.8), imp = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = imp.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      rv.buffer = imp; rg.gain.value = 0.55;
      fx.connect(rv); rv.connect(rg); rg.connect(bus);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var nd = noiseBuf.getChannelData(0);
      for (var j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function burst(t, dur, type, freq, vol, send) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    if (send) { var sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(fx); }
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
  }
  function relay(t, vol) {
    burst(t, 0.018, 'highpass', 2600, vol * 0.5, 0.15);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(900 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.02);
    g.gain.setValueAtTime(vol * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.04);
  }
  function servo(t) {
    var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    var a = 220 + Math.random() * 120, b = a * (1.8 + Math.random() * 1.2), d = 0.16 + Math.random() * 0.2;
    o.type = 'sawtooth'; f.type = 'bandpass'; f.Q.value = 7; f.frequency.value = 1100;
    o.frequency.setValueAtTime(a, t);
    o.frequency.exponentialRampToValueAtTime(b, t + d * 0.5);
    o.frequency.exponentialRampToValueAtTime(a * 0.9, t + d);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f); f.connect(g); g.connect(bus);
    var sg = ctx.createGain(); sg.gain.value = 0.3; g.connect(sg); sg.connect(fx);
    o.start(t); o.stop(t + d + 0.05);
  }

  function startHum() {
    if (!soundOn() || hum || !audio()) return;
    var t = ctx.currentTime, out = ctx.createGain(), oscs = [];
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.2, t + 0.8);
    out.connect(bus);
    var send = ctx.createGain(); send.gain.value = 0.2; out.connect(send); send.connect(fx);

    var lp = ctx.createBiquadFilter(), pulse = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 280; lp.Q.value = 5;
    pulse.gain.value = 0.7;
    lp.connect(pulse); pulse.connect(out);
    var mot = ctx.createOscillator(), motG = ctx.createGain();
    mot.frequency.value = 8.5; motG.gain.value = 0.28;
    mot.connect(motG); motG.connect(pulse.gain); mot.start(t); oscs.push(mot);
    [[55, 'sawtooth', 0, 0.5], [55, 'sawtooth', 9, 0.4], [110, 'square', -7, 0.14]].forEach(function (p) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = p[1]; o.frequency.value = p[0]; o.detune.value = p[2]; g.gain.value = p[3];
      o.connect(g); g.connect(lp); o.start(t); oscs.push(o);
    });

    var ns = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    ns.buffer = noiseBuf; ns.loop = true; nf.type = 'bandpass'; nf.frequency.value = 2400; nf.Q.value = 0.7; ng.gain.value = 0.035;
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); oscs.push(ns);

    var h = { out: out, oscs: oscs, alive: true, timer: null }, step = 0;
    h.timer = setInterval(function () {
      if (!h.alive || !ctx) return;
      var now = ctx.currentTime; step++;
      if (step % 5 === 0) servo(now);
      else if (Math.random() < 0.3) relay(now, 0.6);
      if (Math.random() < 0.12) relay(now + 0.07, 0.4);
    }, 150);
    hum = h;
  }
  function stopHum() {
    if (!hum || !ctx) { hum = null; return; }
    var h = hum, t = ctx.currentTime;
    hum = null; h.alive = false; clearInterval(h.timer);
    h.out.gain.cancelScheduledValues(t);
    h.out.gain.setValueAtTime(h.out.gain.value, t);
    h.out.gain.linearRampToValueAtTime(0, t + 0.3);
    setTimeout(function () { h.oscs.forEach(function (o) { try { o.stop(); } catch (e) { } }); }, 400);
  }
  function tick() {
    if (!soundOn() || !ctx || ctx.state !== 'running') return;
    relay(ctx.currentTime, 0.8);
  }

  var flickT = null;
  function flickerStep() {
    var any = false;
    Object.keys(cards).forEach(function (id) {
      var c = cards[id];
      if (!c.hx.classList.contains('busy')) return;
      any = true;
      c.hx.style.setProperty('--flick', 'hsl(146,' + Math.round(55 + Math.random() * 35) + '%,' + Math.round(20 + Math.random() * 42) + '%)');
    });
    if (any) tick();
    flickT = setTimeout(flickerStep, 40 + Math.random() * 80);
  }
  function startFlicker() { stopFlicker(); flickerStep(); }
  function stopFlicker() {
    clearTimeout(flickT); flickT = null;
    Object.keys(cards).forEach(function (id) { cards[id].hx.style.removeProperty('--flick'); });
  }

  function bell(t, base, vol) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), ss = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = base * 4; f.Q.value = 0.5;
    g.gain.setValueAtTime(vol * 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    ss.gain.value = 0.3;
    s.connect(f); f.connect(g); g.connect(bus); g.connect(ss); ss.connect(fx);
    s.start(t, Math.random() * 0.5); s.stop(t + 0.03);
    [[0.5, 0.35, 2.2], [1, 1, 2.6], [1.2, 0.5, 1.8], [1.5, 0.45, 1.6], [2, 0.55, 1.3], [2.67, 0.25, 0.9], [3, 0.2, 0.7]].forEach(function (p) {
      var o = ctx.createOscillator(), og = ctx.createGain(), sg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = base * p[0];
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(p[1] * vol, t + 0.004);
      og.gain.setTargetAtTime(0, t + 0.004, p[2] / 4);
      sg.gain.value = 0.35;
      o.connect(og); og.connect(bus); og.connect(sg); sg.connect(fx);
      o.start(t); o.stop(t + p[2] * 1.5 + 0.1);
    });
  }
  function ding(verdict) {
    if (!soundOn() || !audio()) return;
    var t = ctx.currentTime;
    if (verdict === 'APPROVED') bell(t, 880, 0.35);
    else if (verdict === 'DENIED') { bell(t, 220, 0.4); bell(t + 0.7, 220, 0.3); }
    else bell(t, 494, 0.3);
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
  var linksBtn = el('button', 'mg-btn', 'LINKS');
  var sndBtn = el('button', 'mg-btn', 'SOUND: ON');
  var maxBtn = el('button', 'mg-btn', 'EXPAND');
  var offBtn = el('button', 'mg-btn', 'NERV: ON');
  [linksBtn, sndBtn, maxBtn, offBtn].forEach(function (b) { b.type = 'button'; bar.appendChild(b); });
  panel.appendChild(bar);

  // header: 質問 (left) and 解決 (right), with the code block and the 情報 box under them
  var top = el('div', 'mg-top');
  var left = el('div');
  left.appendChild(el('div', 'mg-kj', K_Q));
  left.appendChild(el('div', 'mg-code', 'CODE:473'));
  var data = el('div', 'mg-data');
  ['FILE:MAGI_SYS', 'EXTENTION:3023', 'EX_MODE:OFF', 'PRIORITY:AAA'].forEach(function (t) { data.appendChild(el('div', null, t)); });
  left.appendChild(data);
  top.appendChild(left);

  var right = el('div');
  right.appendChild(el('div', 'mg-kj', K_A));
  var res = el('div', 'mg-res');
  res.appendChild(el('div', 'mg-tag', K_INFO));
  var resEn = el('div', 'mg-en', 'STANDBY');
  var resBig = el('div', 'mg-st', K_IDLE);
  var resSub = el('div', 'mg-sub');
  res.appendChild(resEn);
  res.appendChild(resBig);
  res.appendChild(resSub);
  right.appendChild(res);
  top.appendChild(right);
  panel.appendChild(top);

  var nodesWrap = el('div', 'mg-map');
  panel.appendChild(nodesWrap);
  var ctlWrap = el('div', 'mg-ctls');
  panel.appendChild(ctlWrap);
  var pips = el('div', 'mg-pips');
  panel.appendChild(pips);

  // bottom row: question: [ input ] EXECUTE, then the example chips
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
  ['Should I run a promo this weekend?', 'Is it safe to raise prices by 5%?', 'Should I restock the best seller now?'].forEach(function (t) {
    var c = el('button', 'mg-btn', t);
    c.type = 'button';
    c.addEventListener('click', function () { ta.value = t; ta.focus(); });
    chips.appendChild(c);
  });
  form.appendChild(chips);
  panel.appendChild(form);
  var linkWrap = el('div', 'mg-links');
  panel.appendChild(linkWrap);

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
    if (!admin || !on) { collapse(); stopHum(); stopFlicker(); }
    syncToggles();
    place();
  }
  function setNerv(on) {
    try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) { }
    applyState();
  }
  hdrTgl.addEventListener('click', function () { setNerv(!root.classList.contains('on')); });
  stripBtn.addEventListener('click', function () { setNerv(true); });
  offBtn.addEventListener('click', function () { setNerv(false); });
  linksBtn.addEventListener('click', function () {
    var open = root.classList.toggle('links');
    linksBtn.textContent = open ? 'LINKS \u25b4' : 'LINKS';
    if (open) linkWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  sndBtn.addEventListener('click', function () {
    var next = !soundOn();
    try { localStorage.setItem(SND, next ? '1' : '0'); } catch (e) { }
    if (!next) stopHum();
    else { ding('UNCLEAR'); }
    syncToggles();
  });

  // ===== EXPAND =====
  function fit() {
    if (!root.classList.contains('max') || window.innerWidth < 860) { panel.style.zoom = ''; panel.style.width = ''; panel.style.margin = ''; return; }
    var pad = 16, vw = window.innerWidth - pad * 2, vh = window.innerHeight - pad * 2;
    var z = 1, w = 1100;
    for (var i = 0; i < 3; i++) {
      panel.style.zoom = '1';
      panel.style.width = w + 'px';
      var h = panel.offsetHeight;
      z = vh / h;
      if (vw / z < 1100) { z = vw / 1100; w = 1100; }
      else w = vw / z;
    }
    panel.style.width = w + 'px';
    panel.style.zoom = z.toFixed(3);
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('max')) collapse(); });
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
    c.n = n;
    c.enabled = n.enabled;
    c.tag = n.role + ' \u00b7 ' + n.provider + ' \u00b7 ' + (n.model || '');
    fillProviders(c);
    c.model.value = n.model || '';
    c.model.placeholder = n.default_model || 'model name';
    if (!c.shown) {
      if (n.enabled) paint(c, '', K_IDLE, 'STANDBY', c.tag);
      else paint(c, 'off', K_OFF, 'NO KEY', c.tag);
    }
  }

  function buildNodes(list) {
    nodesWrap.textContent = '';
    ctlWrap.textContent = '';
    linkWrap.textContent = '';
    cards = {};

    // connector lines in the stage's 1200 x 685 space
    var NS = 'http://www.w3.org/2000/svg';
    var wires = document.createElementNS(NS, 'svg');
    wires.setAttribute('class', 'mg-wires');
    wires.setAttribute('viewBox', '0 0 1200 685');
    wires.setAttribute('aria-hidden', 'true');
    [[438, 378, 461, 349], [740, 349, 765, 381], [510, 477, 693, 477]].forEach(function (p) {
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', p[0]); ln.setAttribute('y1', p[1]);
      ln.setAttribute('x2', p[2]); ln.setAttribute('y2', p[3]);
      wires.appendChild(ln);
    });
    nodesWrap.appendChild(wires);

    var mid = el('div', 'mg-mid');
    mid.appendChild(el('span', null, 'MAGI'));
    nodesWrap.appendChild(mid);

    list.forEach(function (n) {
      var P = POS[n.id] || POS.balthasar;
      var wrap = el('div', 'mg-node');
      wrap.style.left = P.l + '%';
      wrap.style.top = P.t + '%';
      wrap.style.width = P.w + '%';
      wrap.style.height = P.h + '%';
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
      col.appendChild(log);
      ctlWrap.appendChild(col);
      var lcol = el('div', 'mg-col');
      lcol.style.order = ORDER[n.id] || 9;
      lcol.appendChild(el('div', 'mg-kt', DISPLAY[n.id] || n.name));
      lcol.appendChild(ctl);
      linkWrap.appendChild(lcol);

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
      i.title = (DISPLAY[r.id] || r.name) + ': ' + (r.ok ? r.verdict : 'NO RESPONSE');
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
      if (!built) buildNodes(list);
      else list.forEach(function (n) { if (cards[n.id]) applyNode(cards[n.id], n); });
      idleLine(list);
    }).catch(function (e) {
      resSub.textContent = e.message || 'Could not load MAGI status';
    });
  }

  function setBusy(c) { c.shown = false; paint(c, 'busy', K_WAIT, 'DELIBERATING', c.tag, ''); c.mb.style.setProperty('--w', '0%'); }

  function showResult(r) {
    var c = cards[r.id];
    if (!c) return;
    c.shown = true;
    if (r.ok) {
      var mode = r.verdict === 'DENIED' ? 'dn' : r.verdict === 'APPROVED' ? 'ap' : '';
      var sub = (r.revised ? 'REVISED FROM ' + r.initial + ' \u00b7 ' : '') + (r.ms / 1000).toFixed(1) + 'S \u00b7 ' + (r.provider || '') + ' \u00b7 ' + (r.model || '');
      paint(c, mode, KANJI[r.verdict] || KANJI.UNCLEAR, r.verdict, sub, r.text || '');
      c.mb.style.setProperty('--w', Math.max(6, Math.min(100, Math.round(100 - r.ms / 250))) + '%');
    } else {
      paint(c, 'off', K_NONE, 'NO RESPONSE', c.tag, r.error || 'Node did not respond.', true);
    }
  }

  function setResolution(d) {
    var mode = d.decision === 'APPROVED' ? 'ap' : d.decision === 'DENIED' ? 'dn' : '';
    res.className = 'mg-res' + (mode ? ' ' + mode : '');
    resBig.textContent = KANJI[d.decision] || d.decision;
    resBig.className = 'mg-st' + ((KANJI[d.decision] || '').length > 2 ? ' small' : '');
    resEn.textContent = d.decision === 'APPROVED' ? 'ALL GREEN' : d.decision === 'DENIED' ? 'ALL RED' : d.decision;
    resSub.textContent = d.approved + ' APPROVED / ' + d.denied + ' DENIED \u00b7 ' + d.responded + ' RESPONDED';
    res.classList.add('glitch');
    setTimeout(function () { res.classList.remove('glitch'); }, 500);
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
    res.className = 'mg-res busy';
    resBig.textContent = K_WAIT;
    resBig.className = 'mg-st small';
    resEn.textContent = 'DELIBERATING';
    resSub.textContent = '';
    Object.keys(cards).forEach(function (id) { if (cards[id].enabled) setBusy(cards[id]); });
    startHum();
    startFlicker();
    api('/api/admin/magi', 'POST', { question: q }).then(function (d) {
      stopHum();
      stopFlicker();
      (d.results || []).forEach(showResult);
      setPips(d.results);
      setResolution(d);
      ding(d.decision);
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
