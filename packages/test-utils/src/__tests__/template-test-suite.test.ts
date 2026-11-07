import { describe, expect, it } from 'vitest';
import { defineProvider } from '@computesdk/provider';
import type { CreateInstanceOptions, TemplateCapabilities } from '@computesdk/provider';
import { runTemplateTestSuite } from '../template-test-suite';

/** In-memory provider: templates map name → image, instances report the image's os-release. */
function mockTemplateProvider(capabilities: TemplateCapabilities) {
  const templates = new Map<string, string>();
  const instances = new Map<string, { image: string }>();
  const deleted: string[] = [];
  let seq = 0;
  const osRelease = (image: string) => (image === 'ubuntu:24.04' ? 'VERSION_ID="24.04"\n' : 'VERSION_ID="unknown"\n');

  const provider = defineProvider<{ image: string }, Record<string, never>>({
    name: 'mock',
    methods: {
      instances: {
        create: async (_config, options?: CreateInstanceOptions) => {
          const image = options?.templateId ? templates.get(options.templateId) : options?.image;
          if (!image) throw new Error(`unknown template ${options?.templateId}`);
          const id = `sb-${++seq}`;
          const instance = { image };
          instances.set(id, instance);
          return { sandbox: instance, sandboxId: id };
        },
        getById: async () => null,
        list: async () => [],
        destroy: async (_config, id) => { instances.delete(id); },
        runCommand: async (instance, command) => ({
          stdout: command === 'cat /etc/os-release' ? osRelease(instance.image) : '',
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        }),
        getInfo: async () => ({ id: 'sb', provider: 'mock', status: 'running', createdAt: new Date(), timeout: 0 }),
        getUrl: async () => '',
      },
      template: {
        capabilities,
        create: async (_config, options) => {
          const id = `tpl-${++seq}`;
          templates.set(id, options.image!);
          return { id, name: options.name };
        },
        list: async () => [...templates.keys()].map((id) => ({ id })),
        delete: async (_config, id) => { templates.delete(id); deleted.push(id); },
      },
    },
  })({});
  return { provider, templates, instances, deleted };
}

describe('runTemplateTestSuite', () => {
  const builds = mockTemplateProvider({ externalImages: false, sources: ['image', 'dockerfile'] });
  runTemplateTestSuite({ provider: builds.provider, name: 'mock (builds)', timeout: 5_000 });

  const external = mockTemplateProvider({ externalImages: true, sources: ['image'] });
  runTemplateTestSuite({ provider: external.provider, name: 'mock (external)', timeout: 5_000 });

  const offline = mockTemplateProvider({ externalImages: false, sources: ['image'] });
  runTemplateTestSuite({ provider: offline.provider, name: 'mock (offline)', skipIntegration: true });

  it('cleans up every instance and template it created', () => {
    expect(offline.instances.size + offline.templates.size + offline.deleted.length).toBe(0);
    expect(builds.instances.size).toBe(0);
    expect(builds.templates.size).toBe(0);
    expect(builds.deleted).toHaveLength(1);
    expect(external.instances.size).toBe(0);
    expect(external.templates.size).toBe(0);
  });
});
