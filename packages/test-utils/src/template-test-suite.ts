/**
 * Template conformance suite (opt-in).
 *
 * Builds a template from an OCI image, boots an instance from it, checks the
 * OS inside matches the image, then destroys the instance and deletes the
 * template. Providers enable it by calling `runTemplateTestSuite` in their
 * test file once their `template` methods declare `capabilities`.
 */

import { describe, it, expect } from 'vitest';
// @ts-ignore - workspace reference
import type { Provider, ProviderInstance, TemplateInfo } from '@computesdk/provider';
import { failIfIntegrationRequired } from './provider-test-suite';

export interface TemplateTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions; must equal `provider.name` */
  name: string;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
  /** Per-test timeout in milliseconds (template builds are slow; default 15 min) */
  timeout?: number;
  /** Image to build from (default `ubuntu:24.04`) */
  image?: string;
  /** Text `cat /etc/os-release` must contain on an instance booted from it (default `24.04`) */
  expectOsRelease?: string;
}

const DEFAULT_IMAGE = 'ubuntu:24.04';
const DEFAULT_OS_RELEASE = '24.04';

function errorCode(error: unknown): { name?: string; code?: string } {
  const e = error as { name?: string; code?: string } | undefined;
  return { name: e?.name, code: e?.code };
}

async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Cleanup failures must not mask the assertion that failed.
  }
}

export function runTemplateTestSuite(config: TemplateTestConfig) {
  const {
    provider,
    name,
    skipIntegration = false,
    timeout = 15 * 60_000,
    image = DEFAULT_IMAGE,
    expectOsRelease = DEFAULT_OS_RELEASE,
  } = config;

  describe(`${name} templates`, () => {
    failIfIntegrationRequired(`${name} templates`, skipIntegration);

    it('declares template capabilities', () => {
      const capabilities = provider.template?.capabilities;
      expect(capabilities, `${name} must declare methods.template.capabilities`).toBeDefined();
      expect(typeof capabilities!.externalImages).toBe('boolean');
      expect(capabilities!.sources).toContain('image');
    });

    it('rejects create({ image }) unless it boots external images', async () => {
      if (provider.template?.capabilities?.externalImages !== false) return;
      const error = await provider.instances.create({ image }).then(
        (instance: ProviderInstance) => {
          void bestEffort(() => instance.destroy());
          return undefined;
        },
        (err: unknown) => err,
      );
      expect(errorCode(error)).toEqual({ name: 'TemplateError', code: 'unsupported' });
    });

    const live = skipIntegration ? it.skip : it;

    live(`creates a template from ${image}, boots it, and deletes it`, async () => {
      const template = (await provider.template!.create({
        name: `computesdk-conformance-${Date.now().toString(36)}`,
        image,
      })) as TemplateInfo;
      let instance: ProviderInstance | undefined;
      try {
        expect(typeof template.id).toBe('string');
        expect(template.id.length).toBeGreaterThan(0);
        expect(template.provider).toBe(provider.name);

        instance = await provider.instances.create({ templateId: template.id });
        const result = await instance.runCommand('cat /etc/os-release');
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(expectOsRelease);
      } finally {
        if (instance) await bestEffort(() => instance!.destroy());
        await bestEffort(() => provider.template!.delete(template.id));
      }
    }, timeout);

    live(`boots ${image} directly when it supports external images`, async () => {
      if (provider.template?.capabilities?.externalImages !== true) return;
      const instance = await provider.instances.create({ image });
      try {
        const result = await instance.runCommand('cat /etc/os-release');
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(expectOsRelease);
      } finally {
        await bestEffort(() => instance.destroy());
      }
    }, timeout);
  });
}
