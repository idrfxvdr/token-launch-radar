# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/idrfxvdr/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/idrfxvdr/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A deterministic, offline token launch radar for make.fun's token-radar-01 bounty. `main.ts` reads the sealed DefiLlama snapshot, separates protocols whose token trades (the comparables) from wrapped, staked, bridged and versioned records (excluded, with a reason) and from the pre-token candidates, which it ranks by an implied launch value: a log-log size curve fitted on every tokenised peer, a category premium shrunk toward its sector, and stated adjustments for 7-day TVL momentum, time with no token, chain breadth and caution flags. Every row carries a low/base/high range, a confidence score with its parts, and a farm plan written from the protocol's own category, chains, TVL and trend.

The dashboard (`dashboard/`, no network, no framework) has a sortable, filterable board, a detail view per protocol with the valuation arithmetic, a market-cap/TVL chart against the comparables, the peers used, the farm checklist and its risks, plus Already trading, Excluded and Method views. Light and dark themes; works at phone width.

| Path | What it is |
|---|---|
| `main.ts` | entrypoint: reads `/input/snapshot.json`, writes `/output` |
| `lib/classify.ts` | live / candidate / excluded, with reasons and caution flags |
| `lib/value.ts` | the valuation model and confidence |
| `lib/plans.ts` | farm plans and priority (farm now / watch / skip) |
| `dashboard/` | the static page |
| `vendor/makefun-board.ts` | make.fun's dossier library, unchanged |

Estimates, not financial advice: a protocol that records no token on DefiLlama may still have one, and no launch is implied.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
# then open out/dashboard/index.html
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=7q24zjch&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
