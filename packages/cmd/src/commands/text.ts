import type { Command } from '../types.js';

/**
 * Search for pattern in files
 * @example grep('TODO', 'src/*.ts')
 * @example grep('error', undefined, { recursive: true, ignoreCase: true })
 */
export const grep = (pattern: string, file?: string, options?: { recursive?: boolean; ignoreCase?: boolean; lineNumber?: boolean }): Command => {
  const args = ['grep'];
  if (options?.recursive) args.push('-r');
  if (options?.ignoreCase) args.push('-i');
  if (options?.lineNumber) args.push('-n');
  args.push(pattern);
  if (file) args.push(file);
  return args as Command;
};

/**
 * Stream editor for filtering and transforming text
 * @example sed('s/foo/bar/g', 'file.txt')
 * @example sed('s/foo/bar/g', 'file.txt', { inPlace: true })
 */
export const sed = (expression: string, file: string, options?: { inPlace?: boolean }): Command => {
  return options?.inPlace
    ? ['sed', '-i', expression, file]
    : ['sed', expression, file];
};

/**
 * Output first lines of file
 * @example head('file.txt')
 * @example head('file.txt', 20)
 */
export const head = (file: string, lines?: number): Command => {
  return lines ? ['head', '-n', String(lines), file] : ['head', file];
};

/**
 * Output last lines of file
 * @example tail('file.txt')
 * @example tail('file.txt', 20)
 * @example tail('app.log', undefined, { follow: true })
 */
export const tail = (file: string, lines?: number, options?: { follow?: boolean }): Command => {
  const args = ['tail'];
  if (options?.follow) args.push('-f');
  if (lines) args.push('-n', String(lines));
  args.push(file);
  return args as Command;
};

/**
 * Word, line, character count
 * @example wc('file.txt')
 * @example wc('file.txt', { lines: true })
 */
export const wc = (file: string, options?: { lines?: boolean; words?: boolean; chars?: boolean }): Command => {
  const args = ['wc'];
  if (options?.lines) args.push('-l');
  if (options?.words) args.push('-w');
  if (options?.chars) args.push('-c');
  args.push(file);
  return args as Command;
};

/**
 * Sort lines of text
 * @example sort('file.txt')
 * @example sort('file.txt', { reverse: true, numeric: true })
 */
export const sort = (file: string, options?: { reverse?: boolean; numeric?: boolean; unique?: boolean }): Command => {
  const args = ['sort'];
  if (options?.reverse) args.push('-r');
  if (options?.numeric) args.push('-n');
  if (options?.unique) args.push('-u');
  args.push(file);
  return args as Command;
};

/**
 * Report or filter out repeated lines
 * @example uniq('file.txt')
 * @example uniq('file.txt', { count: true })
 */
export const uniq = (file: string, options?: { count?: boolean }): Command => {
  return options?.count ? ['uniq', '-c', file] : ['uniq', file];
};

/**
 * Process JSON with jq
 * @example jq('.name', 'data.json')
 * @example jq('.[] | .id') // for piping
 */
export const jq = (filter: string, file?: string, options?: { raw?: boolean; compact?: boolean }): Command => {
  const args = ['jq'];
  if (options?.raw) args.push('-r');
  if (options?.compact) args.push('-c');
  args.push(filter);
  if (file) args.push(file);
  return args as Command;
};

/**
 * Build and execute commands from stdin
 * @example xargs('rm') // pipe file list to rm
 * @example xargs('grep', ['pattern'], { parallel: 4 })
 */
export const xargs = (command: string, args?: string[], options?: { parallel?: number; nullDelimited?: boolean }): Command => {
  const xargsArgs = ['xargs'];
  if (options?.nullDelimited) xargsArgs.push('-0');
  if (options?.parallel) xargsArgs.push('-P', String(options.parallel));
  xargsArgs.push(command);
  if (args) xargsArgs.push(...args);
  return xargsArgs as Command;
};

/**
 * Pattern scanning and processing
 * @example awk('{print $1}', 'file.txt')
 * @example awk('BEGIN {sum=0} {sum+=$1} END {print sum}', 'numbers.txt')
 */
export const awk = (program: string, file?: string, options?: { fieldSeparator?: string }): Command => {
  const args = ['awk'];
  if (options?.fieldSeparator) args.push('-F', options.fieldSeparator);
  args.push(program);
  if (file) args.push(file);
  return args as Command;
};

/**
 * Extract columns/fields from lines
 * @example cut('file.txt', { fields: '1,3', delimiter: ',' })
 * @example cut('file.txt', { characters: '1-10' })
 */
export const cut = (file: string, options: { fields?: string; delimiter?: string; characters?: string }): Command => {
  const args = ['cut'];
  if (options.delimiter) args.push('-d', options.delimiter);
  if (options.fields) args.push('-f', options.fields);
  if (options.characters) args.push('-c', options.characters);
  args.push(file);
  return args as Command;
};

/**
 * Translate or delete characters
 * @example tr('a-z', 'A-Z') // uppercase
 * @example tr('\n', ' ') // newlines to spaces
 * @example tr('', '', { delete: 'abc' }) // delete chars
 */
export const tr = (set1: string, set2?: string, options?: { delete?: string; squeeze?: boolean }): Command => {
  const args = ['tr'];
  if (options?.delete) {
    args.push('-d', options.delete);
  } else {
    if (options?.squeeze) args.push('-s');
    args.push(set1);
    if (set2) args.push(set2);
  }
  return args as Command;
};
