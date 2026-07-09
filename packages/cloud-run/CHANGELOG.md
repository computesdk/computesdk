# @computesdk/cloud-run

## 0.1.5

### Patch Changes

- 1267b65: Configure the Cloud Run gateway setup command with benchmark-ready CPU, memory, concurrency, scaling, session affinity, and CPU boost settings.

## 0.1.4

### Patch Changes

- 90764f1: Use `sandbox do` for Cloud Run command execution instead of detached `run` sessions and `exec`.

## 0.1.3

### Patch Changes

- f2e71b2: Document that the remote Cloud Run gateway is intended to be publicly invokable and protected by the gateway secret.

## 0.1.2

### Patch Changes

- 96a248a: Use writable Cloud Run sandbox sessions in the gateway, fix bundled gateway resolution for setup, and add a credentialed smoke test.

## 0.1.1

### Patch Changes

- ec1be06: Add a Google Cloud Run Sandboxes provider and register it in the workbench provider list.

## 0.1.0

### Patch Changes

- Initial Cloud Run Sandboxes provider.
