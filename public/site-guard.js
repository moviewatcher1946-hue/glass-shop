// Site Guard: client-side protection. expired-session cleanup, double-submit shield, frame-bust, offline notice, self-XSS warning.
(function () {
  var LS = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var user = function () { try { return JSON.parse(LS('user') || 'null'); } catch (e) { return null; } };
  var wipe = function () { try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {} };

  // 1. Never allow the shop to be shown inside another site's frame (the server also forbids it).
  try { if (window.top !== window.self) window.top.location = window.self.location; } catch (e) { document.documentElement.style.display = 'none'; }

  // 2. Self-XSS warning for people who open the console because someone told them to.
  try { console.log('%cStop!', 'color:#d22;font:bold 40px sans-serif'); console.log('Anyone asking you to paste code here is trying to take over your account.'); } catch (e) {}

  // 3. Double-submit shield: an identical change sent twice within 800 ms (double tap) is sent once; both callers get the same answer.
  var realFetch = window.fetch, recent = {};
  window.fetch = function (u, o) {
    var m = String((o && o.method) || 'GET').toUpperCase(), key = null;
    if (m !== 'GET' && typeof u === 'string' && u.indexOf('/api/') === 0 && (!o || typeof o.body === 'string' || o.body == null)) {
      key = m + ' ' + u + ' ' + ((o && o.body) || '');
      var hit = recent[key];
      if (hit && Date.now() - hit.t < 800) return hit.p.then(function (r) { return r.clone(); });
    }
    var p = realFetch.apply(this, arguments);
    // 4. Session guard: a rejected token (expired or revoked) signs this device out once, instead of leaving a broken screen.
    p.then(function (r) { if (r.status === 401 && LS('token') && u.indexOf('/api/auth/login') < 0) { wipe(); if (!sessionStorage.sgReload) { try { sessionStorage.sgReload = '1'; } catch (e) {} location.reload(); } } }).catch(function () {});
    if (key) { recent[key] = { t: Date.now(), p: p.then(function (r) { return r.clone(); }) }; setTimeout(function () { delete recent[key]; }, 1000); }
    return p;
  };

  // 6. Offline notice, so a lost connection is not mistaken for a broken shop.
  var off = null;
  function net() {
    if (navigator.onLine === false) { if (!off) { off = document.createElement('div'); off.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:6px;text-align:center;background:#b3261e;color:#fff;font:600 13px sans-serif'; off.textContent = 'No internet connection'; document.body.appendChild(off); } }
    else if (off) { off.remove(); off = null; }
  }
  addEventListener('online', net); addEventListener('offline', net);
})();
