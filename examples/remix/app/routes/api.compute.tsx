import type { ActionFunctionArgs } from "@remix-run/node";
import { handleComputeRequest } from "computesdk";
// import { e2b } from "@computesdk/e2b";
// import { vercel } from "@computesdk/vercel";
// import { daytona } from "@computesdk/daytona";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const computeRequest = await request.json();
    // @ts-ignore - Example only, provider would be e2b() | vercel() | daytona()
    const response = await handleComputeRequest({
      request: computeRequest,
      // @ts-ignore - Example only, provider would be e2b() | vercel() | daytona()
      provider: undefined // e2b() | vercel() | daytona()
    });

    return Response.json(response, { 
      status: response.success ? 200 : 500 
    });
  } catch (error) {
    console.error("Request handling error:", error);
    
    return Response.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        sandboxId: '',
        provider: 'unknown'
      },
      { status: 500 }
    );
  }
};