import { runProviderTestSuite } from "@computesdk/test-utils";
import { miosa } from "../index";

const live = Boolean(process.env.MIOSA_API_KEY);

runProviderTestSuite({
  name: "miosa",
  provider: miosa({}),
  supportsFilesystem: true,
  // The regional endpoint's sandboxes answer POST /sandboxes/:id/expose with 404.
  supportsGetUrl: false,
  // Pause and snapshot sources use the declared createOptions ({ runtime: "firecracker" }).
  supportsPauseResume: true,
  supportsSnapshots: true,
  skipIntegration: !live,
});
