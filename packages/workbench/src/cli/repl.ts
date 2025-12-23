/**
 * REPL setup and configuration
 * 
 * Creates Node.js REPL with:
 * - Tab autocomplete for @computesdk/cmd functions
 * - Smart command evaluation (auto-run Command arrays)
 * - Workbench command injection
 */

import * as repl from 'repl';
import * as cmd from '@computesdk/cmd';
import type { WorkbenchState } from './state.js';
import { runCommand, createProviderCommand, restartSandbox, destroySandbox, toggleMode, showMode, toggleVerbose, showVerbose } from './commands.js';
import { showHelp, showInfo } from './output.js';
import { showProviders, showEnv, PROVIDER_NAMES } from './providers.js';
import { isCommand } from './types.js';

/**
 * Extended REPL server interface with custom eval function
 */
interface ExtendedREPLServer extends repl.REPLServer {
  eval: (
    cmd: string,
    context: object,
    filename: string,
    callback: (err: Error | null, result: any) => void
  ) => void;
}
import * as path from 'path';
import * as os from 'os';

/**
 * Create and configure REPL server
 */
export function createREPL(state: WorkbenchState): repl.REPLServer {
  const replServer = repl.start({
    prompt: '> ',  // Initial prompt, will be updated by state management
    useColors: true,
    terminal: true,
    useGlobal: false,
    ignoreUndefined: true,
  });

  // Inject cmd context for autocomplete
  injectCmdContext(replServer);
  
  // Inject workbench commands
  injectWorkbenchCommands(replServer, state);
  
  // Setup custom evaluator
  setupSmartEvaluator(replServer, state);
  
  // Setup custom autocomplete
  setupAutocomplete(replServer, state);
  
  // Setup command history
  setupHistory(replServer);
  
  // Store replServer reference for prompt updates
  state._replServer = replServer;

  return replServer;
}

/**
 * Inject all @computesdk/cmd exports into REPL context for autocomplete
 */
function injectCmdContext(replServer: repl.REPLServer) {
  // Package managers
  replServer.context.npm = cmd.npm;
  replServer.context.pnpm = cmd.pnpm;
  replServer.context.yarn = cmd.yarn;
  replServer.context.bun = cmd.bun;
  replServer.context.pip = cmd.pip;
  replServer.context.uv = cmd.uv;
  replServer.context.poetry = cmd.poetry;
  replServer.context.pipx = cmd.pipx;
  
  // Package runners
  replServer.context.npx = cmd.npx;
  replServer.context.bunx = cmd.bunx;
  replServer.context.deno = cmd.deno;
  
  // Git
  replServer.context.git = cmd.git;
  
  // Filesystem
  replServer.context.mkdir = cmd.mkdir;
  replServer.context.rm = cmd.rm;
  replServer.context.cp = cmd.cp;
  replServer.context.mv = cmd.mv;
  replServer.context.ls = cmd.ls;
  replServer.context.pwd = cmd.pwd;
  replServer.context.chmod = cmd.chmod;
  replServer.context.chown = cmd.chown;
  replServer.context.touch = cmd.touch;
  replServer.context.cat = cmd.cat;
  replServer.context.ln = cmd.ln;
  replServer.context.readlink = cmd.readlink;
  replServer.context.test = cmd.test;
  replServer.context.rsync = cmd.rsync;
  
  // Process
  replServer.context.node = cmd.node;
  replServer.context.python = cmd.python;
  replServer.context.kill = cmd.kill;
  replServer.context.pkill = cmd.pkill;
  replServer.context.ps = cmd.ps;
  replServer.context.timeout = cmd.timeout;
  
  // Network
  replServer.context.curl = cmd.curl;
  replServer.context.wget = cmd.wget;
  replServer.context.port = cmd.port;
  replServer.context.net = cmd.net;
  
  // Text processing
  replServer.context.grep = cmd.grep;
  replServer.context.sed = cmd.sed;
  replServer.context.head = cmd.head;
  replServer.context.tail = cmd.tail;
  replServer.context.wc = cmd.wc;
  replServer.context.sort = cmd.sort;
  replServer.context.uniq = cmd.uniq;
  replServer.context.jq = cmd.jq;
  replServer.context.xargs = cmd.xargs;
  replServer.context.awk = cmd.awk;
  replServer.context.cut = cmd.cut;
  replServer.context.tr = cmd.tr;
  
  // Archives
  replServer.context.tar = cmd.tar;
  replServer.context.unzip = cmd.unzip;
  
  // System
  replServer.context.echo = cmd.echo;
  replServer.context.env = cmd.env;
  replServer.context.printenv = cmd.printenv;
  replServer.context.which = cmd.which;
  replServer.context.whoami = cmd.whoami;
  replServer.context.uname = cmd.uname;
  replServer.context.hostname = cmd.hostname;
  replServer.context.df = cmd.df;
  replServer.context.du = cmd.du;
  replServer.context.sleep = cmd.sleep;
  replServer.context.date = cmd.date;
  replServer.context.find = cmd.find;
  replServer.context.tee = cmd.tee;
  replServer.context.diff = cmd.diff;
  replServer.context.parallel = cmd.parallel;
  replServer.context.raw = cmd.raw;
  replServer.context.base64 = cmd.base64;
  replServer.context.md5sum = cmd.md5sum;
  replServer.context.sha256sum = cmd.sha256sum;
  replServer.context.sha1sum = cmd.sha1sum;
  
  // Compute
  replServer.context.compute = cmd.compute;
  
  // Expose cmd namespace for cmd() wrapper
  replServer.context.cmd = cmd.cmd;
  
  // Shell wrappers
  replServer.context.shell = cmd.shell;
  replServer.context.sh = cmd.sh;
  replServer.context.bash = cmd.bash;
  replServer.context.zsh = cmd.zsh;
}

/**
 * Inject workbench-specific commands
 */
function injectWorkbenchCommands(replServer: repl.REPLServer, state: WorkbenchState) {
  // Provider management
  replServer.context.provider = createProviderCommand(state);
  replServer.context.providers = () => showProviders();
  
  // Mode management
  replServer.context.mode = async (modeName?: 'gateway' | 'direct') => {
    if (!modeName) {
      showMode(state);
    } else {
      await toggleMode(state, modeName);
    }
  };
  
  // Sandbox operations
  replServer.context.restart = async () => {
    await restartSandbox(state);
  };
  
  replServer.context.destroy = async () => {
    await destroySandbox(state);
  };
  
  replServer.context.info = () => showInfo(state);
  
  // Output control
  replServer.context.verbose = () => {
    toggleVerbose(state);
    showVerbose(state);
  };
  
  // Background execution helper - accepts string or Command
  replServer.context.bg = (command: string | string[]) => {
    const cmdArray = typeof command === 'string' 
      ? ['sh', '-c', command]
      : command;
    return cmd.sh(cmdArray as any, { background: true });
  };
  
  // Environment/help
  replServer.context.env = () => showEnv();
  replServer.context.help = showHelp;
  
  // Expose sandbox methods directly in context
  // These are lazy-evaluated to get the current sandbox
  
  // Expose getUrl directly
  replServer.context.getUrl = async (options: { port: number; protocol?: string }) => {
    const sandbox = state.currentSandbox;
    if (!sandbox) {
      throw new Error('No active sandbox. Run a command to auto-create one.');
    }
    return sandbox.getUrl(options);
  };
  
  // Expose getInfo as sandboxInfo (since 'info' is already taken for workbench info)
  replServer.context.sandboxInfo = async () => {
    const sandbox = state.currentSandbox;
    if (!sandbox) {
      throw new Error('No active sandbox. Run a command to auto-create one.');
    }
    return sandbox.getInfo();
  };
  
  // Expose runCode directly
  replServer.context.runCode = async (code: string, runtime?: 'node' | 'python') => {
    const sandbox = state.currentSandbox;
    if (!sandbox) {
      throw new Error('No active sandbox. Run a command to auto-create one.');
    }
    return sandbox.runCode(code, runtime);
  };
  
  // Expose sandbox creation methods (gateway mode only)
  replServer.context.create = async (options?: any) => {
    if (!state.compute) {
      throw new Error('No compute instance configured.');
    }
    if (state.useDirectMode) {
      throw new Error('Named sandboxes are only available in gateway mode. Use "mode gateway" to switch.');
    }
    return await state.compute.sandbox.create(options);
  };
  
  replServer.context.findOrCreate = async (options: { name: string; namespace?: string; [key: string]: any }) => {
    if (!state.compute) {
      throw new Error('No compute instance configured.');
    }
    if (state.useDirectMode) {
      throw new Error('Named sandboxes (findOrCreate) are only available in gateway mode. Use "mode gateway" to switch.');
    }
    return await state.compute.sandbox.findOrCreate(options);
  };
  
  replServer.context.find = async (options: { name: string; namespace?: string }) => {
    if (!state.compute) {
      throw new Error('No compute instance configured.');
    }
    if (state.useDirectMode) {
      throw new Error('Named sandboxes (find) are only available in gateway mode. Use "mode gateway" to switch.');
    }
    return await state.compute.sandbox.find(options);
  };
  
  // Expose filesystem namespace
  replServer.context.filesystem = {
    get readFile() {
      return async (path: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.readFile(path);
      };
    },
    get writeFile() {
      return async (path: string, content: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.writeFile(path, content);
      };
    },
    get mkdir() {
      return async (path: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.mkdir(path);
      };
    },
    get readdir() {
      return async (path: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.readdir(path);
      };
    },
    get exists() {
      return async (path: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.exists(path);
      };
    },
    get remove() {
      return async (path: string) => {
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        return sandbox.filesystem.remove(path);
      };
    }
  };
  
  // Expose child namespace for child sandbox operations (gateway mode only)
  replServer.context.child = {
    get create() {
      return async () => {
        if (state.useDirectMode) {
          throw new Error('Child sandboxes are only available in gateway mode. Use "mode gateway" to switch.');
        }
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        const instance = sandbox.getInstance();
        return instance.child.create();
      };
    },
    get list() {
      return async () => {
        if (state.useDirectMode) {
          throw new Error('Child sandboxes are only available in gateway mode. Use "mode gateway" to switch.');
        }
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        const instance = sandbox.getInstance();
        return instance.child.list();
      };
    },
    get retrieve() {
      return async (subdomain: string) => {
        if (state.useDirectMode) {
          throw new Error('Child sandboxes are only available in gateway mode. Use "mode gateway" to switch.');
        }
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        const instance = sandbox.getInstance();
        return instance.child.retrieve(subdomain);
      };
    },
    get destroy() {
      return async (subdomain: string, options?: { deleteFiles?: boolean }) => {
        if (state.useDirectMode) {
          throw new Error('Child sandboxes are only available in gateway mode. Use "mode gateway" to switch.');
        }
        const sandbox = state.currentSandbox;
        if (!sandbox) {
          throw new Error('No active sandbox. Run a command to auto-create one.');
        }
        const instance = sandbox.getInstance();
        return instance.child.destroy(subdomain, options);
      };
    }
  };
  
  // Expose getInstance for advanced users
  replServer.context.getInstance = () => {
    const sandbox = state.currentSandbox;
    if (!sandbox) {
      throw new Error('No active sandbox. Run a command to auto-create one.');
    }
    return sandbox.getInstance();
  };
}

/**
 * Setup smart evaluator that auto-runs Command arrays and workbench commands
 */
function setupSmartEvaluator(replServer: repl.REPLServer, state: WorkbenchState) {
  const originalEval = replServer.eval;
  
  // Track workbench command names for auto-calling
  const workbenchCommands = new Set(['help', 'providers', 'info', 'env', 'restart', 'destroy', 'mode', 'verbose', 'sandboxInfo']);
  
  (replServer as ExtendedREPLServer).eval = function (cmd: string, context: object, filename: string, callback: (err: Error | null, result: any) => void) {
    const trimmedCmd = cmd.trim();
    
    // Special handling for "provider <mode> <name>" syntax (without parentheses)
    // Supports: "provider e2b", "provider direct e2b", "provider gateway e2b"
    const providerMatch = trimmedCmd.match(/^provider(?:\s+(direct|gateway))?\s+(\w+)$/);
    if (providerMatch) {
      const mode = providerMatch[1] || null; // 'direct', 'gateway', or null
      const providerName = providerMatch[2];
      const providerCmd = mode 
        ? `await provider('${mode}', '${providerName}')`
        : `await provider('${providerName}')`;
      originalEval.call(this, providerCmd, context, filename, callback);
      return;
    }
    
    // Also handle just "provider direct" or "provider gateway" alone  
    const providerOnlyMatch = trimmedCmd.match(/^provider\s+(direct|gateway)$/);
    if (providerOnlyMatch) {
      const mode = providerOnlyMatch[1];
      const providerCmd = `await provider('${mode}')`;
      originalEval.call(this, providerCmd, context, filename, callback);
      return;
    }
    
    // Special handling for "mode <gateway|direct>" syntax
    const modeMatch = trimmedCmd.match(/^mode\s+(gateway|direct)$/);
    if (modeMatch) {
      const modeName = modeMatch[1];
      const modeCmd = `await mode('${modeName}')`;
      originalEval.call(this, modeCmd, context, filename, callback);
      return;
    }
    
    // Special handling for $command syntax (direct shell command execution)
    const dollarMatch = trimmedCmd.match(/^\$(.+)$/);
    if (dollarMatch) {
      const shellCmd = dollarMatch[1].trim();
      
      // Handle empty command
      if (!shellCmd) {
        callback(new Error('Empty command after $'), undefined);
        return;
      }
      
      // Create command array: ['sh', '-c', 'the command']
      const command = ['sh', '-c', shellCmd];
      
      // Execute the command directly
      runCommand(state, command)
        .then(output => callback(null, output))
        .catch(error => callback(error as Error, undefined));
      return;
    }
    
    // Use original eval to get the result
    originalEval.call(this, cmd, context, filename, async (err, result) => {
      if (err) {
        callback(err, undefined);
        return;
      }
      
      // Check if result is a Command (string array from @computesdk/cmd)
      if (isCommand(result)) {
        try {
          const output = await runCommand(state, result);
          callback(null, output);
        } catch (error) {
          callback(error as Error, undefined);
        }
        return;
      }
      
      // Check if it's a workbench command function that should be auto-called
      if (typeof result === 'function' && workbenchCommands.has(trimmedCmd)) {
        try {
          const output = await result();
          callback(null, output);
        } catch (error) {
          callback(error as Error, undefined);
        }
        return;
      }
      
      // Auto-await promises (so users don't need to type "await")
      if (result && typeof result.then === 'function') {
        try {
          const output = await result;
          callback(null, output);
        } catch (error) {
          callback(error as Error, undefined);
        }
        return;
      }
      
      // Not a command or promise, return as-is
      callback(null, result);
    });
  };
}

/**
 * Setup custom autocomplete
 */
function setupAutocomplete(replServer: repl.REPLServer, state: WorkbenchState) {
  const originalCompleter = replServer.completer as any;
  
  // Workbench commands with their argument suggestions
  const workbenchCommands = {
    'provider': [...PROVIDER_NAMES], // Use actual provider names from config
    'mode': ['gateway', 'direct'],
    'providers': [],
    'restart': [],
    'destroy': [],
    'info': [],
    'env': [],
    'help': [],
    'verbose': [],
    'exit': [],
    '.exit': [],
    // Sandbox methods
    'getUrl': [],
    'runCode': [],
    'sandboxInfo': [],
    'getInstance': [],
    // Filesystem is an object, so it gets dot notation autocomplete automatically
  };
  
  (replServer as any).completer = function (line: string, callback: (err: Error | null, result: [string[], string]) => void) {
    try {
      // Don't trim - we need to detect trailing spaces
      const trimmed = line.trim();
      
      // Complete workbench command names (no space or dot in line)
      if (!line.includes(' ') && !line.includes('.')) {
        const commands = Object.keys(workbenchCommands);
        const hits = commands.filter(cmd => cmd.startsWith(trimmed));
        
        // Also get context completions from original completer
        if (originalCompleter) {
          originalCompleter.call(replServer, line, (err: Error | null, result?: [string[], string]) => {
            if (err || !result) {
              callback(null, [hits, trimmed]);
              return;
            }
            
            // Validate result format
            if (!Array.isArray(result) || result.length !== 2) {
              callback(null, [hits, trimmed]);
              return;
            }
            
            const [contextHits, partial] = result;
            if (!Array.isArray(contextHits)) {
              callback(null, [hits, trimmed]);
              return;
            }

            // Merge workbench commands with context completions
            const allHits = [...new Set([...hits, ...contextHits])].sort();
            const completionPrefix = typeof partial === 'string' ? partial : trimmed;
            callback(null, [allHits, completionPrefix]);
          });
          return;
        }
        
        callback(null, [hits.length ? hits : commands, trimmed]);
        return;
      }
      
      // Complete command arguments (e.g., "provider e" -> "provider e2b")
      // Use original line to detect spaces properly
      if (line.includes(' ') && !line.includes('.')) {
        const parts = line.split(' ');
        const command = parts[0].trim();
        const partial = parts.slice(1).join(' ').trim(); // Everything after command
        const suggestions = workbenchCommands[command as keyof typeof workbenchCommands];
        
        // Check if this is a known workbench command
        if (suggestions !== undefined) {
          if (suggestions.length > 0) {
            const hits = suggestions
              .filter(s => s.startsWith(partial))
              .map(s => `${command} ${s}`);
            
            callback(null, [hits.length ? hits : suggestions.map(s => `${command} ${s}`), line]);
          } else {
            // For commands with no arguments (like 'info', 'help', etc.), return empty
            callback(null, [[], line]);
          }
          return;
        }
      }
      
      // Fall back to original completer (this handles npm., git., etc.)
      if (originalCompleter) {
        originalCompleter.call(replServer, line, (err: Error | null, result?: [string[], string]) => {
          if (err || !result) {
            callback(null, [[], line]);
            return;
          }
          
          // Validate result format before passing it along
          if (!Array.isArray(result) || result.length !== 2) {
            callback(null, [[], line]);
            return;
          }
          
          const [completions, partial] = result;
          if (!Array.isArray(completions) || typeof partial !== 'string') {
            callback(null, [[], line]);
            return;
          }
          
          callback(null, [completions, partial]);
        });
      } else {
        callback(null, [[], line]);
      }
    } catch (error) {
      // Catch any unexpected errors to prevent crashing the REPL
      console.error('Autocomplete error:', error);
      callback(null, [[], line]);
    }
  };
}

/**
 * Setup command history
 */
function setupHistory(replServer: repl.REPLServer) {
  const historyFile = path.join(os.homedir(), '.computesdk_workbench_history');
  
  replServer.setupHistory(historyFile, (err) => {
    if (err) {
      // Silent fail - history is nice-to-have
    }
  });
}
