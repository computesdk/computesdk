/**
 * Provider registry for the plugin.
 *
 * `computesdk` is the first-party entry: it authenticates with the caller's
 * own bearer token (their ComputeSDK gateway key), so it needs no credential
 * fields and is always "configured". BYOK providers mirror the platform's
 * active sandbox providers — they take credentials stored per-user in the
 * vault.
 */

import type { Provider } from '@computesdk/provider';
import { tensorlake } from '@computesdk/tensorlake';
import { blaxel } from '@computesdk/blaxel';
import { archil } from '@computesdk/archil';
import { namespace } from '@computesdk/namespace';
import { computesdkGateway } from './gateway.js';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface ProviderSpec {
  name: string;
  description: string;
  /**
   * First-party providers authenticate with the user's bearer token and are
   * always usable; BYOK providers require set_provider_credentials first.
   */
  firstParty?: boolean;
  credentialFields: CredentialField[];
  create: (credentials: Record<string, string>, userToken: string) => Provider;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    name: 'computesdk',
    description:
      'ComputeSDK — hosted sandboxes routed across providers, with live market bidding for the best price. First-party; no provider keys needed.',
    firstParty: true,
    credentialFields: [],
    create: (_c, userToken) => computesdkGateway({ apiKey: userToken }),
  },
  {
    name: 'tensorlake',
    description: 'Tensorlake — compute sandboxes with durable storage.',
    credentialFields: [{ key: 'apiKey', label: 'Tensorlake API key', secret: true, required: true }],
    create: (c) => tensorlake({ apiKey: c.apiKey }),
  },
  {
    name: 'blaxel',
    description: 'Blaxel — fast-booting microVM sandboxes.',
    credentialFields: [
      { key: 'apiKey', label: 'Blaxel API key', secret: true, required: true },
      { key: 'workspace', label: 'Blaxel workspace ID', secret: false, required: true },
    ],
    create: (c) => blaxel({ apiKey: c.apiKey, workspace: c.workspace }),
  },
  {
    name: 'archil',
    description: 'Archil — disk-backed sandboxes with snapshot persistence.',
    credentialFields: [
      { key: 'apiKey', label: 'Archil API key', secret: true, required: true },
      { key: 'region', label: 'Archil region (e.g. aws-us-east-1)', secret: false, required: false },
    ],
    create: (c) => archil({ apiKey: c.apiKey, ...(c.region ? { region: c.region } : {}) }),
  },
  {
    name: 'namespace',
    description: 'Namespace — ephemeral build/CI-grade instances.',
    credentialFields: [{ key: 'token', label: 'Namespace API token', secret: true, required: true }],
    create: (c) => namespace({ token: c.token }),
  },
];

const byName = new Map(PROVIDERS.map((p) => [p.name, p]));

export function getProvider(name: string): ProviderSpec | undefined {
  return byName.get(name);
}
