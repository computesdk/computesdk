# Changelog

All notable changes to the CodeSandbox provider will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-20

### Added
- Initial release of CodeSandbox provider for ComputeSDK
- **Sandbox Management**: Create, resume, hibernate, and destroy sandboxes using CodeSandbox SDK
- **Code Execution**: Support for both Python and Node.js runtime environments
- **Command Execution**: Run shell commands within sandboxes using `client.commands.run()`
- **Filesystem Operations**: Full filesystem support using CodeSandbox client APIs
  - Read/write files with `client.fs.readTextFile()` and `client.fs.writeTextFile()`
  - Create directories via shell commands
  - List directory contents with `client.fs.readdir()`
  - Check file existence via shell commands
  - Remove files and directories with `client.fs.remove()`
- **Template Support**: Create sandboxes from custom CodeSandbox templates
- **Auto Runtime Detection**: Automatically detect Python vs Node.js based on code patterns
- **Error Handling**: Comprehensive error handling for authentication, quota, and syntax errors
- **TypeScript Support**: Full type definitions and TypeScript compatibility
- **Comprehensive Testing**: Complete test suite using ComputeSDK test utilities

### Implementation Details
- Uses `@codesandbox/sdk` v2.0.7 for all sandbox operations
- Implements factory pattern using `createProvider()` from ComputeSDK
- Supports CodeSandbox-specific features like snapshot/resume and hibernation
- Environment variable support for `CSB_API_KEY` authentication
- Base64 encoding for reliable code execution across runtimes
- Proper error categorization for different failure scenarios

### API Methods Implemented
- `sandbox.create()` - Create new sandboxes with optional template support
- `sandbox.getById()` - Resume existing sandboxes by ID
- `sandbox.destroy()` - Hibernate sandboxes (preserves state)
- `sandbox.runCode()` - Execute code with runtime auto-detection
- `sandbox.runCommand()` - Execute shell commands
- `sandbox.getInfo()` - Get sandbox metadata including CodeSandbox-specific properties
- `filesystem.*` - Complete filesystem operations suite

### Dependencies
- `@codesandbox/sdk` ^2.0.7 - CodeSandbox SDK for sandbox management
- `computesdk` workspace dependency - Core ComputeSDK framework

### Documentation
- Comprehensive README with usage examples and API reference
- TypeScript interface documentation
- Error handling guide
- Best practices and limitations
- Template usage examples