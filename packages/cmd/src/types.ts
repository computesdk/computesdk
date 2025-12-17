/**
 * Command tuple type - [command, ...args]
 */
export type Command = [string, ...string[]];

/**
 * Options for shell wrapping
 */
export interface ShellOptions {
  /** Working directory - wraps command with `cd "cwd" && ...` */
  cwd?: string;
  /** Run in background - wraps command with `nohup ... > /dev/null 2>&1 &` */
  background?: boolean;
}
