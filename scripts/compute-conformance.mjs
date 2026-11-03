#!/usr/bin/env node
// Preparation is source-only. Only `run --execute` may import real adapters.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeRules = new Map([
  ['@computesdk/createos-sandbox', { oracle: 'createos-destroyed-metadata', status: 'destroyed' }],
  ['@computesdk/blaxel', { oracle: 'blaxel-terminated-metadata', status: 'TERMINATED' }],
  ['@computesdk/modal', { oracle: 'modal-finished-exitcode', validStatus: Number.isSafeInteger }],
  ['@computesdk/upstash', { oracle: 'upstash-deleted-metadata', status: 'deleted' }],
]);
export const reportPath = (id, root = ROOT) =>
  resolve(root, 'conformance-results', `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

/** Recovery metadata only. Never serialize SDK objects, errors or credentials. */
export function createResourceJournal(file, provider, fingerprint) {
  const attempts = [];
  let unhealthy = false;
  const persist = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ provider, sourceFingerprint: fingerprint,
        assurance: 'SDK-returned IDs and explicitly scoped SDK/native cleanup observations; not physical deletion or billing proof', attempts }, null, 2) + '\n');
    } catch {
      unhealthy = true;
      throw new Error('Compute resource journal could not be persisted');
    }
  };
  const observe = fn => { try { fn(); persist(); } catch { unhealthy = true; } };
  persist(); // Failure BEFORE any SDK import/create is safe to reject.
  return {
    requested(number) {
      attempts.push({ number, state: 'requested', requestedAt: new Date().toISOString() });
      persist(); // Safe to reject before forwarding this SDK create call.
    },
    returned(number, sandbox) {
      observe(() => {
        const id = sandbox?.sandboxId;
        if (typeof id !== 'string' || !id || id.length > 4096 || /[\0\r\n]/.test(id)) throw new Error('Invalid SDK ID');
        Object.assign(attempts.find(a => a.number === number), {
          sandboxId: id, state: 'returned', returnedAt: new Date().toISOString(),
        });
      });
      // NEVER hide an allocated instance from the suite's ownership/cleanup.
      return sandbox;
    },
    rejected(number) {
      observe(() => { attempts.find(a => a.number === number).state = 'rejected-id-unknown'; });
    },
    cleanupObserved(id, phase) {
      // Fixed operation labels only: never serialize native errors, response
      // bodies or SDK objects. An ACK is deliberately not an absence claim.
      const allowed = ['destroy-acknowledged', 'lookup-pending', 'sdk-present', 'sdk-absent', 'lookup-error'];
      observe(() => {
        if (!allowed.includes(phase)) throw new Error('Invalid cleanup observation');
        const owned = attempts.filter(a => a.sandboxId === id);
        if (!owned.length) throw new Error('Unknown owned ID');
        for (const a of owned) {
          const observedAt = new Date().toISOString();
          a.cleanup = { ...a.cleanup, phase, observedAt };
          if (phase === 'destroy-acknowledged') a.cleanup.destroyAcknowledgedAt = observedAt;
        }
      });
    },
    absent(id) {
      observe(() => {
        const owned = attempts.filter(a => a.sandboxId === id);
        if (!owned.length) throw new Error('Unknown owned ID');
        for (const a of owned) Object.assign(a, { state: 'sdk-reported-absent', absenceAt: new Date().toISOString() });
      });
    },
    nativeTerminal(id, oracle, status) {
      observe(() => {
        const rule = nativeRules.get(provider);
        if (!rule || oracle !== rule.oracle ||
            (rule.validStatus ? !rule.validStatus(status) : status !== rule.status)) {
          throw new Error('Unreviewed native cleanup oracle');
        }
        const owned = attempts.filter(a => a.sandboxId === id);
        if (!owned.length) throw new Error('Unknown owned ID');
        for (const a of owned) Object.assign(a, {
          state: 'native-reported-terminal', terminalAt: new Date().toISOString(),
          terminalObservation: { oracle, status },
        });
      });
    },
    assertHealthy() { if (unhealthy) throw new Error('Compute resource journal is incomplete'); },
  };
}

export function loadProfiles(root = ROOT) {
  const profiles = readJSON(resolve(root, 'conformance/compute-profiles.json')).profiles;
  const inventory = readJSON(resolve(root, 'conformance/providers.json')).providers;
  const expected = inventory.filter(p => p.kind === 'compute' && !p.aliasOf && p.review.status === 'included');
  if (new Set(profiles.map(p => p.id)).size !== profiles.length ||
      JSON.stringify(profiles.map(p => p.id).sort()) !== JSON.stringify(expected.map(p => p.id).sort())) {
    throw new Error('Compute profiles must cover every canonical in-scope compute entry exactly once');
  }
  for (const p of profiles) {
    const row = expected.find(r => r.id === p.id);
    const manifest = readJSON(resolve(root, p.packageDirectory, 'package.json'));
    const packageId = manifest.name + (p.exportSubpath === '.' ? '' : p.exportSubpath.slice(1));
    if (packageId !== p.id || row.symbol !== p.symbol ||
        !['wired', 'blocked'].includes(p.readiness) ||
        !Array.isArray(p.requiredEnvironment) || !Array.isArray(p.optionalEnvironment)) {
      throw new Error('Invalid compute profile identity or readiness');
    }
    const names = [...p.requiredEnvironment, ...p.optionalEnvironment];
    if (names.length > 32 || new Set(names).size !== names.length ||
        names.some(n => !/^[A-Z][A-Z0-9_]*$/.test(n)) ||
        Object.values(p.configEnvironment).some(n => !names.includes(n))) {
      throw new Error('Invalid compute profile environment allowlist');
    }
    for (const flag of ['supportsFilesystem', 'supportsGetUrl', 'supportsBackground']) {
      if (typeof p.suite[flag] !== 'boolean') throw new Error('Missing explicit suite selection');
    }
    if (!['needs-review', 'source-reviewed-sdk-absence', 'source-reviewed-native-terminal'].includes(p.cleanup?.status) ||
        typeof p.cleanup.reason !== 'string' || !p.cleanup.reason) throw new Error('Missing compute cleanup review');
    if (p.cleanup.status === 'source-reviewed-native-terminal' &&
        (!nativeRules.has(p.id) || p.cleanup.oracle !== nativeRules.get(p.id).oracle)) {
      throw new Error('Unreviewed native terminal cleanup oracle');
    }
    if (p.cleanup.oracle !== undefined && p.cleanup.status !== 'source-reviewed-native-terminal') {
      throw new Error('Unexpected compute cleanup oracle');
    }
    if (p.readiness === 'blocked' && (Object.keys(p.config).length ||
        Object.values(p.suite).some(v => v === true))) throw new Error('Blocked profile selects live operations');
    for (const evidence of p.sourceEvidence) {
      if (!readFileSync(resolve(root, evidence.file), 'utf8').includes(evidence.contains)) {
        throw new Error('Stale compute profile source evidence');
      }
    }
  }
  return profiles;
}

export function selectProfiles(profiles, selection) {
  const selected = selection === 'all' ? profiles :
    profiles.filter(p => p.id === selection || p.id === `@computesdk/${selection}`);
  if (!selected.length) throw new Error('Unknown compute provider selection');
  return selected;
}

export function credentialPattern(profile, env) {
  const missing = [...profile.requiredEnvironment, ...profile.optionalEnvironment].filter(name => !env[name]?.trim());
  return missing.length ? `^(${missing.join('|')})=$` : '';
}

/** Namespace vault list returns metadata, not values. Fail on ambiguous names. */
export function vaultEnvdef(metadata, profile, env) {
  if (!Array.isArray(metadata)) throw new Error('Invalid vault metadata');
  const wanted = new Set([...profile.requiredEnvironment, ...profile.optionalEnvironment].filter(name => !env[name]?.trim()));
  const selected = new Map();
  for (const item of metadata) {
    if (item.deleted_at != null) continue;
    const label = Array.isArray(item.labels) ? item.labels.find(label => label.name === 'name')?.value : undefined;
    const name = label ?? item.description ?? '';
    if (!wanted.has(name)) continue;
    if (selected.has(name)) throw new Error('Ambiguous active vault name');
    if (typeof item.object_id !== 'string' || !item.object_id || /[\0\r\n]/.test(item.object_id) ||
        item.object_id.trim() !== item.object_id) throw new Error('Invalid vault object reference');
    selected.set(name, item.object_id);
  }
  const missing = profile.requiredEnvironment.filter(name => !env[name]?.trim() && !selected.has(name));
  if (missing.length) {
    const error = new Error('Required provider credentials are missing from vault metadata');
    error.missingRequiredNames = missing;
    throw error;
  }
  return selected.size ? [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([name, id]) => `${name}=${id}`).join('\n') + '\n' : '';
}

export function reviewedCleanup(profile) {
  return (profile.cleanup?.status === 'source-reviewed-sdk-absence' && profile.cleanup.oracle === undefined) ||
    (nativeRules.has(profile.id) &&
      profile.cleanup?.status === 'source-reviewed-native-terminal' &&
      profile.cleanup.oracle === nativeRules.get(profile.id).oracle);
}

export function blockedReason(profile, env) {
  if (profile.readiness !== 'wired') return 'needs-reviewed-live-profile';
  const attemptUnreviewed = env.COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP === 'true' &&
    profile.cleanup?.status === 'needs-review' && profile.cleanup.oracle === undefined;
  if (!reviewedCleanup(profile) && !attemptUnreviewed) {
    return 'needs-reviewed-cleanup-contract';
  }
  const missing = profile.requiredEnvironment.filter(name => !env[name]?.trim());
  return missing.length ? `missing configuration: ${missing.join(', ')}` : null;
}

/** Resolve the actual import export, including AWS subpaths; never guess dist. */
export function providerModule(profile, root = ROOT) {
  const manifest = readJSON(resolve(root, profile.packageDirectory, 'package.json'));
  let target = manifest.exports?.[profile.exportSubpath];
  // Some packages use a direct conditions object for their sole "." export.
  if (!target && profile.exportSubpath === '.' && manifest.exports && !Object.keys(manifest.exports).some(k => k.startsWith('.'))) {
    target = manifest.exports;
  }
  while (target && typeof target === 'object') {
    const active = Object.keys(target).find(key => ['node', 'import', 'default'].includes(key));
    target = active ? target[active] : undefined;
  }
  if (typeof target !== 'string' || !target.startsWith('./') || target.includes('..')) {
    throw new Error('Missing supported provider import export');
  }
  const file = resolve(root, profile.packageDirectory, target);
  if (!existsSync(file)) throw new Error('Provider import artifact is not built');
  return file;
}

/** Working-tree contents, including newly added text files sent by --with-changes. */
export function sourceFingerprint(root = ROOT) {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
    .toString().split('\0').filter(Boolean);
  const inputs = [...new Set(names)].filter(file =>
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(file) ||
    (/^[^/]+\.(?:[cm]?[jt]s|json)$/.test(file) && /(?:config|pnpmfile)/.test(file)) ||
    (/^packages\/[^/]+\/[^/]+\.(?:[cm]?[jt]s|json)$/.test(file) && !/\.bundled[_.]/.test(file)) ||
    (/^packages\/[^/]+\/src\//.test(file) && !/(?:__tests__|fixtures|__mocks__|node_modules|dist)\//.test(file) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) ||
    (/^scripts\//.test(file) && !/(?:__tests__|fixtures)\//.test(file)) ||
    /^conformance\/(?:compute-native\.test\.ts|compute-cleanup-probe\.ts|compute-profiles\.json|providers\.json|vitest\.(?:compute|unit)\.config\.mts|tsconfig\.compute\.json)$/.test(file) ||
    /^\.computesdk\/workflows\/(?:provider-conformance|compute-static)\.yml$/.test(file)
  ).sort().map(file => ({ file, sha256: sha(readFileSync(resolve(root, file))) }));
  return { sha256: sha(JSON.stringify(inputs)), inputs };
}

export function expectedCases(profile, suite = 'shared') {
  if (suite === 'crud') return [
    'should create a sandbox', 'should get sandbox by ID',
    'should list sandboxes and include created one', 'should destroy the sandbox',
    'should report sandbox absence after destruction',
  ];
  const names = [
    'should create a sandbox with valid ID', 'should execute shell commands', 'should get sandbox info',
    'should handle invalid commands gracefully', 'should properly quote arguments with spaces',
    'should properly quote arguments with special characters', 'should handle complex shell commands with pipes',
  ];
  if (profile.suite.supportsBackground) names.push('should execute background commands');
  if (profile.suite.supportsGetUrl) {
    names.push('should get sandbox URL for a port');
    if (profile.suite.ports?.length > 1) names.push('should get sandbox URL with custom protocol');
  }
  if (profile.suite.supportsFilesystem) names.push(
    'should write and read files', 'should check file existence', 'should create directories',
    'should list directory contents', 'should remove files and directories', 'should handle file not found errors',
  );
  if (profile.suite.supportsStreaming) names.push(
    'should deliver output while the command is still running',
    'should stream stderr separately and report a non-zero exit',
    'should stop a streaming command that outruns its timeout',
  );
  if (profile.suite.supportsProcesses) names.push(
    'should write to a process stdin and collect echoed output', 'should kill a running process and report its signal',
  );
  return names;
}

export function acceptedLiveResult(report, status, required = []) {
  return status === 0 && report?.mode === 'native' &&
    Number.isSafeInteger(report.nativePassed) && report.nativePassed > 0 &&
    report.nativeFailed === 0 && report.nativeSkipped === 0 &&
    report.failedFiles === 0 && report.unhandledErrors === 0 &&
    required.every(title => report.cases?.filter(c => c.title === title && c.state === 'pass').length === 1);
}

export function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const value = flag => { const i = rest.indexOf(flag); return i === -1 ? undefined : rest[i + 1]; };
  const profiles = loadProfiles();
  if (command === 'fingerprint') {
    console.log(sourceFingerprint().sha256);
    return 0;
  }
  const selected = selectProfiles(profiles, value('--provider') || process.env.COMPUTE_CONFORMANCE_PROVIDER || '');
  if (command === 'keys' && selected.length === 1) {
    console.log(credentialPattern(selected[0], process.env));
    return 0;
  }
  if (command === 'envdef' && selected.length === 1) {
    process.stdout.write(vaultEnvdef(JSON.parse(readFileSync(0, 'utf8')), selected[0], process.env));
    return 0;
  }
  if (command === 'workflow-plan' && process.env.COMPUTE_CONFORMANCE_WORKFLOW_EXECUTE !== 'true') {
    // Empty include is NOT a supported zero-leg signal on the Actions parser.
    // This nonempty vector is fully excluded before job materialization.
    console.log(JSON.stringify({ plan_only: ['not-executed'], exclude: [{ plan_only: 'not-executed' }] }));
    return 0;
  }
  if (command === 'plan' || command === 'workflow-plan') {
    console.log(JSON.stringify({ include: selected.map(p => ({
      id: p.id, readiness: p.readiness, cleanupReview: p.cleanup.status,
    })) }));
    return 0;
  }
  if (command === 'incomplete' && selected.length === 1) {
    const output = reportPath(selected[0].id);
    const existing = existsSync(output) ? readJSON(output) : {};
    if (!['passed-selected-contracts', 'blocked', 'failed'].includes(existing.outcome)) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify({ provider: selected[0].id, outcome: 'failed',
        reason: 'workflow did not complete; inspect Actions stage status', nativePassed: 0,
        cleanupReview: selected[0].cleanup.status,
        attemptUnreviewedCleanup: process.env.COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP === 'true' }, null, 2) + '\n');
    }
    return 0;
  }
  if (!['prepare', 'vault-check', 'check', 'run'].includes(command) || (command === 'run' && !rest.includes('--execute')) || selected.length !== 1) {
    throw new Error('Select one compute provider; live execution additionally requires run --execute');
  }
  const profile = selected[0];
  const env = process.env;
  const output = reportPath(profile.id);
  mkdirSync(dirname(output), { recursive: true });
  const write = report => writeFileSync(output, JSON.stringify({ ...report,
    cleanupReview: profile.cleanup.status,
    attemptUnreviewedCleanup: env.COMPUTE_CONFORMANCE_ATTEMPT_UNREVIEWED_CLEANUP === 'true',
  }, null, 2) + '\n');
  const suite = env.COMPUTE_CONFORMANCE_SUITE || 'shared';
  // Metadata stages ignore only credential values, never readiness/cleanup gates.
  const gateEnv = ['prepare', 'vault-check'].includes(command) ? {
    ...env, ...Object.fromEntries(profile.requiredEnvironment.map(name => [name, 'metadata-stage-placeholder'])),
  } : env;
  const blocked = blockedReason(profile, gateEnv) || (!['shared', 'crud'].includes(suite) ? 'unknown suite' :
    suite === 'crud' && profile.id !== '@computesdk/isorun' ? 'needs-reviewed-crud-profile' : null);
  if (blocked) {
    write({ provider: profile.id, outcome: 'blocked', reason: blocked, nativePassed: 0 });
    console.error(`BLOCKED: ${blocked}`);
    return 2;
  }
  const fingerprint = sourceFingerprint();
  if (!/^[a-f0-9]{64}$/.test(env.COMPUTE_CONFORMANCE_EXPECTED_SOURCE || '') ||
      env.COMPUTE_CONFORMANCE_EXPECTED_SOURCE !== fingerprint.sha256) {
    write({ provider: profile.id, outcome: 'blocked', reason: 'candidate source fingerprint mismatch', nativePassed: 0 });
    console.error('BLOCKED: candidate source fingerprint mismatch');
    return 2;
  }
  const maxCreates = Number(env.COMPUTE_CONFORMANCE_MAX_CREATES);
  if (!Number.isSafeInteger(maxCreates) || maxCreates <= 0) {
    write({ provider: profile.id, outcome: 'blocked', reason: 'explicit positive SDK create-attempt limit required', nativePassed: 0 });
    return 2;
  }
  if (command === 'vault-check') {
    try {
      // Validate references in memory only; never print or persist the envdef.
      vaultEnvdef(JSON.parse(readFileSync(0, 'utf8')), profile, env);
    } catch (error) {
      const missing = error?.missingRequiredNames;
      const reason = Array.isArray(missing) ? `missing configuration: ${missing.join(', ')}` : 'invalid vault metadata';
      write({ provider: profile.id, outcome: 'blocked', reason, nativePassed: 0 });
      console.error(`BLOCKED: ${reason}`);
      return 2;
    }
    write({ provider: profile.id, outcome: 'prepared-not-executed', sourceFingerprint: fingerprint.sha256,
      vaultMetadata: 'validated', nativePassed: 0 });
    return 0;
  }
  if (command === 'check' || command === 'prepare') {
    write({ provider: profile.id, outcome: 'prepared-not-executed', sourceFingerprint: fingerprint.sha256, nativePassed: 0 });
    return 0;
  }
  const moduleFile = resolve(ROOT, profile.packageDirectory, 'package.json');
  const manifest = readJSON(moduleFile);
  const artifact = providerModule(profile);
  write({ provider: profile.id, outcome: 'running', mode: 'native', nativePassed: 0 });
  const result = spawnSync(process.execPath, [
    resolve(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'conformance/vitest.compute.config.mts',
    '--maxWorkers=1', '--minWorkers=1', '--reporter=default', '--reporter=./scripts/compute-conformance-reporter.mjs',
  ], { cwd: ROOT, stdio: 'inherit', env: {
    ...env, COMPUTESDK_CONFORMANCE_NATIVE: '1', COMPUTE_CONFORMANCE_PROVIDER: profile.id,
    COMPUTE_CONFORMANCE_REPORT: output,
    COMPUTE_CONFORMANCE_SUITE: suite,
  }, timeout: 30 * 60_000 });
  const report = existsSync(output) ? readJSON(output) : {};
  const required = expectedCases(profile, suite);
  const passed = acceptedLiveResult(report, result.status, required);
  write({ ...report, provider: profile.id, outcome: passed ? 'passed-selected-contracts' : 'failed',
    assurance: 'partial; only selected suite contracts, not full provider certification',
    baseRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
    sourceFingerprint: fingerprint.sha256, packageVersion: manifest.version,
    maxSdkCreateAttempts: maxCreates,
    suite, requiredCases: required,
    selectedSuite: profile.suite,
    builtArtifacts: ['packages/computesdk/dist/index.mjs', 'packages/provider/dist/index.mjs',
      relative(ROOT, artifact)].map(file => ({ file, sha256: sha(readFileSync(resolve(ROOT, file))) })),
    installedDependencies: Object.keys(manifest.dependencies || {}).flatMap(name => {
      const file = resolve(ROOT, profile.packageDirectory, 'node_modules', name, 'package.json');
      return existsSync(file) ? [{ name, version: readJSON(file).version, manifestSha256: sha(readFileSync(file)) }] : [];
    }),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    finishedAt: new Date().toISOString(),
  });
  return passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch { console.error('Compute conformance preparation failed; no native success is recorded'); process.exitCode = 1; }
}
