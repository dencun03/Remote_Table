import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET() {
  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
        role: { select: { name: true } },
        _count: { select: { createdTickets: true, assignedTickets: true, sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, users })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, roleId, isActive } = body

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId обязателен' }, { status: 400 })
    }

    const parsedId = parseInt(userId)
    const updateData: Record<string, unknown> = {}

    if (roleId !== undefined) {
      const parsedRoleId = parseInt(roleId)
      const role = await db.role.findUnique({ where: { id: parsedRoleId } })
      if (!role) {
        return NextResponse.json({ success: false, error: 'Роль не найдена' }, { status: 404 })
      }
      updateData.roleId = parsedRoleId
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: 'Нет данных для обновления' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id: parsedId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        role: { select: { name: true } },
      },
    })

    const changes: string[] = []
    if (updateData.roleId) changes.push(`роль → ${user.role.name}`)
    if (updateData.isActive !== undefined) changes.push(`активность → ${user.isActive ? 'вкл' : 'выкл'}`)

    try {
      await db.actionLog.create({
        data: {
          userId: parsedId,
          eventType: 'admin_update',
          description: `Админ изменил: ${changes.join(', ')} для ${user.username}`,
        },
      })
    } catch {}

    return NextResponse.json({ success: true, user })
  } catch (error) {
    return apiError(error)
  }
}