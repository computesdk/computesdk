// @ts-nocheck
import { json, error } from '@sveltejs/kit';
import { handleComputeRequest } from 'computesdk';
// import { e2b } from '@computesdk/e2b';
// import { vercel } from '@computesdk/vercel';
// import { daytona } from '@computesdk/daytona';

export const POST = async ({ request }) => {
  try {
    const computeRequest = await request.json();
    const response = await handleComputeRequest({
      request: computeRequest,
      provider: undefined // e2b() | vercel() | daytona()
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