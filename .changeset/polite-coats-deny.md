---
"@computesdk/bench": patch
---

Add batch metric aggregate query helpers to the bench SDK query client.

- Add `getBatchMetricStats(batchId, { name, field, groupBy? })` to `BenchQueryClient`.
- Add `getBatchMetricCounts(batchId, { name, field })` to `BenchQueryClient`.
- Add `getBatchMetricTimeline(batchId, { name, field, interval?, agg? })` to `BenchQueryClient`.
- Add `BenchMetricDistribution`, `BenchGroupedMetricDistribution`, `BenchMetricCounts`, and `BenchMetricTimeline` types for aggregate responses.
- Export the new type from the public package entrypoint.
