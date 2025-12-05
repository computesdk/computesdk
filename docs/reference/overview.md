# ComputeSDK: Secure Code Execution Anywhere

ComputeSDK provides a unified interface for running code in secure, isolated environments across multiple cloud providers. Whether you're building AI applications, developer tools, or serverless backends, ComputeSDK makes it easy to execute untrusted code safely.

## Core Concepts

### Sandbox: Your Isolated Workspace
A sandbox is an isolated environment where your code executes securely. Each sandbox provides:
- Isolated filesystem
- Network restrictions
- Resource limits
- Clean environment for each execution

Jump to [Quick Start →](/docs/getting-started/quick-start)

Or learn more about [managing sandboxes →](/docs/reference/sandbox-management)

### Providers: Powering Your Sandboxes
ComputeSDK supports multiple execution backends (see providers for details)

[Configure your provider →](/docs/reference/configuration)

## Key Features

### 1. Run Node.js, Python, and more
Execute code in multiple languages with automatic runtime detection.

[Learn about code execution →](/docs/reference/code-execution)

### 2. Full Filesystem Access
Interact with files in your sandbox:

[Explore filesystem operations →](/docs/reference/filesystem)

<!-- ### 3. Web Integration & UI Package
Build interactive web applications using our UI package:

[Learn about web integration →](/docs/reference/api-integration#web-integration)

[See UI package →](/docs/reference/ui-package) -->

### 3. Sandbox Options
Configure your sandbox with options to customize its behavior.

[Learn about sandbox options →](/docs/reference/api-integration#sandbox-options)

### 4. Error Handling
Handle errors and exceptions in your code.

[Learn about error handling →](/docs/reference/api-integration#error-handling)