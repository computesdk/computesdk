import { describe, expect, it } from 'vitest';
import { createExitMarker, StderrMarkerFilter } from '../exit-code';

describe('exit marker', () => {
  const marker = createExitMarker('abc123');

  it('wraps the command in a subshell and prints its status behind the marker', () => {
    const wrapped = marker.wrap('exit 3');
    expect(wrapped.startsWith('(\nexit 3\n);')).toBe(true);
    expect(wrapped).toContain("printf '\\n__COMPUTESDK_EXIT_abc123__=%d' \"$__csdk_rc\" 1>&2");
    expect(wrapped.endsWith('exit $__csdk_rc')).toBe(true);
  });

  it('extracts the exit code and removes the marker from stderr', () => {
    expect(marker.extract(`err\n${marker.head.slice(1)}`)).toEqual({ stderr: `err\n${marker.head.slice(1)}`, exitCode: undefined });
    expect(marker.extract(`err\n${marker.head}3`)).toEqual({ stderr: 'err\n', exitCode: 3 });
    expect(marker.extract(`${marker.head}0`)).toEqual({ stderr: '', exitCode: 0 });
    // Output a background child wrote after the marker is kept.
    expect(marker.extract(`a${marker.head}42late`)).toEqual({ stderr: 'alate', exitCode: 42 });
  });

  it('leaves stderr without a marker untouched', () => {
    expect(marker.extract('plain error\n')).toEqual({ stderr: 'plain error\n', exitCode: undefined });
  });

  it('only honors this call\'s marker', () => {
    const other = createExitMarker('zzz');
    expect(marker.extract(`x${other.head}5`)).toEqual({ stderr: `x${other.head}5`, exitCode: undefined });
  });
});

describe('StderrMarkerFilter', () => {
  const marker = createExitMarker('n0nce');
  const full = `err line 1\nerr line 2\n${marker.head}17`;

  it('streams stderr without the marker at every chunk boundary', () => {
    for (let a = 0; a <= full.length; a += 1) {
      for (let b = a; b <= full.length; b += 1) {
        const out: string[] = [];
        const filter = new StderrMarkerFilter(marker.head, (c) => out.push(c));
        filter.push(full.slice(0, a));
        filter.push(full.slice(a, b));
        filter.push(full.slice(b));
        const code = filter.end();
        expect(out.join('')).toBe('err line 1\nerr line 2\n');
        expect(code).toBe(17);
      }
    }
  });

  it('passes through text that only looks like the start of the marker', () => {
    const out: string[] = [];
    const filter = new StderrMarkerFilter(marker.head, (c) => out.push(c));
    filter.push('a\n__COMPUTESDK');
    filter.push('_EXIT_other__=1\n');
    expect(filter.end()).toBeUndefined();
    expect(out.join('')).toBe('a\n__COMPUTESDK_EXIT_other__=1\n');
  });

  it('passes through the marker head when no exit code follows it', () => {
    const out: string[] = [];
    const filter = new StderrMarkerFilter(marker.head, (c) => out.push(c));
    filter.push(`x${marker.head}oops`);
    expect(filter.end()).toBeUndefined();
    expect(out.join('')).toBe(`x${marker.head}oops`);
  });

  it('emits output as it arrives, holding back at most a possible marker prefix', () => {
    const out: string[] = [];
    const filter = new StderrMarkerFilter(marker.head, (c) => out.push(c));
    filter.push('progress 1');
    expect(out.join('')).toBe('progress 1');
    filter.push('\n');
    // A trailing newline could start the marker, so it waits for the next chunk.
    expect(out.join('')).toBe('progress 1');
    filter.push('progress 2');
    expect(out.join('')).toBe('progress 1\nprogress 2');
    filter.end();
  });
});
