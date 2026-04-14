——# @computesdk/dimension
 
ComputeSDK provider for [Dimension Runtime](https://dimension.dev) — the deterministic execution platform with sub-7ms cold-start.
 
## Installation
 
```bash
npm install @computesdk/dimension
```
 
## Configuration
 
| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `DIMENSION_API_KEY` | Yes | — | API key for authentication |
| `DIMENSION_API_URL` | No | `https://41quc7j7xb.execute-api.us-east-2.amazonaws.com` | Base URL of Dimension API server |
 
## Usage
 
```typescript
import { dimension } from '@computesdk/dimension';
 
// Create provider instance
const compute = dimension({
  apiKey: process.env.DIMENSION_API_KEY,
  apiUrl: process.env.DIMENSION_API_URL, // optional
});
 
// Create a sandbox
const sandbox = await compute.sandbox.create({ runtime: 'node' });
 
// Run code
const codeResult = await sandbox.runCode('console.log("hello world")');
console.log(codeResult.output);    // "hello world"
console.log(codeResult.exitCode);  // 0
console.log(codeResult.language);  // "node"
 
// Run shell command
const cmdResult = await sandbox.runCommand('node', ['-v']);
console.log(cmdResult.stdout);     // "v20.x.x"
console.log(cmdResult.exitCode);   // 0
console.log(cmdResult.durationMs); // 6.6
 
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.status);   // "running"
console.log(info.provider); // "dimension"
 
// Destroy sandbox
await sandbox.destroy();
```
 
## Auto-Detection
 
When calling `runCode()` without specifying a runtime, the provider auto-detects:
 
- **Python**: Code containing `print(`, `def `, `import `, `class ... self`
- **Node.js**: Everything else (default)
 
```typescript
// Auto-detected as Python
await sandbox.runCode('print("hello from python")');
 
// Auto-detected as Node.js
await sandbox.runCode('console.log("hello from node")');
 
// Explicit runtime
await sandbox.runCode('Bun.serve({...})', 'bun');
```
 
## Supported Runtimes
 
| Runtime | Status |
|---------|--------|
| Node.js | Supported |
| Python  | Supported |
| Deno    | Planned |
| Bun     | Planned |
 
## Sandbox Management
 
```typescript
// List all active sandboxes
const sandboxes = await compute.sandbox.list();
 
// Get sandbox by ID
const existing = await compute.sandbox.getById('sbx_abc123');
 
// Destroy by ID
await compute.sandbox.destroy('sbx_abc123');
```
 
## Performance
 
Dimension Runtime is ranked #1 on the ComputeSDK leaderboard:
 
| Metric | Value |
|--------|-------|
| Sequential TTI | 6.6ms median |
| Composite Score | 99.4/100 |
| Success Rate | 100% |
 
## Architecture
 
Dimension Runtime provides:
- Syscall-level hypervisor (seccomp USER_NOTIF, 0 ALLOW paths)
- Bit-exact deterministic replay from causal seed
- Structural multi-tenant isolation (routing-layer, not permission-based)
- Sub-millisecond warm-start via CausalDir artifact caching
 
## License
 
MIT
 
