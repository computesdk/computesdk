import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
});
