import { runProviderTestSuite } from "@computesdk/test-utils";
import { runloop } from "../index";

const runLive = process.env.RUNLOOP_INTEGRATION === "1" && Boolean(process.env.RUNLOOP_API_KEY);

runProviderTestSuite({
  name: "runloop",
  provider: runloop({}),
  supportsFilesystem: true,
  // Native streaming via streamCommand; startProcess runs on the shell process tier.
  supportsStreaming: true,
  supportsProcesses: true,
  // The mock sandbox used without credentials reports no runtime.
  ...(runLive ? { expectProcessRuntime: { streaming: "native", processes: "shell" } as const } : {}),
  skipIntegration: !runLive,
  ports: [3000, 8080],
  timeout: 120_000,
});
