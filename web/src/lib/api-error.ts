import { NextResponse } from 'next/server'

export function apiError(error: unknown, status = 500) {
  console.error('[API ERROR]', error)
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json(
    { success: false, error: 'Internal server error', debug: message },
    { status }
  )
}