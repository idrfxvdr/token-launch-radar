// Snapshot reading and classification: which protocols record a token, which are pre-token candidates,
// and which pre-token records are really a product of a token that already trades (excluded, with a reason).
// Every rule here reads the snapshot's own ten fields; no protocol is named in code.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** live: a token is recorded; candidate: pre-token and on the radar; excluded: pre-token record, but a product of a traded token. */
export type Status = 'live' | 'candidate' | 'excluded';

export interface Verdict {
  status: Status;
  /** One sentence: why it is (or is not) a pre-token launch candidate. */
  reason: string;
  /** Caution flags kept on a candidate (house watchlist rows we doubt stay on the board, flagged). */
  flags: string[];
  /** The traded token this record belongs to, when a family match found one. */
  family?: string;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}

/** Categories whose records are wrapped, staked, bridged or custodial forms of an asset that already trades. */
const DERIVATIVE_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX', 'Anchor BTC']);
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini', 'htx', 'kucoin', 'gate', 'mexc', 'crypto.com'];
const DERIVATIVE_WORDS = /\b(wrapped|staked|staking|restaked|bridged|liquid staking)\b/i;
const VERSION = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
/** Words too generic to tie two protocols into one family. */
const GENERIC = new Set(['the', 'liquid', 'finance', 'protocol', 'money', 'capital', 'labs', 'network', 'dao', 'swap', 'yield', 'vault', 'vaults', 'pool', 'pools', 'lend', 'earn', 'staking', 'bridge', 'exchange', 'markets', 'market', 'stable', 'usd', 'btc', 'eth', 'sol', 'open', 'base', 'one', 'pro', 'prime', 'core', 'x']);

/** The family key of a name: its first word, lower-case, stripped of punctuation, or null when generic or short. */
export function familyKey(name: string): string | null {
  const first = name.toLowerCase().replace(VERSION, '').split(/[\s\-_.:()/]+/).find((w) => w.length > 0) ?? '';
  const word = first.replace(/[^a-z0-9]/g, '');
  return word.length >= 4 && !GENERIC.has(word) ? word : null;
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/**
 * Classify every protocol. A family is the set of protocols that share a family key; a pre-token member of a
 * family whose other member records a token (Uniswap V4 beside UNI's Uniswap V3) is that token's product.
 */
export function classify(snap: Snapshot): Map<string, Verdict> {
  const tokenOf = new Map<string, string>();
  for (const p of snap.protocols) {
    const key = familyKey(p.name);
    if (key !== null && hasToken(p) && !tokenOf.has(key)) tokenOf.set(key, p.symbol ?? p.gecko_id!);
  }
  const house = new Set(snap.watchlist);
  const out = new Map<string, Verdict>();
  for (const p of snap.protocols) {
    if (hasToken(p)) {
      out.set(p.slug, { status: 'live', reason: `Records the token ${p.symbol ?? p.gecko_id}${p.mcap_usd ? ` with a $${short(p.mcap_usd)} market cap` : ' (no market cap recorded)'}: already launched, used as a comparable.`, flags: [] });
      continue;
    }
    const lower = p.name.toLowerCase();
    const key = familyKey(p.name);
    const family = key === null ? undefined : tokenOf.get(key);
    const excluded: string | null =
      p.category !== null && DERIVATIVE_CATEGORIES.has(p.category) ? `${p.category} record: a wrapped, staked, bridged or custodial form of an asset that already trades.`
      : EXCHANGES.some((e) => lower.startsWith(e)) ? 'Named after a centralised exchange: an exchange product, not a protocol waiting on a token.'
      : DERIVATIVE_WORDS.test(p.name) ? 'Its name marks it as a wrapped or staked product of an existing asset.'
      : family !== undefined ? `Shares its name with a protocol that already trades ${family}: a version or deployment of that token's protocol.`
      : VERSION.test(p.name) ? 'A versioned deployment (its name ends in a version marker) of an older protocol.'
      : null;
    const flags: string[] = [];
    // A protocol named after one of the chains it runs on is that chain's native app: its gas token is the token.
    const ownChain = key === null ? undefined : p.chains.find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key));
    if (ownChain !== undefined) flags.push(`chain-native: named after the chain it runs on (${ownChain}), whose gas token already trades`);
    if (p.category === 'Chain') flags.push('a chain: its value accrues to the chain\'s gas token, not an app airdrop');
    // A CDP usually launches a governance token beside its stablecoin, so only a name or category that IS the stablecoin flags.
    if (p.category === 'Stablecoin Wrapper' || /^usd|usd$|\busd\w*\b/i.test(p.name)) flags.push('stablecoin issuer: the record is the stablecoin itself, which is not a launch token');
    if (excluded !== null && !house.has(p.slug)) {
      out.set(p.slug, { status: 'excluded', reason: excluded, flags, family });
      continue;
    }
    if (excluded !== null) flags.push(excluded);
    const reason = house.has(p.slug)
      ? `On the house watchlist: $${short(p.tvl_usd)} TVL at or above the $${short(snap.floor_usd)} floor, no token recorded, and no wrapped, staked or bridged marker.`
      : `Below the watchlist floor or outside it, but records no token and passes the radar's own product filter: an early candidate.`;
    out.set(p.slug, { status: 'candidate', reason, flags, family });
  }
  return out;
}

export function short(n: number): string {
  const a = Math.abs(n);
  return a >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`;
}
