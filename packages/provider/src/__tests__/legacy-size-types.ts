/** Compiler-only regression: included by provider tsconfig and the explicit offline tsc command. */
import { compute, type ExplicitComputeConfig, type InstanceSizeResolution } from 'computesdk';
import { defineProvider } from '../factory';
import type { Provider } from '../types/provider';

type DirectProvider = NonNullable<ExplicitComputeConfig['provider']>;
async function unused(): Promise<never> { throw new Error('compiler-only fixture'); }
const manager = { create: unused, getById: async () => null, list: async () => [], destroy: async () => {} };
const arrayLegacy = { name: 'array', instances: manager, sandbox: manager, sizes: ['native'] };
const functionLegacy = { name: 'function', instances: manager, sandbox: manager, sizes: () => ['native'] };
const objectLegacy = { name: 'object', instances: manager, sandbox: manager, sizes: { native: 'tier' } };

// The pre-sizing structural interfaces did not constrain an unrelated sizes extension.
const baselineDirect: Omit<DirectProvider, 'sizes'>[] = [arrayLegacy, functionLegacy, objectLegacy];
const baselineProvider: Omit<Provider, 'sizes'>[] = [arrayLegacy, functionLegacy, objectLegacy];

// No casts or suppression: all legacy variable shapes must remain accepted with no sizeClass.
const direct: DirectProvider[] = [arrayLegacy, functionLegacy, objectLegacy];
const sdkProviders: Provider[] = [arrayLegacy, functionLegacy, objectLegacy];
compute({ provider: arrayLegacy });
compute({ provider: functionLegacy });
compute({ provider: objectLegacy });

// Generated factories must retain required, strongly typed discovery despite the permissive base slot.
const generated = defineProvider<{}, {}>({ name: 'generated', methods: { instances: {
  ...manager, runCommand: unused, getInfo: unused, getUrl: unused,
} } })({});
const list: readonly InstanceSizeResolution[] = generated.sizes.list();
const resolution: InstanceSizeResolution = generated.sizes.resolve('sm');
void [baselineDirect, baselineProvider, direct, sdkProviders, list, resolution];
