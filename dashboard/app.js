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
  document.getElementById('theme').onclick = function () {
    var dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('radar-theme', root.dataset.theme); } catch (e) { /* storage blocked */ }
  };

  /* ---------- derived lists ---------- */
  var rows = R.rows;
  /* Re-run model.js (the code that wrote board.json) on the raw snapshot, here in the browser, and check it. */
  var check = (function () {
    var M = window.RadarModel;
    if (!M || !R.snapshot) return { ok: 0, n: rows.length, ran: false };
    var fitted = M.fit(R.snapshot), verdicts = M.classify(R.snapshot), bySlug = {}, ok = 0;
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
  var KEYS = { r: 'r', n: 'n', c: 'c', ch: function (r) { return r.ch.length; }, tvl: 'tvl', d7: function (r) { return r.d7 === null ? -1e9 : r.d7; }, b: 'b', conf: 'conf', age: function (r) { return r.age === null ? -1 : r.age; }, pr: function (r) { return PR_ORDER[r.pr]; } };
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
    var w = 120, a = lx(r.lo, w), b = lx(r.hi, w), m = lx(r.b, w);
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
        '<td class="hide-sm">' + esc(r.c) + '</td>' +
        '<td class="hide-md chainlist">' + esc(r.ch.slice(0, 2).join(', ')) + (r.ch.length > 2 ? ' +' + (r.ch.length - 2) : '') + '</td>' +
        '<td class="n"><div class="tvl"><span>' + usd(r.tvl) + '</span>' + trend(r) + '<span class="d7 ' + (r.d7 === null ? 'muted' : r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + '</span></div></td>' +
        '<td class="n hide-sm">' + (r.age === null ? '<span class="muted">n/a</span>' : (r.age / 365).toFixed(1) + 'y') + '</td>' +
        '<td><div class="range"><span class="hide-sm">' + rangeBar(r) + '</span><b>' + usd(r.b) + '</b><small>' + usd(r.lo) + ' – ' + usd(r.hi) + ' · ' + r.m.toFixed(2) + '× TVL</small></div></td>' +
        '<td class="n hide-sm nw"><span class="meter"><i style="width:' + r.conf + '%"></i></span>' + r.conf + '</td>' +
        '<td>' + pill(r.pr) + '</td></tr>';
    }).join('');
    return kpis() +
      '<p class="howto"><b>How to read it:</b> rank = implied launch value, a size curve fitted on the ' + R.backtest.n + ' traded tokens in this snapshot (one per token family) plus a category premium. Blind test, each token left out and priced by the rest: off by ×' + Math.pow(10, R.backtest.full).toFixed(1) + ' typically vs ×' + Math.pow(10, R.backtest.flat).toFixed(1) + ' for a flat multiple. Each row opens its arithmetic, comparables and a farm plan netted to dollars. Traded tokens are under Already trading, not ranked.' +
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
      th('r', '#', 'n') + th('n', 'Protocol') + th('c', 'Category', 'hide-sm') + th('ch', 'Chains', 'hide-md') + th('tvl', 'TVL · 7d', 'n') + th('age', 'No token for', 'n hide-sm') + th('b', 'Implied value (low – high)') + th('conf', 'Conf.', 'n hide-sm') + th('pr', 'Farm') +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>') + '</tbody></table></div>' +
      '<p class="count">' + list.length + ' of ' + rows.length + ' candidates · rank is the model\'s value order; click a row for its math and farm plan.</p>';
  }

  function scatter(r) {
    var W = 680, H = 280, P = 46, comps = R.comps;
    function dec(t) { var u = ['', 'K', 'M', 'B', 'T'], k = Math.floor(t / 3); return '$' + Math.pow(10, t - 3 * k) + u[k]; }
    var xs = comps.map(function (c) { return Math.log10(c.tvl); }), ys = comps.map(function (c) { return Math.log10(c.mc); });
    var x0 = Math.floor(Math.min.apply(null, xs.concat([Math.log10(r.tvl)]))), x1 = Math.ceil(Math.max.apply(null, xs.concat([Math.log10(r.tvl)])));
    var y0 = Math.floor(Math.min.apply(null, ys.concat([Math.log10(r.lo)]))), y1 = Math.ceil(Math.max.apply(null, ys.concat([Math.log10(r.hi)])));
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
    var cx = X(Math.log10(r.tvl));
    g += '<line x1="' + cx + '" y1="' + Y(Math.log10(r.lo)) + '" x2="' + cx + '" y2="' + Y(Math.log10(r.hi)) + '" stroke="var(--hi)" stroke-width="3" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + Y(Math.log10(r.b)) + '" r="6" fill="var(--bg)" stroke="var(--hi)" stroke-width="3"/>';
    g += '<text x="' + (cx + 9) + '" y="' + (Y(Math.log10(r.b)) + 4) + '" style="fill:var(--ink);font-weight:700">' + esc(r.n) + ' ' + usd(r.b) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL for ' + comps.length + ' tokenised protocols, with this protocol\'s implied range">' + g + '</svg>' +
      '<p class="muted" style="font-size:12px;margin:4px 0 0">Dots: the ' + comps.length + ' protocols whose token trades (filled orange: ' + esc(r.c) + '; grey: ' + esc(r.sec) + '). Dashed: the size curve. Bar: this protocol\'s low–high, ring: base.</p>';
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
    var t = r.t, cd = r.cd, L = Math.log10(r.tvl), logV = t.size + t.cat + t.momentum + t.season + t.chains + t.flags;
    function row(label, how, v) { return '<tr><td>' + label + '<br><span class="muted">' + how + '</span></td><td>' + fx(v) + '</td></tr>'; }
    return '<table class="math"><tbody>' +
      row('Size curve', 'a + b·log₁₀(TVL) = ' + R.fit.a + ' + ' + R.fit.b + ' × ' + L.toFixed(3), t.size) +
      row(esc(r.c) + ' premium', cd.w_cat.toFixed(2) + ' × ' + fx(cd.category_median, 2) + ' (' + cd.category_n + ' peer' + (cd.category_n === 1 ? '' : 's') + ') + ' + (1 - cd.w_cat).toFixed(2) + ' × [' + cd.w_sector.toFixed(2) + ' × ' + fx(cd.sector_median, 2) + ' ' + esc(cd.sector) + ']', t.cat) +
      row('Momentum', r.d7 === null ? 'no 7d change recorded' : '2·log₁₀(1 ' + (r.d7 >= 0 ? '+ ' : '− ') + Math.abs(r.d7 / 100).toFixed(3) + '), capped ±0.15', t.momentum) +
      row('Seasoning', r.age === null ? 'no listing date' : '0.08 × min(' + (r.age / 365).toFixed(2) + 'y, 2) − 0.05', t.season) +
      row('Chain breadth', '0.04 × log₂(' + r.ch.length + ' chains), cap 0.15', t.chains) +
      row('Caution flags', r.fl.length + ' × −0.30', t.flags) +
      '<tr class="tot"><td>log₁₀ V = ' + logV.toFixed(3) + '  →  base</td><td>' + usd(r.b) + '</td></tr>' +
      '<tr><td>Low / high: peers\' residual quartiles ' + fx(r.sp.q25, 2) + ' / ' + fx(r.sp.q75, 2) + '</td><td>' + usd(r.lo) + ' – ' + usd(r.hi) + '</td></tr></tbody></table>';
  }

  function detail(slug) {
    var r = rows.filter(function (x) { return x.s === slug; })[0], sheet = document.getElementById('sheet'), panel = document.getElementById('panel');
    if (!r) { sheet.hidden = true; return; }
    var done = {};
    try { done = JSON.parse(localStorage.getItem('radar-done-' + r.s) || '{}'); } catch (e) { done = {}; }
    var prev = r.tvl / (1 + (r.d7 || 0) / 100);
    panel.innerHTML =
      '<div class="phead"><div><div class="muted">#' + r.r + ' of ' + rows.length + ' · ' + esc(r.c) + ' · ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) + ' more' : '') + (r.w ? ' <span class="tag w">house watchlist</span>' : '') + '</div><h2 id="d-title">' + esc(r.n) + '</h2></div><button class="close" type="button" data-close>Close ✕</button></div>' +
      '<div class="cols"><div><div class="grid2"><div class="card"><h3>Implied launch value</h3><div class="big">' + usd(r.b) + '</div><div class="muted">range ' + usd(r.lo) + ' – ' + usd(r.hi) + ' · ' + r.m.toFixed(2) + '× its ' + usd(r.tvl) + ' TVL</div><div style="margin-top:8px">' + r.dr.map(function (d) { return '<span class="tag">' + esc(d) + '</span>'; }).join(' ') + '</div></div>' +
      '<div class="card"><h3>Confidence ' + r.conf + ' / 100 · ' + pill(r.pr) + '</h3><div class="muted" style="font-size:12px">' + r.cp.map(function (p) { return esc(p[0]) + ' <b style="color:var(--ink)">' + (p[1] >= 0 && p[0] !== 'start' ? '+' : '') + p[1] + '</b>'; }).join(' · ') + '</div><p style="margin:8px 0 0">' + esc(r.pw) + '</p></div></div>' +
      '<div class="card"><h3>Valuation: the arithmetic</h3>' + math(r) + '</div>' +
      '<div class="card"><h3>Against the tokenised market</h3>' + scatter(r) + '</div>' +
      '<div class="card"><h3>Comparables used</h3>' + peers(r) + '</div></div><div>' +
      '<div class="card"><h3>Why it is on the radar</h3><p style="margin:0">' + esc(r.why) + '</p>' + (r.fl.length ? '<ul class="risks">' + r.fl.map(function (f) { return '<li>⚑ ' + esc(f) + '</li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div class="card"><h3>Farm plan</h3><div class="facts"><span>Chain <b>' + esc(r.chain) + '</b></span><span>Capital <b>' + usd(r.cap[0]) + ' → ' + usd(r.cap[1]) + '</b></span><span>Horizon <b>' + r.wk + ' weeks</b></span><span>Est. per $1k <b>$' + r.k1.toFixed(2) + '</b></span><span>Gas <b>' + esc(r.gas) + '</b></span><span>Gas &amp; fees <b>~$' + r.tc + '</b></span><span>Expected drop <b>~$' + r.dp + '</b></span><span>Net <b class="' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + '</b></span><span>Hands-on <b>~' + r.hr + ' h</b></span></div>' +
      '<ol class="steps">' + r.st.map(function (st, i) { return '<li><label><input type="checkbox" data-step="' + i + '"' + (done[i] ? ' checked' : '') + '><span>' + esc(st[0]) + '<span class="ct">' + (st[3] ? '<i class="when">' + esc(st[3]) + '</i>' : '') + '<i>Cost: ' + esc(st[1]) + '</i><i>Time: ' + esc(st[2]) + '</i></span></span></label></li>'; }).join('') + '</ol></div>' +
      '<div class="card"><h3>Risks</h3><ul class="risks">' + r.rk.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="card"><h3>TVL history in the snapshot</h3><p class="muted" style="margin:0 0 8px;font-size:12px">The snapshot records today\'s TVL and its 7-day change only; the earlier point is derived from them.</p>' + bars(prev, r) + '</div></div></div>' +
      '<p class="muted" style="font-size:12px">Estimates, not financial advice. DefiLlama records no token for ' + esc(r.n) + '; that is not proof it has none.</p>';
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
  function bars(prev, r) {
    var mx = Math.max(prev, r.tvl), w = 300, h = 120, bw = 90;
    function bar(x, v, label, fill) { var bh = v / mx * (h - 34); return '<rect x="' + x + '" y="' + (h - 18 - bh) + '" width="' + bw + '" height="' + bh + '" rx="4" fill="' + fill + '"/><text x="' + (x + bw / 2) + '" y="' + (h - 22 - bh) + '" text-anchor="middle" style="fill:var(--ink)">' + usd(v) + '</text><text x="' + (x + bw / 2) + '" y="' + (h - 4) + '" text-anchor="middle">' + label + '</text>'; }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="TVL 7 days ago and now">' + bar(40, prev, '7 days ago', 'var(--peer)') + bar(170, r.tvl, 'snapshot ' + esc(R.as_of), r.d7 === null || r.d7 >= 0 ? 'var(--pos)' : 'var(--neg)') + '</svg><p style="margin:4px 0 0" class="' + (r.d7 === null ? 'muted' : r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + ' over 7 days' + (r.age !== null ? ' · tracked since ' + esc(r.at) : '') + '</p>';
  }

  function live() {
    var c = R.comps.slice().sort(function (a, b) { return b.mc - a.mc || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Already trading: the comparables</h2><p>' + R.counts.live + ' protocols in the snapshot record a token. Records sharing a token are one family (Aave V2, V3 and Horizon are one AAVE), its TVL summed and its market cap counted once: the ' + c.length + ' families with a market cap set the multiples every candidate is valued on. They are kept off the board: their token exists. "vs curve" is each one\'s market cap against the size curve, the residual the category premiums are built from.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Token</th><th class="n hide-sm">Records</th><th class="hide-sm">Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap/TVL</th><th class="n hide-sm">vs curve</th></tr></thead><tbody>' +
      c.map(function (x) { return '<tr><td class="pname">' + esc(x.n) + '</td><td>' + esc(x.sym) + '</td><td class="n hide-sm">' + x.rec + '</td><td class="hide-sm">' + esc(x.c) + '</td><td class="n">' + usd(x.tvl) + '</td><td class="n">' + usd(x.mc) + '</td><td class="n">' + x.x.toFixed(2) + '×</td><td class="n hide-sm ' + (x.e >= 0 ? 'up' : 'down') + '">' + times(x.e) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function excluded() {
    var x = R.excluded.slice().sort(function (a, b) { return b.tvl - a.tvl || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Excluded: no token recorded, but not a launch candidate</h2><p>' + x.length + ' records carry no token yet are a wrapped, staked, bridged or custodial form of an asset that already trades, an exchange product, or a version of a protocol whose token trades (matched by name family in the same snapshot). The house watchlist is always kept on the board, with a flag where one of these rules doubts it.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Record</th><th class="hide-sm">Category</th><th class="n">TVL</th><th>Why it is off the board</th></tr></thead><tbody>' +
      x.map(function (e) { return '<tr><td class="pname">' + esc(e.n) + '</td><td class="hide-sm">' + esc(e.c) + '</td><td class="n">' + usd(e.tvl) + '</td><td>' + esc(e.why) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function method() {
    var f = R.fit, err = Math.pow(10, f.loo_mae);
    return '<article class="prose">' +
      '<h2>What this board claims</h2><p>For each protocol that records no token, what a token would be worth at launch if its record stayed as it is, and how to farm it. It does not predict whether or when a token launches. Snapshot: ' + esc(R.source) + ' (' + R.counts.protocols + ' protocols at $5M+ TVL).</p>' +
      '<h2>1. Who is on the board</h2><p><b>Live</b> (' + R.counts.live + '): a token symbol or CoinGecko id is recorded. <b>Excluded</b> (' + R.counts.excluded + '): no token recorded, but a Liquid Staking, Restaking, Bridge or CEX record, a name with wrapped/staked, an exchange\'s name, a version marker, or a first word shared with a protocol whose token trades. <b>Candidates</b> (' + rows.length + '): the rest, every one of the ' + R.counts.watchlist + ' house watchlist slugs included. Watchlist rows a rule doubts stay on, with a ⚑ flag (chain-native app, a chain, a stablecoin record) that lowers value and confidence.</p>' +
      '<h2>2. The value model</h2><pre>log₁₀ V = a + b·log₁₀(TVL) + δ_category + momentum + seasoning + chains + flags</pre>' +
      '<p>The size curve is an ordinary least-squares fit of log market cap on log TVL over the <b>' + f.n + '</b> token families that trade (one per token, its records\' TVL summed): a = ' + f.a + ', b = ' + f.b + ' (a 10× larger TVL earns about ' + Math.pow(10, f.b).toFixed(1) + '× the value, so big protocols get lower multiples). Residual s.d. ' + f.resid_sd + ' dex; leave-one-out mean absolute error ' + f.loo_mae + ' dex, a typical miss of ×' + err.toFixed(1) + ', which is why every row carries a range.</p>' +
      '<h2>2a. The blind test</h2><p>Each of the ' + R.backtest.n + ' families is left out in turn, the model is refitted on the rest, and the left-out market cap is predicted. Mean absolute error, in dex:</p><table class="math" style="max-width:520px"><tbody>' +
      '<tr><td>Flat multiple (median market cap / TVL)</td><td>' + R.backtest.flat.toFixed(3) + ' · ×' + Math.pow(10, R.backtest.flat).toFixed(2) + '</td></tr>' +
      '<tr><td>Size curve alone</td><td>' + R.backtest.size.toFixed(3) + ' · ×' + Math.pow(10, R.backtest.size).toFixed(2) + '</td></tr>' +
      '<tr class="tot"><td>Size curve + shrunk category premium (used)</td><td>' + R.backtest.full.toFixed(3) + ' · ×' + Math.pow(10, R.backtest.full).toFixed(2) + '</td></tr></tbody></table>' +
      '<p>The size curve is what earns its place: it beats a flat multiple by ' + Math.round((1 - Math.pow(10, R.backtest.size - R.backtest.flat)) * 100) + '% of the typical miss. The category premium adds little out of sample, which is why it is shrunk hard toward its sector; ' + Math.round(R.backtest.within_2x * 100) + '% of traded tokens land within 2× of their blind price. The momentum, seasoning and chain terms are stated priors, not fitted: the snapshot gives traded tokens no "time with no token" to test them on.</p>' +
      '<p><b>δ_category</b> is the median residual of the category\'s tokenised peers, shrunk toward its sector\'s with weight n / (n + ' + R.k + '); the sector\'s is shrunk toward zero the same way. <b>Momentum</b> = 2·log₁₀(1 + 7d change), within ±0.15. <b>Seasoning</b> = 0.08·min(years tracked with no token, 2) − 0.05: a new protocol\'s TVL is unproven, a long-running one\'s is sticky. <b>Chains</b> = 0.04·log₂(chain count), at most 0.15. <b>Flags</b> = −0.30 each. Low and high apply the peers\' residual quartiles.</p>' +
      '<h2>3. Confidence</h2><p>Starts at 50: + 4 per category peer (max 20), − 25 per dex of peer spread beyond 0.9, + 6 per dex of TVL above $50M, − 8 for no 7d change or a swing past 25%, − 8 for no listing date, − 6 if under 4 months old, − 18 per flag; held within 5–95.</p>' +
      '<h2>4. Farm plans and priority</h2><p>Each plan is written from the protocol\'s sector, category, chains, TVL, age and trend: the cheapest chain it runs on, sector-specific actions, a test ticket and a full position scaled by confidence, a horizon by age, and the estimate <code>per $1k = ' + Math.round(R.user_share * 100) + '% × V × 1000 / TVL</code> (the share of a launch commonly given to users, pro rata). Each plan is netted: <code>net = expected drop on the full position − gas − bridge − running fees</code> (perp fees, swap fees or borrow interest over the horizon). <b>Farm now</b>: no flag, confidence ≥ 55, 7d TVL above −12% and a net of at least $50 and twice its cost. <b>Skip</b>: a flag, confidence &lt; 40, or a net loss. Otherwise <b>watch</b> (thin).</p>' +
      '<h2>Caveats</h2><p class="note">Estimates, not financial advice. The snapshot has no fees, revenue, raises, audits or TVL history, so the model uses none; market caps stand in for FDV. A record with no token may still have one. Points programmes and their rules change; check each protocol\'s own terms before depositing.</p></article>';
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
