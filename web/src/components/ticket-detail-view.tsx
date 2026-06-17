'use client'

import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  User,
  MonitorPlay,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useRemotableStore, type TicketStatus } from '@/lib/store'

const statusLabels: Record<TicketStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  waiting_user: 'Ожидает ответа',
  resolved: 'Решено',
  cancelled: 'Отменено',
}

const statusColors: Record<TicketStatus, string> = {
  pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  waiting_user: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

const priorityConfig: Record<number, { label: string; color: string }> = {
  1: { label: 'Критический', color: 'text-red-400' },
  2: { label: 'Высокий', color: 'text-orange-400' },
  3: { label: 'Средний', color: 'text-yellow-400' },
  4: { label: 'Низкий', color: 'text-emerald-400' },
  5: { label: 'Информационный', color: 'text-gray-400' },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TicketDetailView() {
  const [actionLoading, setActionLoading] = useState(false)

  const selectedTicket = useRemotableStore((s) => s.selectedTicket)
  const currentUser = useRemotableStore((s) => s.currentUser)
  const selectTicket = useRemotableStore((s) => s.selectTicket)
  const updateTicketStatus = useRemotableStore((s) => s.updateTicketStatus)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const setTickets = useRemotableStore((s) => s.setTickets)
  const setSession = useRemotableStore((s) => s.setSession)
  const setConnectionStatus = useRemotableStore((s) => s.setConnectionStatus)
  const addNotification = useRemotableStore((s) => s.addNotification)

  const ticket = selectedTicket
  const priority = ticket ? (priorityConfig[ticket.priority] || priorityConfig[3]) : null
  const statusStyle = ticket ? (statusColors[ticket.status] || statusColors.pending) : null
  const isUser = currentUser?.role === 'user'
  const isSpecialist = currentUser?.role === 'specialist'

  // Fetch ticket details
  useEffect(() => {
    const ticketId = selectedTicket?.id
    if (!ticketId) return

    async function fetchData() {
      try {
        const res = await fetch(`/api/tickets/${ticketId}`)
        const data = await res.json()
        if (data.success) {
          selectTicket(data.ticket)
        }
      } catch { /* silent */ }
    }

    fetchData()
  }, [selectedTicket?.id, selectTicket])

  const handleResolve = async () => {
    if (!ticket?.id) return
    setActionLoading(true)
    try {
      await fetch(`/api/tickets/${ticket.id}/resolve`, { method: 'POST' })
      updateTicketStatus(ticket.id, 'resolved')
    } catch { /* silent */ }
    setActionLoading(false)
  }

  const handleCancel = async () => {
    if (!ticket?.id) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const data = await res.json()
      if (data.success) {
        updateTicketStatus(ticket.id, 'cancelled')
      }
    } catch { /* silent */ }
    setActionLoading(false)
  }

  const handleAccept = async () => {
    if (!ticket?.id || !currentUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'in_progress',
          specialistId: currentUser.id,
        }),
      })
      const data = await res.json()
      if (data.success) {
        updateTicketStatus(ticket.id, 'in_progress')
        selectTicket(data.ticket)
        const listRes = await fetch(
          `/api/tickets?role=specialist&specialistId=${currentUser.id}`,
        )
        const listData = await listRes.json()
        if (listData.success) {
          setTickets(listData.tickets)
        }
        addNotification({
          type: 'success',
          title: 'Заявка принята',
          message: `Вы приняли заявку «${ticket.title}»`,
        })
      }
    } catch { /* silent */ }
    setActionLoading(false)
  }

  const handleStartSession = async () => {
    if (!ticket?.id || !currentUser) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.id,
          clientUserId: ticket.creatorId,
          specialistUserId: currentUser.id,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSession(data.session)
        setConnectionStatus('active')
        setCurrentView('session')
        addNotification({
          type: 'success',
          title: 'Сеанс запущен',
          message: 'Удалённый сеанс начат',
        })
      }
    } catch { /* silent */ }
    setActionLoading(false)
  }

  const goBack = () => {
    selectTicket(null)
    if (isSpecialist) {
      setCurrentView('specialist-dashboard')
    } else {
      setCurrentView('client-dashboard')
    }
  }

  if (!ticket || !priority || !statusStyle) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        Заявка не найдена
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-white">{ticket.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs font-normal ${statusStyle}`}
                >
                  {statusLabels[ticket.status]}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs font-normal text-slate-400"
                >
                  {ticket.category}
                </Badge>
                <span className={`text-xs font-medium ${priority.color}`}>
                  Приоритет: {priority.label}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isSpecialist && ticket.status === 'pending' && (
                <Button
                  onClick={handleAccept}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  size="sm"
                  disabled={actionLoading}
                >
                  {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Принять заявку
                </Button>
              )}
              {isSpecialist && ticket.status === 'in_progress' && (
                <Button
                  onClick={handleStartSession}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  size="sm"
                  disabled={actionLoading}
                >
                  {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  <MonitorPlay className="mr-1.5 h-3.5 w-3.5" />
                  Начать сеанс
                </Button>
              )}
              {(ticket.status === 'in_progress' || ticket.status === 'waiting_user') &&
                (isUser || isSpecialist) && (
                  <Button
                    onClick={handleResolve}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    size="sm"
                    disabled={actionLoading}
                  >
                    {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                    Завершить
                  </Button>
                )}
              {isUser && ticket.status === 'pending' && (
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  size="sm"
                  disabled={actionLoading}
                >
                  {actionLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Отменить
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <Separator className="bg-slate-800" />

        <CardContent className="space-y-6 pt-4">
          {/* Meta info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Дата создания</p>
              <div className="flex items-center gap-1.5 text-sm text-slate-300">
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                {formatDate(ticket.createdAt)}
              </div>
            </div>
            {ticket.specialist && (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Специалист</p>
                <div className="flex items-center gap-1.5 text-sm text-slate-300">
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  {ticket.specialist.username}
                </div>
              </div>
            )}
            {ticket.resolvedAt && (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Дата решения</p>
                <div className="flex items-center gap-1.5 text-sm text-slate-300">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                  {formatDate(ticket.resolvedAt)}
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-slate-800" />

          {/* Description */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-300">Описание</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
              {ticket.description}
            </p>
          </div>

          <Separator className="bg-slate-800" />

          {/* Timeline */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-slate-300">Хронология</h3>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <div className="h-full w-px bg-slate-800" />
                </div>
                <div className="pb-3">
                  <p className="text-sm text-slate-300">Заявка создана</p>
                  <p className="text-xs text-slate-500">{formatDate(ticket.createdAt)}</p>
                </div>
              </div>
              {ticket.specialist && (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <div className="h-full w-px bg-slate-800" />
                  </div>
                  <div className="pb-3">
                    <p className="text-sm text-slate-300">
                      Специалист {ticket.specialist.username} принял в работу
                    </p>
                    <p className="text-xs text-slate-500">{formatDate(ticket.updatedAt)}</p>
                  </div>
                </div>
              )}
              {ticket.status === 'resolved' && ticket.resolvedAt && (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-300">Заявка решена</p>
                    <p className="text-xs text-slate-500">{formatDate(ticket.resolvedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}