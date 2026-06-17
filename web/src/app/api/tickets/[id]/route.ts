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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ticket = await db.ticket.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true, email: true, avatar: true } },
        specialist: { select: { id: true, username: true, email: true, avatar: true } },
        chat: {
          include: {
            status: { select: { name: true } },
          },
        },
      },
    })

    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, ticket: stringifyTicket(ticket as unknown as Record<string, unknown>) })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, specialistId, notes } = body

    const ticket = await db.ticket.findUnique({ where: { id } })
    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (status !== undefined) data.status = status
    if (specialistId !== undefined) data.specialistId = specialistId ? parseInt(specialistId) : null
    if (notes !== undefined) data.description = notes

    const updatedTicket = await db.ticket.update({
      where: { id },
      data,
      include: {
        creator: { select: { id: true, username: true } },
        specialist: { select: { id: true, username: true } },
      },
    })

    return NextResponse.json({ success: true, ticket: stringifyTicket(updatedTicket as unknown as Record<string, unknown>) })
  } catch (error) {
    return apiError(error)
  }
}