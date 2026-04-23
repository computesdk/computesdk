# Client-Side Access

ComputeSDK v2 includes a complete authentication system for delegating sandbox access to browser clients without exposing your API keys. This is essential for building web applications where users interact directly with sandboxes.

## Overview

There are two ways to grant client-side access:

1. **Session Tokens** - Scoped credentials you create server-side and pass to your frontend
2. **Magic Links** - One-time URLs that automatically authenticate users in the browser

Once authenticated, browser clients can use the full SDK including terminals, file watchers, and signals—all over WebSocket with automatic reconnection.

## Session Tokens

Session tokens are the recommended approach for most applications. You create them server-side and pass them to your frontend.

### Creating a Session Token

```typescript
// Server-side code
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Create a session token
const session = await sandbox.sessionToken.create({
  description: 'User session',
  expiresIn: 86400, // 24 hours in seconds
});

// Send to frontend
res.json({
  sandboxUrl: sandbox.url,
  token: session.token,
});
```

### Using a Session Token (Frontend)

```typescript
// Frontend code
import { Sandbox } from 'computesdk/client';

// Connect to sandbox with token
const sandbox = await Sandbox.connect({
  url: sandboxUrl,
  token: sessionToken,
});

// Now you can use all sandbox features
const terminal = await sandbox.terminal.create({ pty: true });
terminal.on('output', (data) => console.log(data));
terminal.write('ls -la\n');
```

### Managing Session Tokens

```typescript
// List all session tokens
const tokens = await sandbox.sessionToken.list();
tokens.forEach(token => {
  console.log(`${token.id}: ${token.description}`);
  console.log(`  Created: ${token.createdAt}`);
  console.log(`  Expires: ${token.expiresAt}`);
  console.log(`  Last used: ${token.lastUsedAt || 'never'}`);
});

// Retrieve a specific token
const token = await sandbox.sessionToken.retrieve('token-id');

// Revoke a token (invalidates it immediately)
await sandbox.sessionToken.revoke('token-id');
```

### Session Token Options

```typescript
const session = await sandbox.sessionToken.create({
  description: 'CI Pipeline',  // Optional description for identification
  expiresIn: 3600,             // Expiration in seconds (default: 7 days)
});
```

## Magic Links

Magic links are one-time URLs that automatically create a session and set a cookie in the user's browser. They're ideal for:

- Email-based authentication
- Shareable preview links
- One-click access without frontend token handling

### Creating a Magic Link

```typescript
// Server-side code
const link = await sandbox.magicLink.create({
  redirectUrl: '/workspace',  // Where to redirect after auth
});

console.log(link.url);       // One-time authentication URL
console.log(link.expiresAt); // When the link expires

// Send link to user (email, chat, etc.)
sendEmail(userEmail, `Click here to access your workspace: ${link.url}`);
```

### How Magic Links Work

1. User clicks the magic link URL
2. ComputeSDK validates the link and creates a session
3. A session cookie is set in the browser
4. User is redirected to `redirectUrl`
5. Frontend can now access the sandbox (cookie is sent automatically)

### Magic Link Flow Example

```typescript
// Server: Generate and send magic link
app.post('/api/invite', async (req, res) => {
  const sandbox = await compute.sandbox.findOrCreate({
    name: req.body.projectId,
    namespace: req.body.teamId,
  });

  const link = await sandbox.magicLink.create({
    redirectUrl: `/project/${req.body.projectId}`,
  });

  await sendInviteEmail(req.body.email, link.url);
  res.json({ success: true });
});

// Frontend: After redirect, sandbox is accessible
// (cookie is automatically included in requests)
const sandbox = await Sandbox.connect({
  url: sandboxUrl,
  // No token needed - cookie is used automatically
});
```

## Browser SDK Features

Once authenticated (via token or magic link), browser clients have access to:

### Interactive Terminals

```typescript
const terminal = await sandbox.terminal.create({ 
  pty: true,
  shell: '/bin/bash'
});

terminal.on('output', (data) => {
  terminalElement.innerHTML += data;
});

terminal.on('error', (error) => {
  console.error('Terminal error:', error);
});

terminal.write('npm run dev\n');
terminal.resize(120, 40);
```

### File Watchers

```typescript
const watcher = await sandbox.watcher.create('/project', {
  ignored: ['node_modules', '.git'],
  includeContent: true,
});

watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
  if (event.content) {
    editor.setValue(event.content);
  }
});
```

### Signal Service (Port Detection)

```typescript
const signals = await sandbox.signal.start();

signals.on('port', (event) => {
  if (event.type === 'open') {
    console.log(`Server started on port ${event.port}`);
    iframe.src = event.url;
  }
});

signals.on('error', (event) => {
  showNotification('error', event.message);
});
```

## Security Best Practices

### Token Expiration

Always set appropriate expiration times:

```typescript
// Short-lived for sensitive operations
const shortToken = await sandbox.sessionToken.create({
  expiresIn: 3600,  // 1 hour
});

// Longer for persistent workspaces
const longToken = await sandbox.sessionToken.create({
  expiresIn: 604800,  // 7 days
});
```

### Token Revocation

Revoke tokens when users log out or when access should be terminated:

```typescript
// On user logout
app.post('/api/logout', async (req, res) => {
  await sandbox.sessionToken.revoke(req.session.tokenId);
  res.json({ success: true });
});
```

### Namespace Isolation

Use namespaces to isolate sandboxes per user or team:

```typescript
// Each user gets their own isolated sandbox
const sandbox = await compute.sandbox.findOrCreate({
  name: 'workspace',
  namespace: `user-${userId}`,  // Isolated per user
});
```

## Complete Example: Web IDE

```typescript
// Server: Create sandbox and token for authenticated user
app.post('/api/workspace', async (req, res) => {
  const sandbox = await compute.sandbox.findOrCreate({
    name: 'ide',
    namespace: `user-${req.user.id}`,
  });

  const session = await sandbox.sessionToken.create({
    description: `IDE session for ${req.user.email}`,
    expiresIn: 86400,
  });

  res.json({
    sandboxUrl: sandbox.url,
    token: session.token,
  });
});

// Frontend: Connect and set up IDE
async function initIDE() {
  const { sandboxUrl, token } = await fetch('/api/workspace').then(r => r.json());
  
  const sandbox = await Sandbox.connect({ url: sandboxUrl, token });

  // Set up terminal
  const terminal = await sandbox.terminal.create({ pty: true });
  terminal.on('output', renderTerminal);

  // Set up file watcher for live reload
  const watcher = await sandbox.watcher.create('/project/src');
  watcher.on('change', reloadPreview);

  // Set up port detection for preview
  const signals = await sandbox.signal.start();
  signals.on('port', updatePreviewUrl);
}
```
