// Farm plans — concrete, costed steps built from each protocol's sector, category, chains, TVL and valuation.
//
// Each step states what it costs (capital put to work, the gas its transactions take on the chosen chain,
// and fees) and how long it takes, so the reader can price the whole plan before starting it.
//
// The plan rests on one stated assumption: a launch hands USER_SHARE of the implied value to users, pro
// rata to their share of TVL over the campaign. So $1,000 kept in is worth roughly
// USER_SHARE * V * 1000 / TVL at launch — the "per $1k" figure every plan quotes.

import { M, type Fitted, type Priority, type Protocol, type Valuation, type Verdict } from './model.ts';

export const USER_SHARE = M.USER_SHARE;

/** A single step: what to do, what it costs, how long it takes, and when in the campaign it falls. */
export interface Step { text: string; cost: string; time: string; when?: string; }

export interface Plan {
  priority: Priority;
  why: string;
  chain: string;
  per_1k: number;            // estimated airdrop value per $1,000 kept in for the campaign
  capital: [number, number]; // a test ticket and a full position, US dollars
  weeks: number;             // the campaign horizon the plan budgets for
  gas_usd: number;           // what one transaction costs on the chosen chain
  total_cost: number;        // gas and fees for the whole plan, US dollars
  fees: number;              // the sector's running fees over the horizon (trading, borrow), US dollars
  drop: number;              // expected payout of the full position: slice x launch odds in the horizon
  slice: number;             // the position's share of a launch, if one comes
  odds: number;              // fitted odds of a launch inside the horizon
  tbill: number;             // T-bill yield the position gives up over the horizon
  breakeven: number;         // the launch odds at which the plan breaks even
  net: number;               // drop - total_cost: what farming nets at the model's base value
  hours: number;             // hands-on hours for the whole plan
  main_risk: string;         // the one risk that decides this plan
  stop_rule: string;         // the rule that ends it
  gas: string;
  steps: Step[];
  risks: string[];
}

// ---- formatting and small helpers -------------------------------------------------------------

/** Ethereum and Bitcoin mainnet cost far more per transaction than the rest, so they are avoided. */
const HEAVY_CHAINS = new Set(['Ethereum', 'Bitcoin']);
function cheapestChain(chains: string[]): string {
  return chains.find((c) => !HEAVY_CHAINS.has(c)) ?? chains[0] ?? 'Ethereum';
}
const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
};
const moneyShort = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`;

/** The per-protocol facts every step is written from. */
interface Ctx { p: Protocol; v: Valuation; chain: string; cheap: boolean; gas: number; ticket: number; full: number; weeks: number; per1k: number; c7: number; age: number | null; cat: string; }

/** n transactions on the plan's chain, quoted in dollars. */
const gasLine = (x: Ctx, n: number) => `~$${Math.max(1, Math.round(n * x.gas))} gas (${n} tx)`;

// ---- the sector's core actions ----------------------------------------------------------------

/** The sector's core actions: what to deposit, borrow, trade or provide, each with its cost and time. */
function coreActions(sector: string, x: Ctx): Step[] {
  const { p, chain, ticket, full, weeks, cat } = x;
  const on = `on ${chain}`;
  if (cat === 'Prediction Market') return [
    { text: `Fund ${p.name} ${on} with ${money(ticket)} in USDC and spread it over 8-12 liquid markets at $25-$100 each; a prediction venue's points weight distinct markets and settled volume, not one large bet.`, cost: `${money(ticket)} at risk on outcomes + ${gasLine(x, 10)}`, time: '45 min, then 15 min a week' },
    { text: `Provide liquidity with resting limit orders inside the spread on two or three high-volume markets, up to ${money(full / 2)}; maker activity is usually rewarded above taker volume and pays no fee.`, cost: `${money(full / 2)} working capital, $0 maker fees`, time: '20 min a week to re-quote' },
  ];
  if (sector === 'Trading' && /Deriv|Perp|Option|Interest/.test(cat + p.name)) return [
    { text: `Deposit ${money(ticket)}-${money(full)} USDC margin into ${p.name} ${on} and trade BTC and ETH at 2-3x leverage at most; a derivatives venue's points track volume and open interest, so turnover counts more than size.`, cost: `${money(full)} margin + ${gasLine(x, 2)}`, time: '20 min' },
    { text: `Use post-only (maker) orders: at a typical 0.02% maker / 0.05% taker fee, $100k of monthly volume costs about $20-$50, which is your price per point; aim for $25k-$100k a month.`, cost: `$20-$50 a month in fees`, time: '15 min a week' },
    { text: `Hold a hedged position (long on ${p.name}, the same size short on another venue) to earn open-interest points with no price exposure; keep the margin ratio above 3x maintenance.`, cost: `funding paid on one leg, often ±10% APR on ${money(full / 2)}`, time: '10 min a week to check margin' },
  ];
  if (sector === 'Trading' && cat === 'Dexs') return [
    { text: `Provide liquidity on ${p.name} ${on}: put ${money(ticket)}-${money(full)} into its deepest stable or ETH pair, as a ±5-10% range if the pool is concentrated, and rebalance when price leaves it.`, cost: `${money(full)} in the pool, impermanent loss on the volatile side + ${gasLine(x, 3)}`, time: '25 min, then 10 min per rebalance' },
    { text: `Swap through ${p.name} directly (not an aggregator) two or three times a week, $200-$1,000 a trade in the same pair, so the wallet shows organic volume.`, cost: `0.05-0.3% per swap + ${gasLine(x, 3)} a week`, time: '10 min a week' },
  ];
  if (sector === 'Trading') return [
    { text: `Use ${p.name}'s ${cat.toLowerCase()} venue ${on} with ${money(ticket)}-${money(full)}: ${cat === 'Launchpad' ? 'buy one or two early sales and hold the allocation' : cat === 'NFT Marketplace' ? 'list and buy two or three pieces in one collection' : 'trade its main market a few times a week'} so the wallet shows real activity.`, cost: `${money(full)} put to work + ${gasLine(x, 4)}`, time: '20 min, then 10 min a week' },
    { text: `Keep the position on ${chain} for the campaign rather than cycling in and out: ${cat} programmes usually sample a balance and a trade count at a snapshot.`, cost: gasLine(x, 2), time: '5 min a week' },
  ];
  if (cat === 'Lending' || cat === 'Uncollateralized Lending') return [
    { text: `Supply ${money(ticket)}-${money(full)} of USDC or ETH to ${p.name} ${on}; a lending market's points usually accrue on supplied balance per day, so the earlier and steadier, the better.`, cost: `${money(full)} supplied (earns the supply rate) + ${gasLine(x, 2)}`, time: '15 min' },
    { text: `Borrow a stablecoin against it at no more than 35-40% loan-to-value and keep the loan open for the ${weeks} weeks: lending programmes pay more for borrow than for supply.`, cost: `the borrow rate on ${money(full * 0.35)}, about ${money(full * 0.35 * 0.07 * weeks / 52)} over ${weeks} weeks at 7% APR`, time: '10 min, then a weekly health check' },
  ];
  if (cat === 'Collateral Markets' || cat === 'Collateral Management') return [
    { text: `Deposit ${money(ticket)}-${money(full)} of collateral into ${p.name} ${on} and borrow against it at 40% loan-to-value; a collateral market rewards the collateral you post and the debt you take.`, cost: `${money(full)} collateral + ${gasLine(x, 3)}`, time: '20 min' },
    { text: `Keep the loan open across the ${weeks} weeks and top the collateral up when the ratio nears 45%: the position is the points, and a liquidation ends them.`, cost: `interest on ${money(full * 0.4)}, about ${money(full * 0.4 * 0.06 * weeks / 52)}`, time: '10 min a week' },
  ];
  if (cat === 'CDP' || cat === 'CDP Manager') return [
    { text: `Open a vault on ${p.name} ${on} with ${money(ticket)}-${money(full)} of collateral and mint its stablecoin at a collateral ratio of 250% or more, well clear of liquidation.`, cost: `${money(full)} collateral, the mint fee or stability rate + ${gasLine(x, 3)}`, time: '20 min' },
    { text: `Put the minted stablecoin into the protocol's own stability pool or its main liquidity pool: a CDP programme usually rewards both minting and keeping the stable at home.`, cost: gasLine(x, 2), time: '10 min, then a weekly ratio check' },
  ];
  if (cat === 'Basis Trading') return [
    { text: `Mint or deposit into ${p.name}'s yield-bearing product ${on} with ${money(ticket)}-${money(full)}; a basis product pays a funding-rate yield on top of points, so the position earns while it farms.`, cost: `${money(full)} deposited (earns funding yield) + ${gasLine(x, 2)}`, time: '15 min' },
    { text: `Stake or lock the receipt token where a points multiplier is offered, but only for a cooldown you accept: basis products often hold withdrawals 7 days or more when funding turns negative.`, cost: `${gasLine(x, 1)}; opportunity cost of a 7-day exit queue`, time: '5 min' },
  ];
  if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator') return [
    { text: `Deposit ${money(ticket)}-${money(full)} into a ${p.name}-curated USDC or ETH vault ${on}; a curator tracks balances per block, so time-weighted balance is what counts.`, cost: `${money(full)} deposited (earns the vault APY) + ${gasLine(x, 2)}`, time: '15 min' },
    { text: `Split across two of its vaults (a stablecoin and an ETH vault) rather than one: a curator spreading rewards across products tends to credit breadth of use.`, cost: gasLine(x, 2), time: '10 min' },
  ];
  if (sector === 'Yield & vaults') return [
    { text: `Deposit ${money(ticket)}-${money(full)} into ${p.name}'s largest ${cat.toLowerCase()} vault ${on}; the vault's own yield covers the gas while points accrue on the balance.`, cost: `${money(full)} deposited (earns the vault yield) + ${gasLine(x, 2)}`, time: '15 min' },
    { text: `Keep the vault's receipt token in the wallet that deposited (do not move it to a lending market unless that market is listed as boosted): off-protocol receipts often stop earning points.`, cost: '$0', time: '0 min, a rule to keep' },
  ];
  if (sector === 'RWA & CeDeFi') return [
    { text: `Check onboarding: many ${cat} products need KYC and a minimum subscription; if ${p.name} is permissionless ${on}, start at ${money(ticket)}, otherwise finish KYC before the clock starts.`, cost: '$0; KYC shares identity documents', time: '30 min to 3 days for KYC' },
    { text: `Subscribe ${money(ticket)}-${money(full)} to its main product and note its redemption terms (T+1 to T+30 is common for real-world assets): the airdrop clock runs on the held balance.`, cost: `${money(full)} held (earns the product's yield) + ${gasLine(x, 2)}`, time: '15 min' },
  ];
  if (cat === 'Chain') return [
    { text: `Bridge ${money(ticket)} to ${p.chains[0] ?? chain} through its canonical bridge, then use two or three of its top applications; a chain campaign rewards bridged value and distinct contracts used.`, cost: `bridge fee + ${gasLine(x, 6)}`, time: '45 min' },
    { text: `Keep part of the balance on the chain for the campaign: a chain's distribution usually checks a balance held at snapshot, not only activity.`, cost: '$0 beyond the capital parked', time: '0 min' },
  ];
  if (cat === 'Staking Pool' || cat === 'Restaking') return [
    { text: `Stake ${money(ticket)}-${money(full)} through ${p.name} ${on}; the receipt records your share, so keep it in the wallet that staked.`, cost: `${money(full)} staked (earns staking yield) + ${gasLine(x, 2)}`, time: '15 min' },
    { text: `Pick the operator or pool with the longest record, since slashing hits the pool you chose; stake only what you could leave locked for the unbonding period.`, cost: 'slashing risk on the stake', time: '15 min of reading' },
  ];
  return [
    { text: `Use ${p.name}'s main ${cat.toLowerCase()} product ${on} with ${money(ticket)}-${money(full)}: deposit where it takes deposits, or trade where it is a venue, and keep the position for the campaign instead of cycling in and out.`, cost: `${money(full)} put to work + ${gasLine(x, 2)}`, time: '20 min' },
    { text: `Try each of its other features once with under $100, since breadth of use is a common distribution criterion where a points programme's rules are not published.`, cost: `under $100 + ${gasLine(x, 4)}`, time: '20 min' },
  ];
}

// ---- the risk and the stop rule ---------------------------------------------------------------

/** The one risk that decides this plan, drawn from the protocol's own record. */
function headlineRisk(p: Protocol, v: Valuation, verdict: Verdict, sector: string, weeks: number): string {
  const cat = p.category ?? 'Uncategorised';
  if (verdict.flags.length) return `Token risk: ${verdict.flags[0]}.`;
  if (v.age !== null && v.age < 365) return `Smart contract: only ${Math.round(v.age / 30)} months tracked, so the record is short and a bug would take the deposit with it.`;
  if (sector === 'Credit') return 'Liquidation: a borrow or mint position can be liquidated on a fast move, and the points stop with the position.';
  if (sector === 'Trading') return 'Trading cost: fees and slippage are a certain cost against an uncertain drop.';
  if (/Basis|RWA|CeDeFi|Staking|Restaking|Risk Curators|Allocator/.test(cat)) return `Lockups: ${cat} products often queue withdrawals for days to weeks, so the capital is committed for the ${weeks}-week horizon.`;
  return 'No token is announced: the implied value is a model estimate, and a launch may never come.';
}

/** The rule that ends the plan, with the numbers from this protocol's own record. */
function exitRule(x: Ctx, f: { slice: number; odds: number; breakeven: number }): string {
  const floor = Math.round(x.p.tvl_usd * 0.85);
  const tail = f.breakeven >= 1 ? `it cannot break even at any odds (the position needs ${(f.breakeven * 100).toFixed(0)}% odds)` : `the model's break-even is ${Math.round(f.breakeven * 100)}% odds`;
  return `Stop if TVL stays under ${moneyShort(floor)} (15% below today's ${moneyShort(x.p.tvl_usd)}) for two straight weeks, or if no points programme is confirmed within ${x.weeks} weeks: withdraw to the ${money(x.ticket)} test ticket and wait, because ${tail}.`;
}

// ---- the plan ---------------------------------------------------------------------------------

export function plan(p: Protocol, v: Valuation, verdict: Verdict, sector: string, m: Fitted): Plan {
  const chain = cheapestChain(p.chains);
  const cheap = !HEAVY_CHAINS.has(chain);
  const gas = cheap ? 0.3 : 12;
  const per1k = Math.round((USER_SHARE * v.ifl * 1000) / p.tvl_usd * 100) / 100; // the slice per $1k if a token launches
  // Size: a test ticket, then a position that scales with confidence (a capped $10k at 95).
  const ticket = cheap ? 250 : 1000;
  const full = Math.max(ticket * 2, Math.round((v.confidence / 95) * 10) * 1000);
  const age = v.age;
  const weeks = age === null ? 16 : age < 180 ? 26 : age < 540 ? 16 : 12;
  const c7 = p.change_7d ?? 0;
  const cat = p.category ?? 'Uncategorised';
  const x: Ctx = { p, v, chain, cheap, gas, ticket, full, weeks, per1k, c7, age, cat };
  const share = (full / p.tvl_usd) * 1e4; // basis points of TVL a full position holds

  const pre = M.farm(m, p, v, verdict.flags.length, full, weeks, 0); // payout side only; costs come with the steps
  const steps: Step[] = [];
  steps.push({ text: `Open ${p.name}'s app from its DefiLlama listing (slug ${p.slug}), bookmark it, and match its contract addresses against its docs; this is a ${cat.toLowerCase()} record on ${p.chains.slice(0, 3).join(', ')}, so farm from one fresh wallet funded only for this.`, cost: '$0', time: '10 min' });
  steps.push(cheap
    ? { text: `Farm on ${chain}${p.chains.length > 1 ? ` (it also runs on ${p.chains.filter((c) => c !== chain).slice(0, 3).join(', ')})` : ''}: bridge ${money(ticket)} of USDC there first, since a ${cat.toLowerCase()} transaction costs about $${gas.toFixed(2)} and weekly actions stay cheap.`, cost: `$1-$5 bridge fee`, time: '15 min' }
    : { text: `Farm on ${chain}, its ${p.chains.length === 1 ? 'only' : 'main'} chain, where a ${cat.toLowerCase()} transaction costs about $${gas}: batch actions and keep at least ${money(ticket)} in so gas stays under 2% of the position.`, cost: `~$${gas * 2} to fund the wallet`, time: '15 min' });
  steps.push(...coreActions(sector, x));
  steps.push({ text: `Hold for ${weeks} weeks${age !== null ? ` (${p.name} has run ${Math.round(age / 30)} months with no token)` : ''}: ${money(full)} is ${share >= 1 ? share.toFixed(1) : share.toFixed(2)} bp of its ${moneyShort(p.tvl_usd)} ${cat.toLowerCase()} TVL, worth ${money(pre.slice)} if a token launches (${(USER_SHARE * 100).toFixed(0)}% to users, pro rata); the fitted odds of a launch within 12 months are ${Math.round(pre.odds * 100)}%, so about ${money(pre.expected)} expected.`, cost: `${gasLine(x, Math.ceil(weeks / 4))} for monthly top-ups`, time: `10 min a week, ${Math.round(weeks * 10 / 60)} h in all` });
  steps.push(c7 < -10
    ? { text: `Re-check TVL weekly: it fell ${c7.toFixed(1)}% in the last 7 days, so if it falls another 15% (below ${money(Math.round(p.tvl_usd * 0.85))}) withdraw to the test ticket and wait for a turn.`, cost: gasLine(x, 1), time: '5 min a week' }
    : c7 > 10
      ? { text: `Move early: TVL rose ${c7.toFixed(1)}% in 7 days, so the points pool is diluting fast; set the full ${money(full)} position inside the first week.`, cost: gasLine(x, 2), time: '15 min' }
      : { text: `Scale from the ${money(ticket)} test ticket to ${money(full)} once a first small withdrawal clears, so the exit path is tested before the money is.`, cost: gasLine(x, 3), time: '15 min' });

  // When each step happens: the first two on day 0, the protocol's actions in the first week, the hold through the horizon.
  const when = ['Day 0', 'Day 0'];
  steps.forEach((st, i) => { st.when = i < 2 ? when[i] : i === steps.length - 1 ? 'Days 7-14' : i === steps.length - 2 ? `Weeks 1-${weeks}` : 'Days 1-7'; });

  const txs = steps.reduce((s, st) => s + [...st.cost.matchAll(/\((\d+) tx\)/g)].reduce((a, m) => a + Number(m[1]), 0), 0);
  // Running fees the sector's actions carry over the horizon: perp trading fees, swap fees, borrow interest.
  const fees = Math.round(
    sector === 'Trading' && /Deriv|Perp|Option|Interest/.test(cat + p.name) ? 35 * weeks / 4.33
    : sector === 'Trading' && cat !== 'Prediction Market' ? 0.0015 * 600 * 2.5 * weeks
    : /Lending|Collateral/.test(cat) ? full * 0.35 * 0.07 * weeks / 52
    : 0);
  const total = Math.round(txs * gas + (cheap ? 3 : 24)) + fees;
  const f = M.farm(m, p, v, verdict.flags.length, full, weeks, total);
  const drop = f.expected, net = f.net;

  // The rule itself is RadarModel.priority (dashboard/00-model.js); here it is put into words.
  const priority: Priority = M.priority(verdict.flags.length, v.confidence, c7, net, total);
  const beText = f.breakeven >= 1 ? `it cannot break even at any odds (needs ${(f.breakeven * 100).toFixed(0)}%)` : `break-even ${Math.round(f.breakeven * 100)}% odds`;
  let why: string;
  if (verdict.flags.length > 0) why = `Skip: ${verdict.flags[0]}.`;
  else if (v.confidence < 40) why = `Skip: confidence ${v.confidence}/100 is too low to commit capital on.`;
  else if (net <= 0) why = `Skip: ${money(full)} expects about $${drop} (a $${f.slice} slice x ${Math.round(f.odds * 100)}% launch odds) against $${total} of gas and fees and $${f.tbill} of T-bill yield given up: ${beText}.`;
  else if (priority === 'farm now') { why = `Farm now: ${money(full)} nets about $${net} ($${drop} expected less $${total} gas and fees and $${f.tbill} of T-bill yield; ${beText}), confidence ${v.confidence}/100, TVL ${c7 >= 0 ? '+' : ''}${c7.toFixed(1)}% in 7d.`; }
  else { why = `Watch (thin): nets about $${net} on ${money(full)}${c7 <= -12 ? ` and TVL fell ${c7.toFixed(1)}% in 7d` : v.confidence < 55 ? ` at confidence ${v.confidence}/100` : ''}; enter on a points announcement or a turn in TVL.`; }
  const minutes = steps.reduce((s, st) => s + [...st.time.matchAll(/(\d+) min(?! a week)/g)].reduce((a, m) => a + Number(m[1]), 0), 0) + weeks * 10;

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
  return { priority, why, chain, per_1k: per1k, capital: [ticket, full], weeks, gas_usd: gas, total_cost: total, fees, drop, net,
    slice: f.slice, odds: f.odds, tbill: f.tbill, breakeven: f.breakeven, hours: Math.round(minutes / 6) / 10,
    main_risk: headlineRisk(p, v, verdict, sector, weeks), stop_rule: exitRule(x, f),
    gas: cheap ? `about $${gas.toFixed(2)} a transaction on ${chain}` : `about $${gas} a transaction on ${chain}`, steps, risks };
}

/** A step as one board string: what to do, then its cost and time. */
export function stepText(s: Step): string {
  return `${s.when === undefined ? '' : `${s.when}: `}${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
}