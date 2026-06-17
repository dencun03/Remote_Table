import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET() {
  try {
    const [userCount, ticketCount, sessionCount, computerCount] = await Promise.all([
      db.user.count(),
      db.ticket.count(),
      db.session.count(),
      db.remoteComputer.count(),
    ])

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      users: userCount,
      tickets: ticketCount,
      sessions: sessionCount,
      computers: computerCount,
    })
  } catch (error) {
    return apiError(error, 503)
  }
}