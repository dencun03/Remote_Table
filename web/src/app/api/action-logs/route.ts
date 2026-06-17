import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')
    const sessionId = request.nextUrl.searchParams.get('sessionId')
    const eventType = request.nextUrl.searchParams.get('eventType')
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50')

    const where: Record<string, unknown> = {}
    if (userId) where.userId = userId
    if (sessionId) where.sessionId = sessionId
    if (eventType) where.eventType = eventType

    const logs = await db.actionLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, role: true },
        },
        session: {
          select: { id: true, status: true, startTime: true },
        },
      },
      orderBy: { eventTime: 'desc' },
      take: limit,
    })

    return NextResponse.json({ success: true, logs })
  } catch (error) {
    return apiError(error)
  }
}