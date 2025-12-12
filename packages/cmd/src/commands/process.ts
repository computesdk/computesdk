import type { Command } from '../types.js';

/**
 * Run Node.js script
 * @example node('server.js')
 * @example node('server.js', ['--port', '3000'])
 */
export const node = (script: string, args?: string[]): Command => {
  return args ? ['node', script, ...args] : ['node', script];
};

/**
 * Run Python script
 * @example python('script.py')
 * @example python('script.py', ['--verbose'])
 */
export const python = (script: string, args?: string[]): Command => {
  return args ? ['python3', script, ...args] : ['python3', script];
};

/**
 * Kill process by PID
 * @example kill(1234)
 * @example kill(1234, 9) // SIGKILL
 */
export const kill = (pid: number, signal?: number): Command => {
  return signal ? ['kill', `-${signal}`, String(pid)] : ['kill', String(pid)];
};

/**
 * Kill processes by name
 * @example pkill('node')
 * @example pkill('python', { signal: 9 })
 */
export const pkill = (name: string, options?: { signal?: number }): Command => {
  return options?.signal
    ? ['pkill', `-${options.signal}`, name]
    : ['pkill', name];
};

/**
 * List processes
 * @example ps()
 * @example ps({ all: true })
 */
export const ps = (options?: { all?: boolean }): Command => {
  return options?.all ? ['ps', 'aux'] : ['ps'];
};

/**
 * Run command with timeout
 * @example timeout(30, 'npm', ['test'])
 * @example timeout(10, 'curl', ['https://example.com'])
 */
export const timeout = (seconds: number, command: string, args?: string[]): Command => {
  const base: string[] = ['timeout', String(seconds), command];
  return args ? [...base, ...args] as Command : base as Command;
};
