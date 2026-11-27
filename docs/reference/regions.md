# Sandbox regions

`regionClass` requests a standard US area on the selected provider. It is opt-in: omitting it keeps the provider's native default and options. It is not an alias for a provider's own `region` option.

`regionClass` takes one area or an ordered list. By default it is a preference; set `regionMode: 'only'` to fail instead of placing elsewhere.

```typescript
create({ regionClass: 'us-west' });                                   // us-west if the provider can, else its default
create({ regionClass: ['us-west', 'us-east'] });                      // us-west, then us-east, then the default
create({ regionClass: ['us-west', 'us-east'], regionMode: 'only' });  // us-west or us-east, or fail before create
```

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
console.log(sandbox.regionPlacement);
// { requested: ['us-west'], mode: 'prefer', matched: 'us-west', placement: 'selectable', region: 'sfo1', ... }
```

`regionPlacement.matched` is `null` when no listed area could be met and the provider placed the instance at its default (`region: null`).

```typescript
```

`provider.regions.support()` and `resolve(regionClass)` are synchronous, local declarations: they do not check credentials, capacity or account enablement.

## Placement kinds

| Kind | Meaning | Matches an area when |
| --- | --- | --- |
| `selectable` | Create picks a region per instance | The adapter declares an id for it; that id is sent (first listed wins) |
| `per-account` | The key, endpoint or config fixes the region | The configured region is in the area; nothing is sent |
| `fixed` | The provider runs in one known place | That place is in the area; nothing is sent |
| `provider-placed` | The provider picks and promises nothing | Never |
| `unknown` | Not declared | Never |

With `prefer`, an area that doesn't match is skipped, and if none match the instance is created at the provider's default. With `only`, no match fails before create.

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

- `invalid`: not a standard region, an empty list, an unknown `regionMode`, or `regionMode` without `regionClass`.
- `conflict`: a native selector (e.g. `region: 'iad1'`) disagrees with the matched area's id.
- `unsupported` (`only`): the provider can't place in any listed area (e.g. Vercel `us-central`, or an Archil key for `aws-us-east-1` asked for `us-west`).
- `unknown` (`only`): the provider declares no location.

In `compute` with several providers, `regionMode: 'only'` pins the normally selected provider and turns off `fallbackOnError`, as `sizeClass` does. A preference leaves provider selection and fallback unchanged; providers with no region contract get the request without `regionClass`.

## Hosted platform

The platform provider validates and sends `regionClass` (always as a list) and, when set, `regionMode` in the create body for the platform router. Use `providerOrder: ['vercel:sfo1']` to pin a provider's own region id.
