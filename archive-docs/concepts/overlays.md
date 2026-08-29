# Overlays

Overlays allow you to instantly bootstrap a sandbox from a template directory. They're perfect for setting up development environments with pre-configured dependencies, frameworks, or project structures.

## Overview

When you create an overlay, ComputeSDK copies files from a source directory (template) into a target path in your sandbox. With the `smart` strategy, immutable directories like `node_modules` are symlinked for instant setup, while other files are copied in the background.

## Basic Usage

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Create an overlay from a template
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/nextjs',
  target: './project',
});

console.log(overlay.id);         // Unique overlay ID
console.log(overlay.copyStatus); // 'pending' | 'in_progress' | 'complete' | 'failed'
```

## Strategies

### Copy Strategy (Default)

Full copy of all files. Safest option but slower for large directories.

```typescript
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/react',
  target: './app',
  strategy: 'copy',
});
```

### Smart Strategy (Recommended)

Uses symlinks for immutable directories (like `node_modules`) for instant creation. Other files are copied directly, with heavy directories copied in the background.

```typescript
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/react',
  target: './app',
  strategy: 'smart',
});
```

## Waiting for Completion

Background copying happens asynchronously. You can wait for it to complete:

```typescript
// Option 1: Wait on creation
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/nextjs',
  target: './project',
  strategy: 'smart',
  waitForCompletion: true,  // Blocks until fully copied
});

// Option 2: Wait after creation
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/nextjs',
  target: './project',
});

// Do other setup...

// Then wait when needed
const completed = await sandbox.filesystem.overlay.waitForCompletion(overlay.id);
console.log(completed.copyStatus); // 'complete'
```

### Custom Wait Options

```typescript
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/large-project',
  target: './project',
  waitForCompletion: {
    maxRetries: 120,        // Maximum polling attempts (default: 60)
    initialDelayMs: 500,    // Initial delay between retries (default: 500)
    maxDelayMs: 10000,      // Maximum delay with backoff (default: 5000)
    backoffFactor: 1.5,     // Exponential backoff multiplier (default: 1.5)
  },
});
```

## Ignoring Files

Exclude files or directories from the overlay:

```typescript
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/react',
  target: './app',
  ignore: [
    'node_modules',  // Skip node_modules entirely
    '*.log',         // Skip log files
    '.git',          // Skip git directory
    '**/*.test.js',  // Skip test files
  ],
});
```

## Overlay Information

### Retrieve an Overlay

```typescript
const overlay = await sandbox.filesystem.overlay.retrieve('overlay-id');

console.log(overlay.id);
console.log(overlay.source);
console.log(overlay.target);
console.log(overlay.strategy);    // 'copy' | 'smart'
console.log(overlay.copyStatus);  // 'pending' | 'in_progress' | 'complete' | 'failed'
console.log(overlay.copyError);   // Error message if failed
console.log(overlay.createdAt);

// Statistics
console.log(overlay.stats.copiedFiles);  // Number of files copied
console.log(overlay.stats.copiedDirs);   // Number of directories copied
console.log(overlay.stats.skipped);      // Paths that were skipped
```

### List All Overlays

```typescript
const overlays = await sandbox.filesystem.overlay.list();

overlays.forEach(overlay => {
  console.log(`${overlay.target}: ${overlay.copyStatus}`);
});
```

### Delete an Overlay

```typescript
await sandbox.filesystem.overlay.destroy('overlay-id');
```

## Using with Sandbox Creation

You can create overlays automatically when creating a sandbox:

```typescript
const sandbox = await compute.sandbox.create({
  overlays: [{
    source: '/templates/nextjs',
    target: './project',
    strategy: 'smart',
  }],
});
```

## Using with Servers

Combine overlays with servers for a complete development environment:

```typescript
const sandbox = await compute.sandbox.create({
  overlays: [{
    source: '/templates/nextjs',
    target: './project',
    strategy: 'smart',
  }],
  servers: [{
    slug: 'dev',
    install: 'npm install',
    start: 'npm run dev',
    path: './project',
  }],
});

// Server waits for overlay to complete before starting
const server = await sandbox.server.retrieve('dev');
console.log(server.url);
```

## Inline Overlays in Server Start

You can also create overlays inline when starting a server:

```typescript
const server = await sandbox.server.start({
  slug: 'web',
  start: 'npm run dev',
  path: './app',
  overlay: {
    source: '/templates/react',
    target: './app',
    strategy: 'smart',
  },
});
```

## Best Practices

1. **Use `smart` strategy** for templates with `node_modules` - it's much faster
2. **Use `ignore` patterns** to skip unnecessary files (`.git`, logs, etc.)
3. **Wait for completion** before running commands that depend on overlay files
4. **Use inline overlays** with servers for automatic dependency handling

## Error Handling

```typescript
try {
  const overlay = await sandbox.filesystem.overlay.create({
    source: '/templates/react',
    target: './app',
    waitForCompletion: true,
  });
} catch (error) {
  if (error.message.includes('Overlay copy failed')) {
    console.error('Template copy failed:', error.message);
  } else if (error.message.includes('timed out')) {
    console.error('Copy took too long - template may be very large');
  }
}
```
