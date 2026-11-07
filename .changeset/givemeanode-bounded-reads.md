---
"@computesdk/givemeanode": patch
---

Read files above the exec output limit in bounded base64 chunks without splitting UTF-8 characters or returning truncated content. Encode large writes one command at a time instead of retaining the complete base64 command list.
