// @ts-nocheck
import { handleComputeRequest } from 'computesdk'

export default defineEventHandler(async (event) => {
  try {
    const computeRequest = await readBody(event)
    const response = await handleComputeRequest(computeRequest)
    
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