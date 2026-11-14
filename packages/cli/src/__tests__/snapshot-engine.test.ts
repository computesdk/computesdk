import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENGINE_FILE } from '../snapshot-engine.js';

describe('shared platform checkpoint engine', () => {
  it('ships the exact reviewed upstream module with a pinned revision and digest', () => {
    const provenance = JSON.parse(readFileSync(fileURLToPath(new URL('../../checkpoint-provenance.json', import.meta.url)), 'utf8'));
    expect(provenance.repository).toBe('https://github.com/computesdk/benchmarks-platform');
    expect(provenance.path).toBe('lib/sandboxes/snapshot-oci-module.cjs');
    expect(provenance.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(createHash('sha256').update(readFileSync(ENGINE_FILE)).digest('hex')).toBe(provenance.sha256);
  });
  it('isolates predictable upstream temporary files in a private operation directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'compute-runner-test-'));
    try {
      const engine = join(root, 'probe.cjs'), payload = join(root, 'args.json');
      writeFileSync(payload, '{}');
      writeFileSync(engine, `const fs=require('node:fs'),p=require('node:path'),dir=require('node:os').tmpdir();
        const file=p.join(dir,'checkpoint-layer-'+process.pid+'.tar');fs.writeFileSync(file,'private');
        console.log(JSON.stringify({dir,directoryMode:fs.statSync(dir).mode&511,fileMode:fs.statSync(file).mode&511}));`);
      const runner = fileURLToPath(new URL('../../checkpoint-runner.cjs', import.meta.url));
      const result = JSON.parse(execFileSync(process.execPath, [runner, engine, 'capture', payload], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmpdir() } }));
      expect(result.dir.startsWith(join(root, 'engine-'))).toBe(true);
      expect(result.directoryMode).toBe(0o700);
      expect(result.fileMode).toBe(0o600);
      expect(existsSync(result.dir)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
