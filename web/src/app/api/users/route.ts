import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(request: NextRequest) {
  try {
    const roleName = request.nextUrl.searchParams.get('role')

    const users = await db.user.findMany({
      where: roleName ? { role: { name: roleName } } : undefined,
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        avatar: true,
        createdAt: true,
        lastLogin: true,
        role: { select: { name: true, description: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, users })
  } catch (error) {
    return apiError(error)
  }
}