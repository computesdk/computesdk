import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebContainer } from '../webcontainer-polyfill';
import WebSocket from 'ws';

describe('WebContainer Polyfill', () => {
  let wc: WebContainer;
  const testApiUrl = process.env.TEST_SANDBOX_URL || 'http://localhost:3000';

  beforeAll(async () => {
    // Boot WebContainer for all tests
    wc = await WebContainer.boot({
      apiUrl: testApiUrl,
      createSandbox: false, // Use existing sandbox
      WebSocket: WebSocket as any,
    });
  });

  afterAll(async () => {
    // Teardown after all tests
    if (wc) {
      await wc.teardown();
    }
  });

  describe('Terminal Operations', () => {
    it('should execute echo command and capture output', async () => {
      const process = await wc.spawn('echo', ['Hello WebContainer!']);

      let output = '';
      const reader = process.output.getReader();

      // Read output for 2 seconds
      const timeout = setTimeout(() => reader.cancel(), 2000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output += value;
        }
      } finally {
        clearTimeout(timeout);
      }

      expect(output).toContain('Hello WebContainer');
    }, 10000);

    it('should execute node inline code and capture output', async () => {
      const process = await wc.spawn('node', ['-e', 'console.log("Node works!")']);

      let output = '';
      const reader = process.output.getReader();

      const timeout = setTimeout(() => reader.cancel(), 2000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output += value;
        }
      } finally {
        clearTimeout(timeout);
      }

      expect(output).toContain('works');
    }, 10000);
  });

  describe('File System Operations', () => {
    it('should list directory contents', async () => {
      const files = await wc.fs.readdir('.');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    });

    it('should write and read a file', async () => {
      const testContent = 'Hello from test!';
      const testPath = 'test-file.txt';

      // Write file
      await wc.fs.writeFile(testPath, testContent);

      // Read it back
      const content = await wc.fs.readFile(testPath, 'utf-8');
      expect(content).toBe(testContent);

      // Clean up
      await wc.fs.rm(testPath);
    });

    it('should list directory with file types', async () => {
      const entries = await wc.fs.readdir('.', { withFileTypes: true });
      expect(Array.isArray(entries)).toBe(true);

      if (entries.length > 0) {
        const firstEntry = entries[0] as any;
        expect(typeof firstEntry.name).toBe('string');
        expect(typeof firstEntry.isDirectory).toBe('function');
        expect(typeof firstEntry.isFile).toBe('function');
      }
    });
  });
});
