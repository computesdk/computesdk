# Debian Trixie with Node.js and the helper that @cloudflare/sandbox runs for
# file operations. Sandboxes created without an `image` land here, so the base
# needs the Node.js runtime `cloudflare/debian-trixie` used to carry.
# Keep the cloudflare/sandbox tag equal to the installed @cloudflare/sandbox version.
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl procps \
    && rm -rf /var/lib/apt/lists/*
CMD ["sleep", "infinity"]
