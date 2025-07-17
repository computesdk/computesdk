#!/bin/bash

# Build keyctl binary for local testing
echo "Building keyctl binary..."
go build -o bin/keyctl ./cmd/keyctl/main.go

if [ $? -eq 0 ]; then
    echo "✅ keyctl binary built successfully at bin/keyctl"
    echo ""
    echo "Usage examples:"
    echo "  ./bin/keyctl create -name \"My API Key\""
    echo "  ./bin/keyctl list"
    echo "  ./bin/keyctl help"
else
    echo "❌ Failed to build keyctl binary"
    exit 1
fi