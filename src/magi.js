  var busy = false;

  // ask the server how the run is going until it is done (a slow model never hits a request limit)
  function poll(id, total) {
    return new Promise(function (resolve, reject) {
      var fails = 0;
      (function again() {
        api('/api/admin/magi/job/' + encodeURIComponent(id)).then(function (j) {
          fails = 0;
          if (j.status === 'done') return resolve(j.result);
          if (j.status === 'error') return reject(new Error(j.error || 'The run failed'));
          var nodes = j.nodes || {}, done = Object.keys(nodes).filter(function (k) { return nodes[k].state === 'done' && nodes[k].round === j.round; }).length;
          resEn.textContent = (j.mode === 'link' ? 'CHAIN \u00b7 LINK ' : 'DELIBERATING \u00b7 ROUND ') + j.round + ' OF ' + (j.rounds || total);
          resSub.textContent = done + ' / 3 NODES \u00b7 ' + Math.round((j.elapsed || 0) / 1000) + 'S';
          setTimeout(again, 1200);
        }).catch(function (e) {
          if (++fails >= 5) return reject(e);
          setTimeout(again, 2500);
        });
      })();
    });
  }

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
    var total = lastMode === 'link' ? 3 : cfg.rounds;
    resEn.textContent = lastMode === 'link' ? 'CHAIN \u00b7 3 LINKS' : 'DELIBERATING \u00b7 ' + cfg.rounds + ' ROUND' + (cfg.rounds > 1 ? 'S' : '');
    resSub.textContent = '';
    Object.keys(cards).forEach(function (id) { if (cards[id].enabled) setBusy(cards[id]); });
    startAmbient();   // in case the first tap never started it
    startHum();
    startFlicker();
    var decree = cfg.mode === 'verdict' ? dec.value : '';
    api('/api/admin/magi', 'POST', { question: q, override: decree }).then(function (start) {
      return poll(start.job, total);
    }).then(function (d) {
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
