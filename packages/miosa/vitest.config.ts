import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The adapter prefers the SDK's lean runner entry when the installed
    // version has one. Tests mock the root entry, so point the subpath at it:
    // they meet the mock whichever SDK version is installed.
    alias: [{ find: /^@miosa\/sdk\/runner$/, replacement: "@miosa/sdk" }],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
