import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ticket = await db.ticket.findUnique({ where: { id } })
    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 })
    }

    const updatedTicket = await db.ticket.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date() },
      include: {
        creator: { select: { id: true, username: true } },
        specialist: { select: { id: true, username: true } },
      },
    })

    return NextResponse.json({ success: true, ticket: updatedTicket })
  } catch (error) {
    return apiError(error)
  }
}