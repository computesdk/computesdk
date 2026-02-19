/**
 * @computesdk/webcontainer
 * 
 * A WebContainer-compatible API for remote computesdk sandboxes.
 * 
 * This package provides a drop-in replacement for the WebContainer API that works
 * with remote sandboxes instead of in-browser execution. This allows existing
 * WebContainer-based applications to run on more powerful remote infrastructure.
 * 
 * The API is designed to be as close to the original WebContainer API as possible,
 * so existing code should work with minimal changes.
 * 
 * @example
 * ```typescript
 * import { WebContainer } from '@computesdk/webcontainer';
 * 
 * // Boot connects to a remote sandbox (auto-detects URL from query params or localStorage)
 * const container = await WebContainer.boot();
 * 
 * // Or with explicit connection info
 * const container = await WebContainer.boot({
 *   sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
 *   token: 'your-session-token',
 * });
 * 
 * // Use the familiar WebContainer API
 * await container.mount({
 *   'package.json': { file: { contents: '{"name": "my-app"}' } },
 *   'index.js': { file: { contents: 'console.log("Hello!")' } },
 * });
 * 
 * const process = await container.spawn('node', ['index.js']);
 * process.output.pipeTo(new WritableStream({
 *   write(data) { console.log(data); }
 * }));
 * 
 * await process.exit;
 * container.teardown();
 * ```
 * 
 * ## Connection Methods
 * 
 * The sandbox URL and token can be provided in several ways:
 * 
 * 1. **Explicit options**: Pass `sandboxUrl` and `token` to `boot()`
 * 2. **URL parameters**: Include `?sandbox_url=...&session_token=...` in the page URL
 * 3. **localStorage**: Set `sandbox_url` and `session_token` keys
 * 
 * URL parameters are automatically cleaned from the URL and stored in localStorage.
 * 
 * @packageDocumentation
 */

// Main class
export { WebContainer } from './webcontainer';

// Types
export type {
  // File system types
  FileSystemAPI,
  FileSystemTree,
  FileNode,
  SymlinkNode,
  DirectoryNode,
  DirEnt,
  BufferEncoding,
  MkdirOptions,
  ReaddirOptions,
  RmOptions,
  WatchOptions,
  WatchListener,
  Watcher,
  
  // Process types
  WebContainerProcess,
  SpawnOptions,
  
  // Export types
  ExportOptions,
  
  // Preview types
  PreviewMessage,
  PreviewScriptOptions,
  BasePreviewMessage,
  UncaughtExceptionMessage,
  UnhandledRejectionMessage,
  ConsoleErrorMessage,
  
  // Event listeners
  PortListener,
  ErrorListener,
  ServerReadyListener,
  PreviewMessageListener,
  
  // Boot/Connect options
  BootOptions,
  ConnectOptions,
  MountOptions,
} from './types';

export { PreviewMessageType } from './types';

// Utility for iframe preview reloading
export async function reloadPreview(
  preview: HTMLIFrameElement, 
  hardRefreshTimeout?: number
): Promise<void> {
  // For remote sandboxes, we just reload the iframe src
  const src = preview.src;
  preview.src = '';
  await new Promise(resolve => setTimeout(resolve, hardRefreshTimeout || 200));
  preview.src = src;
}

// Note: WebContainer's `auth` namespace and `configureAPIKey` are not exported.
// - `auth` is specific to StackBlitz OAuth for private npm packages
// - `configureAPIKey` is for WebContainer commercial licensing
// For computesdk, authentication is handled via the `token` option in boot().
// Private npm packages should be configured via .npmrc or env vars on the sandbox.
