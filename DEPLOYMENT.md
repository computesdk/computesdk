# ComputeSDK Deployment Guide

This guide covers deploying ComputeSDK to various environments using a single unified configuration.

## Prerequisites

- Kubernetes cluster (local or cloud)
- kubectl configured
- Skaffold installed
- Docker installed

## Unified Deployment

ComputeSDK uses a single deployment configuration that works for both local development and production environments.

### Local Development (OrbStack/Minikube)

```bash
# Deploy to local cluster
skaffold run

# For development with auto-reload
skaffold dev
```

### Production Deployment (EKS)

```bash
# Deploy to EKS with ECR registry
skaffold run --default-repo=123456789.dkr.ecr.us-west-2.amazonaws.com

# For development against EKS
skaffold dev --default-repo=123456789.dkr.ecr.us-west-2.amazonaws.com
```

This will install:
- PostgreSQL Operator (Zalando)
- SeaweedFS Operator (for file storage)
- Prometheus Operator (for monitoring)

### 2. Deploy Core Services

```bash
# Deploy the main application
skaffold dev
```

This will:
- Build Docker images for API and Gateway
- Deploy PostgreSQL cluster
- Deploy ComputeSDK API with API key support
- Deploy Gateway service
- Set up ingress and RBAC

### 3. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -A

# Check services
kubectl get svc -A

# Check ingress
kubectl get ingress -A
```

### 4. Create Your First API Key

```bash
# Generate an API key for testing
kubectl exec -it deployment/computesdk-api -n computesdk-system -- ./keygen \
  -name "Development Key" \
  -metadata '{"owner":"admin","purpose":"development"}'
```

Save the returned API key - it will look like: `csk_live_1234567890abcdef1234567890abcdef`

### 5. Test the API

```bash
# Test API key authentication
curl -H "Authorization: Bearer csk_live_YOUR_KEY_HERE" \
     http://localhost/api/computes

# Create a compute instance
curl -H "Authorization: Bearer csk_live_YOUR_KEY_HERE" \
     -H "Content-Type: application/json" \
     -X POST http://localhost/api/computes \
     -d '{"preset_id": "default"}'

# List your computes
curl -H "Authorization: Bearer csk_live_YOUR_KEY_HERE" \
     http://localhost/api/computes
```

## API Key Management

### Generate New Keys
```bash
kubectl exec -it deployment/computesdk-api -n computesdk-system -- ./keygen \
  -name "Production Key" \
  -metadata '{"owner":"user@company.com","environment":"production"}'
```

### List Existing Keys
```bash
kubectl exec -it deployment/computesdk-api -n computesdk-system -- ./keylist
```

### Revoke Compromised Keys
```bash
kubectl exec -it deployment/computesdk-api -n computesdk-system -- ./keyrevoke \
  -id key_abc123def456 \
  -reason "Key rotation"
```

## Authentication

The system uses API key-based authentication exclusively:

```bash
# API key authentication (required)
curl -H "Authorization: Bearer csk_live_1234567890abcdef" /api/computes
```

## Troubleshooting

### Check API Logs
```bash
kubectl logs -f deployment/computesdk-api -n computesdk-system
```

### Check Database Connection
```bash
kubectl exec -it deployment/computesdk-api -n computesdk-system -- ./keylist
```

### Restart Services
```bash
kubectl rollout restart deployment/computesdk-api -n computesdk-system
```

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │────│   ComputeSDK    │────│   Kubernetes    │
│   (Port 80)     │    │   API Server    │    │   Compute Pods  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌─────────────────┐
                       │   PostgreSQL    │
                       │   (API Keys +   │
                       │   Event Store)  │
                       └─────────────────┘
```

## Next Steps

1. **Test thoroughly** with API keys
2. **Create API keys** for your users
3. **Monitor usage** via `last_used_at` timestamps
4. **Plan session removal** once API keys are fully adopted
5. **Set up monitoring** with Prometheus/Grafana

Your ComputeSDK is now ready for production use with secure API key authentication! 🚀