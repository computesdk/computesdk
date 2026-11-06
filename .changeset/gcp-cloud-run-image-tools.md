---
'@computesdk/gcp': patch
---

Cloud Run: declare the rootfs snapshot capabilities proven against a deployed gateway. Setup reuses `CLOUD_RUN_SANDBOX_SECRET` when set, passes `CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS` through, routes traffic to the new revision, and builds the sandbox image with `git`, `python3`, `unzip`, `curl` and CA certificates, keeping apt package lists, running apt downloads as root and adding a `sudo` shim, so root sandboxes can `apt-get install` more. The gateway no longer reaps a sandbox while a command is running, and `0` disables idle cleanup.
