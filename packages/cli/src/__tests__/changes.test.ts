import { describe, it, expect } from 'vitest';
import { currentBranch, dispatchBody, hasLocalChanges, localChangesPatch, type GitRunner } from '../actions.js';

const ci = {
  id: 'w-1', name: 'CI', path: '.github/workflows/ci.yml', dispatchable: true, refs: ['refs/heads/main'],
} as unknown as Parameters<typeof dispatchBody>[0];

function fakeGit(responses: Record<string, { status?: number; stdout?: string; stderr?: string }>): GitRunner {
  return (args) => {
    const key = args.join(' ');
    const match = Object.keys(responses).find((k) => key.startsWith(k));
    const r = match ? responses[match] : { status: 1 };
    return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

describe('dispatchBody with changes', () => {
  it('carries the uploaded patch id', () => {
    expect(dispatchBody(ci, { patchId: 'p-1' })).toMatchObject({ workflowId: 'w-1', ref: 'refs/heads/main', patchId: 'p-1' });
    expect(dispatchBody(ci, {})).not.toHaveProperty('patchId');
  });
});

describe('currentBranch / hasLocalChanges', () => {
  it('reads the branch and treats detached HEAD or no repo as null', () => {
    expect(currentBranch(fakeGit({ 'rev-parse --abbrev-ref HEAD': { stdout: 'feature\n' } }))).toBe('feature');
    expect(currentBranch(fakeGit({ 'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' } }))).toBeNull();
    expect(currentBranch(fakeGit({}))).toBeNull();
  });

  it('reports dirty trees only', () => {
    expect(hasLocalChanges(fakeGit({ 'status --porcelain': { stdout: ' M a.ts\n' } }))).toBe(true);
    expect(hasLocalChanges(fakeGit({ 'status --porcelain': { stdout: '' } }))).toBe(false);
    expect(hasLocalChanges(fakeGit({}))).toBe(false);
  });
});

describe('localChangesPatch', () => {
  const tracked = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n';
  const untracked = 'diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+z\n';

  it('diffs against origin/<branch> and appends untracked files', () => {
    const git = fakeGit({
      'rev-parse --verify --quiet origin/feature^{commit}': { stdout: 'abc\n' },
      'diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ origin/feature --': { stdout: tracked },
      'ls-files --others --exclude-standard -z': { stdout: 'new.ts\0' },
      'diff --no-color --no-ext-diff --no-index': { status: 1, stdout: untracked },
    });
    const result = localChangesPatch('refs/heads/feature', git);
    expect(result).not.toBeNull();
    expect(result?.base).toBe('origin/feature');
    expect(result?.files).toBe(2);
    expect(result?.patch).toBe(tracked + untracked);
  });

  it('returns null when there is nothing beyond the remote', () => {
    const git = fakeGit({
      'rev-parse --verify --quiet origin/main^{commit}': { stdout: 'abc\n' },
      'diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ origin/main --': { stdout: '' },
      'ls-files --others --exclude-standard -z': { stdout: '' },
    });
    expect(localChangesPatch('main', git)).toBeNull();
  });

  it('refuses a branch that is not on origin and binary content', () => {
    expect(() => localChangesPatch('nowhere', fakeGit({}))).toThrow('origin/nowhere');
    const git = fakeGit({
      'rev-parse --verify --quiet origin/main^{commit}': { stdout: 'abc\n' },
      'diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ origin/main --': { stdout: 'diff --git a/b b/b\n+++ b/b\n\0' },
      'ls-files --others --exclude-standard -z': { stdout: '' },
    });
    expect(() => localChangesPatch('main', git)).toThrow('binary');
  });
});
