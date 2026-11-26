// checks.js — the live "checked in this browser" strip: six checks recomputed from window.RADAR.
(function (root) {
  'use strict';
  var el = null, state = { done: false, checks: [] };
  function bySlug() { var m = {}; root.RADAR.snapshot.protocols.forEach(function (p) { m[p.slug] = p; }); return m; }
  function result(id, label, n, of, detail, extra) { return { id: id, label: label, n: n, of: of, passed: n === of && of > 0, detail: detail, extra: extra || '' }; }

  /* 1. the model re-run reproduces every board value here. */
  function values() {
    var R = root.RADAR, M = root.RadarModel, prot = bySlug(), v = M.classify(R.snapshot), f = M.fit(R.snapshot, v), ok = 0, bad = [];
    R.rows.forEach(function (r) {
      var p = prot[r.s];
      if (!p) { bad.push(r.s); return; }
      var x = M.value(f, p, v[r.s].flags.length);
      if (x.base === r.b && x.low === r.lo && x.high === r.hi) ok++; else bad.push(r.s);
    });
    return result('values', '00-model re-run reproduces every value', ok, R.rows.length,
      'classify+fit+value on ' + R.snapshot.protocols.length + ' records: ' + ok + ' of ' + R.rows.length + ' match.' + (bad.length ? ' Misses: ' + bad.slice(0, 4).join(', ') : ' None differ.'),
      'log₁₀ value = ' + f.a + ' + ' + f.b + '·log₁₀ TVL, LOO ' + f.loo_mae + ' dex on ' + f.n + ' families.');
  }
  /* 2. every watchlist slug is on the board */
  function watchlist() {
    var R = root.RADAR, have = {}, miss = [];
    R.rows.forEach(function (r) { have[r.s] = 1; });
    R.snapshot.watchlist.forEach(function (s) { if (!have[s]) miss.push(s); });
    return result('watchlist', 'watchlist coverage', R.snapshot.watchlist.length - miss.length, R.snapshot.watchlist.length,
      R.snapshot.watchlist.length + ' slugs; ' + (R.snapshot.watchlist.length - miss.length) + ' ranked, ' + R.rows.filter(function (r) { return r.w; }).length + ' WL.' + (miss.length ? ' Missing: ' + miss.join(', ') : ' All present.'));
  }
  /* 3. ranks 1..N, value never rising */
  function ranks() {
    var rows = root.RADAR.rows, bad = 0, seen = {}, rise = 0;
    rows.forEach(function (r, i) { if (r.r !== i + 1 || seen[r.r]) bad++; seen[r.r] = 1; if (i && r.b > rows[i - 1].b) rise++; });
    return result('ranks', 'ranks are 1..N and value never rises', rows.length - Math.min(rows.length, bad + rise), rows.length,
      rows.length + ' rows once each (' + bad + ' breaks); non-increasing (' + rise + ' rises).');
  }
  /* 4. no ranked row records a token */
  function noToken() {
    var R = root.RADAR, prot = bySlug(), bad = [];
    R.rows.forEach(function (r) { var p = prot[r.s]; if (!p || p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null) bad.push(r.s); });
    return result('no-token', 'no ranked row records a token', R.rows.length - bad.length, R.rows.length,
      'gecko_id, symbol, mcap_usd all null.' + (bad.length ? ' Token: ' + bad.slice(0, 4).join(', ') : ' ' + R.comps.length + ' traded families sit in Already trading.'));
  }
  /* 5. every plan has 3-12 steps, each with a cost and time */
  function plans() {
    var R = root.RADAR, bad = [], min = 99, max = 0;
    R.rows.forEach(function (r) {
      min = Math.min(min, r.st.length); max = Math.max(max, r.st.length);
      if (r.st.length < 3 || r.st.length > 12) bad.push(r.s + ' (' + r.st.length + ')');
      r.st.forEach(function (s, i) { if (!s[1] || !s[2]) bad.push(r.s + ' step ' + (i + 1)); });
      if (!r.mr || !r.sr) bad.push(r.s + ' (risk/stop)');
    });
    return result('plans', 'every plan has 3-12 steps with cost and time', R.rows.length - Math.min(R.rows.length, bad.length), R.rows.length,
      'Steps ' + min + '–' + max + '; each has Cost and Time, each row a risk and stop rule.' + (bad.length ? ' Faults: ' + bad.slice(0, 3).join('; ') : ' None missing.'));
  }
  /* 6. each tab's label equals its row count */
  function tabs() {
    var R = root.RADAR, want = { board: R.rows.length, live: R.comps.length, excluded: R.excluded.length, method: 7 }, bad = [], seen = 0;
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      var m = /(\d[\d,]*)\s*$/.exec(a.textContent.trim());
      if (!m) return;
      var n = Number(m[1].replace(/,/g, '')), w = want[a.dataset.view];
      seen++;
      if (w !== n) bad.push(a.dataset.view + ': ' + n + ' vs ' + w);
    });
    return result('tabs', 'each tab label equals its row count', seen - bad.length, seen,
      'Board ' + want.board + ', trading ' + want.live + ', excluded ' + want.excluded + ', method ' + want.method + '.' + (bad.length ? ' ' + bad.join('; ') : ' All match.'));
  }

  function run() {
    var checks;
    try { checks = [values(), watchlist(), ranks(), noToken(), plans(), tabs()]; }
    catch (e) { checks = [{ id: 'error', label: 'the checks could not run', n: 0, of: 1, passed: false, detail: String(e && e.message || e) }]; }
    state = { done: true, checks: checks };
    paint();
  }
  function paint() {
    if (!el) return;
    var passed = state.checks.filter(function (c) { return c.passed; }).length, n = state.checks.length;
    el.className = 'checks ' + (state.done ? passed === n ? 'ok' : 'bad' : 'run');
    el.setAttribute('data-checks', state.done ? 'done' : 'running');
    el.innerHTML = '<b class="ctitle">' + (state.done ? (passed === n ? '✓ ' : '✗ ') + passed + ' of ' + n + ' checks passed in this browser' : 'Checking…') + '</b><span class="csum">' +
      state.checks.map(function (c) {
        return '<details class="' + (c.passed ? 'ok' : 'bad') + '"><summary><i>' + (c.passed ? '✓' : '✗') + '</i> ' + c.label + ' <b>' + c.n + '/' + c.of + '</b></summary><p>' + c.detail + (c.extra ? ' ' + c.extra : '') + '</p></details>';
      }).join('') + '</span>';
  }
  root.RadarChecks = { run: run, paint: paint, mount: function (node) { el = node; paint(); } };
})(typeof window !== 'undefined' ? window : this);