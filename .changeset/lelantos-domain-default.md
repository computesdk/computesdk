---
'@computesdk/lelantos': patch
---

Fix out-of-the-box connectivity for the Lelantos provider. Previously, with no `domain` configured (the README Quick Start path), the underlying e2b SDK silently fell back to api.e2b.app and every call failed with "Lelantos authentication failed"; `domain` now defaults to `lelantos.ai` as documented. Also, native `lel_<hex>` API keys are now re-prefixed to their `e2b_<hex>` alias before reaching the e2b SDK, whose client-side key-format validation (`^e2b_[0-9a-f]+$`, enforced since e2b v2.27) rejected them — the Lelantos control plane resolves both forms to the same key.
