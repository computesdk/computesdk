import type { APIRoute } from 'astro';
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';
// import { vercel } from '@computesdk/vercel';
// import { daytona } from '@computesdk/daytona';

export const POST: APIRoute = async ({ request }) => {
  try {
    const computeRequest = await request.json();

    // Configure your provider - uncomment one of the following:
    const provider = e2b({ apiKey: import.meta.env.E2B_API_KEY });
    // const provider = vercel({ token: import.meta.env.VERCEL_TOKEN, teamId: import.meta.env.VERCEL_TEAM_ID, projectId: import.meta.env.VERCEL_PROJECT_ID });
    // const provider = daytona({ apiKey: import.meta.env.DAYTONA_API_KEY });

    const response = await handleComputeRequest({
      request: computeRequest,
      provider: provider
    });

    return new Response(
      JSON.stringify(response),
      {
        status: response.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Request handling error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        sandboxId: '',
        provider: 'unknown'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
