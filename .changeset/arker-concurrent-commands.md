---
'@computesdk/arker': patch
---

Commands that run at the same time on an Arker sandbox now run concurrently instead of one after another: a command that starts while another is still running gets an Arker session of its own. Commands run one after another still share one shell, so a `cd` carries into the next.
