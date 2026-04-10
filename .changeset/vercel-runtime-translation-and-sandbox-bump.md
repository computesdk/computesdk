---
"@computesdk/vercel": patch
---

Fix generic runtime name handling and improve `runCommand` performance:

- Translate generic runtime names (`node`, `python`) to Vercel-supported versions (`node24`, `python3.13`) so the default provider runtime works end-to-end.
- Use builtin `@vercel/sandbox` stdout/stderr pipes to avoid blocking `runCommand`.
- Bump `@vercel/sandbox` to `^1.9.3`.
