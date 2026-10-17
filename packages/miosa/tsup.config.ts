import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // @miosa/sdk is a runtime dependency, resolved by the consumer - never
  // bundle it into this package's dist.
  external: ["@miosa/sdk"],
});
