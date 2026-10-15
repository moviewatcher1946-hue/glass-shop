// Guided tour with voice. Opens from the Tutorial button (#tour-btn, or the Tutorial pill).
// Each step is read aloud with the browser's own speech engine (no key, no cost). The "Ask the guide" box sends the question
// to the Snackify AI and reads the answer aloud too. Mute and speed are remembered on this device.
(function () {
  'use strict';
  if (window.__tour) return; window.__tour = true;

  var LS = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var LSET = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  var STEPS = [
    { sel: '#nav', title: 'Find your way', text: 'These buttons move you around the shop. Shop is the menu, Cart holds what you have chosen, and My orders shows what you have bought.' },
    { sel: '#sp-dock', title: 'Ask Snackify AI', text: 'This is the AI button. Tap it, or press Control K on a computer, to ask anything: a product, your order, or how to do something on this site. It can also open pages for you.' },
    { sel: '#cartbar', title: 'Your cart', text: 'When you add something, your cart shows here. Tap it to review, change quantities, or check out.' },
    { sel: '#theme', title: 'Light or dark', text: 'Switch between light and dark mode here. The site also follows your phone or computer setting.' },
    { sel: '#helpfab', title: 'Need help again?', text: 'You can open this tutorial any time from the Tutorial button.' }
  ];

  var idx = 0, root = null, voiceOn = LS('tour_voice') !== '0', rate = parseFloat(LS('tour_rate')) || 1;

  // ---------- speech
  function say(text) {
    if (!canSpeak || !voiceOn || !text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = rate; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech blocked on this device */ }
  }
  function stopSpeech() { if (canSpeak) { try { window.speechSynthesis.cancel(); } catch (e) {} } }

  // ---------- styles
  var css = document.createElement('style');
  css.textContent = [
    '#tour-root{position:fixed;inset:0;z-index:9800;pointer-events:none;font:15px system-ui,-apple-system,sans-serif}',
    '#tour-card{pointer-events:auto;position:fixed;left:50%;transform:translateX(-50%);top:max(14px,env(safe-area-inset-top,0px));width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 28px);overflow:auto;',
    'border-radius:20px;padding:16px 18px;color:#1d1d1f;background:rgba(250,250,252,.94);border:1px solid rgba(255,255,255,.6);box-shadow:0 24px 60px rgba(0,0,0,.28);',
    'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:tIn .28s ease both}',
    '@media(prefers-color-scheme:dark){#tour-card{color:#f2f2f4;background:rgba(30,30,36,.94);border-color:rgba(255,255,255,.12)}}',
    'html[data-theme="dark"] #tour-card{color:#f2f2f4;background:rgba(30,30,36,.94);border-color:rgba(255,255,255,.12)}',
    'html[data-theme="light"] #tour-card{color:#1d1d1f;background:rgba(250,250,252,.94)}',
    '#tour-card h3{margin:0 0 6px;font-size:17px}#tour-card p{margin:0 0 10px;line-height:1.45}',
    '#tour-card .meta{font-size:12px;opacity:.6;margin-bottom:4px}',
    '#tour-card .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}',
    '#tour-card .row button{border:0;border-radius:12px;padding:9px 14px;font:600 14px system-ui,sans-serif;cursor:pointer;background:rgba(128,128,128,.18);color:inherit}',
    '#tour-card .row button.primary,#tour-card form button{background:#0a84ff;color:#fff}',
    '#tour-card .row button:disabled,#tour-card form button:disabled{opacity:.4;cursor:default}',
    '#tour-card .spacer{flex:1}',
    '#tour-card form{display:flex;gap:8px;margin-top:12px}',
    '#tour-card form input{flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(128,128,128,.35);background:rgba(255,255,255,.7);color:inherit;font:inherit}',
    '@media(prefers-color-scheme:dark){#tour-card form input{background:rgba(255,255,255,.08)}}',
    '#tour-card form button{border:0;border-radius:12px;padding:0 16px;font:600 14px system-ui,sans-serif;cursor:pointer}',
    '#tour-card .answer{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(128,128,128,.12);white-space:pre-wrap;word-break:break-word;max-height:30vh;overflow:auto}',
    '#tour-hi{position:fixed;z-index:9799;pointer-events:none;border-radius:16px;box-shadow:0 0 0 3px #0a84ff,0 0 0 9999px rgba(10,10,16,.35);transition:all .3s ease}',
    '@keyframes tIn{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}'
  ].join('');
  document.head.appendChild(css);

  // ---------- highlight the element a step is about
  function highlight(sel) {
    var old = document.getElementById('tour-hi'); if (old) old.remove();
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var hi = document.createElement('div'); hi.id = 'tour-hi';
    hi.style.left = (r.left - 6) + 'px'; hi.style.top = (r.top - 6) + 'px';
    hi.style.width = (r.width + 12) + 'px'; hi.style.height = (r.height + 12) + 'px';
    document.body.appendChild(hi);
    return el;
  }

  // ---------- steps (only the ones visible on this screen)
  function visibleSteps() {
    return STEPS.filter(function (s) { var e = document.querySelector(s.sel); return e && e.getBoundingClientRect().width > 0; });
  }
  function showStep(i) {
    var list = visibleSteps();
    if (!list.length) return;
    idx = Math.max(0, Math.min(list.length - 1, i));
    var s = list[idx];
    var el = highlight(s.sel);
    if (el && window.smoothTo) { try { window.smoothTo(el, { block: 'center' }); } catch (e) {} }
    renderCard(s, idx, list.length);
    say(s.title + '. ' + s.text);
  }

  // ---------- card
  function btn(label, fn, primary) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (primary) b.className = 'primary';
    b.onclick = fn; return b;
  }
  function renderCard(step, i, n) {
    if (!root) { root = document.createElement('div'); root.id = 'tour-root'; document.body.appendChild(root); }
    root.textContent = '';
    var card = document.createElement('div'); card.id = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Tutorial');
    var meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = 'Step ' + (i + 1) + ' of ' + n;
    var h = document.createElement('h3'); h.textContent = step.title;
    var p = document.createElement('p'); p.textContent = step.text;
    card.appendChild(meta); card.appendChild(h); card.appendChild(p);

    var row = document.createElement('div'); row.className = 'row';
    var back = btn('Back', function () { showStep(i - 1); }); back.disabled = i === 0;
    var next = btn(i === n - 1 ? 'Finish' : 'Next', function () { if (i === n - 1) close(); else showStep(i + 1); }, true);
    var mute = btn(voiceOn ? 'Mute voice' : 'Turn voice on', function () {
      voiceOn = !voiceOn; LSET('tour_voice', voiceOn ? '1' : '0');
      if (!voiceOn) stopSpeech(); else say(step.title + '. ' + step.text);
      renderCard(step, i, n);
    });
    var speed = btn(rate === 1 ? 'Speed: normal' : rate < 1 ? 'Speed: slow' : 'Speed: fast', function () {
      rate = rate === 1 ? 0.85 : rate < 1 ? 1.2 : 1; LSET('tour_rate', String(rate));
      renderCard(step, i, n);
    });
    var spacer = document.createElement('span'); spacer.className = 'spacer';
    row.appendChild(back); row.appendChild(next); row.appendChild(mute); row.appendChild(speed); row.appendChild(spacer); row.appendChild(btn('Close', close));
    card.appendChild(row);

    // The AI guide: ask anything, the answer is read aloud.
    if (window.SnackifyAI && window.SnackifyAI.answer) {
      var form = document.createElement('form');
      var input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.placeholder = 'Ask the guide a question\u2026'; input.setAttribute('aria-label', 'Ask the guide');
      var send = document.createElement('button'); send.type = 'submit'; send.textContent = 'Ask';
      var out = document.createElement('div'); out.className = 'answer'; out.hidden = true;
      form.appendChild(input); form.appendChild(send);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = input.value.trim(); if (!q) return;
        out.hidden = false; out.textContent = 'Thinking\u2026'; send.disabled = true;
        window.SnackifyAI.answer(q, step.title)
          .then(function (a) { out.textContent = a; say(a); }, function (err) { out.textContent = err.message || 'The guide is not available right now.'; })
          .then(function () { send.disabled = false; });
      });
      card.appendChild(form); card.appendChild(out);
    }
    root.appendChild(card);
  }

  function open() {
    stopSpeech();
    if (!visibleSteps().length) return;
    showStep(0);
  }
  function close() {
    stopSpeech();
    if (root) root.textContent = '';
    var hi = document.getElementById('tour-hi'); if (hi) hi.remove();
  }

  // Opens from the Tutorial button; the help pill in app.js clicks #tour-btn.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#tour-btn')) { e.preventDefault(); open(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && root.textContent) close(); });
  window.addEventListener('resize', function () { if (root && root.textContent) { var s = visibleSteps()[idx]; if (s) highlight(s.sel); } });

  window.SnackifyTour = { open: open, close: close };
})();
