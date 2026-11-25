(function (root) {
  'use strict';
  var el = null, state = { done: false, checks: [] };
  function bySlug() { var m = {}; root.RADAR.snapshot.protocols.forEach(function (p) { m[p.slug] = p; }); return m; }
  function result(id, label, n, of, detail, extra) { return { id: id, label: label, n: n, of: of, passed: n === of && of > 0, detail: detail, extra: extra || '' }; }

  /* 1. the model, re-run here, reproduces every value the board was written with */
  function values() {
    var R = root.RADAR, M = root.RadarModel, prot = bySlug(), v = M.classify(R.snapshot), f = M.fit(R.snapshot, v), ok = 0, bad = [];
    R.rows.forEach(function (r) {
      var p = prot[r.s];
      if (!p) { bad.push(r.s); return; }
      var x = M.value(f, p, v[r.s].flags.length);
      if (x.base === r.b && x.low === r.lo && x.high === r.hi) ok++; else bad.push(r.s);
    });
    return result('values', '00-model.js re-run reproduces every board value', ok, R.rows.length,
      'classify() + fit() + value() ran again on the ' + R.snapshot.protocols.length + ' snapshot records in this browser: ' + ok + ' of ' + R.rows.length + ' rows match the board on implied value, low and high.' + (bad.length ? ' Misses: ' + bad.slice(0, 4).join(', ') : ' No row differs.'),
      'Fitted here: log₁₀ value = ' + f.a + ' + ' + f.b + '·log₁₀ TVL, leave-one-out error ' + f.loo_mae + ' dex on ' + f.n + ' traded-token families.');
  }
  /* 2. every watchlist slug is on the board */
  function watchlist() {
    var R = root.RADAR, have = {}, miss = [];
    R.rows.forEach(function (r) { have[r.s] = 1; });
    R.snapshot.watchlist.forEach(function (s) { if (!have[s]) miss.push(s); });
    var flagged = R.rows.filter(function (r) { return r.w; }).length;
    return result('watchlist', 'watchlist coverage', R.snapshot.watchlist.length - miss.length, R.snapshot.watchlist.length,
      'The snapshot names ' + R.snapshot.watchlist.length + ' watchlist protocols; ' + (R.snapshot.watchlist.length - miss.length) + ' are ranked on the board, ' + flagged + ' marked WL.' + (miss.length ? ' Missing: ' + miss.join(', ') : ' Every slug is present.'));
  }
  /* 3. ranks 1..N, value never rising */
  function ranks() {
    var rows = root.RADAR.rows, bad = 0, seen = {}, rise = 0;
    rows.forEach(function (r, i) { if (r.r !== i + 1 || seen[r.r]) bad++; seen[r.r] = 1; if (i && r.b > rows[i - 1].b) rise++; });
    var n = rows.length - Math.min(rows.length, bad + rise);
    return result('ranks', 'ranks are 1..N and value never rises', n, rows.length,
      rows.length + ' rows carry ranks 1 to ' + rows.length + ' once each (' + bad + ' breaks); implied value is non-increasing from rank 1 (' + rise + ' rises).');
  }
  /* 4. no ranked row records a token */
  function noToken() {
    var R = root.RADAR, prot = bySlug(), bad = [];
    R.rows.forEach(function (r) { var p = prot[r.s]; if (!p || p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null) bad.push(r.s); });
    return result('no-token', 'no ranked row records a token', R.rows.length - bad.length, R.rows.length,
      'Each row\'s snapshot record is read again: gecko_id, symbol and mcap_usd must all be null.' + (bad.length ? ' Token recorded: ' + bad.slice(0, 4).join(', ') : ' The ' + R.comps.length + ' traded families are priced in Already trading, not ranked.'));
  }
  /* 5. every plan has 3-12 steps, each with a cost and a time */
  function plans() {
    var R = root.RADAR, bad = [], min = 99, max = 0;
    R.rows.forEach(function (r) {
      min = Math.min(min, r.st.length); max = Math.max(max, r.st.length);
      if (r.st.length < 3 || r.st.length > 12) bad.push(r.s + ' (' + r.st.length + ' steps)');
      r.st.forEach(function (s, i) { if (!s[1] || !s[2]) bad.push(r.s + ' step ' + (i + 1)); });
      if (!r.mr || !r.sr) bad.push(r.s + ' (risk or stop rule)');
    });
    return result('plans', 'every plan has 3-12 steps with a cost and a time', R.rows.length - Math.min(R.rows.length, bad.length), R.rows.length,
      'Steps per plan run ' + min + ' to ' + max + '; every step carries Cost and Time, every row one main risk and a stop rule.' + (bad.length ? ' Faults: ' + bad.slice(0, 3).join('; ') : ' No plan is missing one.'));
  }
  /* 6. each tab's row count equals the number in its label */
  function tabs() {
    var R = root.RADAR, want = { board: R.rows.length, live: R.comps.length, excluded: R.excluded.length, method: 7 }, bad = [], seen = 0;
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      var m = /(\d[\d,]*)\s*$/.exec(a.textContent.trim());
      if (!m) return;
      var n = Number(m[1].replace(/,/g, '')), w = want[a.dataset.view];
      seen++;
      if (w !== n) bad.push(a.dataset.view + ': label ' + n + ', ' + w + ' rows');
    });
    return result('tabs', 'every tab holds the number of rows its label says', seen - bad.length, seen,
      'Board ' + want.board + ', Already trading ' + want.live + ' families, Excluded ' + want.excluded + ', Method ' + want.method + ' sections; each header label is read back and compared.' + (bad.length ? ' ' + bad.join('; ') : ' Every label matches.'));
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
    el.innerHTML = '<b class="ctitle">' + (state.done ? (passed === n ? '✓ ' : '✗ ') + passed + ' of ' + n + ' checks passed in this browser' : 'Checking the page against the data in this browser…') + '</b><span class="csum">' +
      state.checks.map(function (c) {
        return '<details class="' + (c.passed ? 'ok' : 'bad') + '"><summary><i>' + (c.passed ? '✓' : '✗') + '</i> ' + c.label + ' <b>' + c.n + '/' + c.of + '</b></summary><p>' + c.detail + (c.extra ? ' ' + c.extra : '') + '</p></details>';
      }).join('') + '</span>';
  }
  root.RadarChecks = { run: run, paint: paint, mount: function (node) { el = node; paint(); } };
})(typeof window !== 'undefined' ? window : this);