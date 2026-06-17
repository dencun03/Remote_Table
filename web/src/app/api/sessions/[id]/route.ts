import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, endedAt, durationSeconds, notes } = body

    const session = await db.session.findUnique({ where: { id: parseInt(id) } })
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (notes !== undefined) data.notes = notes
    if (endedAt !== undefined) {
      data.endTime = endedAt ? new Date(endedAt) : new Date()
      if (durationSeconds !== undefined) {
        data.durationSeconds = durationSeconds
      } else if (session.startTime) {
        data.durationSeconds = Math.floor(
          (new Date().getTime() - session.startTime.getTime()) / 1000
        )
      }
    }

    // Обновить статус сессии
    if (status) {
      const newStatus = await db.status.findFirst({ where: { name: status, category: 'session' } })
      if (newStatus) data.statusId = newStatus.id
    }

    const updatedSession = await db.session.update({
      where: { id: parseInt(id) },
      data,
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        remoteComputer: { select: { id: true, name: true, ipAddress: true } },
        status: { select: { name: true } },
      },
    })

    return NextResponse.json({ success: true, session: updatedSession })
  } catch (error) {
    return apiError(error)
  }
}