/**
 * Templates: a named, provider-scoped ref an instance boots from, built from
 * an OCI image or a Dockerfile and stored in the provider's registry.
 *
 * Every provider has a template store. Providers that boot arbitrary registry
 * images (`externalImages: true`) treat `template.create({ image })` as a pin
 * of that image; the others build or copy it into their own store. Callers
 * never branch on which: `create({ templateId: template.id })` boots either.
 */

/** What a template can be built from. */
export type TemplateSource = 'image' | 'dockerfile';

/** A provider's template support, read from `provider.template.capabilities`. */
export interface TemplateCapabilities {
  /**
   * `true` when `instances.create({ image })` boots any registry image directly.
   * `false` when images must go through `template.create({ image })` first.
   */
  readonly externalImages: boolean;
  /** Sources `template.create` accepts. */
  readonly sources: readonly TemplateSource[];
}

/** Normalized result of `template.create` / `template.list` on providers that declare capabilities. */
export interface TemplateInfo<TRaw = unknown> {
  /** Ref to boot from: `instances.create({ templateId: id })`. */
  id: string;
  name: string;
  provider: string;
  /** Content digest of the source image, when the provider reports one. */
  digest?: string;
  createdAt?: Date;
  /** Provider-native object. */
  raw?: TRaw;
}

export type TemplateErrorCode = 'unsupported' | 'invalid';

export class TemplateError extends Error {
  constructor(readonly code: TemplateErrorCode, message: string) {
    super(`template: ${message}`);
    this.name = 'TemplateError';
  }
}

/**
 * Shared resolution for `instances.create`: on a provider that declared
 * `externalImages: false`, `image` is rejected with a pointer at
 * `template.create` instead of being silently ignored or half-honored.
 * Providers without declared capabilities are left to their adapter.
 */
export function assertImageBootSupported(
  providerName: string,
  capabilities: TemplateCapabilities | undefined,
  options: { image?: string; templateId?: string } | undefined,
): void {
  if (!capabilities || !options) return;
  if (options.image !== undefined && options.templateId !== undefined) {
    throw new TemplateError('invalid', 'pass either image or templateId, not both');
  }
  if (options.image !== undefined && !capabilities.externalImages) {
    throw new TemplateError(
      'unsupported',
      `${providerName} does not boot registry images directly; build a template first: ` +
        `const t = await provider.template.create({ name, image: ${JSON.stringify(options.image)} }); ` +
        `then create({ templateId: t.id })`,
    );
  }
}
