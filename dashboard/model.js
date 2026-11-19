/* Token Launch Radar: the model. The single source of every number on the board.
   main.ts runs this file in Node to write board.json; the page runs it again in the browser on the raw
   snapshot rows in data.js and checks that each implied value comes out the same. Nothing here names a
   protocol: every rule reads the snapshot's own fields (name, category, chains, TVL, 7d change, market cap,
   listing date, symbol). Plain ES5 so it runs as a classic script from file:// with no network. */
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

  /* ---------- 2. comparables: one per traded token, TVL summed over its records ---------- */
  function tokenFamilies(protocols) {
    var fams = {}, keys = [];
    protocols.forEach(function (p) {
      var k = p.symbol !== null ? 'sym:' + p.symbol.toUpperCase() : p.gecko_id;
      if (k === null) return;
      if (!fams[k]) { fams[k] = []; keys.push(k); }
      fams[k].push(p);
    });
    var out = [];
    keys.forEach(function (k) {
      var m = fams[k], mcap = 0, tvl = 0;
      m.forEach(function (p) { mcap = Math.max(mcap, p.mcap_usd || 0); tvl += p.tvl_usd; });
      if (mcap <= 0 || tvl <= 0) return;
      var lead = m.slice().sort(function (x, y) { return y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1); })[0];
      out.push({ slug: lead.slug, name: lead.name, category: lead.category, symbol: lead.symbol || lead.gecko_id || '', tvl: tvl, mcap: mcap, records: m.length });
    });
    return out.sort(function (x, y) { return x.slug < y.slug ? -1 : 1; });
  }

  /* ---------- 3. the size curve and the category premiums ---------- */
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function quantile(s, q) { if (!s.length) return 0; var at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at); return s[lo] + (s[hi] - s[lo]) * (at - lo); }
  function group(v) { var s = v.slice().sort(function (a, b) { return a - b; }); return { n: s.length, median: quantile(s, 0.5), q25: quantile(s, 0.25), q75: quantile(s, 0.75) }; }
  function ols(xs, ys) {
    var n = xs.length, mx = 0, my = 0, sxy = 0, sxx = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i] / n; my += ys[i] / n; }
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var b = sxy / sxx; return { a: my - b * mx, b: b };
  }
  /** Leave one family out, refit on the rest, price it: mean absolute error (dex) of three predictors. */
  function backtest(peers, xs, ys) {
    var flat = 0, size = 0, full = 0, hit = 0, n = peers.length;
    function med(v) { return quantile(v.slice().sort(function (a, b) { return a - b; }), 0.5); }
    for (var i = 0; i < n; i++) {
      var keep = []; for (var j = 0; j < n; j++) if (j !== i) keep.push(j);
      flat += Math.abs(ys[i] - (xs[i] + med(keep.map(function (j) { return ys[j] - xs[j]; }))));
      var f = ols(keep.map(function (j) { return xs[j]; }), keep.map(function (j) { return ys[j]; })), curve = f.a + f.b * xs[i];
      size += Math.abs(ys[i] - curve);
      var sec = [], cat = [];
      keep.forEach(function (j) { var e = ys[j] - (f.a + f.b * xs[j]); if (sectorOf(peers[j].category) === sectorOf(peers[i].category)) sec.push(e); if (peers[j].category === peers[i].category) cat.push(e); });
      var sp = sec.length ? sec.length / (sec.length + K) * med(sec) : 0;
      var cp = cat.length ? cat.length / (cat.length + K) * med(cat) + K / (cat.length + K) * sp : sp;
      var err = Math.abs(ys[i] - (curve + cp)); full += err; if (err <= Math.log10(2)) hit++;
    }
    return { n: n, flat: r3(flat / n), size: r3(size / n), full: r3(full / n), within_2x: r3(hit / n) };
  }
  function fit(snap) {
    var peers = tokenFamilies(snap.protocols);
    var xs = peers.map(function (p) { return Math.log10(p.tvl); }), ys = peers.map(function (p) { return Math.log10(p.mcap); });
    var f = ols(xs, ys), resid = ys.map(function (y, i) { return y - (f.a + f.b * xs[i]); });
    var bt = backtest(peers, xs, ys), cats = {}, secs = {};
    var comps = peers.map(function (p, i) {
      var c = p.category || 'Uncategorised', s = sectorOf(p.category);
      (cats[c] = cats[c] || []).push(resid[i]); (secs[s] = secs[s] || []).push(resid[i]);
      return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, records: p.records, tvl: p.tvl, mcap: p.mcap, multiple: r3(p.mcap / p.tvl), resid: r3(resid[i]) };
    });
    for (var c in cats) cats[c] = group(cats[c]);
    for (var s in secs) secs[s] = group(secs[s]);
    var sd = Math.sqrt(resid.reduce(function (t, e) { return t + e * e; }, 0) / (peers.length - 2));
    return { as_of: snap.as_of, a: r3(f.a), b: r3(f.b), fa: f.a, fb: f.b, n: peers.length, resid_sd: r3(sd), loo_mae: bt.full, backtest: bt, global: group(resid), cats: cats, sectors: secs, comps: comps };
  }
  function shrink(own, parent) {
    var n = own ? own.n : 0, w = n / (n + K);
    function mix(k) { return w * (own ? own[k] : 0) + (1 - w) * parent[k]; }
    return { n: n, w: w, median: mix('median'), q25: mix('q25'), q75: mix('q75') };
  }
  function days(from, to) { return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000); }

  /* ---------- 4. the implied launch value of one pre-token protocol ----------
     log10 V = a + b*log10(TVL) + category premium + momentum + seasoning + chains + flags */
  function value(m, p, flagCount) {
    var sector = sectorOf(p.category);
    var sec = shrink(m.sectors[sector], { median: 0, q25: m.global.q25, q75: m.global.q75 });
    var cat = shrink(m.cats[p.category || 'Uncategorised'], sec);
    var size = m.fa + m.fb * Math.log10(p.tvl_usd), c7 = p.change_7d;
    var momentum = c7 === null ? 0 : Math.max(-0.15, Math.min(0.15, 2 * Math.log10(1 + Math.max(-90, c7) / 100)));
    var age = p.listed_at === null ? null : days(p.listed_at, m.as_of);
    var season = age === null ? 0 : 0.08 * Math.min(age / 365, 2) - 0.05;          // time with no token
    var chains = Math.min(0.15, 0.04 * Math.log2(Math.max(1, p.chains.length)));
    var flags = -0.3 * Math.min(2, flagCount);
    var logV = size + cat.median + momentum + season + chains + flags;
    var base = Math.max(1, Math.round(Math.pow(10, logV)));
    var low = Math.max(1, Math.round(Math.pow(10, logV + cat.q25 - cat.median)));
    var high = Math.max(base, Math.round(Math.pow(10, logV + cat.q75 - cat.median)));
    var parts = [['start', 50], [cat.n + ' category peer' + (cat.n === 1 ? '' : 's'), Math.min(20, 4 * cat.n)], ['peer spread', Math.round(-25 * (cat.q75 - cat.q25 - 0.9))], ['TVL depth', Math.round(6 * (Math.log10(p.tvl_usd) - 7.7))]];
    if (c7 === null) parts.push(['no 7d change', -8]); else if (Math.abs(c7) > 25) parts.push(['volatile TVL', -8]);
    if (age === null) parts.push(['no listing date', -8]); else if (age < 120) parts.push(['under 4 months old', -6]);
    if (flagCount > 0) parts.push([flagCount + ' caution flag' + (flagCount === 1 ? '' : 's'), -18 * flagCount]);
    var confidence = Math.max(5, Math.min(95, parts.reduce(function (t, x) { return t + x[1]; }, 0)));
    var terms = { size: r3(size), cat: r3(cat.median), momentum: r3(momentum), season: r3(season), chains: r3(chains), flags: r3(flags) };
    var named = [[(p.category || 'uncategorised') + ' premium', terms.cat], [c7 === null ? 'no 7d trend' : '7d TVL ' + (c7 >= 0 ? '+' : '') + c7.toFixed(1) + '%', terms.momentum],
      [age === null ? 'age unknown' : (age / 365).toFixed(1) + 'y with no token', terms.season], [p.chains.length + ' chain' + (p.chains.length === 1 ? '' : 's'), terms.chains], ['caution flags', terms.flags]];
    var drivers = named.filter(function (d) { return Math.abs(d[1]) >= 0.02; }).sort(function (x, y) { return Math.abs(y[1]) - Math.abs(x[1]) || (x[0] < y[0] ? -1 : 1); })
      .slice(0, 3).map(function (d) { return d[0] + ' ' + (d[1] >= 0 ? '+' : '-') + Math.round(Math.abs(Math.pow(10, d[1]) - 1) * 100) + '%'; });
    var own = m.cats[p.category || 'Uncategorised'], ownSec = m.sectors[sector];
    return { base: base, low: low, high: high, multiple: r3(base / p.tvl_usd), confidence: confidence, terms: terms, parts: parts, drivers: drivers, age: age,
      cat_detail: { category_n: cat.n, category_median: r3(own ? own.median : 0), sector: sector, sector_n: sec.n, sector_median: r3(ownSec ? ownSec.median : 0), w_cat: r3(cat.w), w_sector: r3(sec.w) },
      spread: { q25: r3(cat.q25 - cat.median), q75: r3(cat.q75 - cat.median) } };
  }

  /* ---------- 5. farm priority from the plan's dollars ---------- */
  function priority(flagCount, confidence, c7, net, cost) {
    if (flagCount > 0) return 'skip';
    if (confidence < 40 || net <= 0) return 'skip';
    if (confidence >= 55 && c7 > -12 && net >= Math.max(50, 2 * cost)) return 'farm now';
    return 'watch';
  }

  function short(n) { var a = Math.abs(n); return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)); }

  root.RadarModel = { K: K, SECTORS: SECTORS, sectorOf: sectorOf, familyKey: familyKey, classify: classify, tokenFamilies: tokenFamilies, fit: fit, value: value, priority: priority, short: short };
})(typeof globalThis !== 'undefined' ? globalThis : this);
