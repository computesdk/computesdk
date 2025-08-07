import type { ActionFunctionArgs } from "@remix-run/node";
import { handleComputeRequest } from "computesdk";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const computeRequest = await request.json();
    const response = await handleComputeRequest(computeRequest);

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