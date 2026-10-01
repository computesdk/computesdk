---
"@computesdk/cli": patch
---

cli(market): `compute market replace <listing-id>` pauses a listing and evicts every live sale on it; `compute market replace --fill <fill-id>` evicts one sale. Evicted sales settle for seconds lived and an Actions job on the capacity re-places on the buyer's next provider. Replaced sales now show their state in `market book`.
