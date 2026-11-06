# Node.js 24 with common tools for building software.
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
# The package lists stay in the image so that a later apt-get update only
# revalidates them.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash build-essential ca-certificates curl git procps python3 python3-setuptools unzip
CMD ["sleep", "infinity"]
