import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/password'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, email, password } = body

    if (!username || !email || !password) {
      return NextResponse.json({ success: false, error: 'Заполните все поля' }, { status: 400 })
    }

    const existingUser = await db.user.findFirst({
      where: { OR: [{ username }, { email }] },
    })
    if (existingUser) {
      return NextResponse.json({ success: false, error: 'Пользователь с таким именем или email уже существует' }, { status: 409 })
    }

    // Всегда назначаем роль "user" — роли назначает администратор
    const role = await db.role.findFirst({ where: { name: 'user' } })
    if (!role) {
      return NextResponse.json({ success: false, error: 'Роль не найдена. Запустите seed.' }, { status: 500 })
    }

    const passwordHash = await hashPassword(password)

    const user = await db.user.create({
      data: { username, email, passwordHash, roleId: role.id, isActive: true },
      include: { role: { select: { name: true } } },
    })

    try {
      await db.actionLog.create({
        data: { userId: user.id, eventType: 'register', description: 'Регистрация: ' + username },
      })
    } catch {}

    return NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, role: role.name, avatar: user.avatar },
    })
  } catch (error) {
    console.error('[REGISTER ERROR]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: 'Ошибка регистрации', debug: message }, { status: 500 })
  }
}