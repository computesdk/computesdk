import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { ComputeSDK } from "computesdk";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const formData = await request.formData();
    const code = formData.get("code") as string;
    const runtime = (formData.get("runtime") as string) || "python";

    if (!code || typeof code !== "string") {
      return json(
        { 
          success: false,
          error: "Code is required and must be a string" 
        },
        { status: 400 }
      );
    }

    const sandbox = ComputeSDK.createSandbox({});
    const result = await sandbox.execute(code, runtime as 'node' | 'python');

    return json({
      success: true,
      result: {
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        provider: result.provider
      }
    });
  } catch (error) {
    console.error("Execution error:", error);
    
    return json(
      { 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      },
      { status: 500 }
    );
  }
};