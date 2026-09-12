import { describe, expect, it } from 'vitest';
import { BackendQueue } from '../backend-queue.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let current = 'original';
  const scopes: string[] = [];
  const queue = new BackendQueue<string, () => string>(
    (a, b) => a === b,
    async (selection, run) => {
      const previous = current;
      scopes.push(selection);
      current = selection;
      try { await run(() => current); } finally { current = previous; }
    },
  );
  return { queue, scopes, current: () => current };
}

describe('backend scope queue', () => {
  it('overlaps identical credentials without allowing another credential to change the scope', async () => {
    const { queue, scopes, current } = fixture();
    const release = deferred();
    const bothStarted = deferred();
    let active = 0;
    const same = () => queue.run('cloud-key-a', async (backend) => {
      if (++active === 2) bothStarted.resolve();
      expect(backend()).toBe('cloud-key-a');
      await release.promise;
      expect(backend()).toBe('cloud-key-a');
    });
    const first = same();
    const second = same();
    const other = queue.run('cloud-key-b', async (backend) => expect(backend()).toBe('cloud-key-b'));
    await bothStarted.promise;
    expect(scopes).toEqual(['cloud-key-a']);
    release.resolve();
    await Promise.all([first, second, other]);
    expect(scopes).toEqual(['cloud-key-a', 'cloud-key-b']);
    expect(current()).toBe('original');
  });

  it('does not let later matching credentials starve a waiting different backend', async () => {
    const { queue, scopes } = fixture();
    const release = deferred();
    const first = queue.run('a', () => release.promise);
    const second = queue.run('b', async () => {});
    const third = queue.run('a', async () => {});
    release.resolve();
    await Promise.all([first, second, third]);
    expect(scopes).toEqual(['a', 'b', 'a']);
  });

  it('returns completed operations while slower operations still hold the shared scope', async () => {
    const { queue, current } = fixture();
    const release = deferred();
    const slow = queue.run('a', () => release.promise);
    await queue.run('a', async () => 'fast');
    expect(current()).toBe('a');
    release.resolve();
    await slow;
    expect(current()).toBe('original');
  });

  it('contains operation failures and restores the backend before the next batch', async () => {
    const { queue, current } = fixture();
    const failed = queue.run('a', () => { throw new Error('create failed'); });
    const rejected = expect(failed).rejects.toThrow('create failed');
    const next = queue.run('b', async (backend) => expect(backend()).toBe('b'));
    await Promise.all([rejected, next]);
    expect(current()).toBe('original');
  });

  it('rejects a failed scope and continues draining subsequent selections', async () => {
    const queue = new BackendQueue<string, string>((a, b) => a === b, async (selection, run) => {
      if (selection === 'invalid') throw new Error('invalid backend');
      await run(selection);
    });
    const failed = queue.run('invalid', async () => 'unreachable');
    const rejected = expect(failed).rejects.toThrow('invalid backend');
    const next = queue.run('valid', async (backend) => backend);
    await rejected;
    expect(await next).toBe('valid');
  });
  it('propagates restoration failure instead of reporting a successful final operation', async () => {
    const queue = new BackendQueue<string, string>((a, b) => a === b, async (selection, run) => {
      await run(selection);
      throw new Error('restore failed');
    });
    await expect(queue.run('a', async () => 'created')).rejects.toThrow('restore failed');
  });

});
