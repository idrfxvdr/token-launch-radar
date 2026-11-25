/* Token Launch Radar model: the single source of every number on the board. main.ts runs it in Node to write
   board.json; the page re-runs it on the raw snapshot and checks every value (checks.js). No protocol is named:
   every rule reads the snapshot's own fields. Plain ES5, classic script, no network. Two fits, both chosen by
   leave-one-out under one relative-margin rule and reported against the simpler model. */
(function (root) {
  'use strict';
  var K = 4; // shrinkage: a group of n peers is weighted n / (n + K) against its parent
  var SECTORS = {
    Trading: 'Dexs Derivatives Options Prediction Market Interest Rate Derivatives OTC Marketplace Launchpad NFT Marketplace Perps',
    Credit: 'Lending CDP CDP Manager Uncollateralized Lending Collateral Markets Collateral Management Dual-Token Stablecoin Stablecoin Wrapper',
    'Yield & vaults': 'Yield Yield Aggregator Risk Curators Onchain Capital Allocator Basis Trading Liquidity Manager Leveraged Farming Farm Indexes Governance Incentives Staking Pool',
    'RWA & CeDeFi': 'RWA CeDeFi Payments Crypto Card Issuer Insurance RWA Lending',
    Infrastructure: 'Chain Restaking Cross Chain Bridge Bridge Canonical Bridge Decentralized BTC Privacy AI Agents Decentralized AI Token Locker Liquid Staking Liquid Restaking Restaked BTC Anchor BTC CEX DOR Oracle'
  };
  Object.keys(SECTORS).forEach(function (s) { SECTORS[s] = SECTORS[s].split(' '); });
  function sectorOf(c) { for (var s in SECTORS) if (c !== null && SECTORS[s].indexOf(c) >= 0) return s; return 'Other'; }

  /* ---------- 1. classify: live token, pre-token candidate, or a product of a traded token ---------- */
  var DERIVATIVE_CATS = ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX', 'Anchor BTC'];
  var EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini', 'htx', 'kucoin', 'gate', 'mexc', 'crypto.com'];
  var DERIVATIVE_WORDS = /\b(wrapped|staked|staking|restaked|bridged|liquid staking)\b/i;
  var VERSION = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
  var GENERIC = 'the liquid finance protocol money capital labs network dao swap yield vault vaults pool pools lend earn staking bridge exchange markets market stable usd btc eth sol open base one pro prime core x';
  GENERIC = GENERIC.split(' ');
  function familyKey(name) {
    var first = name.toLowerCase().replace(VERSION, '').split(/[\s\-_.:()/]+/).filter(function (w) { return w; })[0] || '';
    var w = first.replace(/[^a-z0-9]/g, '');
    return w.length >= 4 && GENERIC.indexOf(w) < 0 ? w : null;
  }
  function hasToken(p) { return p.gecko_id !== null || p.symbol !== null; }
  function classify(snap) {
    var tokenOf = {}, house = {}, out = {};
    snap.watchlist.forEach(function (s) { house[s] = 1; });
    snap.protocols.forEach(function (p) { var k = familyKey(p.name); if (k && hasToken(p) && !tokenOf[k]) tokenOf[k] = p.symbol || p.gecko_id; });
    snap.protocols.forEach(function (p) {
      if (hasToken(p)) { out[p.slug] = { status: 'live', reason: 'Records the token ' + (p.symbol || p.gecko_id) + ': already launched, used as a comparable.', flags: [] }; return; }
      var lower = p.name.toLowerCase(), key = familyKey(p.name), fam = key && tokenOf[key], flags = [];
      var ex = DERIVATIVE_CATS.indexOf(p.category) >= 0 ? p.category + ' record: a wrapped, staked, bridged or custodial form of an asset that already trades.'
        : EXCHANGES.some(function (e) { return lower.indexOf(e) === 0; }) ? 'Named after a centralised exchange: an exchange product, not a protocol waiting on a token.'
        : DERIVATIVE_WORDS.test(p.name) ? 'Its name marks it as a wrapped or staked product of an existing asset.'
        : fam ? 'Shares its name with a protocol that already trades ' + fam + ': a version or deployment of that token\'s protocol.'
        : VERSION.test(p.name) ? 'A versioned deployment (its name ends in a version marker) of an older protocol.' : null;
      var own = key && p.chains.filter(function (c) { return c.toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(key) === 0; })[0];
      if (own) flags.push('chain-native: named after the chain it runs on (' + own + '), whose gas token already trades');
      if (p.category === 'Chain') flags.push('a chain: its value accrues to the chain\'s gas token, not an app airdrop');
      if (p.category === 'Stablecoin Wrapper' || /^usd|usd$|\busd\w*\b/i.test(p.name)) flags.push('stablecoin issuer: the record is the stablecoin itself, which is not a launch token');
      if (ex && !house[p.slug]) { out[p.slug] = { status: 'excluded', reason: ex, flags: flags }; return; }
      if (ex) flags.push(ex);
      out[p.slug] = { status: 'candidate', flags: flags, reason: house[p.slug]
        ? 'On the house watchlist: $' + short(p.tvl_usd) + ' TVL at or above the $' + short(snap.floor_usd) + ' floor, no token recorded, and no wrapped, staked or bridged marker.'
        : 'Below the watchlist floor or outside it, but records no token and passes the radar\'s own product filter: an early candidate.' };
    });
    return out;
  }

  /* ---------- 2. comparables: one per traded token, its records' TVL summed ---------- */
  function yearsOld(listed, asOf) { return listed === null ? null : (Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / 864e5 / 365; }
  function tokenFamilies(snap) {
    var fams = {}, keys = [];
    snap.protocols.forEach(function (p) {
      var k = p.symbol !== null ? 'sym:' + p.symbol.toUpperCase() : p.gecko_id;
      if (k === null) return;
      if (!fams[k]) { fams[k] = []; keys.push(k); }
      fams[k].push(p);
    });
    var out = [];
    keys.forEach(function (k) {
      var m = fams[k], mcap = 0, tvl = 0, chains = {}, first = null;
      m.forEach(function (p) { mcap = Math.max(mcap, p.mcap_usd || 0); tvl += p.tvl_usd; p.chains.forEach(function (c) { chains[c] = 1; }); if (p.listed_at && (!first || p.listed_at < first)) first = p.listed_at; });
      if (mcap <= 0 || tvl <= 0) return;
      var lead = m.slice().sort(function (x, y) { return y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1); })[0];
      out.push({ slug: lead.slug, name: lead.name, category: lead.category, symbol: lead.symbol || lead.gecko_id || '', tvl: tvl, mcap: mcap, records: m.length,
        c7: lead.change_7d, chains: Object.keys(chains).length, age: yearsOld(first, snap.as_of) });
    });
    return out.sort(function (x, y) { return x.slug < y.slug ? -1 : 1; });
  }

  /* ---------- 3. small maths ---------- */
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function quantile(s0, q) { var s = s0.slice().sort(function (a, b) { return a - b; }); if (!s.length) return 0; var at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at); return s[lo] + (s[hi] - s[lo]) * (at - lo); }
  function med(v) { return quantile(v, 0.5); }
  function group(v) { return { n: v.length, median: quantile(v, 0.5), q25: quantile(v, 0.25), q75: quantile(v, 0.75) }; }
  function lsq(rows, feats) {
    var k = feats.length + 1, A = [], b = [], i, j, r;
    for (i = 0; i < k; i++) { A.push([]); b.push(0); for (j = 0; j < k; j++) A[i].push(0); }
    rows.forEach(function (row) { var v = [1].concat(feats.map(function (f) { return row[f]; })); for (i = 0; i < k; i++) { b[i] += v[i] * row.y; for (j = 0; j < k; j++) A[i][j] += v[i] * v[j]; } });
    for (i = 0; i < k; i++) {
      var p = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      var t = A[i]; A[i] = A[p]; A[p] = t; t = b[i]; b[i] = b[p]; b[p] = t;
      for (r = i + 1; r < k; r++) { var q = A[r][i] / A[i][i]; for (j = i; j < k; j++) A[r][j] -= q * A[i][j]; b[r] -= q * b[i]; }
    }
    var w = []; for (i = k - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < k; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
    return w;
  }
  function dot(w, v) { return w.reduce(function (t, x, i) { return t + x * v[i]; }, 0); }
  function design(feats, r) { return [1].concat(feats.map(function (f) { return r[f]; })); }

  /* ---------- 4. value if launched: the terms, each left out and refitted ----------
     rows are the snapshot's token families: y = log10 mcap, x = log10 TVL, c7 = log10(1 + 7d growth), age in years.
     A term is applied only when its held-out error beats the model without it; every variant is reported. */
  function rowsOf(fams) {
    return fams.map(function (p) { return { y: Math.log10(p.mcap), x: Math.log10(p.tvl), c7: Math.log10(1 + Math.max(-90, p.c7 === null ? 0 : p.c7) / 100), age: p.age === null ? 2 : p.age, cat: p.category || 'Uncategorised' }; });
  }
  function V(name, feats, extra) {
    var v = { name: name, feats: feats, cap: 0, ridge: 0, cat: false, applied: false };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  /** One variant's prediction for row i, fitted on rest. cap carries TVL forward, clamped to [1/cap, cap]. */
  function predictV(rows, rest, i, v) {
    var w = lsq(rest, v.feats), r = rows[i], x = r.x;
    if (v.cap) x = Math.log10(Math.pow(10, r.x) * clamp(Math.pow(10, r.c7), 1 / v.cap, v.cap));
    var g = dot(w, design(v.feats, { x: x, c7: r.c7, age: r.age }));
    if (v.ridge) g += w[2] * (v.ridge - 1) * r.c7;
    if (v.cat) g += premium(rest, w, v.feats, r.cat);
    return g;
  }
  /** Category median residual, shrunk to zero by n/(n+K): the category term, tested and usually rejected. */
  function premium(rows, w, feats, cat) {
    var own = [];
    rows.forEach(function (r) { if (r.cat === cat) own.push(r.y - dot(w, design(feats, r))); });
    return own.length ? own.length / (own.length + K) * med(own) : 0;
  }
  /** Leave-one-out errors of a variant: one refit per family, its held-out error in dex (log10). */
  function looErrors(rows, v) {
    var errs = [], n = rows.length;
    for (var i = 0; i < n; i++) errs.push(rows[i].y - predictV(rows, rows.filter(function (_, j) { return j !== i; }), i, v));
    return errs;
  }
  /** Mean absolute held-out error, and the share of families priced within 2x. */
  function looV(rows, v) {
    var errs = looErrors(rows, v), e = 0, hit = 0;
    errs.forEach(function (x) { e += Math.abs(x); if (Math.abs(x) <= Math.log10(2)) hit++; });
    return { mae: r3(e / errs.length), hit: r3(hit / errs.length) };
  }
  /** Nested coverage: the band for each held-out family is the quartiles of the other families' own errors. */
  function looInside(rows, v) {
    var errs = looErrors(rows, v), inside = 0;
    for (var i = 0; i < errs.length; i++) {
      var others = errs.filter(function (_, j) { return j !== i; });
      if (errs[i] >= quantile(others, 0.25) && errs[i] <= quantile(others, 0.75)) inside++;
    }
    return r3(inside / errs.length);
  }
  /** The flat baseline: every family priced at the median market cap / TVL of the rest. */
  function looFlat(rows) {
    var e = 0, hit = 0, n = rows.length;
    for (var i = 0; i < n; i++) {
      var rest = rows.filter(function (_, j) { return j !== i; });
      var m = med(rest.map(function (r) { return r.y - r.x; })), err = rows[i].y - (rows[i].x + m);
      e += Math.abs(err); if (Math.abs(err) <= Math.log10(2)) hit++;
    }
    return { mae: r3(e / n), hit: r3(hit / n) };
  }
  /** Nested: the ridge strength is chosen by 5-fold CV inside each outer training set. */
  function ridgeStrength(rows) {
    var grid = [0, 0.5, 1], best = 0, bestE = Infinity;
    grid.forEach(function (s) {
      var e = 0, folds = 5, n = rows.length;
      for (var f = 0; f < folds; f++) {
        var test = [], train = [];
        rows.forEach(function (r, j) { (j % folds === f ? test : train).push(r); });
        var w = lsq(train, ['x', 'c7']);
        test.forEach(function (r) { e += Math.abs(r.y - (w[0] + w[1] * r.x + w[2] * s * r.c7)); });
      }
      e /= n;
      if (e < bestE - 1e-9) { bestE = e; best = s; }
    });
    return best;
  }
  /** Every variant the value fit may apply, in the order they are tested. */
  function variants(rows) {
    var s = ridgeStrength(rows);
    return [V('TVL only', ['x']),
      V('+ 7d growth, fitted', ['x', 'c7']),
      V('+ 7d growth, ridge ' + s + ' (nested CV)', ['x', 'c7'], { ridge: s }),
      V('+ 7d carry capped ×1.2', ['x'], { cap: 1.2 }),
      V('+ 7d carry capped ×1.5', ['x'], { cap: 1.5 }),
      V('+ time without a token', ['x', 'age']),
      V('+ category premium', ['x'], { cat: true })];
  }

  /* ---------- 5. launch odds: a logistic on age, TVL and 7d growth ----------
     P(token by age a) = 1/(1+e^-(c0 + c1·a + c2·log10 TVL + c3·log10(1+7d))); a protocol with no token at age a
     launches within h years with probability (F(a+h) - F(a)) / (1 - F(a)). */
  var ODDS_FEATS = ['a', 'lx', 'g'];
  function logitFit(pts, feats) {
    var k = feats.length + 1, c = new Array(k).fill(0), it, i, j, r;
    for (it = 0; it < 25; it++) {
      var H = [], g = [], move = 0;
      for (i = 0; i < k; i++) { H.push([]); g.push(0); for (j = 0; j < k; j++) H[i].push(0); }
      pts.forEach(function (p) {
        var v = design(feats, p), z = dot(c, v), pr = 1 / (1 + Math.exp(-z)), w = Math.max(pr * (1 - pr), 1e-9);
        for (i = 0; i < k; i++) { g[i] += v[i] * (p.y - pr); for (j = 0; j < k; j++) H[i][j] += w * v[i] * v[j]; }
      });
      var A = H.map(function (row, i2) { return row.concat([g[i2]]); });
      for (i = 0; i < k; i++) A[i][i] += 1e-2; // a little ridge: keeps a rare split from running the logit away
      for (i = 0; i < k; i++) {
        var p2 = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p2][i])) p2 = r;
        var t = A[i]; A[i] = A[p2]; A[p2] = t;
        for (r = i + 1; r < k; r++) { var q = A[r][i] / A[i][i]; for (j = i; j <= k; j++) A[r][j] -= q * A[i][j]; }
      }
      var d = new Array(k); for (i = k - 1; i >= 0; i--) { var s2 = A[i][k]; for (j = i + 1; j < k; j++) s2 -= A[i][j] * d[j]; d[i] = s2 / A[i][i]; }
      for (i = 0; i < k; i++) { c[i] += d[i]; move = Math.max(move, Math.abs(d[i])); }
      if (move < 1e-7) break;
    }
    return c;
  }
  function oddsAt(c, p, feats) { return 1 / (1 + Math.exp(-dot(c, design(feats, p)))); }
  function oddsPoints(snap, verdicts) {
    var pts = [];
    snap.protocols.forEach(function (p) {
      var a = yearsOld(p.listed_at, snap.as_of); if (a === null || verdicts[p.slug].status === 'excluded') return;
      pts.push({ slug: p.slug, y: verdicts[p.slug].status === 'live' ? 1 : 0, a: Math.min(6, a), lx: Math.log10(Math.max(1, p.tvl_usd)),
        g: Math.log10(1 + Math.max(-90, p.change_7d === null ? 0 : p.change_7d) / 100), tvl: p.tvl_usd });
    });
    return pts;
  }
  /** Held-out log loss and Brier score, each protocol left out in turn. */
  function oddsTest(pts, feats) {
    var ll = 0, br = 0, n = pts.length;
    pts.forEach(function (_, i) {
      var c = logitFit(pts.filter(function (__, j) { return j !== i; }), feats);
      var pr = clamp(oddsAt(c, pts[i], feats), 0.001, 0.999);
      ll += pts[i].y ? Math.log(pr) : Math.log(1 - pr); br += Math.pow(pr - pts[i].y, 2);
    });
    return { logloss: r3(-ll / Math.max(1, n)), brier: r3(br / Math.max(1, n)) };
  }
  function oddsTests(pts) {
    return [['constant (no age)', []], ['age', ['a']], ['age + TVL', ['a', 'lx']], ['age + 7d growth', ['a', 'g']], ['age + TVL + 7d growth', ['a', 'lx', 'g']]]
      .map(function (t) { var r = oddsTest(pts, t[1]); return { name: t[0], feats: t[1], logloss: r.logloss, brier: r.brier }; });
  }

  /** One selection rule for BOTH models: a term is kept only when it lowers the held-out error by more
 *  than MARGIN relative to the model without it (1%). The same margin, held out, decides the size curve
 *  (error in dex) and the launch odds (log loss); no model gets its own threshold. */
  var MARGIN = 0.01;
  function fit(snap, verdicts) {
    var fams = tokenFamilies(snap), rows = rowsOf(fams), vs = variants(rows), i;
    var flat = looFlat(rows);
    vs.forEach(function (v) { var r = looV(rows, v); v.mae = r.mae; v.hit = r.hit; });
    // Forward selection by the one rule: keep a term only when it beats the current model by > MARGIN relative.
    var pick = vs[0];
    for (i = 1; i < vs.length; i++) if (vs[i].mae < pick.mae * (1 - MARGIN)) pick = vs[i];
    vs.forEach(function (v) { v.applied = v === pick; });
    // The range is the leave-one-out error quartiles: what a family the fit has not seen actually misses by.
    var errs = looErrors(rows, pick), spread = group(errs), cats = {};
    rows.forEach(function (r, j) { (cats[r.cat] = cats[r.cat] || []).push(errs[j]); });
    for (var c in cats) cats[c] = group(cats[c]);
    var w = lsq(rows, pick.feats);
    var insample = rows.map(function (r, j) { return r.y - dot(w, design(pick.feats, r)); });
    var comps = fams.map(function (p, j) {
      return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, records: p.records, tvl: p.tvl, mcap: p.mcap,
        multiple: r3(p.mcap / p.tvl), resid: r3(insample[j]), x: insample[j] };
    });
    var pts = oddsPoints(snap, verdicts), otests = oddsTests(pts), opick = otests[0];
    // Same one rule as the size curve: keep a term only when it beats the current model by > MARGIN relative.
    for (i = 1; i < otests.length; i++) if (otests[i].logloss < opick.logloss * (1 - MARGIN)) opick = otests[i];
    var oc = logitFit(pts, opick.feats), bins = [0, 1, 2, 3, 4, 5].map(function (b) {
      var q = pts.filter(function (p) { return p.a >= b && p.a < b + 1; });
      return { from: b, to: b + 1, n: q.length, share: r3(q.reduce(function (t, p) { return t + p.y; }, 0) / Math.max(1, q.length)) };
    });
    var cal = { inside: looInside(rows, pick), nominal: 0.5, size_mae: vs[0].mae, flat_mae: flat.mae,
      tvl1_mae: r3(rows.reduce(function (t, r) { return t + Math.abs(r.y - r.x); }, 0) / rows.length),
      odds_n: pts.length, odds_live: pts.filter(function (p) { return p.y; }).length,
      odds_logloss: opick.logloss, odds_flat_logloss: otests[0].logloss };
    return { as_of: snap.as_of, a: r3(w[0]), b: r3(w[1]), w: w, feats: pick.feats, ridge: pick.ridge || 0, cap: pick.cap || 0,
      cat: pick.cat, n: fams.length, tests: vs, loo_mae: pick.mae, spread: spread, cats: cats, secs: {}, comps: comps, cal: cal,
      odds: { c0: r3(oc[0]), c1: r3(oc[1] || 0), c2: r3(oc[2] || 0), c3: r3(oc[3] || 0), k: oc, feats: opick.feats, n: pts.length, tests: otests,
        pick: opick.name, bins: bins, logloss: opick.logloss, base_logloss: otests[1].logloss } };
  }

  /* ---------- 6. the implied value of one pre-token protocol ----------
     if launched:  10^(a + b·log10 TVL carried) x category premium
     launch odds: 1 - F(a) over the next year, from the fitted logistic on age, TVL and 7d growth
     implied:      if launched x odds x 0.3 per caution flag        <- ranked */
  var FLAG_ODDS = 0.3;
  function launchOdds(m, age, tvl, c7) {
    var o = m.odds, g = Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100);
    var at = function (a) { return oddsAt(o.k, { a: Math.min(6, a), lx: Math.log10(Math.max(1, tvl)), g: g }, o.feats); };
    var f = at(age); return clamp((at(age + 1) - f) / Math.max(1e-6, 1 - f), 0, 1);
  }
  /** The category premium of one protocol, from the fitted groups (n/(n+K) against zero). */
  function catOf(m, cat) {
    var own = m.cats[cat], wc = own ? own.n / (own.n + K) : 0;
    return { category: cat, sector: sectorOf(cat), n: own ? own.n : 0, w: r3(wc), median: own ? own.median : 0,
      sector_n: 0, w_sector: 0, sector_median: 0, premium: r3(wc * (own ? own.median : 0)) };
  }
  function value(m, p, flagCount) {
    var age = yearsOld(p.listed_at, m.as_of), ageUsed = age === null ? 2 : age, c7 = p.change_7d, carry = 1;
    if (m.cap) carry = clamp(Math.pow(10, Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100)), 1 / m.cap, m.cap);
    var cd = catOf(m, p.category || 'Uncategorised'), tvl = p.tvl_usd * carry;
    var curve = m.a + m.b * Math.log10(tvl) + (m.cat ? cd.premium : 0), ifl = Math.pow(10, curve);
    var odds0 = launchOdds(m, ageUsed, p.tvl_usd, c7), fm = Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var odds = clamp(odds0 * fm, 0, 0.995), base = Math.max(1, Math.round(ifl * odds));
    var lo = Math.max(1, Math.round(Math.pow(10, curve + m.spread.q25) * odds));
    var hi = Math.max(base, Math.round(Math.pow(10, curve + m.spread.q75) * odds));
    var parts = [['start', 50], ['TVL depth', Math.round(clamp(6 * (Math.log10(p.tvl_usd) - 7.7), -10, 20))],
      ['peer spread', Math.round(-25 * (m.spread.q75 - m.spread.q25 - 0.9))]];
    if (c7 === null) parts.push(['no 7d change', -8]); else if (Math.abs(c7) > 25) parts.push(['volatile TVL', -8]);
    if (age === null) parts.push(['no listing date: age taken as 2y', -8]); else if (age < 0.33) parts.push(['under 4 months old', -6]);
    if (flagCount > 0) parts.push([flagCount + ' caution flag' + (flagCount === 1 ? '' : 's'), -18 * flagCount]);
    var confidence = Math.round(clamp(parts.reduce(function (t, x) { return t + x[1]; }, 0), 5, 95));
    return { base: base, low: lo, high: hi, ifl: Math.round(ifl), odds: r3(odds), odds0: r3(odds0), odds_flag: r3(fm), multiple: r3(base / p.tvl_usd),
      confidence: confidence, parts: parts, age: age === null ? null : Math.round(age * 365), cat: cd,
      terms: { curve: r3(curve), log_tvl: r3(Math.log10(tvl)), carry: r3(carry), premium: r3(m.cat ? cd.premium : 0),
        odds_logit: r3(Math.log(odds0 / Math.max(1e-9, 1 - odds0))), age: ageUsed, c7: r3(Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100)) },
      drivers: ['launch odds ' + Math.round(odds * 100) + '% in 12 mo', c7 === null ? 'no 7d carry' : '7d TVL ' + (c7 >= 0 ? '+' : '') + c7.toFixed(1) + '%',
        m.cap ? '7d carry capped ×' + m.cap : m.ridge ? '7d growth shrunk ×' + m.ridge : m.feats.length > 1 ? m.feats.slice(1).join(' + ') : 'TVL only',
        m.cat ? 'category ' + (cd.premium >= 0 ? '+' : '') + Math.round((Math.pow(10, cd.premium) - 1) * 100) + '%' : 'no category term'],
      spread: { q25: r3(m.spread.q25), q75: r3(m.spread.q75) } };
  }

  /* ---------- 7. farm economics: net = users' share x value if launched x position / TVL x odds - gas - fees - T-bill ---------- */
  var USER_SHARE = 0.07, TBILL = 0.04;
  function farm(m, p, v, flagCount, position, weeks, costs) {
    var h = weeks / 52, ageUsed = v.age === null ? 2 : v.age / 365;
    var oddsH = launchOdds(m, ageUsed, p.tvl_usd, p.change_7d) * Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var slice = USER_SHARE * v.ifl * position / p.tvl_usd, tbill = TBILL * position * h;
    var expected = slice * oddsH, net = expected - costs - tbill;
    return { slice: Math.round(slice), odds: r3(Math.min(0.995, oddsH)), expected: Math.round(expected), tbill: Math.round(tbill),
      costs: costs, net: Math.round(net), breakeven: r3(slice > 0 ? (costs + tbill) / slice : 1) };
  }
  function priority(flagCount, confidence, c7, net, cost) {
    if (flagCount > 0 || confidence < 40 || net <= 0) return 'skip';
    if (confidence >= 55 && c7 > -12 && net >= Math.max(25, cost)) return 'farm now';
    return 'watch';
  }

  function short(n) { var a = Math.abs(n); return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)); }

  root.RadarModel = { K: K, USER_SHARE: USER_SHARE, TBILL: TBILL, FLAG_ODDS: FLAG_ODDS, SECTORS: SECTORS, sectorOf: sectorOf,
    classify: classify, fit: fit, value: value, farm: farm, priority: priority, short: short, launchOdds: launchOdds,
    yearsOld: yearsOld, tokenFamilies: tokenFamilies, catOf: catOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);