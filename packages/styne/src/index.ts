/**
 * Styne provider for ComputeSDK.
 *
 * Talks to the Styne REST API (https://docs.styne.ai/api-reference) directly. Sandboxes are
 * microVMs: commands stream their output as NDJSON frames, files move through the files API,
 * snapshots keep memory and disk and leave the source running, and volumes persist across
 * sandboxes.
 */

export { styne } from './provider';
export type { StyneConfig, StyneInstance, StyneSize, StyneTemplate, StyneTemplateOptions } from './provider';
export { StyneApiError } from './client';
