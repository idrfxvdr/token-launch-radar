/* Token Launch Radar — the page. Every screen is drawn here: renderKpis + renderStrip (top), renderToolbar + renderChips (filters), renderBoard + rowHtml (table), detail (sheet), renderLive / renderExcluded / renderMethod (tabs), exportCsv (CSV). */
(function () {
  'use strict';
  var R = window.RADAR, app = document.getElementById('app'), root = document.documentElement;
  if (!R) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts to write it beside dashboard/.</p>'; return; }
  var rows = R.rows;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) { var a = Math.abs(n); return a >= 1e9 ? '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n); }
  function pct(x) { return x === null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function bePct(be) { return be >= 1 ? 'cannot break even (' + Math.round(be * 100) + '%)' : Math.round(be * 100) + '%'; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
  var PR = { 'farm now': 'now', watch: 'watch', skip: 'skip' }, PR_ORDER = { 'farm now': 0, watch: 1, skip: 2 };
  function pill(p) { return '<span class="pill ' + PR[p] + '">' + esc(p) + '</span>'; }
  function m(x) { return '<span class="muted">' + x + '</span>'; }
  function card(t, b) { return '<div class="card"><h3>' + t + '</h3>' + b + '</div>'; }
  function table(cols, body) { return '<table><thead><tr>' + cols.map(function (c) { return '<th' + (c[1] ? ' class="' + c[1] + '"' : '') + '>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>'; }
  function row(cells) { return '<tr>' + cells.map(function (c) { return '<td' + (c[1] ? ' class="' + c[1] + '"' : '') + '>' + c[0] + '</td>'; }).join('') + '</tr>'; }

  var DEF = { view: 'board', q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '', sort: 'b', dir: 'desc', p: '' };
  function readState() { var s = Object.assign({}, DEF), h = new URLSearchParams(location.hash.slice(1)); Object.keys(DEF).forEach(function (k) { if (h.has(k)) s[k] = h.get(k); }); return s; }
  function writeState(patch, push) { var s = Object.assign(readState(), patch), h = new URLSearchParams(); Object.keys(DEF).forEach(function (k) { if (s[k] !== DEF[k] && s[k] !== '') h.set(k, s[k]); }); var url = '#' + h.toString(); if (push) location.hash = url; else { history.replaceState(null, '', url); render(); } }

  try { var st = localStorage.getItem('radar-theme'); if (st) root.dataset.theme = st; } catch (e) {}
  if (root.dataset.theme !== 'light' && root.dataset.theme !== 'dark') root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.getElementById('theme').onclick = function () { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('radar-theme', root.dataset.theme); } catch (e) {} };

  var cats = uniq(rows.map(function (r) { return r.c; })), chains = uniq([].concat.apply([], rows.map(function (r) { return r.ch; })));
  var BANDS = { '<50M': [0, 5e7], '50-250M': [5e7, 2.5e8], '250M-1B': [2.5e8, 1e9], '>1B': [1e9, Infinity] };

  function filteredRows(s) { var q = s.q.toLowerCase(); return rows.filter(function (r) { if (q && (r.n + ' ' + r.s + ' ' + r.c + ' ' + r.ch.join(' ')).toLowerCase().indexOf(q) < 0) return false; if (s.cat && r.c !== s.cat) return false; if (s.chain && r.ch.indexOf(s.chain) < 0) return false; if (s.tvl && BANDS[s.tvl] && !(r.tvl >= BANDS[s.tvl][0] && r.tvl < BANDS[s.tvl][1])) return false; if (s.conf && r.conf < +s.conf) return false; if (s.pr && r.pr !== s.pr) return false; if (s.w === '1' && !r.w) return false; return true; }); }
  function sortKeyValue(r, k) { return k === 'ch' ? r.ch.length : k === 'd7' ? (r.d7 === null ? -1e9 : r.d7) : k === 'pr' ? PR_ORDER[r.pr] : r[k]; }
  function sortRows(list, s) { var dir = s.dir === 'desc' ? -1 : 1, get = function (r) { return sortKeyValue(r, s.sort); }; return list.slice().sort(function (x, y) { var p = get(x), q = get(y); return (p < q ? -1 : p > q ? 1 : 0) * dir || x.r - y.r; }); }

  function renderKpis() {
    var tvl = 0, val = 0, covered = 0;
    rows.forEach(function (r) { tvl += r.tvl; val += r.b; if (r.w) covered++; });
    var c = R.counts;
    function tile(b, span, small) { return '<div class="kpi"><b>' + b + '</b><span>' + span + '</span><small>' + small + '</small></div>'; }
    return '<section class="kpis" aria-label="Headline">' +
      tile(covered + ' / ' + c.watchlist, 'watchlist covered', 'every house slug') +
      tile(String(rows.length), 'pre-token candidates', (rows.length - covered) + ' not on the list') +
      tile(usd(tvl), 'TVL with no token', c.live + ' traded kept off') +
      tile(usd(val), 'implied launch value', 'sum of bases') + '</section>';
  }
  function renderStrip() {
    var f = R.fit, w = rows[0];
    return '<section class="strip" aria-label="Value model"><div class="sworked"><span class="stag">Value</span> <b>#' + w.r + ' ' + esc(w.n) + '</b> ' + usd(w.tvl) + ' TVL → <b>' + usd(w.ifl) + '</b> if launched × ' + Math.round(w.od * 100) + '% = <b>' + usd(w.b) + '</b> implied ' + m('(' + usd(w.lo) + '–' + usd(w.hi) + '; LOO ' + f.loo_mae + ' dex, ' + f.n + ' families)') + '</div></section>';
  }

  function options(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function renderToolbar(s) {
    var seg = ['', 'farm now', 'watch', 'skip'].map(function (p) { return '<button type="button" data-pr="' + p + '" aria-pressed="' + (s.pr === p) + '">' + (p || 'All') + '</button>'; }).join('');
    return '<form class="filters" role="search" onsubmit="return false">' +
      '<input type="search" id="q" placeholder="Search" aria-label="Find" value="' + esc(s.q) + '">' +
      '<select id="cat" aria-label="Category">' + options(cats, s.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + options(chains, s.chain, 'All chains') + '</select>' +
      '<select id="tvl" aria-label="TVL band">' + options(Object.keys(BANDS), s.tvl, 'Any TVL') + '</select>' +
      '<select id="conf" aria-label="Confidence"><option value="">Any confidence</option>' + ['40', '55', '70'].map(function (c) { return '<option value="' + c + '"' + (s.conf === c ? ' selected' : '') + '>Confidence ≥ ' + c + '</option>'; }).join('') + '</select>' +
      '<div class="seg" role="group" aria-label="Priority">' + seg + '</div>' +
      '<label class="muted"><input type="checkbox" id="w"' + (s.w ? ' checked' : '') + '> Watchlist</label>' +
      '<button type="button" class="btn" id="csv">CSV ↓</button></form>';
  }
  function renderChips(s, n) {
    var out = [];
    function chip(key, label) { out.push('<span class="chip">' + esc(label) + '<button type="button" data-unset="' + key + '" aria-label="Remove ' + esc(label) + '">×</button></span>'); }
    if (s.q) chip('q', 'search: ' + s.q); if (s.cat) chip('cat', 'category: ' + s.cat); if (s.chain) chip('chain', 'chain: ' + s.chain); if (s.tvl) chip('tvl', 'TVL ' + s.tvl); if (s.conf) chip('conf', 'confidence ≥ ' + s.conf); if (s.pr) chip('pr', 'priority: ' + s.pr); if (s.w) chip('w', 'watchlist only');
    return '<div class="chips"><span class="muted"><b>' + n + ' of ' + rows.length + '</b> shown · ' + (out.length ? 'filters:' : 'no filters') + '</span>' + out.join('') + (out.length ? '<button type="button" class="clear" data-unset="all">Clear all</button>' : '') + '</div>';
  }

  function th(s, key, label, cls) { var sort = s.sort === key ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none'; return '<th scope="col"' + (cls ? ' class="' + cls + '"' : '') + ' aria-sort="' + sort + '"><button type="button" data-sort="' + key + '">' + label + '</button></th>'; }
  function rowHtml(r) {
    return '<tr tabindex="-1" data-p="' + esc(r.s) + '"><td class="n">' + r.r + '</td>' +
      '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="tag w" title="Watchlist">WL</span>' : '') + (r.fl.length ? '<span class="tag f" title="' + esc(r.fl.join('; ')) + '">⚑</span>' : '') + '</td>' +
      '<td class="hide-sm cat" title="' + esc(r.c) + '">' + esc(r.c) + '</td>' +
      '<td class="hide-md chainlist">' + esc(r.ch[0] || '') + (r.ch.length > 1 ? ' +' + (r.ch.length - 1) : '') + '</td>' +
      '<td class="n nw">' + usd(r.tvl) + ' <span class="d7 ' + (r.d7 === null ? 'muted' : r.d7 >= 0 ? 'up' : 'down') + '">' + pct(r.d7) + '</span></td>' +
      '<td class="n hide-sm nw"><b>' + Math.round(r.od * 100) + '%</b> ' + m(r.age === null ? 'age n/a' : (r.age / 365).toFixed(1) + 'y') + '</td>' +
      '<td><div class="range"><b>' + usd(r.b) + '</b><small>' + usd(r.lo) + ' – ' + usd(r.hi) + ' · launched ' + usd(r.ifl) + '</small></div></td>' +
      '<td class="n hide-sm nw"><span class="meter"><i style="width:' + r.conf + '%"></i></span>' + r.conf + '</td>' +
      '<td class="nw">' + pill(r.pr) + '<small class="net ' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + ' net</small></td></tr>';
  }
  function renderBoard(s) {
    var list = sortRows(filteredRows(s), s), body = list.map(rowHtml).join('');
    return renderKpis() + renderStrip() + '<div id="checks" class="checks run"></div>' + renderToolbar(s) + renderChips(s, list.length) +
      '<div class="tablewrap"><table><caption class="sr" hidden>Pre-token protocols; # is implied-value rank</caption><thead><tr>' +
      th(s, 'r', '#', 'n') + th(s, 'n', 'Protocol') + th(s, 'c', 'Category', 'hide-sm') + th(s, 'ch', 'Chains', 'hide-md') + th(s, 'tvl', 'TVL · 7d', 'n') + th(s, 'od', '12-mo odds', 'n hide-sm') + th(s, 'b', 'Value = if launched × odds') + th(s, 'conf', 'Conf.', 'n hide-sm') + th(s, 'net', 'Farm · net') +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="9" class="empty">No protocol matches.</td></tr>') + '</tbody></table></div>';
  }

  function detail(slug) {
    var r = rows.filter(function (x) { return x.s === slug; })[0], sheet = document.getElementById('sheet'), panel = document.getElementById('panel');
    if (!r) { sheet.hidden = true; return; }
    var done = {}; try { done = JSON.parse(localStorage.getItem('radar-done-' + r.s) || '{}'); } catch (e) {}
    var facts = [['Chain', esc(r.chain)], ['At risk', usd(r.cap[0]) + ' → ' + usd(r.cap[1])], ['Hands', '~' + r.hr + ' h'], ['Gas & fees', '~$' + r.tc], ['Expected', '~$' + r.dp], ['Net', '<b class="' + (r.net > 0 ? 'up' : 'down') + '">' + (r.net >= 0 ? '+' : '−') + '$' + Math.abs(r.net) + '</b>'], ['Break-even odds', bePct(r.be)], ['Slice', '$' + r.sl], ['× odds', Math.round(r.oh * 100) + '%'], ['T-bill', '$' + r.tb], ['Horizon', r.wk + ' weeks'], ['Gas', esc(r.gas)]];
    panel.innerHTML =
      '<div class="phead"><div><div class="muted">#' + r.r + ' of ' + rows.length + ' · ' + esc(r.c) + ' · ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) + ' more' : '') + (r.w ? ' <span class="tag w">house watchlist</span>' : '') + '</div><h2 id="d-title">' + esc(r.n) + '</h2></div><button class="close" type="button" data-close>✕</button></div>' +
      '<div class="cols"><div>' +
      card('Implied value', '<div class="big">' + usd(r.b) + '</div><div class="chain">' + usd(r.tvl) + ' TVL → <b>' + usd(r.ifl) + '</b> if launched → × <b>' + Math.round(r.od * 100) + '%</b> odds → <b>' + usd(r.b) + '</b></div>' + m('range ' + usd(r.lo) + ' – ' + usd(r.hi) + ' · conf ' + r.conf + ' · ' + r.pr)) + '</div><div>' +
      card('Why it is here', '<p style="margin:0">' + esc(r.why) + '</p>' + (r.fl.length ? '<ul class="risks">' + r.fl.map(function (f) { return '<li>⚑ ' + esc(f) + '</li>'; }).join('') + '</ul>' : '')) +
      card('Farm plan', '<div class="facts">' + facts.map(function (f) { return '<span>' + f[0] + ' <b>' + f[1] + '</b></span>'; }).join('') + '</div><div class="facts2"><div><b>Main risk</b><p>' + esc(r.mr) + '</p></div><div><b>Stop rule</b><p>' + esc(r.sr) + '</p></div></div><ol class="steps">' + r.st.map(function (st, i) { return '<li><label><input type="checkbox" data-step="' + i + '"' + (done[i] ? ' checked' : '') + '><span>' + esc(st[0]) + ' <span class="ct">' + (st[3] ? '<i class="when">' + esc(st[3]) + ' · </i>' : '') + '<i>Cost ' + esc(st[1]) + '</i> · <i>Time ' + esc(st[2]) + '</i></span></span></label></li>'; }).join('') + '</ol>') + '</div></div>';
    panel.onchange = function (e) { var i = e.target.getAttribute('data-step'); if (i === null) return; done[i] = e.target.checked; try { localStorage.setItem('radar-done-' + r.s, JSON.stringify(done)); } catch (er) {} };
    sheet.hidden = false; panel.scrollTop = 0; panel.focus();
  }
  window.RadarDetail = detail;

  function renderLive() {
    var c = R.comps.slice().sort(function (a, b) { return b.mc - a.mc || (a.s < b.s ? -1 : 1); });
    var body = c.map(function (x) { return row([[esc(x.n), 'pname'], esc(x.sym), [esc(x.c), 'hide-sm'], [usd(x.tvl), 'n'], [usd(x.mc), 'n'], ['Comparable, not a candidate', 'muted']]); }).join('');
    return '<div class="prose"><h2>Already trading: the comparables</h2><p><b>' + R.counts.live + '</b> records carry a token and stay off the board; same-symbol records form one family: these <b>' + c.length + '</b> price each candidate.</p></div>' +
      '<div class="tablewrap">' + table([['Protocol'], ['Token'], ['Category', 'hide-sm'], ['TVL', 'n'], ['Market cap', 'n'], ['Why not ranked']], body) + '</div>';
  }
  function renderExcluded() {
    var x = R.excluded.slice().sort(function (a, b) { return b.tvl - a.tvl || (a.s < b.s ? -1 : 1); });
    var body = x.map(function (e) { return row([[esc(e.n), 'pname'], [esc(e.c), 'hide-sm'], [usd(e.tvl), 'n'], esc(e.why)]); }).join('');
    return '<div class="prose"><h2>Excluded: no token recorded, but not a launch candidate</h2><p>' + x.length + ' records are a wrapped, staked, bridged or exchange product, or a version of a protocol whose token trades. Watchlist rows stay on the board.</p></div>' +
      '<div class="tablewrap">' + table([['Record'], ['Category', 'hide-sm'], ['TVL', 'n'], ['Why it is off the board']], body) + '</div>';
  }

  function renderMethod() {
    var f = R.fit, o = R.odds, cal = R.cal;
    return '<article class="prose">' +
      '<h2>What the board claims</h2><p class="note">Every screen is drawn by <code>dashboard/app.js</code> — tiles, value strip, table, filters, detail sheet, tabs, CSV; the numbers come from <code>dashboard/00-model.js</code>.</p>' +
      '<p>For each protocol with no token: what a token would be worth if launched, the odds it launches within a year, and whether farming pays. ' + esc(R.source) + '.</p>' +
      '<h2>1. Who is ranked</h2><p><b>' + R.counts.live + '</b> records a token (comparables). <b>' + R.counts.excluded + '</b> record none but are liquid staking, bridge or CEX records, wrapped/staked names, exchange names, version markers, or share a first word with a traded token. <b>' + rows.length + '</b> remain, all ' + R.counts.watchlist + ' watchlist slugs among them; a doubted watchlist row keeps a ⚑ flag.</p>' +
      '<h2>2. Value if launched, tested blind</h2><p>' + f.n + ' token families are each left out, the model refitted on the rest, its mcap predicted. <b>One rule for both models:</b> keep a term only when it lowers the held-out error by more than <b>1% relative</b>. Curve log₁₀ mcap = ' + f.a + ' + ' + f.b + '·log₁₀ TVL' + (f.cat ? ' + category premium' : '') + '; 7d carry ' + (f.cap ? 'capped ×' + f.cap : f.ridge ? 'shrunk ×' + f.ridge : '<b>not applied</b>') + '; LOO error <b>' + f.loo_mae + '</b> dex. Low–high is the LOO quartiles: <b>' + Math.round(cal.inside * 100) + '%</b> of held-out families land inside (nominal 50%); flat cap/TVL <b>' + cal.flat_mae.toFixed(3) + '</b>, TVL alone <b>' + cal.tvl1_mae.toFixed(3) + '</b>.</p>' +
      '<h2>3. Launch odds from time with no token</h2><p>Share with a token by age: ' + o.bins.map(function (b) { return b.from + '–' + b.to + 'y ' + Math.round(b.share * 100) + '% (' + b.n + ')'; }).join(', ') + '. 12-mo odds at age a: (F(a+1) − F(a)) / (1 − F(a)); × ' + R.flag_odds + ' per flag. Picked by held-out log loss under the same 1% rule: <b>' + esc(o.pick) + '</b> at ' + o.logloss + ' vs ' + o.base_logloss + ' for age alone.</p>' +
      '<h2>4. Farm verdicts</h2><p><code>net = ' + Math.round(R.user_share * 100) + '% × value if launched × position / TVL × odds − gas − fees − ' + Math.round(R.tbill * 100) + '% T-bill</code>. <b>Farm now</b>: no flag, conf ≥ 55, 7d TVL above −12%, net ≥ $25 and ≥ costs. <b>Skip</b>: a flag, conf &lt; 40 or a net loss. Else <b>watch</b>. The hand-set constants (7%, 4%, ×0.30, 55/40) are assumptions, not fitted.</p>' +
      '<h2>Caveats</h2><p class="note">Estimates, not financial advice. The snapshot carries no fees, revenue, raises, audits or history; market caps stand in for FDV.</p></article>';
  }

  var checksMounted = false;
  function render() {
    var s = readState(), focusId = document.activeElement && document.activeElement.id;
    document.getElementById('asof').textContent = 'Snapshot ' + R.as_of + ' · ' + rows.length + ' pre-token candidates, sorted by implied value';
    app.innerHTML = s.view === 'live' ? renderLive() : s.view === 'excluded' ? renderExcluded() : s.view === 'method' ? renderMethod() : renderBoard(s);
    var TABS = { board: ['Board', rows.length], live: ['Already trading', R.comps.length], excluded: ['Excluded', R.excluded.length], method: ['Method', 7] };
    [].forEach.call(document.querySelectorAll('.tabs a'), function (t) { var n = TABS[t.dataset.view]; if (n) t.textContent = n[0] + ' ' + n[1]; if (t.dataset.view === s.view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    if (focusId === 'q') { var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    if (s.p) detail(s.p); else document.getElementById('sheet').hidden = true;
    var c = document.getElementById('checks'); if (c && window.RadarChecks) { window.RadarChecks.mount(c); if (!checksMounted) { checksMounted = true; setTimeout(window.RadarChecks.run, 0); } }
  }

  function exportCsv(s) {
    var list = sortRows(filteredRows(s), s);
    var head = ['rank', 'protocol', 'category', 'chains', 'tvl_usd', 'change_7d_pct', 'implied_value_usd', 'low_usd', 'high_usd', 'confidence', 'priority', 'farm_cost_usd', 'farm_net_usd', 'farm_hours', 'main_risk', 'stop_rule'];
    var body = list.map(function (r) { return [r.r, r.n, r.c, r.ch.join('|'), r.tvl, r.d7 === null ? '' : r.d7, r.b, r.lo, r.hi, r.conf, r.pr, r.tc, r.net, r.hr, r.mr, r.sr]; });
    var q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var url = URL.createObjectURL(new Blob([head.join(',') + '\n' + body.map(function (row) { return row.map(q).join(','); }).join('\n') + '\n'], { type: 'text/csv' }));
    var link = document.createElement('a'); link.href = url; link.download = 'token-radar.csv'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  app.addEventListener('input', function (e) { if (e.target.id === 'q') writeState({ q: e.target.value }); });
  app.addEventListener('change', function (e) { var id = e.target.id; if (id === 'w') writeState({ w: e.target.checked ? '1' : '' }); else if (id === 'cat' || id === 'chain' || id === 'tvl' || id === 'conf') { var p = {}; p[id] = e.target.value; writeState(p); } });
  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-pr],[data-unset],#csv,tr[data-p]'); if (!t) return; var s = readState();
    if (t.dataset.sort) writeState({ sort: t.dataset.sort, dir: s.sort === t.dataset.sort && s.dir === 'asc' ? 'desc' : s.sort === t.dataset.sort ? 'asc' : (t.dataset.sort === 'r' || t.dataset.sort === 'n' || t.dataset.sort === 'c' || t.dataset.sort === 'pr' ? 'asc' : 'desc') });
    else if (t.hasAttribute('data-pr')) writeState({ pr: t.dataset.pr });
    else if (t.id === 'csv') exportCsv(s);
    else if (t.dataset.unset === 'all') writeState({ q: '', cat: '', chain: '', tvl: '', conf: '', pr: '', w: '' });
    else if (t.dataset.unset) { var p = {}; p[t.dataset.unset] = ''; writeState(p); }
    else if (t.dataset.p) writeState({ p: t.dataset.p }, true);
  });
  app.addEventListener('keydown', function (e) { var tr = e.target.closest && e.target.closest('tr[data-p]'); if (tr && e.key === 'Enter') writeState({ p: tr.dataset.p }, true); });
  document.getElementById('sheet').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) writeState({ p: '' }, true); });
  document.addEventListener('keydown', function (e) {
    var s = readState(), tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (e.key === '/' && !typing) { e.preventDefault(); var q = document.getElementById('q'); if (q) q.focus(); return; }
    if (e.key === 'Escape') { if (s.p) writeState({ p: '' }, true); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) { var list = [].slice.call(document.querySelectorAll('tbody tr[data-p]')), at = list.indexOf(document.activeElement); if (!list.length) return; e.preventDefault(); list[at < 0 ? 0 : e.key === 'ArrowDown' ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1)].focus(); }
  });
  window.addEventListener('hashchange', render); render();
})();