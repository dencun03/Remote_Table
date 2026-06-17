import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface ActiveSession {
  id: string
  ticketId: string
  ticketTitle: string
  specialistUserId: string
  specialistName: string
  clientUserId?: string
  clientName?: string
  status: string
  startedAt: string
  role: 'client' | 'specialist'
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId не указан' },
        { status: 400 },
      )
    }

    const numUserId = parseInt(userId)

    const activeStatus = await db.status.findFirst({
      where: { name: 'active', category: 'session' },
    })
    const waitingStatus = await db.status.findFirst({
      where: { name: 'waiting', category: 'session' },
    })

    const statusIds = [activeStatus?.id, waitingStatus?.id].filter(Boolean) as number[]

    // Find sessions where user is specialist (userId field) OR where user is client (via ticket.creatorId)
    const sessions = await db.session.findMany({
      where: {
        statusId: { in: statusIds },
        OR: [
          { userId: numUserId },
          {
            ticket: {
              creatorId: numUserId,
            },
          },
        ],
      },
      include: {
        user: { select: { id: true, username: true } },
        ticket: {
          select: {
            id: true,
            title: true,
            creatorId: true,
            creator: { select: { id: true, username: true } },
          },
        },
        status: { select: { name: true } },
      },
      orderBy: { startTime: 'desc' },
      take: 10,
    })

    const result: ActiveSession[] = sessions.map((s) => {
      const isClient = s.userId !== numUserId
      return {
        id: String(s.id),
        ticketId: s.ticketId || '',
        ticketTitle: s.ticket?.title || '',
        specialistUserId: String(s.userId),
        specialistName: s.user.username,
        clientUserId: s.ticket?.creatorId ? String(s.ticket.creatorId) : undefined,
        clientName: s.ticket?.creator?.username || undefined,
        status: s.status.name,
        startedAt: s.startTime.toISOString(),
        role: isClient ? ('client' as const) : ('specialist' as const),
      }
    })

    return NextResponse.json({ success: true, sessions: result })
  } catch (error) {
    console.error('Active sessions error:', error)
    return NextResponse.json(
      { success: false, error: 'Ошибка сервера' },
      { status: 500 },
    )
  }
}