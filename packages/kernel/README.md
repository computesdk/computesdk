# @computesdk/kernel

Kernel provider for ComputeSDK that enables creating and managing browser automation sessions on Kernel's cloud infrastructure.

## Installation

```bash
npm install @computesdk/kernel
```

## Configuration

The Kernel provider requires the following environment variable:

```bash
KERNEL_API_KEY=your_kernel_api_key
```

You can get your API key from [Kernel Platform](https://onkernel.com/).

## Usage

```typescript
import { kernel } from '@computesdk/kernel';

const provider = kernel({
  apiKey: 'your_api_key'
});

// Create a browser session
const session = await provider.sandbox.create({
  timeout_seconds: 300,
  stealth: true  // Enable stealth mode for bot detection avoidance
});
console.log(`Created browser session: ${session.sandboxId}`);

// List all browser sessions
const sessions = await provider.sandbox.list();
console.log(`Found ${sessions.length} active sessions`);

// Get session details by ID
const details = await provider.sandbox.getById(session.sandboxId);
console.log('Session details:', details);

// Destroy the browser session
await provider.sandbox.destroy(session.sandboxId);
```

## API Reference

### Sandbox Operations

#### `create(options?)`

Creates a new browser session on Kernel's cloud infrastructure.

**Options:**
- `timeout_seconds` (number, optional) - Session timeout in seconds (default: 300)
- `headless` (boolean, optional) - Launch browser in headless mode (no VNC/GUI). Defaults to false.
- `stealth` (boolean, optional) - Launch browser in stealth mode to reduce bot detection. Defaults to false.

**Returns:** `Promise<{ sandbox: KernelSession, sandboxId: string }>`

The response includes:
- `session_id` - Unique identifier for the browser session
- `browser_live_view_url` - URL to view browser session in real-time via web interface
- `cdp_ws_url` - WebSocket URL for Chrome DevTools Protocol connection
- `created_at` - ISO timestamp of session creation
- `headless` - Whether browser is running in headless mode
- `stealth` - Whether browser is running in stealth mode to avoid detection
- `timeout_seconds` - Configured timeout in seconds

#### `getById(sessionId)`

Retrieves details for a specific browser session.

**Parameters:**
- `sessionId` (string) - The ID of the browser session

**Returns:** `Promise<{ sandbox: KernelSession, sandboxId: string } | null>`

Returns `null` if the session is not found.

#### `list()`

Lists all active browser sessions in your Kernel account.

**Returns:** `Promise<Array<{ sandbox: KernelSession, sandboxId: string }>>`

#### `destroy(sessionId)`

Terminates a browser session.

**Parameters:**
- `sessionId` (string) - The ID of the session to destroy

**Returns:** `Promise<void>`

## Configuration Options

The Kernel provider accepts the following configuration:

```typescript
interface KernelConfig {
  apiKey?: string;  // Kernel API key (falls back to KERNEL_API_KEY env var)
}
```

## Session Structure

```typescript
interface KernelSession {
  /** Unique identifier for the browser session */
  session_id: string;
  /** URL to view and interact with the browser session in real-time via web interface */
  browser_live_view_url: string;
  /** WebSocket URL for Chrome DevTools Protocol (CDP) connection - use with Puppeteer/Playwright */
  cdp_ws_url: string;
  /** ISO 8601 timestamp of when the session was created */
  created_at: string;
  /** Whether the browser is running in headless mode (no GUI/VNC) */
  headless: boolean;
  /** Whether the browser is running in stealth mode to avoid bot detection */
  stealth: boolean;
  /** Session timeout in seconds */
  timeout_seconds: number;
}
```

## Currently Implemented

### Sandbox Operations
- **create()** - Creates a new browser session with configurable timeout
- **getById()** - Retrieves session details including connection URLs
- **list()** - Lists all active browser sessions
- **destroy()** - Terminates a browser session

### Configuration Options
- **apiKey** - Kernel API authentication token
- **timeout_seconds** - Session timeout configuration (default: 300 seconds)
- **headless** - Run browser without GUI (default: false)
- **stealth** - Enable stealth mode for bot detection avoidance (default: false)

## Not Yet Implemented

The following methods are planned for future releases:
- `runCode()` - Execute code in the browser context
- `runCommand()` - Run commands in the browser environment
- `getInfo()` - Get browser session metadata
- `getUrl()` - Get session URL for web access


## Notes

- Browser sessions are automatically terminated after the configured timeout
- Default timeout is 60 seconds (1 minute)
- Sessions are immediately destroyed when the destroy operation is called
- All operations use Kernel's REST API

