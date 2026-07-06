---
"@computesdk/browseruse": patch
---

Return wss:// CDP connect URLs. The Browser Use API returns an https:// cdpUrl, which makes CDP clients such as Playwright perform an extra /json/version discovery request before opening the websocket. Rewriting the scheme to wss:// lets clients connect to the websocket directly.
