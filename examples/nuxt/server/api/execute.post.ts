// @ts-nocheck
import { handleComputeRequest } from 'computesdk'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    // Support both old format (for backward compatibility) and new unified format
    let computeRequest;
    
    if (body.operation && body.action) {
      // New unified format
      computeRequest = body;
    } else if (body.code) {
      // Legacy format - convert to new format
      computeRequest = {
        operation: 'sandbox',
        action: 'execute',
        payload: {
          code: body.code,
          runtime: body.runtime || 'python'
        }
      };
    } else {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request format. Expected either {operation, action, payload} or legacy {code, runtime}'
      })
    }

    const response = await handleComputeRequest(computeRequest)
    
    // If the operation failed, throw an error with appropriate status
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