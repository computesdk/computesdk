# ComputeSDK Methods Reference

This document provides a comprehensive reference of all methods utilized in the ComputeSDK provider packages and core SDK.

## Core Methods Utilized in Provider Packages

### Current Implementation Status

✅ **Fully Implemented & Exposed**:
- Sandbox collection operations (`compute.sandbox.*`)
- Sandbox instance operations (code/command execution)
- Filesystem operations (`sandbox.filesystem.*`)
- Request handler for web framework integration

🚧 **Infrastructure Only (Not Exposed in Main API)**:
- Template management (types and factory exist, but no `compute.template.*` API)
- Snapshot management (types and factory exist, but no `compute.snapshot.*` API)

📋 **Planned/Future**:
- Blob storage (`compute.blob.*` - mentioned in comments)
- Git operations (`compute.git.*` - mentioned in comments)  
- Domain management (`compute.domains.*` - mentioned in comments)

### **1. Provider Factory Methods**
Located in: `packages/computesdk/src/factory.ts`

| Method | Location | Purpose |
|--------|----------|---------|
| `createProvider<TSandbox, TConfig, TTemplate, TSnapshot>()` | `factory.ts:514` | Factory function that creates providers from method definitions, eliminating boilerplate code |
| `createBackgroundCommand()` | `factory.ts:31` | Helper function to handle background command execution by appending `&` to commands |

### **2. Sandbox Collection Operations** 
*Map to `compute.sandbox.*` methods*

| Method | Required | Location | Purpose |
|--------|----------|----------|---------|
| `create(config, options?)` | ✅ | `SandboxMethods.create` | Creates new sandbox instances with provider-specific configuration |
| `getById(config, sandboxId)` | ✅ | `SandboxMethods.getById` | Retrieves existing sandbox by ID or returns null if not found |
| `list(config)` | ✅ | `SandboxMethods.list` | Lists all active sandboxes for the provider |
| `destroy(config, sandboxId)` | ✅ | `SandboxMethods.destroy` | Destroys/terminates sandbox and cleans up resources |

### **3. Sandbox Instance Operations**
*Map to individual `Sandbox` methods*

| Method | Required | Location | Purpose |
|--------|----------|----------|---------|
| `runCode(sandbox, code, runtime?, config?)` | ✅ | `SandboxMethods.runCode` | Executes code in specified runtime (node/python) with auto-detection |
| `runCommand(sandbox, command, args?, options?)` | ✅ | `SandboxMethods.runCommand` | Executes shell commands with support for background execution |
| `getInfo(sandbox)` | ✅ | `SandboxMethods.getInfo` | Returns sandbox metadata, status, and runtime information |
| `getUrl(sandbox, options)` | ✅ | `SandboxMethods.getUrl` | Gets accessible URL for sandbox on specified port |
| `getInstance(sandbox)?` | ⚪ | `SandboxMethods.getInstance` | Optional: Returns provider's native sandbox instance with proper typing |

### **4. Filesystem Operations**
*Optional: Map to `sandbox.filesystem.*` methods*

| Method | Required | Location | Purpose |
|--------|----------|----------|---------|
| `readFile(sandbox, path, runCommand)` | ⚪ | `SandboxMethods.filesystem.readFile` | Reads file content from sandbox filesystem |
| `writeFile(sandbox, path, content, runCommand)` | ⚪ | `SandboxMethods.filesystem.writeFile` | Writes content to file in sandbox |
| `mkdir(sandbox, path, runCommand)` | ⚪ | `SandboxMethods.filesystem.mkdir` | Creates directories in sandbox |
| `readdir(sandbox, path, runCommand)` | ⚪ | `SandboxMethods.filesystem.readdir` | Lists directory contents with file metadata |
| `exists(sandbox, path, runCommand)` | ⚪ | `SandboxMethods.filesystem.exists` | Checks if file/directory exists |
| `remove(sandbox, path, runCommand)` | ⚪ | `SandboxMethods.filesystem.remove` | Removes files or directories |

### **5. Template Management** 
*⚠️ Defined in type system but NOT currently exposed in compute API*

| Method | Required | Location | Status | Purpose |
|--------|----------|----------|---------|---------|
| `create(config, options)` | ⚪ | `TemplateMethods.create` | 🚧 Infrastructure Only | Creates reusable sandbox templates |
| `list(config, options?)` | ⚪ | `TemplateMethods.list` | 🚧 Infrastructure Only | Lists available templates |
| `delete(config, templateId)` | ⚪ | `TemplateMethods.delete` | 🚧 Infrastructure Only | Removes template |

**Note**: Template management interfaces exist in the factory system (`factory.ts:80-83`, `provider.ts:66-72`) but are not exposed in the main `compute.*` API. Currently only used for E2B's `templateId` option in sandbox creation.

### **6. Snapshot Management**
*⚠️ Defined in type system but NOT currently exposed in compute API*

| Method | Required | Location | Status | Purpose |
|--------|----------|----------|---------|---------|
| `create(config, sandboxId, options?)` | ⚪ | `SnapshotMethods.create` | 🚧 Infrastructure Only | Creates snapshot from running sandbox |
| `list(config, options?)` | ⚪ | `SnapshotMethods.list` | 🚧 Infrastructure Only | Lists available snapshots |
| `delete(config, snapshotId)` | ⚪ | `SnapshotMethods.delete` | 🚧 Infrastructure Only | Removes snapshot |

**Note**: Snapshot management interfaces exist in the factory system (`factory.ts:89-92`, `provider.ts:78-84`) but are not exposed in the main `compute.*` API. No current providers implement these methods.

### **7. Core Compute Singleton Methods**
Located in: `packages/computesdk/src/compute.ts`

| Method | Location | Purpose |
|--------|----------|---------|
| `setConfig<TProvider>(config)` | `compute.ts:22` | Configures default provider for compute singleton |
| `getConfig()` | `compute.ts:50` | Returns current configuration |
| `clearConfig()` | `compute.ts:57` | Clears current configuration |
| `createCompute<TProvider>(config)` | `compute.ts:196` | Creates typed compute instance with proper TypeScript inference |

### **8. Request Handler Methods** 
Located in: `packages/computesdk/src/request-handler.ts`

| Method | Location | Purpose |
|--------|----------|---------|
| `handleComputeRequest(params)` | `request-handler.ts:234` | Handles HTTP/JSON requests for web framework integration |
| `executeAction(body, provider)` | `request-handler.ts:54` | Internal method that executes compute actions based on dot-notation strings |

### **9. Create-Compute CLI Methods**
Located in: `packages/create-compute/src/index.ts`

| Method | Location | Purpose |
|--------|----------|---------|
| `program.action()` | `create-compute/src/index.ts:23` | CLI command handler for creating ComputeSDK projects |

## Provider Implementation Examples

### **E2B Provider** (`packages/e2b/src/index.ts`)
- **Full Implementation**: All sandbox, filesystem, and instance methods
- **Key Features**: Native E2B SDK integration, filesystem operations via `sandbox.files.*`, URL generation via `sandbox.getHost()`
- **Runtime Detection**: Advanced Python/Node.js detection with 15+ code patterns
- **Authentication**: API key validation with `e2b_` prefix checking
- **Error Handling**: Syntax error detection and custom error messages for auth/quota issues

**Key Methods:**
```typescript
// Sandbox Operations
create: async (config: E2BConfig, options?: CreateSandboxOptions)
getById: async (config: E2BConfig, sandboxId: string)
list: async (config: E2BConfig)
destroy: async (config: E2BConfig, sandboxId: string)

// Instance Operations
runCode: async (sandbox: E2BSandbox, code: string, runtime?: Runtime)
runCommand: async (sandbox: E2BSandbox, command: string, args?: string[], options?: RunCommandOptions)
getInfo: async (sandbox: E2BSandbox)
getUrl: async (sandbox: E2BSandbox, options: { port: number; protocol?: string })

// Filesystem Operations
readFile: async (sandbox: E2BSandbox, path: string)
writeFile: async (sandbox: E2BSandbox, path: string, content: string)
mkdir: async (sandbox: E2BSandbox, path: string)
readdir: async (sandbox: E2BSandbox, path: string)
exists: async (sandbox: E2BSandbox, path: string)
remove: async (sandbox: E2BSandbox, path: string)
```

### **Modal Provider** (`packages/modal/src/index.ts`)
- **Full Implementation**: All sandbox and filesystem methods
- **Key Features**: Real Modal SDK integration, dynamic Node.js sandbox creation for mixed runtimes
- **Special Handling**: Stream reading with `process.stdout.readText()`, tunnel URL management
- **Authentication**: Token ID and secret validation
- **Runtime Support**: Dynamic sandbox creation for different runtimes

**Key Methods:**
```typescript
// Sandbox Operations
create: async (config: ModalConfig, options?: CreateSandboxOptions)
getById: async (config: ModalConfig, sandboxId: string)
list: async (config: ModalConfig) // Throws error - not supported
destroy: async (config: ModalConfig, sandboxId: string)

// Instance Operations  
runCode: async (modalSandbox: ModalSandbox, code: string, runtime?: Runtime)
runCommand: async (modalSandbox: ModalSandbox, command: string, args?: string[], options?: RunCommandOptions)
getInfo: async (modalSandbox: ModalSandbox)
getUrl: async (modalSandbox: ModalSandbox, options: { port: number; protocol?: string })

// Filesystem Operations (with fallbacks)
readFile: async (modalSandbox: ModalSandbox, path: string)
writeFile: async (modalSandbox: ModalSandbox, path: string, content: string)
mkdir: async (modalSandbox: ModalSandbox, path: string)
readdir: async (modalSandbox: ModalSandbox, path: string)
exists: async (modalSandbox: ModalSandbox, path: string)
remove: async (modalSandbox: ModalSandbox, path: string)
```

### **Daytona Provider** (`packages/daytona/src/index.ts`)
- **Sandbox + Filesystem**: Command-based filesystem operations using shell commands
- **Key Features**: Base64 encoding for file operations, preview URL generation
- **Runtime Detection**: Python/Node.js auto-detection with error pattern recognition
- **Authentication**: API key validation with Daytona SDK
- **File Operations**: Base64 encoding for safe content handling

**Key Methods:**
```typescript
// Sandbox Operations
create: async (config: DaytonaConfig, options?: CreateSandboxOptions)
getById: async (config: DaytonaConfig, sandboxId: string)
list: async (config: DaytonaConfig)
destroy: async (config: DaytonaConfig, sandboxId: string)

// Instance Operations
runCode: async (sandbox: DaytonaSandbox, code: string, runtime?: Runtime)
runCommand: async (sandbox: DaytonaSandbox, command: string, args?: string[], options?: RunCommandOptions)
getInfo: async (sandbox: DaytonaSandbox)
getUrl: async (sandbox: DaytonaSandbox, options: { port: number; protocol?: string })

// Filesystem Operations (command-based)
readFile: async (sandbox: DaytonaSandbox, path: string)
writeFile: async (sandbox: DaytonaSandbox, path: string, content: string)
mkdir: async (sandbox: DaytonaSandbox, path: string)
readdir: async (sandbox: DaytonaSandbox, path: string)
exists: async (sandbox: DaytonaSandbox, path: string)
remove: async (sandbox: DaytonaSandbox, path: string)
```

### **Blaxel Provider** (`packages/blaxel/src/index.ts`)
- **Full Implementation**: Native filesystem API, advanced URL generation with CORS headers
- **Key Features**: Image-based runtime detection, TTL parsing, process streaming
- **Advanced Features**: Preview tokens, custom domains, authentication options
- **Authentication**: Workspace and API key validation
- **URL Generation**: Advanced preview URL creation with token support

**Key Methods:**
```typescript
// Sandbox Operations
create: async (config: BlaxelConfig, options?: CreateSandboxOptions)
getById: async (config: BlaxelConfig, sandboxId: string)
list: async (config: BlaxelConfig)
destroy: async (config: BlaxelConfig, sandboxId: string)

// Instance Operations
runCode: async (sandbox: SandboxInstance, code: string, runtime?: Runtime)
runCommand: async (sandbox: SandboxInstance, command: string, args?: string[], options?: RunCommandOptions)
getInfo: async (sandbox: SandboxInstance)
getUrl: async (sandbox: SandboxInstance, options: { port: number; ttl?: number; prefixUrl?: string; headers?: object; customDomain?: string; authentication?: object })

// Filesystem Operations (native API)
readFile: async (sandbox: SandboxInstance, path: string)
writeFile: async (sandbox: SandboxInstance, path: string, content: string)  
mkdir: async (sandbox: SandboxInstance, path: string)
readdir: async (sandbox: SandboxInstance, path: string)
exists: async (sandbox: SandboxInstance, path: string)
remove: async (sandbox: SandboxInstance, path: string)
```

## Default Filesystem Implementation

The core SDK provides default filesystem implementations for providers that don't have native filesystem APIs:

```typescript
// Located in: packages/computesdk/src/factory.ts:111-194
const defaultFilesystemMethods = {
  readFile: async (sandbox: any, path: string, runCommand: Function) => {
    const result = await runCommand(sandbox, 'cat', [path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file ${path}: ${result.stderr}`);
    }
    return result.stdout.replace(/\n$/, ''); // Remove trailing newline
  },

  writeFile: async (sandbox: any, path: string, content: string, runCommand: Function) => {
    const result = await runCommand(sandbox, 'sh', ['-c', `echo ${JSON.stringify(content)} > ${JSON.stringify(path)}`]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file ${path}: ${result.stderr}`);
    }
  },

  mkdir: async (sandbox: any, path: string, runCommand: Function) => {
    const result = await runCommand(sandbox, 'mkdir', ['-p', path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
    }
  },

  readdir: async (sandbox: any, path: string, runCommand: Function) => {
    // Tries ls -la, falls back to ls -l, then ls for maximum compatibility
    // Parses output to create FileEntry objects with metadata
  },

  exists: async (sandbox: any, path: string, runCommand: Function) => {
    const result = await runCommand(sandbox, 'test', ['-e', path]);
    return result.exitCode === 0;
  },

  remove: async (sandbox: any, path: string, runCommand: Function) => {
    const result = await runCommand(sandbox, 'rm', ['-rf', path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove ${path}: ${result.stderr}`);
    }
  }
};
```

## Type Definitions

### Core Interfaces

```typescript
// Located in: packages/computesdk/src/types/provider.ts
export interface Provider<TSandbox = any, TTemplate = any, TSnapshot = any> {
  readonly name: string;
  readonly sandbox: ProviderSandboxManager<TSandbox>;
  readonly template?: ProviderTemplateManager<TTemplate>;
  readonly snapshot?: ProviderSnapshotManager<TSnapshot>;
  getSupportedRuntimes(): Runtime[];
  readonly __sandboxType: TSandbox; // Phantom type for TypeScript inference
}

export interface ProviderSandboxManager<TSandbox = any> {
  create(options?: CreateSandboxOptions): Promise<Sandbox<TSandbox>>;
  getById(sandboxId: string): Promise<Sandbox<TSandbox> | null>;
  list(): Promise<Sandbox<TSandbox>[]>;
  destroy(sandboxId: string): Promise<void>;
}
```

### Sandbox Interface

```typescript
// Located in: packages/computesdk/src/types/sandbox.ts
export interface Sandbox<TSandbox = any> {
  readonly sandboxId: string;
  readonly provider: string;
  
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  runCommand(command: string, args?: string[], options?: RunCommandOptions): Promise<ExecutionResult>;
  getInfo(): Promise<SandboxInfo>;
  getUrl(options: { port: number; protocol?: string }): Promise<string>;
  getProvider(): Provider<TSandbox>;
  getInstance(): TSandbox;
  kill(): Promise<void>;
  destroy(): Promise<void>;
  
  readonly filesystem: SandboxFileSystem;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
  pid?: number;
  isBackground?: boolean;
}
```

## Factory Pattern Usage

The factory pattern reduces provider implementation from ~400 lines to ~100 lines of core logic:

```typescript
// Example provider using factory pattern
export const myProvider = createProvider<MySandbox, MyConfig>({
  name: 'myprovider',
  methods: {
    sandbox: {
      // Required: 4 collection operations
      create: async (config: MyConfig, options?: CreateSandboxOptions) => { /* implementation */ },
      getById: async (config: MyConfig, sandboxId: string) => { /* implementation */ },
      list: async (config: MyConfig) => { /* implementation */ },
      destroy: async (config: MyConfig, sandboxId: string) => { /* implementation */ },
      
      // Required: 4 instance operations
      runCode: async (sandbox: MySandbox, code: string, runtime?: Runtime) => { /* implementation */ },
      runCommand: async (sandbox: MySandbox, command: string, args?: string[], options?: RunCommandOptions) => { /* implementation */ },
      getInfo: async (sandbox: MySandbox) => { /* implementation */ },
      getUrl: async (sandbox: MySandbox, options: { port: number; protocol?: string }) => { /* implementation */ },
      
      // Optional: Filesystem operations (auto-injected if not provided)
      filesystem: {
        readFile: async (sandbox: MySandbox, path: string, runCommand: Function) => { /* implementation */ },
        // ... other filesystem methods
      },
      
      // Optional: Provider-specific getInstance
      getInstance: (sandbox: MySandbox): MySandbox => sandbox,
    },
    
    // Optional: Template management (infrastructure exists but not exposed in compute API)
    template: {
      create: async (config: MyConfig, options: CreateTemplateOptions) => { /* implementation */ },
      list: async (config: MyConfig, options?: ListTemplatesOptions) => { /* implementation */ },
      delete: async (config: MyConfig, templateId: string) => { /* implementation */ },
    },
    
    // Optional: Snapshot management (infrastructure exists but not exposed in compute API)  
    snapshot: {
      create: async (config: MyConfig, sandboxId: string, options?: CreateSnapshotOptions) => { /* implementation */ },
      list: async (config: MyConfig, options?: ListSnapshotsOptions) => { /* implementation */ },
      delete: async (config: MyConfig, snapshotId: string) => { /* implementation */ },
    }
  }
});
```

## Summary

The ComputeSDK provider packages utilize a **factory pattern** that:

1. **Reduces boilerplate** from ~400 lines to ~100 lines of core logic
2. **Provides automatic feature detection** based on implemented methods
3. **Auto-injects default implementations** for filesystem operations
4. **Maintains type safety** with TypeScript generics
5. **Supports optional features** like templates and snapshots

Each provider implements:
- **4 required sandbox collection methods** for CRUD operations
- **4 required instance methods** for code/command execution  
- **6 optional filesystem methods** for file operations
- **Optional template/snapshot managers** (infrastructure exists but not exposed in compute API)

The core SDK handles all the boilerplate class generation, error handling, and provides sensible defaults while allowing providers to focus on their unique integration logic.


-----
## UI Package Methods

The `@computesdk/ui` package provides frontend integration utilities for ComputeSDK. Located in: `packages/ui/src/`

### **Factory Functions**

| Method | Location | Purpose |
|--------|----------|---------|
| `createCompute(config?: ComputeConfig)` | `core/factories.ts:355` | Main factory for compute environment management with sandbox operations |
| `createSandbox(config: SandboxConfig)` | `core/factories.ts:29` | Creates a UI sandbox instance with execution and filesystem methods |
| `createSandboxConsole(config: SandboxConsoleConfig)` | `core/factories.ts:120` | Creates REPL-style console with history tracking and context persistence |
| `createSandboxFilesystem(config: SandboxFilesystemConfig)` | `core/factories.ts:260` | Creates enhanced filesystem interface with better error handling |

### **API Utilities**

| Method | Location | Purpose |
|--------|----------|---------|
| `executeComputeRequest(request, endpoint?)` | `utils/api.ts:20` | Generic function for making compute API requests via fetch |
| `APIError` | `utils/api.ts:6` | Error class for compute operations with status and code properties |

### **Formatting Utilities**

| Method | Location | Purpose |
|--------|----------|---------|
| `formatExecutionTime(milliseconds)` | `utils/api.ts:72` | Formats execution time for display (e.g., "1.2s", "2m 30s") |
| `formatOutput(output)` | `utils/api.ts:90` | Formats output string for display (trims whitespace) |
| `isComputeError(response)` | `utils/api.ts:97` | Checks if a compute response indicates an error |
| `getErrorMessage(response)` | `utils/api.ts:104` | Extracts error message from compute response |

### **Validation Utilities**

| Method | Location | Purpose |
|--------|----------|---------|
| `validateCode(code)` | `utils/validation.ts:6` | Validates code input (checks for string, non-empty, length limits) |
| `validateRuntime(runtime)` | `utils/validation.ts:30` | Validates runtime selection (must be 'python' or 'node') |
| `validateApiEndpoint(endpoint)` | `utils/validation.ts:49` | Validates API endpoint format (must start with "/") |
| `validateComputeConfig(config)` | `utils/validation.ts:69` | Validates compute configuration object |
| `validateComputeRequest(request)` | `utils/validation.ts:113` | Validates compute request structure |

### **Factory Method Details**

#### `createCompute()` Sandbox Operations
```typescript
const compute = createCompute({ apiEndpoint: '/api/compute', defaultRuntime: 'python' })

// Available methods:
compute.sandbox.create(options?)     // Create new sandbox
compute.sandbox.get(sandboxId)       // Get existing sandbox by ID  
compute.sandbox.list()               // List all sandboxes
compute.sandbox.destroy(sandboxId)   // Destroy a sandbox
```

#### `createSandbox()` Instance Methods
```typescript
const sandbox = createSandbox(config)

// Code execution:
sandbox.runCode(code, runtime?)      // Execute code
sandbox.runCommand(command, args?)   // Run shell commands
sandbox.getInfo()                    // Get sandbox information
sandbox.destroy()                    // Destroy sandbox

// Filesystem operations:
sandbox.filesystem.readFile(path)
sandbox.filesystem.writeFile(path, content)
sandbox.filesystem.mkdir(path)
sandbox.filesystem.readdir(path)
sandbox.filesystem.exists(path)
sandbox.filesystem.remove(path)
```

#### `createSandboxConsole()` REPL Methods
```typescript
const console = createSandboxConsole(config)

// REPL operations:
console.runCode(code, runtime?)      // Execute code with history tracking
console.runCommand(command, args?)   // Run commands with history
console.clear()                      // Clear console history
console.getContext()                 // Get execution context

// Properties:
console.sandboxId                    // Sandbox ID
console.history                      // Array of ConsoleEntry objects
console.isRunning                    // Boolean execution state
console.currentRuntime               // Current runtime environment
```

#### `createSandboxFilesystem()` Enhanced Methods
```typescript
const fs = createSandboxFilesystem(config)

// Enhanced filesystem operations (with better error handling):
fs.readFile(path): Promise<string>              // Returns string directly, throws on error
fs.writeFile(path, content): Promise<void>      // Throws on error
fs.mkdir(path): Promise<void>                   // Throws on error
fs.readdir(path): Promise<FileEntry[]>          // Returns file array directly
fs.exists(path): Promise<boolean>               // Returns boolean directly
fs.remove(path): Promise<void>                  // Throws on error
```

### **TypeScript Types & Interfaces**

**Core Types:**
- `Runtime` - 'node' | 'python'
- `SandboxStatus` - 'running' | 'stopped' | 'error'

**Request/Response Types:**
- `ComputeRequest` - API request structure with action-based routing
- `ComputeResponse` - API response structure with success/error handling

**UI Component Types:**
- `UISandbox` - Frontend sandbox interface
- `UIConsole` - REPL-style console interface  
- `UIFilesystem` - Enhanced filesystem interface

**Configuration Types:**
- `ComputeConfig` - Main compute configuration
- `SandboxConfig` - Sandbox creation config
- `SandboxConsoleConfig` - Console creation config
- `SandboxFilesystemConfig` - Filesystem creation config

**Console Types:**
- `ConsoleEntry` - Individual history entry structure
- `ConsoleResult` - Execution result structure

**Utility Types:**
- `ValidationResult` - Validation result structure with errors array
- `Theme` - UI theme configuration for components

### **Usage Patterns**

The UI package is framework-agnostic and provides:
1. **15 utility functions** for API integration, validation, and formatting
2. **20+ TypeScript types/interfaces** for type safety
3. **4 factory functions** for creating compute instances
4. **Enhanced error handling** with throws-on-error pattern for filesystem
5. **REPL-style console** with execution history and context persistence
6. **Validation utilities** for input sanitization and API endpoint checking