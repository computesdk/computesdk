---
"@computesdk/tensorlake": patch
---

Retry the writable-workdir probe before falling back to "/". Right after create() the exec endpoint can lag the sandbox's reported readiness, so a single failed probe sent relative runCommand calls to an unwritable "/" cwd.
