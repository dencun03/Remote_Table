import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/password'

// Временный эндпоинт для сброса пароля.
// Вызовите: POST /api/auth/reset-password
// Body: { "username": "admin", "newPassword": "admin" }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, newPassword } = body

    if (!username || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Укажите username и newPassword' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({ where: { username } })
    if (!user) {
      return NextResponse.json(
        { success: false, error: `Пользователь "${username}" не найден` },
        { status: 404 }
      )
    }

    const hash = await hashPassword(newPassword)

    await db.user.update({
      where: { username },
      data: { passwordHash: hash },
    })

    return NextResponse.json({
      success: true,
      message: `Пароль для "${username}" обновлён`,
    })
  } catch (error) {
    console.error('[RESET PASSWORD ERROR]', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: 'Ошибка сброса пароля', debug: msg },
      { status: 500 }
    )
  }
}