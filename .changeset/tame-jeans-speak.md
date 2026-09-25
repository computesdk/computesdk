---
"@computesdk/tensorlake": patch
---

Skip the line-less terminal event Tensorlake's follow streams emit at end-of-stream; interpolating it unconditionally appended a literal `undefined` line to every streamed command's stdout and stderr. Buffered output (`getStdout`/`getStderr`) is filtered the same way.
