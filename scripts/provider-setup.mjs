// One-time, idempotent account setup for providers whose instance size is
// fixed by a template. Builds each template below through the provider's own
// `template.create`, skipping any that already exist by name.
//
//   node scripts/provider-setup.mjs <provider|all> [--dry-run] [--verify]
//
// --verify boots each template, checks `nproc` and memory, then destroys the
// instance it created. Run `pnpm build` first.

import { readFileSync } from 'node:fs';

const NODE = 'node:22';

// Superserve size tiers bake Debian coreutils rebuilt with OpenSSL so
// sha256sum uses the SHA-NI path (~4x) — the sandbox-cpu benchmark hashes
// through dd|sha256sum. The bases are pinned to the Bookworm/amd64 digests
// the recipe was validated against; revalidate the recipe if they move.
const SUPERSERVE_BASE_FULL = 'node:22@sha256:69c6e263db01e9946c7743bbbe9f7b1ba0df384d27ec09e08e5832d6acd3daf3';
const SUPERSERVE_BASE_SLIM = 'node:22-slim@sha256:47725aca53d3295ec2d3be8f62726599b3033cc262edc2c7e429909b3ac599fc';
const COREUTILS_RECIPE = readFileSync(new URL('./superserve-coreutils-build.sh', import.meta.url), 'utf8');
const COREUTILS_VERSION = '9.1-1+0superserve.openssl1';

// API run steps execute under /bin/sh; the helper forces bash via a heredoc.
function coreutilsBuildStep(recipe) {
  const delimiter = 'SUPERSERVE_NATIVE_COREUTILS_RECIPE';
  if (recipe.split('\n').includes(delimiter)) throw new Error('Recipe delimiter collision');
  return { run: "bash -s <<'" + delimiter + "'\n" + recipe + '\n' + delimiter };
}

const coreutilsSteps = [
  coreutilsBuildStep(COREUTILS_RECIPE),
  { run: `dpkg-query -W coreutils | grep -qF '${COREUTILS_VERSION}' && ldd /usr/bin/sha256sum | grep -q libcrypto.so.3` },
];

// Shapes are vCPU / MiB. Names stay stable: callers boot them by name.
const SHAPES = [
  { name: 'csdk-node22-1cpu-2gb', vcpu: 1, memoryMib: 2048 },
  { name: 'csdk-node22-2cpu-4gb', vcpu: 2, memoryMib: 4096 },
  { name: 'csdk-node22-4cpu-8gb', vcpu: 4, memoryMib: 8192 },
  { name: 'csdk-node22-8cpu-16gb', vcpu: 8, memoryMib: 16384 },
];

const PROVIDERS = {
  // Sandboxes inherit the template's shape and cannot override it. Every
  // size tier bakes the OpenSSL coreutils build so sha256sum uses SHA-NI;
  // medium is our own slim-based template (built-in superserve/node-22
  // can't carry the recipe).
  superserve: {
    load: async () => (await import('../packages/superserve/dist/index.mjs')).superserve({}),
    templates: [
      ...SHAPES.map((s) => ({ ...s, from: s.vcpu === 2 ? SUPERSERVE_BASE_SLIM : SUPERSERVE_BASE_FULL, steps: coreutilsSteps })),
      // node:22 doesn't fit a 1 GiB disk (image_too_large), so small boxes keep the default disk.
      { name: 'csdk-node22-1cpu-256mb', vcpu: 1, memoryMib: 256 },
    ],
    exists: (t, name) => t.name === name,
    create: (p, s) => p.template.create({
      name: s.name, from: s.from ?? NODE, vcpu: s.vcpu, memoryMib: s.memoryMib, diskMib: s.diskMib ?? 10240,
      ...(s.steps ? { steps: s.steps } : {}),
    }),
    boot: (s) => ({ templateId: s.name }),
  },
  // E2B-compatible: CPU and memory are set when the template is built.
  novita: {
    load: async () => (await import('../packages/novita/dist/index.mjs')).novita({}),
    templates: SHAPES,
    exists: (t, name) => t.name === name || t.alias === name || (t.aliases ?? []).includes(name),
    create: (p, s) => p.template.create({
      name: s.name, image: NODE, build: { cpuCount: s.vcpu, memoryMB: s.memoryMib },
    }),
    boot: (s) => ({ templateId: s.name }),
  },
  // CPU and memory are fixed at template build; `sizeClass` boots these by name.
  // https://docs.e2b.dev/template/build.md
  e2b: {
    load: async () => (await import('../packages/e2b/dist/index.mjs')).e2b({}),
    templates: SHAPES,
    // GET /v2/templates names are team-scoped ("<team>/<name>").
    exists: (t, name) => (t.names ?? []).some((n) => n === name || n.endsWith(`/${name}`)),
    create: (p, s) => p.template.create({
      name: s.name, image: NODE, build: { cpuCount: s.vcpu, memoryMB: s.memoryMib },
    }),
    boot: (s) => ({ sizeClass: { 1: 'sm', 2: 'md', 4: 'lg', 8: 'xl' }[s.vcpu] }),
  },
  // Create only accepts the smaller shapes; 8 vCPU / 16 GiB exists only as a
  // built environment, which instances restore at its captured shape.
  mosaic: {
    load: async () => (await import('../packages/mosaic/dist/index.mjs')).mosaic({}),
    templates: SHAPES.filter((s) => s.vcpu === 8),
    exists: (t, name) => t.id === name || t.metadata?.name === name,
    create: (p, s) => p.template.create({ name: s.name, image: NODE, vcpu: s.vcpu, memoryMb: s.memoryMib }),
    boot: (s) => ({ templateId: s.name }),
  },
};

async function verify(provider, cfg, shape) {
  const instance = await provider.sandbox.create(cfg.boot(shape));
  console.log(`  booted ${instance.instanceId ?? instance.sandboxId} from ${shape.name}`);
  try {
    const out = await instance.runCommand("nproc; awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo");
    const [cpus, memMib] = out.stdout.trim().split('\n').map(Number);
    // The guest kernel keeps some memory, so MemTotal reads a little low.
    const ok = cpus === shape.vcpu && memMib >= shape.memoryMib * 0.85 && memMib <= shape.memoryMib * 1.05;
    console.log(`  ${ok ? 'ok' : 'MISMATCH'}: nproc=${cpus} MemTotal=${memMib}MiB (want ${shape.vcpu} / ${shape.memoryMib})`);
    return ok;
  } finally {
    await instance.destroy();
  }
}

async function setup(id, { dryRun, check }) {
  const cfg = PROVIDERS[id];
  const provider = await cfg.load();
  const existing = await provider.template.list();
  let ok = true;
  for (const shape of cfg.templates) {
    const match = existing.find((t) => cfg.exists(t, shape.name));
    const status = match?.metadata?.status ?? match?.buildStatus;
    if (match && status && !/ready|success|built|available/i.test(status)) {
      console.warn(`${id}/${shape.name}: exists but is ${status}; delete it and rerun to rebuild`);
      ok = false;
      continue;
    }
    const found = !!match;
    console.log(`${id}/${shape.name}: ${found ? 'exists' : dryRun ? 'would create' : 'creating'}`);
    if (!found && !dryRun) {
      try {
        await cfg.create(provider, shape);
        console.log(`${id}/${shape.name}: created`);
      } catch (error) {
        // e.g. a shape above the account's quota: report it, build the rest.
        console.error(`${id}/${shape.name}: failed: ${error instanceof Error ? error.message : error}`);
        ok = false;
        continue;
      }
    }
    if (check && !dryRun) ok = (await verify(provider, cfg, shape)) && ok;
  }
  return ok;
}

const [target, ...flags] = process.argv.slice(2);
const ids = target === 'all' ? Object.keys(PROVIDERS) : [target];
if (!target || ids.some((id) => !PROVIDERS[id])) {
  console.error(`usage: node scripts/provider-setup.mjs <${Object.keys(PROVIDERS).join('|')}|all> [--dry-run] [--verify]`);
  process.exit(1);
}
const options = { dryRun: flags.includes('--dry-run'), check: flags.includes('--verify') };
let ok = true;
for (const id of ids) ok = (await setup(id, options)) && ok;
process.exit(ok ? 0 : 1);
