/**
 * Files - Resource namespace for file operations
 */

import type {
  FilesListResponse,
  FileResponse,
  BatchWriteResponse,
  FileInfo,
  BatchWriteResult,
  BatchFileOperation,
} from '../index';

/**
 * Files resource namespace
 *
 * @example
 * ```typescript
 * // Create a file
 * const file = await sandbox.files.create('/project/hello.txt', 'Hello, World!');
 *
 * // List files in a directory
 * const files = await sandbox.files.list('/project');
 *
 * // Retrieve file content
 * const content = await sandbox.files.retrieve('/project/hello.txt');
 *
 * // Destroy (delete) a file
 * await sandbox.files.destroy('/project/hello.txt');
 *
 * // Batch write multiple files
 * const results = await sandbox.files.batchWrite([
 *   { path: '/project/a.txt', operation: 'write', content: 'A' },
 *   { path: '/project/b.txt', operation: 'write', content: 'B' },
 * ]);
 *
 * // Batch delete files
 * const results = await sandbox.files.batchWrite([
 *   { path: '/project/old.txt', operation: 'delete' },
 * ]);
 * ```
 */
export class Files {
  private createHandler: (path: string, content?: string) => Promise<FileResponse>;
  private listHandler: (path: string) => Promise<FilesListResponse>;
  private retrieveHandler: (path: string) => Promise<string>;
  private destroyHandler: (path: string) => Promise<void>;
  private batchWriteHandler: (
    files: Array<{ path: string; operation: BatchFileOperation; content?: string }>
  ) => Promise<BatchWriteResponse>;
  private existsHandler: (path: string) => Promise<boolean>;

  constructor(handlers: {
    create: (path: string, content?: string) => Promise<FileResponse>;
    list: (path: string) => Promise<FilesListResponse>;
    retrieve: (path: string) => Promise<string>;
    destroy: (path: string) => Promise<void>;
    batchWrite: (
      files: Array<{ path: string; operation: BatchFileOperation; content?: string }>
    ) => Promise<BatchWriteResponse>;
    exists: (path: string) => Promise<boolean>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.destroyHandler = handlers.destroy;
    this.batchWriteHandler = handlers.batchWrite;
    this.existsHandler = handlers.exists;
  }

  /**
   * Create a new file with optional content
   * @param path - File path
   * @param content - File content (optional)
   * @returns File info
   */
  async create(path: string, content?: string): Promise<FileInfo> {
    const response = await this.createHandler(path, content);
    return response.data.file;
  }

  /**
   * List files at the specified path
   * @param path - Directory path (default: '/')
   * @returns Array of file info
   */
  async list(path: string = '/'): Promise<FileInfo[]> {
    const response = await this.listHandler(path);
    return response.data.files;
  }

  /**
   * Retrieve file content
   * @param path - File path
   * @returns File content as string
   */
  async retrieve(path: string): Promise<string> {
    return this.retrieveHandler(path);
  }

  /**
   * Destroy (delete) a file or directory
   * @param path - File or directory path
   */
  async destroy(path: string): Promise<void> {
    return this.destroyHandler(path);
  }

  /**
   * Batch file operations (write or delete multiple files)
   *
   * Features:
   * - Deduplication: Last operation wins per path
   * - File locking: Prevents race conditions
   * - Deterministic ordering: Alphabetical path sorting
   * - Partial failure handling: Returns per-file results
   *
   * @param files - Array of file operations
   * @returns Results for each file operation
   */
  async batchWrite(
    files: Array<{ path: string; operation: BatchFileOperation; content?: string }>
  ): Promise<BatchWriteResult[]> {
    const response = await this.batchWriteHandler(files);
    return response.data.results;
  }

  /**
   * Check if a file exists
   * @param path - File path
   * @returns True if file exists
   */
  async exists(path: string): Promise<boolean> {
    return this.existsHandler(path);
  }
}
