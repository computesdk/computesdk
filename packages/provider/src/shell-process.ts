// Compatibility exports: the shared runtime ships with computesdk.
export { ShellProcessUnsupportedError, ShellStateNotPersistentError, parseFramedLog, readShellJob, startShellProcess, attachShellProcess, runCommandViaShell, ShellProcessRuntime } from 'computesdk';
export type { CommandRunner, ShellProcessOptions, ShellProcessHandle, ShellLogRecord, ShellJobRead } from 'computesdk';
