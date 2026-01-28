---
"computesdk": major
---

Introducing ComputeSDK 2.0 with the Sandbox Gateway.

The Gateway allows you to use the same SDK with ANY provider—including your existing cloud infrastructure—by simply bringing your own keys. Change providers by updating environment variables, not code.

**Supported Providers (8):** E2B, Modal, Railway, Vercel, Daytona, Render, Blaxel, and Namespace.

**New Features:**

- **Namespaces**: Organize sandboxes by user, project, or entity. Combined with named sandboxes, enables idempotent creation via `compute.sandbox.findOrCreate()`.

- **Servers**: Supervised processes with full lifecycle management:
  - `install` command that runs before `start` (e.g., `npm install`)
  - Restart policies: `never`, `on-failure`, `always`
  - Health checks for readiness detection
  - Graceful shutdown with SIGTERM/SIGKILL handling

- **Overlays**: Instantly bootstrap sandboxes from template directories:
  - `smart` strategy uses symlinks for instant setup
  - Background copying for heavy directories
  - `waitForCompletion` option to block until ready

- **Client-Side Access**: Delegate sandbox access to browser clients securely:
  - Session tokens for scoped credentials
  - Magic links for one-click browser authentication

- **File Watchers**: Real-time filesystem change events via WebSocket

- **Signal Service**: Port detection and error events for dev server workflows

- **Environment Management**: First-class `.env` file operations
