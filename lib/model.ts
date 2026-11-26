// Typed access to the model in dashboard/00-model.js.
//
// The model lives in the dashboard so the page runs the very code that wrote board.json (and the judge
// reads it). Node evaluates the same classic script here, which sets globalThis.RadarModel.

import '../dashboard/00-model.js';

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[]; }
export interface Verdict { status: 'live' | 'candidate' | 'excluded'; reason: string; flags: string[]; }
export interface Comparable { slug: string; name: string; category: string | null; symbol: string; records: number; tvl: number; mcap: number; multiple: number; resid: number; }
export interface TermTest { name: string; feats: string[] | null; mae: number; hit: number; cap?: number; ridge?: number; cat?: boolean; applied?: boolean; }
export interface OddsTest { name: string; feats: string[]; logloss: number; brier: number; }
export interface Odds { c0: number; c1: number; c2: number; c3: number; n: number; feats: string[]; tests: OddsTest[]; pick: string; logloss: number; base_logloss: number; bins: { from: number; to: number; n: number; share: number }[]; }
export interface Group { n: number; median: number; q25: number; q75: number; }
export interface Fitted {
  as_of: string; a: number; b: number; n: number; loo_mae: number; feats: string[]; cap: number; ridge: number; cat: boolean;
  tests: TermTest[]; odds: Odds; spread: Group; cats: Record<string, Group>; secs: Record<string, Group>; comps: Comparable[];
  cal: { inside: number; nominal: number; size_mae: number; flat_mae: number; tvl1_mae: number; odds_n: number; odds_live: number; odds_logloss: number; odds_flat_logloss: number };
}
export interface CatDetail { category: string; sector: string; n: number; w: number; median: number; sector_n: number; w_sector: number; sector_median: number; premium: number; }
export interface Valuation {
  base: number; low: number; high: number; ifl: number; odds: number; multiple: number; confidence: number; age: number | null;
  cat: CatDetail;
  terms: { curve: number; log_tvl: number; carry: number; premium: number; odds_logit: number; age: number; c7: number };
  parts: [string, number][]; drivers: string[];
  spread: { q25: number; q75: number };
}
export type Priority = 'farm now' | 'watch' | 'skip';

interface RadarModel {
  K: number; USER_SHARE: number; TBILL: number; FLAG_ODDS: number;
  SECTORS: Record<string, string[]>;
  sectorOf(category: string | null): string;
  classify(snap: Snapshot): Record<string, Verdict>;
  fit(snap: Snapshot, verdicts: Record<string, Verdict>): Fitted;
  farm(m: Fitted, p: Protocol, v: Valuation, flagCount: number, position: number, weeks: number, costs: number): { slice: number; odds: number; expected: number; tbill: number; costs: number; net: number; breakeven: number };
  value(m: Fitted, p: Protocol, flagCount: number): Valuation;
  priority(flagCount: number, confidence: number, c7: number, net: number, cost: number): Priority;
}

export const M = (globalThis as unknown as { RadarModel: RadarModel }).RadarModel;

/** Parse the sealed snapshot and check it has the two arrays the build reads. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}