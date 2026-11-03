---
"@computesdk/beam": patch
"@computesdk/blaxel": patch
---

Propagate sandbox lookup and deletion failures, validate native identities and
require documented native completion acknowledgements. Beam no longer treats
unclassified connection failures as absence or reconnects an already connected
lookup handle for readiness. Blaxel recognizes its documented parsed 404 error
body and validates returned sandbox metadata without guessing lifecycle states.
