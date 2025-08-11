import type { ActionFunctionArgs } from "@remix-run/node";
import { handleComputeRequest } from "computesdk";
// import { e2b } from "@computesdk/e2b";
// import { vercel } from "@computesdk/vercel";
// import { daytona } from "@computesdk/daytona";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const formData = await request.formData();
    const code = formData.get("code") as string;
    
    // Configure your provider - uncomment one of the following:
    // const provider = e2b({ apiKey: process.env.E2B_API_KEY! });
    // const provider = vercel({ token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! });
    // const provider = daytona({ apiKey: process.env.DAYTONA_API_KEY! });
    
    const response = await handleComputeRequest({
      request: {
        action: 'compute.sandbox.runCode',
        code
      },
      // @ts-ignore - Uncomment a provider above
      provider: undefined
    });

    if (response.success) {
      return { output: response.result?.stdout || 'No output' };
    } else {
      return { error: response.error || 'Unknown error' };
    }
  } catch (error) {
    console.error("Request handling error:", error);
    return { error: error instanceof Error ? error.message : "Unknown error occurred" };
  }
};