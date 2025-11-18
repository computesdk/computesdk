# Changelog

## 1.4.5

### Patch Changes

- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
- Updated dependencies [f0eef79]
  - computesdk@1.8.5

## 1.4.4

### Patch Changes

- Updated dependencies [11a3b8c]
- Updated dependencies [11a3b8c]
  - computesdk@1.8.4

## 1.4.3

### Patch Changes

- Updated dependencies [483c700]
  - computesdk@1.8.3

## 1.4.2

### Patch Changes

- Updated dependencies [66d50b9]
  - computesdk@1.8.2

## 1.4.1

### Patch Changes

- computesdk@1.8.1

## 1.4.0

### Minor Changes

- 99b807c: Integrating packages w/ @computesdk/client

### Patch Changes

- Updated dependencies [99b807c]
  - computesdk@1.8.0

## 1.3.6

### Patch Changes

- computesdk@1.7.6

## 1.3.5

### Patch Changes

- computesdk@1.7.5

## 1.3.4

### Patch Changes

- computesdk@1.7.4

## 1.3.3

### Patch Changes

- computesdk@1.7.3

## 1.3.2

### Patch Changes

- computesdk@1.7.2

## 1.3.1

### Patch Changes

- computesdk@1.7.1

## 1.3.0

### Minor Changes

- c9cef90: Minor bump for all packages

## 1.2.5

### Patch Changes

- Updated dependencies [763a9a7]
  - computesdk@1.7.0

## 1.2.4

### Patch Changes

- Updated dependencies [19e4fe6]
  - computesdk@1.6.0

## 1.2.3

### Patch Changes

- Updated dependencies [ede314a]
  - computesdk@1.5.0

## 1.2.2

### Patch Changes

- Updated dependencies [3b23385]
  - computesdk@1.4.0

## 1.2.1

### Patch Changes

- Updated dependencies [be556c2]
  - computesdk@1.3.1

## 1.2.0

### Minor Changes

- fdb1271: Releasing sandbox instances via getInstance method

### Patch Changes

- Updated dependencies [fdb1271]
  - computesdk@1.3.0

## 1.1.0

### Minor Changes

- 1fa3690: Adding instance typing
- 485f706: adding in getInstance w/ typing
- 2b537df: improving standard methods on provider

### Patch Changes

- Updated dependencies [1fa3690]
- Updated dependencies [485f706]
- Updated dependencies [2b537df]
- Updated dependencies [8d807e6]
  - computesdk@1.2.0

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
