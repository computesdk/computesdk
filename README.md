# ComputeSDK Operator

ComputeSDK Operator is a kubernetes native system for running isolated code execution environments in kubernetes. It provides secure, dynamically-provisioned compute instances with features like real-time terminal access, millisecond boot times, and more coming soon!.

## Features

- **Dynamic Compute Provisioning**: Create isolated containers on-demand for code execution
- **Real-Time Operations**: WebSocket-based terminal access, file editing, and live updates
- **Urls for the world**: Every compute instance is given a dedicated URL.

## Architecture

The platform consists of three main services:

### API Service
- RESTful API for managing compute instances (filesystems, secrets, and groups coming soon).
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
computesdk/
├── cmd/                           # Service entry points
│   ├── api/                      # API service
│   │   ├── Dockerfile
│   │   └── main.go
│   ├── gateway/                  # Gateway proxy service
│   │   ├── Dockerfile
│   │   ├── main.go
│   │   └── main_test.go
│   └── sidekick/                 # Compute pod sidecar
│       ├── Dockerfile
│       └── main.go
├── deployments/                  # Kubernetes manifests
│   ├── api/                      # API service deployment
│   │   ├── api-deployment.yaml
│   │   └── api-service.yaml
│   ├── gateway/                  # Gateway service deployment
│   │   ├── gateway-deployment.yaml
│   │   └── gateway-service.yaml
│   ├── operators/                # Infrastructure operators
│   │   ├── postgres-operator/
│   │   │   └── zalando-values-local.yaml
│   │   ├── prometheus-operator/
│   │   │   └── prometheus-operator-values-local.yaml
│   │   └── seaweedfs/
│   │       └── seaweedfs-values-local.yaml
│   ├── postgres/                 # PostgreSQL configs
│   │   └── postgres-cluster.yaml
│   ├── rbac/                     # Role-based access control
│   │   ├── pod-reader-workloads-role.yaml
│   │   └── pod-reader-workloads-rolebinding.yaml
│   ├── seaweedfs/                # SeaweedFS configs
│   │   └── seaweedfs-backup-cronjob.yaml
│   ├── ingress.yaml
│   └── namespaces.yaml
├── pkg/                          # Shared packages
│   ├── api/                      # API packages
│   │   ├── compute/              # Compute instance management
│   │   │   ├── aggregate.go
│   │   │   ├── events.go
│   │   │   ├── requests.go
│   │   │   ├── service.go
│   │   │   └── summary.go
│   │   ├── database/             # Database connection and migrations
│   │   │   ├── connection.go
│   │   │   └── migrations.go
│   │   ├── events/               # Event sourcing
│   │   │   ├── event.go
│   │   │   └── store.go
│   │   ├── handlers/             # HTTP handlers
│   │   │   ├── compute_handler.go
│   │   │   └── session_handler.go
│   │   ├── middleware/           # Middleware
│   │   │   └── auth.go
│   │   ├── session/              # Session management
│   │   │   ├── aggregate.go
│   │   │   ├── events.go
│   │   │   ├── requests.go
│   │   │   ├── service.go
│   │   │   └── summary.go
│   │   ├── router.go
│   │   └── router_test.go
│   ├── auth/                     # Authentication logic
│   │   └── jwt.go
│   ├── common/                   # Common utilities
│   │   ├── config/
│   │   │   └── dataservices.go
│   │   ├── health_handler.go
│   │   ├── id_generator.go
│   │   └── id_generator_test.go
│   ├── gateway/                  # Gateway proxy logic
│   │   ├── config/
│   │   │   ├── config.go
│   │   │   └── config_test.go
│   │   ├── proxy/
│   │   │   ├── compute_id.go
│   │   │   ├── compute_id_test.go
│   │   │   ├── http.go
│   │   │   ├── http_test.go
│   │   │   ├── websocket.go
│   │   │   └── websocket_test.go
│   │   └── Dockerfile
│   ├── k8s/                      # Kubernetes client and operations
│   │   ├── client.go
│   │   ├── client_test.go
│   │   ├── compute.go
│   │   ├── compute_test.go
│   │   ├── deployments.go
│   │   ├── deployments_test.go
│   │   ├── fixtures.go
│   │   ├── pods.go
│   │   └── pods_test.go
│   └── sidekick/                 # Sidekick handlers and services
│       ├── handlers/
│       │   ├── base.go
│       │   ├── files.go
│       │   ├── files_test.go
│       │   ├── filewatcher.go
│       │   ├── filewatcher_test.go
│       │   ├── signal.go
│       │   ├── signal_test.go
│       │   ├── terminal.go
│       │   └── terminal_test.go
│       ├── services/
│       │   ├── filesystem.go
│       │   ├── filesystem_test.go
│       │   ├── filewatcher.go
│       │   ├── filewatcher_test.go
│       │   ├── signal.go
│       │   ├── signal_test.go
│       │   ├── terminal.go
│       │   └── terminal_test.go
│       ├── testutil/
│       │   ├── wait.go
│       │   └── websocket_client.go
│       ├── websocket/
│       │   ├── hub.go
│       │   ├── hub_test.go
│       │   ├── manager.go
│       │   └── manager_test.go
│       ├── router.go
│       └── router_test.go
├── go.mod                        # Go module definition
├── go.sum                        # Go dependencies
├── skaffold.yaml                 # Skaffold configuration
└── README.md                     # This file
```

## Getting Started

### Prerequisites

- Go 1.24+
- Docker
- Kubernetes cluster (local or remote)
- Skaffold (for local development)


### Configuration

Services are configured through environment variables. Key configurations include:

- Database connection strings
- S3/SeaweedFS credentials
- JWT signing keys

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

