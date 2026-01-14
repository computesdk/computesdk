---
"@anthropic-ai/sdk": minor
---

Breaking: Update SDK types to match server-core PR #95 API changes

**Server API Changes:**
- Rename `command` field to `start` in `ServerStartOptions` and `ServerInfo`
- Add `install` optional field for install commands that run before start (e.g., "npm install")
- Add `installing` status to `ServerStatus` type

**Overlay API Changes:**
- Rename `symlinkedFiles`/`symlinkedDirs` to `copiedFiles`/`copiedDirs` in `OverlayStats`
- Add `ignore` option to `CreateOverlayOptions` for glob patterns to exclude (e.g., `["node_modules", "*.log"]`)
- Update documentation to reflect direct file copying instead of symlinking

Migration:
```typescript
// Before
await sandbox.server.start({ slug: 'api', command: 'npm run dev' });
console.log(server.command);

// After
await sandbox.server.start({ slug: 'api', start: 'npm run dev' });
// Or with install:
await sandbox.server.start({ slug: 'api', install: 'npm install', start: 'npm run dev' });
console.log(server.start);

// Overlay stats
console.log(overlay.stats.copiedFiles);  // was: symlinkedFiles
console.log(overlay.stats.copiedDirs);   // was: symlinkedDirs
```
