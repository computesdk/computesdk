import { runProviderCrudTest } from "@computesdk/test-utils";
import { denoSandbox } from "../index";

runProviderCrudTest({
  name: "deno-sandbox",
  provider: denoSandbox({}), // uses DENO_DEPLOY_TOKEN from env
  skipIntegration: !process.env.DENO_DEPLOY_TOKEN,
});
