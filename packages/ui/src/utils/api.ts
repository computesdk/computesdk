import type { ExecutionResult, Runtime, ExecutionOptions } from '../types/index.js'

export interface ExecuteCodeRequest {
  code: string
  runtime: Runtime
  options?: ExecutionOptions
}

export interface ExecuteCodeResponse extends ExecutionResult {}

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

export async function executeCode(
  request: ExecuteCodeRequest,
  endpoint: string = '/api/execute'
): Promise<ExecuteCodeResponse> {
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

    const result: ExecuteCodeResponse = await response.json()
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

export function formatOutput(output: string): string {
  return output.trim()
}

export function isExecutionError(result: ExecutionResult): boolean {
  return !result.success || !!result.error || !!result.result?.error
}

export function getErrorMessage(result: ExecutionResult): string {
  if (result.error) {
    return result.error
  }
  
  if (result.result?.error) {
    return result.result.error
  }
  
  if (!result.success) {
    return 'Execution failed'
  }
  
  return 'Unknown error'
}