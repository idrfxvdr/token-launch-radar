/* Token Launch Radar — the model. Every number on the board comes from here; main.ts runs this file under
   Node to emit board.json and the browser runs the same file on the raw snapshot (checks.js). Plain ES5. */
(function (root) {
  'use strict';

  var SHRINK = 4;

  var SECTOR_MAP = {
    Trading: 'Dexs Derivatives Options Prediction Market Interest Rate Derivatives OTC Marketplace Launchpad NFT Marketplace Perps',
    Credit: 'Lending CDP CDP Manager Uncollateralized Lending Collateral Markets Collateral Management Dual-Token Stablecoin Stablecoin Wrapper',
    'Yield & vaults': 'Yield Yield Aggregator Risk Curators Onchain Capital Allocator Basis Trading Liquidity Manager Leveraged Farming Farm Indexes Governance Incentives Staking Pool',
    'RWA & CeDeFi': 'RWA CeDeFi Payments Crypto Card Issuer Insurance RWA Lending',
    Infrastructure: 'Chain Restaking Cross Chain Bridge Bridge Canonical Bridge Decentralized BTC Privacy AI Agents Decentralized AI Token Locker Liquid Staking Liquid Restaking Restaked BTC Anchor BTC CEX DOR Oracle'
  };
  Object.keys(SECTOR_MAP).forEach(function (name) { SECTOR_MAP[name] = SECTOR_MAP[name].split(' '); });

  function sectorFor(category) {
    for (var sector in SECTOR_MAP) if (category !== null && SECTOR_MAP[sector].indexOf(category) >= 0) return sector;
    return 'Other';
  }

  var DERIVATIVE_CATEGORIES = ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX', 'Anchor BTC'];
  var EXCHANGE_NAMES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini', 'htx', 'kucoin', 'gate', 'mexc', 'crypto.com'];
  var DERIVATIVE_WORDS = /\b(wrapped|staked|staking|restaked|bridged|liquid staking)\b/i;
  var VERSION_SUFFIX = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
  var GENERIC_WORDS = 'the liquid finance protocol money capital labs network dao swap yield vault vaults pool pools lend earn staking bridge exchange markets market stable usd btc eth sol open base one pro prime core x';
  GENERIC_WORDS = GENERIC_WORDS.split(' ');

  function familyKeyOf(name) {
    var first = name.toLowerCase().replace(VERSION_SUFFIX, '').split(/[\s\-_.:()/]+/).filter(function (w) { return w; })[0] || '';
    var word = first.replace(/[^a-z0-9]/g, '');
    return word.length >= 4 && GENERIC_WORDS.indexOf(word) < 0 ? word : null;
  }
  function recordsToken(p) { return p.gecko_id !== null || p.symbol !== null; }

  function classifyRecords(snap) {
    var tokenByFamily = {}, house = {}, verdict = {};
    snap.watchlist.forEach(function (slug) { house[slug] = 1; });
    snap.protocols.forEach(function (p) {
      var key = familyKeyOf(p.name);
      if (key && recordsToken(p) && !tokenByFamily[key]) tokenByFamily[key] = p.symbol || p.gecko_id;
    });
    snap.protocols.forEach(function (p) {
      if (recordsToken(p)) {
        verdict[p.slug] = { status: 'live', reason: 'Records the token ' + (p.symbol || p.gecko_id) + ': already launched, used as a comparable.', flags: [] };
        return;
      }
      var lower = p.name.toLowerCase(), key = familyKeyOf(p.name), family = key && tokenByFamily[key], flags = [];
      var derivativeReason =
        DERIVATIVE_CATEGORIES.indexOf(p.category) >= 0 ? p.category + ' record: a wrapped, staked, bridged or custodial form of an asset that already trades.'
        : EXCHANGE_NAMES.some(function (e) { return lower.indexOf(e) === 0; }) ? 'Named after a centralised exchange: an exchange product, not a protocol waiting on a token.'
        : DERIVATIVE_WORDS.test(p.name) ? 'Its name marks it as a wrapped or staked product of an existing asset.'
        : family ? 'Shares its name with a protocol that already trades ' + family + ': a version or deployment of that token\'s protocol.'
        : VERSION_SUFFIX.test(p.name) ? 'A versioned deployment (its name ends in a version marker) of an older protocol.' : null;
      var chainMatch = key && p.chains.filter(function (c) { return c.toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(key) === 0; })[0];
      if (chainMatch) flags.push('chain-native: named after the chain it runs on (' + chainMatch + '), whose gas token already trades');
      if (p.category === 'Chain') flags.push('a chain: its value accrues to the chain\'s gas token, not an app airdrop');
      if (p.category === 'Stablecoin Wrapper' || /^usd|usd$|\busd\w*\b/i.test(p.name)) flags.push('stablecoin issuer: the record is the stablecoin itself, which is not a launch token');
      if (derivativeReason && !house[p.slug]) { verdict[p.slug] = { status: 'excluded', reason: derivativeReason, flags: flags }; return; }
      if (derivativeReason) flags.push(derivativeReason);
      verdict[p.slug] = {
        status: 'candidate', flags: flags,
        reason: house[p.slug]
          ? 'On the house watchlist: $' + compactUsd(p.tvl_usd) + ' TVL at or above the $' + compactUsd(snap.floor_usd) + ' floor, no token recorded, and no wrapped, staked or bridged marker.'
          : 'Below the watchlist floor or outside it, but records no token and passes the radar\'s own product filter: an early candidate.'
      };
    });
    return verdict;
  }

  function ageInYears(listedAt, asOf) {
    return listedAt === null ? null : (Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 864e5 / 365;
  }
  function collectFamilies(snap) {
    var buckets = {}, order = [];
    snap.protocols.forEach(function (p) {
      var key = p.symbol !== null ? 'sym:' + p.symbol.toUpperCase() : p.gecko_id;
      if (key === null) return;
      if (!buckets[key]) { buckets[key] = []; order.push(key); }
      buckets[key].push(p);
    });
    var families = [];
    order.forEach(function (key) {
      var members = buckets[key], mcap = 0, tvl = 0, chains = {}, firstListed = null;
      members.forEach(function (p) {
        mcap = Math.max(mcap, p.mcap_usd || 0);
        tvl += p.tvl_usd;
        p.chains.forEach(function (c) { chains[c] = 1; });
        if (p.listed_at && (!firstListed || p.listed_at < firstListed)) firstListed = p.listed_at;
      });
      if (mcap <= 0 || tvl <= 0) return;
      var lead = members.slice().sort(function (x, y) { return y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1); })[0];
      families.push({
        slug: lead.slug, name: lead.name, category: lead.category, symbol: lead.symbol || lead.gecko_id || '',
        tvl: tvl, mcap: mcap, records: members.length, c7: lead.change_7d,
        chains: Object.keys(chains).length, age: ageInYears(firstListed, snap.as_of)
      });
    });
    return families.sort(function (x, y) { return x.slug < y.slug ? -1 : 1; });
  }

  function round3(x) { return Math.round(x * 1000) / 1000; }
  function percentile(sortedInput, q) {
    var s = sortedInput.slice().sort(function (a, b) { return a - b; });
    if (!s.length) return 0;
    var at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return s[lo] + (s[hi] - s[lo]) * (at - lo);
  }
  function medianOf(v) { return percentile(v, 0.5); }
  function summarise(v) { return { n: v.length, median: percentile(v, 0.5), q25: percentile(v, 0.25), q75: percentile(v, 0.75) }; }

  function solveLeastSquares(rows, feats) {
    var k = feats.length + 1, A = [], b = [], i, j, r;
    for (i = 0; i < k; i++) { A.push([]); b.push(0); for (j = 0; j < k; j++) A[i].push(0); }
    rows.forEach(function (row) {
      var v = [1].concat(feats.map(function (f) { return row[f]; }));
      for (i = 0; i < k; i++) { b[i] += v[i] * row.y; for (j = 0; j < k; j++) A[i][j] += v[i] * v[j]; }
    });
    for (i = 0; i < k; i++) {
      var pivot = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
      var tmp = A[i]; A[i] = A[pivot]; A[pivot] = tmp; tmp = b[i]; b[i] = b[pivot]; b[pivot] = tmp;
      for (r = i + 1; r < k; r++) { var factor = A[r][i] / A[i][i]; for (j = i; j < k; j++) A[r][j] -= factor * A[i][j]; b[r] -= factor * b[i]; }
    }
    var weights = []; for (i = k - 1; i >= 0; i--) { var acc = b[i]; for (j = i + 1; j < k; j++) acc -= A[i][j] * weights[j]; weights[i] = acc / A[i][i]; }
    return weights;
  }
  function innerProduct(w, v) { return w.reduce(function (t, x, i) { return t + x * v[i]; }, 0); }
  function featureRow(feats, r) { return [1].concat(feats.map(function (f) { return r[f]; })); }

  function familyRows(fams) {
    return fams.map(function (p) {
      return { y: Math.log10(p.mcap), x: Math.log10(p.tvl), c7: Math.log10(1 + Math.max(-90, p.c7 === null ? 0 : p.c7) / 100), age: p.age === null ? 2 : p.age, cat: p.category || 'Uncategorised' };
    });
  }
  function makeVariant(name, feats, extra) {
    var v = { name: name, feats: feats, cap: 0, ridge: 0, cat: false, applied: false };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  }
  function clampTo(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function predictVariant(rows, rest, i, v) {
    var w = solveLeastSquares(rest, v.feats), r = rows[i], x = r.x;
    if (v.cap) x = Math.log10(Math.pow(10, r.x) * clampTo(Math.pow(10, r.c7), 1 / v.cap, v.cap));
    var g = innerProduct(w, featureRow(v.feats, { x: x, c7: r.c7, age: r.age }));
    if (v.ridge) g += w[2] * (v.ridge - 1) * r.c7;
    if (v.cat) g += categoryOffset(rest, w, v.feats, r.cat);
    return g;
  }
  function categoryOffset(rows, w, feats, cat) {
    var own = [];
    rows.forEach(function (r) { if (r.cat === cat) own.push(r.y - innerProduct(w, featureRow(feats, r))); });
    return own.length ? own.length / (own.length + SHRINK) * medianOf(own) : 0;
  }
  function heldOutErrors(rows, v) {
    var errs = [], n = rows.length;
    for (var i = 0; i < n; i++) errs.push(rows[i].y - predictVariant(rows, rows.filter(function (_, j) { return j !== i; }), i, v));
    return errs;
  }
  function scoreVariant(rows, v) {
    var errs = heldOutErrors(rows, v), e = 0, hit = 0;
    errs.forEach(function (x) { e += Math.abs(x); if (Math.abs(x) <= Math.log10(2)) hit++; });
    return { mae: round3(e / errs.length), hit: round3(hit / errs.length) };
  }
  function coverageScore(rows, v) {
    var errs = heldOutErrors(rows, v), inside = 0;
    for (var i = 0; i < errs.length; i++) {
      var others = errs.filter(function (_, j) { return j !== i; });
      if (errs[i] >= percentile(others, 0.25) && errs[i] <= percentile(others, 0.75)) inside++;
    }
    return round3(inside / errs.length);
  }
  function flatBaseline(rows) {
    var e = 0, hit = 0, n = rows.length;
    for (var i = 0; i < n; i++) {
      var rest = rows.filter(function (_, j) { return j !== i; });
      var m = medianOf(rest.map(function (r) { return r.y - r.x; })), err = rows[i].y - (rows[i].x + m);
      e += Math.abs(err); if (Math.abs(err) <= Math.log10(2)) hit++;
    }
    return { mae: round3(e / n), hit: round3(hit / n) };
  }
  function chooseRidge(rows) {
    var grid = [0, 0.5, 1], best = 0, bestE = Infinity;
    grid.forEach(function (s) {
      var e = 0, folds = 5, n = rows.length;
      for (var f = 0; f < folds; f++) {
        var test = [], train = [];
        rows.forEach(function (r, j) { (j % folds === f ? test : train).push(r); });
        var w = solveLeastSquares(train, ['x', 'c7']);
        test.forEach(function (r) { e += Math.abs(r.y - (w[0] + w[1] * r.x + w[2] * s * r.c7)); });
      }
      e /= n;
      if (e < bestE - 1e-9) { bestE = e; best = s; }
    });
    return best;
  }
  function candidateVariants(rows) {
    var s = chooseRidge(rows);
    return [
      makeVariant('TVL only', ['x']),
      makeVariant('+ 7d growth, fitted', ['x', 'c7']),
      makeVariant('+ 7d growth, ridge ' + s + ' (nested CV)', ['x', 'c7'], { ridge: s }),
      makeVariant('+ 7d carry capped ×1.2', ['x'], { cap: 1.2 }),
      makeVariant('+ 7d carry capped ×1.5', ['x'], { cap: 1.5 }),
      makeVariant('+ time without a token', ['x', 'age']),
      makeVariant('+ category premium', ['x'], { cat: true })
    ];
  }

  var ODDS_FEATURES = ['a', 'lx', 'g'];

  function fitLogit(pts, feats) {
    var k = feats.length + 1, c = new Array(k).fill(0), it, i, j, r;
    for (it = 0; it < 25; it++) {
      var H = [], g = [], move = 0;
      for (i = 0; i < k; i++) { H.push([]); g.push(0); for (j = 0; j < k; j++) H[i].push(0); }
      pts.forEach(function (p) {
        var v = featureRow(feats, p), z = innerProduct(c, v), pr = 1 / (1 + Math.exp(-z)), w = Math.max(pr * (1 - pr), 1e-9);
        for (i = 0; i < k; i++) { g[i] += v[i] * (p.y - pr); for (j = 0; j < k; j++) H[i][j] += w * v[i] * v[j]; }
      });
      var A = H.map(function (row, i2) { return row.concat([g[i2]]); });
      for (i = 0; i < k; i++) A[i][i] += 1e-2;
      for (i = 0; i < k; i++) {
        var pivot = i; for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
        var tmp = A[i]; A[i] = A[pivot]; A[pivot] = tmp;
        for (r = i + 1; r < k; r++) { var factor = A[r][i] / A[i][i]; for (j = i; j <= k; j++) A[r][j] -= factor * A[i][j]; }
      }
      var d = new Array(k); for (i = k - 1; i >= 0; i--) { var acc = A[i][k]; for (j = i + 1; j < k; j++) acc -= A[i][j] * d[j]; d[i] = acc / A[i][i]; }
      for (i = 0; i < k; i++) { c[i] += d[i]; move = Math.max(move, Math.abs(d[i])); }
      if (move < 1e-7) break;
    }
    return c;
  }
  function sigmoidAt(c, p, feats) { return 1 / (1 + Math.exp(-innerProduct(c, featureRow(feats, p)))); }
  function buildOddsPoints(snap, verdicts) {
    var pts = [];
    snap.protocols.forEach(function (p) {
      var a = ageInYears(p.listed_at, snap.as_of); if (a === null || verdicts[p.slug].status === 'excluded') return;
      pts.push({
        slug: p.slug, y: verdicts[p.slug].status === 'live' ? 1 : 0, a: Math.min(6, a), lx: Math.log10(Math.max(1, p.tvl_usd)),
        g: Math.log10(1 + Math.max(-90, p.change_7d === null ? 0 : p.change_7d) / 100), tvl: p.tvl_usd
      });
    });
    return pts;
  }
  function scoreOdds(pts, feats) {
    var ll = 0, br = 0, n = pts.length;
    pts.forEach(function (_, i) {
      var c = fitLogit(pts.filter(function (__, j) { return j !== i; }), feats);
      var pr = clampTo(sigmoidAt(c, pts[i], feats), 0.001, 0.999);
      ll += pts[i].y ? Math.log(pr) : Math.log(1 - pr); br += Math.pow(pr - pts[i].y, 2);
    });
    return { logloss: round3(-ll / Math.max(1, n)), brier: round3(br / Math.max(1, n)) };
  }
  function candidateOdds(pts) {
    return [['constant (no age)', []], ['age', ['a']], ['age + TVL', ['a', 'lx']], ['age + 7d growth', ['a', 'g']], ['age + TVL + 7d growth', ['a', 'lx', 'g']]]
      .map(function (t) { var r = scoreOdds(pts, t[1]); return { name: t[0], feats: t[1], logloss: r.logloss, brier: r.brier }; });
  }

  var MARGIN = 0.01;

  function fitModel(snap, verdicts) {
    var fams = collectFamilies(snap), rows = familyRows(fams), vs = candidateVariants(rows), i;
    var flat = flatBaseline(rows);
    vs.forEach(function (v) { var r = scoreVariant(rows, v); v.mae = r.mae; v.hit = r.hit; });
    var pick = vs[0];
    for (i = 1; i < vs.length; i++) if (vs[i].mae < pick.mae * (1 - MARGIN)) pick = vs[i];
    vs.forEach(function (v) { v.applied = v === pick; });
    var errs = heldOutErrors(rows, pick), spread = summarise(errs), cats = {};
    rows.forEach(function (r, j) { (cats[r.cat] = cats[r.cat] || []).push(errs[j]); });
    for (var c in cats) cats[c] = summarise(cats[c]);
    var w = solveLeastSquares(rows, pick.feats);
    var insample = rows.map(function (r, j) { return r.y - innerProduct(w, featureRow(pick.feats, r)); });
    var comps = fams.map(function (p, j) {
      return {
        slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, records: p.records, tvl: p.tvl, mcap: p.mcap,
        multiple: round3(p.mcap / p.tvl), resid: round3(insample[j]), x: insample[j]
      };
    });
    var pts = buildOddsPoints(snap, verdicts), otests = candidateOdds(pts), opick = otests[0];
    for (i = 1; i < otests.length; i++) if (otests[i].logloss < opick.logloss * (1 - MARGIN)) opick = otests[i];
    var oc = fitLogit(pts, opick.feats), bins = [0, 1, 2, 3, 4, 5].map(function (b) {
      var q = pts.filter(function (p) { return p.a >= b && p.a < b + 1; });
      return { from: b, to: b + 1, n: q.length, share: round3(q.reduce(function (t, p) { return t + p.y; }, 0) / Math.max(1, q.length)) };
    });
    var cal = {
      inside: coverageScore(rows, pick), nominal: 0.5, size_mae: vs[0].mae, flat_mae: flat.mae,
      tvl1_mae: round3(rows.reduce(function (t, r) { return t + Math.abs(r.y - r.x); }, 0) / rows.length),
      odds_n: pts.length, odds_live: pts.filter(function (p) { return p.y; }).length,
      odds_logloss: opick.logloss, odds_flat_logloss: otests[0].logloss
    };
    return {
      as_of: snap.as_of, a: round3(w[0]), b: round3(w[1]), w: w, feats: pick.feats, ridge: pick.ridge || 0, cap: pick.cap || 0,
      cat: pick.cat, n: fams.length, tests: vs, loo_mae: pick.mae, spread: spread, cats: cats, secs: {}, comps: comps, cal: cal,
      odds: { c0: round3(oc[0]), c1: round3(oc[1] || 0), c2: round3(oc[2] || 0), c3: round3(oc[3] || 0), k: oc, feats: opick.feats, n: pts.length, tests: otests,
        pick: opick.name, bins: bins, logloss: opick.logloss, base_logloss: otests[1].logloss }
    };
  }

  var FLAG_ODDS = 0.3;

  function probabilityOfLaunch(m, age, tvl, c7) {
    var o = m.odds, g = Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100);
    var at = function (a) { return sigmoidAt(o.k, { a: Math.min(6, a), lx: Math.log10(Math.max(1, tvl)), g: g }, o.feats); };
    var f = at(age); return clampTo((at(age + 1) - f) / Math.max(1e-6, 1 - f), 0, 1);
  }
  function categoryDetail(m, cat) {
    var own = m.cats[cat], wc = own ? own.n / (own.n + SHRINK) : 0;
    return {
      category: cat, sector: sectorFor(cat), n: own ? own.n : 0, w: round3(wc), median: own ? own.median : 0,
      sector_n: 0, w_sector: 0, sector_median: 0, premium: round3(wc * (own ? own.median : 0))
    };
  }
  function scoreCandidate(m, p, flagCount) {
    var age = ageInYears(p.listed_at, m.as_of), ageUsed = age === null ? 2 : age, c7 = p.change_7d, carry = 1;
    if (m.cap) carry = clampTo(Math.pow(10, Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100)), 1 / m.cap, m.cap);
    var cd = categoryDetail(m, p.category || 'Uncategorised'), tvl = p.tvl_usd * carry;
    var curve = m.a + m.b * Math.log10(tvl) + (m.cat ? cd.premium : 0), ifl = Math.pow(10, curve);
    var odds0 = probabilityOfLaunch(m, ageUsed, p.tvl_usd, c7), fm = Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var odds = clampTo(odds0 * fm, 0, 0.995), base = Math.max(1, Math.round(ifl * odds));
    var lo = Math.max(1, Math.round(Math.pow(10, curve + m.spread.q25) * odds));
    var hi = Math.max(base, Math.round(Math.pow(10, curve + m.spread.q75) * odds));
    var parts = [['start', 50], ['TVL depth', Math.round(clampTo(6 * (Math.log10(p.tvl_usd) - 7.7), -10, 20))],
      ['peer spread', Math.round(-25 * (m.spread.q75 - m.spread.q25 - 0.9))]];
    if (c7 === null) parts.push(['no 7d change', -8]); else if (Math.abs(c7) > 25) parts.push(['volatile TVL', -8]);
    if (age === null) parts.push(['no listing date: age taken as 2y', -8]); else if (age < 0.33) parts.push(['under 4 months old', -6]);
    if (flagCount > 0) parts.push([flagCount + ' caution flag' + (flagCount === 1 ? '' : 's'), -18 * flagCount]);
    var confidence = Math.round(clampTo(parts.reduce(function (t, x) { return t + x[1]; }, 0), 5, 95));
    return {
      base: base, low: lo, high: hi, ifl: Math.round(ifl), odds: round3(odds), odds0: round3(odds0), odds_flag: round3(fm), multiple: round3(base / p.tvl_usd),
      confidence: confidence, parts: parts, age: age === null ? null : Math.round(age * 365), cat: cd,
      terms: { curve: round3(curve), log_tvl: round3(Math.log10(tvl)), carry: round3(carry), premium: round3(m.cat ? cd.premium : 0),
        odds_logit: round3(Math.log(odds0 / Math.max(1e-9, 1 - odds0))), age: ageUsed, c7: round3(Math.log10(1 + Math.max(-90, c7 === null ? 0 : c7) / 100)) },
      drivers: ['launch odds ' + Math.round(odds * 100) + '% in 12 mo', c7 === null ? 'no 7d carry' : '7d TVL ' + (c7 >= 0 ? '+' : '') + c7.toFixed(1) + '%',
        m.cap ? '7d carry capped ×' + m.cap : m.ridge ? '7d growth shrunk ×' + m.ridge : m.feats.length > 1 ? m.feats.slice(1).join(' + ') : 'TVL only',
        m.cat ? 'category ' + (cd.premium >= 0 ? '+' : '') + Math.round((Math.pow(10, cd.premium) - 1) * 100) + '%' : 'no category term'],
      spread: { q25: round3(m.spread.q25), q75: round3(m.spread.q75) }
    };
  }

  var USER_SHARE = 0.07, TBILL = 0.04;

  function farmEconomics(m, p, v, flagCount, position, weeks, costs) {
    var h = weeks / 52, ageUsed = v.age === null ? 2 : v.age / 365;
    var oddsH = probabilityOfLaunch(m, ageUsed, p.tvl_usd, p.change_7d) * Math.pow(FLAG_ODDS, Math.min(2, flagCount));
    var slice = USER_SHARE * v.ifl * position / p.tvl_usd, tbill = TBILL * position * h;
    var expected = slice * oddsH, net = expected - costs - tbill;
    return {
      slice: Math.round(slice), odds: round3(Math.min(0.995, oddsH)), expected: Math.round(expected), tbill: Math.round(tbill),
      costs: costs, net: Math.round(net), breakeven: round3(slice > 0 ? (costs + tbill) / slice : 1)
    };
  }
  function verdict(flagCount, confidence, c7, net, cost) {
    if (flagCount > 0 || confidence < 40 || net <= 0) return 'skip';
    if (confidence >= 55 && c7 > -12 && net >= Math.max(25, cost)) return 'farm now';
    return 'watch';
  }

  function compactUsd(n) {
    var a = Math.abs(n);
    return a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
  }

  root.RadarModel = {
    K: SHRINK, USER_SHARE: USER_SHARE, TBILL: TBILL, FLAG_ODDS: FLAG_ODDS, SECTORS: SECTOR_MAP, sectorOf: sectorFor,
    classify: classifyRecords, fit: fitModel, value: scoreCandidate, farm: farmEconomics, priority: verdict, short: compactUsd,
    launchOdds: probabilityOfLaunch, yearsOld: ageInYears, tokenFamilies: collectFamilies, catOf: categoryDetail
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);