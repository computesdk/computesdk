import { describe, it, expect } from 'vitest';
import { tomlProjectValue, withBadge, withNpmProof, withPypiProof } from '../project.js';

const TOKEN = 'rgstr_abcdefghijklmnopqrst';
const PY_LINE = `rgstr = "https://rgstr.org/registry/tsc-rs?proof=${TOKEN}"`;

describe('publish-proof placements', () => {
  it('package.json: adds the rgstr field keeping indentation and is idempotent', () => {
    const src = '{\n    "name": "tsc-rs",\n    "version": "0.7.0"\n}\n';
    const { next, changed } = withNpmProof(src, TOKEN);
    expect(changed).toBe(true);
    expect(next).toBe(`{\n    "name": "tsc-rs",\n    "version": "0.7.0",\n    "rgstr": "${TOKEN}"\n}\n`);
    expect(withNpmProof(next, TOKEN).changed).toBe(false);
  });

  it('pyproject: appends to an existing [project.urls] table', () => {
    const src = '[project]\nname = "tsc-rs"\n\n[project.urls]\nHomepage = "https://x"\n\n[tool.x]\ny = 1\n';
    const { next } = withPypiProof(src, PY_LINE);
    expect(next).toBe(`[project]\nname = "tsc-rs"\n\n[project.urls]\nHomepage = "https://x"\n${PY_LINE}\n\n[tool.x]\ny = 1\n`);
    expect(withPypiProof(next, PY_LINE).changed).toBe(false);
  });

  it('pyproject: creates [project.urls] when missing and replaces a stale rgstr line', () => {
    const { next } = withPypiProof('[project]\nname = "tsc-rs"\n', PY_LINE);
    expect(next).toBe(`[project]\nname = "tsc-rs"\n\n[project.urls]\n${PY_LINE}\n`);
    const stale = `[project.urls]\nrgstr = "old"\n`;
    expect(withPypiProof(stale, PY_LINE).next).toBe(`[project.urls]\n${PY_LINE}\n`);
  });

  it('README: badge goes under the first heading, once', () => {
    const badge = '[![rgstr](https://rgstr.org/registry/tsc-rs/badge.svg?proof=t)](https://rgstr.org/registry/tsc-rs)';
    const { next } = withBadge('# tsc-rs\n\nA compiler.\n', badge);
    expect(next).toBe(`# tsc-rs\n\n${badge}\n\nA compiler.\n`);
    expect(withBadge(next, badge).changed).toBe(false);
    expect(withBadge(null, badge).next).toBe(`${badge}\n`);
  });

  it('reads [project] name from pyproject', () => {
    expect(tomlProjectValue('[build-system]\nname = "no"\n[project]\nname = "tsc-rs"\nversion = "1.0"\n', 'name')).toBe('tsc-rs');
    expect(tomlProjectValue('[tool.poetry]\nname = "x"\n', 'name')).toBeNull();
  });
});
