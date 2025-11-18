# Railway Sandbox Docker Image

This Docker image provides a containerized execution environment for the Railway provider in ComputeSDK.

## 🏗️ Building the Image

### Quick Build
```bash
# From the railway package root
./build-docker.sh
```

### Manual Build
```bash
cd packages/railway/sandbox-server

# Install dependencies and build
npm ci
npm run build

# Build Docker image
docker build -t ghcr.io/computesdk/railway-sandbox:latest .
```

## 🚀 Running the Image

### Basic Run
```bash
docker run --rm -p 3000:3000 ghcr.io/computesdk/railway-sandbox:latest
```

### With Custom Workspace
```bash
docker run --rm -p 3000:3000 -v $(pwd)/workspace:/workspace ghcr.io/computesdk/railway-sandbox:latest
```

### Background Mode
```bash
docker run -d --name railway-sandbox -p 3000:3000 ghcr.io/computesdk/railway-sandbox:latest
```

## 🧪 Testing the Image

### Automated Testing
```bash
# Start container
docker run -d --name test-sandbox -p 3000:3000 ghcr.io/computesdk/railway-sandbox:latest

# Wait for startup
sleep 5

# Run tests
./test-server.sh http://localhost:3000

# Cleanup
docker stop test-sandbox && docker rm test-sandbox
```

### Manual Testing

#### Health Check
```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","timestamp":"..."}
```

#### Node.js Execution
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code":"console.log(\"Hello Node.js!\"); console.log(Math.PI);","runtime":"node"}'

# Expected: {"stdout":"Hello Node.js!\\n3.141592653589793\\n","stderr":"","exitCode":0,...}
```

#### Python Execution
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code":"print(\"Hello Python!\"); print(2+2)","runtime":"python"}'

# Expected: {"stdout":"Hello Python!\\n4\\n","stderr":"","exitCode":0,...}
```

#### Filesystem Operations
```bash
# Write file
curl -X POST http://localhost:3000/fs/write \
  -H "Content-Type: application/json" \
  -d '{"path":"/workspace/test.txt","content":"Hello Railway!"}'

# Read file
curl -X POST http://localhost:3000/fs/read \
  -H "Content-Type: application/json" \
  -d '{"path":"/workspace/test.txt"}'

# List directory
curl -X POST http://localhost:3000/fs/readdir \
  -H "Content-Type: application/json" \
  -d '{"path":"/workspace"}'
```

## 📋 Image Specifications

### Base Image
- **Base**: `node:20-slim`
- **Size**: ~300MB
- **Architecture**: Multi-platform (linux/amd64, linux/arm64)

### Installed Software
- **Node.js**: v20 LTS
- **Python**: 3.x
- **npm packages**: express, tsx, typescript
- **System tools**: curl, git, build-essential

### Ports
- **3000**: HTTP API server

### Volumes
- **/workspace**: User code execution directory (rwx permissions)
- **/app**: Application directory (read-only)

### Health Check
- **Endpoint**: `GET /health`
- **Interval**: 30s
- **Timeout**: 3s
- **Retries**: 3

## 🔌 API Endpoints

### Health Check
- **GET** `/health`
- **Response**: `{"status":"healthy","timestamp":"..."}`

### Code Execution
- **POST** `/execute`
- **Body**: `{"code":"...","runtime":"node|python"}`
- **Response**: `{"stdout":"...","stderr":"...","exitCode":0,"executionTime":123}`

### Command Execution
- **POST** `/command`
- **Body**: `{"command":"ls","args":["-la"],"background":false}`
- **Response**: `{"stdout":"...","stderr":"...","exitCode":0}`

### Filesystem Operations
- **POST** `/fs/write` - Write file
- **POST** `/fs/read` - Read file
- **POST** `/fs/mkdir` - Create directory
- **POST** `/fs/readdir` - List directory
- **POST** `/fs/exists` - Check existence
- **POST** `/fs/remove` - Remove file/directory

## 🚨 Local Testing Limitations

**Note**: When running the server directly on macOS (outside Docker), some shell operations may fail due to path differences (`/bin/sh` vs `/usr/bin/sh`). The Docker container provides a consistent Linux environment.

For accurate testing, always use the Docker container.

## 🔒 Security Considerations

### Container Security
- Non-root user execution planned (TODO)
- Resource limits configurable
- Network isolation possible
- Read-only root filesystem (except /workspace)

### Code Execution Security
- Isolated workspace directory
- Timeout protection (30s default)
- Memory limits (configurable)
- No persistent state between executions

## 🐛 Troubleshooting

### Container Won't Start
```bash
# Check logs
docker logs railway-sandbox

# Check if port is available
lsof -i :3000
```

### Health Check Fails
```bash
# Manual health check
docker exec railway-sandbox curl localhost:3000/health

# Check server logs
docker logs railway-sandbox
```

### Code Execution Fails
1. Check runtime is supported (`node` or `python`)
2. Verify code syntax
3. Check execution timeout (default 30s)
4. Review container logs for errors

## 📈 Performance

### Typical Response Times
- Health check: <10ms
- Simple code execution: 50-200ms
- Filesystem operations: 10-50ms

### Resource Usage
- **Memory**: ~50MB base + execution overhead
- **CPU**: Minimal idle, spikes during execution
- **Disk**: ~300MB image + workspace usage

## 🔄 CI/CD Integration

This image is automatically built and published via GitHub Actions:

```yaml
- name: Build Railway Sandbox Image
  run: |
    cd packages/railway/sandbox-server
    npm ci && npm run build
    docker build -t ghcr.io/computesdk/railway-sandbox:latest .
    docker push ghcr.io/computesdk/railway-sandbox:latest
```

The image is published to:
- `ghcr.io/computesdk/railway-sandbox:latest`
- `ghcr.io/computesdk/railway-sandbox:v1.2.3` (version tags)

### Manual Publishing (For Maintainers)

If you need to manually publish the image, follow these steps:

1. **Authenticate with GitHub Container Registry**:
   ```bash
   # Create a GitHub Personal Access Token with package:write scope
   echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
   ```

2. **Build the image**:
   ```bash
   cd packages/railway/sandbox-server
   npm ci && npm run build
   docker build -t ghcr.io/computesdk/railway-sandbox:latest .
   ```

3. **Test the image locally** (recommended):
   ```bash
   # Start container
   docker run -d --name test-publish -p 3000:3000 ghcr.io/computesdk/railway-sandbox:latest
   sleep 5
   
   # Test health check
   curl http://localhost:3000/health
   
   # Test code execution
   curl -X POST http://localhost:3000/execute \
     -H "Content-Type: application/json" \
     -d '{"code":"console.log(\"Test passed!\")","runtime":"node"}'
   
   # Cleanup
   docker stop test-publish && docker rm test-publish
   ```

4. **Push to registry**:
   ```bash
   docker push ghcr.io/computesdk/railway-sandbox:latest
   ```

5. **Update Railway client** (if needed):
   Make sure `packages/railway/src/client.ts` uses the correct image:
   ```typescript
   private readonly RAILWAY_SANDBOX_IMAGE = 'ghcr.io/computesdk/railway-sandbox:latest'
   ```