# API Key Management with keyctl

The `keyctl` tool provides in-cluster API key management functionality that can be accessed via `kubectl exec`.

## Overview

Instead of using separate CLI scripts, you can now manage API keys directly from within the running API pod using the `keyctl` command. This provides a more secure and convenient way to manage keys without needing direct database access.

## Usage

You have two options for using the key management functionality:

### Option 1: Local CLI Wrapper (Recommended)

Build and use the local CLI wrapper that uses kubectl exec under the hood:

```bash
# Build the CLI wrapper
./build-cli.sh

# Use the CLI wrapper (same commands, simpler syntax)
./bin/computesdk-cli <command> [options]
```

### Option 2: Direct kubectl exec

```bash
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl <command> [options]
```

### Available Commands

#### Create a new API key
```bash
# Using CLI wrapper (recommended)
./bin/computesdk-cli create -name "My API Key"

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl create -name "My API Key"
```

With metadata and expiration:
```bash
# Using CLI wrapper
./bin/computesdk-cli create \
  -name "Production Key" \
  -metadata '{"environment":"prod","team":"backend"}' \
  -expires 2592000

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl create \
  -name "Production Key" \
  -metadata '{"environment":"prod","team":"backend"}' \
  -expires 2592000
```

#### List API keys
```bash
# Using CLI wrapper
./bin/computesdk-cli list
./bin/computesdk-cli list -status active
./bin/computesdk-cli list -limit 10 -offset 0

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl list
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl list -status active
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl list -limit 10 -offset 0
```

#### Get details of a specific key
```bash
# Using CLI wrapper
./bin/computesdk-cli get -id key_abc123

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl get -id key_abc123
```

#### Revoke an API key
```bash
# Using CLI wrapper
./bin/computesdk-cli revoke -id key_abc123 -reason "No longer needed"

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl revoke \
  -id key_abc123 \
  -reason "No longer needed"
```

#### Get help
```bash
# Using CLI wrapper
./bin/computesdk-cli help

# Using kubectl exec directly
kubectl exec -n computesdk-system deployment/computesdk-api -- ./keyctl help
```

## Interactive Shell

For multiple operations, you can start an interactive shell:

```bash
kubectl exec -it -n computesdk-system deployment/computesdk-api -- /bin/sh
```

Then run keyctl commands directly:
```bash
./keyctl create -name "Test Key"
./keyctl list
./keyctl revoke -id key_abc123 -reason "Testing complete"
```

## API Endpoints (Alternative)

The API also exposes HTTP endpoints for key management at `/api/keys` (requires authentication):

- `POST /api/keys` - Create a new API key
- `GET /api/keys` - List API keys
- `GET /api/keys/:id` - Get a specific API key
- `DELETE /api/keys/:id` - Revoke an API key

## Security Notes

- The `keyctl` tool connects directly to the same database as the API service
- All operations are logged and audited through the event store
- API keys are only shown in full during creation - they cannot be retrieved later
- Revoked keys cannot be reactivated

## CLI Wrapper Benefits

The local CLI wrapper (`computesdk-cli`) provides the best user experience:

- **Simpler syntax**: No need to type long kubectl exec commands
- **Same security**: Still uses kubectl exec under the hood
- **Environment support**: Set `COMPUTESDK_NAMESPACE` to use different namespaces
- **Familiar UX**: Works like any other CLI tool

## Migration from Old CLI Tools

The old CLI tools (`keygen`, `keylist`, `keyrevoke`) have been removed and replaced with:
1. **In-cluster `keyctl` tool**: Runs inside the API pod via kubectl exec
2. **Local CLI wrapper**: `computesdk-cli` that wraps kubectl exec calls

The functionality is identical but now runs in-cluster for better security and convenience.