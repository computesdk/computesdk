---
"@computesdk/cli": minor
---

Sell into the sandbox market lane: `compute market sell --use-case <actions|sandbox>` (default `actions`) posts a listing into that lane — the principal must be approved for it (`market_lane_not_approved`); `market book --use-case` filters the book to one lane; `market listings` shows each listing's lane column and `market status` shows the principal's approved lanes. `sell`/`price` now require a unit on `--price` — `--price 0.12/hour` or `--price 0.12 --per hour` — matching `--max-price`.
