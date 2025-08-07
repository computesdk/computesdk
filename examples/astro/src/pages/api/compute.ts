import type { APIRoute } from 'astro';
import { handleComputeRequest } from 'computesdk';

export const POST: APIRoute = async ({ request }) => {
  try {
    const computeRequest = await request.json();
    const response = await handleComputeRequest(computeRequest);

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