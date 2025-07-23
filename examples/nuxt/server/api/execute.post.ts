// @ts-nocheck
import { ComputeSDK } from 'computesdk'

export default defineEventHandler(async (event) => {
  try {
    const { code, runtime = 'python' } = await readBody(event)

    if (!code || typeof code !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Code is required and must be a string'
      })
    }

    const sandbox = ComputeSDK.createSandbox({})
    const result = await sandbox.execute(code, runtime as 'node' | 'python')

    return {
      success: true,
      result: {
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        provider: result.provider
      }
    }
  } catch (error) {
    console.error('Execution error:', error)
    
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
})