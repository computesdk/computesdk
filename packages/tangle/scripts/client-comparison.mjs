// Recompute an alternating, fresh-process ruler comparison from retained evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function compare(directory) {
  const json = async (path) => JSON.parse(await readFile(join(directory, path), 'utf8'));
  const manifest = await json('manifest.json');
  assert.equal(manifest.runs.length, 18, 'requires nine runs per arm');
  const arms = { A: [], B: [] };
  for (let index = 0; index < manifest.runs.length; index++) {
    const run = manifest.runs[index];
    assert.equal(run.arm, index % 2 === 0 ? 'A' : 'B', 'runs must alternate A/B');
    const score = await json(`${run.directory}/score.json`);
    const mock = await json(`${run.directory}/mock.json`);
    const raw = await json(`${run.directory}/raw.json`);
    assert.equal(score.mode, 'dry-run');
    assert.equal(score.samples, 100);
    assert.equal(score.success, 100);
    assert.equal(raw.results.length, 1);
    assert.equal(raw.results[0].iterations.length, 100);
    assert.ok(raw.results[0].iterations.every((sample) => !sample.error && Number.isFinite(sample.ttiMs)));
    const times = raw.results[0].iterations.map((sample) => sample.ttiMs).sort((a, b) => a - b);
    // Independent check against the pinned board's 5% trim and nearest-rank tails.
    assert.equal(score.p50, (times[49] + times[50]) / 2);
    assert.equal(score.p91, times[90]);
    assert.equal(score.p95, times[94]);
    assert.deepEqual(mock, { creates: 100, commands: 100, deletes: 100, unexpected: [], remaining: 0 });
    assert.equal(run.installedSha256, manifest.arms[run.arm].distSha256, 'the installed arm must match its tarball');
    assert.ok(Number.isFinite(score.W));
    assert.ok(Math.abs(score.W - (0.6 * score.p50 + 0.25 * score.p91 + 0.15 * score.p95)) < 1e-9);
    arms[run.arm].push(score.W);
  }
  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    // R-7 quartiles: with n=9 the 25th and 75th percentiles are order stats 3 and 7.
    return { values, median: sorted[4], q1: sorted[2], q3: sorted[6], iqr: sorted[6] - sorted[2] };
  };
  const result = {
    scope: 'client-only; pinned 100-concurrent create+first-command ruler; fresh process per run',
    quartiles: 'R-7 linear interpolation',
    arms: { A: summarize(arms.A), B: summarize(arms.B) },
    success: 1800, unexpected: 0, targetMs: 60, passed: summarize(arms.B).median <= 60,
    manifest,
  };
  await writeFile(join(directory, 'comparison.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  return result;
}
