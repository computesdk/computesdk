---
"@computesdk/tenki": patch
"@computesdk/workbench": patch
---

Rebrand the Tenki provider as Luxor Agent Cloud. The package and provider id remain `tenki`/`@computesdk/tenki` for compatibility, while the provider exports `luxor`, accepts `LUXORAI_*` credentials and endpoint variables before the legacy `TENKI_*` fallbacks, and updates docs/metadata to luxor.ai.
