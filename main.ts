// Token Launch Radar: make.fun token-radar-01 entry. Node 22.18+, standard library only, no network.
//
// Reads the sealed DefiLlama snapshot (/input/snapshot.json, or --input <file|dir>), classifies every protocol
// (lib/classify.ts), values each pre-token candidate against the tokenised peers in the same snapshot
// (lib/value.ts), writes a farm plan per row (lib/plans.ts), and writes to /output (or MAKEFUN_OUTPUT_DIR):
//   board.json    the ranked board, one row per candidate, the whole house watchlist included
//   data.js       the dashboard's dataset (window.RADAR), beside dashboard/
//   dashboard/    the static page, copied from this repository
//   screenshots/  copied from this repository
//   dossier.json  written last by vendor/makefun-board.ts's buildDossier
// Deterministic: no clock, no randomness, every sort broken by slug.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M, parseSnapshot, type Protocol, type Valuation } from './lib/model.ts';
import { plan, stepText, USER_SHARE, type Plan } from './lib/plans.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}
function fail(msg: string): never {
  process.stderr.write(`token radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|dir>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(inputFile, 'utf8'));
const verdicts = M.classify(snap);
const model = M.fit(snap, verdicts);
const house = new Set(snap.watchlist);

interface Scored { p: Protocol; v: Valuation; plan: Plan; sector: string; }
const scored: Scored[] = snap.protocols
  .filter((p) => verdicts[p.slug]!.status === 'candidate')
  .map((p) => {
    const v = M.value(model, p, verdicts[p.slug]!.flags.length);
    const sector = M.sectorOf(p.category);
    return { p, v, sector, plan: plan(p, v, verdicts[p.slug]!, sector, model) };
  })
  .sort((x, y) => y.v.base - x.v.base || (x.p.slug < y.p.slug ? -1 : 1));

const board = scored.map(({ p, v, plan: f, sector }, i) => ({
  rank: i + 1,
  slug: p.slug,
  name: p.name,
  implied_value_usd: v.base,
  implied_low_usd: v.low,
  implied_high_usd: v.high,
  implied_multiple: v.multiple,
  confidence: v.confidence,
  priority: f.priority,
  category: p.category,
  sector,
  chains: p.chains,
  tvl_usd: p.tvl_usd,
  change_7d: p.change_7d,
  listed_at: p.listed_at,
  on_watchlist: house.has(p.slug),
  flags: verdicts[p.slug]!.flags,
  drivers: v.drivers,
  per_1k_usd: f.per_1k,
  farm_steps: f.steps.map(stepText),
  farm_cost_usd: f.total_cost,
  farm_expected_drop_usd: f.drop,
  farm_net_usd: f.net,
  farm_hours: f.hours,
  farm_main_risk: f.main_risk,
  farm_stop_rule: f.stop_rule,
  risks: f.risks,
}));

// The gate's own rules, checked before anything is written.
if (board.length < 100 || board.length > 4000) fail(`${board.length} rows: the gate takes 100 to 4000`);
for (const slug of snap.watchlist) if (!board.some((r) => r.slug === slug)) fail(`watchlist slug ${slug} is not on the board`);
board.forEach((r, i) => {
  if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) fail(`rank ${r.rank} is worth more than rank ${i}`);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1) fail(`${r.slug}: implied value must be a positive whole number`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug}: ${r.farm_steps.length} farm steps`);
  for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) fail(`${r.slug}: a farm step of ${s.trim().length} characters`);
});
if (new Set(board.map((r) => r.implied_value_usd)).size < 2) fail('every implied value is the same');

// Plans must be written from the protocol, not a template with a name swapped: two rows of different categories
// may not share the same step text once names, slugs and numbers are taken out.
function stepSignature(name: string, slug: string, steps: string[]): string {
  return steps.join(' ').toLowerCase().split(name.toLowerCase()).join(' ').split(slug.toLowerCase()).join(' ')
    .replace(/[0-9][0-9.,%$+\-x×kKmMbB]*/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const sigs = board.map((r) => ({ slug: r.slug, category: r.category, sig: stepSignature(r.name, r.slug, r.farm_steps) }));
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  if (sigs[i]!.category !== sigs[j]!.category && sigs[i]!.sig === sigs[j]!.sig) fail(`plans of ${sigs[i]!.slug} and ${sigs[j]!.slug} are the same text in different categories`);
}
for (const r of board) for (const s of r.farm_steps) {
  if (!/Cost: .+\. Time: .+\.$/.test(s)) fail(`${r.slug}: a farm step without a cost and a time`);
}

// The dashboard's dataset: compact rows (keys are short to keep data.js small) and the model's own figures.
const radar = {
  as_of: snap.as_of,
  source: snap.source,
  floor: snap.floor_usd,
  counts: {
    protocols: snap.protocols.length,
    watchlist: snap.watchlist.length,
    candidates: board.length,
    live: Object.values(verdicts).filter((x) => x.status === 'live').length,
    excluded: Object.values(verdicts).filter((x) => x.status === 'excluded').length,
  },
  fit: { a: model.a, b: model.b, n: model.n, loo_mae: model.loo_mae, feats: model.feats, use_cat: model.cat, cap: model.cap, ridge: model.ridge },
  tests: model.tests.map((t) => ({ name: t.name, mae: t.mae, hit: t.hit, applied: !!t.applied })),
  cal: model.cal,
  odds: { c0: model.odds.c0, c1: model.odds.c1, c2: model.odds.c2, c3: model.odds.c3, feats: model.odds.feats, n: model.odds.n, bins: model.odds.bins, pick: model.odds.pick, logloss: model.odds.logloss, base_logloss: model.odds.base_logloss,
    tests: model.odds.tests.map((t) => ({ name: t.name, logloss: t.logloss, brier: t.brier })) },
  tbill: M.TBILL,
  flag_odds: M.FLAG_ODDS,
  global: { q25: model.spread.q25, median: model.spread.median, q75: model.spread.q75 },
  k: M.K,
  user_share: USER_SHARE,
  sectors: M.SECTORS,
  // The raw snapshot: the page refits dashboard/model.js on it and checks every implied value against this board.
  snapshot: { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, watchlist: snap.watchlist, protocols: snap.protocols },
  rows: scored.map(({ p, v, plan: f, sector }, i) => ({
    r: i + 1, s: p.slug, n: p.name, c: p.category ?? 'Uncategorised', sec: sector, ch: p.chains, tvl: p.tvl_usd, d7: p.change_7d,
    at: p.listed_at, age: v.age, w: house.has(p.slug) ? 1 : 0, lo: v.low, b: v.base, hi: v.high, ifl: v.ifl, od: v.odds, cy: v.carry, m: v.multiple, conf: v.confidence,
    cp: v.parts, t: v.terms, cd: v.cat_detail, sp: v.spread, dr: v.drivers, why: verdicts[p.slug]!.reason, fl: verdicts[p.slug]!.flags,
    pr: f.priority, pw: f.why, k1: f.per_1k, cap: f.capital, wk: f.weeks, chain: f.chain, gas: f.gas, tc: f.total_cost, hr: f.hours, fee: f.fees, dp: f.drop, net: f.net, sl: f.slice, oh: f.odds, tb: f.tbill, be: f.breakeven,
    st: f.steps.map((x) => [x.text, x.cost, x.time, x.when ?? ""]), rk: f.risks, mr: f.main_risk, sr: f.stop_rule,
  })),
  comps: model.comps.map((c) => ({ s: c.slug, n: c.name, c: c.category ?? 'Uncategorised', sec: M.sectorOf(c.category), sym: c.symbol, rec: c.records, tvl: c.tvl, mc: c.mcap, x: c.multiple, e: c.resid })),
  excluded: snap.protocols.filter((p) => verdicts[p.slug]!.status === 'excluded')
    .map((p) => ({ s: p.slug, n: p.name, c: p.category ?? 'Uncategorised', tvl: p.tvl_usd, why: verdicts[p.slug]!.reason })),
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snap.as_of, model: 'log-log comparables, see dashboard Methodology', rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}
const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n}: names are letters, digits and . _ -`);
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images; the gate needs 3 (board, detail, filtered). board.json and data.js are written.`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
process.stdout.write(`token radar: ${snap.protocols.length} protocols; ${board.length} candidates ranked (${snap.watchlist.length} on the watchlist), ${radar.counts.live} live tokens as comparables, ${radar.counts.excluded} excluded; ${pages.length} dashboard files, ${shots.length} screenshots -> ${out}\n`);
