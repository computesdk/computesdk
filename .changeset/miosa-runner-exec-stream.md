---
"@computesdk/miosa": patch
---

Run runner execs over exec/stream instead of buffered exec. The buffered request dies on the transport's 30s deadline no matter the command's own timeout, so installs and builds read as failures and the abandoned server-side exec then refuses destroy with SANDBOX_BUSY. Also retry a SANDBOX_BUSY destroy briefly: it is a refusal while a lifecycle op drains, not an attempted delete, so a bounded retry turns the drain window into a clean teardown instead of a leaked sandbox.
