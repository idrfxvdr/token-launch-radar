// Farm plans: concrete steps, built from each protocol's sector, category, chains, TVL and valuation.
//
// The one assumption the plan rests on is stated with it: a launch hands USER_SHARE of the implied value to
// users, pro rata to their share of TVL over the campaign. So $1,000 deposited is worth roughly
// USER_SHARE * V * 1000 / TVL at launch, the "per $1k" figure every plan quotes.

import type { Protocol, Verdict } from './classify.ts';
import type { Valuation } from './value.ts';

export const USER_SHARE = 0.07;
export type Priority = 'farm now' | 'watch' | 'skip';

export interface Plan {
  priority: Priority;
  why: string;
  chain: string;
  per_1k: number;            // estimated airdrop value per $1,000 kept in for the campaign
  capital: [number, number]; // a test ticket and a full position, US dollars
  weeks: number;             // the campaign horizon the plan budgets for
  setup_min: number;         // minutes to set up
  gas: string;               // what one action costs on the chosen chain
  steps: string[];
  risks: string[];
}

/** Rough cost of one transaction: Ethereum mainnet and the rest. */
const MAINNET = new Set(['Ethereum', 'Bitcoin']);
function pickChain(chains: string[]): string {
  return chains.find((c) => !MAINNET.has(c)) ?? chains[0] ?? 'Ethereum';
}
const usd = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(n)}`;
const big = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;

interface Ctx { p: Protocol; v: Valuation; chain: string; cheap: boolean; ticket: number; full: number; weeks: number; per1k: number; c7: number; age: number | null; }

/** The sector's core actions: what to deposit, borrow, trade or provide, and what each costs. */
function actions(sector: string, cat: string, x: Ctx): string[] {
  const { p, chain, ticket, full } = x;
  const on = `on ${chain}`;
  if (cat === 'Prediction Market') return [
    `Fund ${p.name} ${on} with ${usd(ticket)} in USDC and spread it over 8-12 liquid markets at $25-$100 each; points programmes on prediction venues weight distinct markets and settled volume, not one large bet.`,
    `Provide liquidity (resting limit orders inside the spread) on two or three high-volume markets with up to ${usd(full / 2)}; maker activity is usually rewarded above taker volume and costs no fee.`,
  ];
  if (sector === 'Trading' && /Deriv|Perp|Option|Interest/.test(cat + p.name)) return [
    `Deposit ${usd(ticket)}-${usd(full)} USDC margin into ${p.name} ${on} and trade majors (BTC, ETH) at 2-3x leverage at most; perp points track volume and open interest, so turnover matters more than size.`,
    `Use maker (post-only) orders wherever offered: at a typical 0.02% maker / 0.05% taker fee, $100k of monthly volume costs about $20-$50, which sets your cost per point; log it weekly.`,
    `Hold a small hedged position (long on ${p.name}, short the same size elsewhere) to earn open-interest points without price exposure; keep the margin ratio above 3x maintenance.`,
  ];
  if (sector === 'Trading') return [
    `Provide liquidity on ${p.name} ${on}: put ${usd(ticket)}-${usd(full)} into its deepest stable or ETH pair, as a ±5-10% range if it is a concentrated-liquidity pool, and rebalance when price leaves the range.`,
    `Swap through ${p.name} directly (not an aggregator) a few times a week, $200-$1,000 a trade in the same pair, so the wallet shows organic volume; budget 0.05-0.3% per swap in fees.`,
  ];
  if (cat === 'Lending' || cat === 'Uncollateralized Lending' || cat === 'Collateral Markets' || cat === 'Collateral Management') return [
    `Supply ${usd(ticket)}-${usd(full)} of USDC or ETH to ${p.name} ${on}; lenders' points usually accrue on supplied balance per day, so the earlier and steadier, the better.`,
    `Borrow against it at no more than 35-40% loan-to-value (a stablecoin against ETH, say) and keep the loan open: most lending programmes pay more for borrow than for supply.`,
  ];
  if (sector === 'Credit') return [
    `Open a vault on ${p.name} ${on} with ${usd(ticket)}-${usd(full)} of collateral and mint its stablecoin at a collateral ratio of 250% or more, well clear of liquidation.`,
    `Put the minted stablecoin to work in the protocol's own stability pool or its main liquidity pool: CDP points usually reward both minting and keeping the stable in its home pools.`,
  ];
  if (cat === 'Basis Trading') return [
    `Mint or deposit into ${p.name}'s yield-bearing product ${on} with ${usd(ticket)}-${usd(full)}; basis-trade products pay a funding-rate yield on top of any points, so the position earns while it farms.`,
    `Stake or lock the receipt token if a points multiplier is offered, but only for a cooldown you can accept: these products often hold withdrawals for 7 days or more when funding turns negative.`,
  ];
  if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator') return [
    `Deposit ${usd(ticket)}-${usd(full)} into a ${p.name}-curated USDC or ETH vault ${on}; curators' vault balances are tracked per block, so time-weighted balance is what counts.`,
    `Split across two of its vaults (a stablecoin and an ETH vault) rather than one: a curator spreading rewards across products tends to credit breadth of use.`,
  ];
  if (sector === 'Yield & vaults') return [
    `Deposit ${usd(ticket)}-${usd(full)} into ${p.name}'s main vault ${on}, the one with the most TVL; the vault's own yield covers gas while points accrue on the balance.`,
    `Hold the vault receipt token in the wallet (do not move it to a lending market) unless the protocol lists that market as boosted: off-protocol receipts often stop earning points.`,
  ];
  if (sector === 'RWA & CeDeFi') return [
    `Check the onboarding: many ${cat} products need KYC and a minimum subscription; if ${p.name} is permissionless ${on}, start at ${usd(ticket)}, else budget the KYC time into the plan.`,
    `Subscribe ${usd(ticket)}-${usd(full)} to its main product and note its redemption terms (T+1 to T+30 is common for real-world assets): the airdrop clock runs on the held balance.`,
  ];
  if (cat === 'Chain') return [
    `Bridge ${usd(ticket)} to ${p.chains[0] ?? chain} through its canonical bridge, then use two or three of its top applications; chain campaigns reward bridged value and distinct contracts used.`,
    `Keep part of the balance on the chain for the campaign: a chain's distribution usually checks a balance held at snapshot, not only activity.`,
  ];
  if (cat === 'Staking Pool' || cat === 'Restaking') return [
    `Stake ${usd(ticket)}-${usd(full)} through ${p.name} ${on}; the receipt is the record of your share, so keep it in the wallet that staked.`,
    `Choose the operator or pool with the longest track record, as slashing hits the pool you chose; stake at most what you could have locked for the unbonding period.`,
  ];
  return [
    `Use ${p.name}'s main product ${on} with ${usd(ticket)}-${usd(full)}: deposit where it takes deposits, or trade where it is a venue, and keep the position for the campaign rather than cycling in and out.`,
    `Try each of its other features once with a small amount (under $100), since breadth of use is a common distribution criterion when a points programme's rules are not published.`,
  ];
}

export function plan(p: Protocol, v: Valuation, verdict: Verdict, sector: string): Plan {
  const chain = pickChain(p.chains);
  const cheap = !MAINNET.has(chain);
  const per1k = Math.round((USER_SHARE * v.base * 1000) / p.tvl_usd * 100) / 100;
  // Size: a test ticket, then a position that scales with confidence (a capped $10k at 95).
  const ticket = cheap ? 250 : 1000;
  const full = Math.max(ticket * 2, Math.round((v.confidence / 95) * 10) * 1000);
  const age = v.age_days;
  const weeks = age === null ? 16 : age < 180 ? 26 : age < 540 ? 16 : 12;
  const c7 = p.change_7d ?? 0;
  const x: Ctx = { p, v, chain, cheap, ticket, full, weeks, per1k, c7, age };
  const gas = cheap ? `under $0.50 an action on ${chain}` : `about $5-$30 an action on ${chain}`;
  const cat = p.category ?? 'Uncategorised';

  let priority: Priority, why: string;
  if (verdict.flags.length > 0) { priority = 'skip'; why = `Skip: ${verdict.flags[0]}.`; }
  else if (v.confidence < 40) { priority = 'skip'; why = `Skip: confidence ${v.confidence}/100 is too low to commit capital on.`; }
  else if (per1k < 4) { priority = 'skip'; why = `Skip: about $${per1k.toFixed(2)} per $1k at launch does not pay for the time and gas.`; }
  else if (v.confidence >= 55 && c7 > -12 && per1k >= 10) { priority = 'farm now'; why = `Farm now: about $${per1k.toFixed(0)} per $1k kept in, confidence ${v.confidence}/100 and TVL ${c7 >= 0 ? 'growing' : 'holding'} (${c7 >= 0 ? '+' : ''}${c7.toFixed(1)}% in 7d).`; }
  else { priority = 'watch'; why = `Watch: ${per1k < 10 ? `about $${per1k.toFixed(0)} per $1k is thin` : c7 <= -12 ? `TVL fell ${c7.toFixed(1)}% in 7d` : `confidence ${v.confidence}/100`}; enter on a points announcement or a turn in TVL.`; }

  const steps: string[] = [];
  steps.push(`Find ${p.name}'s official app from its DefiLlama listing (slug ${p.slug}), bookmark it and check its contract addresses against its docs before any deposit; use a fresh wallet funded only for this.`);
  steps.push(cheap
    ? `Farm on ${chain}${p.chains.length > 1 ? ` (it also runs on ${p.chains.filter((c) => c !== chain).slice(0, 3).join(', ')})` : ''}: bridge ${usd(ticket)} of USDC there; gas is ${gas}, so small weekly actions stay cheap.`
    : `Farm on ${chain}, its ${p.chains.length === 1 ? 'only' : 'main'} chain: gas is ${gas}, so batch actions and size up to at least ${usd(ticket)} so fees stay under 2% of the position.`);
  steps.push(...actions(sector, cat, x));
  steps.push(`Budget ${x.weeks} weeks${age !== null ? ` (it has run ${Math.round(age / 30)} months with no token)` : ''}: about 30 minutes to set up, then 10 minutes a week to log balances and points. At the model's base value, ${usd(full)} kept in for the campaign is worth about ${usd((per1k * full) / 1000)} at launch (${(USER_SHARE * 100).toFixed(0)}% to users, pro rata to ${big(p.tvl_usd)} TVL).`);
  steps.push(c7 < -10
    ? `Re-check TVL each week: it fell ${c7.toFixed(1)}% in the last 7 days, so if it falls another 15% withdraw to the test ticket and wait.`
    : c7 > 10
      ? `Move early: TVL rose ${c7.toFixed(1)}% in 7 days, so the points pool is diluting quickly; set the full position within the first week.`
      : `Scale from the test ticket to ${usd(full)} once the first withdrawal clears, so the exit path is tested before the money is.`);

  const risks: string[] = [];
  risks.push(age !== null && age < 365
    ? `Smart contract: under a year on DefiLlama (${Math.round(age / 30)} months), a short record; cap the position and prefer audited vaults.`
    : `Smart contract: ${age === null ? 'no listing date recorded' : `${(age / 365).toFixed(1)} years tracked`}, but every deposit is still exposed to a contract or oracle bug.`);
  risks.push(`Sybil filters: one wallet, organic activity; splitting into many small wallets or looping volume is the pattern distributions exclude.`);
  if (/Basis|RWA|CeDeFi|Staking|Restaking|Risk Curators|Allocator/.test(cat)) risks.push(`Lockups: ${cat} products often queue withdrawals (days to weeks); keep only capital you can leave in for ${weeks} weeks.`);
  if (sector === 'Trading') risks.push(`Trading cost: fees and slippage are a certain cost against an uncertain drop; stop if the cost per point stops falling.`);
  if (sector === 'Credit') risks.push(`Liquidation: a borrow or mint position can be liquidated on a fast move; keep the health factor well above the minimum.`);
  for (const f of verdict.flags) risks.push(`Token risk: ${f}.`);
  risks.push(`No token is announced: the implied value is a model estimate, and a launch may never come.`);
  return { priority, why, chain, per_1k: per1k, capital: [ticket, full], weeks, setup_min: 30, gas, steps, risks };
}
