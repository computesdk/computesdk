import { json, error } from '@sveltejs/kit';
import { handleComputeRequest } from 'computesdk';
// import { e2b } from '@computesdk/e2b';
// import { vercel } from '@computesdk/vercel';
// import { daytona } from '@computesdk/daytona';

export const POST = async ({ request }: { request: Request }) => {
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

    if (!response.success) {
      throw error(500, response.error || 'Unknown error occurred');
    }

    return json(response);
  } catch (err) {
    console.error('Request handling error:', err);
    
    // Re-throw SvelteKit error instances
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    
    throw error(500, err instanceof Error ? err.message : 'Unknown error occurred');
  }
};