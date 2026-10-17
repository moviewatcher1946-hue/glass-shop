// Pauses looping animations that are off screen. Nothing visible changes: they carry on from the same point when they come back into view.
(function () {
  if (window.__perf || !('IntersectionObserver' in window)) return;
  window.__perf = true;
  var SEL = '.hero,.hero h2,.hp,.ticker-track,.slide,.slide .sl-k,.banner.glass,.sheen,.flash-badge,.cat-title,.empty svg,.sh-pill.hot,#cutoffpill';
  var seen = new WeakSet();
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var t = e.target;
      if (!t.isConnected) { io.unobserve(t); return; } // removed from the page: stop watching
      t.classList.toggle('pf-off', !e.isIntersecting);
    });
  }, { rootMargin: '120px' });

  function scan(root) {
    var list = [];
    if (root.nodeType === 1 && root.matches && root.matches(SEL)) list.push(root);
    if (root.querySelectorAll) { var q = root.querySelectorAll(SEL); for (var i = 0; i < q.length; i++) list.push(q[i]); }
    list.forEach(function (n) { if (!seen.has(n)) { seen.add(n); io.observe(n); } });
  }

  var queue = [], scheduled = false;
  function flush() { scheduled = false; var q = queue; queue = []; q.forEach(scan); }
  function later() { if (scheduled) return; scheduled = true; (window.requestAnimationFrame || setTimeout)(flush); }

  new MutationObserver(function (muts) {
    muts.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) if (m.addedNodes[i].nodeType === 1) queue.push(m.addedNodes[i]); });
    if (queue.length) later();
  }).observe(document.body, { childList: true, subtree: true });

  scan(document.body);
})();
