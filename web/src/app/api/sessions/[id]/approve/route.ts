import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (!action || !['approve', 'deny'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Неверное действие' },
        { status: 400 },
      )
    }

    // Обновляем статус сессии в БД
    const session = await db.session.findUnique({
      where: { id: parseInt(id) },
    })

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Сессия не найдена' },
        { status: 404 },
      )
    }

    const statusName = action === 'approve' ? 'active' : 'rejected'
    const newStatus = await db.status.findFirst({
      where: { name: statusName, category: 'session' },
    })
    if (!newStatus) {
      return NextResponse.json(
        { success: false, error: 'Статус не найден в БД' },
        { status: 500 },
      )
    }

    await db.session.update({
      where: { id: parseInt(id) },
      data: {
        statusId: newStatus.id,
      },
    })

    return NextResponse.json({ success: true, action })
  } catch (error) {
    console.error('Approve session error:', error)
    return NextResponse.json(
      { success: false, error: 'Ошибка сервера' },
      { status: 500 },
    )
  }
}