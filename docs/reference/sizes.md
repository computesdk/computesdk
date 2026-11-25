# Sandbox sizes

`sizeClass` requests a standard CPU/RAM size on the selected provider. It is opt-in: omitting it (or passing `undefined`) preserves the provider's native defaults and options. It is not an alias for the provider-specific `size` option.

| `sizeClass` | vCPU | Memory (MiB) |
| --- | ---: | ---: |
| `xs` | 1 | 1024 |
| `sm` | 1 | 2048 |
| `md` | 2 | 4096 |
| `lg` | 4 | 8192 |
| `xl` | 8 | 16384 |
| `2xl` | 16 | 32768 |
| `3xl` | 32 | 65536 |

```typescript
import { namespace } from '@computesdk/namespace';

const provider = namespace({ token: process.env.NSC_TOKEN });
console.log(provider.sizes.list());
console.log(provider.sizes.resolve('md'));
const sandbox = await provider.instances.create({ sizeClass: 'md' });
console.log(sandbox.sizing);
await sandbox.destroy();
```

`provider.sizes.list(options?)` and `resolve(sizeClass, options?)` are synchronous, local discovery: they do not query availability, validate credentials, build images, or create resources. A supported resolution contains `requested`, `resolved`, `nativeOptions`, and `provenance: 'adapter-declared'`. `resolved` is the provider's listed shape for that size (`vcpus`, `memoryMiB`, optional `diskMiB`).

### Which shapes count as a size

vCPU picks the size; memory is a floor.

- **vCPU**: at least the size's vCPU and fewer than the next size up's (`3xl`, the top size, has no upper limit). A 4-vCPU shape is never `md`.
- **Memory**: at least 90% of the size's memory (`INSTANCE_SIZE_MEMORY_TOLERANCE` is 10%). More memory is fine and is recorded in `resolved`: a 1 vCPU / 2 GiB shape is a valid `xs`, and a 2 vCPU / 8 GiB shape is `md`.
- **Shortfall**: memory below the size but within the 10% tolerance needs `belowStandard` naming the provider limit (e.g. Tensorlake's 16000 MB cap for `xl`). The resolution and the instance's `sizing` then also carry `memoryShortfallMiB` (384 for Tensorlake `xl`). A shape further below, such as 32 vCPU / 48 GiB for `3xl`, is not that size.
- Each adapter maps a size to the smallest listed shape that qualifies. Adapters declaring a shape outside these rules are rejected as `invalid`.

To use a shape that is not a standard size, pin the provider and pass its native options. The instance's immutable `sizing` contains the same request/resource metadata, without `nativeOptions`. These are adapter declarations, not measurements or account/region availability guarantees.

## Errors and conflicts

Creation rejects with `InstanceSizeError` (`code`, `fallback: false`, and, when available, `resolution`) instead of silently using another size:

| Code/status | Meaning |
| --- | --- |
| `invalid` | Invalid tier or create-option shape. Use a plain object with enumerable own string-key data properties, not accessors or inherited controls. |
| `conflict` | Competing native resource selectors, or a resolver size differing from `options.sizeClass`. |
| `unsupported` | The adapter explicitly rules out this shape or create path. |
| `unknown` | No verified exact mapping for this adapter or context; not proof that the vendor cannot provide it. |
| `unconfigured` | Required local size configuration is missing. |
| `unavailable` | This execution mode or base image cannot supply the requested shape. |
| `requires-build` | The resolver reports a prerequisite build; discovery never performs it. |

Do not combine `sizeClass` with defined `cpu`, `cpuLimit`, `cpus`, `vcpus`, `memory`, `memoryMiB`, `memMiB`, `memoryMb`, `resources`, `launch_parameters`, `deploymentPlan`, `size`, or `vmTier`. Adapters also reject their own competing selectors (such as Namespace's nested shape fields or E2B's `cpuCount`/`memoryMB`). Non-resource options such as `envs` and `timeout` remain usable, subject to provider restrictions below.

In multi-provider `compute` mode, `sizeClass` pins the normally selected provider and disables `fallbackOnError`, including for later authentication or capacity failures. It does not search the provider pool for a matching tier.

## Provider mappings

| Provider | Standard mappings | How sizes are applied / restrictions |
| --- | --- | --- |
| [Namespace](../providers/namespace.md) | All seven tiers | Linux AMD64 `instanceOptions.shape.virtual_cpu` / `memory_megabytes`. Namespace provisions ephemeral disk by shape. `xs` boots the 1x2 minimum shape (1 vCPU / 2 GiB). Non-Linux container creates are `unsupported`. Linux ARM64 is `unknown` because the machine family is ambiguous. |
| [Archil](../providers/archil.md) | All seven tiers | New persistent VMs use exact `vcpus` / `memoryMiB` (Archil `vcpu_count` 1–32, `mem_size_mib` 256–65536). Exec mode is `unavailable`; attaching or restoring with `snapshotId`, `sandboxId`, or `instanceId` is `unsupported`. |
| [Arker](../providers/arker.md) | All six tiers on unpinned creates | Per-fork `resources.vcpu` / `memory_mib`; picks the smallest fitting `ubuntu-coding` golden. A pinned known golden outside its bounds is `unsupported`; `snapshotId` and `image` are `unknown`. A custom pinned source remains subject to the vendor's bounds check at create time. |
| [Agent37](../providers/agent37.md) | `md`, `lg` | Per-create CPU/RAM for `default`, `performance`, or `vm` types. Other standard tiers are `unsupported`; other types are `unknown`. Its native 4-vCPU/16- or 32-GiB shapes are not `xl`/`2xl`. |
| [E2B](../providers/e2b.md) | `sm`, `md`, `lg`, `xl` by default | Per-size team templates built by Provider Setup. `sizeTemplates` config can override tier names. Explicit `templateId`, `snapshotId`, or `sandboxId` is `unsupported` with `sizeClass`. Unmapped tiers are `unknown`; a mapped template missing on the team fails at create time with setup guidance. |
| [GCP Cloud Run](../providers/cloud-run.md) | `xs` through `xl`, when configured | One gateway per size, via `sizeGateways` or `CLOUD_RUN_SANDBOX_URL_XS`, `_SM`, `_MD`, `_LG`, `_XL`. No entry is `unconfigured`; create checks the gateway's advertised size and reports `unavailable` on mismatch. `2xl` and `3xl` are `unsupported`. |
| [Freestyle](../providers/freestyle.md) | `md`, `lg`, `xl`, `2xl`, `3xl` | `md` boots `freestyle/ubuntu-sm` (2/4 GiB/16 GB); `lg`+ grow the 4-vCPU/8192-MiB/32 GB runtime snapshot with `vm.resize` (`cpu`/`memory`), disk not resized. `2xl` and `3xl` need Pro. `xs`/`sm` are `unsupported` (grow-only, no smaller Ubuntu snapshot); explicit sandbox/snapshot/template selection is `unsupported`. |
| [GravixLayer](../providers/gravixlayer.md) | All six tiers | Per-size `base-*` platform templates. `sizeTemplates` config can override tier names. Explicit `templateId`, `image`, `snapshotId`, or `sandboxId` is `unsupported` with `sizeClass`. A mapped template missing on the project fails at create time with remediation guidance. |
| [Superserve](../providers/superserve.md) | `xs` through `2xl` | Per-size templates: `md` is built-in `superserve/base` (2 vCPU / 4 GiB / 8 GiB disk), the others `csdk-node22-<vcpus>cpu-<GiB>gb` team templates built by Provider Setup; `sizeTemplates` overrides names. `3xl` is `unsupported` (max 16 vCPU / 64 GiB on Pro). `templateId`, `snapshotId`, `sandboxId`, `fromTemplate` or `fromSnapshot` with `sizeClass` is `unsupported`; native `vcpu`/`vcpuCount`/`memoryMib`/`memoryMaxMib`/`diskMib` is a `conflict`. A missing team template fails at create with setup guidance. |
| [Novita](../providers/novita.md) | `xs`, `sm`, `md`, `lg` | Per-size account templates (`csdk-node22-1cpu-1gb`, `-1cpu-2gb`, `-2cpu-4gb`, `-4cpu-8gb`) built by Provider Setup; `sizeTemplates` config overrides names for those tiers only. Fixed 20 GB disk reported as `resolved.diskMiB: 20480`. `xl`/`2xl`/`3xl` are `unsupported` (8 vCPU / 8 GiB cap). `templateId`/`snapshotId`/`sandboxId` with `sizeClass` is `unsupported`; native `cpuCount`/`memoryMB`/`build` is `conflict`. A mapped template missing on the account fails at create time with setup guidance. |
| [Mosaic](../providers/mosaic.md) | `xs` 1/1 GiB (env `csdk-node22-1cpu-1gb`), `sm` 1/2, `md` 2/4, `lg` 4/8, `xl` 8/16, `2xl` 16/32; `3xl` unsupported | Native `vcpu`/`memory_mb`; `xl`/`2xl` boot template `base` (only `base` serves 8/16 vCPU); `xs` boots an environment built at 1/1024 (`sizeTemplates` override); refused with `snapshotId`/`image`/environment `templateId` (fixed captured shape), with a non-`base` stock template for `xl`/`2xl`, or any `templateId` for `xs` |
| [Beam](../providers/beam.md) | xs–3xl exact (`cpu` cores, `memory` MiB) | Arbitrary CPU/RAM on the default Performance tier (beam-js 0.1–64 cores); native `cpu`/`memory` conflict; snapshot restore/attach unsupported; Shared tier (`cpuTier: 'shared'`) refuses 2xl/3xl; GPU/pool unknown; no disk |
| [Blaxel](../providers/blaxel.md) | `xs`, `sm`, `md`, `lg` | `memory` (MB) at 2048/2048/4096/8192; Blaxel sets CPU from memory, at memory / 2048 cores per the API reference, so `xs` takes 2048 MB (1 core) rather than 1024 MB (0.5 core). `xl`, `2xl`, `3xl` are `unknown`: the docs disagree on CPU at 16 GB (8 vs 6 cores). With native `memory` → `conflict`; with `snapshotId` or `sandboxId` → `unsupported`. `templateId`/`image` still work. |
| [Buddy](../providers/buddy.md) | `xs`, `sm`, `md`, `lg`, `xl` | `resources` preset `1x2` (xs and sm)/`2x4`/`4x8`/`8x16` (N vCPU × 2N GB, 1x2–12x24), also on `snapshotId`/`templateId` restores; disk fixed at 50 GB (`resolved.diskMiB` 51200). `2xl`, `3xl` are `unsupported`. |
| [Cloudflare](../providers/cloudflare.md) | xs 1/1024, sm 1/2048, md 2/4096, lg 4/8192 (exact); xl/2xl/3xl unsupported | Custom instance type `vcpu`/`memoryMib`/`diskMb` (durable_object policy); disk 8192/8192/12288/20000 MB; max 4 vCPU / 12 GiB / 20 GB per instance; refused with `sandboxId` or native size fields |
| [CodeSandbox](../providers/codesandbox.md) | xs and sm Pico 1/2, md Nano 2/4, lg Micro 4/8, xl Small 8/16, 2xl Medium 16/32, 3xl Large 32/64 | native `vmTier`. 2xl and 3xl boot per-size templates `csdk@csdk-node22-16cpu-32gb` and `csdk@csdk-node22-32cpu-64gb` (built with `csb build --vm-tier`, override with `sizeTemplates`) and cannot be combined with `templateId` or `snapshotId`. `sizeClass` cannot be combined with a native `vmTier`. |
| [CreateOS](../providers/createos-sandbox.md) | xs `s-1vcpu-1gb`, sm `s-1vcpu-2gb`, md `s-2vcpu-4gb`, lg `s-4vcpu-8gb`, xl `s-8vcpu-16gb`; 2xl/3xl unsupported | Named `shape` + `disk_mib` (platform disk 10/20/40/60 GiB for sm–xl (xl capped at the 60 GiB plan maximum), 10 GiB default on xs); conflicts with `shape`/`cpus`/`memoryMb`; `snapshotId` (fork keeps source shape) unsupported |
| [Daytona](../providers/daytona.md) | xs, sm, md, lg (exact profiles; disk 10/20/40 GiB for sm/md/lg) | `resources: { cpu, memory, disk }` on an image create (default `node:22`, `sizeImage` override); xl+ unsupported (4 vCPU / 8 GiB sandbox cap); refuses templateId/snapshotId/snapshot and native cpu/memory/resources/disk/gpu |
| [givemeanode](../providers/givemeanode.md) | `xs`, `sm`, `lg`, `xl`, `2xl` | Native `size` types: xs and sm→`sandbox-sm` (1/2 GiB), lg→`sandbox-md` (4/8 GiB), xl→`sandbox-lg` (8/32 GiB), 2xl→`sandbox-xl` (16/64 GiB). Container images are baked at the class size. `md`, `3xl` are `unsupported`; `snapshotId` / `env-` `templateId` forks are `unsupported`. `ramGib`/`ram_gib` conflict. |
| [Isorun](../providers/isorun.md) | `xs`, `md`, `lg`, `xl` | Fixed `vcpus`/`memMiB` pairings 1/1, 2/4, 4/8, 8/16 GiB; `md`–`xl` also send `diskMiB` 16384/32768/65536, and an explicit `diskMiB` takes precedence. `sm`, `2xl`, `3xl` are `unsupported`. `snapshotId` with `sizeClass` is `unsupported`. Native `vcpus`/`memMiB` with `sizeClass` is a `conflict`. |
| [Leap0](../providers/leap0.md) | `xs`, `sm`, `md`, `lg` | Native `vcpu` / `memory` (MiB); fixed 10 GiB disk reported as `resolved.diskMiB`. `xl`, `2xl`, `3xl` are `unsupported` (8 vCPU / 8192 MiB limit); `snapshotId` with `sizeClass` is `unsupported`; native `vcpu`/`memory` with `sizeClass` is a `conflict`. |
| [Lightning](../providers/lightning.md) | xs→cpu-1, md→cpu-2 (2/8 GiB), lg→cpu-4 (4/16 GiB), xl→cpu-8 (8/32 GiB), 2xl→cpu-16 (16/64 GiB); sm, 3xl unsupported | Named `instanceType`; tier default disk (10/40/60/80 GiB) reported in resolved.diskMiB, `storageGb` overrides it; sizeClass + native `instanceType` → conflict |
| [MIOSA](../providers/miosa.md) | xs and sm→`xs` (1/2 GiB/10 GiB disk), md→`small` (2/4/10), lg→`medium` (4/8/20), xl→`large` (8/16/40), 2xl→`xl` (16/32/80); 3xl unsupported | Named `size` contract (fixed disk in `resolved.diskMiB`); conflicts with `size`/`cpu_count`/`memory_mb`/disk fields; refused with `snapshotId`; non-xs sizes go via the account API |
| [Modal](../providers/modal.md) | All seven tiers | `cpu`/`cpuLimit` in physical cores (1 core = 2 vCPUs, so vCPU/2) and `memoryMiB`/`memoryLimitMiB`, request = limit so the Sandbox cannot burst past the size; fixed 512 GiB sandbox disk reported as `resolved.diskMiB`. Applies to default image, `templateId` and `snapshotId` creates. `memoryLimitMiB` with `sizeClass` is a `conflict`; a VM sidecar memory reserve is `unsupported`. |
| [Orble](../providers/orble.md) | xs and sm→`micro` (1/2 GiB), md→`s` (2/4), lg→`m` (4/8), xl→`l` (8/16) | Native `size`; 64 GiB disk at every size, reported in `resolved.diskMiB`. `2xl` and `3xl` are `unsupported`. Native `size` with `sizeClass` is a `conflict`. A box started from a snapshot (`snapshotId` or `templateId`) is at least the snapshot's size; a smaller `sizeClass` fails at create. |
| [Promigence](../providers/promigence.md) | md→`small` (2/4 GiB), lg→`medium` (4/16 GiB), xl→`large` (8/32 GiB); xs, sm, 2xl, 3xl unknown | `tier` only on image builds; md without image uses the small base; lg/xl without image are requires-build; snapshots unsupported; `tier` + sizeClass is a conflict |
| [Railway](../providers/railway.md) | `xs`, `sm`, `md`, `lg`, `xl` | Exact per-create `resources` (`cpu` vCPUs, `memoryGB` decimal GB) on fresh and checkpoint (`snapshotId`) creates, sent through the `sandboxCreate` GraphQL mutation. `2xl`/`3xl` are `unsupported` (listed maximum 24 vCPU / 24 GB, Pro). Plan caps apply at create time (Hobby 8 vCPU / 8 GB, Trial/Free 2 vCPU / 2 GB) and refuse rather than shrink. |
| [Runloop](../providers/runloop.md) | `xs`, `sm`, `md`, `lg`, `xl`, `2xl` | `CUSTOM_SIZE` via `launch_parameters.custom_cpu_cores`, `custom_gb_memory`, and `custom_disk_size`, including blueprint and disk snapshot creates. Custom sizes need 2 GiB per vCPU, so `xs` is 1 vCPU / 2 GiB. `3xl` is unsupported (16 vCPU / 64 GiB cap). |
| [Sail](../providers/sail.md) | All seven tiers | Per-create `vcpuCount` plus memory limit (`memoryGib` → `memoryLimitGib`). Sail's memory floor is 16 GiB, so `xs`–`xl` resolve to 16384 MiB, `2xl` to 16/32768 and `3xl` to 32/65536. `snapshotId` is `unsupported`. Conflicts: `vcpuCount`, `memoryGib`, `memoryLimitGib`, `size`. Disk keeps the image limit. |
| [Sandbox0](../providers/sandbox0.md) | `xs`, `sm`, `md`, `lg`, `xl` | Claim-time `memory`; Sandbox0 Cloud derives CPU at 2 GiB per vCPU, so `xs` claims 2048 MiB. Works with template and snapshot claims. `2xl` and `3xl` are `unsupported`. |
| [Sprites](../providers/sprites.md) | `unsupported` (all) | Fixed shape: 8 vCPUs, platform-managed autoscaling memory, 100 GB storage. `POST /v1/sprites` takes only `name`/`url_settings`; `create({ sizeClass })` rejects before calling the API. |
| [Styne](../providers/styne.md) | md→`small` (2/4 GiB), lg→`default` (4/8), xl→`large` (8/16), 2xl→`xlarge` (16/32) | Native `size`; platform disk 51/51/111/251 GiB reported in `resolved.diskMiB`. `xs`, `sm` (no 1-vCPU size) and `3xl` are `unsupported`; `snapshotId`, `image` or `templateId` with `sizeClass` is `unsupported` (a sandbox keeps the size of what it starts from); native `size` or `vcpus`/`cpus`/`memoryMiB`/`memMiB`/`memoryMb`/`diskMiB`/`diskMb` with `sizeClass` is a `conflict`. Those fields without `sizeClass` send the Styne size with exactly those vCPUs and at least that memory and disk, or reject with `InstanceSizeError`. Sizes above the plan fail at create with `402 plan_required`. |
| [Luxor (Tenki)](../providers/tenki.md) | `xs`–`3xl` exact; `sm`/`md`/`lg`/`xl` set 5/10/20/40 GiB disk | Per-create `cpuCores` (1-128) / `memoryMb` (128-524288, even) / `diskSizeGb`; Starter caps at 4c/8GB, Team 16c/64GB, Enterprise larger; `cpuCores`/`memoryMb` with `sizeClass` is a conflict; `snapshotId` restores are `unknown` |
| [Tensorlake](../providers/tensorlake.md) | xs 1/1024, sm 1/2048, md 2/4096, lg 4/8192, xl 8/16000 (below standard) | Native `cpus` / `memoryMb` plus `diskMb: 10240`; RAM capped at 16000 MB so xl is 384 MiB short (`memoryShortfallMiB`, within the 10% tolerance) and 2xl/3xl are unsupported; `sizeClass` with `snapshotId` is unsupported; `cpus`/`memoryMb`/`diskMb`/`ephemeralDiskMb` conflict |
| [Uno](../providers/uno.md) | xs–3xl exact (sm–xl disk 10/20/40/80 GiB) | exact `vcpu`/`ram_mb` on POST /api/v1/boxes; plan `max_box` caps one machine (Small 1/1 GiB … Max 32/48 GiB, 3xl needs Enterprise); refused with `snapshotId` and native CPU/RAM/disk fields |
| [Upstash](../providers/upstash.md) | `md`, `lg`, `xl` | Box `size` `small` / `medium` / `large` on every create path (new, snapshot restore, ephemeral, ephemeral restore). Tier fixes disk (10/30/30 GB, reported in `resolved.diskMiB`). `xs`, `sm`, `2xl`, `3xl` are `unsupported`; native `size` with `sizeClass` is a `conflict`. |
| [Vercel](../providers/vercel.md) | All seven tiers | `resources.vcpus` 1/1/2/4/8/16/32 (2048 MiB RAM per vCPU, so `xs` is 1/2048; fixed 64 GiB disk, 32 GiB on deprecated `runtime`). Also applies with `snapshotId`/`templateId`/`source`. `3xl` (32 vCPU) needs Enterprise. Native `resources` with `sizeClass` is a `conflict`. Hobby (4 vCPU) and Pro (8 vCPU) caps fail at create time. |
| [Boat](../providers/boat.md) | md→`small` (2/4 GB), lg→`default` (4/8), xl→`large` (8/16), 2xl→`xlarge` (16/32) | Native `type`. `xlarge` needs Boat's $100/month plan. xs, sm and 3xl are `unsupported`; a fork or template (`snapshotId`/`templateId`) is `unsupported`. |
| [HopX](../providers/hopx.md) | Per-size templates when configured | The template fixes CPU and memory. Set `sizeTemplates` to a template per size; unset sizes are `unconfigured`. Explicit `templateId`/`snapshotId` is `unsupported` with `sizeClass`. |
| [kosa8](../providers/kosa8.md) | Per-size templates when configured | Same as HopX: `sizeTemplates` per size, otherwise `unconfigured`. |
| [Lelantos](../providers/lelantos.md) | Per-size templates when configured | Same as HopX: `sizeTemplates` per size, otherwise `unconfigured`. |
| [microsandbox](../providers/microsandbox.md) | All seven tiers | Exact `cpus` / `memoryMiB`. `snapshotId` is `unsupported`. |
| [NeevCloud](../providers/neevcloud.md) | All seven tiers | Exact `cpu` / `memory` (sent as `resources.cpu` / `memory_gb`). `snapshotId`/`templateId` is `unsupported`. |
| [Northflank](../providers/northflank.md) | xs–2xl | `deploymentPlan` nf-compute-100-1, -100-2, -200-4, -400, -800-16, -1600-32. 3xl is `unsupported`; `snapshotId`/`templateId` is `unsupported`. |
| Other adapters | `unknown` | No declared standard mapping. Use the native resource options documented for that provider; native sizing support alone does not imply `sizeClass` support. |

Provider Setup builds the `csdk-node22-1cpu-2gb`, `csdk-node22-2cpu-4gb`, `csdk-node22-4cpu-8gb`, and `csdk-node22-8cpu-16gb` team templates for E2B and Novita. GravixLayer setup builds `base-xsmall`, `base-small`, `base-medium`, `base-large`, `base-xlarge`, and `base-2xlarge` where the platform templates are absent. Superserve uses its built-in `superserve/node-22` for 2 vCPU/4 GiB and builds the other three names (plus a nonstandard 1-vCPU/256-MiB template). Mosaic setup builds only `csdk-node22-8cpu-16gb`. These account resources do not add a standard-size resolver to Superserve, Novita, or Mosaic.

See [Provider Setup](../../ADD-PROVIDER.md#provider-setup) for the idempotent setup workflow.
