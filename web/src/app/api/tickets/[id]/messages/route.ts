import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ticket = await db.ticket.findUnique({ where: { id } })
    if (!ticket) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 })
    }

    const chat = await db.chat.findUnique({ where: { ticketId: id } })
    if (!chat) {
      return NextResponse.json({ success: true, messages: [] })
    }

    const messages = await db.message.findMany({
      where: { chatId: chat.id },
      include: {
        sender: { select: { id: true, username: true, role: { select: { name: true } } } },
        messageType: { select: { name: true } },
      },
      orderBy: { sentAt: 'asc' },
    })

    return NextResponse.json({ success: true, messages })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { senderId, text } = body

    if (!senderId || !text?.trim()) {
      return NextResponse.json(
        { success: false, error: 'senderId and text are required' },
        { status: 400 }
      )
    }

    // Найти тип сообщения
    const textType = await db.messageType.findFirst({ where: { name: 'text' } })
    if (!textType) {
      return NextResponse.json({ success: false, error: 'Message type "text" not found. Run seed script.' }, { status: 500 })
    }

    // Найти или создать чат для заявки
    let chat = await db.chat.findUnique({ where: { ticketId: id } })

    if (!chat) {
      const ticket = await db.ticket.findUnique({ where: { id } })
      if (!ticket) {
        return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 })
      }

      // Найти статус "active" для чата
      const chatStatus = await db.status.findFirst({ where: { name: 'active', category: 'chat' } })
      if (!chatStatus) {
        return NextResponse.json({ success: false, error: 'Chat status "active" not found. Run seed script.' }, { status: 500 })
      }

      chat = await db.chat.create({
        data: {
          ticketId: id,
          statusId: chatStatus.id,
        },
      })

      // Добавить участников
      if (ticket.creatorId) {
        await db.chatParticipant.create({
          data: { chatId: chat.id, userId: ticket.creatorId, role: 'client' },
        })
      }
      if (ticket.specialistId) {
        await db.chatParticipant.create({
          data: { chatId: chat.id, userId: ticket.specialistId, role: 'specialist' },
        })
      }
    }

    const message = await db.message.create({
      data: {
        chatId: chat.id,
        senderId: parseInt(senderId),
        messageTypeId: textType.id,
        content: text.trim(),
      },
      include: {
        sender: { select: { id: true, username: true, role: { select: { name: true } } } },
        messageType: { select: { name: true } },
      },
    })

    return NextResponse.json({ success: true, message })
  } catch (error) {
    return apiError(error)
  }
}