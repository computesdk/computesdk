---
"computesdk": patch
---

Add a sandbox filesystem test to the `computesdk` core package that exercises `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, and `remove` through `compute.sandbox.create()`. The test runs against an in-memory provider by default and can be run against any sandbox provider by setting `COMPUTESDK_INTEGRATION=1` and `TEST_PROVIDER`.
