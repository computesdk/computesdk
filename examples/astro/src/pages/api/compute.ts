import type { APIRoute } from 'astro';
import { handleComputeRequest } from 'computesdk';
// import { e2b } from '@computesdk/e2b';
// import { vercel } from '@computesdk/vercel';
// import { daytona } from '@computesdk/daytona';

export const POST: APIRoute = async ({ request }) => {
  try {
    const computeRequest = await request.json();
    
    // Configure your provider - uncomment one of the following:
    // const provider = e2b({ apiKey: process.env.E2B_API_KEY! });
    // const provider = vercel({ token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! });
    // const provider = daytona({ apiKey: process.env.DAYTONA_API_KEY! });
    
    const response = await handleComputeRequest({
      request: computeRequest,
      // @ts-ignore - Uncomment a provider above
      provider: undefined
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