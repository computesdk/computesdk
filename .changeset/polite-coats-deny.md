---
"@computesdk/bench": patch
---

Add a batch metric distribution query helper to the bench SDK query client.

- Add `getBatchMetricStats(batchId, { name, field })` to `BenchQueryClient`.
- Add `BenchMetricDistribution` type for distribution responses.
- Export the new type from the public package entrypoint.
