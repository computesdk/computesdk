# Sandbox sizes

`sizeClass` requests an exact CPU/RAM tier on the selected provider. It is opt-in: omitting it (or passing `undefined`) preserves the provider's native defaults and options. It is not an alias for the provider-specific `size` option.

| `sizeClass` | vCPU | Memory (MiB) |
| ----------- | ---: | -----------: |
| `xs`        |    1 |         1024 |
| `sm`        |    1 |         2048 |
| `md`        |    2 |         4096 |
| `lg`        |    4 |         8192 |
| `xl`        |    8 |        16384 |
| `2xl`       |   16 |        32768 |

```typescript
import { namespace } from '@computesdk/namespace';

const provider = namespace({});
console.log(provider.sizes.list());
console.log(provider.sizes.resolve('md'));
const sandbox = await provider.instances.create({ sizeClass: 'md' });
console.log(sandbox.sizing);
await sandbox.destroy();
```

`provider.sizes.list(options?)` and `resolve(sizeClass, options?)` are synchronous, local discovery: they do not query availability, validate credentials, build images, or create resources. A supported resolution contains `requested`, `resolved`, `nativeOptions`, and `provenance: 'adapter-declared'`. The instance's immutable `sizing` contains the same request/resource metadata, without `nativeOptions`. These are adapter declarations, not measurements or account/region availability guarantees.

## Errors and conflicts

Creation rejects with `InstanceSizeError` (`code`, `fallback: false`, and, when available, `resolution`) instead of silently using another size:

| Code/status      | Meaning                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid`        | Invalid tier or create-option shape. Use a plain object with enumerable own string-key data properties, not accessors or inherited controls. |
| `conflict`       | Competing native resource selectors, or a resolver size differing from `options.sizeClass`.                                                  |
| `unsupported`    | The adapter explicitly rules out this shape or create path.                                                                                  |
| `unknown`        | No verified exact mapping for this adapter or context; not proof that the vendor cannot provide it.                                          |
| `unconfigured`   | Required local size configuration is missing.                                                                                                |
| `unavailable`    | This execution mode or base image cannot supply the requested shape.                                                                         |
| `requires-build` | The resolver reports a prerequisite build; discovery never performs it.                                                                      |

Do not combine `sizeClass` with defined `cpu`, `cpuLimit`, `cpus`, `vcpus`, `memory`, `memoryMiB`, `memMiB`, `memoryMb`, `resources`, `launch_parameters`, `deploymentPlan`, `size`, or `vmTier`. Adapters also reject their own competing selectors (such as Namespace's nested shape fields or E2B's `cpuCount`/`memoryMB`). Non-resource options such as `envs` and `timeout` remain usable, subject to provider restrictions below.

In multi-provider `compute` mode, `sizeClass` pins the normally selected provider and disables `fallbackOnError`, including for later authentication or capacity failures. It does not search the provider pool for a matching tier.

## Provider mappings

| Provider                                   | Standard mappings                  | How sizes are applied / restrictions                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Namespace](../providers/namespace.md)     | `sm`, `md`, `lg`, `xl`             | Linux amd64 `instanceOptions.shape.virtual_cpu` / `memory_megabytes`. Other OS/architecture contexts, `xs`, and `2xl` are `unknown`.                                                                                                                                                                  |
| [Archil](../providers/archil.md)           | `sm`, `md`, `lg`, `xl`             | New persistent VMs use `vcpus` / `memoryMiB`. Exec mode is `unavailable`; attaching or restoring with `snapshotId`, `sandboxId`, or `instanceId` is `unsupported`. `xs`/`2xl` are `unknown`.                                                                                                          |
| [Arker](../providers/arker.md)             | All six tiers on unpinned creates  | Per-fork `resources.vcpu` / `memory_mib`; picks the smallest fitting `ubuntu-coding` golden. A pinned known golden outside its bounds is `unsupported`; `snapshotId` is `unknown`. A custom pinned source remains subject to the vendor's bounds check at create time.                                |
| [Agent37](../providers/agent37.md)         | `md`, `lg`                         | Per-create CPU/RAM for `default`, `performance`, or `vm` types. Other standard tiers are `unsupported`; other types are `unknown`. Its native 4-vCPU/16- or 32-GiB shapes are not `xl`/`2xl`.                                                                                                         |
| [E2B](../providers/e2b.md)                 | `sm`, `md`, `lg`, `xl` by default  | Per-size team templates built by Provider Setup. `sizeTemplates` config can override tier names. Explicit `templateId`, `snapshotId`, or `sandboxId` is `unsupported` with `sizeClass`. Unmapped tiers are `unknown`; a mapped template missing on the team fails at create time with setup guidance. |
| [GCP Cloud Run](../providers/cloud-run.md) | `xs` through `xl`, when configured | One gateway per size, via `sizeGateways` or `CLOUD_RUN_SANDBOX_URL_XS`, `_SM`, `_MD`, `_LG`, `_XL`. No entry is `unconfigured`; create checks the gateway's advertised size and reports `unavailable` on mismatch. `2xl` is `unsupported`.                                                            |
| [Freestyle](../providers/freestyle.md)     | `lg`, `xl`                         | Grow-only resize from the default 4-vCPU/8192-MiB runtime snapshot. Smaller tiers are `unavailable`, `2xl` is `unknown`; explicit sandbox/snapshot/template selection is `unsupported`.                                                                                                               |
| [Superserve](../providers/superserve.md)   | `unknown`                          | CPU/RAM fixed by account templates; boot with `templateId`, not `sizeClass`.                                                                                                                                                                                                                          |
| [Novita](../providers/novita.md)           | `unknown`                          | CPU/RAM fixed at template build; boot with `templateId`, not `sizeClass`.                                                                                                                                                                                                                             |
| [Mosaic](../providers/mosaic.md)           | `unknown`                          | Smaller native shapes use `vcpu`/`memoryMb`; the 8-vCPU/16-GiB shape restores an account environment through `templateId`.                                                                                                                                                                            |
| Other adapters                             | `unknown`                          | No declared standard mapping. Use the native resource options documented for that provider; native sizing support alone does not imply `sizeClass` support.                                                                                                                                           |

Provider Setup builds the `csdk-node22-1cpu-2gb`, `csdk-node22-2cpu-4gb`, `csdk-node22-4cpu-8gb`, and `csdk-node22-8cpu-16gb` team templates for E2B and Novita. Superserve uses its built-in `superserve/node-22` for 2 vCPU/4 GiB and builds the other three names (plus a nonstandard 1-vCPU/256-MiB template). Mosaic setup builds only `csdk-node22-8cpu-16gb`. These account resources do not add a standard-size resolver to Superserve, Novita, or Mosaic.

See [Provider Setup](../../add-provider.md#provider-setup) for the idempotent setup workflow.
