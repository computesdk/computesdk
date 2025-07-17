#!/bin/bash

# Build CLI wrapper for local use
echo "Building computesdk-cli..."
go build -o bin/computesdk-cli ./cmd/cli/main.go

if [ $? -eq 0 ]; then
    echo "✅ computesdk-cli built successfully at bin/computesdk-cli"
    echo ""
    echo "Usage examples:"
    echo "  ./bin/computesdk-cli create -name \"My API Key\""
    echo "  ./bin/computesdk-cli list"
    echo "  ./bin/computesdk-cli help"
    echo ""
    echo "The CLI uses kubectl exec under the hood to call the in-cluster keyctl tool."
else
    echo "❌ Failed to build computesdk-cli"
    exit 1
fi