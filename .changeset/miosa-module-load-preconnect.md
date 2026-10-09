---
'@computesdk/miosa': patch
---

Open the HTTP/2 pool when the module is imported, so a caller that constructs the provider inside its own timer does not pay the first connection's handshake on its first request. Sessions stay idle-unref'd, so a script that imports the provider still exits on its own, and `MIOSA_PRECONNECT=0` opts out. A pool that no request uses (for example when the provider is given a different `baseUrl`) is closed after an idle timeout, and `closeMiosaConnections()` also cancels a preconnect that is still starting up.
