import type { Command } from '../types.js';

/**
 * Print environment variable
 * @example echo('$HOME')
 * @example echo('Hello World')
 */
export const echo = (text: string): Command => ['echo', text];

/**
 * Print environment variables
 * @example env()
 */
export const env = (): Command => ['env'];

/**
 * Print specific environment variable
 * @example printenv('PATH')
 * @example printenv() // prints all
 */
export const printenv = (name?: string): Command => {
  return name ? ['printenv', name] : ['printenv'];
};

/**
 * Which command location
 * @example which('node')
 */
export const which = (command: string): Command => ['which', command];

/**
 * Print current user
 * @example whoami()
 */
export const whoami = (): Command => ['whoami'];

/**
 * Print system information
 * @example uname()
 * @example uname({ all: true })
 */
export const uname = (options?: { all?: boolean }): Command => {
  return options?.all ? ['uname', '-a'] : ['uname'];
};

/**
 * Print hostname
 * @example hostname()
 */
export const hostname = (): Command => ['hostname'];

/**
 * Report disk space usage
 * @example df()
 * @example df('/app')
 */
export const df = (path?: string, options?: { human?: boolean }): Command => {
  const args = ['df'];
  if (options?.human) args.push('-h');
  if (path) args.push(path);
  return args as Command;
};

/**
 * Estimate file/directory space usage
 * @example du('/app')
 * @example du('/app', { human: true, summarize: true })
 */
export const du = (path: string, options?: { human?: boolean; summarize?: boolean }): Command => {
  const args = ['du'];
  if (options?.human) args.push('-h');
  if (options?.summarize) args.push('-s');
  args.push(path);
  return args as Command;
};

/**
 * Delay for specified seconds
 * @example sleep(5)
 */
export const sleep = (seconds: number): Command => ['sleep', String(seconds)];

/**
 * Print date/time
 * @example date()
 * @example date('+%Y-%m-%d')
 */
export const date = (format?: string): Command => {
  return format ? ['date', format] : ['date'];
};

/**
 * Find files
 * @example find('/app', { name: '*.ts' })
 * @example find('/app', { type: 'f', name: '*.js' })
 */
export const find = (path: string, options?: { name?: string; type?: 'f' | 'd' }): Command => {
  const args = ['find', path];
  if (options?.type) args.push('-type', options.type);
  if (options?.name) args.push('-name', options.name);
  return args as Command;
};

/**
 * Write to file and stdout
 * @example tee('/app/output.log')
 * @example tee('/app/output.log', { append: true })
 */
export const tee = (file: string, options?: { append?: boolean }): Command => {
  return options?.append ? ['tee', '-a', file] : ['tee', file];
};

/**
 * Compare files
 * @example diff('file1.txt', 'file2.txt')
 * @example diff('file1.txt', 'file2.txt', { unified: true })
 */
export const diff = (file1: string, file2: string, options?: { unified?: boolean; brief?: boolean }): Command => {
  const args = ['diff'];
  if (options?.unified) args.push('-u');
  if (options?.brief) args.push('-q');
  args.push(file1, file2);
  return args as Command;
};

/**
 * Run multiple commands in parallel
 * @example parallel(['npm run dev', 'npm run watch'])
 */
export const parallel = (commands: string[], options?: { killOthers?: boolean }): Command => {
  const joined = commands.join(' & ');
  if (options?.killOthers) {
    // trap EXIT to kill all background jobs when any exits
    return ['sh', '-c', `trap "kill 0" EXIT; ${joined} & wait`];
  }
  return ['sh', '-c', `${joined} & wait`];
};

/**
 * Build a custom command from parts
 * @example raw('my-cli', ['--flag', 'value'])
 */
export const raw = (command: string, args?: string[]): Command => {
  return args ? [command, ...args] : [command];
};

/**
 * Base64 encoding/decoding utilities
 */
export const base64 = {
  /**
   * Encode to base64
   * @example base64.encode('file.txt')
   */
  encode: (file?: string): Command => {
    return file ? ['base64', file] : ['base64'];
  },

  /**
   * Decode from base64
   * @example base64.decode('encoded.txt')
   */
  decode: (file?: string): Command => {
    return file ? ['base64', '-d', file] : ['base64', '-d'];
  },
};

/**
 * Compute MD5 checksum
 * @example md5sum('file.txt')
 * @example md5sum('file.txt', { check: true })
 */
export const md5sum = (file: string, options?: { check?: boolean }): Command => {
  return options?.check ? ['md5sum', '-c', file] : ['md5sum', file];
};

/**
 * Compute SHA256 checksum
 * @example sha256sum('file.txt')
 * @example sha256sum('file.txt', { check: true })
 */
export const sha256sum = (file: string, options?: { check?: boolean }): Command => {
  return options?.check ? ['sha256sum', '-c', file] : ['sha256sum', file];
};

/**
 * Compute SHA1 checksum
 * @example sha1sum('file.txt')
 */
export const sha1sum = (file: string, options?: { check?: boolean }): Command => {
  return options?.check ? ['sha1sum', '-c', file] : ['sha1sum', file];
};
