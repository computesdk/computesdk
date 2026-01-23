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
