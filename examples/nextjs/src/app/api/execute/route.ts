import { NextRequest, NextResponse } from 'next/server'
import { ComputeSDK } from 'computesdk'

export async function POST(request: NextRequest) {
  try {
    const { code, runtime = 'python' } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Code is required and must be a string' },
        { status: 400 }
      )
    }

    const sandbox = ComputeSDK.createSandbox({})
    const result = await sandbox.execute(code, runtime)

    return NextResponse.json({
      success: true,
      result: {
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        provider: result.provider
      }
    })
  } catch (error) {
    console.error('Execution error:', error)
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    )
  }
}