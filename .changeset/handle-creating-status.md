---
"computesdk": patch
---

## Handle `status: "creating"` in `find()` and `findOrCreate()`

Added polling support for the gateway's new sandbox lifecycle status tracking. When a sandbox is being created by a concurrent request, the gateway now returns `status: "creating"` instead of creating a duplicate sandbox.

The SDK now polls with exponential backoff (500ms → 2s, 1.5x factor) until the sandbox becomes ready or times out after 60 seconds.

This is the client-side companion to computesdk/edge#97.
