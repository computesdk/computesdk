---
"@computesdk/cli": patch
---

`compute actions dispatch` gains `--max-bid <usd>` and `--max-bid-per <second|minute|hour>`: an optional per-dispatch market price ceiling sent as `maxPriceUsd`/`maxPricePer`. Jobs that can't be filled at the price fall through to the next provider-order entry.
