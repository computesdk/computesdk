---
'@computesdk/ec2-firecrab': patch
---

Pass the live conformance suite: accept a base64-encoded host PEM (`EC2_FIRECRAB_SSH_KEY`), let an explicit `apiUrl` win over env SSH targets, support `background` commands, run commands with `sh -c` instead of a login shell (image profile banners no longer leak into stdout), enforce command timeouts in the guest and report them as a non-zero exit instead of throwing, and surface ssh's own error when the API tunnel fails.
