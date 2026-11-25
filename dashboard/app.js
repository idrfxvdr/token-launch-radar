(function () {
  'use strict';
  var R = window.RADAR, app = document.getElementById('app');
  if (!R) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts to write it beside dashboard/.</p>'; return; }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) {
    var a = Math.abs(n);
    return a >= 1e9 ? '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
  }
  function pct(x) { return x === null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function times(x) { return '×' + Math.pow(10, x).toFixed(2); }
  function mult(x) { return (x >= 0.1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(3) : x.toFixed(4)) + '×'; }
  function vsCurve(c) { return times(Math.log10(c.mc) - (R.fit.a + R.fit.b * Math.log10(c.tvl))); }
  function bePct(be) { return be >= 1 ? 'cannot break even (' + Math.round(be * 100) + '%)' : Math.round(be * 100) + '%'; }
  // The launch-odds linear predictor, built from the fitted features (no hard-coded term set).
  function oddsLin(o, a, lx, g) { var z = o.c0; if (o.feats.indexOf('a') >= 0) z += o.c1 * a; if (o.feats.indexOf('lx') >= 0) z += o.c2 * lx; if (o.feats.indexOf('g') >= 0) z += o.c3 * g; return z; }
  function oddsFormula(o) { var s = 'F(a)=1/(1+e^−(' + o.c0; if (o.feats.indexOf('a') >= 0) s += '+' + o.c1 + 'a'; if (o.feats.indexOf('lx') >= 0) s += '+' + o.c2 + '·log₁₀TVL'; if (o.feats.indexOf('g') >= 0) s += '+' + o.c3 + '·log₁₀(1+7d)'; return s + '))'; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  var PR = { 'farm now': 'now', watch: 'watch', skip: 'skip' }, PR_ORDER = { 'farm now': 0, watch: 1, skip: 2 };
  function pill(p) { return '<span class="pill ' + PR[p] + '">' + esc(p) + '</span>'; }

  var DEF = { view: 'board', q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '', sort: 'r', dir: 'asc', p: '', cmp: '', asm: '', g: '', o: '', sh: '' };
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

  var root = document.documentElement;
  try { var saved = localStorage.getItem('radar-theme'); if (saved) root.dataset.theme = saved; } catch (e) { /* storage blocked */ }
  if (root.dataset.theme !== 'light' && root.dataset.theme !== 'dark') root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.getElementById('theme').onclick = function () {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('radar-theme', root.dataset.theme); } catch (e) { /* storage blocked */ }
  };

  var rows = R.rows;
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
  var cats = uniq(rows.map(function (r) { return r.c; }));
  var chains = uniq([].concat.apply([], rows.map(function (r) { return r.ch; })));
  var BANDS = { '<50M': [0, 5e7], '50-250M': [5e7, 2.5e8], '250M-1B': [2.5e8, 1e9], '>1B': [1e9, Infinity] };
  var lo = Math.min.apply(null, rows.map(function (r) { return r.lo; })), hi = Math.max.apply(null, rows.map(function (r) { return r.hi; }));

  function assumptions(s) {
    return { on: s.asm === '1', g: s.g === '' ? 1 : clamp(+s.g, 0, 2), o: s.o === '' ? 1 : clamp(+s.o, 0.5, 2.5), cap: s.sh === '' ? 0 : clamp(+s.sh, 500, 50000) };
  }
  function adjusted(r, a) {
    var tvl = r.tvl * (a.g ? clamp(1 + a.g * (r.d7 === null ? 0 : r.d7) / 100, 0.25, 4) : 1);
    var ifl = Math.pow(10, R.fit.a + R.fit.b * Math.log10(tvl) + (r.t.premium || 0)), od = clamp(r.od * a.o, 0, 0.995), cap = a.cap || r.cap[1];
    return { tvl: tvl, ifl: Math.round(ifl), od: od, b: Math.max(1, Math.round(ifl * od)),
      net: Math.round(R.user_share * ifl * cap / tvl * od - r.tc - R.tbill * cap * r.wk / 52) };
  }
  function value(r, a) { return a.on ? adjusted(r, a).b : r.b; }
  function netOf(r, a) { return a.on ? adjusted(r, a).net : r.net; }

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
  function sortKey(r, k) { return k === 'ch' ? r.ch.length : k === 'd7' ? (r.d7 === null ? -1e9 : r.d7) : k === 'pr' ? PR_ORDER[r.pr] : r[k]; }
  function sorted(list, s, a) {
    var d = s.dir === 'desc' ? -1 : 1;
    var get = s.sort === 'b' ? function (r) { return value(r, a); } : s.sort === 'net' ? function (r) { return netOf(r, a); } : function (r) { return sortKey(r, s.sort); };
    return list.slice().sort(function (x, y) { var p = get(x), q = get(y); return (p < q ? -1 : p > q ? 1 : 0) * d || x.r - y.r; });
  }

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

  function kpis() {
    var tvl = 0, val = 0, byCat = {};
    rows.forEach(function (r) { tvl += r.tvl; val += r.b; byCat[r.c] = (byCat[r.c] || 0) + r.tvl; });
    var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0], covered = rows.filter(function (r) { return r.w; }).length;
    var best = rows[0], near = rows[0], now = 0;
    rows.forEach(function (r) { if (r.net > best.net) best = r; if (r.be < near.be) near = r; if (r.pr === 'farm now') now++; });
    function k(b, span, small) { return '<div class="kpi"><b>' + b + '</b><span>' + span + '</span><small>' + small + '</small></div>'; }
    return '<section class="kpis" aria-label="Headline numbers">' +
      k(covered + ' / ' + R.counts.watchlist, 'watchlist covered', 'every house slug ranked') +
      k(String(rows.length), 'pre-token candidates', (rows.length - covered) + ' beyond the house list') +
      k(usd(tvl), 'TVL with no token', R.counts.live + ' records with a token kept off') +
      k(usd(val), 'implied launch value', 'sum of base cases') +
      k((best.net >= 0 ? '+' : '−') + '$' + Math.abs(best.net), 'best net on a plan', 'nearest break-even ' + bePct(near.be)) +
      k(esc(top), 'top category by TVL', 'the board spans ' + cats.length + ' categories') + '</section>' + split() +
      '<p class="covline"><b>' + now + ' farm now</b> of ' + rows.length + ' plans — no row clears every test at once (no caution flag, confidence ≥ 55, 7d TVL above −12%, net ≥ $25 and ≥ its costs), so the board is ranked by implied value, not by green rows: the best net is ' + (best.net >= 0 ? '+' : '−') + '$' + Math.abs(best.net) + ' on ' + esc(best.n) + ', and the nearest to break-even needs ' + bePct(near.be) + ' launch odds.</p>';
  }
  function split() {
    var c = R.counts, parts = [['board', rows.length, 'pre-token candidates, ranked below', 'var(--accent)'], ['live', c.live, 'records whose token already trades: comparables', 'var(--pos)'], ['excluded', c.excluded, 'no token, but a product of a traded one', 'var(--peer)']];
    return '<section class="split" aria-label="Where every protocol in the snapshot went"><div class="bar">' + parts.map(function (x) { return '<a href="#view=' + x[0] + '" style="flex:' + x[1] + ';background:' + x[3] + '" title="' + x[1] + ' ' + x[2] + '"></a>'; }).join('') + '</div><div class="legend"><b>' + c.protocols + ' protocols in the snapshot:</b> ' +
      parts.map(function (x) { return '<span><i style="background:' + x[3] + '"></i><b>' + x[1] + '</b> ' + x[2] + '</span>'; }).join('') + '</div></section>';
  }
  function strip() {
    var f = R.fit, o = R.odds, t = R.tests.filter(function (x) { return x.applied; })[0] || R.tests[0], w = rows[0], a = assumptions(read()), wv = value(w, a);
    var terms = [['size', '10^(' + f.a + ' + ' + f.b + '·log₁₀ TVL)', t.name],
      ['carry', f.cap ? '7d capped ×' + f.cap : f.ridge ? '7d shrunk ×' + f.ridge : '7d not applied', f.cap || f.ridge ? 'applied' : 'rejected'],
      ['time', oddsFormula(o), 'fit ' + o.n + ' rows'], ['odds', o.pick, 'log loss ' + o.logloss]];
    return '<section class="strip" aria-label="The value model"><div class="sform"><span class="stag">Value</span><code>implied = if launched × launch odds</code>' +
      terms.map(function (x) { return '<span class="tchip"><b>' + x[0] + '</b> ' + esc(x[1]) + '<i class="' + (x[2] === 'rejected' ? 'rej' : 'ok') + '">' + esc(x[2]) + '</i></span>'; }).join('') +
      '</div><div class="sworked"><b>#' + w.r + ' ' + esc(w.n) + '</b> ' + usd(w.tvl) + ' TVL → <b>' + usd(w.ifl) + '</b> if launched × ' + Math.round(w.od * 100) + '% = <b>' + usd(wv) + '</b> implied <span class="muted">(range ' + usd(w.lo) + '–' + usd(w.hi) + '; LOO error ' + f.loo_mae + ' dex on ' + f.n + ' traded tokens)</span>' +
      (a.on ? ' <span class="yours">your assumptions: growth ×' + a.g + ', odds ×' + a.o + (a.cap ? ', capital ' + usd(a.cap) : '') + '</span>' : '') + '</div></section>';
  }
  function opts(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function toolbar(s) {
    var seg = ['', 'farm now', 'watch', 'skip'].map(function (p) { return '<button type="button" data-pr="' + p + '" aria-pressed="' + (s.pr === p) + '">' + (p || 'All') + '</button>'; }).join('');
    return '<form class="filters" role="search" onsubmit="return false">' +
      '<input type="search" id="q" placeholder="Search protocol, category or chain (/)" aria-label="Search" value="' + esc(s.q) + '">' +
      '<select id="cat" aria-label="Category">' + opts(cats, s.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + opts(chains, s.chain, 'All chains') + '</select>' +
      '<select id="tvl" aria-label="TVL band">' + opts(Object.keys(BANDS), s.tvl, 'Any TVL') + '</select>' +
      '<select id="conf" aria-label="Minimum confidence"><option value="">Any confidence</option>' + ['40', '55', '70'].map(function (c) { return '<option value="' + c + '"' + (s.conf === c ? ' selected' : '') + '>Confidence ≥ ' + c + '</option>'; }).join('') + '</select>' +
      '<div class="seg" role="group" aria-label="Farm priority">' + seg + '</div>' +
      '<label class="muted"><input type="checkbox" id="w"' + (s.w ? ' checked' : '') + '> Watchlist only</label>' +
      '<button type="button" class="btn" id="csv">CSV ↓</button><button type="button" class="btn" id="asm" aria-expanded="' + (s.asm ? 'true' : 'false') + '">Assumptions' + (s.asm ? ' ▴' : ' ▾') + '</button></form>' + assumptionsPanel(s);
  }
  function assumptionsPanel(s) {
    if (!s.asm) return '';
    var a = assumptions(s);
    function sl(id, label, val, min, max, step, note) {
      return '<label class="as"><span>' + label + ' <b>' + val + '</b><small>' + note + '</small></span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></label>';
    }
    return '<section class="asm" aria-label="Your assumptions"><div class="asmhead"><b>Your assumptions, not the model\'s</b><span class="muted">These re-rank the board live; the model\'s own numbers are the ones in the strip above and in the detail view.</span><button type="button" class="btn" data-reset-asm>Reset</button></div><div class="asgrid">' +
      sl('g', '7-day growth strength', a.g, 0, 2, 0.1, '× the 7d TVL move carried into the size curve') +
      sl('o', 'Launch-odds multiplier', a.o, 0.5, 2.5, 0.1, '× the fitted 12-month odds') +
      sl('sh', 'Capital per position', a.cap ? usd(a.cap) : 'plan', 500, 50000, 500, 'the position the net is computed on') + '</div>' +
      '<p class="asmnote">Sorted by <b>your</b> implied value while this is open; close it to go back to the model\'s ranking.</p></section>';
  }
  function chips(s, n) {
    var out = [];
    function chip(key, label) { out.push('<span class="chip">' + esc(label) + '<button type="button" data-unset="' + key + '" aria-label="Remove filter ' + esc(label) + '">×</button></span>'); }
    if (s.q) chip('q', 'search: ' + s.q);
    if (s.cat) chip('cat', 'category: ' + s.cat);
    if (s.chain) chip('chain', 'chain: ' + s.chain);
    if (s.tvl) chip('tvl', 'TVL ' + s.tvl);
    if (s.conf) chip('conf', 'confidence ≥ ' + s.conf);
    if (s.pr) chip('pr', 'priority: ' + s.pr);
    if (s.w) chip('w', 'watchlist only');
    return '<div class="chips" aria-live="polite"><span class="muted"><b>' + n + ' of ' + rows.length + '</b> shown' + (s.w && n === R.counts.watchlist ? ' (all ' + R.counts.watchlist + ' watchlist protocols)' : '') + ' · ' + (out.length ? 'filters:' : 'no filters') + '</span>' + out.join('') + (out.length ? '<button type="button" class="clear" data-unset="all">Clear all</button>' : '') + '</div>';
  }
  function th(s, key, label, cls) {
    var sort = s.sort === key ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + sort + '"><button type="button" data-sort="' + key + '">' + label + '</button></th>';
  }
  function rowHtml(r, a, picked) {
    var v = value(r, a), net = netOf(r, a);
    return '<tr tabindex="-1" data-p="' + esc(r.s) + '"><td class="n">' + r.r + '</td>' +
      '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="tag w" title="On the house watchlist">WL</span>' : '') + (r.fl.length ? '<span class="tag f" title="' + esc(r.fl.join('; ')) + '">⚑</span>' : '') + '</td>' +
      '<td class="hide-sm cat" title="' + esc(r.c) + '">' + esc(r.c) + '</td>' +
      '<td class="hide-md chainlist">' + esc(r.ch[0] || '') + (r.ch.length > 1 ? ' +' + (r.ch.length - 1) : '') + '</td>' +
      '<td class="n"><div class="tvl"><span>' + usd(r.tvl) + '</span>' + trend(r) + '<span class="d7 ' + (r.d7 === null ? 'muted' : r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + '</span></div></td>' +
      '<td class="n hide-sm nw"><b>' + Math.round(r.od * 100) + '%</b> <span class="muted">' + (r.age === null ? 'age n/a' : (r.age / 365).toFixed(1) + 'y') + '</span></td>' +
      '<td><div class="range"><span class="hide-sm">' + rangeBar(r) + '</span><b>' + usd(v) + (a.on ? '<i class="yours">your</i>' : '') + '</b><small>' + usd(r.lo) + ' – ' + usd(r.hi) + ' · if launched ' + usd(r.ifl) + '</small></div></td>' +
      '<td class="n hide-sm nw"><span class="meter"><i style="width:' + r.conf + '%"></i></span>' + r.conf + '</td>' +
      '<td class="nw">' + pill(r.pr) + '<small class="net ' + (net > 0 ? 'up' : 'down') + '">' + (net >= 0 ? '+' : '−') + '$' + Math.abs(net) + ' net</small></td>' +
      '<td class="cmp"><button type="button" data-cmp="' + esc(r.s) + '" aria-pressed="' + picked + '" title="Compare this row">' + (picked ? '✓' : '+') + '</button></td></tr>';
  }
  function board(s) {
    var a = assumptions(s), list = sorted(filtered(s), s, a), picked = (s.cmp || '').split(',').filter(Boolean);
    var body = list.map(function (r) { return rowHtml(r, a, picked.indexOf(r.s) >= 0); }).join('');
    return kpis() + strip() + '<div id="checks" class="checks run" aria-live="polite"></div>' + toolbar(s) + chips(s, list.length) +
      '<div class="tablewrap"><table><caption class="sr" hidden>Pre-token protocols ranked by implied launch value</caption><thead><tr>' +
      th(s, 'r', '#', 'n') + th(s, 'n', 'Protocol') + th(s, 'c', 'Category', 'hide-sm') + th(s, 'ch', 'Chains', 'hide-md') +
      th(s, 'tvl', 'TVL · 7d', 'n') + th(s, 'od', '12-mo odds · age', 'n hide-sm') + th(s, 'b', 'Implied value = if launched × odds') +
      th(s, 'conf', 'Conf.', 'n hide-sm') + th(s, 'pr', 'Farm · net') + '<th scope="col" class="cmp">±</th>' +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>') + '</tbody></table></div>' + compareTray(picked);
  }

  function compareTray(picked) {
    var list = picked.map(function (s) { return rows.filter(function (r) { return r.s === s; })[0]; }).filter(Boolean);
    if (!list.length) return '';
    function cell(label, fn) { return '<tr><th>' + label + '</th>' + list.map(function (r) { return '<td>' + fn(r) + '</td>'; }).join('') + (list.length < 3 ? '<td class="muted"></td>'.repeat(3 - list.length) : '') + '</tr>'; }
    return '<section class="cmpbar" aria-label="Compare"><div class="cmphead"><b>Compare ' + list.length + ' of 3</b><span class="muted">Pick up to three rows with ±; the model\'s numbers, side by side.</span><button type="button" class="btn" data-cmp-clear>Clear</button></div><div class="cmpgrid"><table>' +
      cell('Protocol', function (r) { return '<b>' + esc(r.n) + '</b>'; }) +
      cell('Category · chain', function (r) { return esc(r.c) + '<br><span class="muted">' + esc(r.chain) + '</span>'; }) +
      cell('TVL · 7d', function (r) { return usd(r.tvl) + ' <span class="' + (r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + '</span>'; }) +
      cell('If launched', function (r) { return usd(r.ifl); }) +
      cell('Odds · implied', function (r) { return Math.round(r.od * 100) + '% · <b>' + usd(r.b) + '</b>'; }) +
      cell('Plan: cost · net', function (r) { return '$' + r.tc + ' · <span class="' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + '</span>'; }) +
      cell('Hands-on · break-even', function (r) { return r.hr + ' h · ' + bePct(r.be); }) +
      cell('Main risk', function (r) { return '<span class="muted">' + esc(r.mr) + '</span>'; }) + '</table></div></section>';
  }

  // One peer label from the data, used by both the scatter legend and the comparables header.
  function peerInfo(r) {
    var sameCat = R.comps.filter(function (c) { return c.c === r.c; }), useCat = sameCat.length >= 3;
    var basis = useCat ? sameCat : R.comps.filter(function (c) { return c.sec === r.sec; });
    return { basis: basis, kind: useCat ? 'category' : 'sector', label: (useCat ? r.c : r.sec) || 'Uncategorised', slugs: basis.map(function (c) { return c.s; }) };
  }
  function scatter(r) {
    var W = 680, H = 240, P = 46, comps = R.comps, info = peerInfo(r);
    function dec(t) { var u = ['', 'K', 'M', 'B', 'T'], k = Math.floor(t / 3); return '$' + Math.pow(10, t - 3 * k) + u[k]; }
    var xs = comps.map(function (c) { return Math.log10(c.tvl); }), ys = comps.map(function (c) { return Math.log10(c.mc); });
    var x0 = Math.floor(Math.min.apply(null, xs.concat([Math.log10(r.tvl)]))), x1 = Math.ceil(Math.max.apply(null, xs.concat([Math.log10(r.tvl)])));
    var y0 = Math.floor(Math.min.apply(null, ys.concat([Math.log10(r.lo * r.ifl / r.b)]))), y1 = Math.ceil(Math.max.apply(null, ys.concat([Math.log10(r.hi * r.ifl / r.b)])));
    function X(v) { return P + (v - x0) / (x1 - x0) * (W - P - 10); }
    function Y(v) { return H - 22 - (v - y0) / (y1 - y0) * (H - 32); }
    var g = '', t;
    for (t = x0; t <= x1; t++) g += '<line x1="' + X(t) + '" y1="10" x2="' + X(t) + '" y2="' + (H - 22) + '" stroke="var(--line)"/><text x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="' + (t === x0 ? 'start' : t === x1 ? 'end' : 'middle') + '">' + dec(t) + '</text>';
    for (t = y0; t <= y1; t++) g += '<line x1="' + P + '" y1="' + Y(t) + '" x2="' + (W - 10) + '" y2="' + Y(t) + '" stroke="var(--line)"/><text x="' + (P - 4) + '" y="' + (Y(t) + 3) + '" text-anchor="end">' + dec(t) + '</text>';
    g += '<line x1="' + X(x0) + '" y1="' + Y(R.fit.a + R.fit.b * x0) + '" x2="' + X(x1) + '" y2="' + Y(R.fit.a + R.fit.b * x1) + '" stroke="var(--muted)" stroke-dasharray="5 4"/>';
    comps.forEach(function (c) {
      var inBasis = info.slugs.indexOf(c.s) >= 0;
      g += '<circle cx="' + X(Math.log10(c.tvl)).toFixed(1) + '" cy="' + Y(Math.log10(c.mc)).toFixed(1) + '" r="' + (inBasis ? 4.5 : 3) + '" fill="' + (inBasis ? 'var(--accent)' : 'none') + '" stroke="var(--peer)" opacity="' + (inBasis ? 0.95 : 0.6) + '"><title>' + esc(c.n + ' (' + c.sym + '): ' + usd(c.mc) + ' cap on ' + usd(c.tvl) + ' TVL') + '</title></circle>';
    });
    var k = r.ifl / r.b, cx = X(Math.log10(r.tvl));
    g += '<line x1="' + cx + '" y1="' + Y(Math.log10(r.lo * k)) + '" x2="' + cx + '" y2="' + Y(Math.log10(r.hi * k)) + '" stroke="var(--hi)" stroke-width="3" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + Y(Math.log10(r.ifl)) + '" r="6" fill="var(--bg)" stroke="var(--hi)" stroke-width="3"/>';
    var lbl = esc(r.n) + ' if launched ' + usd(r.ifl), flip = cx > W * 0.55;
    g += '<text x="' + (flip ? cx - 9 : cx + 9) + '" y="' + (Y(Math.log10(r.ifl)) + 4) + '" text-anchor="' + (flip ? 'end' : 'start') + '" style="fill:var(--ink);font-weight:700">' + lbl + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL for ' + comps.length + ' tokenised protocols">' + g + '</svg>' +
      '<p class="muted" style="font-size:12px;margin:4px 0 0">Dots: the ' + comps.length + ' families whose token trades (filled: ' + esc(info.label) + ', ' + info.basis.length + ' peers; grey: the rest). Dashed: the size curve. Bar and ring: this protocol if launched, low–high to base.</p>';
  }
  function peers(r) {
    var info = peerInfo(r), same = R.comps.filter(function (c) { return c.c === r.c; }), basis = info.basis;
    var near = basis.slice().sort(function (a, b) { return Math.abs(Math.log10(a.tvl / r.tvl)) - Math.abs(Math.log10(b.tvl / r.tvl)) || (a.s < b.s ? -1 : 1); }).slice(0, 4);
    if (!near.length) return '<p class="muted">No tokenised peer in this ' + info.kind + ': the size curve is the market-wide one.</p>';
    var mults = basis.map(function (c) { return c.x; }).sort(function (a, b) { return a - b; }), med = mults[Math.floor(mults.length / 2)];
    return '<p class="muted" style="margin:0 0 6px">' + (info.kind === 'category' ? 'Same category' : 'Same sector') + ' (' + esc(info.label) + '): ' + basis.length + ' tokenised peers, median market cap / TVL ' + mult(med) + '; this row\'s implied ' + mult(r.m) + '.</p>' +
      '<table class="peers"><thead><tr><th>Peer (nearest TVL)</th><th class="n">TVL</th><th class="n">Mcap</th><th class="n">Mcap/TVL</th><th class="n">vs curve</th></tr></thead><tbody>' +
      near.map(function (c) { return '<tr><td>' + esc(c.n) + ' <span class="muted">' + esc(c.sym) + '</span></td><td class="n">' + usd(c.tvl) + '</td><td class="n">' + usd(c.mc) + '</td><td class="n">' + mult(c.x) + '</td><td class="n">' + vsCurve(c) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function waterfall(r) {
    var t = r.t, carried = r.tvl * t.carry;
    var steps = [['TVL today', usd(r.tvl), r.tvl],
      [t.carry === 1 ? '7d carry not applied' : '× 7d carry ' + t.carry.toFixed(3), usd(carried), carried],
      ['size curve 10^(' + R.fit.a + ' + ' + R.fit.b + '·log₁₀ ' + usd(carried) + ')' + (t.premium ? ' × category ' + Math.pow(10, t.premium).toFixed(2) : ''), usd(r.ifl) + ' if launched', r.ifl],
      ['× launch odds ' + Math.round(r.od * 100) + '% (age ' + (r.age === null ? 'assumed 2y' : (r.age / 365).toFixed(1) + 'y') + ')', '× ' + r.od.toFixed(3), r.ifl * r.od],
      ['= implied value', usd(r.b), r.b]];
    var lo = Math.log10(Math.max(1, Math.min(r.tvl, r.b))), span = Math.log10(Math.max(r.tvl, r.ifl, r.b)) - lo || 1;
    return '<table class="wf"><tbody>' + steps.map(function (s, i) {
      return '<tr class="' + (i === 4 ? 'tot' : '') + '"><td>' + s[0] + '</td><td class="n">' + s[1] + '</td><td><span class="wbar"><i style="width:' + clamp((Math.log10(Math.max(1, s[2])) - lo) / span * 100, 3, 100).toFixed(1) + '%"></i></span></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function oddsChart(r) {
    var W = 320, H = 130, F = function (a) { return 1 / (1 + Math.exp(-oddsLin(R.odds, a, 7.5, 0))); }, X = function (a) { return 28 + a / 6 * (W - 36); }, Y = function (v) { return H - 20 - v * (H - 32); }, g = '', a;
    R.odds.bins.forEach(function (b) { g += '<rect x="' + X(b.from) + '" y="' + Y(b.share) + '" width="' + (X(b.to) - X(b.from) - 3) + '" height="' + (Y(0) - Y(b.share)) + '" fill="var(--sunk)" stroke="var(--line)"/><text x="' + (X(b.from) + 4) + '" y="' + (Y(b.share) - 3) + '">' + Math.round(b.share * 100) + '%</text>'; });
    var d = ''; for (a = 0; a <= 6.01; a += 0.25) d += (a ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(F(a)).toFixed(1);
    g += '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
    for (a = 0; a <= 6; a += 2) g += '<text x="' + X(a) + '" y="' + (H - 6) + '" text-anchor="middle">' + a + 'y</text>';
    var ra = Math.min(6, r.age === null ? 2 : r.age / 365), rb = Math.min(6, ra + 1);
    g += '<line x1="' + X(ra) + '" y1="' + Y(F(ra)) + '" x2="' + X(rb) + '" y2="' + Y(F(rb)) + '" stroke="var(--hi)" stroke-width="5" stroke-linecap="round" opacity=".55"/><circle cx="' + X(ra) + '" cy="' + Y(F(ra)) + '" r="5" fill="var(--hi)"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Share with a token by age, fitted curve">' + g + '</svg><p class="muted" style="font-size:12px;margin:4px 0 0">Bars: share of protocols with a token, by age. Line: the fit at the market\'s median TVL and 7d growth. Dot: ' + esc(r.n) + ' at ' + (r.age === null ? '2y (assumed)' : (r.age / 365).toFixed(1) + 'y') + '; the next year along the curve gives its ' + Math.round(r.od * 100) + '% odds.</p>';
  }

  function detail(slug) {
    var r = rows.filter(function (x) { return x.s === slug; })[0], sheet = document.getElementById('sheet'), panel = document.getElementById('panel');
    if (!r) { sheet.hidden = true; return; }
    var done = {};
    try { done = JSON.parse(localStorage.getItem('radar-done-' + r.s) || '{}'); } catch (e) { done = {}; }
    panel.innerHTML =
      '<div class="phead"><div><div class="muted">#' + r.r + ' of ' + rows.length + ' · ' + esc(r.c) + ' · ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) + ' more' : '') + (r.w ? ' <span class="tag w">house watchlist</span>' : '') + '</div><h2 id="d-title">' + esc(r.n) + '</h2></div><button class="close" type="button" data-close>Close ✕</button></div>' +
      '<div class="cols"><div>' +
      '<div class="card"><h3>Implied value</h3><div class="big">' + usd(r.b) + '</div><div class="chain">' + usd(r.tvl) + ' TVL → <b>' + usd(r.ifl) + '</b> if launched → × <b>' + Math.round(r.od * 100) + '%</b> odds → <b>' + usd(r.b) + '</b></div><div class="muted">range ' + usd(r.lo) + ' – ' + usd(r.hi) + '</div><div style="margin-top:8px">' + r.dr.map(function (d) { return '<span class="tag">' + esc(d) + '</span>'; }).join(' ') + '</div></div>' +
      '<div class="card"><h3>Value waterfall: TVL to implied value</h3>' + waterfall(r) + '</div>' +
      '<div class="card"><h3>Against the tokenised market</h3>' + scatter(r) + '</div>' +
      '<div class="card"><h3>Comparables used</h3>' + peers(r) + '</div>' +
      '<div class="card"><h3>Confidence ' + r.conf + ' / 100 · ' + pill(r.pr) + '</h3><div class="muted" style="font-size:12px">' + r.cp.map(function (p) { return esc(p[0]) + ' <b style="color:var(--ink)">' + (p[1] >= 0 && p[0] !== 'start' ? '+' : '') + p[1] + '</b>'; }).join(' · ') + '</div><p style="margin:8px 0 0">' + esc(r.pw) + '</p></div></div><div>' +
      '<div class="card"><h3>Why it is on the radar</h3><p style="margin:0">' + esc(r.why) + '</p>' + (r.fl.length ? '<ul class="risks">' + r.fl.map(function (f) { return '<li>⚑ ' + esc(f) + '</li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div class="card"><h3>Farm plan</h3><div class="facts">' +
      '<span>Chain <b>' + esc(r.chain) + '</b></span><span>Capital at risk <b>' + usd(r.cap[0]) + ' → ' + usd(r.cap[1]) + '</b></span><span>Hands-on <b>~' + r.hr + ' h</b></span><span>Gas &amp; fees <b>~$' + r.tc + '</b></span>' +
      '<span>Expected <b>~$' + r.dp + '</b></span><span>Net <b class="' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + '</b></span><span>Break-even odds <b>' + bePct(r.be) + '</b></span><span>Slice if launched <b>$' + r.sl + '</b></span><span>× odds <b>' + Math.round(r.oh * 100) + '%</b></span><span>T-bill given up <b>$' + r.tb + '</b></span><span>Horizon <b>' + r.wk + ' weeks</b></span><span>Gas <b>' + esc(r.gas) + '</b></span></div>' +
      '<div class="facts2"><div><b>Main risk</b><p>' + esc(r.mr) + '</p></div><div><b>Stop rule</b><p>' + esc(r.sr) + '</p></div></div>' +
      '<ol class="steps">' + r.st.map(function (st, i) { return '<li><label><input type="checkbox" data-step="' + i + '"' + (done[i] ? ' checked' : '') + '><span>' + esc(st[0]) + ' <span class="ct">' + (st[3] ? '<i class="when">' + esc(st[3]) + ' · </i>' : '') + '<i>Cost ' + esc(st[1]) + '</i> · <i>Time ' + esc(st[2]) + '</i></span></span></label></li>'; }).join('') + '</ol></div>' +
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
  window.RadarDetail = detail; // test hook: render one detail sheet by slug without re-rendering the board
  function live() {
    var c = R.comps.slice().sort(function (a, b) { return b.mc - a.mc || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Already trading: the comparables</h2><p><b>' + R.counts.live + '</b> records carry a token and are kept off the board. Records sharing a symbol form one family (TVL summed, market cap counted once): these <b>' + c.length + '</b> families price every candidate. "vs curve" is market cap against the size curve.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Token</th><th class="hide-sm">Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Mcap/TVL</th><th class="n hide-sm">vs curve</th><th>Why it is not ranked</th></tr></thead><tbody>' +
      c.map(function (x) { return '<tr><td class="pname">' + esc(x.n) + '</td><td>' + esc(x.sym) + '</td><td class="hide-sm">' + esc(x.c) + '</td><td class="n">' + usd(x.tvl) + '</td><td class="n">' + usd(x.mc) + '</td><td class="n">' + mult(x.x) + '</td><td class="n hide-sm ' + (x.e >= 0 ? 'up' : 'down') + '">' + vsCurve(x) + '</td><td class="muted">Token ' + esc(x.sym) + ' already trades — used as a comparable, not a launch candidate.</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function excluded() {
    var x = R.excluded.slice().sort(function (a, b) { return b.tvl - a.tvl || (a.s < b.s ? -1 : 1); });
    return '<div class="prose"><h2>Excluded: no token recorded, but not a launch candidate</h2><p>' + x.length + ' records carry no token but are a wrapped, staked, bridged or exchange product, or a version of a protocol whose token trades. Watchlist rows stay on the board, flagged.</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Record</th><th class="hide-sm">Category</th><th class="n">TVL</th><th>Why it is off the board</th></tr></thead><tbody>' +
      x.map(function (e) { return '<tr><td class="pname">' + esc(e.n) + '</td><td class="hide-sm">' + esc(e.c) + '</td><td class="n">' + usd(e.tvl) + '</td><td>' + esc(e.why) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function method() {
    var f = R.fit, o = R.odds, cal = R.cal;
    return '<article class="prose">' +
      '<h2>What the board claims</h2><p>For each protocol with no token: what a token would be worth if launched, the odds it launches within a year, and whether farming pays. Snapshot: ' + esc(R.source) + ', ' + R.counts.protocols + ' protocols.</p>' +
      '<h2>1. Who is ranked</h2><p><b>' + R.counts.live + '</b> records a token (comparables). <b>' + R.counts.excluded + '</b> record none but are liquid staking, bridge or CEX records, wrapped/staked names, exchange names, version markers, or share a first word with a traded token. <b>' + rows.length + '</b> remain, all ' + R.counts.watchlist + ' watchlist slugs among them; a doubted watchlist row keeps a ⚑ flag.</p>' +
      '<h2>2. Value if launched, tested blind</h2><p>Each of the ' + f.n + ' token families is left out, the model refitted on the rest, its market cap predicted. <b>One selection rule for both models:</b> a term is kept only when it lowers the held-out error by more than <b>1% relative</b> to the model without it — the same margin on the size curve (dex) and on the launch odds (log loss), no model gets its own threshold. Curve log₁₀ mcap = ' + f.a + ' + ' + f.b + '·log₁₀ TVL' + (f.cat ? ' + category premium' : '') + '; 7d carry is ' + (f.cap ? 'capped ×' + f.cap : f.ridge ? 'shrunk ×' + f.ridge : '<b>not applied</b>') + ', time without a token is ' + (f.feats.indexOf('age') >= 0 ? 'in the curve' : '<b>not in the curve</b>') + '.</p>' +
      '<table class="math" style="max-width:640px"><thead><tr><th>Variant (leave-one-out on ' + f.n + ' families)</th><th class="n">Error</th><th class="n">Within 2×</th><th>Used</th></tr></thead><tbody>' +
      R.tests.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="n">' + t.mae.toFixed(3) + ' dex</td><td class="n">' + Math.round(t.hit * 100) + '%</td><td>' + (t.applied ? '<b class="up">applied</b>' : '<span class="muted">rejected</span>') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>Calibration, held out</h3><p>Low–high is the LOO error quartiles. Across the ' + f.n + ' families held out in turn, <b>' + Math.round(cal.inside * 100) + '%</b> land inside it against a nominal 50%. Error: this model <b>' + cal.size_mae.toFixed(3) + '</b> dex, a flat multiple of the median cap/TVL <b>' + cal.flat_mae.toFixed(3) + '</b>, one multiple of TVL alone <b>' + cal.tvl1_mae.toFixed(3) + '</b>.</p>' +
      '<h2>3. Launch odds from time with no token</h2><p>Share with a token by age: ' + o.bins.map(function (b) { return b.from + '–' + b.to + 'y ' + Math.round(b.share * 100) + '% (' + b.n + ')'; }).join(', ') + '. Fitted ' + esc(oddsFormula(o)) + '; 12-month odds at age a: (F(a+1) − F(a)) / (1 − F(a)); × ' + R.flag_odds + ' per caution flag. Picked by held-out log loss under the same 1% rule: <b>' + esc(o.pick) + '</b> at ' + o.logloss + ' against ' + o.base_logloss + ' for age alone' + (o.feats.indexOf('g') < 0 ? '; <b>7d growth is dropped</b> — it misses the margin (' + o.tests[o.tests.length - 1].logloss + ' vs ' + o.logloss + ' = ' + (Math.abs(o.tests[o.tests.length - 1].logloss - o.logloss) / o.logloss * 100).toFixed(2) + '%), so it is not in the odds.' : '.') + '</p>' +
      '<table class="math" style="max-width:640px"><thead><tr><th>Odds model (each protocol left out)</th><th class="n">Log loss</th><th class="n">Brier</th><th>Used</th></tr></thead><tbody>' +
      o.tests.map(function (t) { return '<tr><td>' + esc(t.name) + (t.logloss > 3 ? ' <span class="muted">(does not converge: 7d growth alone separates the sample)</span>' : '') + '</td><td class="n">' + t.logloss.toFixed(3) + '</td><td class="n">' + t.brier.toFixed(3) + '</td><td>' + (t.name === o.pick ? '<b class="up">applied</b>' : '<span class="muted">rejected</span>') + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>4. Farm verdicts</h2><p><code>net = ' + Math.round(R.user_share * 100) + '% × value if launched × position / TVL × odds − gas − fees − ' + Math.round(R.tbill * 100) + '% T-bill yield</code>. <b>Farm now</b>: no flag, confidence ≥ 55, 7d TVL above −12%, net ≥ $25 and ≥ its costs. <b>Skip</b>: a flag, confidence &lt; 40 or a net loss. Else <b>watch</b>.</p>' +
      '<h2>Caveats</h2><p class="note">Estimates, not financial advice. The snapshot carries no fees, revenue, raises, audits or history; market caps stand in for FDV. A record with no token may still have one. The reader\'s assumptions are the reader\'s: they re-rank the board and are labelled as such.</p></article>';
  }

  var checksMounted = false;
  function render() {
    var s = read(), focusId = document.activeElement && document.activeElement.id;
    document.getElementById('asof').textContent = 'Snapshot ' + R.as_of + ' · ' + rows.length + ' pre-token candidates ranked by implied launch value';
    app.innerHTML = s.view === 'live' ? live() : s.view === 'excluded' ? excluded() : s.view === 'method' ? method() : board(s);
    var TABS = { board: ['Board', rows.length], live: ['Already trading', R.comps.length], excluded: ['Excluded', R.excluded.length], method: ['Method', 6] };
    [].forEach.call(document.querySelectorAll('.tabs a'), function (t) {
      var n = TABS[t.dataset.view];
      if (n) t.textContent = n[0] + ' ' + n[1];
      if (t.dataset.view === s.view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (focusId === 'q') { var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    if (s.p) detail(s.p); else document.getElementById('sheet').hidden = true;
    var c = document.getElementById('checks');
    if (c && window.RadarChecks) { window.RadarChecks.mount(c); if (!checksMounted) { checksMounted = true; setTimeout(window.RadarChecks.run, 0); } }
  }
  function csv(s) {
    var a = assumptions(s), list = sorted(filtered(s), s, a);
    var head = ['rank', 'protocol', 'category', 'chains', 'tvl_usd', 'change_7d_pct', 'implied_value_usd', 'low_usd', 'high_usd', 'confidence', 'priority', 'farm_cost_usd', 'farm_net_usd', 'farm_hours', 'main_risk', 'stop_rule'];
    var body = list.map(function (r) { return [r.r, r.n, r.c, r.ch.join('|'), r.tvl, r.d7 === null ? '' : r.d7, value(r, a), r.lo, r.hi, r.conf, r.pr, r.tc, netOf(r, a), r.hr, r.mr, r.sr]; });
    var q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var url = URL.createObjectURL(new Blob([head.join(',') + '\n' + body.map(function (row) { return row.map(q).join(','); }).join('\n') + '\n'], { type: 'text/csv' }));
    var link = document.createElement('a'); link.href = url; link.download = 'token-radar.csv'; link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  app.addEventListener('input', function (e) {
    if (e.target.id === 'q') write({ q: e.target.value });
    else if (e.target.id === 'g' || e.target.id === 'o' || e.target.id === 'sh') { var p = {}; p[e.target.id] = e.target.value; write(p); }
  });
  app.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'w') write({ w: e.target.checked ? '1' : '' });
    else if (id === 'cat' || id === 'chain' || id === 'tvl' || id === 'conf') { var p = {}; p[id] = e.target.value; write(p); }
  });
  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-pr],[data-unset],[data-cmp],[data-cmp-clear],#csv,#asm,[data-reset-asm],tr[data-p]');
    if (!t) return;
    var s = read();
    if (t.dataset.sort) write({ sort: t.dataset.sort, dir: s.sort === t.dataset.sort && s.dir === 'asc' ? 'desc' : s.sort === t.dataset.sort ? 'asc' : (t.dataset.sort === 'r' || t.dataset.sort === 'n' || t.dataset.sort === 'c' || t.dataset.sort === 'pr' ? 'asc' : 'desc') });
    else if (t.hasAttribute('data-pr')) write({ pr: t.dataset.pr });
    else if (t.hasAttribute('data-cmp-clear')) write({ cmp: '' });
    else if (t.dataset.cmp) {
      var list = (s.cmp || '').split(',').filter(Boolean), at = list.indexOf(t.dataset.cmp);
      if (at >= 0) list.splice(at, 1); else if (list.length < 3) list.push(t.dataset.cmp);
      write({ cmp: list.join(',') });
    }
    else if (t.id === 'csv') csv(s);
    else if (t.id === 'asm') write({ asm: s.asm ? '' : '1' });
    else if (t.hasAttribute('data-reset-asm')) write({ g: '', o: '', sh: '' });
    else if (t.dataset.unset === 'all') write({ q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '' });
    else if (t.dataset.unset) { var p = {}; p[t.dataset.unset] = ''; write(p); }
    else if (t.dataset.p) write({ p: t.dataset.p }, true);
  });
  app.addEventListener('keydown', function (e) { var tr = e.target.closest && e.target.closest('tr[data-p]'); if (tr && e.key === 'Enter') write({ p: tr.dataset.p }, true); });
  document.getElementById('sheet').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) write({ p: '' }, true); });
  document.addEventListener('keydown', function (e) {
    var s = read(), tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (e.key === '/' && !typing) { e.preventDefault(); var q = document.getElementById('q'); if (q) q.focus(); return; }
    if (e.key === 'Escape') { if (s.p) write({ p: '' }, true); else if (s.asm) write({ asm: '' }, true); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) {
      var list = [].slice.call(document.querySelectorAll('tbody tr[data-p]')), at = list.indexOf(document.activeElement);
      if (!list.length) return;
      e.preventDefault();
      list[at < 0 ? 0 : e.key === 'ArrowDown' ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1)].focus();
    }
  });
  window.addEventListener('hashchange', render);
  render();
})();