# @computesdk/cmd

Type-safe shell command builders for use with ComputeSDK sandboxes.

## Installation

```bash
npm install @computesdk/cmd
```

## Usage

### Basic Commands

```typescript
import { cmd, npm, node, git } from '@computesdk/cmd';

// Build command tuples
npm.install('express')        // ['npm', 'install', 'express']
node('server.js')             // ['node', 'server.js']
git.clone('https://...')      // ['git', 'clone', 'https://...']

// Use with sandbox.runCommand()
await sandbox.runCommand(npm.install('express'));
await sandbox.runCommand(node('server.js'));
```

### Using with runCommand Options

Modern ComputeSDK sandboxes handle `cwd`, `env`, and `background` options directly:

```typescript
import { npm, node } from '@computesdk/cmd';

// Let the sandbox handle execution options
await sandbox.runCommand('npm install', { cwd: '/app' })
await sandbox.runCommand('node server.js', { background: true })
await sandbox.runCommand('npm run dev', { 
  cwd: '/app', 
  background: true,
  env: { NODE_ENV: 'production' }
})
```

### Shell Wrapping (Advanced)

For cases where you need explicit shell wrapping, use `shell()`, `sh()`, `bash()`, or `zsh()`:

```typescript
import { shell, bash, zsh, npm } from '@computesdk/cmd';

// Default shell wrapper (sh)
shell(npm.install(), { cwd: '/app' })
// => ['sh', '-c', 'cd "/app" && npm install']

// Bash-specific
bash(npm.install(), { cwd: '/app' })
// => ['bash', '-c', 'cd "/app" && npm install']

// Zsh with background
zsh(npm.run('dev'), { background: true })
// => ['zsh', '-c', 'nohup npm run dev > /dev/null 2>&1 &']
```

**Note:** Shell wrapping is rarely needed - prefer using `runCommand()` options instead.

## Available Commands

### File System
- `mkdir(path, options?)` - Create directory (recursive by default)
- `rm(path, options?)` - Remove file/directory
- `cp(src, dest, options?)` - Copy
- `mv(src, dest)` - Move/rename
- `ls(path?, options?)` - List directory
- `pwd()` - Print working directory
- `chmod(mode, path, options?)` - Change permissions
- `chown(owner, path, options?)` - Change owner
- `touch(path)` - Create file/update timestamp
- `cat(path)` - Read file
- `ln(target, link, options?)` - Create link
- `readlink(path, options?)` - Resolve symlink
- `rsync(src, dest, options?)` - Sync files/directories

### Filesystem Tests
- `test.exists(path)` - File/dir exists
- `test.isFile(path)` - Is a file
- `test.isDir(path)` - Is a directory
- `test.isReadable(path)` - Is readable
- `test.isWritable(path)` - Is writable
- `test.isExecutable(path)` - Is executable
- `test.notEmpty(path)` - File is not empty
- `test.isSymlink(path)` - Is a symlink

### Process/Execution
- `node(script, args?)` - Run Node.js script
- `python(script, args?)` - Run Python script
- `kill(pid, signal?)` - Kill process by PID
- `pkill(name, options?)` - Kill by name
- `ps(options?)` - List processes
- `timeout(seconds, command, args?)` - Run with timeout

### Package Managers (JavaScript)
- `npm.install(pkg?, options?)`, `npm.run(script)`, `npm.init()`, `npm.uninstall(pkg)`
- `pnpm.install(pkg?, options?)`, `pnpm.run(script)`
- `yarn.install()`, `yarn.add(pkg, options?)`, `yarn.run(script)`
- `bun.install(pkg?, options?)`, `bun.run(script)`, `bun.exec(file)`
- `deno.run(file, options?)`, `deno.install(url, options?)`

### Package Managers (Python)
- `pip.install(pkg)`, `pip.uninstall(pkg)`
- `uv.install(pkg)`, `uv.run(script)`, `uv.sync()`, `uv.venv(path?)`
- `poetry.install(options?)`, `poetry.add(pkg, options?)`, `poetry.run(cmd)`, `poetry.build()`
- `pipx.install(pkg)`, `pipx.run(pkg, args?)`, `pipx.uninstall(pkg)`, `pipx.upgrade(pkg)`

### Package Runners
- `npx(pkg, args?)` - Run with npx
- `npx.concurrently(commands, options?)` - Run commands in parallel
- `bunx(pkg, args?)` - Run with bunx
- `bunx.concurrently(commands, options?)`

### Git
- `git.init()` - Initialize repository
- `git.clone(url, options?)` - Clone repository
- `git.add(path, options?)` - Stage files
- `git.commit(message, options?)` - Commit changes
- `git.push(options?)` - Push to remote
- `git.pull()` - Pull changes
- `git.fetch(options?)` - Fetch from remote
- `git.checkout(branch, options?)` - Checkout branch
- `git.branch(name?, options?)` - List/create branches
- `git.status()` - Show status
- `git.diff(options?)` - Show changes
- `git.log(options?)` - Show commit history
- `git.stash(options?)` - Stash changes
- `git.reset(options?)` - Reset changes

### Network
- `curl(url, options?)` - Download with curl
- `wget(url, options?)` - Download with wget
- `net.ping(host, count?)` - Ping host
- `net.check(host, port)` - Check connectivity
- `net.publicIp()` - Get public IP
- `net.interfaces()` - Show network interfaces

### Ports
- `port.find(port)` - Find process using port
- `port.kill(port)` - Kill process on port
- `port.isUsed(port)` - Check if port is in use
- `port.list()` - List listening ports
- `port.waitFor(port, timeout?)` - Wait for port

### Archives
- `tar.extract(file, options?)` - Extract tar archive
- `tar.create(output, source)` - Create tar archive
- `unzip(file, options?)` - Extract zip archive

### Text Processing
- `grep(pattern, file?, options?)` - Search for pattern
- `sed(expression, file, options?)` - Stream editor
- `awk(program, file?, options?)` - Pattern scanning
- `head(file, lines?)` - First lines of file
- `tail(file, lines?, options?)` - Last lines of file
- `wc(file, options?)` - Word/line count
- `sort(file, options?)` - Sort lines
- `uniq(file, options?)` - Filter duplicates
- `jq(filter, file?, options?)` - Process JSON
- `cut(file, options)` - Extract columns
- `tr(set1, set2?, options?)` - Translate characters
- `xargs(command, args?, options?)` - Build commands from stdin

### System
- `df(path?, options?)` - Disk space
- `du(path, options?)` - Directory size
- `whoami()` - Current user
- `uname(options?)` - System info
- `hostname()` - Hostname
- `env()` - Environment variables
- `printenv(name?)` - Print env variable
- `which(command)` - Find command location

### Encoding/Checksums
- `base64.encode(file?)` - Encode to base64
- `base64.decode(file?)` - Decode from base64
- `md5sum(file, options?)` - MD5 checksum
- `sha256sum(file, options?)` - SHA256 checksum
- `sha1sum(file, options?)` - SHA1 checksum

### Utilities
- `sleep(seconds)` - Delay execution
- `date(format?)` - Print date/time
- `find(path, options?)` - Find files
- `tee(file, options?)` - Write to file and stdout
- `diff(file1, file2, options?)` - Compare files
- `echo(text)` - Print text
- `parallel(commands, options?)` - Run commands in parallel
- `raw(command, args?)` - Custom command

## Utilities

### `esc(string)`

Escape double quotes in strings for shell safety:

```typescript
import { esc } from '@computesdk/cmd';

esc('path with "quotes"')  // 'path with \\"quotes\\"'
```

## License

MIT
