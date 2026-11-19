---
'@computesdk/sandbox0': patch
---

Support standard sandbox sizes `xs` (claimed at 2 GiB for a whole vCPU) through `xl` via claim-time memory overrides, including template and snapshot claims. Reject unsupported sizes before claiming a sandbox.
