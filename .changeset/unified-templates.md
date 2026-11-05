---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/test-utils": patch
---

Unified templates: `template.create({ name, image | dockerfile })` returns a normalized `TemplateInfo` (`id`, `name`, `provider`, `digest?`, `createdAt?`, `raw?`) on providers whose `methods.template` declares `capabilities` (`externalImages`, `sources`). On a provider with `externalImages: false`, `instances.create({ image })` throws a `TemplateError` (`code: 'unsupported'`) pointing at `template.create`. Adds the opt-in `runTemplateTestSuite` conformance group to `@computesdk/test-utils`. Providers without declared capabilities are unchanged.
