// @ts-nocheck
import { useState } from "react";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [
    { title: "ComputeSDK + Remix Example" },
    { name: "description", content: "Example of using ComputeSDK with Remix for server-side code execution" },
  ];
};

interface ExecutionResult {
  success: boolean;
  result?: {
    output: string;
    error?: string;
    executionTime: number;
    provider: string;
  };
  error?: string;
}

export default function Index() {
  const [code, setCode] = useState('print("Hello from ComputeSDK!")');
  const [runtime, setRuntime] = useState("python");
  const actionData = useActionData<ExecutionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body>
        <main className="container mx-auto p-8 max-w-4xl">
          <h1 className="text-3xl font-bold mb-8">ComputeSDK + Remix Example</h1>
          
          <Form method="post" action="/api/execute" className="space-y-6">
            <div>
              <label htmlFor="runtime" className="block text-sm font-medium mb-2">
                Runtime
              </label>
              <select
                id="runtime"
                name="runtime"
                value={runtime}
                onChange={(e) => setRuntime(e.target.value)}
                className="border border-gray-300 rounded px-3 py-2"
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
              </select>
            </div>

            <div>
              <label htmlFor="code" className="block text-sm font-medium mb-2">
                Code
              </label>
              <textarea
                id="code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={10}
                className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                placeholder="Enter your code here..."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !code.trim()}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-6 py-2 rounded"
            >
              {isSubmitting ? "Executing..." : "Execute Code"}
            </button>
          </Form>

          {actionData && (
            <div className="border rounded p-4 mt-6">
              <h3 className="font-semibold mb-2">Result:</h3>
              
              {actionData.success ? (
                <div className="space-y-2">
                  <div>
                    <strong>Provider:</strong> {actionData.result?.provider}
                  </div>
                  <div>
                    <strong>Execution Time:</strong> {actionData.result?.executionTime}ms
                  </div>
                  {actionData.result?.output && (
                    <div>
                      <strong>Output:</strong>
                      <pre className="bg-gray-100 p-2 rounded mt-1 text-sm overflow-x-auto">
                        {actionData.result.output}
                      </pre>
                    </div>
                  )}
                  {actionData.result?.error && (
                    <div>
                      <strong>Error:</strong>
                      <pre className="bg-red-100 p-2 rounded mt-1 text-sm overflow-x-auto text-red-700">
                        {actionData.result.error}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-red-600">
                  <strong>Error:</strong> {actionData.error}
                </div>
              )}
            </div>
          )}
        </main>
      </body>
    </html>
  );
}