import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkConformance, discoverProviders } from '../check-provider-conformance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const roster = JSON.parse(readFileSync(resolve(ROOT, 'conformance/providers.json'), 'utf8'));
const SOURCE = `import { defineProvider } from '@computesdk/provider';
throw new Error('The inventory guard must never execute an adapter');
export const fixture = defineProvider<Native, Config>({ name: 'fixture' });
`;

function fixture(t, source = SOURCE) {
  const root = mkdtempSync(resolve(tmpdir(), 'provider-conformance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file, contents) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), typeof contents === 'string' ? contents : `${JSON.stringify(contents)}\n`);
  }
  const pkg = (name, exports = { '.': { import: './dist/index.mjs' } }) => ({ name, exports });
  write('packages/provider/package.json', pkg('@computesdk/provider'));
  write('packages/provider/src/index.ts', "export { defineProvider, defineBrowserProvider, defineInfraProvider } from './factories';");
  write('packages/fixture/package.json', pkg('@computesdk/fixture'));
  write('packages/fixture/src/index.ts', source);
  const row = {
    id: '@computesdk/fixture', kind: 'compute',
    source: { file: 'packages/fixture/src/index.ts', binding: 'fixture', mechanism: 'defineProvider' },
    entrypoint: 'packages/fixture/src/index.ts', symbol: 'fixture',
    status: 'unknown', review: { status: 'included', reason: 'Fixture inventory only.' },
    evidence: [{ file: 'packages/fixture/src/index.ts', contains: 'export const fixture' }],
    knownUnsupported: [], gaps: ['No conformance run recorded.'], claims: [],
  };
  return { root, write, pkg, row, roster: { schemaVersion: 1, providers: [row], exclusions: [{ directory: 'packages/provider', reason: 'Framework only.' }] } };
}

function fails(result, pattern) {
  assert.equal(result.ok, false, 'guard must fail');
  assert.ok(result.errors.some((error) => pattern.test(error)), JSON.stringify(result.errors));
}

test('current roster accounts for every adapter, public export and utility package without importing adapters', () => {
  const result = checkConformance(ROOT, roster);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const statuses = ['unknown', 'declared', 'adapter-mocked', 'native-verified'];
  const included = roster.providers.filter((row) => row.review.status === 'included');
  const status = (row) => row.status ?? 'unknown';
  assert.deepEqual(result.summary, {
    packages: 78, discoveredAdapters: 70, rosterEntries: 70, excludedUtilityPackages: 9,
    omittedAdapters: 0,
    byKind: { compute: 58, browser: 9, infra: 0, storage: 3 },
    byStatus: Object.fromEntries(statuses.map((value) => [value, roster.providers.filter((row) => status(row) === value).length])),
    compatibilityReviewExcluded: 2, compatibilityReviewIncluded: 68,
    uncoveredAdapters: included.filter((row) => !['adapter-mocked', 'native-verified'].includes(status(row))).length,
    nativeUnverifiedAdapters: included.filter((row) => status(row) !== 'native-verified').length,
  });
  assert.equal(result.summary.byStatus['native-verified'], 0);
  assert.equal(result.summary.nativeUnverifiedAdapters, 68);
  const byId = new Map(roster.providers.map((row) => [row.id, row]));
  for (const id of ['@computesdk/aws/ec2', '@computesdk/aws/agentcore', '@computesdk/gcp/cloud-run', '@computesdk/platform', '@computesdk/r2', '@computesdk/s3', '@computesdk/tigris']) assert.ok(byId.has(id));
  assert.equal(byId.get('@computesdk/agentcore').aliasOf, '@computesdk/aws/agentcore');
  assert.equal(byId.get('@computesdk/cloud-run').aliasOf, '@computesdk/gcp/cloud-run');
  for (const id of ['@computesdk/gcp/cloud-run', '@computesdk/cloud-run']) {
    assert.equal(byId.get(id).status, 'unknown');
    assert.equal(byId.get(id).review.status, 'excluded');
  }
});

test('valid fixture and omitted status default to unknown; declared is still uncovered', (t) => {
  const f = fixture(t);
  delete f.row.status;
  let result = checkConformance(f.root, f.roster);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.providers[0].status, 'unknown');
  f.row.status = 'declared';
  result = checkConformance(f.root, f.roster);
  assert.equal(result.ok, true);
  assert.equal(result.summary.uncoveredAdapters, 1);
});

test('omitting an existing adapter fails', (t) => {
  const f = fixture(t);
  f.roster.providers = [];
  fails(checkConformance(f.root, f.roster), /Omitted provider/);
});

test('new factory in an existing adapter package cannot silently escape inventory', (t) => {
  const f = fixture(t, `${SOURCE}\nexport const second = defineProvider<Native, Config>({});`);
  fails(checkConformance(f.root, f.roster), /Omitted provider: .*#second/);
});

test('new provider package and new utility package both require classification', (t) => {
  const f = fixture(t);
  f.write('packages/new-adapter/package.json', f.pkg('@computesdk/new-adapter'));
  f.write('packages/new-adapter/src/index.ts', SOURCE.replaceAll('fixture', 'newAdapter'));
  f.write('packages/new-utility/package.json', f.pkg('@computesdk/new-utility'));
  f.write('packages/new-utility/src/index.ts', 'export const utility = 1;');
  const result = checkConformance(f.root, f.roster);
  fails(result, /Omitted provider: packages\/new-adapter/);
  fails(result, /Unaccounted package.*new-utility/);
});

test('duplicate IDs and duplicate targets fail separately', (t) => {
  const f = fixture(t);
  f.roster.providers.push(structuredClone(f.row));
  let result = checkConformance(f.root, f.roster);
  fails(result, /Duplicate provider id/);
  fails(result, /Duplicate provider target/);
  f.roster.providers[1].id = '@computesdk/another-id';
  result = checkConformance(f.root, f.roster);
  fails(result, /Duplicate provider target/);
});

test('nonexistent file, stale binding, stale public export and stale evidence fail', (t) => {
  const f = fixture(t);
  const original = structuredClone(f.row);
  for (const [mutate, expected] of [
    [(row) => { row.source.file = 'packages/fixture/src/missing.ts'; }, /Stale\/nonexistent adapter target/],
    [(row) => { row.source.binding = 'renamed'; }, /Stale\/nonexistent adapter target/],
    [(row) => { row.symbol = 'renamed'; }, /Invalid\/stale public export/],
    [(row) => { row.entrypoint = 'packages/fixture/src/missing.ts'; }, /Invalid\/stale public export/],
    [(row) => { row.evidence[0].contains = 'no longer here'; }, /Invalid\/stale evidence/],
    [(row) => { row.evidence[0].file = 'packages/fixture/src/missing.ts'; }, /Invalid\/stale evidence/],
  ]) {
    f.roster.providers[0] = structuredClone(original);
    mutate(f.roster.providers[0]);
    fails(checkConformance(f.root, f.roster), expected);
  }
});

test('unknown/declared statuses cannot claim support and verified statuses need run provenance', (t) => {
  const f = fixture(t);
  f.row.claims = ['command-output compatible'];
  fails(checkConformance(f.root, f.roster), /Unsupported support claim/);
  f.row.status = 'declared';
  fails(checkConformance(f.root, f.roster), /Unsupported support claim/);
  for (const status of ['adapter-mocked', 'native-verified']) {
    f.row.status = status;
    fails(checkConformance(f.root, f.roster), /Missing verification run record/);
  }
  f.row.status = 'supported';
  fails(checkConformance(f.root, f.roster), /Invalid status/);
  f.row.supported = true;
  fails(checkConformance(f.root, f.roster), /Unknown provider field/);
});

test('generic factory mocks cannot be substituted as adapter-scoped run evidence', (t) => {
  const f = fixture(t);
  const record = {
    provider: f.row.id, status: 'adapter-mocked', result: 'passed', command: 'fixture only',
    revision: 'fixture-revision', recordedAt: '2026-11-03T00:00:00Z',
    tests: [{ file: 'packages/provider/src/factory.test.ts', contains: 'generic mocks' }],
  };
  f.write(record.tests[0].file, '// generic mocks');
  f.write('run.json', JSON.stringify(record));
  f.row.status = 'adapter-mocked';
  f.row.verification = { file: 'run.json', sha256: createHash('sha256').update(JSON.stringify(record)).digest('hex') };
  fails(checkConformance(f.root, f.roster), /Verification must name adapter-scoped tests/);
});

test('run-record hash and provider identity are checked, not auto-inferred from test presence', (t) => {
  const f = fixture(t);
  const record = {
    provider: f.row.id, status: 'adapter-mocked', result: 'passed', command: 'fixture only (not a real adapter run)',
    revision: 'fixture-revision', recordedAt: '2026-11-03T00:00:00Z',
    tests: [{ file: 'packages/fixture/src/index.test.ts', contains: "from './index'" }],
  };
  f.write(record.tests[0].file, "import { fixture } from './index'; // never executed");
  const contents = JSON.stringify(record);
  f.write('run.json', contents);
  f.row.status = 'adapter-mocked';
  f.row.verification = { file: 'run.json', sha256: createHash('sha256').update(contents).digest('hex') };
  let result = checkConformance(f.root, f.roster);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.summary.nativeUnverifiedAdapters, 1);
  f.write('run.json', `${contents}\n`);
  fails(checkConformance(f.root, f.roster), /Invalid verification run record/);
});

test('Cloud Run aliases and implementation stay excluded and unverified', () => {
  const copy = structuredClone(roster);
  const row = copy.providers.find((item) => item.id === '@computesdk/gcp/cloud-run');
  row.review.status = 'included';
  fails(checkConformance(ROOT, copy), /Cloud Run must remain excluded\/unverified/);
});

test('unsupported capability evidence, exclusions and source kind cannot be invented', (t) => {
  const f = fixture(t);
  f.row.knownUnsupported = [{ description: 'Invented limitation.', evidence: { file: f.row.source.file, contains: 'not supported' } }];
  fails(checkConformance(f.root, f.roster), /Invalid\/stale evidence/);
  f.row.kind = 'browser';
  fails(checkConformance(f.root, f.roster), /Discovery mismatch/);
  f.roster.exclusions.push({ directory: 'packages/fixture', reason: 'Not allowed.' });
  fails(checkConformance(f.root, f.roster), /Adapter package cannot be excluded/);
  f.roster.exclusions.push({ directory: 'packages/missing', reason: 'Stale.' });
  fails(checkConformance(f.root, f.roster), /Stale package exclusion/);
});

test('lexer handles nested template interpolations, regexes, escaped quotes and decoys', (t) => {
  const source = [
    "import { defineProvider as make } from '@computesdk/provider';",
    '// const commentDecoy = defineProvider<Native, Config>({});',
    'const stringDecoy = "const fake = defineProvider<Native, Config>({})";',
    'const quoted = `\'${value.replace(/\'/g, `\'\\\\\'\'`)}\'`;',
    'const nested = `outer ${`inner ${({ value: "} ` quoted" }).value}`} end`;',
    'const templateDecoy = `const fake = defineProvider<Native, Config>({})`;',
    'const expression = /[\'"`{}]/g;',
    'const ratio = a / b;',
    'export const fixture = make<Native, Config>({});',
  ].join('\n');
  const f = fixture(t, source);
  const discovery = discoverProviders(f.root);
  assert.deepEqual(discovery.errors, []);
  assert.deepEqual(discovery.adapters.map((row) => row.source.binding), ['fixture']);
  assert.equal(checkConformance(f.root, f.roster).ok, true);
});

test('compute/browser/infra/storage shapes and local public reexport barrels are discovered', (t) => {
  const f = fixture(t);
  f.write('packages/fixture/src/other.ts', `
import { defineBrowserProvider as browser, defineInfraProvider } from '@computesdk/provider';
export const browsing = browser<Session, Config>({});
export const infrastructure = defineInfraProvider<Instance, Config>({});
`);
  f.write('packages/fixture/src/storage.ts', `
import type { StorageProvider } from '@computesdk/provider';
export interface Store extends StorageProvider {}
export function store(config: Config): Store { throw new Error('Never run'); }
`);
  const discovery = discoverProviders(f.root);
  assert.deepEqual(discovery.errors, []);
  assert.deepEqual(discovery.adapters.map((row) => row.kind).sort(), ['browser', 'compute', 'infra', 'storage']);
  f.write('packages/fixture/src/provider.ts', SOURCE);
  f.write('packages/fixture/src/index.ts', "export { fixture } from './provider.js';");
  f.row.source.file = 'packages/fixture/src/provider.ts';
  f.row.evidence[0].file = f.row.source.file;
  fails(checkConformance(f.root, f.roster), /Omitted provider/); // other.ts/storage.ts must be listed too
  f.roster.providers.push(...discovery.adapters.filter((row) => row.kind !== 'compute').map((row) => ({
    ...structuredClone(f.row), id: `@computesdk/fixture/${row.source.binding}`, source: row.source, kind: row.kind,
  })));
  // Isolate just the public barrel check without pretending these extra exports exist.
  f.write('packages/fixture/src/other.ts', '');
  f.write('packages/fixture/src/storage.ts', '');
  f.roster.providers.splice(1);
  assert.equal(checkConformance(f.root, f.roster).ok, true);
});

test('unrecognized factory callsites and newly exported factory kinds fail closed', (t) => {
  const f = fixture(t, `${SOURCE}\nfunction build() { return defineProvider<Native, Config>({}); }`);
  fails(checkConformance(f.root, f.roster), /Unrecognized factory callsite/);
  f.write('packages/provider/src/index.ts', "export { defineProvider, defineStorageProvider } from './factory';");
  fails(checkConformance(f.root, f.roster), /Unclassified provider factory: defineStorageProvider/);
});

test('reexport symbols must match the actual target adapter', () => {
  const copy = structuredClone(roster);
  copy.providers.find((row) => row.id === '@computesdk/agentcore').symbol = 'invented';
  fails(checkConformance(ROOT, copy), /Unresolved\/mismatched reexport symbol/);
});

test('renamed public reexport rejects the stale imported/local name', (t) => {
  const f = fixture(t);
  f.write('packages/fixture/src/adapter.ts', SOURCE);
  f.write('packages/fixture/src/index.ts', "export { fixture as renamed } from './adapter.js';");
  f.row.source.file = 'packages/fixture/src/adapter.ts';
  f.row.evidence[0].file = f.row.source.file;
  fails(checkConformance(f.root, f.roster), /Invalid\/stale public export/);
});

test('renamed public reexport resolves the actual imported/local value', (t) => {
  const f = fixture(t);
  f.write('packages/fixture/src/adapter.ts', SOURCE);
  f.write('packages/fixture/src/index.ts', "export { fixture as renamed } from './adapter.js';");
  f.row.source.file = 'packages/fixture/src/adapter.ts';
  f.row.evidence[0].file = f.row.source.file;
  f.row.symbol = 'renamed';
  const result = checkConformance(f.root, f.roster);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('type-only public reexports cannot masquerade as adapter values', (t) => {
  const f = fixture(t);
  f.write('packages/fixture/src/adapter.ts', SOURCE);
  f.row.source.file = 'packages/fixture/src/adapter.ts';
  f.row.evidence[0].file = f.row.source.file;
  for (const declaration of [
    "export type { fixture } from './adapter.js';",
    "export { type fixture } from './adapter.js';",
    "export { type fixture as renamed } from './adapter.js';",
  ]) {
    f.write('packages/fixture/src/index.ts', declaration);
    f.row.symbol = declaration.includes('renamed') ? 'renamed' : 'fixture';
    fails(checkConformance(f.root, f.roster), /Invalid\/stale public export/);
  }
});
