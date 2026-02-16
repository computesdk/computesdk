---
"computesdk": patch
---

Fix filesystem operations for absolute paths

The `encodeFilePath` function was incorrectly stripping the leading slash from absolute paths, causing `readFile`, `getFile`, `deleteFile`, and `checkFileExists` to fail when using absolute paths like `/tmp/foo.txt`.

Before: `readFile("/tmp/foo.txt")` would send `GET /files/tmp/foo.txt` (relative path)
After: `readFile("/tmp/foo.txt")` now sends `GET /files//tmp/foo.txt` (absolute path preserved)

This fix ensures the server can correctly distinguish between absolute and relative file paths.
