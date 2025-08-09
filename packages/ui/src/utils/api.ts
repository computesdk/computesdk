import type { ComputeRequest, ComputeResponse, Runtime } from '../types/index.js'

/**
 * API Error class for compute operations
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message)
    this.name = 'APIError'
  }
}

/**
 * Execute a compute request against the API
 */
export async function executeComputeRequest(
  request: ComputeRequest,
  endpoint: string = '/api/compute'
): Promise<ComputeResponse> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      let errorCode = response.status.toString()
      
      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMessage = errorData.error
        }
        if (errorData.code) {
          errorCode = errorData.code
        }
      } catch {
        // If we can't parse the error response, use the default message
      }
      
      throw new APIError(errorMessage, response.status, errorCode)
    }

    const result: ComputeResponse = await response.json()
    return result
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new APIError('Network error: Unable to connect to the API endpoint')
    }
    
    throw new APIError(
      error instanceof Error ? error.message : 'An unexpected error occurred'
    )
  }
}

/**
 * Format execution time for display
 */
export function formatExecutionTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`
  }
  
  const seconds = milliseconds / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Format output for display
 */
export function formatOutput(output: string): string {
  return output.trim()
}

/**
 * Check if a compute response indicates an error
 */
export function isComputeError(response: ComputeResponse): boolean {
  return !response.success || !!response.error
}

/**
 * Get error message from compute response
 */
export function getErrorMessage(response: ComputeResponse): string {
  if (response.error) {
    return response.error
  }
  
  if (!response.success) {
    return 'Operation failed'
  }
  
  return 'Unknown error'
}