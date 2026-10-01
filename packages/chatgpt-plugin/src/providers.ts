/**
 * Provider registry for the plugin.
 *
 * `computesdk` is the first-party entry: it authenticates with the caller's
 * own bearer token (their ComputeSDK gateway key), so it needs no credential
 * fields and is always "configured". BYOK providers take credentials stored
 * per-user in the vault.
 */

import type { Provider } from '@computesdk/provider';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';
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
      'ComputeSDK — hosted sandboxes on your ComputeSDK account. First-party; no provider keys needed.',
    firstParty: true,
    credentialFields: [],
    create: (_c, userToken) => computesdkGateway({ apiKey: userToken }),
  },
  {
    name: 'e2b',
    description: 'E2B — full Linux microVM sandboxes with filesystem access.',
    credentialFields: [{ key: 'apiKey', label: 'E2B API key', secret: true, required: true }],
    create: (c) => e2b({ apiKey: c.apiKey }),
  },
  {
    name: 'modal',
    description: 'Modal — serverless container sandboxes.',
    credentialFields: [
      { key: 'tokenId', label: 'Modal token ID', secret: true, required: true },
      { key: 'tokenSecret', label: 'Modal token secret', secret: true, required: true },
    ],
    create: (c) => modal({ tokenId: c.tokenId, tokenSecret: c.tokenSecret }),
  },
  {
    name: 'vercel',
    description: 'Vercel Sandbox — ephemeral sandboxes on Vercel infrastructure.',
    credentialFields: [
      { key: 'token', label: 'Vercel token', secret: true, required: true },
      { key: 'teamId', label: 'Vercel team ID', secret: false, required: false },
      { key: 'projectId', label: 'Vercel project ID', secret: false, required: false },
    ],
    create: (c) => vercel({ token: c.token, teamId: c.teamId, projectId: c.projectId }),
  },
  {
    name: 'daytona',
    description: 'Daytona — development-environment sandboxes.',
    credentialFields: [{ key: 'apiKey', label: 'Daytona API key', secret: true, required: true }],
    create: (c) => daytona({ apiKey: c.apiKey }),
  },
];

const byName = new Map(PROVIDERS.map((p) => [p.name, p]));

export function getProvider(name: string): ProviderSpec | undefined {
  return byName.get(name);
}
