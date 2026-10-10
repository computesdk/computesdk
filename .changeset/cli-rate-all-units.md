---
'@computesdk/cli': minor
---

Print every human-readable rate in all three units, per hour first (`$0.1008/hr · $0.00168/min · $0.000028/s`). Covers `sandboxes create/get/list/quote` (placement rate, cap, protection limit, cheapest live, reference), `market book/listings/sell/price` (asks, bids, fills, queued rates). Rates print with up to 4 significant decimals, never scientific notation; money amounts (balances, costs, holds, credits, settlements) print as `formatMoney` — always 2 decimals with thousands separators (`$1,234.56`), keeping 4 significant digits only for non-zero amounts under $0.01.
