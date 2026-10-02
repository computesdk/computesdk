import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // @miosa/sdk's runner transport is dynamically imported only on the
  // opt-in runner path (see "SOMA one-hop runner transport" in src/index.ts)
  // - never bundle it into this package's dist.
  external: ["@miosa/sdk"],
});
