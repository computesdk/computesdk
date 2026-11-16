/**
 * ComputeSDK conformance suite against a live CreateOS (createos-sandbox) control plane.
 *
 * Runs real create → exec → filesystem → getUrl → destroy cycles (one sandbox
 * per test). Gated behind CREATEOS_SANDBOX_API_KEY so local/CI runs without creds fall
 * back to the in-memory mock sandbox and never touch external infra.
 *
 *   CREATEOS_SANDBOX_API_KEY=skp_... CREATEOS_SANDBOX_BASE_URL=https://createos-sandbox.example.com \
 *     npx vitest run src/__tests__/integration.test.ts
 */
import { runProviderTestSuite } from "@computesdk/test-utils";
import { createosSandbox } from "../index.js";

const skipIntegration = process.env.SKIP_INTEGRATION === "true" || !process.env.CREATEOS_SANDBOX_API_KEY;

runProviderTestSuite({
  name: "createos-sandbox",
  provider: createosSandbox({}), // reads CREATEOS_SANDBOX_API_KEY / CREATEOS_SANDBOX_BASE_URL
  supportsFilesystem: true,
  supportsGetUrl: true,
  ports: [3000, 8080],
  supportsStreaming: true,
  supportsProcesses: true,
  supportsPauseResume: true,
  supportsSnapshots: true,
  // Pinned only live: the mock sandbox reports the tier as unknown.
  expectProcessRuntime: skipIntegration ? undefined : { streaming: "shell", processes: "shell" },
  timeout: 120_000,
  skipIntegration,
});
