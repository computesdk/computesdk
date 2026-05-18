/**
 * defineSetup - Declarative environment specification for sandboxes.
 *
 * A SetupConfig is a pure value: it describes what an execution environment
 * should look like (source code, system dependencies, install steps, env vars,
 * resource hints), but has no methods. The sandbox owns lifecycle and execution.
 *
 *   import { defineSetup, deps } from 'computesdk';
 *
 *   const setup = defineSetup({
 *     source: { type: 'github', repo: 'acme/my-app', ref: 'main' },
 *     deps: [deps.python, deps.ffmpeg],
 *     install: 'pip install -r requirements.txt',
 *     env: { API_KEY: process.env.API_KEY! },
 *   });
 *
 *   const sandbox = await compute.sandbox.create({ setup });
 */

/**
 * A single system dependency. Currently always backed by Nix.
 */
export interface Dep {
  /** Display name, used in error messages (e.g. "python") */
  readonly name: string;
  /** Nix package atom, resolved against nixpkgs (e.g. "python3") */
  readonly nixPkg: string;
}

/**
 * Where source code is materialized from before install steps run.
 */
export type SetupSource =
  | { readonly type: 'github'; readonly repo: string; readonly ref?: string }
  | { readonly type: 'local'; readonly path: string }
  | { readonly type: 'tar'; readonly url: string };

/**
 * Resource hints for the sandbox runtime. Best-effort: providers that don't
 * support sizing at create time silently ignore these.
 */
export interface SetupResources {
  readonly cpu?: number;
  readonly memory?: string;
}

/**
 * Full shape of a setup spec. All fields are optional so callers can mix and
 * match (e.g. just `deps`, just `source`, etc.).
 */
export interface SetupConfig {
  readonly source?: SetupSource;
  readonly deps?: readonly Dep[];
  readonly install?: string | readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly resources?: SetupResources;
}

function freezeDep(dep: Dep): Dep {
  return Object.freeze({ name: dep.name, nixPkg: dep.nixPkg });
}

/**
 * Wrap a SetupConfig as a frozen value object. Mutating the returned value
 * (or its nested fields) throws in strict mode, so setups can be safely shared
 * across calls and modules.
 */
export function defineSetup(config: SetupConfig): SetupConfig {
  const frozen: SetupConfig = {
    source: config.source ? Object.freeze({ ...config.source }) as SetupSource : undefined,
    deps: config.deps ? Object.freeze(config.deps.map(freezeDep)) : undefined,
    install: Array.isArray(config.install)
      ? Object.freeze([...config.install])
      : config.install,
    env: config.env ? Object.freeze({ ...config.env }) : undefined,
    resources: config.resources ? Object.freeze({ ...config.resources }) : undefined,
  };
  return Object.freeze(frozen);
}

function nixDep(name: string, nixPkg: string): Dep {
  return Object.freeze({ name, nixPkg });
}

/**
 * Curated registry of common system dependencies. Each entry resolves to a
 * Nix package. Use `deps.nix(...)` for arbitrary packages not in the registry.
 *
 *   deps.python              // python3
 *   deps.ffmpeg              // ffmpeg
 *   deps.nix('imagemagick')  // any nixpkgs atom
 */
export const deps = Object.freeze({
  python: nixDep('python', 'python3'),
  python3: nixDep('python3', 'python3'),
  node: nixDep('node', 'nodejs'),
  nodejs: nixDep('nodejs', 'nodejs'),
  go: nixDep('go', 'go'),
  rust: nixDep('rust', 'rustc'),
  ruby: nixDep('ruby', 'ruby'),
  ffmpeg: nixDep('ffmpeg', 'ffmpeg'),
  imagemagick: nixDep('imagemagick', 'imagemagick'),
  git: nixDep('git', 'git'),
  curl: nixDep('curl', 'curl'),
  wget: nixDep('wget', 'wget'),
  jq: nixDep('jq', 'jq'),
  /** Escape hatch for arbitrary Nix packages (resolved against `nixpkgs#<pkg>`). */
  nix: (pkg: string): Dep => nixDep(pkg, pkg),
});
