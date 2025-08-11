import { handleComputeRequest } from 'computesdk'
// import { e2b } from '@computesdk/e2b'
// import { vercel } from '@computesdk/vercel'
// import { daytona } from '@computesdk/daytona'

export default defineEventHandler(async (event) => {
  try {
    const computeRequest = await readBody(event)
    
    // Configure your provider - uncomment one of the following:
    // const provider = e2b({ apiKey: process.env.E2B_API_KEY! })
    // const provider = vercel({ token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! })
    // const provider = daytona({ apiKey: process.env.DAYTONA_API_KEY! })
    
    const response = await handleComputeRequest({
      request: computeRequest,
      // @ts-ignore - Uncomment a provider above
      provider: undefined
    })
    
    if (!response.success) {
      throw createError({
        statusCode: 500,
        statusMessage: response.error || 'Unknown error occurred'
      })
    }
    
    return response
    
  } catch (error) {
    console.error('Request handling error:', error)
    
    // Re-throw createError instances
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
})