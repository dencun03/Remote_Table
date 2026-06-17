import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET() {
  try {
    const roles = await db.role.findMany({
      select: { id: true, name: true, description: true },
      orderBy: { id: 'asc' },
    })

    return NextResponse.json({ success: true, roles })
  } catch (error) {
    return apiError(error)
  }
}