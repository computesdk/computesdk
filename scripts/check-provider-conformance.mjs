#!/usr/bin/env node
// Source/metadata only: never import an adapter, its tests, or a vendor SDK.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const FACTORIES = {
  defineProvider: 'compute',
  defineBrowserProvider: 'browser',
  defineInfraProvider: 'infra',
};
const STATUSES = ['unknown', 'declared', 'adapter-mocked', 'native-verified'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (root, file) => readFileSync(resolve(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const key = (item) => `${item.source.file}#${item.source.binding}`;

// A deliberately small lexer, not a TS parser. Walk nested template
// interpolations so embedded backticks/quotes cannot swallow later callsites.
// Template contents are opaque; adapter declarations inside them are not code.
function tokens(source) {
  const result = [];
  let offset = 0;
  function quoted(quote) {
    offset++;
    while (offset < source.length) {
      if (source[offset] === '\\') offset += 2;
      else if (source[offset++] === quote) return;
    }
  }
  function template() {
    offset++;
    while (offset < source.length) {
      if (source[offset] === '\\') offset += 2;
      else if (source[offset] === '`') { offset++; return; }
      else if (source.slice(offset, offset + 2) === '${') {
        offset += 2;
        let depth = 1;
        let previous;
        while (offset < source.length && depth) {
          const token = next(previous);
          if (!token) break;
          if (!token.string && token.text === '{') depth++;
          if (!token.string && token.text === '}') depth--;
          previous = token;
        }
      } else offset++;
    }
  }
  function regexp(previous) {
    // Slash is a regexp opener in expression-start positions. Unlike a regexp
    // over the whole source, this respects escapes and character classes.
    if (previous && !/^(?:[=(:,!?{[;]|return|yield|case|=>)$/.test(previous.text)) return false;
    let end = offset + 1;
    let characterClass = false;
    while (end < source.length && !/[\r\n]/.test(source[end])) {
      const char = source[end++];
      if (char === '\\') end++;
      else if (char === '[') characterClass = true;
      else if (char === ']') characterClass = false;
      else if (char === '/' && !characterClass) {
        while (/[a-z]/i.test(source[end] ?? '') && end < source.length) end++;
        offset = end;
        return true;
      }
    }
    return false;
  }
  function next(previous) {
    while (offset < source.length) {
      if (/\s/.test(source[offset])) offset++;
      else if (source.slice(offset, offset + 2) === '//') {
        while (offset < source.length && source[offset] !== '\n') offset++;
      } else if (source.slice(offset, offset + 2) === '/*') {
        const end = source.indexOf('*/', offset + 2);
        offset = end < 0 ? source.length : end + 2;
      } else break;
    }
    if (offset >= source.length) return null;
    const start = offset;
    const char = source[offset];
    let string = false;
    if (char === '"' || char === "'") { quoted(char); string = true; }
    else if (char === '`') { template(); string = true; }
    else if (char === '/' && regexp(previous)) string = true;
    else if (/[A-Za-z_$]/.test(char)) {
      offset++;
      while (offset < source.length && /[\w$]/.test(source[offset])) offset++;
    } else offset++;
    const text = source.slice(start, offset);
    return { text, value: /^['"]/.test(text) ? text.slice(1, -1) : text, string };
  }
  while (offset < source.length) {
    const token = next(result.at(-1));
    if (token) result.push(token);
  }
  return result;
}

function files(root, directory) {
  if (!existsSync(resolve(root, directory))) return [];
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        return /^(?:node_modules|dist|__tests__|__mocks__|fixtures)$/.test(entry.name) ? [] : files(root, path);
      }
      return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

function importedNames(ts) {
  const names = new Map(Object.keys(FACTORIES).map((name) => [name, name]));
  names.set('StorageProvider', 'StorageProvider');
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].text !== 'import') continue;
    const end = ts.findIndex((token, index) => index > i && token.text === 'from');
    if (end < 0 || end - i > 150 || ts[end + 1]?.value !== '@computesdk/provider') continue;
    for (let j = i + 1; j < end; j++) {
      const canonical = ts[j].text;
      if (canonical in FACTORIES || canonical === 'StorageProvider') {
        names.set(ts[j + 1]?.text === 'as' ? ts[j + 2].text : canonical, canonical);
      }
    }
  }
  return names;
}

function callsFactory(ts, i) {
  let next = i + 1;
  if (ts[next]?.text === '<') {
    let depth = 0;
    do {
      if (ts[next].text === '<') depth++;
      if (ts[next].text === '>') depth--;
      next++;
    } while (next < ts.length && depth > 0);
  }
  return ts[next]?.text === '(';
}

export function discoverProviders(root = ROOT) {
  const packages = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(root, `packages/${entry.name}/package.json`)))
    .map((entry) => ({ directory: `packages/${entry.name}`, manifest: json(root, `packages/${entry.name}/package.json`) }))
    .sort((a, b) => a.directory.localeCompare(b.directory, 'en'));
  const adapters = [];
  const reexports = [];
  const errors = [];
  for (const pkg of packages) {
    for (const file of files(root, `${pkg.directory}/src`)) {
      const ts = tokens(read(root, file));
      const names = importedNames(ts);
      const add = (kind, binding, mechanism, extra = {}) => adapters.push({
        package: pkg.manifest.name, directory: pkg.directory, kind,
        source: { file, binding, mechanism }, ...extra,
      });
      for (let i = 0; i < ts.length; i++) {
        const canonical = names.get(ts[i].text);
        if (!ts[i].string && canonical in FACTORIES && callsFactory(ts, i) && ts[i - 1]?.text !== 'function') {
          // Current adapters assign factories to a const, sometimes exported and
          // sometimes wrapped. Fail closed on a new unsupported callsite shape.
          if (ts[i - 1]?.text !== '=' || !/^[A-Za-z_$][\w$]*$/.test(ts[i - 2]?.text ?? '')) {
            errors.push(`Unrecognized factory callsite: ${file}:${ts[i].text}`);
          } else add(FACTORIES[canonical], ts[i - 2].text, canonical);
        }
        if (ts[i].text === 'interface' && ts[i + 2]?.text === 'extends' && names.get(ts[i + 3]?.text) === 'StorageProvider') {
          const type = ts[i + 1].text;
          const functions = ts.flatMap((token, index) =>
            token.text === 'export' && ts[index + 1]?.text === 'function' ? [index + 2] : []);
          const factory = functions.find((index) => {
            const end = ts.findIndex((token, j) => j > index && token.text === '{');
            return ts.slice(index, end).some((token, j, all) => token.text === type && all[j - 1]?.text === ':');
          });
          if (factory === undefined) errors.push(`Unrecognized storage factory: ${file}:${type}`);
          else add('storage', ts[factory].text, 'StorageProvider');
        }
        if (ts[i].text === 'export' && ts[i + 1]?.text === '*' && ts[i + 2]?.text === 'from' && ts[i + 3]?.string) {
          reexports.push({ pkg, file, target: ts[i + 3].value });
        }
      }
    }
  }
  // External package reexports are separate public adapters, not native evidence.
  for (const item of reexports) {
    const pkg = packages.find((candidate) =>
      item.target === candidate.manifest.name || item.target.startsWith(`${candidate.manifest.name}/`));
    if (!pkg || !adapters.some((adapter) => adapter.directory === pkg.directory)) continue;
    const suffix = item.target.slice(pkg.manifest.name.length);
    const entrypoint = `${pkg.directory}/src${suffix || ''}/index.ts`;
    const target = adapters.find((adapter) => adapter.source.file === entrypoint);
    if (!target) {
      errors.push(`Unresolved adapter reexport: ${item.file} -> ${item.target}`);
      continue;
    }
    adapters.push({
      package: item.pkg.manifest.name, directory: item.pkg.directory, kind: target.kind,
      source: { file: item.file, binding: `export*:${item.target}`, mechanism: 'reexport' },
      aliasOf: item.target,
    });
  }
  // A newly exported factory must be deliberately taught to this inventory.
  const framework = tokens(read(root, 'packages/provider/src/index.ts'));
  for (const token of framework) {
    if (/^define\w*Provider$/.test(token.text) && !(token.text in FACTORIES)) {
      errors.push(`Unclassified provider factory: ${token.text}`);
    }
  }
  const keys = new Set();
  for (const adapter of adapters) {
    if (keys.has(key(adapter))) errors.push(`Ambiguous adapter binding: ${key(adapter)}`);
    keys.add(key(adapter));
  }
  return { packages, adapters: adapters.sort((a, b) => key(a).localeCompare(key(b), 'en')), errors };
}

function namedSpecifiers(ts, start, end) {
  const result = [];
  let specifier = [];
  function add() {
    const typeOnly = specifier[0]?.text === 'type' && specifier.length > 1 && specifier[1]?.text !== 'as';
    const parts = typeOnly ? specifier.slice(1) : specifier;
    if (parts.length === 1 || (parts.length === 3 && parts[1].text === 'as')) {
      result.push({ local: parts[0].value, public: parts.at(-1).value, typeOnly });
    }
    specifier = [];
  }
  for (const token of ts.slice(start + 1, end)) {
    if (token.text === ',') add();
    else specifier.push(token);
  }
  add();
  return result;
}

function publicExport(root, file, symbol, target, seen = new Set()) {
  const visit = `${file}#${symbol}`;
  if (seen.has(visit) || !existsSync(resolve(root, file))) return false;
  seen.add(visit);
  const ts = tokens(read(root, file));
  function follow(from, imported) {
    if (!from?.startsWith('.')) return false;
    const base = relative(root, resolve(root, dirname(file), from)).replace(/\.[cm]?js$/, '');
    const next = [`${base}.ts`, `${base}/index.ts`].find((path) => existsSync(resolve(root, path)));
    return next ? publicExport(root, next, imported, target, seen) : false;
  }
  function localValue(name) {
    if (file === target && ts.some((token, index) =>
      !token.string && ['const', 'let', 'var', 'function', 'class', 'enum'].includes(token.text) && ts[index + 1]?.text === name)) return true;
    // A local export may itself refer to a named import in a barrel.
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].text !== 'import' || ts[i + 1]?.text !== '{') continue;
      const end = ts.findIndex((token, index) => index > i + 1 && token.text === '}');
      if (end < 0 || ts[end + 1]?.text !== 'from') continue;
      for (const specifier of namedSpecifiers(ts, i + 1, end)) {
        if (!specifier.typeOnly && specifier.public === name && follow(ts[end + 2]?.value, specifier.local)) return true;
      }
    }
    return false;
  }
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].text !== 'export') continue;
    let j = i + 1;
    if (ts[j]?.text === 'async') j++;
    if (['const', 'function', 'class'].includes(ts[j]?.text) && ts[j + 1]?.text === symbol && file === target) return true;
    if (ts[j]?.text !== '{' && ts[j]?.text !== '*') continue;
    const end = ts[j].text === '*' ? j : ts.findIndex((token, index) => index > j && token.text === '}');
    if (end < 0) continue;
    const from = ts[end + 1]?.text === 'from' ? ts[end + 2]?.value : null;
    if (ts[j].text === '*') {
      if (follow(from, symbol)) return true;
      if (from && !from.startsWith('.') && file === target) return true;
      continue;
    }
    for (const specifier of namedSpecifiers(ts, j, end)) {
      if (specifier.typeOnly || specifier.public !== symbol) continue;
      if (from ? follow(from, specifier.local) : localValue(specifier.local)) return true;
    }
  }
  return false;
}

export function checkConformance(root = ROOT, roster = json(root, 'conformance/providers.json')) {
  const discovered = discoverProviders(root);
  const errors = [...discovered.errors];
  const complain = (message) => errors.push(message);
  const safeFile = (file) => typeof file === 'string' && !isAbsolute(file) && !relative(root, resolve(root, file)).startsWith('..') && existsSync(resolve(root, file)) && statSync(resolve(root, file)).isFile();
  const evidence = (item, label) => {
    if (!item || !safeFile(item.file) || typeof item.contains !== 'string' || !item.contains || !read(root, item.file).includes(item.contains)) {
      complain(`Invalid/stale evidence: ${label}`);
      return false;
    }
    return true;
  };
  if (roster.schemaVersion !== 1 || !Array.isArray(roster.providers) || !Array.isArray(roster.exclusions)) {
    return { ok: false, errors: ['Invalid roster schema'], summary: null, providers: [] };
  }
  const ids = new Set();
  const targets = new Set();
  const allowed = new Set(['id', 'kind', 'source', 'entrypoint', 'symbol', 'aliasOf', 'status', 'review', 'evidence', 'knownUnsupported', 'gaps', 'claims', 'verification']);
  for (const provider of roster.providers) {
    const label = provider.id ?? '<missing id>';
    for (const field of Object.keys(provider)) if (!allowed.has(field)) complain(`Unknown provider field ${label}.${field}`);
    if (!provider.source || typeof provider.source.file !== 'string' || typeof provider.source.binding !== 'string') {
      complain(`Invalid source: ${label}`);
      continue;
    }
    const targetKey = key(provider);
    if (ids.has(label)) complain(`Duplicate provider id: ${label}`);
    if (targets.has(targetKey)) complain(`Duplicate provider target: ${targetKey}`);
    ids.add(label);
    targets.add(targetKey);
    const target = discovered.adapters.find((item) => key(item) === targetKey);
    if (!target) complain(`Stale/nonexistent adapter target: ${label} (${targetKey})`);
    else {
      if (provider.kind !== target.kind || provider.source.mechanism !== target.source.mechanism || provider.aliasOf !== target.aliasOf) complain(`Discovery mismatch: ${label}`);
      const pkg = discovered.packages.find((item) => item.directory === target.directory);
      const suffix = label === pkg.manifest.name ? '.' : label.startsWith(`${pkg.manifest.name}/`) ? `.${label.slice(pkg.manifest.name.length)}` : null;
      const exported = suffix && pkg.manifest.exports?.[suffix];
      const output = typeof exported === 'string' ? exported : exported?.import;
      const expected = provider.entrypoint?.replace(`${target.directory}/src/`, './dist/').replace(/\.ts$/, pkg.manifest.type === 'module' ? '.js' : '.mjs');
      if (!output || output !== expected || !safeFile(provider.entrypoint) || !publicExport(root, provider.entrypoint, provider.symbol, provider.source.file)) {
        complain(`Invalid/stale public export: ${label}`);
      }
    }
    const status = provider.status ?? 'unknown';
    if (!STATUSES.includes(status)) complain(`Invalid status: ${label}`);
    if (!['included', 'excluded'].includes(provider.review?.status) || !provider.review?.reason) complain(`Missing compatibility review scope: ${label}`);
    if ((label === '@computesdk/gcp/cloud-run' || label === '@computesdk/cloud-run') && (provider.review?.status !== 'excluded' || status !== 'unknown' || provider.claims?.length)) complain(`Cloud Run must remain excluded/unverified: ${label}`);
    if (!Array.isArray(provider.evidence) || !provider.evidence.length) complain(`Missing provenance: ${label}`);
    else for (const item of provider.evidence) evidence(item, label);
    if (!Array.isArray(provider.knownUnsupported) || !Array.isArray(provider.gaps) || !provider.gaps.length) complain(`Missing unsupported/gap accounting: ${label}`);
    else for (const item of provider.knownUnsupported) {
      if (!item.description) complain(`Missing unsupported description: ${label}`);
      evidence(item.evidence, `${label} unsupported`);
    }
    if (!Array.isArray(provider.claims) || provider.claims.some((claim) => typeof claim !== 'string')) complain(`Invalid claims: ${label}`);
    if (provider.claims?.length && !['adapter-mocked', 'native-verified'].includes(status)) complain(`Unsupported support claim without verification: ${label}`);
    if (['adapter-mocked', 'native-verified'].includes(status)) {
      // Only validate the provenance of an explicitly supplied run record. This
      // cannot independently prove a native run happened; never auto-promote.
      const run = provider.verification;
      if (!run || !safeFile(run.file) || !/^[a-f0-9]{64}$/.test(run.sha256 ?? '')) complain(`Missing verification run record: ${label}`);
      else {
        const contents = read(root, run.file);
        let record;
        try { record = JSON.parse(contents); } catch { /* diagnosed below */ }
        const hash = createHash('sha256').update(contents).digest('hex');
        if (hash !== run.sha256 || record?.provider !== label || record?.status !== status || record?.result !== 'passed' || !record?.command || !record?.revision || !record?.recordedAt || !Array.isArray(record?.tests) || !record.tests.length) {
          complain(`Invalid verification run record: ${label}`);
        } else for (const test of record.tests) {
          if (!test.file?.startsWith(`${target?.directory}/`) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(test.file)) complain(`Verification must name adapter-scoped tests: ${label}`);
          evidence(test, `${label} verification test`);
        }
      }
    } else if (provider.verification) complain(`Unverified status cannot carry verification: ${label}`);
  }
  for (const provider of roster.providers.filter((item) => item.aliasOf)) {
    const original = roster.providers.find((item) => item.id === provider.aliasOf);
    if (!original || provider.symbol !== original.symbol) complain(`Unresolved/mismatched reexport symbol: ${provider.id}`);
  }
  for (const item of discovered.adapters) if (!targets.has(key(item))) complain(`Omitted provider: ${key(item)}`);
  const excluded = new Set();
  for (const item of roster.exclusions) {
    if (excluded.has(item.directory)) complain(`Duplicate package exclusion: ${item.directory}`);
    excluded.add(item.directory);
    if (!discovered.packages.some((pkg) => pkg.directory === item.directory)) complain(`Stale package exclusion: ${item.directory}`);
    if (!item.reason) complain(`Missing package exclusion reason: ${item.directory}`);
    if (discovered.adapters.some((provider) => provider.directory === item.directory)) complain(`Adapter package cannot be excluded: ${item.directory}`);
  }
  for (const pkg of discovered.packages) {
    if (!excluded.has(pkg.directory) && !discovered.adapters.some((provider) => provider.directory === pkg.directory)) complain(`Unaccounted package (classify new adapters/utilities): ${pkg.directory}`);
  }
  const providers = roster.providers.map((provider) => ({ id: provider.id, kind: provider.kind, status: provider.status ?? 'unknown', review: provider.review?.status })).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const included = providers.filter((provider) => provider.review === 'included');
  const verified = (provider) => ['adapter-mocked', 'native-verified'].includes(provider.status);
  const summary = {
    packages: discovered.packages.length,
    discoveredAdapters: discovered.adapters.length,
    rosterEntries: providers.length,
    excludedUtilityPackages: excluded.size,
    omittedAdapters: discovered.adapters.filter((item) => !targets.has(key(item))).length,
    byKind: Object.fromEntries(['compute', 'browser', 'infra', 'storage'].map((kind) => [kind, providers.filter((provider) => provider.kind === kind).length])),
    byStatus: Object.fromEntries(STATUSES.map((status) => [status, providers.filter((provider) => provider.status === status).length])),
    compatibilityReviewExcluded: providers.length - included.length,
    compatibilityReviewIncluded: included.length,
    uncoveredAdapters: included.filter((provider) => !verified(provider)).length,
    nativeUnverifiedAdapters: included.filter((provider) => provider.status !== 'native-verified').length,
  };
  return { ok: errors.length === 0, errors: errors.sort(), summary, providers };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkConformance();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [error.message] }, null, 2));
    process.exitCode = 1;
  }
}
