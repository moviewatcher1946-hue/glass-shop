// Boost: performance, polish and admin tools. Loaded after app.js. Nothing here is required: if any part fails, the shop keeps working.
(function () {
  'use strict';
  const R = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const lite = () => R.dataset.glass === 'lite';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('bx_' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bx_' + k, v); } catch (e) { /* private mode */ } },
  };
  const say = (m) => { try { if (typeof toast === 'function') toast(m); } catch (e) { /* ignore */ } };
  const el = (tag, id, html, cls) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raf = (f) => { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; f(...a); }); }; };
  const safe = (f) => { try { f(); } catch (e) { /* one feature failing must not stop the rest */ } };

  /* 1-3. Performance mode: when the device looks slow (data saver, slow network, weak CPU, low battery, low frame rate) it ASKS before
     switching to lite mode. "Not now" is remembered for 30 days. Press L any time to switch by hand. */
  const ask = (why) => {
    if (lite() || localStorage.glass || Date.now() < Number(ls.get('noperf', 0)) || sessionStorage.bxask) return;
    try { sessionStorage.bxask = '1'; } catch (e) { /* ignore */ }
    const p = el('div', 'bx-perf', '<span>' + why + ' Switch to lite mode for smoother scrolling?</span><button type="button" class="primary">Switch</button><button type="button">Not now</button>', 'bx-pill glass');
    requestAnimationFrame(() => p.classList.add('on'));
    const b = p.querySelectorAll('button');
    b[0].onclick = () => { R.dataset.glass = 'lite'; try { localStorage.glass = 'lite'; } catch (e) { /* ignore */ } p.remove(); say('Lite mode on. Press L to switch back.'); };
    b[1].onclick = () => { ls.set('noperf', Date.now() + 30 * 864e5); p.remove(); };
    setTimeout(() => { if (p.isConnected) { p.classList.remove('on'); setTimeout(() => p.remove(), 500); } }, 25000);
  };
  safe(() => {
    const c = navigator.connection || {};
    const why = c.saveData ? 'Data saver is on.' : /(^|-)2g$/.test(c.effectiveType || '') ? 'Your connection is slow.'
      : (navigator.deviceMemory && navigator.deviceMemory <= 4) || navigator.hardwareConcurrency <= 2 ? 'This device looks like it has limited power.'
      : matchMedia('(prefers-reduced-transparency: reduce)').matches ? 'Your device asks for less transparency.' : '';
    if (why) setTimeout(() => ask(why), 4000);
    if (navigator.getBattery) navigator.getBattery().then((b) => { if (!b.charging && b.level < 0.2) setTimeout(() => ask('Battery is low.'), 5000); });
  });
  safe(() => {
    if (reduce || lite() || sessionStorage.bxfps) return;
    const run = () => {
      let n = 0, t0 = 0;
      const tick = (t) => { if (!t0) t0 = t; n++; if (t - t0 < 2200) return requestAnimationFrame(tick); const fps = n / ((t - t0) / 1000); sessionStorage.bxfps = '1'; if (fps < 38 && !document.hidden) ask('The page is running slowly.'); };
      requestAnimationFrame(tick);
    };
    let started = false; const go = () => { if (!started) { started = true; setTimeout(run, 1500); } };
    window.addEventListener('bootdone', go, { once: true }); setTimeout(go, 6000);
  });

  /* 4. Hidden-tab pause, 5. tab title when away, 6. theme-color follows the theme */
  safe(() => {
    const title = document.title;
    document.addEventListener('visibilitychange', () => { R.classList.toggle('bx-hid', document.hidden); document.title = document.hidden ? 'Still here, come back for a snack' : title; });
    const tc = document.querySelector('meta[name=theme-color]');
    const sync = () => { if (tc) setTimeout(() => { const v = getComputedStyle(R).getPropertyValue('--bg').trim(); if (v) tc.content = v; }, 80); }; // browser bars take the page's real background colour
    sync(); new MutationObserver(sync).observe(R, { attributes: true, attributeFilter: ['data-theme'] });
  });

  /* 7. Scroll progress, 8. header shadow (the shop already has its own back-to-top button) */
  safe(() => {
    const bar = el('div', 'bx-progress');
    const upd = raf(() => {
      const h = R.scrollHeight - innerHeight, y = scrollY;
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0) + ')';
      R.classList.toggle('bx-sc', y > 12);
    });
    addEventListener('scroll', upd, { passive: true }); upd();
  });

  /* 10. Aurora, 11. spotlight following the pointer, 12. film grain */
  safe(() => {
    if (reduce) return;
    el('div', 'bx-aurora', '<i></i><i></i><i></i>').setAttribute('aria-hidden', 'true');
    el('div', 'bx-grain').setAttribute('aria-hidden', 'true');
    if (!fine) return;
    const s = el('div', 'bx-spot'); s.setAttribute('aria-hidden', 'true');
    let x = 0, y = 0; const mv = raf(() => { s.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; });
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; s.classList.add('on'); mv(); }, { passive: true });
    document.addEventListener('pointerleave', () => s.classList.remove('on'));
  });

  /* 13. (tilt removed: it softened pictures) 14. magnetic primary buttons (fine pointers only; uses rotate/translate so it never fights the existing transforms) */
  safe(() => {
    if (reduce || !fine) return;
    let cur = null;
    const reset = (t) => { if (t) { t.style.rotate = ''; t.style.translate = ''; } };
    document.addEventListener('pointermove', raf((e) => {
      if (lite()) return;
      const btn = e.target.closest && e.target.closest('button.primary');
      const t = btn;
      if (cur && cur !== t) reset(cur);
      cur = t || null; if (!t) return;
      const r = t.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      t.style.translate = (nx * 6).toFixed(1) + 'px ' + (ny * 4).toFixed(1) + 'px';
    }), { passive: true });
    document.addEventListener('pointerleave', () => reset(cur), true);
  });

  /* 15. Cards rise in as they scroll into view (only the first time each card is seen), 16. lazy + async + fade-in pictures */
  safe(() => {
    const main = document.getElementById('app') || document.body;
    const seen = new Set(); let imgs = 0;
    const io = 'IntersectionObserver' in window && !reduce ? new IntersectionObserver((es) => {
      let i = 0;
      es.forEach((e) => { if (!e.isIntersecting) return; const c = e.target; io.unobserve(c); c.style.setProperty('--bx-d', Math.min(i++, 8) * 55 + 'ms'); c.classList.remove('bx-pre'); c.classList.add('bx-in'); });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }) : null;
    if (io) R.classList.add('bx-rv');
    const card = (c) => {
      if (!io || c.dataset.bx) return; c.dataset.bx = '1';
      const key = (c.textContent || '').trim().slice(0, 70);
      if (!key || seen.has(key)) return; seen.add(key);
      c.classList.add('bx-pre'); io.observe(c);
      setTimeout(() => { c.classList.remove('bx-pre'); }, 3500); // safety: never leave a card hidden
    };
    const img = (i) => {
      if (i.dataset.bx) return; i.dataset.bx = '1';
      if (!i.hasAttribute('decoding')) i.decoding = 'async';
      if (imgs++ < 6) { i.fetchPriority = 'high'; } else { if (!i.hasAttribute('loading')) i.loading = 'lazy'; i.fetchPriority = 'low'; }
      if (!i.complete) { i.classList.add('bx-f'); const ok = () => i.classList.add('bx-ok'); i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); setTimeout(ok, 6000); }
    };
    const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches('.card')) card(n); if (n.matches('img')) img(n); n.querySelectorAll && n.querySelectorAll('.card,img').forEach((x) => (x.matches('.card') ? card(x) : img(x))); };
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(main, { childList: true, subtree: true });
    scan(main);
  });

  /* 17. Tap feedback: a tiny vibration on phones (switch off with localStorage.bx_haptic = 0) */
  safe(() => {
    if (!navigator.vibrate || reduce || ls.get('haptic', '1') === '0') return;
    document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && e.target.closest && e.target.closest('button:not(:disabled)')) navigator.vibrate(6); }, { passive: true });
  });

  /* 18. Offline pill, 19. install-app pill */
  safe(() => {
    const net = el('div', 'bx-net', 'You are offline. Showing what was saved.', 'bx-pill glass');
    const sync = () => { net.classList.toggle('on', !navigator.onLine); };
    addEventListener('offline', sync); addEventListener('online', () => { sync(); say('Back online.'); }); sync();
    let ev = null;
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); ev = e;
      if (Date.now() - Number(ls.get('noinst', 0)) < 14 * 864e5) return;
      setTimeout(() => {
        const p = el('div', 'bx-install', '<span>Install Snackify on your phone</span><button type="button" class="primary">Install</button><button type="button" aria-label="Close">x</button>', 'bx-pill glass');
        requestAnimationFrame(() => p.classList.add('on'));
        const b = p.querySelectorAll('button');
        b[0].onclick = () => { ev.prompt(); p.remove(); };
        b[1].onclick = () => { ls.set('noinst', Date.now()); p.remove(); };
      }, 20000);
    });
  });

  /* 20. Keyboard shortcuts: / search, t theme, l lite mode, g top, ? help, Esc closes */
  safe(() => {
    const help = el('div', 'bx-help', '<div class="glass"><h3>Keyboard shortcuts</h3><p><span>Search</span><kbd>/</kbd></p><p><span>Light / dark</span><kbd>t</kbd></p><p><span>Lite mode (faster)</span><kbd>l</kbd></p><p><span>Back to top</span><kbd>g</kbd></p><p><span>Admin Pulse</span><kbd>p</kbd></p><p><span>This help</span><kbd>?</kbd></p></div>');
    help.onclick = () => help.classList.remove('on');
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === 'Escape') { help.classList.remove('on'); return; }
      if (typing) return;
      if (e.key === '/') { const s = document.getElementById('search') || document.querySelector('input[type=search]'); if (s) { e.preventDefault(); s.focus(); } }
      else if (e.key === 't') { const b = document.getElementById('theme'); b && b.click(); }
      else if (e.key === 'l') { const on = !lite(); if (on) R.dataset.glass = 'lite'; else delete R.dataset.glass; try { localStorage.glass = on ? 'lite' : 'full'; } catch (x) { /* ignore */ } say(on ? 'Lite mode on.' : 'Full glass on.'); }
      else if (e.key === 'g') { if (window.__lenis) window.__lenis.scrollTo(0); else scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }
      else if (e.key === 'p') { const b = document.getElementById('bx-pbtn'); b && b.classList.contains('on') && b.click(); }
      else if (e.key === '?') help.classList.toggle('on');
    });
  });

  /* 21. Confetti (Konami code, or window.bxConfetti()) */
  const confetti = () => {
    if (reduce) return;
    const c = el('canvas', 'bx-conf'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    const cols = ['#7c8cff', '#c084fc', '#38bdf8', '#f472b6', '#facc15', '#34d399'];
    const ps = Array.from({ length: 130 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.65, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 6, s: 4 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * 6 }));
    let f = 0;
    (function step() { x.clearRect(0, 0, c.width, c.height); ps.forEach((p) => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.2; x.fillStyle = p.c; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }); if (++f < 150) requestAnimationFrame(step); else c.remove(); })();
  };
  window.bxConfetti = confetti;
  safe(() => {
    const k = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let i = 0;
    document.addEventListener('keydown', (e) => { i = e.key === k[i] ? i + 1 : e.key === k[0] ? 1 : 0; if (i === k.length) { i = 0; confetti(); } });
  });

  /* 22. Real-visitor speed numbers (FCP, LCP, CLS, INP, TTFB) sent once per visit to the admin's Pulse panel */
  safe(() => {
    if (Math.random() > 0.5 || !('PerformanceObserver' in window)) return;
    const v = {}; let cls = 0, inp = 0;
    const ob = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, durationThreshold: 40 }); } catch (e) { /* unsupported */ } };
    ob('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = e.startTime; });
    ob('largest-contentful-paint', (e) => { v.lcp = e.startTime; });
    ob('layout-shift', (e) => { if (!e.hadRecentInput) cls += e.value; });
    ob('event', (e) => { if (e.duration > inp) inp = e.duration; });
    const nav = performance.getEntriesByType('navigation')[0]; if (nav) v.ttfb = nav.responseStart;
    let sent = false;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || sent || !v.lcp) return; sent = true; v.cls = cls; if (inp) v.inp = inp;
      try { navigator.sendBeacon('/api/boost/vitals', new Blob([JSON.stringify(v)], { type: 'application/json' })); } catch (e) { /* ignore */ }
    });
  });

  /* 23. Admin Pulse: live server health, speed, security and sales insight (main admin only) */
  safe(() => {
    const isMain = () => { try { return typeof isAdmin === 'function' && isAdmin(); } catch (e) { return false; } };
    const btn = el('button', 'bx-pbtn', '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>', 'glass');
    btn.type = 'button'; btn.setAttribute('aria-label', 'Admin Pulse');
    const panel = el('div', 'bx-pulse', '', 'glass');
    let timer = null, days = 30, ins = null;
    const fmtB = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
    const fmtT = (s) => (s > 86400 ? Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h' : s > 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm' : Math.floor(s / 60) + 'm ' + (s % 60) + 's');
    const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const spark = (a) => { const m = Math.max(1, ...a), w = 100 / a.length; return '<svg class="bx-spark" viewBox="0 0 100 40" preserveAspectRatio="none">' + a.map((v, i) => '<rect x="' + (i * w + w * 0.12).toFixed(2) + '" y="' + (40 - (v / m) * 38).toFixed(2) + '" width="' + (w * 0.76).toFixed(2) + '" height="' + ((v / m) * 38 + 0.5).toFixed(2) + '" rx="1"/>').join('') + '</svg>'; };
    const tile = (v, l, c) => '<div class="bx-t ' + (c || '') + '"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>';
    const grade = (v, good, ok) => (v <= good ? 'good' : v <= ok ? 'warn' : 'bad');
    const draw = (s) => {
      const q = s.req, v = s.vitals, e = s.events || [];
      panel.innerHTML = '<h3>Admin Pulse <button type="button" data-x="close" aria-label="Close">x</button></h3>'
        + '<div class="bx-g">' + tile(fmtT(s.uptime), 'uptime') + tile(q.p50 + ' ms', 'API median', grade(q.p50, 120, 400)) + tile(q.p95 + ' ms', 'API p95', grade(q.p95, 400, 1200)) + tile(s.loop.p99 + ' ms', 'loop lag p99', grade(s.loop.p99, 40, 150))
        + tile(fmtB(s.mem.rss), 'memory used', s.mem.rss > 4.2e8 ? 'bad' : s.mem.rss > 3.2e8 ? 'warn' : 'good') + tile(q.s5, 'server errors', q.s5 ? 'bad' : 'good') + tile(q.s4, 'client errors') + tile(s.pool.total + '/' + s.pool.idle + '/' + s.pool.waiting, 'db conns total/idle/wait') + '</div>'
        + '<h4>Requests per minute (last 30)</h4>' + spark(q.perMin)
        + '<h4>Database</h4><div class="bx-g">' + tile(fmtB(s.db.bytes), 'size') + tile(s.db.orders, 'orders') + tile(s.db.products, 'products') + tile(s.db.users, 'accounts') + tile(s.db.audit, 'log lines') + '</div>'
        + '<h4>Real visitors (' + v.n + ' visits)</h4><div class="bx-g">' + tile(v.lcp ? Math.round(v.lcp) + ' ms' : '-', 'LCP p75', v.lcp ? grade(v.lcp, 2500, 4000) : '') + tile(v.fcp ? Math.round(v.fcp) + ' ms' : '-', 'FCP p75', v.fcp ? grade(v.fcp, 1800, 3000) : '') + tile(v.cls || '0', 'CLS p75', grade(v.cls, 0.1, 0.25)) + tile(v.inp ? Math.round(v.inp) + ' ms' : '-', 'INP p75', v.inp ? grade(v.inp, 200, 500) : '') + tile(v.ttfb ? Math.round(v.ttfb) + ' ms' : '-', 'TTFB median', v.ttfb ? grade(v.ttfb, 800, 1800) : '') + '</div>'
        + '<h4>Slowest routes</h4>' + (s.routes.length ? s.routes.map((r) => '<div class="bx-row"><span>' + esc(r.route) + '</span><span>' + r.avg + ' ms avg, ' + r.max + ' max, ' + r.n + 'x</span></div>').join('') : '<div class="bx-row"><span>No data yet</span></div>')
        + '<h4>Blocked visitors</h4>' + (s.bans.length ? s.bans.map((b) => '<div class="bx-row"><span>' + esc(b.ip) + ' (' + esc(b.why) + ')</span><span>' + b.mins + ' min <button type="button" data-unban="' + esc(b.ip) + '">Unblock</button></span></div>').join('') : '<div class="bx-row"><span>Nobody blocked</span></div>')
        + '<h4>Security events</h4>' + (e.length ? e.map((x) => '<div class="bx-row"><span>' + esc(x.type) + ' ' + esc(x.ip) + '</span><span>' + esc(x.at.slice(11, 19)) + '</span></div>').join('') : '<div class="bx-row"><span>Quiet</span></div>')
        + '<h4>Sales insight <select data-days>' + [7, 30, 90].map((d) => '<option value="' + d + '"' + (d === days ? ' selected' : '') + '>' + d + ' days</option>').join('') + '</select></h4><div data-ins>' + insHtml() + '</div>'
        + '<div class="bx-acts"><button type="button" data-x="analyze">Refresh DB statistics</button><button type="button" data-x="conf">Celebrate</button></div>';
    };
    const insHtml = () => {
      if (!ins) return '<div class="bx-row"><span>Loading...</span></div>';
      const hh = ins.hours, wd = ins.weekdays, names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], peak = hh.indexOf(Math.max(...hh)), pd = wd.indexOf(Math.max(...wd));
      return '<div class="bx-row"><span>Busiest hour / day</span><span>' + (Math.max(...hh) ? peak + ':00 / ' + names[pd] : '-') + '</span></div>' + spark(hh)
        + (ins.top.length ? ins.top.map((t) => '<div class="bx-row"><span>' + esc(t.title) + '</span><span>' + t.qty + ' sold, ' + money(t.rev) + '</span></div>').join('') : '<div class="bx-row"><span>No sales in this period</span></div>')
        + (ins.customers.length ? '<h4>Best customers</h4>' + ins.customers.map((c) => '<div class="bx-row"><span>' + esc(c.username) + '</span><span>' + c.orders + ' orders, ' + money(c.spent) + '</span></div>').join('') : '');
    };
    const load = async () => {
      if (!panel.classList.contains('on')) return;
      try {
        const s = await api('/api/admin/boost/stats'); draw(s);
      } catch (e) { panel.innerHTML = '<h3>Admin Pulse <button type="button" data-x="close">x</button></h3><p>Could not load: ' + esc(e.message) + '</p>'; }
    };
    const loadIns = async () => { try { ins = await api('/api/admin/boost/insights?days=' + days); const d = panel.querySelector('[data-ins]'); if (d) d.innerHTML = insHtml(); } catch (e) { /* ignore */ } };
    const open = (on) => {
      panel.classList.toggle('on', on); clearInterval(timer);
      if (on) { load().then(loadIns); timer = setInterval(() => { if (!document.hidden) load(); }, 6000); }
    };
    btn.onclick = () => open(!panel.classList.contains('on'));
    panel.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      try {
        if (t.dataset.x === 'close') open(false);
        else if (t.dataset.x === 'conf') confetti();
        else if (t.dataset.x === 'analyze') { t.disabled = true; await api('/api/admin/boost/analyze', { method: 'POST', json: {} }); say('Database statistics refreshed.'); t.disabled = false; }
        else if (t.dataset.unban) { await api('/api/admin/boost/unban', { method: 'POST', json: { ip: t.dataset.unban } }); say('Unblocked.'); load(); }
      } catch (x) { say(x.message); }
    });
    panel.addEventListener('change', (e) => { if (e.target.matches('[data-days]')) { days = Number(e.target.value); ins = null; loadIns(); } });
    setInterval(() => { const on = isMain(); btn.classList.toggle('on', on); if (!on && panel.classList.contains('on')) open(false); }, 2500);
  });
})();
