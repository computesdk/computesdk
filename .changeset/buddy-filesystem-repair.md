---
"@computesdk/buddy": patch
---

Make directory creation idempotent only for verified existing directories, preserve parent-directory errors when writing files, and resolve symlinks before native downloads so reads return the target contents before and after snapshots.
