#!/bin/bash

# Build script for Railway sandbox Docker image

set -e

echo "🏗️  Building Railway Sandbox Docker Image"
echo "========================================="

# Navigate to sandbox server directory
cd "$(dirname "$0")/sandbox-server"

echo "📦 Installing dependencies..."
npm ci

echo "🔨 Building TypeScript..."
npm run build

echo "🐳 Building Docker image (extends official computesdk/compute)..."
docker build -t ghcr.io/computesdk/railway-sandbox:latest .
docker build -t ghcr.io/computesdk/railway-sandbox:dev .

echo "📋 Docker layers:"
docker history ghcr.io/computesdk/railway-sandbox:latest | head -10

echo "✅ Docker image built successfully!"
echo ""
echo "🧪 Test commands:"
echo "   docker run --rm -p 3000:3000 ghcr.io/computesdk/railway-sandbox:latest"
echo "   curl http://localhost:3000/health"
echo ""
echo "📸 Image info:"
docker images | grep railway-sandbox