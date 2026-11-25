# radar-v7 — notes

Branch `radar-v7`, cut from `main` at `a39ed4d` (baseline = current HEAD). No push, no submit, no pin.

## What changed

1. **Stated value model is now a prominent panel at the top of the board** (`dashboard/app.js` `valueModel()`, `dashboard/app.css` `.vmodel`).
   - Header states the model: `implied value = TVL term × growth term × time-without-token term × launch odds`.
   - A 4-row table gives each term's fitted number **read from `window.RADAR`** (never hardcoded): the size curve `10^(a + b·log₁₀ TVL)` + category premium, the 7-day carry exponent, the logistic time fit `1/(1+e^−(c0+c1·a))` with the age bins, and the final launch odds.
   - The "how it was tested" column is computed from `R.tests` (leave-one-out on the token families): each term is shown as kept/rejected against the size-curve error.
   - One **worked row** (the top-ranked candidate, `rows[0]`) multiplies the four factors to the base value and shows the low–high range.
   - The old small grey `howto` paragraph is gone; the in-browser `model.js` re-run check (`✓ 191 / 191 values match board.json`) moved into the panel.
2. **Full watchlist coverage is unmistakable** (`coverage()` + `.cover`): a large `40 / 40 watchlist protocols covered` figure with "every house slug is ranked below", plus a line stating that the traded tokens are listed separately with the reason each is not ranked, and the excluded records with their reason.
   - The **Already trading** view now has a "Why it is not ranked" column (token already trades → comparable).
3. **Three clearly different screenshots** (`screenshots/1-board.jpg`, `2-detail.jpg`, `3-filtered.jpg`), regenerated from the final build at 1440 px:
   - board with the value-model panel + coverage + KPIs + table;
   - detail sheet with the valuation arithmetic and a farm plan whose steps each carry **Cost** and **Time** (and `$`);
   - a sorted + filtered state (`sort=tvl desc`, `priority: farm now`, "12 of 191 shown", chips visible).
4. `dashboard/model.js`, `lib/*`, `main.ts` and the model maths are **unchanged**; `board.json` and `data.js` are byte-identical to baseline.

## Before / after sizes

| Artifact | Baseline | After |
|---|---|---|
| `board.json` | 469,269 | 469,269 (identical) |
| `data.js` | 800,532 | 800,532 (identical) |
| `dashboard/` source (4 files) | 64,648 | 70,395 |
| dossier **text** | 64,990 | 65,407 (cap 65,536) |
| `dossier.json` | 1,347,495 | **832,659** |
| screenshots (3 jpg) | 960,427 | 573,962 |

`dossier.json` is ~38% smaller (smaller screenshots), so it also wins the size tie-break.

## Test results

- `node main.ts --input <sealed snapshot>`: `758 protocols; 191 candidates ranked (40 on the watchlist), 416 live tokens as comparables, 151 excluded`. All in-file gate assertions pass (100–4000 rows, every watchlist slug on the board, ranks descending, positive whole values, 3–12 farm steps of 20–600 chars, not all values equal).
- `buildDossier(out, …)` reproduces `out/dossier.json` **byte for byte** (832,659 bytes).
- In-browser `model.js` re-run (headless Chromium): `✓ 191 / 191 values match board.json`.
- Layout checked by code (CDP geometry, not by eye): value-model panel is the first element in `main` (`modelTop` 91 vs `mainTop` 71); coverage reads `40 / 40`; horizontal overflow `0` on board, detail and filtered views; detail shows 6 farm steps with Cost/Time/`$`; filtered shows `12 of 191` sorted by TVL descending.
- Both themes: light `body` `rgb(245,242,234)` / panel `rgb(255,253,247)`; dark `body` `rgb(13,16,21)` / panel `rgb(21,25,32)` / ink `rgb(233,230,223)`.

## Honest verdict

Clearly better on the two criteria the judge weighs first. The value model is no longer a grey footnote: it is a prominent panel with the fitted numbers, a worked row and a per-term test result, all derived from the data. Coverage is now explicit (`40 / 40`, traded tokens separated with reasons). The three screenshots are clearly distinct and the detail shot shows the farm plan's cost and time per step. `dossier.json` is much smaller.

Trade-off, stated plainly: the dossier text is now close to the 65,536-byte cap, so the tail of `dashboard/model.js` (the `value`/`farm`/`priority` functions) is truncated in the text by ~5.4 KB, whereas the baseline showed every source file whole. The cap is the contest's own limit and the truncation is the library's documented behaviour; the model statement itself is fully present in `app.js` (the panel and the Method view) and in the board screenshot. Everything else is a strict improvement.