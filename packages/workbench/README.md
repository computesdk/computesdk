# @computesdk/workbench

Interactive REPL for testing ComputeSDK sandbox operations with instant feedback and autocomplete.

## Features

- 🚀 **Zero ceremony** - Just run commands, no sandbox ID management
- ✨ **Tab autocomplete** - All 100+ `@computesdk/cmd` functions autocomplete
- 🔄 **Provider switching** - Seamlessly switch between e2b, railway, daytona, etc.
- ⚡ **Smart evaluation** - Type `npm.install('express')` and it just runs
- 📊 **Real-time feedback** - See timing, output, and errors instantly

## Installation

```bash
npm install -D @computesdk/workbench

# Install at least one provider
npm install @computesdk/e2b
# or
npm install @computesdk/railway
# or any other provider
```

## Quick Start

1. **Configure credentials** in `.env`:

```bash
# E2B Provider
E2B_API_KEY=e2b_your_api_key_here

# Railway Provider  
RAILWAY_API_KEY=your_railway_api_key
RAILWAY_PROJECT_ID=your_project_id
RAILWAY_ENVIRONMENT_ID=your_environment_id
```

2. **Start workbench**:

```bash
npx workbench
```

3. **Run commands** (autocomplete works!):

```
workbench> npm.install('express')
⏳ Creating sandbox with e2b...
✅ Sandbox ready (1.2s)
Running: npm install express
✅ Completed (3.2s)

workbench> git.clone('https://github.com/user/repo')
Running: git clone https://github.com/user/repo
✅ Completed (2.1s)

workbench> ls('/home')
Running: ls /home
total 8
drwxr-xr-x 3 user user 4096 Dec 12 19:00 node_modules
drwxr-xr-x 2 user user 4096 Dec 12 19:01 repo
✅ Completed (0.1s)
```

## Commands

### Workbench Commands

- `provider <name>` - Switch provider (e2b, railway, etc.)
- `providers` - List all providers with status
- `restart` - Restart current sandbox
- `destroy` - Destroy current sandbox
- `info` - Show sandbox info (provider, uptime)
- `env` - Show environment/credentials status
- `help` - Show this help
- `exit` - Exit workbench

### Running Commands

Just type any `@computesdk/cmd` function. Tab autocomplete works!

**Package Managers:**
```javascript
npm.install('express')
npm.run('dev')
pnpm.install()
yarn.add('lodash')
pip.install('requests')
```

**Git:**
```javascript
git.clone('https://...')
git.commit('Initial commit')
git.push()
```

**Filesystem:**
```javascript
mkdir('/app/src')
ls('/home')
cat('/home/file.txt')
cp('/src', '/dest', { recursive: true })
rm('/file.txt')              // Remove file
rm.rf('/directory')          // Force remove anything
rm.auto('/path')             // Smart remove (auto-detects file vs directory)
```

**Network:**
```javascript
curl('https://api.example.com')
wget('https://file.com/download.zip')
```

**And 100+ more!** Press Tab to explore.

## Provider Switching

Switch between providers on the fly:

```
workbench> provider railway
Destroy current sandbox? (y/N): y
✅ Destroyed e2b sandbox
⏳ Creating sandbox with railway...
✅ Sandbox ready (2.1s)
Switched to railway

workbench> npm.install('lodash')
Running: npm install lodash
✅ Completed (2.8s)
```

## Tab Autocomplete

Autocomplete works for all commands:

```
workbench> npm.<TAB>
install  run  init  uninstall

workbench> git.<TAB>
add  branch  checkout  clone  commit  diff  fetch  
init  log  pull  push  reset  stash  status

workbench> provider <TAB>
e2b  railway  daytona  modal  runloop  vercel
```

## Supported Providers

### Gateway Provider (Zero-Config)

The **gateway** provider uses the ComputeSDK API to automatically route to any provider:

- No provider packages needed
- Just set `COMPUTESDK_API_KEY` + provider credentials
- Auto-detects provider from your environment

### Direct Provider Packages

Install any combination of:

- `@computesdk/e2b` - E2B sandboxes
- `@computesdk/railway` - Railway environments
- `@computesdk/daytona` - Daytona workspaces
- `@computesdk/modal` - Modal containers
- `@computesdk/runloop` - Runloop instances
- `@computesdk/vercel` - Vercel functions
- `@computesdk/cloudflare` - Cloudflare Workers
- `@computesdk/codesandbox` - CodeSandbox boxes
- `@computesdk/blaxel` - Blaxel environments

## Environment Variables

Set provider credentials in `.env`:

```bash
# Gateway Provider (Zero-Config)
COMPUTESDK_API_KEY=computesdk_live_xxx

# E2B
E2B_API_KEY=e2b_xxx

# Railway
RAILWAY_API_KEY=xxx
RAILWAY_PROJECT_ID=xxx
RAILWAY_ENVIRONMENT_ID=xxx

# Daytona
DAYTONA_API_KEY=xxx

# Modal
MODAL_TOKEN_ID=xxx
MODAL_TOKEN_SECRET=xxx

# Runloop
RUNLOOP_API_KEY=xxx

# Vercel
VERCEL_TOKEN=xxx
VERCEL_TEAM_ID=xxx
VERCEL_PROJECT_ID=xxx

# Cloudflare
CLOUDFLARE_API_TOKEN=xxx
CLOUDFLARE_ACCOUNT_ID=xxx

# CodeSandbox
CSB_API_KEY=xxx

# Blaxel
BL_API_KEY=xxx
BL_WORKSPACE=xxx
```

## Tips

- **Command history**: Use ↑/↓ arrows to navigate previous commands
- **Exit gracefully**: Type `exit` or `.exit`, optionally destroy sandbox
- **Check status**: Run `env` to see which providers are configured
- **Auto-create**: First command automatically creates a sandbox
- **Stay in context**: Workbench maintains "current sandbox" - no IDs to track

## License

MIT
