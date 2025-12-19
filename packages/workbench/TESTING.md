# Testing the Workbench

## Quick Start

### Option 1: Run with TypeScript (Recommended for Development)

```bash
cd packages/workbench
pnpm run dev:ts
```

This uses `tsx` to run the TypeScript source directly with hot reload.

### Option 2: Run Built Version

```bash
# Build first
cd packages/workbench
pnpm build

# Then run
node dist/bin/workbench.js
# or
npx workbench  # if installed globally
```

## Setup for Testing

### 1. Create a Test Environment File

Create a `.env` file in the root of the monorepo or in `packages/workbench/`:

```bash
# Example with E2B (easiest to get started)
E2B_API_KEY=e2b_your_api_key_here

# Or Railway
RAILWAY_API_KEY=your_railway_key
RAILWAY_PROJECT_ID=your_project_id
RAILWAY_ENVIRONMENT_ID=your_env_id

# Or Gateway (zero-config option)
COMPUTESDK_API_KEY=computesdk_live_xxx
```

### 2. Install Provider Dependencies

The workbench needs at least one provider package installed:

```bash
# Install providers you want to test
pnpm install --filter @computesdk/workbench @computesdk/e2b
# or
pnpm install --filter @computesdk/workbench @computesdk/railway
```

Or install them in the root:

```bash
pnpm add @computesdk/e2b --workspace-root
```

## Testing Checklist

### Basic Functionality

Start the workbench:
```bash
cd packages/workbench
pnpm run dev:ts
```

Then test these commands:

1. **Check environment status**
   ```
   workbench> env
   ```
   Should show which providers are configured.

2. **List providers**
   ```
   workbench> providers
   ```
   Should show provider status with ✅ for ready providers.

3. **Run a simple command** (auto-creates sandbox)
   ```
   workbench> echo('hello world')
   ```
   Should create a sandbox and run the command.

4. **Check sandbox info**
   ```
   workbench> info
   ```
   Should show current provider and uptime.

5. **Try filesystem operations**
   ```
   workbench> pwd()
   workbench> ls('/')
   workbench> mkdir('/test')
   workbench> cat('/etc/os-release')
   ```

6. **Test package managers**
   ```
   workbench> npm.install('cowsay')
   workbench> npx(['cowsay', 'Hello from workbench!'])
   ```

7. **Test git operations**
   ```
   workbench> git.init()
   workbench> git.status()
   ```

### Provider Switching

```
workbench> providers
workbench> provider railway
workbench> info
workbench> provider e2b
```

### Mode Switching (Gateway vs Direct)

```
workbench> mode
workbench> mode gateway
workbench> restart
workbench> mode direct
```

### Sandbox Lifecycle

```
workbench> info
workbench> restart
workbench> info
workbench> destroy
workbench> ls('/')  # Should auto-create new sandbox
```

### Tab Autocomplete

Press TAB to test autocomplete:
- `npm.<TAB>` - Should show npm commands
- `git.<TAB>` - Should show git commands
- `provider <TAB>` - Should show available providers
- `mode <TAB>` - Should show gateway/direct

### Verbose Mode

```
workbench> verbose
workbench> echo('test')  # Should show full result object
workbench> verbose  # Toggle back off
```

### Exit Behavior

```
workbench> exit
# Should prompt to destroy sandbox
```

## Testing Without Cloud Providers

If you don't have any cloud provider credentials, you can:

1. **Use the Docker provider** (if you have Docker installed):
   ```bash
   # In .env
   # No credentials needed for local Docker
   ```

2. **Mock the environment** for unit testing:
   ```bash
   cd packages/workbench
   # Create tests in src/__tests__/
   ```

## Common Issues

### "No providers detected"

**Cause**: No environment variables set
**Fix**: Create `.env` file with provider credentials

### "Provider package @computesdk/e2b is not installed"

**Cause**: Provider package not in node_modules
**Fix**: `pnpm install @computesdk/e2b --filter @computesdk/workbench`

### Commands hang or timeout

**Cause**: Sandbox not responding or provider issue
**Fix**: Try `restart` command or switch providers

### Autocomplete not working

**Cause**: REPL context not properly initialized
**Fix**: Restart workbench with `pnpm run dev:ts`

## Manual Testing Script

Create `packages/workbench/test-session.txt` with commands to test:

```
env
providers
echo('Hello workbench')
info
pwd()
ls('/')
mkdir('/test-dir')
ls('/')
npm.install('express')
git.init()
git.status()
info
providers
exit
```

Then pipe it through:
```bash
cat test-session.txt | pnpm run dev:ts
```

## Debugging

### Enable verbose mode by default

Edit `src/cli/state.ts` and set:
```typescript
verbose: true  // instead of false
```

### Add debug logging

Add `console.log()` statements in:
- `src/cli/commands.ts` - Command execution
- `src/cli/repl.ts` - REPL evaluation
- `src/cli/providers.ts` - Provider detection

### Check what's in context

In the REPL:
```javascript
Object.keys(this)  // See all available functions
```

## Integration Testing

To test the workbench as a user would:

1. Build the package:
   ```bash
   pnpm --filter @computesdk/workbench run build
   ```

2. Link it globally:
   ```bash
   cd packages/workbench
   pnpm link --global
   ```

3. Test the global command:
   ```bash
   workbench
   ```

4. Unlink when done:
   ```bash
   pnpm unlink --global @computesdk/workbench
   ```

## Next Steps

After basic testing works:

1. Add unit tests with Vitest
2. Add integration tests that spawn the REPL programmatically
3. Test error scenarios (invalid credentials, network failures)
4. Performance testing (rapid command execution)
5. Test on different platforms (macOS, Linux, Windows)
