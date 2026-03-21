# @computesdk/secure-exec

Secure Exec provider for ComputeSDK — V8 isolate-based sandboxed JavaScript execution with JSON return values.

- **Website:** https://secureexec.dev
- **Docs:** https://secureexec.dev/docs
- **GitHub:** https://github.com/rivet-dev/secure-exec

## Usage

```typescript
import { secureExec } from '@computesdk/secure-exec';

const compute = secureExec();
const sandbox = await compute.sandbox.create();

// runCommand evaluates JS and returns JSON in stdout
const result = await sandbox.runCommand('({ answer: 1 + 1 })');
console.log(result.stdout); // '{"answer":2}'

// runCode executes JS and captures console output
const code = await sandbox.runCode('console.log("hello")');
console.log(code.output); // 'hello'

await sandbox.destroy();
```
