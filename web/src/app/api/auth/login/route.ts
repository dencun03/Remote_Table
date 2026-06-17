import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { verifyPassword, hashPassword } from '@/lib/password'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Заполните все поля' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { username },
      include: { role: { select: { name: true } } },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Пользователь не найден' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: 'Аккаунт отключён' },
        { status: 403 }
      )
    }

    // Проверка пароля: сначала bcrypt, затем fallback на plain text
    // (для случаев когда пароль был задан вручную в pgAdmin)
    let valid = false
    if (user.passwordHash.startsWith('$2')) {
      // bcrypt хеш
      valid = await verifyPassword(password, user.passwordHash)
    } else {
      // Plain text fallback — пароль хранится в открытом виде
      valid = password === user.passwordHash
    }

    // Если пароль верный но не захеширован — захешируем автоматически
    if (valid && !user.passwordHash.startsWith('$2')) {
      try {
        const newHash = await hashPassword(password)
        await db.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        })
      } catch {}
    }

    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Неверный пароль' },
        { status: 401 }
      )
    }

    await db.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    // Аудит
    try {
      await db.actionLog.create({
        data: {
          userId: user.id,
          eventType: 'login',
          description: `Вход пользователя ${username}`,
        },
      })
    } catch {}

    return NextResponse.json({
      success: true,
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
        role: user.role.name,
        avatar: user.avatar,
      },
    })
  } catch (error) {
    return apiError(error)
  }
}