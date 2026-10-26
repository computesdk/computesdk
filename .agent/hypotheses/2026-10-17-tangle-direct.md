# Direct Tangle HTTP/2 lifecycle

The fixed decision is median client-only W <=60 ms in nine fresh-process candidate
bursts, alternated with nine bursts of 59e5d5ac on ruler-iad-01. Every burst must
complete 100 creates, blocking commands and deletes without unexpected requests.
The pinned ruler, not the package's older standalone latency script, decides this.

Evidence: the SDK's installed create/exec and private error-parser implementations;
the adapter's existing real-socket test; retained ruler `direct-ab/` pilot artifacts.
A fresh baseline pilot measured W 111.82 ms. An adapter with plain requests but
immediate per-stream completion still measured roughly 80–98 ms. A bare provider
inside the same harness measured 77.43 ms. Batching buffered response completion
on the next event-loop turn reduced bare-control pilot W to 51.79, 62.04 and
55.38 ms. Adapter pilots then approached, but did not establish, the target.
These are diagnostic samples, not the acceptance population.

Keep: adapter-owned normalized requests, strict receipt/incarnation/readiness
checks, SDK error classes, owned-only cleanup, native handles on demand, one shared
four-session pool, and batched buffered completion. Reuse the configured endpoint
and the equivalent one-shot SHA-256 identity operation.

Reject: a lazy Proxy (Promise assimilation materialized the SDK through `then`),
readiness/retry machinery on the successful lifecycle, speculative shared deadline
scheduling and session-timer changes without a reliable measured gain. Retain
per-request header/body deadlines, cancellation, and the original pool lifecycle.

Risks: private SDK protocol mappings may drift when its dependency pin changes;
batching adds one event-loop turn to a single response. The built API socket suite
checks refusal/cleanup, ordinary commands, native operations and cold ESM/CJS use.
The original socket suite also covers direct requests sharing the same pool.

An order-of-magnitude speedup would require removing round trips or server work;
those would change this task's required create/spawn/delete contract. The unresolved
question is the final nine-run median under interleaving, not a best pilot score.
Freeze the candidate tarball, verify each installed arm's digest, alternate A/B nine
times, retain every result, and stop on the fixed acceptance decision. No keyed
runs, Beelinks, local installs, external review, or push are authorized in this lane.

The first frozen comparison failed: candidate median W 70.9275 ms versus baseline
110.239 ms, all 1,800 lifecycles clean. Preserve it separately from the final
comparison. A final candidate caches immutable URL fields and moves receipt
normalization off successful creation without dropping any required check. Its
self-review also preserves native errors for invalid create timeout arguments.
The same nine-pair rule decides this candidate; a miss remains a failed run.
