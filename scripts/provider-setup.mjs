// One-time, idempotent account setup for providers whose instance size is
// fixed by a template. Builds each template below through the provider's own
// `template.create`, skipping any that already exist by name.
//
//   node scripts/provider-setup.mjs <provider|all> [--dry-run] [--verify]
//
// --verify boots each template, checks `nproc` and memory, then destroys the
// instance it created. Run `pnpm build` first.

const NODE = 'node:22';

// Shapes are vCPU / MiB. Names stay stable: callers boot them by name.
const SHAPES = [
  { name: 'node22-1cpu-2gb', vcpu: 1, memoryMib: 2048 },
  { name: 'node22-2cpu-4gb', vcpu: 2, memoryMib: 4096 },
  { name: 'node22-4cpu-8gb', vcpu: 4, memoryMib: 8192 },
  { name: 'node22-8cpu-16gb', vcpu: 8, memoryMib: 16384 },
];

const PROVIDERS = {
  // Sandboxes inherit the template's shape and cannot override it. The
  // built-in `superserve/node-22` already is 2 vCPU / 4 GiB.
  superserve: {
    load: async () => (await import('../packages/superserve/dist/index.mjs')).superserve({}),
    templates: [
      ...SHAPES.filter((s) => s.vcpu !== 2),
      { name: 'node22-1cpu-256mb', vcpu: 1, memoryMib: 256, diskMib: 1024 },
    ],
    exists: (t, name) => t.name === name,
    create: (p, s) => p.template.create({
      name: s.name, from: NODE, vcpu: s.vcpu, memoryMib: s.memoryMib, diskMib: s.diskMib ?? 10240,
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
    const found = existing.some((t) => cfg.exists(t, shape.name));
    console.log(`${id}/${shape.name}: ${found ? 'exists' : dryRun ? 'would create' : 'creating'}`);
    if (!found && !dryRun) {
      await cfg.create(provider, shape);
      console.log(`${id}/${shape.name}: created`);
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
