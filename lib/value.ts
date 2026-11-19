// The valuation model. Every number comes from the snapshot.
//
//   log10(V) = a + b * log10(TVL)          the size curve, fitted on every protocol whose token trades (mcap recorded)
//            + d_cat                       the category's premium: median residual of its tokenised peers, shrunk to the sector's
//            + m + s + c + f               momentum (7d), seasoning (age with no token), chain breadth, caution flags
//   low / high = V * 10^(q25) and V * 10^(q75), the peers' residual quartiles (shrunk the same way)
//
// The value is what a token would be worth at launch if the record stayed as it is (a market-cap basis: the
// snapshot records market caps, not FDV). It is no forecast that a token will launch.

import type { Protocol, Snapshot, Verdict } from './classify.ts';

/** Categories grouped into sectors, so a category with few tokenised peers borrows from its neighbours. */
export const SECTORS: Record<string, string[]> = {
  Trading: ['Dexs', 'Derivatives', 'Options', 'Prediction Market', 'Interest Rate Derivatives', 'OTC Marketplace', 'Launchpad', 'NFT Marketplace', 'Perps'],
  Credit: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management', 'Dual-Token Stablecoin', 'Stablecoin Wrapper'],
  'Yield & vaults': ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Basis Trading', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes', 'Governance Incentives', 'Staking Pool'],
  'RWA & CeDeFi': ['RWA', 'CeDeFi', 'Payments', 'Crypto Card Issuer', 'Insurance', 'RWA Lending'],
  Infrastructure: ['Chain', 'Restaking', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Decentralized BTC', 'Privacy', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'CEX', 'DOR', 'Oracle'],
};
export function sectorOf(category: string | null): string {
  for (const [sector, cats] of Object.entries(SECTORS)) if (category !== null && cats.includes(category)) return sector;
  return 'Other';
}

/** Shrinkage strength: a group of n peers is weighted n / (n + K) against its parent. */
export const K = 4;

export interface Fit { a: number; b: number; n: number; resid_sd: number; loo_mae: number; }
export interface Group { n: number; median: number; q25: number; q75: number; }
export interface Comparable { slug: string; name: string; category: string | null; tvl: number; mcap: number; symbol: string; multiple: number; resid: number; }

export interface Valuation {
  base: number; low: number; high: number;
  multiple: number;            // base / TVL
  confidence: number;          // 0..100
  terms: { size: number; cat: number; momentum: number; season: number; chains: number; flags: number };
  cat_detail: { category_n: number; category_median: number; sector: string; sector_n: number; sector_median: number; w_cat: number; w_sector: number };
  spread: { q25: number; q75: number };
  confidence_parts: [string, number][];
  drivers: string[];
  age_days: number | null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}
function group(values: number[]): Group {
  const s = [...values].sort((x, y) => x - y);
  return { n: s.length, median: quantile(s, 0.5), q25: quantile(s, 0.25), q75: quantile(s, 0.75) };
}
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length, mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export class Model {
  fit: Fit;
  comps: Comparable[];
  cats = new Map<string, Group>();
  sectors = new Map<string, Group>();
  global: Group;

  snap: Snapshot;

  constructor(snap: Snapshot) {
    this.snap = snap;
    const peers = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
    const xs = peers.map((p) => Math.log10(p.tvl_usd)), ys = peers.map((p) => Math.log10(p.mcap_usd!));
    const { a, b } = ols(xs, ys);
    const resid = ys.map((y, i) => y - (a + b * xs[i]!));
    // Leave-one-out: refit without each peer and score its own market cap, the model's honest error.
    let loo = 0;
    for (let i = 0; i < peers.length; i++) {
      const f = ols(xs.filter((_, j) => j !== i), ys.filter((_, j) => j !== i));
      loo += Math.abs(ys[i]! - (f.a + f.b * xs[i]!));
    }
    this.fit = { a: round3(a), b: round3(b), n: peers.length, resid_sd: round3(Math.sqrt(resid.reduce((p, e) => p + e * e, 0) / (peers.length - 2))), loo_mae: round3(loo / peers.length) };
    this.comps = peers.map((p, i) => ({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, mcap: p.mcap_usd!, symbol: p.symbol ?? p.gecko_id ?? '', multiple: round3(p.mcap_usd! / p.tvl_usd), resid: round3(resid[i]!) }));
    this.global = group(resid);
    const byCat = new Map<string, number[]>(), bySector = new Map<string, number[]>();
    this.comps.forEach((c) => {
      const cat = c.category ?? 'Uncategorised';
      byCat.set(cat, [...(byCat.get(cat) ?? []), c.resid]);
      const sec = sectorOf(c.category);
      bySector.set(sec, [...(bySector.get(sec) ?? []), c.resid]);
    });
    for (const [k, v] of byCat) this.cats.set(k, group(v));
    for (const [k, v] of bySector) this.sectors.set(k, group(v));
  }

  /** A group's statistic shrunk toward its parent's: (n * own + K * parent) / (n + K). */
  private shrink(own: Group | undefined, parent: { median: number; q25: number; q75: number }) {
    const n = own?.n ?? 0, w = n / (n + K);
    const mix = (key: 'median' | 'q25' | 'q75') => w * (own?.[key] ?? 0) + (1 - w) * parent[key];
    return { n, w, median: mix('median'), q25: mix('q25'), q75: mix('q75') };
  }

  value(p: Protocol, v: Verdict): Valuation {
    const sector = sectorOf(p.category);
    // The sector shrinks toward zero offset with the global spread; the category toward its sector.
    const sec = this.shrink(this.sectors.get(sector), { median: 0, q25: this.global.q25, q75: this.global.q75 });
    const cat = this.shrink(this.cats.get(p.category ?? 'Uncategorised'), sec);
    const size = this.fit.a + this.fit.b * Math.log10(p.tvl_usd);
    const c7 = p.change_7d;
    const momentum = c7 === null ? 0 : Math.max(-0.15, Math.min(0.15, 2 * Math.log10(1 + Math.max(-90, c7) / 100)));
    const age = p.listed_at === null ? null : daysBetween(p.listed_at, this.snap.as_of);
    const season = age === null ? 0 : 0.08 * Math.min(age / 365, 2) - 0.05;
    const chains = Math.min(0.15, 0.04 * Math.log2(Math.max(1, p.chains.length)));
    const flags = -0.3 * Math.min(2, v.flags.length);
    const logV = size + cat.median + momentum + season + chains + flags;
    const base = Math.max(1, Math.round(10 ** logV));
    const low = Math.max(1, Math.round(10 ** (logV + cat.q25 - cat.median)));
    const high = Math.max(base, Math.round(10 ** (logV + cat.q75 - cat.median)));

    const parts: [string, number][] = [['start', 50]];
    parts.push([`${cat.n} category peer${cat.n === 1 ? '' : 's'}`, Math.min(20, 4 * cat.n)]);
    parts.push(['peer spread', Math.round(-25 * (cat.q75 - cat.q25 - 0.9))]);
    parts.push(['TVL depth', Math.round(6 * (Math.log10(p.tvl_usd) - 7.7))]);
    if (c7 === null) parts.push(['no 7d change', -8]);
    else if (Math.abs(c7) > 25) parts.push(['volatile TVL', -8]);
    if (age === null) parts.push(['no listing date', -8]);
    else if (age < 120) parts.push(['under 4 months old', -6]);
    if (v.flags.length > 0) parts.push([`${v.flags.length} caution flag${v.flags.length === 1 ? '' : 's'}`, -18 * v.flags.length]);
    const confidence = Math.max(5, Math.min(95, parts.reduce((s, [, x]) => s + x, 0)));

    const terms = { size: round3(size), cat: round3(cat.median), momentum: round3(momentum), season: round3(season), chains: round3(chains), flags: round3(flags) };
    const named: [string, number][] = [
      [`size curve on $${(p.tvl_usd / 1e6).toFixed(0)}M TVL`, 0],
      [`${p.category ?? 'uncategorised'} premium`, terms.cat],
      [c7 === null ? 'no 7d trend' : `7d TVL ${c7 >= 0 ? '+' : ''}${c7.toFixed(1)}%`, terms.momentum],
      [age === null ? 'age unknown' : `${(age / 365).toFixed(1)}y with no token`, terms.season],
      [`${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}`, terms.chains],
      ['caution flags', terms.flags],
    ];
    const drivers = named.slice(1).filter(([, x]) => Math.abs(x) >= 0.02).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]) || x[0].localeCompare(y[0]))
      .slice(0, 3).map(([n, x]) => `${n} ${x >= 0 ? '+' : '-'}${Math.round(Math.abs(10 ** x - 1) * 100)}%`);
    return {
      base, low, high, multiple: round3(base / p.tvl_usd), confidence, terms,
      cat_detail: { category_n: cat.n, category_median: round3(this.cats.get(p.category ?? 'Uncategorised')?.median ?? 0), sector, sector_n: sec.n, sector_median: round3(this.sectors.get(sector)?.median ?? 0), w_cat: round3(cat.w), w_sector: round3(sec.w) },
      spread: { q25: round3(cat.q25 - cat.median), q75: round3(cat.q75 - cat.median) },
      confidence_parts: parts, drivers, age_days: age,
    };
  }
}
