# ComputeSDK CLI

The `compute` command provides a local development server for ComputeSDK with sandbox environments and tunnel connectivity.

## Commands

### `compute`
Start the compute server.

**Flags:**
- `--api-key <key>` - API key for authentication
- `--access-token <token>` - Access token for authentication
- `--help, -h` - Help for compute
- `--version, -v` - Version for compute

### `compute start`
Start the compute server in the background using eixisting API key or access token.

### `compute stop`
Stop the running compute server.

### `compute status`
Check the status of the compute server and show sandbox information.

**Shows:**
- Running status and PID
- Configured sandboxes and URLs
- Log file location and recent entries
- Magic authentication link (if auth enabled)

### `compute restart`
Stop and restart the compute server with saved configuration.


### `compute logs`
View compute server logs.

**Flags:**
- `--follow, -f` - Follow log output (like tail -f)
- `--lines, -n <number>` - Number of lines to show (default: 50)

### `compute completion`
Generate autocompletion script for the specified shell.

**Usage:**
- `compute completion bash` - Generate completion script for bash
- `compute completion zsh` - Generate completion script for zsh
- `compute completion fish` - Generate completion script for fish
- `compute completion powershell` - Generate completion script for PowerShell

### `compute help`
Show help about any command.

**Usage:**
- `compute help` - Show general help
- `compute help [command]` - Show help for specific command

## Configuration

**Config Location:** `~/.compute/config.json`

**Log Location:** `~/.compute/compute.log`

**Sandboxes:** `~/.compute/sandboxes/`