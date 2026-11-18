---
"@computesdk/gravixlayer": patch
---

Add `sizeClass` support: all six tiers (`xs` through `2xl`) boot the per-size `base-*` templates (`base-xsmall` through `base-2xlarge`), `sizeTemplates` config overrides the tier names, and a missing mapped template fails with remediation guidance.

Accept `image` on create instead of throwing: it is a template name — `image: 'node:22'` boots the template named `node:22` — so a differing `templateId` is a conflict and a missing template fails with remediation guidance (`template.create` or `sizeTemplates`).
