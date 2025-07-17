# Default Preset Information

## Environment Defaults (Node.js + Python)

### `default-production`
- **Base Image**: `node:18-bullseye`
- **Languages**: Node.js 18 + Python 3 (with pip, venv)
- **Environment**: Production optimized
- **Ports**: 3000 (Node.js), 8000 (Python API)
- **Resources**: 300m CPU / 512Mi RAM → 1.5 CPU / 2Gi RAM
- **Features**: Production-ready environment variables

### `default-staging` 
- **Base Image**: `node:18-bullseye`
- **Languages**: Node.js 18 + Python 3 (with pip, venv)
- **Environment**: Staging optimized
- **Ports**: 3000 (Node.js), 8000 (Python API)
- **Resources**: 200m CPU / 384Mi RAM → 1 CPU / 1Gi RAM
- **Features**: Staging environment variables

### `default-development`
- **Base Image**: `node:18-bullseye`
- **Languages**: Node.js 18 + Python 3 (with pip, venv)
- **Dev Tools**: git, curl, wget, vim, nano, nodemon, typescript, ts-node
- **Environment**: Development optimized
- **Ports**: 3000 (Node.js), 8000 (Python API), 9229 (Debug), 5173 (Vite)
- **Resources**: 200m CPU / 256Mi RAM → 1 CPU / 1Gi RAM
- **Features**: Full development toolchain

## Specialized Presets

### `web-server`
- **Base Image**: `nginx:alpine`
- **Purpose**: Static web hosting, reverse proxy
- **Ports**: 80 (HTTP)
- **Resources**: 50m CPU / 64Mi RAM → 200m CPU / 256Mi RAM
- **Use Case**: Frontend hosting, load balancing

### `database`
- **Base Image**: `postgres:13-alpine`
- **Purpose**: PostgreSQL database server
- **Ports**: 5432 (PostgreSQL)
- **Resources**: 200m CPU / 256Mi RAM → 1 CPU / 1Gi RAM
- **Credentials**: user/password (default: user/password)

### `python-only`
- **Base Image**: `python:3.11-bullseye`
- **Languages**: Python 3.11 only
- **Libraries**: jupyter, pandas, numpy, matplotlib, requests, flask, fastapi
- **Ports**: 8888 (Jupyter), 5000 (Flask), 8000 (FastAPI)
- **Resources**: 200m CPU / 256Mi RAM → 1 CPU / 1Gi RAM
- **Use Case**: Data science, Python web development

### `node-only`
- **Base Image**: `node:18-bullseye`
- **Languages**: Node.js 18 only
- **Tools**: typescript, ts-node, nodemon, @types/node, express
- **Ports**: 3000 (HTTP), 9229 (Debug), 5173 (Vite)
- **Resources**: 150m CPU / 192Mi RAM → 750m CPU / 768Mi RAM
- **Use Case**: Pure Node.js development

## Usage Examples

### Default Environment (Node.js + Python)
```json
POST /api/computes
{
  "environment": "development"
}
```
→ Creates compute with Node.js 18 + Python 3 + dev tools

### Specific Preset
```json
POST /api/computes
{
  "environment": "development",
  "preset_id": "python-only"
}
```
→ Creates compute with Python 3.11 + data science libraries

### Available Presets
```bash
GET /api/computes/presets
```
→ Lists all available presets with full details

## Key Benefits

✅ **Dual Runtime**: Default presets include both Node.js and Python
✅ **Environment Appropriate**: Different resource allocations per environment
✅ **Development Ready**: Dev environment includes common tools
✅ **Specialized Options**: Focused presets for specific use cases
✅ **Production Ready**: Optimized configurations for each environment