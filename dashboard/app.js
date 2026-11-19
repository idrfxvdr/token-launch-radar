/* Token Launch Radar: the page. Reads window.RADAR (data.js, written by main.ts); no network, no framework.
   State lives in the URL hash, so every view (a filter, a sort, a protocol's detail) is a link. */
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts to write it beside dashboard/.</p>'; return; }

  /* ---------- formatting ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) {
    var a = Math.abs(n);
    return a >= 1e9 ? '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
  }
  function pct(x) { return x === null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function fx(x, d) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d === undefined ? 3 : d); }
  function times(x) { return '×' + (Math.pow(10, x)).toFixed(2); }
  var PR = { 'farm now': 'now', watch: 'watch', skip: 'skip' };
  var PR_ORDER = { 'farm now': 0, watch: 1, skip: 2 };
  function pill(p) { return '<span class="pill ' + PR[p] + '">' + esc(p) + '</span>'; }

  /* ---------- state in the hash ---------- */
  var DEF = { view: 'board', q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '', sort: 'r', dir: 'asc', p: '' };
  function read() {
    var s = Object.assign({}, DEF), h = new URLSearchParams(location.hash.slice(1));
    Object.keys(DEF).forEach(function (k) { if (h.has(k)) s[k] = h.get(k); });
    return s;
  }
  function write(patch, push) {
    var s = Object.assign(read(), patch), h = new URLSearchParams();
    Object.keys(DEF).forEach(function (k) { if (s[k] !== DEF[k] && s[k] !== '') h.set(k, s[k]); });
    var url = '#' + h.toString();
    if (push) location.hash = url; else { history.replaceState(null, '', url); render(); }
  }

  /* ---------- theme ---------- */
  var root = document.documentElement;
  try { var saved = localStorage.getItem('radar-theme'); if (saved) root.dataset.theme = saved; } catch (e) { /* storage blocked */ }
  if (root.dataset.theme !== 'light' && root.dataset.theme !== 'dark') root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.getElementById('theme').onclick = function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('radar-theme', root.dataset.theme); } catch (e) { /* storage blocked */ }
  };

  /* ---------- derived lists ---------- */
  var rows = R.rows;
  /* Re-run model.js (the code that wrote board.json) on the raw snapshot, here in the browser, and check it. */
  var check = (function () {
    var M = window.RadarModel;
    if (!M || !R.snapshot) return { ok: 0, n: rows.length, ran: false };
    var verdicts = M.classify(R.snapshot), fitted = M.fit(R.snapshot, verdicts), bySlug = {}, ok = 0;
    R.snapshot.protocols.forEach(function (p) { bySlug[p.s || p.slug] = p; });
    rows.forEach(function (r) { var v = M.value(fitted, bySlug[r.s], verdicts[r.s].flags.length); if (verdicts[r.s].status === 'candidate' && v.base === r.b && v.low === r.lo && v.high === r.hi) ok++; });
    return { ok: ok, n: rows.length, ran: true, live: Object.keys(verdicts).filter(function (k) { return verdicts[k].status === 'live'; }).length };
  })();
  var cats = uniq(rows.map(function (r) { return r.c; }));
  var chains = uniq([].concat.apply([], rows.map(function (r) { return r.ch; })));
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
  var BANDS = { '<50M': [0, 5e7], '50-250M': [5e7, 2.5e8], '250M-1B': [2.5e8, 1e9], '>1B': [1e9, Infinity] };
  var lo = Math.min.apply(null, rows.map(function (r) { return r.lo; })), hi = Math.max.apply(null, rows.map(function (r) { return r.hi; }));

  function filtered(s) {
    var q = s.q.toLowerCase();
    return rows.filter(function (r) {
      if (q && (r.n + ' ' + r.s + ' ' + r.c + ' ' + r.ch.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (s.cat && r.c !== s.cat) return false;
      if (s.chain && r.ch.indexOf(s.chain) < 0) return false;
      if (s.tvl && BANDS[s.tvl] && !(r.tvl >= BANDS[s.tvl][0] && r.tvl < BANDS[s.tvl][1])) return false;
      if (s.conf && r.conf < +s.conf) return false;
      if (s.pr && r.pr !== s.pr) return false;
      if (s.w === '1' && !r.w) return false;
      return true;
    });
  }
  var KEYS = { r: 'r', n: 'n', c: 'c', ch: function (r) { return r.ch.length; }, tvl: 'tvl', d7: function (r) { return r.d7 === null ? -1e9 : r.d7; }, b: 'b', conf: 'conf', od: 'od', pr: function (r) { return PR_ORDER[r.pr]; } };
  function sorted(list, s) {
    var k = KEYS[s.sort] || 'r', get = typeof k === 'function' ? k : function (r) { return r[k]; }, d = s.dir === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) { var x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * d || a.r - b.r; });
  }

  /* ---------- small charts (inline SVG, no namespace URL needed in HTML) ---------- */
  function trend(r) {
    if (r.d7 === null) return '<svg width="44" height="18" aria-hidden="true"><line x1="2" y1="9" x2="42" y2="9" stroke="var(--line)" stroke-dasharray="3 3"/></svg>';
    var prev = r.tvl / (1 + r.d7 / 100), mx = Math.max(prev, r.tvl), mn = Math.min(prev, r.tvl), span = mx - mn || 1;
    var y0 = 15 - ((prev - mn) / span) * 12, y1 = 15 - ((r.tvl - mn) / span) * 12, c = r.d7 >= 0 ? 'var(--pos)' : 'var(--neg)';
    if (Math.abs(r.d7) < 0.5) { y0 = 9; y1 = 9; }
    return '<svg width="44" height="18" role="img" aria-label="7-day TVL ' + pct(r.d7) + '"><polyline points="2,' + y0.toFixed(1) + ' 42,' + y1.toFixed(1) + '" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="42" cy="' + y1.toFixed(1) + '" r="2.5" fill="' + c + '"/></svg>';
  }
  function lx(v, w) { return (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * w; }
  function rangeBar(r) {
    var w = 90, a = lx(r.lo, w), b = lx(r.hi, w), m = lx(r.b, w);
    return '<svg width="' + w + '" height="10" aria-hidden="true"><rect x="0" y="4" width="' + w + '" height="2" fill="var(--line)"/><rect x="' + a.toFixed(1) + '" y="2" width="' + Math.max(2, b - a).toFixed(1) + '" height="6" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width=".8"/><rect x="' + (m - 1).toFixed(1) + '" y="0" width="2.4" height="10" fill="var(--accent)"/></svg>';
  }

  /* ---------- views ---------- */
  function kpis() {
    var tvl = 0, val = 0, now = 0, byCat = {};
    rows.forEach(function (r) { tvl += r.tvl; val += r.b; if (r.pr === 'farm now') now++; byCat[r.c] = (byCat[r.c] || 0) + r.tvl; });
    var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3);
    var covered = rows.filter(function (r) { return r.w; }).length;
    function k(b, span, small) { return '<div class="kpi"><b>' + b + '</b><span>' + span + '</span>' + (small ? '<small>' + small + '</small>' : '') + '</div>'; }
    return '<section class="kpis" aria-label="Headline numbers">' +
      k(covered + ' / ' + R.counts.watchlist, 'watchlist covered', 'every house slug ranked') +
      k(String(rows.length), 'pre-token candidates', (rows.length - covered) + ' beyond the house list') +
      k(usd(tvl), 'TVL with no token', R.counts.live + ' with a token kept off') +
      k(usd(val), 'implied launch value', 'sum of base cases') +
      k(String(now), 'farm now', 'of ' + rows.length + ' plans') +
      k(esc(top[0]), 'top category by TVL', esc(top.slice(1).join(' · '))) + '</section>' + split();
  }
  /* Every protocol in the snapshot, in one bar: ranked pre-token candidates, tokens that trade, products of a traded token. */
  function split() {
    var c = R.counts, all = c.protocols, parts = [['board', rows.length, 'pre-token candidates, ranked below', 'var(--accent)'], ['live', c.live, 'token already trades: comparables, not ranked', 'var(--pos)'], ['excluded', c.excluded, 'no token, but a product of a traded one', 'var(--peer)']];
    return '<section class="split" aria-label="Where every protocol in the snapshot went"><div class="bar">' + parts.map(function (x) { return '<a href="#view=' + x[0] + '" style="flex:' + x[1] + ';background:' + x[3] + '" title="' + x[1] + ' ' + x[2] + '"></a>'; }).join('') + '</div><div class="legend"><b>' + all + ' protocols in the snapshot:</b> ' +
      parts.map(function (x) { return '<span><i style="background:' + x[3] + '"></i><b>' + x[1] + '</b> ' + x[2] + '</span>'; }).join('') + '</div></section>';
  }
  function opts(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function board(s) {
    var list = sorted(filtered(s), s);
    var seg = ['', 'farm now', 'watch', 'skip'].map(function (p) { return '<button type="button" data-pr="' + p + '" aria-pressed="' + (s.pr === p) + '">' + (p || 'All') + '</button>'; }).join('');
    var chips = [];
    function chip(key, label) { chips.push('<span class="chip">' + esc(label) + '<button type="button" data-unset="' + key + '" aria-label="Remove filter ' + esc(label) + '">×</button></span>'); }
    if (s.q) chip('q', 'search: ' + s.q);
    if (s.cat) chip('cat', 'category: ' + s.cat);
    if (s.chain) chip('chain', 'chain: ' + s.chain);
    if (s.tvl) chip('tvl', 'TVL ' + s.tvl);
    if (s.conf) chip('conf', 'confidence ≥ ' + s.conf);
    if (s.pr) chip('pr', 'priority: ' + s.pr);
    if (s.w) chip('w', 'watchlist only');
    function th(key, label, cls) {
      var sort = s.sort === key ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none';
      return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + sort + '"><button type="button" data-sort="' + key + '">' + label + '</button></th>';
    }
    var body = list.map(function (r) {
      return '<tr tabindex="0" data-p="' + esc(r.s) + '"><td class="n">' + r.r + '</td>' +
        '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="tag w" title="On the house watchlist">WL</span>' : '') + (r.fl.length ? '<span class="tag f" title="' + esc(r.fl.join('; ')) + '">⚑ flag</span>' : '') + '</td>' +
        '<td class="hide-sm cat" title="' + esc(r.c) + '">' + esc(r.c) + '</td>' +
        '<td class="hide-md chainlist">' + esc(r.ch[0] || '') + (r.ch.length > 1 ? ' +' + (r.ch.length - 1) : '') + '</td>' +
        '<td class="n"><div class="tvl"><span>' + usd(r.tvl) + '</span>' + trend(r) + '<span class="d7 ' + (r.d7 === null ? 'muted' : r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + '</span></div></td>' +
        '<td class="n hide-sm nw"><b>' + Math.round(r.od * 100) + '%</b> <span class="muted">' + (r.age === null ? 'age n/a' : (r.age / 365).toFixed(1) + 'y') + '</span></td>' +
        '<td><div class="range"><span class="hide-sm">' + rangeBar(r) + '</span><b>' + usd(r.b) + '</b><small>' + usd(r.lo) + ' – ' + usd(r.hi) + ' · if launched ' + usd(r.ifl) + '</small></div></td>' +
        '<td class="n hide-sm nw"><span class="meter"><i style="width:' + r.conf + '%"></i></span>' + r.conf + '</td>' +
        '<td class="nw">' + pill(r.pr) + '<small class="net ' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + ' net</small></td></tr>';
    }).join('');
    return kpis() +
      '<p class="howto"><b>How to read it:</b> implied value = what a token would be worth if launched (a size curve fitted on the ' + R.fit.n + ' traded token families here, plus a category premium) × the fitted odds it launches within 12 months, which rise with the time it has run with no token. Every term was tested blind: ' + R.tests.filter(function (t) { return t.name.charAt(0) === '+'; }).map(function (t) { return t.name.slice(2) + (t.mae < R.tests[1].mae ? ' kept' : ' rejected'); }).join(', ') + ' (Method). Farm plans are netted for odds, gas, fees and T-bill yield.' +
        (check.ran ? ' <span class="' + (check.ok === check.n ? 'up' : 'down') + '"><b>' + (check.ok === check.n ? '✓' : '✗') + ' model.js re-run in this browser: ' + check.ok + ' / ' + check.n + ' values match board.json.</b></span>' : '') + '</p>' +
      '<form class="filters" role="search" onsubmit="return false">' +
      '<input type="search" id="q" placeholder="Search protocol, category or chain" aria-label="Search" value="' + esc(s.q) + '">' +
      '<select id="cat" aria-label="Category">' + opts(cats, s.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + opts(chains, s.chain, 'All chains') + '</select>' +
      '<select id="tvl" aria-label="TVL band">' + opts(Object.keys(BANDS), s.tvl, 'Any TVL') + '</select>' +
      '<select id="conf" aria-label="Minimum confidence"><option value="">Any confidence</option>' + ['40', '55', '70'].map(function (c) { return '<option value="' + c + '"' + (s.conf === c ? ' selected' : '') + '>Confidence ≥ ' + c + '</option>'; }).join('') + '</select>' +
      '<div class="seg" role="group" aria-label="Farm priority">' + seg + '</div>' +
      '<label class="muted"><input type="checkbox" id="w"' + (s.w ? ' checked' : '') + '> Watchlist only</label></form>' +
      '<div class="chips" aria-live="polite"><span class="muted"><b>' + list.length + ' of ' + rows.length + '</b> shown' + (s.w && list.length === R.counts.watchlist ? ' (all ' + R.counts.watchlist + ' watchlist protocols)' : '') + ' · ' + (chips.length ? 'filters:' : 'no filters') + '</span>' + chips.join('') + (chips.length ? '<button type="button" class="clear" data-unset="all">Clear all</button>' : '') + '</div>' +
      '<div class="tablewrap"><table><caption class="sr" hidden>Pre-token protocols ranked by implied launch value</caption><thead><tr>' +
      th('r', '#', 'n') + th('n', 'Protocol') + th('c', 'Category', 'hide-sm') + th('ch', 'Chains', 'hide-md') + th('tvl', 'TVL · 7d', 'n') + th('od', '12-mo odds · age', 'n hide-sm') + th('b', 'Implied value = if launched × odds') + th('conf', 'Conf.', 'n hide-sm') + th('pr', 'Farm · net') +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>') + '</tbody></table></div>';
  }

  function scatter(r) {
    var W = 680, H = 280, P = 46, comps = R.comps;
    function dec(t) { var u = ['', 'K', 'M', 'B', 'T'], k = Math.floor(t / 3); return '$' + Math.pow(10, t - 3 * k) + u[k]; }
    var xs = comps.map(function (c) { return Math.log10(c.tvl); }), ys = comps.map(function (c) { return Math.log10(c.mc); });
    var x0 = Math.floor(Math.min.apply(null, xs.concat([Math.log10(r.tvl)]))), x1 = Math.ceil(Math.max.apply(null, xs.concat([Math.log10(r.tvl)])));
    var y0 = Math.floor(Math.min.apply(null, ys.concat([Math.log10(r.lo * r.ifl / r.b)]))), y1 = Math.ceil(Math.max.apply(null, ys.concat([Math.log10(r.hi * r.ifl / r.b)])));
    function X(v) { return P + (v - x0) / (x1 - x0) * (W - P - 10); }
    function Y(v) { return H - 22 - (v - y0) / (y1 - y0) * (H - 32); }
    var g = '';
    for (var t = x0; t <= x1; t++) g += '<line x1="' + X(t) + '" y1="10" x2="' + X(t) + '" y2="' + (H - 22) + '" stroke="var(--line)"/><text x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + dec(t) + '</text>';
    for (t = y0; t <= y1; t++) g += '<line x1="' + P + '" y1="' + Y(t) + '" x2="' + (W - 10) + '" y2="' + Y(t) + '" stroke="var(--line)"/><text x="' + (P - 4) + '" y="' + (Y(t) + 3) + '" text-anchor="end">' + dec(t) + '</text>';
    g += '<line x1="' + X(x0) + '" y1="' + Y(R.fit.a + R.fit.b * x0) + '" x2="' + X(x1) + '" y2="' + Y(R.fit.a + R.fit.b * x1) + '" stroke="var(--muted)" stroke-dasharray="5 4"/>';
    comps.forEach(function (c) {
      var same = c.c === r.c, sec = c.sec === r.sec;
      g += '<circle cx="' + X(Math.log10(c.tvl)).toFixed(1) + '" cy="' + Y(Math.log10(c.mc)).toFixed(1) + '" r="' + (same ? 4.5 : 3) + '" fill="' + (same ? 'var(--accent)' : sec ? 'var(--peer)' : 'none') + '" stroke="var(--peer)" opacity="' + (same || sec ? 0.95 : 0.6) + '"><title>' + esc(c.n + ' (' + c.sym + '): ' + usd(c.mc) + ' cap on ' + usd(c.tvl) + ' TVL') + '</title></circle>';
    });
    var k = r.ifl / r.b, L = { lo: r.lo * k, b: r.ifl, hi: r.hi * k }, cx = X(Math.log10(r.tvl));
    g += '<line x1="' + cx + '" y1="' + Y(Math.log10(L.lo)) + '" x2="' + cx + '" y2="' + Y(Math.log10(L.hi)) + '" stroke="var(--hi)" stroke-width="3" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + Y(Math.log10(L.b)) + '" r="6" fill="var(--bg)" stroke="var(--hi)" stroke-width="3"/>';
    g += '<text x="' + (cx + 9) + '" y="' + (Y(Math.log10(L.b)) + 4) + '" style="fill:var(--ink);font-weight:700">' + esc(r.n) + ' if launched ' + usd(L.b) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL for ' + comps.length + ' tokenised protocols, with this protocol\'s implied range">' + g + '</svg>' +
      '<p class="muted" style="font-size:12px;margin:4px 0 0">Dots: the ' + comps.length + ' protocols whose token trades (filled orange: ' + esc(r.c) + '; grey: ' + esc(r.sec) + '). Dashed: the size curve. Bar and ring: this protocol\'s value if launched, low–high and base.</p>';
  }

  function peers(r) {
    var same = R.comps.filter(function (c) { return c.c === r.c; }), basis = same.length >= 3 ? same : R.comps.filter(function (c) { return c.sec === r.sec; });
    var near = basis.slice().sort(function (a, b) { return Math.abs(Math.log10(a.tvl / r.tvl)) - Math.abs(Math.log10(b.tvl / r.tvl)) || (a.s < b.s ? -1 : 1); }).slice(0, 6);
    if (!near.length) return '<p class="muted">No tokenised peer in this sector: the category premium falls back to the market-wide curve.</p>';
    var mult = basis.map(function (c) { return c.x; }).sort(function (a, b) { return a - b; }), med = mult[Math.floor(mult.length / 2)];
    return '<p class="muted" style="margin:0 0 6px">' + (same.length >= 3 ? 'Same category' : 'Same sector (' + esc(r.sec) + ')') + ': ' + basis.length + ' tokenised peers, median market cap / TVL ' + med.toFixed(2) + '×; this row\'s implied ' + r.m.toFixed(2) + '×.</p>' +
      '<table class="peers"><thead><tr><th>Peer (nearest TVL)</th><th class="n">TVL</th><th class="n">Mcap</th><th class="n">Mcap/TVL</th><th class="n">vs curve</th></tr></thead><tbody>' +
      near.map(function (c) { return '<tr><td>' + esc(c.n) + ' <span class="muted">' + esc(c.sym) + '</span></td><td class="n">' + usd(c.tvl) + '</td><td class="n">' + usd(c.mc) + '</td><td class="n">' + c.x.toFixed(2) + '×</td><td class="n">' + times(c.e) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function math(r) {
    var t = r.t, cd = r.cd, logV = t.curve + t.cat;
    function row(label, how, v) { return '<tr><td>' + label + '<br><span class="muted">' + how + '</span></td><td>' + v + '</td></tr>'; }
    return '<table class="math"><tbody>' +
      row('Size curve on TVL carried a week', R.fit.a + ' + ' + R.fit.b + ' × log₁₀(' + usd(r.tvl) + ' × ' + r.cy.toFixed(3) + ' 7d carry)', fx(t.curve)) +
      row(esc(r.c) + ' premium', cd.w_cat.toFixed(2) + ' × ' + fx(cd.category_median, 2) + ' (' + cd.category_n + ' peer' + (cd.category_n === 1 ? '' : 's') + ') + ' + (1 - cd.w_cat).toFixed(2) + ' × [' + cd.w_sector.toFixed(2) + ' × ' + fx(cd.sector_median, 2) + ' ' + esc(cd.sector) + ']', fx(t.cat)) +
      '<tr class="tot"><td>log₁₀ V = ' + logV.toFixed(3) + ' → value if launched</td><td>' + usd(r.ifl) + '</td></tr>' +
      row('× launch odds, 12 months', (r.age === null ? 'no listing date: age taken as 2y' : (r.age / 365).toFixed(2) + 'y with no token') + ' on F(a) = 1/(1+e^−(' + R.odds.c0 + ' + ' + R.odds.c1 + 'a))' + (r.fl.length ? ', × ' + R.flag_odds + ' per flag' : ''), '× ' + Math.round(r.od * 100) + '%') +
      '<tr class="tot"><td>Implied value (ranked)</td><td>' + usd(r.b) + '</td></tr>' +
      row('Low / high', 'peers\' residual quartiles ' + fx(r.sp.q25, 2) + ' / ' + fx(r.sp.q75, 2) + ', × odds', usd(r.lo) + ' – ' + usd(r.hi)) + '</tbody></table>';
  }
  /* Launch odds: the share of protocols with a token by age (bars), the fitted curve, and where this one sits. */
  function oddsChart(r) {
    var W = 320, H = 150, F = function (a) { return 1 / (1 + Math.exp(-(R.odds.c0 + R.odds.c1 * a))); }, X = function (a) { return 28 + a / 6 * (W - 36); }, Y = function (v) { return H - 20 - v * (H - 32); }, g = '', a;
    R.odds.bins.forEach(function (b) { g += '<rect x="' + X(b.from) + '" y="' + Y(b.share) + '" width="' + (X(b.to) - X(b.from) - 3) + '" height="' + (Y(0) - Y(b.share)) + '" fill="var(--sunk)" stroke="var(--line)"/><text x="' + (X(b.from) + 4) + '" y="' + (Y(b.share) - 3) + '">' + Math.round(b.share * 100) + '% of ' + b.n + '</text>'; });
    var d = ''; for (a = 0; a <= 6.01; a += 0.25) d += (a ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(F(a)).toFixed(1);
    g += '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
    for (a = 0; a <= 6; a += 2) g += '<text x="' + X(a) + '" y="' + (H - 6) + '" text-anchor="middle">' + a + 'y</text>';
    var ra = Math.min(6, r.age === null ? 2 : r.age / 365), rb = Math.min(6, ra + 1);
    g += '<line x1="' + X(ra) + '" y1="' + Y(F(ra)) + '" x2="' + X(rb) + '" y2="' + Y(F(rb)) + '" stroke="var(--hi)" stroke-width="5" stroke-linecap="round" opacity=".55"/><circle cx="' + X(ra) + '" cy="' + Y(F(ra)) + '" r="5" fill="var(--hi)"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Share of protocols with a token by age, fitted curve">' + g + '</svg><p class="muted" style="font-size:12px;margin:4px 0 0">Bars: share of protocols with a token, by age. Line: the fit. Dot: ' + esc(r.n) + ' at ' + (r.age === null ? '2y (assumed)' : (r.age / 365).toFixed(1) + 'y') + '; the next year along the curve gives its ' + Math.round(r.od * 100) + '% odds.</p>';
  }

  function detail(slug) {
    var r = rows.filter(function (x) { return x.s === slug; })[0], sheet = document.getElementById('sheet'), panel = document.getElementById('panel');
    if (!r) { sheet.hidden = true; return; }
    var done = {};
    try { done = JSON.parse(localStorage.getItem('radar-done-' + r.s) || '{}'); } catch (e) { done = {}; }
    panel.innerHTML =
      '<div class="phead"><div><div class="muted">#' + r.r + ' of ' + rows.length + ' · ' + esc(r.c) + ' · ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) + ' more' : '') + (r.w ? ' <span class="tag w">house watchlist</span>' : '') + '</div><h2 id="d-title">' + esc(r.n) + '</h2></div><button class="close" type="button" data-close>Close ✕</button></div>' +
      '<div class="cols"><div><div class="grid2"><div class="card"><h3>Implied value</h3><div class="big">' + usd(r.b) + '</div><div class="chain">' + usd(r.tvl) + ' TVL → <b>' + usd(r.ifl) + '</b> if launched → × <b>' + Math.round(r.od * 100) + '%</b> odds → <b>' + usd(r.b) + '</b></div><div class="muted">range ' + usd(r.lo) + ' – ' + usd(r.hi) + '</div><div style="margin-top:8px">' + r.dr.map(function (d) { return '<span class="tag">' + esc(d) + '</span>'; }).join(' ') + '</div></div>' +
      '<div class="card"><h3>Confidence ' + r.conf + ' / 100 · ' + pill(r.pr) + '</h3><div class="muted" style="font-size:12px">' + r.cp.map(function (p) { return esc(p[0]) + ' <b style="color:var(--ink)">' + (p[1] >= 0 && p[0] !== 'start' ? '+' : '') + p[1] + '</b>'; }).join(' · ') + '</div><p style="margin:8px 0 0">' + esc(r.pw) + '</p></div></div>' +
      '<div class="card"><h3>Valuation: the arithmetic</h3>' + math(r) + '</div>' +
      '<div class="card"><h3>Against the tokenised market</h3>' + scatter(r) + '</div>' +
      '<div class="card"><h3>Comparables used</h3>' + peers(r) + '</div></div><div>' +
      '<div class="card"><h3>Why it is on the radar</h3><p style="margin:0">' + esc(r.why) + '</p>' + (r.fl.length ? '<ul class="risks">' + r.fl.map(function (f) { return '<li>⚑ ' + esc(f) + '</li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div class="card"><h3>Farm plan</h3><div class="facts"><span>Chain <b>' + esc(r.chain) + '</b></span><span>Capital <b>' + usd(r.cap[0]) + ' → ' + usd(r.cap[1]) + '</b></span><span>Horizon <b>' + r.wk + ' weeks</b></span><span>Slice if launched <b>$' + r.sl + '</b></span><span>× odds <b>' + Math.round(r.oh * 100) + '%</b></span><span>T-bill given up <b>$' + r.tb + '</b></span><span>Break-even odds <b>' + Math.round(r.be * 100) + '%</b></span><span>Gas <b>' + esc(r.gas) + '</b></span><span>Gas &amp; fees <b>~$' + r.tc + '</b></span><span>Expected <b>~$' + r.dp + '</b></span><span>Net <b class="' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + '</b></span><span>Hands-on <b>~' + r.hr + ' h</b></span></div>' +
      '<ol class="steps">' + r.st.map(function (st, i) { return '<li><label><input type="checkbox" data-step="' + i + '"' + (done[i] ? ' checked' : '') + '><span>' + esc(st[0]) + '<span class="ct">' + (st[3] ? '<i class="when">' + esc(st[3]) + '</i>' : '') + '<i>Cost: ' + esc(st[1]) + '</i><i>Time: ' + esc(st[2]) + '</i></span></span></label></li>'; }).join('') + '</ol></div>' +
      '<div class="card"><h3>Risks</h3><ul class="risks">' + r.rk.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="card"><h3>Launch odds from time with no token</h3>' + oddsChart(r) + '</div></div></div>';
    panel.onchange = function (e) {
      var i = e.target.getAttribute('data-step');
      if (i === null) return;
      done[i] = e.target.checked;
      try { localStorage.setItem('radar-done-' + r.s, JSON.stringify(done)); } catch (er) { /* storage blocked */ }
    };
    sheet.hidden = false;
    panel.scrollTop = 0;
    panel.focus();
  }
  function live() {
    var c = R.comps.slice().sort(function (a, b) { return b.mc - a.mc || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Already trading: the comparables</h2><p>' + R.counts.live + ' records carry a token and are kept off the board. Records sharing a symbol are one family, TVL summed and market cap counted once: these ' + c.length + ' families price every candidate. "vs curve": market cap against the size curve.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Token</th><th class="hide-sm">Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap/TVL</th><th class="n hide-sm">vs curve</th></tr></thead><tbody>' +
      c.map(function (x) { return '<tr><td class="pname">' + esc(x.n) + '</td><td>' + esc(x.sym) + '</td><td class="hide-sm">' + esc(x.c) + '</td><td class="n">' + usd(x.tvl) + '</td><td class="n">' + usd(x.mc) + '</td><td class="n">' + x.x.toFixed(2) + '×</td><td class="n hide-sm ' + (x.e >= 0 ? 'up' : 'down') + '">' + times(x.e) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function excluded() {
    var x = R.excluded.slice().sort(function (a, b) { return b.tvl - a.tvl || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Excluded: no token recorded, but not a launch candidate</h2><p>' + x.length + ' records carry no token but are a wrapped, staked, bridged or exchange product, or a version of a protocol whose token trades. House watchlist rows stay on the board, flagged.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Record</th><th class="hide-sm">Category</th><th class="n">TVL</th><th>Why it is off the board</th></tr></thead><tbody>' +
      x.map(function (e) { return '<tr><td class="pname">' + esc(e.n) + '</td><td class="hide-sm">' + esc(e.c) + '</td><td class="n">' + usd(e.tvl) + '</td><td>' + esc(e.why) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function method() {
    var f = R.fit, o = R.odds, best = R.tests[1].mae;
    return '<article class="prose">' +
      '<h2>What the board claims</h2><p>For each protocol that records no token: what a token would be worth if launched with its record as it stands, the odds it launches within a year, and whether farming it pays. Snapshot: ' + esc(R.source) + ', ' + R.counts.protocols + ' protocols. The code is model.js, run by main.ts and again by this page.</p>' +
      '<h2>1. Who is ranked</h2><p><b>' + R.counts.live + '</b> record a token (comparables). <b>' + R.counts.excluded + '</b> record none but are Liquid Staking, Bridge or CEX records, wrapped/staked names, exchange names, version markers, or share a first word with a traded token. <b>' + rows.length + '</b> remain, all ' + R.counts.watchlist + ' watchlist slugs among them; a watchlist row a rule doubts keeps a ⚑ flag.</p>' +
      '<h2>2. Value if launched, tested blind</h2><p>Each of the ' + f.n + ' token families is left out, the model refitted on the rest, its market cap predicted. A term is used only if it lowers that error:</p><table class="math" style="max-width:560px"><tbody>' +
      R.tests.map(function (t) { var plus = t.name.charAt(0) === '+', used = t.name === 'size curve' || (plus && t.mae < best); return '<tr' + (used ? ' class="tot"' : '') + '><td>' + esc(t.name) + (plus ? (t.mae < best ? ' · kept' : ' · rejected') : '') + '</td><td>' + t.mae.toFixed(3) + ' dex · ×' + Math.pow(10, t.mae).toFixed(2) + ' · ' + Math.round(t.w2 * 100) + '% within 2×</td></tr>'; }).join('') + '</tbody></table>' +
      '<p>Curve: log₁₀ mcap = ' + f.a + ' + ' + f.b + '·log₁₀ TVL. 7d growth enters as a projection, TVL carried one more week at its rate (as a fitted term it lost the test). The category premium is the median residual of its peers, shrunk to its sector\'s with weight n/(n+' + R.k + ').</p>' +
      '<h2>3. Launch odds from time with no token</h2><p>Share of protocols with a token by age: ' + o.bins.map(function (b) { return b.from + '–' + b.to + 'y ' + Math.round(b.share * 100) + '%'; }).join(', ') + ' (' + o.n + ' records). Fitted F(a) = 1/(1+e^−(' + o.c0 + ' + ' + o.c1 + 'a)); odds of a launch within a year at age a: (F(a+1) − F(a)) / (1 − F(a)); × ' + R.flag_odds + ' per caution flag. A cross-section, not a panel: an estimate.</p>' +
      '<h2>4. Farm verdicts</h2><p><code>net = ' + Math.round(R.user_share * 100) + '% × value if launched × position / TVL × odds − gas − fees − ' + Math.round(R.tbill * 100) + '% T-bill yield while held</code>. <b>Farm now</b>: no flag, confidence ≥ 55, 7d TVL above −12%, net ≥ $25 and ≥ its costs. <b>Skip</b>: a flag, confidence &lt; 40 or a net loss. Else <b>watch</b>.</p>' +
      '<h2>Caveats</h2><p class="note">Estimates, not financial advice. No fees, revenue, raises, audits or history in the snapshot, so none used; market caps stand in for FDV. A record with no token may still have one.</p></article>';
  }

  /* ---------- render and events ---------- */
  function render() {
    var s = read();
    document.getElementById('asof').textContent = 'Snapshot ' + R.as_of + ' · ' + rows.length + ' pre-token candidates ranked by implied launch value';
    [].forEach.call(document.querySelectorAll('.tabs a'), function (a) { if (a.dataset.view === s.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var focusId = document.activeElement && document.activeElement.id;
    app.innerHTML = s.view === 'live' ? live() : s.view === 'excluded' ? excluded() : s.view === 'method' ? method() : board(s);
    if (focusId === 'q') { var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    if (s.p) detail(s.p); else document.getElementById('sheet').hidden = true;
  }
  app.addEventListener('input', function (e) { if (e.target.id === 'q') write({ q: e.target.value }); });
  app.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'w') write({ w: e.target.checked ? '1' : '' });
    else if (id === 'cat' || id === 'chain' || id === 'tvl' || id === 'conf') { var p = {}; p[id] = e.target.value; write(p); }
  });
  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-pr],[data-unset],tr[data-p]');
    if (!t) return;
    var s = read();
    if (t.dataset.sort) write({ sort: t.dataset.sort, dir: s.sort === t.dataset.sort && s.dir === 'asc' ? 'desc' : s.sort === t.dataset.sort ? 'asc' : (t.dataset.sort === 'r' || t.dataset.sort === 'n' || t.dataset.sort === 'c' || t.dataset.sort === 'pr' ? 'asc' : 'desc') });
    else if (t.hasAttribute('data-pr')) write({ pr: t.dataset.pr });
    else if (t.dataset.unset === 'all') write({ q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '' });
    else if (t.dataset.unset) { var p = {}; p[t.dataset.unset] = ''; write(p); }
    else if (t.dataset.p) write({ p: t.dataset.p }, true);
  });
  app.addEventListener('keydown', function (e) { var tr = e.target.closest && e.target.closest('tr[data-p]'); if (tr && e.key === 'Enter') write({ p: tr.dataset.p }, true); });
  document.getElementById('sheet').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) write({ p: '' }, true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && read().p) write({ p: '' }, true); });
  window.addEventListener('hashchange', render);
  render();
})();
