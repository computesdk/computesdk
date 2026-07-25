---
"@computesdk/bench": patch
"@computesdk/bench-cli": patch
---

Remove `@computesdk/bench` and `@computesdk/bench-cli` from the monorepo.

The benchmark SDK has moved to its own repository at
https://github.com/computesdk/benchmarks and is now published under the
unscoped `benchmarks` package on npm. The vestigial `@computesdk/bench-cli`
package (no longer built or consumed) is removed alongside it. No provider
package behavior changes as a result of this cut.
