---
"daemond": patch
---

Bootstrap Node on musl x64 (Alpine, `docker:dind`) from the pinned, sha256-verified unofficial-builds `linux-x64-musl` tarball, installing `libstdc++` via `apk` when available. Overridable with `DAEMOND_NODE_MUSL_DIST_URL`; cached separately from glibc builds. musl arm64 still fails closed with a clear error.
