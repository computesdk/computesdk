---
'@computesdk/cli': patch
---

Market book privacy: the order book no longer exposes buyer org ids — `MarketBook` bids carry `mine` instead of `organizationId`, and `market book` prints "(yours)" on your own open offers.
