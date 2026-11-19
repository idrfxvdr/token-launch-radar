/* Token Launch Radar: the model, the single source of every number on the board. main.ts runs it in Node to
   write board.json; the page re-runs it on the raw snapshot in data.js and checks each value. No protocol is
   named: every rule reads the snapshot's own fields. Plain ES5, a classic script, no network. */
(function (root) {
  'use strict';
  var K = 4; // shrinkage: a group of n peers is weighted n / (n + K) against its parent
  var SECTORS = {
    Trading: ['Dexs', 'Derivatives', 'Options', 'Prediction Market', 'Interest Rate Derivatives', 'OTC Marketplace', 'Launchpad', 'NFT Marketplace', 'Perps'],
    Credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Dual-Token Stablecoin', 'Stablecoin Wrapper'],
    'Yield & vaults': ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Basis Trading', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes', 'Governance Incentives', 'Staking Pool'],
    'RWA & CeDeFi': ['RWA', 'CeDeFi', 'Payments', 'Crypto Card Issuer', 'Insurance', 'RWA Lending'],
    Infrastructure: ['Chain', 'Restaking', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Decentralized BTC', 'Privacy', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'CEX', 'DOR', 'Oracle']
  };
  function sectorOf(c) { for (var s in SECTORS) if (c !== null && SECTORS[s].indexOf(c) >= 0) return s; return 'Other'; }

  /* ---------- 1. classify: live token, pre-token candidate, or a product of a traded token ---------- */
  var DERIVATIVE_CATS = ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX', 'Anchor BTC'];
  // Exclusion only, never value: the exchange names of the house watchlist rule (an exchange's staked or wrapped product).
  var EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini', 'htx', 'kucoin', 'gate', 'mexc', 'crypto.com'];
  var DERIVATIVE_WORDS = /\b(wrapped|staked|staking|restaked|bridged|liquid staking)\b/i;
  var VERSION = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
  var GENERIC = ['the', 'liquid', 'finance', 'protocol', 'money', 'capital', 'labs', 'network', 'dao', 'swap', 'yield', 'vault', 'vaults', 'pool', 'pools', 'lend', 'earn', 'staking', 'bridge', 'exchange', 'markets', 'market', 'stable', 'usd', 'btc', 'eth', 'sol', 'open', 'base', 'one', 'pro', 'prime', 'core', 'x'];
  /** A name's family key: its first word, if 4+ letters and not generic ("Foo V4" and "Foo V3" share "foo"). */
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
      var lead = m.slice().sort(function (x, y) { return y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1); })[0], age = yearsOld(first, snap.as_of);
      out.push({ slug: lead.slug, name: lead.name, category: lead.category, symbol: lead.symbol || lead.gecko_id || '', tvl: tvl, mcap: mcap, records: m.length,
        f: { x: Math.log10(tvl), c7: lead.change_7d === null ? 0 : Math.log10(1 + Math.max(-90, lead.change_7d) / 100), age: age === null ? 2 : Math.min(5, age), ch: Math.log2(Object.keys(chains).length) } });
    });
    return out.sort(function (x, y) { return x.slug < y.slug ? -1 : 1; });
  }

  /* ---------- 3. the value curve, tested blind: a term is used only if it lowers the held-out error ---------- */
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function quantile(s, q) { if (!s.length) return 0; var at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at); return s[lo] + (s[hi] - s[lo]) * (at - lo); }
  function med(v) { return quantile(v.slice().sort(function (a, b) { return a - b; }), 0.5); }
  function group(v) { var s = v.slice().sort(function (a, b) { return a - b; }); return { n: s.length, median: quantile(s, 0.5), q25: quantile(s, 0.25), q75: quantile(s, 0.75) }; }
  /** Least squares of y on [1, ...feats] by the normal equations (Gaussian elimination, partial pivoting). */
  function lsq(rows, feats) {
    var k = feats.length + 1, A = [], b = [], i, j, r;
    for (i = 0; i < k; i++) { A.push([]); b.push(0); for (j = 0; j < k; j++) A[i].push(0); }
    rows.forEach(function (row) { var v = [1].concat(feats.map(function (f) { return row.f[f]; })); for (i = 0; i < k; i++) { b[i] += v[i] * row.y; for (j = 0; j < k; j++) A[i][j] += v[i] * v[j]; } });
    for (i = 0; i < k; i++) {
      var p = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      var t = A[i]; A[i] = A[p]; A[p] = t; t = b[i]; b[i] = b[p]; b[p] = t;
      for (r = i + 1; r < k; r++) { var q = A[r][i] / A[i][i]; for (j = i; j < k; j++) A[r][j] -= q * A[i][j]; b[r] -= q * b[i]; }
    }
    var w = []; for (i = k - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < k; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
    return w;
  }
  function predict(w, feats, f) { return feats.reduce(function (t, n, q) { return t + w[q + 1] * f[n]; }, w[0]); }
  /** Category premium of family i from the others' residuals: the category's median shrunk to its sector's, the sector's to zero. */
  function premium(rows, resid, cat, skip) {
    var sec = [], own = [];
    rows.forEach(function (r, j) { if (j === skip) return; if (sectorOf(r.category) === sectorOf(cat)) sec.push(resid[j]); if (r.category === cat) own.push(resid[j]); });
    var sp = sec.length ? sec.length / (sec.length + K) * med(sec) : 0;
    return own.length ? own.length / (own.length + K) * med(own) + K / (own.length + K) * sp : sp;
  }
  /** Leave each family out, refit on the rest, price it. Mean absolute error in dex (log10) per candidate model. */
  function termTests(rows) {
    var n = rows.length, tests = [['flat multiple', null], ['size curve', ['x']], ['+ 7d growth', ['x', 'c7']], ['+ listing age', ['x', 'age']], ['+ chain count', ['x', 'ch']], ['+ category premium', ['x'], true]];
    return tests.map(function (t) {
      var e = 0, hit = 0;
      for (var i = 0; i < n; i++) {
        var rest = rows.filter(function (_, j) { return j !== i; }), guess;
        if (!t[1]) guess = rows[i].f.x + med(rest.map(function (r) { return r.y - r.f.x; }));
        else {
          var w = lsq(rest, t[1]); guess = predict(w, t[1], rows[i].f);
          if (t[2]) guess += premium(rows, rows.map(function (r) { return r.y - predict(w, t[1], r.f); }), rows[i].category, i);
        }
        var err = Math.abs(rows[i].y - guess); e += err; if (err <= Math.log10(2)) hit++;
      }
      return { name: t[0], feats: t[1], cat: !!t[2], mae: r3(e / n), within_2x: r3(hit / n) };
    });
  }

  /* ---------- 4. launch odds: how the share of protocols with a token grows with age ----------
     F(a) = 1 / (1 + e^-(c0 + c1*a)), maximum likelihood over tokens and candidates (products of a traded token
     are left out). No token at age a: odds of a launch within h years = (F(a+h) - F(a)) / (1 - F(a)). */
  function fitOdds(snap, verdicts) {
    var pts = [];
    snap.protocols.forEach(function (p) { var a = yearsOld(p.listed_at, snap.as_of); if (a !== null && verdicts[p.slug].status !== 'excluded') pts.push([Math.min(6, a), verdicts[p.slug].status === 'live' ? 1 : 0]); });
    var c0 = 0, c1 = 0;
    for (var it = 0; it < 30; it++) { // Newton steps on the log-likelihood
      var g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
      pts.forEach(function (q) { var f = 1 / (1 + Math.exp(-(c0 + c1 * q[0]))), w = f * (1 - f); g0 += q[1] - f; g1 += (q[1] - f) * q[0]; h00 += w; h01 += w * q[0]; h11 += w * q[0] * q[0]; });
      var det = h00 * h11 - h01 * h01; c0 += (h11 * g0 - h01 * g1) / det; c1 += (h00 * g1 - h01 * g0) / det;
    }
    var bins = [[0, 1], [1, 2], [2, 3], [3, 6]].map(function (b) { var s = pts.filter(function (q) { return q[0] >= b[0] && q[0] < b[1]; }); return { from: b[0], to: b[1], n: s.length, share: r3(s.reduce(function (t, q) { return t + q[1]; }, 0) / Math.max(1, s.length)) }; });
    return { c0: r3(c0), c1: r3(c1), n: pts.length, bins: bins, k0: c0, k1: c1 };
  }
  function share(o, a) { return 1 / (1 + Math.exp(-(o.k0 + o.k1 * Math.min(6, a)))); }
  function launchOdds(o, a, h) { var f = share(o, a); return (share(o, a + h) - f) / (1 - f); }

  function fit(snap, verdicts) {
    var fams = tokenFamilies(snap), rows = fams.map(function (p) { return { y: Math.log10(p.mcap), f: p.f, category: p.category }; });
    var tests = termTests(rows), size = tests[1].mae;
    // A term is kept only when its held-out error beats the size curve's; the category premium likewise.
    var feats = ['x'];
    tests.slice(2, 5).forEach(function (t) { if (t.mae < size) feats.push(t.feats[1]); });
    var useCat = tests[5].mae < size, w = lsq(rows, feats);
    var resid = rows.map(function (r) { return r.y - predict(w, feats, r.f); }), cats = {}, secs = {};
    var comps = fams.map(function (p, i) {
      var c = p.category || 'Uncategorised', s = sectorOf(p.category);
      (cats[c] = cats[c] || []).push(resid[i]); (secs[s] = secs[s] || []).push(resid[i]);
      return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, records: p.records, tvl: p.tvl, mcap: p.mcap, multiple: r3(p.mcap / p.tvl), resid: r3(resid[i]) };
    });
    for (var c in cats) cats[c] = group(cats[c]);
    for (var s in secs) secs[s] = group(secs[s]);
    return { as_of: snap.as_of, w: w, feats: feats, useCat: useCat, a: r3(w[0]), b: r3(w[1]), n: fams.length, tests: tests, loo_mae: useCat ? tests[5].mae : size,
      global: group(resid), cats: cats, sectors: secs, comps: comps, odds: fitOdds(snap, verdicts) };
  }
  function shrink(own, parent) {
    var n = own ? own.n : 0, w = n / (n + K);
    function mix(k) { return w * (own ? own[k] : 0) + (1 - w) * parent[k]; }
    return { n: n, w: w, median: mix('median'), q25: mix('q25'), q75: mix('q75') };
  }

  /* ---------- 5. the implied value of one pre-token protocol ----------
     if launched:  log10 V = curve(TVL carried one more week at its 7d rate) + category premium
     implied:      V x launch odds in the next 12 months (fitted on age; x 0.3 per caution flag)  <- ranked */
  var FLAG_ODDS = 0.3;
  function value(m, p, flagCount) {
    var sector = sectorOf(p.category);
    var sec = shrink(m.sectors[sector], { median: 0, q25: m.global.q25, q75: m.global.q75 });
    var cat = shrink(m.cats[p.category || 'Uncategorised'], sec);
    var c7 = p.change_7d, carry = c7 === null ? 1 : Math.max(0.5, Math.min(1.5, 1 + c7 / 100));
    var age = yearsOld(p.listed_at, m.as_of), ageUsed = age === null ? 2 : age;
    var f = { x: Math.log10(p.tvl_usd * carry), c7: c7 === null ? 0 : Math.log10(carry), age: Math.min(5, ageUsed), ch: Math.log2(Math.max(1, p.chains.length)) };
    var curve = predict(m.w, m.feats, f), prem = m.useCat ? cat.median : 0, logV = curve + prem;
    var odds = launchOdds(m.odds, ageUsed, 1) * Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var ifl = Math.pow(10, logV);
    var base = Math.max(1, Math.round(ifl * odds));
    var low = Math.max(1, Math.round(Math.pow(10, logV + cat.q25 - cat.median) * odds)), high = Math.max(base, Math.round(Math.pow(10, logV + cat.q75 - cat.median) * odds));
    var parts = [['start', 50], [cat.n + ' category peer' + (cat.n === 1 ? '' : 's'), Math.min(20, 4 * cat.n)], ['peer spread', Math.round(-25 * (cat.q75 - cat.q25 - 0.9))], ['TVL depth', Math.round(6 * (Math.log10(p.tvl_usd) - 7.7))]];
    if (c7 === null) parts.push(['no 7d change', -8]); else if (Math.abs(c7) > 25) parts.push(['volatile TVL', -8]);
    if (age === null) parts.push(['no listing date: age taken as 2y', -8]); else if (age < 0.33) parts.push(['under 4 months old', -6]);
    if (flagCount > 0) parts.push([flagCount + ' caution flag' + (flagCount === 1 ? '' : 's'), -18 * flagCount]);
    var confidence = Math.max(5, Math.min(95, parts.reduce(function (t, x) { return t + x[1]; }, 0)));
    var own = m.cats[p.category || 'Uncategorised'], ownSec = m.sectors[sector];
    return { base: base, low: low, high: high, ifl: Math.round(ifl), odds: r3(odds), carry: r3(carry), multiple: r3(base / p.tvl_usd), confidence: confidence, parts: parts, age: age === null ? null : Math.round(age * 365),
      terms: { curve: r3(curve), cat: r3(prem), carry: r3(Math.log10(carry) * m.w[1]), odds: r3(Math.log10(odds)) },
      drivers: [(p.category || 'uncategorised') + ' premium ' + (prem >= 0 ? '+' : '-') + Math.round(Math.abs(Math.pow(10, prem) - 1) * 100) + '%', 'launch odds ' + Math.round(odds * 100) + '% in 12 mo', c7 === null ? 'no 7d carry' : '7d carry x' + carry.toFixed(2)],
      cat_detail: { category_n: cat.n, category_median: r3(own ? own.median : 0), sector: sector, sector_n: sec.n, sector_median: r3(ownSec ? ownSec.median : 0), w_cat: r3(cat.w), w_sector: r3(sec.w) },
      spread: { q25: r3(cat.q25 - cat.median), q75: r3(cat.q75 - cat.median) } };
  }

  /* ---------- 6. farm economics: is a position worth its costs? ----------
     slice = users' share x value-if-launched x position / TVL;  expected = slice x odds of a launch within 12
     months (points earned while held still count when the token comes after the hold);  net = expected - gas
     and fees - the T-bill yield the position gives up while it is held. */
  var USER_SHARE = 0.07, TBILL = 0.04;
  function farm(m, p, v, flagCount, position, weeks, costs) {
    var h = weeks / 52, ageUsed = v.age === null ? 2 : v.age / 365;
    var oddsH = launchOdds(m.odds, ageUsed, 1) * Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var slice = USER_SHARE * v.ifl * position / p.tvl_usd, tbill = TBILL * position * h;
    var expected = slice * oddsH, net = expected - costs - tbill;
    return { slice: Math.round(slice), odds: r3(oddsH), expected: Math.round(expected), tbill: Math.round(tbill), costs: costs, net: Math.round(net), breakeven: r3(slice > 0 ? (costs + tbill) / slice : 1) };
  }
  function priority(flagCount, confidence, c7, net, cost) {
    if (flagCount > 0 || confidence < 40 || net <= 0) return 'skip';
    if (confidence >= 55 && c7 > -12 && net >= Math.max(25, cost)) return 'farm now';
    return 'watch';
  }

  function short(n) { var a = Math.abs(n); return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)); }

  root.RadarModel = { K: K, USER_SHARE: USER_SHARE, TBILL: TBILL, FLAG_ODDS: FLAG_ODDS, SECTORS: SECTORS, sectorOf: sectorOf, classify: classify, fit: fit, value: value, farm: farm, priority: priority, short: short };
})(typeof globalThis !== 'undefined' ? globalThis : this);
