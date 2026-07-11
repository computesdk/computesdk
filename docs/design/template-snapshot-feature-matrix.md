# Template & Snapshot Feature Matrix

## Background

ComputeSDK currently has two separate optional resource managers on the `Provider` interface:

- `ProviderTemplateManager` — `create`, `list`, `delete` for templates
- `ProviderSnapshotManager` — `create`, `list`, `delete` for snapshots

Across the three primary providers (E2B, Modal, Daytona), templates and snapshots are the **same concept**: a built, reusable artifact that you spawn compute instances from. E2B calls them "templates," Modal calls them "images," Daytona calls them "snapshots." The current codebase demonstrates this duplication — E2B and Daytona's `template.list`/`delete` and `snapshot.list`/`delete` call the exact same native APIs.

**Proposal:** Unify `template` and `snapshot` into a single `template` primitive. `template.create()` accepts a discriminated union:

- `{ dockerfile, baseImage, name }` — build from spec
- `{ from: sandboxId, name }` — capture from a running instance (what was "snapshot")

This document tracks the current state of each provider and what work is needed.

---

## Legend

- **Snapshot (current):** Whether the provider has a `snapshot:` block in `defineProvider` and its status
- **Template (current):** Whether the provider has a `template:` block in `defineProvider` and its status
- **Native snapshot:** Whether the provider's native SDK/API supports snapshotting a running instance
- **Native template/image build:** Whether the provider's native SDK/API supports building images/templates from a Dockerfile or base image
- **Unified template work:** What needs to be done to wire this provider into the unified template primitive

### Status values

- `working` — fully implemented and functional
- `partial` — some methods work, others throw/stub
- `stub` — methods exist but don't do real work
- `throws` — methods exist but throw errors
- `not-implemented` — no method block at all
- `native-only` — native SDK supports it but ComputeSDK doesn't expose it

---

## Feature Matrix

### Tier 1: Full unified template support (build from spec + capture from running)

| Provider | Snapshot (current) | Template (current) | Native snapshot | Native template build | Unified template work |
|---|---|---|---|---|---|
| **E2B** | working | partial (create throws) | yes — `sandbox.createSnapshot()` | yes — `Template().fromDockerfile().setEnvs().setStartCmd()`, `Template.build()` | Implement `template.create` with both build-from-spec and capture-from-sandbox. Remove redundant `snapshot` block. |
| **Modal** | partial (list/delete stub) | not-implemented | yes — `sandbox.snapshotFilesystem()` returns Image | yes — `client.images.fromRegistry()`, `image.dockerfileCommands()`, `image.build(app)` | Add `template` block. Implement `create` with both modes. Remove `snapshot` block. |
| **Daytona** | working | partial (create throws) | yes — `daytona.snapshot.create({ name, image })` | yes — `Image.base()/.debianSlim()/.fromDockerfile()`, `snapshot.create({ image: Image })` | Implement `template.create` with both modes. Remove `as any` casts. Remove `snapshot` block. |
| **Runloop** | working | working | yes — `devboxes.snapshotDisk()` | yes — `blueprints.create()` with Dockerfile, setup commands, resource sizes | Already the most complete. Merge snapshot into template. Both modes already work. |
| **Lelantos** | working | partial (create throws) | yes — E2B-compatible `sandbox.createSnapshot()` | yes — E2B-compatible `Template.build()` | Same as E2B. Forked from `@computesdk/e2b`. |
| **Leap0** | not-implemented | not-implemented | yes — `SnapshotsClient`, `CreateSnapshotParams` | yes — `TemplatesClient`, `CreateTemplateParams` | Wire both snapshot and template native APIs into unified template block. |
| **Declaw** | not-implemented | not-implemented | yes — `sandbox.createSnapshot()`, `listSnapshots()`, `deleteSnapshot()` | yes — `Sandbox.create({ template })`, CLI supports custom template builds | Wire both into unified template block. |
| **HopX** | not-implemented | not-implemented | no | yes — `Template.createTemplate()`, `getTemplate()`, `deleteTemplate()`, `Template.build()` | Wire template build API. No snapshot/capture support — only build-from-spec mode. |

### Tier 2: Snapshot works, template build needs implementation

| Provider | Snapshot (current) | Template (current) | Native snapshot | Native template build | Unified template work |
|---|---|---|---|---|---|
| **CodeSandbox** | working (hibernate/resume) | throws | yes — `sandbox.hibernate()`, `sdk.sandboxes.resume()` | partial — template ID accepted at create time, no build CRUD | Implement `template.create` with capture-from-sandbox (hibernate). Build-from-spec may not be supported natively. |
| **CreateOS** | working (pause/fork) | not-implemented | yes — `sandbox.pause()`, `sandbox.fork()` | partial — rootfs/image at create time | Implement `template.create` with capture-from-sandbox (pause). Build-from-spec via rootfs image only. |
| **Lightning** | working | not-implemented | yes — `sandbox.createSnapshot()`, `listSnapshots()`, `deleteSnapshot()` | partial — runtime images (node24, python313), snapshotId at create | Implement `template.create` with capture-from-sandbox. Build-from-spec via runtime image selection. |
| **Tensorlake** | working | not-implemented | yes — `sandbox.checkpoint()`, `listSnapshots()`, `deleteSnapshot()` | partial — image at create time, snapshotId at create | Implement `template.create` with capture-from-sandbox. Build-from-spec via base image. |
| **Isorun** | working | not-implemented | yes — `sandbox.snapshot()`, `listSnapshots()`, `deleteSnapshot()` | no | Implement `template.create` with capture-from-sandbox only. No build-from-spec. |
| **Quilt** | working | not-implemented | yes — `POST /api/containers/{id}/snapshot`, list, delete, clone | partial — image at create time, snapshot clone | Implement `template.create` with capture-from-sandbox. Build-from-spec via image string. |
| **Vercel** | working (list throws) | partial (create throws, delete delegates) | yes — `sandbox.snapshot()`, `Snapshot.delete()` | no | Implement `template.create` with capture-from-sandbox only. Remove redundant template block. |
| **Upstash** | working (list/delete stub) | stub (create throws) | yes — `box.snapshot()`, `Box.fromSnapshot()` | no | Implement `template.create` with capture-from-sandbox. Remove redundant template block. |
| **Tenki** | not-implemented | not-implemented | yes — pause/resume/snapshot in native SDK | partial — templateId maps to image ref | Wire native snapshot API into unified template. Build-from-spec via image ref. |
| **Freestyle** | not-implemented | not-implemented | yes — `client.vms.snapshots.ensure()` (used internally) | unknown — VmSpec with runtime modules | Expose internal snapshot mechanism. Investigate build-from-spec. |

### Tier 3: No snapshot or template support (not applicable or no native API)

| Provider | Snapshot (current) | Template (current) | Native snapshot | Native template build | Notes |
|---|---|---|---|---|---|
| **Beam** | not-implemented | not-implemented | no | yes — `Image.fromRegistry()`, `Image.build()` | Native SDK has image build but no snapshot. Wire template build-from-spec only. |
| **Superserve** | throws | partial (list/delete work) | no | yes — `Template.create()` with build spec, `Template.list()`, `deleteById()` | Template list/delete already work. Need to implement `template.create` with build-from-spec. No snapshot. |
| **Blaxel** | stub | throws | no | no | No native snapshot or template API. Sandboxes configured via image string at create time. |
| **Docker** | not-implemented | not-implemented | no (conceptually `docker commit`) | yes — Docker images | Could support `docker commit` as capture-from-sandbox and `docker build` as build-from-spec. |
| **Cloud Run** | not-implemented | not-implemented | no | partial — `config.template` maps to multi-container template name | No snapshot. Template is a pass-through string, no CRUD. |
| **Cloudflare** | not-implemented | not-implemented | no | no | Durable Object sandboxes, no snapshot or template concept. |
| **K8s** | not-implemented | not-implemented | no | partial — container images | K8s pods are ephemeral. Container images serve as templates but no image management. |
| **Railway** | not-implemented | not-implemented | no | partial — `Sandbox.template()` builder | README explicitly says templates not exposed. Builder exists in native SDK. |
| **Namespace** | not-implemented | not-implemented | no | partial — `image_ref` at create time | No snapshot. Image is a pass-through string. |
| **Northflank** | not-implemented | not-implemented | no | partial — image path or internal deployment | No snapshot. Build service exists but no template CRUD. |
| **Collimate** | not-implemented | not-implemented | no | partial — templateId required at create time | No snapshot. Template is a pass-through string, no CRUD. |
| **AgentCore** | not-implemented | not-implemented | no | no | Ephemeral code interpreter sessions. No snapshot or template concept. |
| **Agentuity** | not-implemented | not-implemented | yes — REST API `POST /sandbox/{id}/snapshot` | no | Snapshot endpoint exists but not wired. No template build. |
| **Archil** | not-implemented | not-implemented | no | no | Exec-only with disk mount. No snapshot or template. |
| **Just-Bash** | not-implemented | not-implemented | no | no | Local bash execution. Not applicable. |
| **Secure-Exec** | not-implemented | not-implemented | no | no | Local V8 isolates. Not applicable. |

---

## Summary

### Providers that need unified template implementation (build-from-spec + capture-from-sandbox)

| Provider | Build from spec | Capture from sandbox | Priority |
|---|---|---|---|
| E2B | `Template().fromDockerfile().build()` | `sandbox.createSnapshot()` | High |
| Modal | `image.dockerfileCommands().build()` | `sandbox.snapshotFilesystem()` | High |
| Daytona | `Image.fromDockerfile()` + `snapshot.create()` | `snapshot.create({ from: sandboxId })` | High |
| Runloop | `blueprints.create({ dockerfile })` | `devboxes.snapshotDisk()` | High (already working) |
| Lelantos | E2B-compatible | E2B-compatible | Medium |
| Leap0 | `TemplatesClient.create()` | `SnapshotsClient.create()` | Medium |
| Declaw | CLI-based, SDK partial | `sandbox.createSnapshot()` | Medium |
| HopX | `Template.createTemplate()` | N/A | Medium |

### Providers that need capture-from-sandbox only (no native build-from-spec)

| Provider | Capture mechanism | Priority |
|---|---|---|
| CodeSandbox | `sandbox.hibernate()` | Medium |
| CreateOS | `sandbox.pause()` + `fork()` | Medium |
| Lightning | `sandbox.createSnapshot()` | Medium |
| Tensorlake | `sandbox.checkpoint()` | Medium |
| Isorun | `sandbox.snapshot()` | Low |
| Quilt | `POST /api/containers/{id}/snapshot` | Low |
| Vercel | `sandbox.snapshot()` | Low |
| Upstash | `box.snapshot()` | Low |
| Tenki | native pause/snapshot API | Low |
| Freestyle | `client.vms.snapshots.ensure()` | Low |
| Agentuity | `POST /sandbox/{id}/snapshot` | Low |

### Providers with template list/delete only (need create implementation)

| Provider | List/delete source | Create needs | Priority |
|---|---|---|---|
| Superserve | `Template.list()`, `deleteById()` | Build spec (`from` + `steps`) | Medium |
| Beam | N/A | `Image.build()` | Low |

### Providers where snapshot/template does not apply

AgentCore, Archil, Just-Bash, Secure-Exec, Cloudflare

### Providers with partial/template-as-passthrough only (low priority)

Docker, Cloud Run, K8s, Railway, Namespace, Northflank, Collimate, Blaxel

---

## Next Steps

1. **Unify the framework**: Collapse `ProviderSnapshotManager` into `ProviderTemplateManager` in `@computesdk/provider`. `template.create()` accepts a discriminated union (build-from-spec vs capture-from-sandbox).

2. **Expose `compute.template`**: Add `template` to the `compute` singleton in `packages/computesdk/src/compute.ts` (currently only `compute.sandbox` and `compute.snapshot` are exposed).

3. **Implement Tier 1 providers**: E2B, Modal, Daytona, Runloop as the reference implementations.

4. **Migrate Tier 2 providers**: Wire capture-from-sandbox into `template.create` for providers with working snapshots.

5. **Wire Tier 3 native-only providers**: Leap0, Declaw, HopX, Tenki, Freestyle, Agentuity.

6. **Deprecate `compute.snapshot`**: Once `compute.template.create({ from: sandboxId })` covers the snapshot use case, remove `compute.snapshot` from the singleton.
