---
'@computesdk/mosaic': patch
---

Read and write files of any size through ranged and staged files-API requests instead of oversized exec bodies, read through symlinks, and expose native `pause()`/`resume()` on the sandbox handle.
