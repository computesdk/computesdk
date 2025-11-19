# @computesdk/cloudflare

## 1.2.5

### Patch Changes

- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - computesdk@1.8.5

## 1.2.4

### Patch Changes

- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - computesdk@1.8.4

## 1.2.3

### Patch Changes

- Updated dependencies [483c700]
  - computesdk@1.8.3

## 1.2.2

### Patch Changes

- Updated dependencies [66d50b9]
  - computesdk@1.8.2

## 1.2.1

### Patch Changes

- computesdk@1.8.1

## 1.2.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - computesdk@1.8.0

## 1.1.6

### Patch Changes

- computesdk@1.7.6

## 1.1.5

### Patch Changes

- computesdk@1.7.5

## 1.1.4

### Patch Changes

- computesdk@1.7.4

## 1.1.3

### Patch Changes

- computesdk@1.7.3

## 1.1.2

### Patch Changes

- computesdk@1.7.2

## 1.1.1

### Patch Changes

- computesdk@1.7.1

## 1.1.0

### Minor Changes

- c9cef90: Minor bump for all packages

## [1.0.0] - 2024-01-XX

### Added

- Initial release of Cloudflare provider for ComputeSDK
- Full Cloudflare Sandbox SDK integration using `@cloudflare/sandbox`
- Complete implementation of all ComputeSDK provider methods:
  - `create()` - Create new sandboxes using Durable Objects
  - `getById()` - Reconnect to existing sandboxes
  - `list()` - Throws appropriate "not supported" error
  - `destroy()` - Clean up sandbox resources
  - `runCode()` - Execute Python/JavaScript with runtime auto-detection
  - `runCommand()` - Execute shell commands
  - `getInfo()` - Get sandbox status and metadata
  - `getUrl()` - Expose ports and get public URLs
- Full filesystem support:
  - `readFile()` - Read file contents
  - `writeFile()` - Write file contents
  - `mkdir()` - Create directories
  - `readdir()` - List directory contents
  - `exists()` - Check file/directory existence
  - `remove()` - Delete files and directories
- Runtime auto-detection (Python vs Node.js)
- Environment variables support via `setEnvVars()`
- Port forwarding and public URL generation
- Comprehensive error handling with Cloudflare-specific messages
- Full TypeScript support with proper type definitions
- Complete test suite with mocked Cloudflare SDK
- Detailed documentation and usage examples

### Features

- **Edge-Native Execution**: Runs on Cloudflare's global network
- **Durable Objects Integration**: Persistent sandbox state
- **Code Interpreter**: Python and JavaScript execution
- **File System Access**: Complete file operations support
- **Port Forwarding**: Expose services via public URLs
- **Process Management**: Start, monitor, and kill processes
- **Git Integration**: Clone repositories into sandboxes
- **Security**: Isolated container execution
- **Real-time Streaming**: Support for streaming command output

### Documentation

- Complete README with setup instructions
- Configuration examples for wrangler.toml and Dockerfile
- Usage examples for all major features
- Error handling patterns
- Integration examples with Cloudflare Workers
