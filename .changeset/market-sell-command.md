"@computesdk/cli": patch
---

`compute market` — the sell side of the compute market, for orgs the platform flags `market_provider` (same org API key as `compute actions`). Post listings with `market sell --price` (`--per` defaults to second), manage them with `listings`/`price`/`pause`/`resume`/`withdraw`, read the book with `market book`, payouts with `market settlements`, seller identity with `market status`, and connect the executor credential listings fill under with `market credential connect` (fields resolved from `<PROVIDER>_<FIELD>` env vars, e.g. `TENSORLAKE_API_KEY`).
