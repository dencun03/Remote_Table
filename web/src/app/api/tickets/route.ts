import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

function stringifyTicket(t: Record<string, unknown>) {
  return {
    ...t,
    id: String(t.id),
    creatorId: t.creatorId != null ? String(t.creatorId) : undefined,
    specialistId: t.specialistId != null ? String(t.specialistId) : undefined,
    creator: t.creator
      ? { ...t.creator, id: String((t.creator as Record<string, unknown>).id) }
      : undefined,
    specialist: t.specialist
      ? { ...t.specialist, id: String((t.specialist as Record<string, unknown>).id) }
      : undefined,
  }
}

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status')
    const role = request.nextUrl.searchParams.get('role')
    const userId = request.nextUrl.searchParams.get('userId')
    const specialistId = request.nextUrl.searchParams.get('specialistId')

    const where: Record<string, unknown> = {}

    if (status) where.status = status

    if (role === 'specialist') {
      if (specialistId) {
        where.specialistId = parseInt(specialistId)
      } else {
        where.status = 'pending'
        where.specialistId = null
      }
    } else if (role === 'user' && userId) {
      where.creatorId = parseInt(userId)
    }

    const tickets = await db.ticket.findMany({
      where,
      include: {
        creator: { select: { id: true, username: true } },
        specialist: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      tickets: tickets.map(stringifyTicket),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, description, category, creatorId, priority } = body

    if (!title || !description || !category || !creatorId) {
      return NextResponse.json(
        { success: false, error: 'title, description, category, and creatorId are required' },
        { status: 400 }
      )
    }

    const ticket = await db.ticket.create({
      data: {
        title,
        description,
        category,
        priority: priority ?? 2,
        status: 'pending',
        creatorId: parseInt(creatorId),
      },
      include: {
        creator: { select: { id: true, username: true } },
      },
    })

    return NextResponse.json({ success: true, ticket: stringifyTicket(ticket as unknown as Record<string, unknown>) })
  } catch (error) {
    return apiError(error)
  }
}