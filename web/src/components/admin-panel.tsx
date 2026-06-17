'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Shield,
  Users,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  RefreshCw,
  UserCog,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRemotableStore } from '@/lib/store'

interface UserRow {
  id: number
  username: string
  email: string
  isActive: boolean
  createdAt: string
  lastLogin: string | null
  role: { name: string }
  _count: { createdTickets: number; assignedTickets: number; sessions: number }
}

interface Role {
  id: number
  name: string
  description: string | null
}

const roleConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; color: string }> = {
  admin: { label: 'Администратор', variant: 'destructive', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  specialist: { label: 'Специалист', variant: 'default', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  user: { label: 'Пользователь', variant: 'secondary', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
}

export function AdminPanel() {
  const currentUser = useRemotableStore((s) => s.currentUser)

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [changingRole, setChangingRole] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/roles'),
      ])
      const usersData = await usersRes.json()
      const rolesData = await rolesRes.json()
      if (usersData.success) setUsers(usersData.users)
      if (rolesData.success) setRoles(rolesData.roles)
    } catch (err) {
      console.error('Failed to fetch admin data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRoleChange = async (userId: number, newRoleId: number) => {
    setChangingRole(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roleId: newRoleId }),
      })
      const data = await res.json()
      if (data.success) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: { name: data.user.role.name } } : u)),
        )
      }
    } catch (err) {
      console.error('Failed to change role:', err)
    } finally {
      setChangingRole(null)
    }
  }

  const handleToggleActive = async (user: UserRow) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isActive: !user.isActive }),
      })
      const data = await res.json()
      if (data.success) {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u)),
        )
      }
    } catch (err) {
      console.error('Failed to toggle user:', err)
    }
  }

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  )

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const stats = {
    total: users.length,
    active: users.filter((u) => u.isActive).length,
    admins: users.filter((u) => u.role.name === 'admin').length,
    specialists: users.filter((u) => u.role.name === 'specialist').length,
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
          <Shield className="h-7 w-7 text-emerald-400" />
          Панель администратора
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Управление пользователями и назначение ролей
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Всего пользователей', value: stats.total, icon: Users, color: 'text-blue-400' },
          { label: 'Активных', value: stats.active, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Специалистов', value: stats.specialists, icon: UserCog, color: 'text-amber-400' },
          { label: 'Администраторов', value: stats.admins, icon: Shield, color: 'text-red-400' },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-800 bg-slate-900/50">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users table */}
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold text-white">
            <Users className="h-5 w-5 text-slate-400" />
            Пользователи
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Поиск по имени или email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-64 border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder:text-slate-500"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchData}
              className="h-9 w-9 text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-800 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="pb-3 pr-4">Пользователь</th>
                  <th className="pb-3 pr-4">Роль</th>
                  <th className="hidden pb-3 pr-4 md:table-cell">Заявки</th>
                  <th className="hidden pb-3 pr-4 lg:table-cell">Регистрация</th>
                  <th className="hidden pb-3 lg:table-cell">Последний вход</th>
                  <th className="pb-3 pr-4 text-right">Статус</th>
                  <th className="pb-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredUsers.map((user) => {
                  const roleCfg = roleConfig[user.role.name] || roleConfig.user
                  const isSelf = currentUser && user.id === parseInt(currentUser.id)

                  return (
                    <tr key={user.id} className="group transition-colors hover:bg-slate-800/30">
                      {/* User info */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-400">
                            {user.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-200">
                              {user.username}
                              {isSelf && (
                                <span className="ml-2 text-[10px] text-slate-500">(вы)</span>
                              )}
                            </p>
                            <p className="truncate text-xs text-slate-500">{user.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role selector */}
                      <td className="py-3 pr-4">
                        {isSelf ? (
                          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${roleCfg.color}`}>
                            {roleCfg.label}
                          </span>
                        ) : (
                          <div className="relative">
                            {changingRole === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                            ) : (
                              <select
                                value={user.role.name}
                                onChange={(e) => handleRoleChange(user.id, parseInt(e.target.value))}
                                className="cursor-pointer appearance-none rounded-md border border-slate-700 bg-slate-800 px-2 py-1 pr-6 text-xs font-medium text-slate-300 hover:border-slate-600 focus:border-emerald-500 focus:outline-none"
                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                              >
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.description || r.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Tickets count */}
                      <td className="hidden py-3 pr-4 md:table-cell">
                        <div className="text-xs text-slate-400">
                          <span className="text-slate-300">{user._count.createdTickets}</span> создано
                          <span className="mx-1 text-slate-600">/</span>
                          <span className="text-slate-300">{user._count.assignedTickets}</span> назначено
                        </div>
                      </td>

                      {/* Created */}
                      <td className="hidden py-3 pr-4 text-xs text-slate-500 lg:table-cell">
                        {formatDate(user.createdAt)}
                      </td>

                      {/* Last login */}
                      <td className="hidden py-3 text-xs text-slate-500 lg:table-cell">
                        {user.lastLogin ? formatDate(user.lastLogin) : '—'}
                      </td>

                      {/* Active status */}
                      <td className="py-3 pr-4 text-right">
                        <Badge
                          variant={user.isActive ? 'outline' : 'secondary'}
                          className={`text-[10px] ${user.isActive ? 'border-emerald-500/30 text-emerald-400' : 'text-slate-500'}`}
                        >
                          {user.isActive ? 'Активен' : 'Отключён'}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right">
                        {!isSelf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleActive(user)}
                            className={`h-8 w-8 ${user.isActive ? 'text-slate-500 hover:text-red-400' : 'text-slate-500 hover:text-emerald-400'}`}
                            title={user.isActive ? 'Деактивировать' : 'Активировать'}
                          >
                            {user.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {filteredUsers.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-500">
                {search ? 'Пользователи не найдены' : 'Нет пользователей'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}