---
"@computesdk/tenki": patch
"@computesdk/workbench": patch
---

Rebrand the Tenki provider as Luxor. The package and provider id remain `tenki`/`@computesdk/tenki` for compatibility, while the provider exports `luxor`, prefers `LUXOR_*` credentials and endpoint variables with `LUXORAI_*`/`TENKI_*` fallbacks, and updates docs/metadata to luxor.ai.
