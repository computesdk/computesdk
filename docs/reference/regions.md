# Sandbox regions

`regionClass` requests a standard US area on the selected provider. It is opt-in: omitting it keeps the provider's native default and options. It is not an alias for a provider's own `region` option.

| `regionClass` | Covers |
| --- | --- |
| `us-east` | Virginia, Ohio, the Carolinas |
| `us-central` | Iowa and the middle of the country |
| `us-south` | Texas |
| `us-west` | California, Oregon, Arizona |
| `us` | Anywhere in the US |

A `us` request matches any declared US region. An area request never matches a provider that only promises "somewhere in the US".

```typescript
import { vercel } from '@computesdk/vercel';

const provider = vercel({ token: process.env.VERCEL_TOKEN });
console.log(provider.regions.support());
console.log(provider.regions.resolve('us-west'));
const sandbox = await provider.instances.create({ regionClass: 'us-west' });
console.log(sandbox.regionPlacement); // { requested: 'us-west', placement: 'selectable', region: 'sfo1', ... }
```

`provider.regions.support()` and `resolve(regionClass)` are synchronous, local declarations: they do not check credentials, capacity or account enablement.

## Placement kinds

| Kind | Meaning | Request behavior |
| --- | --- | --- |
| `selectable` | Create picks a region per instance | The adapter sends its own id for the area (first listed wins) |
| `per-account` | The key, endpoint or config fixes the region | Allowed only when the configured region is in the area; nothing is sent |
| `fixed` | The provider runs in one known place | Allowed only when that place is in the area; nothing is sent |
| `provider-placed` | The provider picks and promises nothing | Fails with `unknown` |
| `unknown` | Not declared | Fails with `unknown` |

## Declared adapters

| Adapter | Kind | Areas |
| --- | --- | --- |
| Vercel | selectable (`region`) | `us-east` (`iad1`, `cle1`), `us-west` (`sfo1`, `pdx1`) |
| Blaxel | selectable (`region`) | `us-east` (`us-was-1`), `us-west` (`us-pdx-1`) |
| Modal | selectable (`regions`) | `us-east`, `us-central`, `us-south`, `us-west`, `us` |
| Daytona | selectable (`target`) | `us` |
| Agent37 | selectable (`region`) | `us` |
| Archil | per-account (`region` / `ARCHIL_REGION`) | `aws-us-east-1` → `us-east`, `aws-us-west-2` → `us-west`, `gcp-us-central1` → `us-central` |
| E2B | per-account (`E2B_DOMAIN`) | default domain → `us-west` (`us-west-1`) |
| Styne | fixed | `us-east` (`ash`) |

Every other adapter is `unknown` until it declares a placement.

## Errors

A failed request throws `RegionError` (`fallback: false`) before create:

- `invalid`: not a standard region.
- `unsupported`: the provider can't place in that area (e.g. Vercel `us-central`, or an Archil key for `aws-us-east-1` asked for `us-west`).
- `unknown`: the provider declares no location.
- `conflict`: a native selector (e.g. `region: 'iad1'`) disagrees with the area's id.

In `compute` with several providers, `regionClass` pins the normally selected provider and turns off `fallbackOnError`, as `sizeClass` does.

## Hosted platform

The platform provider sends `regionClass` in the create body for the platform router to filter placements. Use `providerOrder: ['vercel:sfo1']` to pin a provider's own region id.
