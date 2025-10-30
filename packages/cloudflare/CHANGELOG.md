# @computesdk/cloudflare

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
