---
"@computesdk/namespace": patch
---

feat(namespace): support `dockerSockPath` create option to mount the instance's managed dockerd socket

Setting `dockerSockPath` (e.g. `/var/run/docker.sock`) on `sandbox.create` sets `docker_sock_path` on the container, so containers can drive the instance's managed Docker daemon without needing elevated privileges to run dockerd inside the container.
