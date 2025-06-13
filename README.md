# ComputeSDK - On-Premise Code Generation Platform

ComputeSDK is a Kubernetes-native platform for running isolated code execution environments on-premise. It provides secure, dynamically-provisioned compute instances with features like persistent file systems, secret management, and real-time terminal access.

## Features

- **Dynamic Compute Provisioning**: Create isolated containers on-demand for code execution
- **File System Management**: Archive and mount persistent file systems across compute instances
- **Secret Management**: Secure storage and injection of credentials via WorkOS Vault
- **Group-Based Organization**: Organize resources into logical groups with shared access
- **Real-Time Operations**: WebSocket-based terminal access, file editing, and live updates
- **Event Auditing**: Complete audit trail of all resource changes and operations

## Architecture

The platform consists of three main services:

### API Service
- RESTful API for managing compute instances, filesystems, secrets, and groups
- JWT-based authentication with API key support
- Event sourcing for audit logging
- PostgreSQL backend with GORM ORM

### Gateway Service
- Single entry point for all external traffic
- Proxies HTTP and WebSocket connections to compute pods
- Manages pod lifecycle through Kubernetes API
- Routes between API service and compute workloads

### Sidekick Service
- Runs alongside user code in compute pods
- Provides runtime capabilities:
  - Terminal access (PTY)
  - File operations (CRUD)
  - File watching
  - Signal handling
  - Port management

## Technology Stack

- **Language**: Go 1.24
- **Web Framework**: Gin
- **Database**: PostgreSQL with GORM
- **Container Orchestration**: Kubernetes
- **Container Runtime**: gVisor for enhanced isolation
- **Object Storage**: SeaweedFS
- **Authentication**: JWT tokens with custom middleware
- **Real-time**: Gorilla WebSocket

## Project Structure

```
.
├── cmd/                    # Service entry points
│   ├── api/               # API service
│   ├── gateway/           # Gateway proxy service
│   └── sidekick/          # Compute pod sidecar
├── pkg/                   # Shared packages
│   ├── api/              # API handlers and routes
│   ├── auth/             # Authentication logic
│   ├── database/         # Database connection and migrations
│   ├── gateway/          # Gateway proxy logic
│   ├── k8s/              # Kubernetes client and operations
│   ├── models/           # Domain models
│   ├── sidekick/         # Sidekick handlers and services
│   └── vault/            # Secret storage integration
├── deployments/          # Kubernetes manifests
│   ├── api/             # API service deployment
│   ├── gateway/         # Gateway service deployment
│   ├── operators/       # Infrastructure operators
│   └── rbac/            # Role-based access control
└── notes/               # Additional documentation

## Getting Started

### Prerequisites

- Go 1.24+
- Docker
- Kubernetes cluster (local or remote)
- Skaffold (for local development)

### Local Development

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd onpremise-codegen
   ```

2. Start the local development environment:
   ```bash
   skaffold dev
   ```

This will:
- Build Docker images for all services
- Deploy to your local Kubernetes cluster
- Set up hot reloading for code changes
- Forward ports for local access

### Configuration

Services are configured through environment variables. Key configurations include:

- Database connection strings
- S3/SeaweedFS credentials
- JWT signing keys
- Kubernetes namespace settings

## API Overview

### Authentication

```bash
# Login
POST /auth/login
{
  "username": "user@example.com",
  "password": "password"
}

# Create API Key
POST /auth/api-keys
Authorization: Bearer <jwt-token>
```

### Compute Instances

```bash
# Create compute instance
POST /api/computes
{
  "name": "my-instance",
  "group_id": "grp_xxx",
  "image_name": "python:3.9",
  "filesystem_id": "fs_xxx"
}

# List compute instances
GET /api/computes

# Connect to compute instance
WebSocket: ws://gateway/compute/<instance-id>/terminal
```

### File Systems

```bash
# Create filesystem
POST /api/filesystems
{
  "name": "project-files",
  "description": "Project source code"
}

# List filesystems
GET /api/filesystems
```

### Groups

```bash
# Create group
POST /api/groups
{
  "name": "development",
  "description": "Development environment"
}

# List groups
GET /api/groups
```

## Deployment

### Kubernetes Deployment

The platform deploys into two namespaces:

- `computesdk-system`: Core services (API, Gateway, databases)
- `computesdk-workloads`: User compute pods

Deploy using kubectl:

```bash
# Create namespaces
kubectl apply -f deployments/namespaces.yaml

# Deploy operators (PostgreSQL, SeaweedFS, Prometheus)
helm install <operator-charts>

# Deploy core services
kubectl apply -f deployments/
```

### Production Considerations

- **High Availability**: Deploy services across multiple availability zones
- **Security**: Enable network policies and pod security standards
- **Monitoring**: Prometheus metrics are exposed on `/metrics` endpoints
- **Scaling**: Use HPA for API and Gateway services
- **Storage**: Configure appropriate PVC storage classes

## Security

- JWT-based authentication with refresh tokens
- API key support for automation
- Compute pods run with limited RBAC permissions
- gVisor runtime for additional container isolation
- Network policies for pod-to-pod communication
- Secrets stored externally in WorkOS Vault

## Development

### Running Tests

```bash
# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run specific package tests
go test ./pkg/api/...
```

### Building

```bash
# Build all services
make build

# Build specific service
go build -o bin/api ./cmd/api
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

[License information here]
