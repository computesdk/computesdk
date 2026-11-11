# Ubuntu 24.04 — the OCI boot benchmark's reference image — with the helper
# that @cloudflare/sandbox runs for file operations.
# Keep the cloudflare/sandbox tag equal to the installed @cloudflare/sandbox version.
FROM ubuntu:24.04
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl procps \
    && rm -rf /var/lib/apt/lists/*
CMD ["sleep", "infinity"]
