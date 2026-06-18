'use client'

import { useEffect, useState } from 'react'
import { ListTodo, Clock, CheckCircle, Loader2, UserPlus, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRemotableStore, type Ticket, type TicketStatus } from '@/lib/store'

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

const priorityConfig: Record<number, { label: string; dotClass: string }> = {
  1: { label: 'Критический', dotClass: 'bg-red-500' },
  2: { label: 'Высокий', dotClass: 'bg-orange-500' },
  3: { label: 'Средний', dotClass: 'bg-yellow-500' },
  4: { label: 'Низкий', dotClass: 'bg-emerald-500' },
  5: { label: 'Информационный', dotClass: 'bg-gray-400' },
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'только что'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  return `${days} дн. назад`
}

type TabKey = 'waiting' | 'my'

export function SpecialistDashboard() {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('waiting')
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  const currentUser = useRemotableStore((s) => s.currentUser)
  const tickets = useRemotableStore((s) => s.tickets)
  const setTickets = useRemotableStore((s) => s.setTickets)
  const selectTicket = useRemotableStore((s) => s.selectTicket)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)
  

  useEffect(() => {
    async function fetchData() {
      if (!currentUser) return
      setLoading(true)
      try {
        const [pendingRes, myRes] = await Promise.all([
          fetch('/api/tickets?role=specialist&status=pending'),
          fetch(`/api/tickets?role=specialist&specialistId=${currentUser.id}`),
        ])

        const pendingData = await pendingRes.json()
        const myData = await myRes.json()

        if (pendingData.success && myData.success) {
          const merged = new Map<string, Ticket>()
          for (const t of myData.tickets as Ticket[]) merged.set(t.id, t)
          for (const t of pendingData.tickets as Ticket[]) {
            if (!merged.has(t.id)) merged.set(t.id, t)
          }
          setTickets(Array.from(merged.values()))
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [currentUser, setTickets])

  const waitingTickets = tickets.filter(
    (t) => t.status === 'pending' && !t.specialistId,
  )
  const myTickets = tickets.filter(
    (t) => t.specialistId === currentUser?.id && t.status !== 'cancelled',
  )

  const pendingCount = waitingTickets.length
  const activeToday = myTickets.filter(
    (t) => t.status === 'in_progress' || t.status === 'waiting_user',
  ).length
  const resolvedToday = myTickets.filter((t) => t.status === 'resolved').length

  const refreshData = () => {
    if (!currentUser) return
    setLoading(true)
    Promise.all([
      fetch('/api/tickets?role=specialist&status=pending'),
      fetch(`/api/tickets?role=specialist&specialistId=${currentUser.id}`),
    ])
      .then(([pendingRes, myRes]) => Promise.all([pendingRes.json(), myRes.json()]))
      .then(([pendingData, myData]) => {
        if (pendingData.success && myData.success) {
          const merged = new Map<string, Ticket>()
          for (const t of myData.tickets as Ticket[]) merged.set(t.id, t)
          for (const t of pendingData.tickets as Ticket[]) {
            if (!merged.has(t.id)) merged.set(t.id, t)
          }
          setTickets(Array.from(merged.values()))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleAccept = async (ticket: Ticket) => {
    if (!currentUser || !ticket.id) return

    // Фронтенд-проверка: есть ли уже заявка в работе
    const hasActive = useRemotableStore.getState().tickets.some(
      (t) => t.specialistId === currentUser.id && t.status === 'in_progress' && t.id !== ticket.id,
    )
    if (hasActive) {
      addNotification({
        type: 'warning',
        title: 'Невозможно принять',
        message: 'У вас уже есть заявка в работе. Сначала завершите текущую.',
      })
      return
    }

    setAcceptingId(ticket.id)
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
        // Обновляем тикет в сторе: статус + specialistId (чтобы появился в "Мои заявки")
        const updatedTickets = useRemotableStore.getState().tickets.map((t) =>
          t.id === ticket.id
            ? { ...t, status: 'in_progress' as const, specialistId: currentUser.id, specialist: { username: currentUser.username } }
            : t,
        )
        setTickets(updatedTickets)
      } else if (res.status === 409) {
        addNotification({
          type: 'warning',
          title: 'Невозможно принять',
          message: data.error || 'У вас уже есть заявка в работе.',
        })
      }
    } catch {
      // silently fail
    } finally {
      setAcceptingId(null)
    }
  }

  const handleTicketClick = (ticket: Ticket) => {
    selectTicket(ticket)
    setCurrentView('ticket-detail')
  }

  const stats = [
    {
      label: 'Ожидающих',
      value: pendingCount,
      icon: ListTodo,
      color: 'text-yellow-400',
    },
    {
      label: 'Активных сегодня',
      value: activeToday,
      icon: Clock,
      color: 'text-blue-400',
    },
    {
      label: 'Решено сегодня',
      value: resolvedToday,
      icon: CheckCircle,
      color: 'text-emerald-400',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Очередь заявок</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={refreshData}
          disabled={loading}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          title="Обновить"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="border-border bg-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-muted p-2">
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        <button
          onClick={() => setActiveTab('waiting')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'waiting'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Ожидающие ({waitingTickets.length})
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'my'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Мои заявки ({myTickets.length})
        </button>
      </div>

      {/* Ticket list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      ) : activeTab === 'waiting' && waitingTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/70">
          <ListTodo className="mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">Нет ожидающих заявок</p>
        </div>
      ) : activeTab === 'my' && myTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/70">
          <CheckCircle className="mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">У вас пока нет принятых заявок</p>
        </div>
      ) : (
        <div className="max-h-[calc(100vh-320px)] space-y-3 overflow-y-auto pr-1">
          {(activeTab === 'waiting' ? waitingTickets : myTickets).map(
            (ticket) => {
              const priority = priorityConfig[ticket.priority] || priorityConfig[3]
              const statusStyle = statusColors[ticket.status] || statusColors.pending

              return (
                <Card
                  key={ticket.id}
                  className="border-border bg-card transition-colors hover:border-input"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => handleTicketClick(ticket)}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${priority.dotClass}`}
                          />
                          <h3 className="truncate text-sm font-medium text-foreground">
                            {ticket.title}
                          </h3>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[11px] font-normal text-muted-foreground"
                          >
                            {ticket.category}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-normal ${statusStyle}`}
                          >
                            {statusLabels[ticket.status]}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground/70">
                            {ticket.creator?.username ?? 'Неизвестный'}
                          </span>
                          <span className="text-[11px] text-muted-foreground/40">
                            {formatRelativeTime(ticket.createdAt)}
                          </span>
                        </div>
                      </div>
                      {activeTab === 'waiting' && (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAccept(ticket)
                          }}
                          className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                          size="sm"
                          disabled={acceptingId === ticket.id}
                        >
                          {acceptingId === ticket.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1.5">Принять</span>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            },
          )}
        </div>
      )}
    </div>
  )
}