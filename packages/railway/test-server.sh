#!/bin/bash

# Test script for Railway sandbox server

set -e

echo "🧪 Testing Railway Sandbox Server"
echo "================================="

# Check if server is running
SERVER_URL="${1:-http://localhost:3000}"
echo "🌐 Testing server at: $SERVER_URL"

# Function to test an endpoint
test_endpoint() {
    local method=$1
    local path=$2
    local data=$3
    local description=$4
    
    echo "📡 Testing: $description"
    
    if [ -n "$data" ]; then
        curl -s -X "$method" "$SERVER_URL$path" \
            -H "Content-Type: application/json" \
            -d "$data" | jq . || echo "❌ Failed"
    else
        curl -s -X "$method" "$SERVER_URL$path" | jq . || echo "❌ Failed"
    fi
    
    echo ""
}

echo ""
echo "🔍 Health Check"
echo "---------------"
test_endpoint "GET" "/health" "" "Server health status"

echo "🟢 Node.js Code Execution"
echo "-------------------------"
test_endpoint "POST" "/execute" '{
    "code": "console.log(\"Hello from Node.js!\"); console.log(\"Math.PI:\", Math.PI);",
    "runtime": "node"
}' "Execute Node.js code"

echo "🐍 Python Code Execution"
echo "------------------------"
test_endpoint "POST" "/execute" '{
    "code": "print(\"Hello from Python!\"); print(\"2 + 2 =\", 2 + 2); import sys; print(\"Python version:\", sys.version.split()[0])",
    "runtime": "python"
}' "Execute Python code"

echo "⚡ Command Execution"
echo "-------------------"
test_endpoint "POST" "/command" '{
    "command": "echo",
    "args": ["Hello from command execution!"]
}' "Execute shell command"

test_endpoint "POST" "/command" '{
    "command": "ls",
    "args": ["-la", "/workspace"]
}' "List workspace directory"

echo "📁 Filesystem Operations"
echo "------------------------"
test_endpoint "POST" "/fs/write" '{
    "path": "/workspace/test.txt",
    "content": "Hello Railway Sandbox!"
}' "Write file"

test_endpoint "POST" "/fs/read" '{
    "path": "/workspace/test.txt"
}' "Read file"

test_endpoint "POST" "/fs/exists" '{
    "path": "/workspace/test.txt"
}' "Check file exists"

test_endpoint "POST" "/fs/mkdir" '{
    "path": "/workspace/testdir"
}' "Create directory"

test_endpoint "POST" "/fs/readdir" '{
    "path": "/workspace"
}' "List directory contents"

test_endpoint "POST" "/fs/remove" '{
    "path": "/workspace/test.txt"
}' "Remove file"

test_endpoint "POST" "/fs/exists" '{
    "path": "/workspace/test.txt"
}' "Check file removed"

echo "✅ All tests completed!"
echo ""
echo "🔧 Manual test commands:"
echo "   curl $SERVER_URL/health"
echo "   curl -X POST $SERVER_URL/execute -H 'Content-Type: application/json' -d '{\"code\":\"console.log(\\\"test\\\")\",\"runtime\":\"node\"}'"