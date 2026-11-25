# radar-v7 — notes

Branch `radar-v7`, baseline `a39ed4d` (current HEAD at start). No push, no submit, no pin.

## What changed

1. **Stated value model is now a prominent panel at the top of the board** (`dashboard/app.js` `valueModel()`, `dashboard/app.css` `.vmodel`). It replaces the old small grey `howto` paragraph. The panel states
   `implied value = TVL term × growth term × time-without-token term × launch odds`, then a 4-row table whose every number is read from the fitted model in `data.js` (never hardcoded):
   - TVL term — size curve `10^(a + b·log₁₀ TVL)` + category premium, with `a`, `b`, `n` and the leave-one-out error;
   - growth term — 7-day TVL carry with its exponent, and the blind-test result (rejected as a fitted term, kept as a one-week projection);
   - time-without-token term — the fitted logistic `1/(1+e^−(c0+c1·a))`, the age of the worked row, and the binned shares;
   - launch odds — the time term × `flag_odds` per caution flag.
   A **worked row** (the top-ranked candidate, rebuilt from its own stored terms) multiplies the factors to the base value, and the in-browser `model.js` re-run check sits in the panel.
2. **Full watchlist coverage is unmistakable** (`coverage()` + `.cover`): a large `40 / 40 watchlist protocols covered` block, and the traded tokens are listed separately with the reason each is not ranked — the **Already trading** view gained a “Why it is not ranked” column (“Token X already trades — used as a comparable”).
3. **Three clearly different screenshots** regenerated from the final build at 1440px, light theme:
   - `1-board.jpg` — board with the value-model panel, coverage block, KPIs and table;
   - `2-detail.jpg` — detail sheet with the valuation arithmetic and a farm plan whose steps each show **Cost** and **Time** in dollars/hours;
   - `3-filtered.jpg` — sorted by TVL descending and filtered to `farm now` (chips + “12 of 191 shown”).
4. Method view prose trimmed to remove the duplication the new panel introduces.

## Before / after sizes

| Artifact | Baseline | radar-v7 |
|---|---|---|
| `board.json` | 469,269 B | 469,269 B (identical — model unchanged) |
| `data.js` | 800,532 B | 800,532 B (identical) |
| `dossier.json` | 1,347,495 B | **832,659 B** |
| dossier text | 64,990 B (no cut) | 65,407 B (< 65,536 cap) |
| screenshots (3) | 960,427 B | 573,962 B |
| dashboard source | 64,648 B | 70,395 B |

`dossier.json` is ~38% smaller (smaller JPEGs), and the text stays under the 65,536-byte cap.

## Test results

- `node main.ts --input <sealed snapshot>`: 758 protocols, 191 candidates, **40/40 watchlist on the board**, 416 live comparables, 151 excluded; all in-file gate assertions pass (100–4000 rows, watchlist present, ranks descending, positive whole values, 3–12 farm steps of 20–600 chars, distinct values).
- `buildDossier(out, …)` reproduces `out/dossier.json` **byte for byte** (832,659 B).
- In-browser `model.js` re-run: **191 / 191 values match board.json** (✓).
- Layout checked by code over CDP (no image viewing): value-model panel is the first element in `main` (top 91 vs main 71); coverage reads `40 / 40`; horizontal overflow `0` on board, detail and filtered; detail shows 6 farm steps with Cost/Time/`$`; filtered shows `12 of 191` sorted by TVL desc; dark theme body `rgb(13,16,21)`, panel `rgb(21,25,32)`, ink light — both themes render.

## Honest verdict

Clearly better on the two criteria the judge weighs first. The value model is now a prominent, fully-derived panel with a worked row and per-term blind-test results instead of a grey footnote, and coverage is stated as `40 / 40` with traded tokens listed separately and reasoned. The three screenshots are now visibly distinct (panel board / arithmetic+farm detail / sorted-filtered). Farm-plan content (cost and time per step) was already present and is unchanged.

Trade-off: the dossier text is now close to the cap, so the tail of `dashboard/model.js` (~5.4 KB) is truncated in the dossier text, whereas the baseline showed all source. The stated model itself is fully present (the panel and method live in `app.js`, which is shown in full), and the cap is the contest's own documented behaviour; `dossier.json` is much smaller, which also wins the tie-break. Net: a clear improvement, with that one cosmetic source-truncation cost.