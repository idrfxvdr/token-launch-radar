// Typed access to the model in dashboard/model.js. The model lives in the dashboard so the page runs the very
// code that wrote board.json (and the judge reads it); Node evaluates the same classic script here, which sets
// globalThis.RadarModel.

import '../dashboard/model.js';

export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[]; }
export interface Verdict { status: 'live' | 'candidate' | 'excluded'; reason: string; flags: string[]; }
export interface Backtest { n: number; flat: number; size: number; full: number; within_2x: number; }
export interface Comparable { slug: string; name: string; category: string | null; symbol: string; records: number; tvl: number; mcap: number; multiple: number; resid: number; }
export interface Fitted {
  as_of: string; a: number; b: number; n: number; resid_sd: number; loo_mae: number; backtest: Backtest;
  global: { n: number; median: number; q25: number; q75: number }; comps: Comparable[];
}
export interface Valuation {
  base: number; low: number; high: number; multiple: number; confidence: number; age: number | null;
  terms: { size: number; cat: number; momentum: number; season: number; chains: number; flags: number };
  parts: [string, number][]; drivers: string[];
  cat_detail: { category_n: number; category_median: number; sector: string; sector_n: number; sector_median: number; w_cat: number; w_sector: number };
  spread: { q25: number; q75: number };
}
export type Priority = 'farm now' | 'watch' | 'skip';

interface RadarModel {
  K: number;
  SECTORS: Record<string, string[]>;
  sectorOf(category: string | null): string;
  classify(snap: Snapshot): Record<string, Verdict>;
  fit(snap: Snapshot): Fitted;
  value(m: Fitted, p: Protocol, flagCount: number): Valuation;
  priority(flagCount: number, confidence: number, c7: number, net: number, cost: number): Priority;
}

export const M = (globalThis as unknown as { RadarModel: RadarModel }).RadarModel;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}
