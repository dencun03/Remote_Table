'use client'

import { useEffect, useState } from 'react'
import { ListTodo, Clock, CheckCircle, Loader2, UserPlus } from 'lucide-react'
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
          // Merge: pending (unassigned) + my tickets, dedup by id
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

  const handleAccept = async (ticket: Ticket) => {
    if (!currentUser || !ticket.id) return
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
        const updatedTickets = useRemotableStore.getState().tickets.map((t) =>
          t.id === ticket.id
            ? { ...t, status: 'in_progress' as const, specialistId: currentUser.id, specialist: { username: currentUser.username } }
            : t,
        )
        setTickets(updatedTickets)
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
        <h1 className="text-xl font-bold text-white">Очередь заявок</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="border-slate-800 bg-slate-900">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-slate-800 p-2">
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-slate-400">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        <button
          onClick={() => setActiveTab('waiting')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'waiting'
              ? 'bg-slate-700 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Ожидающие ({waitingTickets.length})
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'my'
              ? 'bg-slate-700 text-white'
              : 'text-slate-400 hover:text-slate-200'
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
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <ListTodo className="mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">Нет ожидающих заявок</p>
        </div>
      ) : activeTab === 'my' && myTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
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
                  className="border-slate-800 bg-slate-900 transition-colors hover:border-slate-700"
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
                          <h3 className="truncate text-sm font-medium text-white">
                            {ticket.title}
                          </h3>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[11px] font-normal text-slate-400"
                          >
                            {ticket.category}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-normal ${statusStyle}`}
                          >
                            {statusLabels[ticket.status]}
                          </Badge>
                          <span className="text-[11px] text-slate-500">
                            {ticket.creator?.username ?? 'Неизвестный'}
                          </span>
                          <span className="text-[11px] text-slate-600">
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