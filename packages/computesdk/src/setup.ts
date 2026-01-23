/**
 * Helpers for building setup payloads used by COMPUTESDK_SETUP_B64 or POST /sandboxes
 */

import type { ServerStartOptions } from './client';
import type { CreateOverlayOptions } from './client/resources/overlay';

export type SetupOverlayConfig = Omit<CreateOverlayOptions, 'waitForCompletion'>;

export interface SetupPayload {
  overlays?: SetupOverlayConfig[];
  servers?: ServerStartOptions[];
}

export interface BuildSetupPayloadOptions {
  overlays?: CreateOverlayOptions[];
  servers?: ServerStartOptions[];
}

const encodeBase64 = (value: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  if (typeof btoa !== 'undefined' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  throw new Error('Base64 encoding is not supported in this environment.');
};

/**
 * Build a setup payload for COMPUTESDK_SETUP_B64 or POST /sandboxes
 */
export const buildSetupPayload = (options: BuildSetupPayloadOptions): SetupPayload => {
  const overlays = options.overlays?.map((overlay) => {
    const { source, target, ignore, strategy } = overlay;
    return {
      source,
      target,
      ignore,
      strategy,
    };
  });

  const servers = options.servers?.map((server) => ({
    ...server,
  }));

  return {
    overlays: overlays?.length ? overlays : undefined,
    servers: servers?.length ? servers : undefined,
  };
};

/**
 * Build and base64-encode a setup payload for COMPUTESDK_SETUP_B64
 */
export const encodeSetupPayload = (options: BuildSetupPayloadOptions): string => {
  const payload = buildSetupPayload(options);
  return encodeBase64(JSON.stringify(payload));
};
