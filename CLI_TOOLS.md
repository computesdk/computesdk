# API Key Management CLI Tools

This document describes the CLI tools for managing API keys in the ComputeSDK system.

## Overview

The ComputeSDK now uses API key authentication instead of sessions. These CLI tools allow you to manage API keys directly from the command line or via kubectl.

## Prerequisites

- Access to the Kubernetes cluster where ComputeSDK is deployed
- Database environment variables configured (see Environment Variables section)

## CLI Tools

### 1. keygen - Generate API Keys

Creates a new API key for authentication.

```bash
# Basic usage
./bin/keygen -name "My Development Key"

# With metadata
./bin/keygen -name "Production Key" -metadata '{"owner":"john@company.com","purpose":"production"}'

# With expiration (in seconds)
./bin/keygen -name "Temporary Key" -expires 86400  # 24 hours
```

**Options:**
- `-name`: Human-readable name for the API key (optional)
- `-metadata`: JSON metadata object (optional, default: `{}`)
- `-expires`: Expiration time in seconds (optional, 0 = never expires)
- `-db`: Database connection string (optional, uses DATABASE_URL env var)

**Output:**
```
✅ API Key created successfully!

ID:          key_abc123def456
Name:        My Development Key
Key:         csk_live_1234567890abcdef1234567890abcdef
Prefix:      csk_live_123456...
Status:      active
Permissions: [compute:create compute:manage]
Created:     2024-01-15 10:30:00 UTC

🔑 Save this API key securely - it won't be shown again!

📋 Usage:
   curl -H "Authorization: Bearer csk_live_1234567890abcdef1234567890abcdef" https://your-api/api/computes
```

### 2. keylist - List API Keys

Lists existing API keys with their status and metadata.

```bash
# List all API keys
./bin/keylist

# List only active keys
./bin/keylist -status active

# List with pagination
./bin/keylist -limit 10 -offset 20
```

**Options:**
- `-status`: Filter by status (`active`, `revoked`) (optional)
- `-limit`: Maximum number of keys to return (default: 25)
- `-offset`: Number of keys to skip (default: 0)

**Output:**
```
📋 Found 3 API key(s):

1. Production Key
   ID:          key_abc123def456
   Prefix:      csk_live_123456...
   Status:      active
   Permissions: [compute:create compute:manage]
   Metadata:    map[owner:john@company.com purpose:production]
   Created:     2024-01-15 10:30:00 UTC
   Last Used:   2024-01-15 14:22:15 UTC

2. Development Key
   ID:          key_def456ghi789
   Prefix:      csk_live_def456...
   Status:      active
   Permissions: [compute:create compute:manage]
   Created:     2024-01-14 09:15:30 UTC
```

### 3. keyrevoke - Revoke API Keys

Revokes an API key, making it unusable for authentication.

```bash
# Revoke with default reason
./bin/keyrevoke -id key_abc123def456

# Revoke with custom reason
./bin/keyrevoke -id key_abc123def456 -reason "Security incident - key compromised"
```

**Options:**
- `-id`: API key ID to revoke (required)
- `-reason`: Reason for revocation (optional, default: "Revoked via CLI")

**Output:**
```
🚫 API Key revoked successfully!

ID:       key_abc123def456
Name:     Production Key
Prefix:   csk_live_123456...
Status:   revoked
Reason:   Security incident - key compromised
Revoked:  2024-01-15 15:45:30 UTC

⚠️  This API key can no longer be used for authentication.
```

## kubectl Usage

You can run these tools directly in your Kubernetes cluster:

```bash
# Generate a new API key
kubectl exec -it deployment/computesdk-api -- /app/bin/keygen \
  -name "Production API Key" \
  -metadata '{"owner":"admin@company.com","environment":"production"}'

# List all API keys
kubectl exec -it deployment/computesdk-api -- /app/bin/keylist

# Revoke a compromised key
kubectl exec -it deployment/computesdk-api -- /app/bin/keyrevoke \
  -id key_abc123def456 \
  -reason "Key rotation"
```

## Environment Variables

The CLI tools require these environment variables to connect to the database:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_DATABASE=computesdk
POSTGRES_SCHEMA=computesdk_api
```

These are typically already configured in your Kubernetes deployment.

## API Key Format

API keys follow this format:
- **Production**: `csk_live_<32_hex_characters>`
- **Development**: `csk_test_<32_hex_characters>` (future)

Example: `csk_live_1234567890abcdef1234567890abcdef`

## Security Notes

1. **API keys are only shown once** during creation - save them securely
2. **Keys are hashed** in the database using bcrypt
3. **Revoked keys** cannot be reactivated - create new ones instead
4. **Monitor usage** via the `last_used_at` timestamp
5. **Rotate keys regularly** for security best practices

## Migration from Sessions

During the migration period, both session-based and API key authentication are supported:

```bash
# Session-based (old)
curl -H "Authorization: Bearer jwt_token" /api/computes

# API key-based (new)
curl -H "Authorization: Bearer csk_live_1234567890abcdef" /api/computes
```

The system will automatically detect the authentication type and handle accordingly.