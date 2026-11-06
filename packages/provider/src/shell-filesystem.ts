/**
 * Filesystem fallback built on the provider's plain `runCommand`, for
 * providers with no native file API. Every operation is one single-line
 * POSIX `sh` command; file bytes and names cross the exec boundary as
 * base64 so binary content, newlines and odd filenames survive.
 */
import { randomBytes } from 'node:crypto';
import type { FileEntry, InstanceFileSystem } from 'computesdk';
import type { CommandRunner } from './shell-process';
import { shQuote } from './shell-scripts';

/** base64 characters sent per write exec, well under common ARG_MAX limits. */
const WRITE_CHUNK_CHARS = 48 * 1024;

const NOT_FOUND_EXIT = 44;

function decode(stdout: string): string {
  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64').toString('utf8');
}

export class ShellFileSystem implements InstanceFileSystem {
  constructor(private readonly run: CommandRunner) {}

  private async exec(command: string, what: string, path: string): Promise<string> {
    const result = await this.run(command);
    if (result.exitCode === NOT_FOUND_EXIT) {
      throw new Error(`ENOENT: no such file or directory, ${what} '${path}'`);
    }
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new Error(`${what} '${path}' failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
    }
    return result.stdout;
  }

  async readFile(path: string): Promise<string> {
    const p = shQuote(path);
    return decode(await this.exec(`[ -f ${p} ] || exit ${NOT_FOUND_EXIT}; base64 < ${p}`, 'open', path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const p = shQuote(path);
    const tmp = shQuote(`${path}.computesdk-${randomBytes(6).toString('hex')}`);
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += WRITE_CHUNK_CHARS) chunks.push(encoded.slice(i, i + WRITE_CHUNK_CHARS));

    const mkParent = `d=$(dirname ${p}) && mkdir -p "$d"`;
    try {
      if (chunks.length <= 1) {
        await this.exec(`${mkParent} && printf '%s' '${chunks[0] ?? ''}' | base64 -d > ${tmp} && mv -f ${tmp} ${p}`, 'write', path);
        return;
      }
      await this.exec(`${mkParent} && printf '%s' '${chunks[0]}' | base64 -d > ${tmp}`, 'write', path);
      for (const chunk of chunks.slice(1)) {
        await this.exec(`printf '%s' '${chunk}' | base64 -d >> ${tmp}`, 'write', path);
      }
      await this.exec(`mv -f ${tmp} ${p}`, 'write', path);
    } catch (err) {
      await this.run(`rm -f ${tmp}`).catch(() => {});
      throw err;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.exec(`mkdir -p ${shQuote(path)}`, 'mkdir', path);
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const p = shQuote(path);
    const script =
      `[ -d ${p} ] || exit ${NOT_FOUND_EXIT}; ( cd ${p} && for f in * .[!.]* ..?*; do ` +
      `[ -e "$f" ] || [ -L "$f" ] || continue; ` +
      `if [ -d "$f" ]; then t=d; s=0; else t=f; s=$(wc -c < "$f" 2>/dev/null | tr -d ' '); fi; ` +
      `m=$(date -r "$f" +%s 2>/dev/null); ` +
      `printf '%s\\t%s\\t%s\\t%s\\n' "$t" "\${s:-0}" "$m" "$(printf '%s' "$f" | base64 | tr -d '\\n')"; ` +
      `done )`;
    const stdout = await this.exec(script, 'scandir', path);
    const entries: FileEntry[] = [];
    for (const line of stdout.split('\n')) {
      const [type, size, mtime, name] = line.trim().split('\t');
      if (!name) continue;
      entries.push({
        name: decode(name),
        type: type === 'd' ? 'directory' : 'file',
        size: Number(size) || 0,
        ...(mtime ? { modified: new Date(Number(mtime) * 1000) } : {}),
      });
    }
    return entries;
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.run(`if [ -e ${shQuote(path)} ]; then echo yes; else echo no; fi`);
    if (result.exitCode !== 0) {
      throw new Error(`exists '${path}' failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout.trim() === 'yes';
  }

  async remove(path: string): Promise<void> {
    await this.exec(`rm -rf ${shQuote(path)}`, 'remove', path);
  }
}
