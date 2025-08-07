import { NextRequest, NextResponse } from 'next/server'
import { handleComputeRequest } from 'computesdk'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
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
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid request format. Expected either {operation, action, payload} or legacy {code, runtime}' 
        },
        { status: 400 }
      )
    }

    const response = await handleComputeRequest(computeRequest)
    
    // Return appropriate HTTP status based on success
    const status = response.success ? 200 : 500;
    
    return NextResponse.json(response, { status })
    
  } catch (error) {
    console.error('Request handling error:', error)
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        sandboxId: '',
        provider: 'unknown'
      },
      { status: 500 }
    )
  }
}