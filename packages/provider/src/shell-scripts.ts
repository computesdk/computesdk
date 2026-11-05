/**
 * POSIX-shell programs behind the shell process tier.
 *
 * A job is a directory under `${TMPDIR:-/tmp}/.computesdk/jobs/<jobId>` that a
 * detached supervisor keeps writing to after the client that started it is
 * gone. Every client operation is one plain `runCommand` exec of one of the
 * programs below, so the tier needs nothing in the box beyond a POSIX shell and
 * a handful of base utilities — no Node, no daemon, no download.
 *
 * Record layout (all inside the job directory, mode 0700):
 *   run.sh    the caller's command, prefixed with its env exports and `cd`
 *   conf      timeout / stdin / retention settings read by the supervisor
 *   out.log   framed output: records `O<len>\n<len bytes>` (stdout) and
 *             `E<len>\n<len bytes>` (stderr), appended in arrival order; a
 *             record's position in the file is its absolute byte offset
 *   pid       process-group id of the command (`setsid` makes it a leader)
 *   in        stdin FIFO, kept open by a holder process whose pid is `holder`
 *   signal    the signal a `kill` sent; `timedout` marks an in-box deadline
 *   exit      the command's exit status, written only after out.log is final
 */

/** Tools every shell-tier program needs; probed at launch. */
export const SHELL_TIER_TOOLS = [
  'mkfifo', 'setsid', 'kill', 'cat', 'dd', 'wc', 'tail', 'head', 'base64',
  'mkdir', 'rm', 'mv', 'sleep',
] as const;

/** First line of every program's reply; everything before it is ignored. */
export const REPLY_MARKER = '@@computesdk-job';
export const REPLY_END = '@@computesdk-job-end';

/** Raw log bytes returned per read: about 22 KB once base64'd, under SSM's 24,000-char stdout cap. */
export const DEFAULT_READ_BYTES = 16 * 1024;
/** Upper bound for one long-poll exec, kept below typical per-exec provider timeouts. */
export const MAX_LONG_POLL_MS = 25_000;
/** Job directories are removed this long after the command exits. */
export const DEFAULT_RETENTION_MS = 10 * 60_000;
/** Shorter retention once a job has been killed. */
export const KILLED_RETENTION_MS = 60_000;

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SIGNAL_PATTERN = /^[A-Z0-9]{1,16}$/;

/** Single-quotes a value for POSIX sh. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function assertJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error(`shell-process: invalid job id ${JSON.stringify(jobId)}`);
}

/** Normalizes `SIGTERM`/`TERM`/`term` to `TERM`; rejects anything else. */
export function normalizeSignal(signal: string): string {
  const name = signal.toUpperCase().replace(/^SIG/, '');
  if (!SIGNAL_PATTERN.test(name)) throw new Error(`shell-process: invalid signal ${JSON.stringify(signal)}`);
  return name;
}

/** Shell that sets `$D` to the job directory. */
function jobDir(jobId: string): string {
  assertJobId(jobId);
  return `D="\${TMPDIR:-/tmp}/.computesdk/jobs/${jobId}"`;
}

/** A sub-second sleep where `sleep` supports fractions, one second otherwise. */
const NAP = `nap() { sleep 0.2 2>/dev/null || sleep 1; }`;

function seconds(ms: number): { exact: string; ceil: number } {
  return { exact: (ms / 1000).toFixed(3), ceil: Math.max(1, Math.ceil(ms / 1000)) };
}

/** The command file: env exports, `cd`, then the caller's command verbatim. */
export function runFile(input: { command: string; cwd?: string; env?: Record<string, string> }): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (!ENV_KEY_PATTERN.test(key)) throw new Error(`shell-process: invalid env var name ${JSON.stringify(key)}`);
    lines.push(`export ${key}=${shQuote(String(value))}`);
  }
  if (input.cwd) lines.push(`cd ${shQuote(input.cwd)} || exit 1`);
  lines.push(input.command);
  return lines.join('\n') + '\n';
}

/**
 * The supervisor, run as `sh sup.sh <dir>` in its own session. It pumps the
 * command's stdout/stderr FIFOs into out.log, holds stdin open, arms the
 * watchdog, and writes `exit` once the log is complete.
 */
export function supervisorFile(): string {
  return [
    'D=$1',
    'cd / || exit 1',
    '. "$D/conf"',
    NAP,
    // Two pumps append to one log, so each record is written under a mkdir lock.
    'lock() { until mkdir "$D/lock" 2>/dev/null; do :; done; }',
    'unlock() { rmdir "$D/lock" 2>/dev/null; }',
    // One dd read per record: whatever the pipe holds, up to 4 KB.
    'pump() {',
    '  while :; do',
    '    dd bs=4096 count=1 of="$D/$1.chunk" 2>/dev/null',
    '    n=$(wc -c < "$D/$1.chunk"); n=$((n+0))',
    '    [ "$n" -gt 0 ] || break',
    '    lock; { printf \'%s%s\\n\' "$1" "$n"; cat "$D/$1.chunk"; } >> "$D/out.log"; unlock',
    '  done < "$2"',
    '}',
    ': > "$D/out.log"',
    'mkfifo "$D/o" "$D/e" || exit 1',
    'pump O "$D/o" & po=$!',
    'pump E "$D/e" & pe=$!',
    'IN=/dev/null',
    'if [ "$STDIN" = 1 ]; then',
    '  mkfifo "$D/in" || exit 1',
    // Read-write open never blocks on a FIFO and keeps a writer alive until closeStdin.
    '  sleep 2147483647 1<>"$D/in" & echo $! > "$D/holder"',
    '  IN="$D/in"',
    'fi',
    // Not a group leader here, so setsid does not fork: $! is the new pgid.
    'setsid sh "$D/run.sh" < "$IN" > "$D/o" 2> "$D/e" &',
    'pg=$!',
    'echo "$pg" > "$D/pid.tmp" && mv "$D/pid.tmp" "$D/pid"',
    'wd=',
    'if [ -n "$TIMEOUT" ]; then',
    // Its own session too, so killing the watchdog also kills its sleep.
    '  setsid sh -c \'sleep "$1" 2>/dev/null || sleep "$2"; [ -f "$3/exit" ] || { : > "$3/timedout"; kill -s KILL -- "-$4" 2>/dev/null || kill -s KILL "$4"; }\' wd "$TIMEOUT" "$TIMEOUT_CEIL" "$D" "$pg" &',
    '  wd=$!',
    'fi',
    'wait "$pg"; code=$?',
    // Give the pumps a moment to drain what the command wrote; a background
    // grandchild that keeps the pipe open does not hold up the exit record.
    'i=0',
    'while [ "$i" -lt 20 ] && { kill -0 "$po" 2>/dev/null || kill -0 "$pe" 2>/dev/null; }; do nap; i=$((i+1)); done',
    'kill "$po" "$pe" 2>/dev/null',
    '[ -f "$D/holder" ] && kill "$(cat "$D/holder")" 2>/dev/null',
    '[ -n "$wd" ] && { kill -s KILL -- "-$wd" 2>/dev/null || kill -s KILL "$wd" 2>/dev/null; }',
    'printf \'%s\' "$code" > "$D/exit.tmp" && mv "$D/exit.tmp" "$D/exit"',
    'rm -f "$D/o" "$D/e" "$D/in" "$D/O.chunk" "$D/E.chunk"; rmdir "$D/lock" 2>/dev/null',
    'R=$RETENTION; [ -f "$D/signal" ] && R=$KILLED_RETENTION',
    'sleep "$R"; rm -rf "$D"',
  ].join('\n') + '\n';
}

/**
 * One exec that probes the tools, writes the job's files and launches the
 * supervisor detached (`nohup setsid`). Replies `ok <pgid>` once the command
 * is running, or `unsupported <tool>`.
 */
export function launchScript(input: {
  jobId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: boolean;
  timeoutMs?: number;
  retentionMs?: number;
}): string {
  const timeout = input.timeoutMs !== undefined ? seconds(Math.max(1, input.timeoutMs)) : undefined;
  const retention = Math.ceil((input.retentionMs ?? DEFAULT_RETENTION_MS) / 1000);
  const conf = [
    `TIMEOUT=${timeout ? timeout.exact : ''}`,
    `TIMEOUT_CEIL=${timeout ? timeout.ceil : ''}`,
    `STDIN=${input.stdin ? 1 : 0}`,
    `RETENTION=${retention}`,
    `KILLED_RETENTION=${Math.min(retention, Math.ceil(KILLED_RETENTION_MS / 1000))}`,
  ].join('\n') + '\n';
  return [
    `for t in ${SHELL_TIER_TOOLS.join(' ')}; do command -v "$t" >/dev/null 2>&1 || { echo "${REPLY_MARKER} unsupported $t"; exit 0; }; done`,
    'umask 077',
    'R="${TMPDIR:-/tmp}/.computesdk/jobs"',
    'mkdir -p "$R" || { echo "' + REPLY_MARKER + ' error cannot-create-job-root"; exit 0; }',
    jobDir(input.jobId),
    `mkdir "$D" || { echo "${REPLY_MARKER} error job-exists"; exit 0; }`,
    `printf '%s' ${shQuote(runFile(input))} > "$D/run.sh"`,
    `printf '%s' ${shQuote(supervisorFile())} > "$D/sup.sh"`,
    `printf '%s' ${shQuote(conf)} > "$D/conf"`,
    'N=$(command -v nohup || true)',
    '$N setsid sh "$D/sup.sh" "$D" > /dev/null 2>&1 < /dev/null &',
    // The supervisor writes pid once the command is spawned; wait up to ~5s.
    'i=0; while [ ! -f "$D/pid" ] && [ "$i" -lt 50 ]; do sleep 0.1 2>/dev/null || sleep 1; i=$((i+1)); done',
    `if [ -f "$D/pid" ]; then echo "${REPLY_MARKER} ok $(cat "$D/pid")"; else echo "${REPLY_MARKER} error supervisor-did-not-start"; fi`,
  ].join('\n');
}

/**
 * One exec that reads the job's state and the log window after `cursor`.
 * With `waitMs`, it first long-polls in the box until the job exits (or, with
 * `untilOutput`, until the log grows past the cursor) or the time is up.
 *
 * Reply: `<marker> <running|exited|missing> <exit|-> <signal|-> <timedout 0|1> <logSize> <pid|->`,
 * then the window base64-encoded, then the end marker.
 */
export function readScript(input: {
  jobId: string;
  cursor: number;
  maxBytes?: number;
  waitMs?: number;
  untilOutput?: boolean;
}): string {
  const cursor = Math.max(0, Math.floor(input.cursor));
  const maxBytes = Math.max(1, Math.floor(input.maxBytes ?? DEFAULT_READ_BYTES));
  const ticks = Math.ceil(Math.min(input.waitMs ?? 0, MAX_LONG_POLL_MS) / 200);
  const lines = [
    jobDir(input.jobId),
    `[ -d "$D" ] || { echo "${REPLY_MARKER} missing - - 0 0 -"; echo "${REPLY_END}"; exit 0; }`,
  ];
  if (ticks > 0) {
    lines.push(
      NAP,
      // A fractional sleep that falls back to 1s takes ticks/5 seconds at most.
      `if sleep 0.01 2>/dev/null; then n=${ticks}; else n=${Math.ceil(ticks / 5)}; fi`,
      'i=0',
      input.untilOutput
        ? `while [ ! -f "$D/exit" ] && [ "$(wc -c < "$D/out.log" 2>/dev/null || echo 0)" -le ${cursor} ] && [ "$i" -lt "$n" ]; do nap; i=$((i+1)); done`
        : 'while [ ! -f "$D/exit" ] && [ "$i" -lt "$n" ]; do nap; i=$((i+1)); done',
    );
  }
  lines.push(
    // exit is read before the size: once exit exists the log no longer grows.
    'st=running; code=-',
    'if [ -f "$D/exit" ]; then st=exited; code=$(cat "$D/exit"); fi',
    'sig=-; [ -f "$D/signal" ] && sig=$(cat "$D/signal")',
    'to=0; [ -f "$D/timedout" ] && to=1',
    'size=$(wc -c < "$D/out.log" 2>/dev/null || echo 0); size=$((size+0))',
    'pid=-; [ -f "$D/pid" ] && pid=$(cat "$D/pid")',
    `echo "${REPLY_MARKER} $st $code $sig $to $size $pid"`,
    `if [ "$size" -gt ${cursor} ]; then tail -c +${cursor + 1} "$D/out.log" | head -c ${maxBytes} | base64; fi`,
    `echo "${REPLY_END}"`,
  );
  return lines.join('\n');
}

/** One exec that appends base64-decoded bytes to the job's stdin FIFO. */
export function writeStdinScript(jobId: string, base64: string): string {
  if (!/^[A-Za-z0-9+/=]*$/.test(base64)) throw new Error('shell-process: stdin payload must be base64');
  return [
    jobDir(jobId),
    `[ -d "$D" ] || { echo "${REPLY_MARKER} missing"; exit 0; }`,
    `[ -f "$D/exit" ] && { echo "${REPLY_MARKER} exited"; exit 0; }`,
    `[ -p "$D/in" ] && [ -f "$D/holder" ] || { echo "${REPLY_MARKER} no-stdin"; exit 0; }`,
    `[ -f "$D/stdin-closed" ] && { echo "${REPLY_MARKER} closed"; exit 0; }`,
    `printf '%s' '${base64}' | base64 -d 1<>"$D/in" && echo "${REPLY_MARKER} ok"`,
  ].join('\n');
}

/** One exec that closes stdin by killing the FIFO's holder. */
export function closeStdinScript(jobId: string): string {
  return [
    jobDir(jobId),
    `[ -d "$D" ] || { echo "${REPLY_MARKER} missing"; exit 0; }`,
    ': > "$D/stdin-closed"',
    '[ -f "$D/holder" ] && kill "$(cat "$D/holder")" 2>/dev/null',
    `echo "${REPLY_MARKER} ok"`,
  ].join('\n');
}

/** One exec that signals the command's whole process group. */
export function killScript(jobId: string, signal: string): string {
  const name = normalizeSignal(signal);
  return [
    jobDir(jobId),
    `[ -d "$D" ] || { echo "${REPLY_MARKER} missing"; exit 0; }`,
    `[ -f "$D/exit" ] && { echo "${REPLY_MARKER} exited"; exit 0; }`,
    'i=0; while [ ! -f "$D/pid" ] && [ "$i" -lt 25 ]; do sleep 0.2 2>/dev/null || sleep 1; i=$((i+1)); done',
    'pg=$(cat "$D/pid")',
    `printf 'SIG%s' '${name}' > "$D/signal"`,
    `kill -s ${name} -- "-$pg" 2>/dev/null || kill -s ${name} "$pg" 2>/dev/null`,
    `echo "${REPLY_MARKER} ok"`,
  ].join('\n');
}
