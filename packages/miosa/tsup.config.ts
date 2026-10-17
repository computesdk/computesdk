import { defineConfig } from "tsup";
import type { Plugin } from "esbuild";

// The runner client is loaded by an awaited import in ESM and by require in
// CommonJS, which cannot await. Each format gets the file that fits it.
const runnerEntryPerFormat: Plugin = {
  name: "runner-entry-per-format",
  setup(build) {
    if (build.initialOptions.format !== "cjs") return;
    build.onResolve({ filter: /^\.\/runner-entry$/ }, () => ({
      path: new URL("./src/runner-entry.cjs.ts", import.meta.url).pathname,
    }));
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  // Top-level await in the ESM runner entry needs at least es2017 syntax
  // support in the output; Node 18 supports es2022.
  target: "es2022",
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // @miosa/sdk is a runtime dependency, resolved by the consumer - never
  // bundle it into this package's dist.
  external: ["@miosa/sdk", "@miosa/sdk/runner"],
  esbuildPlugins: [runnerEntryPerFormat],
});
