import { NextRequest, NextResponse } from 'next/server'
import { handleComputeRequest } from 'computesdk'
// import { e2b } from '@computesdk/e2b'
// import { vercel } from '@computesdk/vercel'
// import { daytona } from '@computesdk/daytona'

export async function POST(request: NextRequest) {
  try {
    const computeRequest = await request.json()
    const response = await handleComputeRequest({
      request: computeRequest,
      provider: undefined // e2b() | vercel() | daytona()
    })
    
    return NextResponse.json(response, { 
      status: response.success ? 200 : 500 
    })
    
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