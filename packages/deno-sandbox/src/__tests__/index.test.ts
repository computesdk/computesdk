import { runProviderTestSuite } from "@computesdk/test-utils";
import { denoSandbox } from "../index";

runProviderTestSuite({
  name: "deno-sandbox",
  provider: denoSandbox({}), // uses DENO_DEPLOY_TOKEN from env
  supportsFilesystem: true,
  skipIntegration: !process.env.DENO_DEPLOY_TOKEN,
});
