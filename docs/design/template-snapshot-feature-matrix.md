# Template & Snapshot Feature Matrix

## Background

ComputeSDK now has a unified `template` primitive that collapses the previous separate `template` and `snapshot` managers into one. `compute.template` is exposed on the compute singleton with `create`, `list`, and `delete` methods.

`template.create()` accepts a discriminated union:
- `{ dockerfile, baseImage, name }` — build from spec
- `{ from: sandboxId, name }` — capture from a running instance (what was "snapshot")

The old `compute.snapshot` API remains for backwards compatibility.

This document tracks the implementation status of each provider after the deep audit.

---

## Implementation Status (Post-Audit)

### Tier 1: Build-from-spec + Capture-from-sandbox

Both modes implemented and working.

| Provider | Build from spec | Capture from sandbox | Native API |
|---|---|---|---|
| **E2B** | `Template().fromDockerfile().build()` | `sandbox.createSnapshot()` | Template builder + snapshot |
| **Modal** | `images.fromRegistry().dockerfileCommands().build()` | `sandbox.snapshotFilesystem()` | Image service + filesystem snapshot |
| **Daytona** | `Image.base().dockerfileCommands()` + `snapshot.create()` | `snapshot.create({ workspaceId })` | Image class + snapshot service |
| **Docker** | `docker.buildImage()` from Dockerfile | `container.commit()` | dockerode build + commit |
| **Runloop** | `blueprints.create({ dockerfile })` | `devboxes.snapshotDisk()` | Blueprint + disk snapshot |
| **Blaxel** | `ImageInstance.fromRegistry().aptInstall().build()` | Not supported (throws) | ImageInstance builder API |
| **Lelantos** | E2B-compatible `Template.build()` | E2B-compatible `createSnapshot()` | E2B SDK (forked) |
| **Railway** | `Sandbox.template()` builder | `sandbox.checkpoint()` | Template builder + checkpoints |
| **Namespace** | ImageService `CreateBlueprint` + `Build` | `SuspendInstance` + persistent volume snapshot | ImageService (build) + StorageService (capture) |

### Tier 2: Capture-from-sandbox only

Can snapshot a running instance but cannot build from a Dockerfile spec.

| Provider | Capture mechanism | Notes |
|---|---|---|
| **CodeSandbox** | `sandbox.hibernate()` | Hibernate/resume is the snapshot mechanism |
| **CreateOS** | `sandbox.pause()` + `fork()` | Paused sandbox IS the template |
| **Cloudflare** | `sandbox.createBackup()` + `restoreBackup()` | Directory backup to R2 (direct mode only); no build-from-spec API |
| **Lightning** | `sandbox.createSnapshot()` | Full snapshot lifecycle |
| **Tensorlake** | `sandbox.checkpoint()` | Memory + filesystem checkpoint types |
| **Isorun** | `sandbox.snapshot()` | Full snapshot lifecycle |
| **Quilt** | `POST /api/containers/{id}/snapshot` | Operation-polling snapshot |
| **Vercel** | `sandbox.snapshot()` | Filesystem snapshot |
| **Upstash** | `box.snapshot()` | Snapshot + `Box.fromSnapshot()` restore |
| **Tenki** | `client.createSnapshotAndWait()` | Pause/resume/snapshot |
| **Freestyle** | `client.vms.snapshot()` | VM snapshot (used internally for provisioning) |
| **Agentuity** | `POST /sandbox/{id}/snapshot` | REST API snapshot |

### Tier 3: Build-from-spec only

Can build images/templates from a Dockerfile but cannot capture a running instance.

| Provider | Build mechanism | Notes |
|---|---|---|
| **HopX** | `Template.createTemplate()` + `Template.build()` | Full template builder |
| **Beam** | `Image.fromRegistry().build()` | Image build API |
| **Superserve** | `Template.create()` with build spec | Template with `from` + `steps` |
| **Leap0** | `TemplatesClient.create()` | Full template + snapshot clients |
| **Declaw** | CLI-based (SDK partial) | `sandbox.createSnapshot()` for capture |

### Tier 4: CLI-only or limited support

Platform supports templates/images but only via CLI, not programmatically exposed through ComputeSDK.

| Provider | Platform capability | ComputeSDK status | Notes |
|---|---|---|---|
| **Cloud Run** | Cloud Build, container templates | Pass-through `config.template` string | No template CRUD via API |
| **Northflank** | Build service from Dockerfile | Not implemented | Build via Northflank dashboard/CLI |
| **K8s** | Container images, volume snapshots | Not implemented | Images serve as templates |
| **Collimate** | Template ID required at create time | Pass-through string | No template CRUD |

### Not applicable

No snapshot or template concept exists on the platform.

| Provider | Reason |
|---|---|
| **AgentCore** | Ephemeral code interpreter sessions |
| **Archil** | Exec-only with disk mount, no snapshot |
| **Just-Bash** | Local bash execution, in-memory filesystem |
| **Secure-Exec** | Local V8 isolates, no image concept |

---

## Summary

**28 providers** now have template blocks implemented (up from 20 in the initial pass):

- 9 with both build-from-spec and capture-from-sandbox
- 12 with capture-from-sandbox only
- 5 with build-from-spec only
- 2 with CLI-only guidance (throws with instructions)

**6 providers** where template/snapshot does not apply or is not yet exposed.

## Next Steps

1. **Investigate Northflank, K8s** for programmatic image build APIs that could be wired up
2. **Benchmark**: Add a `template-benchmark.ts` to the benchmarks repo measuring build time, capture time, and spawn-from-template TTI
3. **Keep `compute.snapshot` and `compute.template` distinct**: `compute.snapshot` remains the capture-only primitive; `compute.template` adds build-from-spec on top of capture. Both stay first-class.
4. **Documentation**: Update README and ADD-PROVIDER.md with the unified template API guide

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
| **Cloudflare** | not-implemented | capture (implemented) | yes — `sandbox.createBackup()` / `restoreBackup()` (direct mode) | no | Directory backups to R2 via the Sandbox SDK. `template.create({ from })` implemented; no build-from-spec API. |
| **K8s** | not-implemented | not-implemented | no | partial — container images | K8s pods are ephemeral. Container images serve as templates but no image management. |
| **Railway** | not-implemented | not-implemented | no | partial — `Sandbox.template()` builder | README explicitly says templates not exposed. Builder exists in native SDK. |
| **Namespace** | not-implemented | working (build + capture) | yes — `SuspendInstance` + StorageService `ListPersistentVolumeSnapshots` / `DestroyPersistentVolumeSnapshot` | yes — ImageService gRPC API: `CreateBlueprint` (Dockerfile or APT-based), `Build`, `FetchBlueprint`, `ListBlueprints`, `RemoveBlueprint` | Build-from-spec via ImageService at `global.namespaceapis.com`; capture-from-sandbox via persistent volume snapshots (requires an attached PERSISTENT volume). |
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

AgentCore, Archil, Just-Bash, Secure-Exec

### Providers with partial/template-as-passthrough only (low priority)

Docker, Cloud Run, K8s, Railway, Northflank, Collimate, Blaxel

---

## Next Steps

1. **Unify the framework**: Collapse `ProviderSnapshotManager` into `ProviderTemplateManager` in `@computesdk/provider`. `template.create()` accepts a discriminated union (build-from-spec vs capture-from-sandbox).

2. **Expose `compute.template`**: Add `template` to the `compute` singleton in `packages/computesdk/src/compute.ts` (currently only `compute.sandbox` and `compute.snapshot` are exposed).

3. **Implement Tier 1 providers**: E2B, Modal, Daytona, Runloop as the reference implementations.

4. **Migrate Tier 2 providers**: Wire capture-from-sandbox into `template.create` for providers with working snapshots.

5. **Wire Tier 3 native-only providers**: Leap0, Declaw, HopX, Tenki, Freestyle, Agentuity.

6. **Deprecate `compute.snapshot`**: Once `compute.template.create({ from: sandboxId })` covers the snapshot use case, remove `compute.snapshot` from the singleton.
