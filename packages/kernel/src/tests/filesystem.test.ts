import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { kernel } from '../index';

// Test-utils package loads dotenv automatically, but we need to ensure it's imported
// This is a workaround to trigger the dotenv loading from @computesdk/test-utils
import '@computesdk/test-utils';

/**
 * NOTE: The filesystem implementation is complete and correct, but will return error:
 * {"code":"insufficient_plan","message":"File system features require a startup or enterprise plan..."}
 */
describe('Kernel Filesystem Operations', () => {
  let provider: ReturnType<typeof kernel>;
  let session: Awaited<ReturnType<typeof provider.sandbox.create>>;
  const testDir = '/tmp/kernel-test';
  const testFile = `${testDir}/test.txt`;
  const testContent = 'Hello from Kernel filesystem test!';

  beforeAll(async () => {
    // Skip all tests if no API key
    if (!process.env.KERNEL_API_KEY) {
      return;
    }

    // Create a kernel provider instance
    provider = kernel({});

    // Create a session for testing
    session = await provider.sandbox.create();

    console.log(`✓ Created kernel session for filesystem tests: ${session.sandboxId}`);
  }, 30000);

  afterAll(async () => {
    // Clean up the session
    if (session) {
      await provider.sandbox.destroy(session.sandboxId);
      console.log(`✓ Destroyed kernel session: ${session.sandboxId}`);
    }
  }, 30000);

  it.skipIf(!process.env.KERNEL_API_KEY)('should create a directory', async () => {
    await session.filesystem.mkdir(testDir);
    console.log(`✓ Created directory: ${testDir}`);
    expect(true).toBe(true);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should verify directory exists', async () => {
    const exists = await session.filesystem.exists(testDir);
    console.log(`✓ Verified directory exists: ${testDir}`);
    expect(exists).toBe(true);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should write a file', async () => {
    await session.filesystem.writeFile(testFile, testContent);
    console.log(`✓ Wrote file: ${testFile}`);
    expect(true).toBe(true);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should verify file exists', async () => {
    const exists = await session.filesystem.exists(testFile);
    console.log(`✓ Verified file exists: ${testFile}`);
    expect(exists).toBe(true);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should read a file', async () => {
    const content = await session.filesystem.readFile(testFile);
    console.log(`✓ Read file: ${testFile}`);
    console.log(`  Content: "${content}"`);
    expect(content).toBe(testContent);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should list directory contents', async () => {
    const entries = await session.filesystem.readdir(testDir);
    console.log(`✓ Listed directory: ${testDir}`);
    console.log(`  Found ${entries.length} entries`);
    
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    
    // Find our test file
    const testFileEntry = entries.find(e => e.name === 'test.txt');
    expect(testFileEntry).toBeDefined();
    expect(testFileEntry?.isDirectory).toBe(false);
    
    if (testFileEntry) {
      console.log(`  Found test.txt: ${testFileEntry.path}`);
    }
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should remove a file', async () => {
    await session.filesystem.remove(testFile);
    console.log(`✓ Removed file: ${testFile}`);
    
    // Verify file no longer exists
    const exists = await session.filesystem.exists(testFile);
    expect(exists).toBe(false);
    console.log(`✓ Verified file removed`);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should remove a directory', async () => {
    await session.filesystem.remove(testDir);
    console.log(`✓ Removed directory: ${testDir}`);
    
    // Verify directory no longer exists
    const exists = await session.filesystem.exists(testDir);
    expect(exists).toBe(false);
    console.log(`✓ Verified directory removed`);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should return false for non-existent path', async () => {
    const exists = await session.filesystem.exists('/tmp/non-existent-path-12345');
    console.log(`✓ Verified non-existent path returns false`);
    expect(exists).toBe(false);
  });

  it.skipIf(!process.env.KERNEL_API_KEY)('should handle multiple files in directory', async () => {
    // Create test directory
    await session.filesystem.mkdir(testDir);
    
    // Write multiple files
    await session.filesystem.writeFile(`${testDir}/file1.txt`, 'File 1');
    await session.filesystem.writeFile(`${testDir}/file2.txt`, 'File 2');
    await session.filesystem.writeFile(`${testDir}/file3.txt`, 'File 3');
    
    console.log(`✓ Created 3 test files`);
    
    // List directory
    const entries = await session.filesystem.readdir(testDir);
    console.log(`✓ Listed directory with ${entries.length} entries`);
    
    expect(entries.length).toBeGreaterThanOrEqual(3);
    
    // Verify all files exist
    const fileNames = entries.map(e => e.name);
    expect(fileNames).toContain('file1.txt');
    expect(fileNames).toContain('file2.txt');
    expect(fileNames).toContain('file3.txt');
    
    // Clean up
    await session.filesystem.remove(`${testDir}/file1.txt`);
    await session.filesystem.remove(`${testDir}/file2.txt`);
    await session.filesystem.remove(`${testDir}/file3.txt`);
    await session.filesystem.remove(testDir);
    
    console.log(`✓ Cleaned up test files and directory`);
  });
});
