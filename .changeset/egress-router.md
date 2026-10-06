---
"computesdk": patch
"@computesdk/provider": patch
"daemond": patch
"@computesdk/givemeanode": patch
---

feat: sandbox egress router — `egress` option on `CreateSandboxOptions` plus a self-contained on-box MITM shim that terminates TLS for credentialed hosts and relays decrypted requests to an off-box credential injector; `sandbox.egress` reports `{ proxyUrl, caCertPath }` and `sandboxEgressEnvVars()` maps it to `HTTPS_PROXY`/`ALL_PROXY`/CA cert env vars
