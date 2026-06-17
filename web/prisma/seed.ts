import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...\n')

  // ── Роли ──
  console.log('→ Creating roles...')
  await prisma.role.upsert({ where: { name: 'user' }, update: {}, create: { name: 'user', description: 'Обычный пользователь — клиент' } })
  await prisma.role.upsert({ where: { name: 'specialist' }, update: {}, create: { name: 'specialist', description: 'Специалист технической поддержки' } })
  await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin', description: 'Администратор системы' } })

  // ── Статусы компьютеров ──
  console.log('→ Creating computer statuses...')
  for (const [name, desc] of [['online','Компьютер подключён'],['offline','Компьютер отключён'],['busy','Занят другой сессией'],['maintenance','На обслуживании']]) {
    await prisma.status.upsert({ where: { name_category: { name, category: 'computer' } }, update: {}, create: { name, category: 'computer', description: desc } })
  }

  // ── Статусы сессий ──
  console.log('→ Creating session statuses...')
  for (const [name, desc] of [['waiting','Ожидание подключения'],['active','Активная сессия'],['ended','Сессия завершена'],['failed','Ошибка подключения']]) {
    await prisma.status.upsert({ where: { name_category: { name, category: 'session' } }, update: {}, create: { name, category: 'session', description: desc } })
  }

  // ── Статусы чатов ──
  console.log('→ Creating chat statuses...')
  for (const [name, desc] of [['active','Чат активен'],['closed','Чат закрыт']]) {
    await prisma.status.upsert({ where: { name_category: { name, category: 'chat' } }, update: {}, create: { name, category: 'chat', description: desc } })
  }

  // ── Типы сообщений ──
  console.log('→ Creating message types...')
  for (const name of ['text', 'file', 'image', 'system']) {
    await prisma.messageType.upsert({ where: { name }, update: {}, create: { name } })
  }

  // ── Разрешения ──
  console.log('→ Creating permissions...')
  for (const name of ['view_screen','control_mouse','control_keyboard','file_transfer','clipboard','task_manager','command_line','registry']) {
    await prisma.permission.upsert({ where: { name }, update: {}, create: { name } })
  }

  // ── Администратор по умолчанию ──
  console.log('→ Creating default admin...')
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } })
  const existingAdmin = await prisma.user.findFirst({ where: { username: 'admin' } })
  if (adminRole && !existingAdmin) {
    const hash = await bcrypt.hash('admin', 10)
    await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@remotable.local',
        passwordHash: hash,
        roleId: adminRole.id,
        isActive: true,
      },
    })
    console.log('   Admin created: admin / admin')
  } else if (existingAdmin) {
    console.log('   Admin user already exists, skipping')
  }

  console.log('\n✅ Seed completed!')
}

main().catch((e) => { console.error('❌ Seed failed:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())