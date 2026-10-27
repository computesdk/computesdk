---
'@computesdk/cli': patch
---

`compute instances serve` — spawn a server, wait for its port to listen on a public address (via the platform `/ports` endpoint), and print the provider URL. Loopback-only binds fail with the 0.0.0.0 bind hint; a server that exits first reports its exit code and last log lines. `-q` prints only the URL.
