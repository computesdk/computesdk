---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/vercel": patch
"@computesdk/blaxel": patch
"@computesdk/modal": patch
"@computesdk/daytona": patch
"@computesdk/agent37": patch
"@computesdk/archil": patch
"@computesdk/e2b": patch
"@computesdk/styne": patch
---

Add standard US regions (`us`, `us-east`, `us-central`, `us-south`, `us-west`) as an opt-in `regionClass` create option, with `provider.regions` placement declarations for Vercel, Blaxel, Modal, Daytona, Agent37, Archil, E2B and Styne. The hosted platform provider forwards `regionClass`.
