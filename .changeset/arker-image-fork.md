---
"@computesdk/arker": patch
---

`sandbox.create({ image })` now forks from the given OCI image reference instead of ignoring it and falling back to the default golden. Arker's `fork` accepts `image` directly and converts the rootfs server-side, so creates like `create({ image: "ubuntu:24.04" })` boot that image as documented.
