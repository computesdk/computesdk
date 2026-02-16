import { describe, it, expect } from 'vitest';
import { encodeFilePath } from './index';

describe('encodeFilePath', () => {
  describe('absolute paths', () => {
    it('preserves leading slash for absolute paths', () => {
      expect(encodeFilePath('/tmp/foo.txt')).toBe('/tmp/foo.txt');
    });

    it('preserves leading slash for root path', () => {
      expect(encodeFilePath('/')).toBe('/');
    });

    it('preserves leading slash for deeply nested paths', () => {
      expect(encodeFilePath('/home/user/project/src/file.ts')).toBe('/home/user/project/src/file.ts');
    });

    it('handles paths with only leading slash', () => {
      expect(encodeFilePath('/file.txt')).toBe('/file.txt');
    });
  });

  describe('relative paths', () => {
    it('does not add leading slash to relative paths', () => {
      expect(encodeFilePath('relative/path')).toBe('relative/path');
    });

    it('handles single segment relative paths', () => {
      expect(encodeFilePath('file.txt')).toBe('file.txt');
    });

    it('handles deeply nested relative paths', () => {
      expect(encodeFilePath('src/components/Button/index.tsx')).toBe('src/components/Button/index.tsx');
    });
  });

  describe('URL encoding', () => {
    it('encodes spaces in path segments', () => {
      expect(encodeFilePath('/path with spaces/file.txt')).toBe('/path%20with%20spaces/file.txt');
    });

    it('encodes special characters', () => {
      expect(encodeFilePath('/path/file#name.txt')).toBe('/path/file%23name.txt');
    });

    it('encodes question marks', () => {
      expect(encodeFilePath('/path/file?query.txt')).toBe('/path/file%3Fquery.txt');
    });

    it('encodes percent signs', () => {
      expect(encodeFilePath('/path/100%.txt')).toBe('/path/100%25.txt');
    });

    it('encodes unicode characters', () => {
      const encoded = encodeFilePath('/tmp/file-\u4e2d\u6587.txt');
      expect(encoded).toBe('/tmp/file-%E4%B8%AD%E6%96%87.txt');
    });

    it('preserves already safe characters', () => {
      expect(encodeFilePath('/tmp/file-name_123.txt')).toBe('/tmp/file-name_123.txt');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(encodeFilePath('')).toBe('');
    });

    it('normalizes multiple consecutive slashes', () => {
      // Multiple slashes become single slash due to filter
      expect(encodeFilePath('//tmp//foo.txt')).toBe('/tmp/foo.txt');
    });

    it('handles trailing slashes', () => {
      // Trailing slash is removed by filter
      expect(encodeFilePath('/tmp/dir/')).toBe('/tmp/dir');
    });

    it('handles paths with dots', () => {
      expect(encodeFilePath('/tmp/../file.txt')).toBe('/tmp/../file.txt');
      expect(encodeFilePath('/tmp/./file.txt')).toBe('/tmp/./file.txt');
    });
  });

  describe('URL construction', () => {
    it('produces correct URL for readFile with absolute path', () => {
      const path = '/tmp/repro-123.txt';
      const encoded = encodeFilePath(path);
      const url = `/files/${encoded}?content=true`;
      // URL should be /files//tmp/repro-123.txt?content=true (double slash is correct)
      expect(url).toBe('/files//tmp/repro-123.txt?content=true');
    });

    it('produces correct URL for readFile with relative path', () => {
      const path = 'home/user/file.txt';
      const encoded = encodeFilePath(path);
      const url = `/files/${encoded}?content=true`;
      expect(url).toBe('/files/home/user/file.txt?content=true');
    });
  });
});
