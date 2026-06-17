import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')
    const status = request.nextUrl.searchParams.get('status')

    const where: Record<string, unknown> = {}

    if (userId) {
      where.userId = parseInt(userId)
    }
    if (status) {
      where.status = { name: status }
    }

    const sessions = await db.session.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        remoteComputer: { select: { id: true, name: true, ipAddress: true } },
        status: { select: { name: true } },
        ticket: { select: { id: true, title: true, status: true } },
      },
      orderBy: { startTime: 'desc' },
    })

    return NextResponse.json({ success: true, sessions })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, specialistUserId, clientUserId, remoteComputerId, ticketId, clientIp } = body

    // Поддерживаем оба формата: userId или specialistUserId
    const specialistId = specialistUserId || userId
    if (!specialistId) {
      return NextResponse.json(
        { success: false, error: 'userId or specialistUserId is required' },
        { status: 400 }
      )
    }

    // Найти или создать placeholder для удалённого компьютера
    let computerId = remoteComputerId ? parseInt(remoteComputerId) : null

    if (!computerId && clientUserId) {
      let computer = await db.remoteComputer.findFirst({
        where: { name: `Client-${clientUserId}` },
      })
      if (!computer) {
        const onlineStatus = await db.status.findFirst({ where: { name: 'online', category: 'computer' } })
        computer = await db.remoteComputer.create({
          data: {
            name: `Client-${clientUserId}`,
            statusId: onlineStatus?.id ?? 1,
          },
        })
      }
      computerId = computer.id
    }

    if (!computerId) {
      return NextResponse.json(
        { success: false, error: 'remoteComputerId is required (or provide clientUserId)' },
        { status: 400 }
      )
    }

    // Найти статус "waiting"
    const sessionStatus = await db.status.findFirst({ where: { name: 'waiting', category: 'session' } })
    if (!sessionStatus) {
      return NextResponse.json({ success: false, error: 'Session status "waiting" not found. Run seed script.' }, { status: 500 })
    }

    const session = await db.session.create({
      data: {
        userId: parseInt(specialistId),
        remoteComputerId: computerId,
        ticketId: ticketId || null,
        startTime: new Date(),
        clientIp: clientIp || null,
        statusId: sessionStatus.id,
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        remoteComputer: { select: { id: true, name: true, ipAddress: true } },
        status: { select: { name: true } },
      },
    })

    return NextResponse.json({ success: true, session })
  } catch (error) {
    return apiError(error)
  }
}