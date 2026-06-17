'use client'

import { useEffect, useState } from 'react'
import { Plus, Ticket as TicketIcon, Clock, Loader2, AlertCircle } from 'lucide-react'
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

const priorityConfig: Record<number, { label: string; color: string; dotClass: string }> = {
  1: { label: 'Критический', color: 'text-red-400', dotClass: 'bg-red-500' },
  2: { label: 'Высокий', color: 'text-orange-400', dotClass: 'bg-orange-500' },
  3: { label: 'Средний', color: 'text-yellow-400', dotClass: 'bg-yellow-500' },
  4: { label: 'Низкий', color: 'text-emerald-400', dotClass: 'bg-emerald-500' },
  5: { label: 'Информационный', color: 'text-gray-400', dotClass: 'bg-gray-400' },
}

const filterTabs: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'pending', label: 'Ожидает' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'resolved', label: 'Решено' },
]

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ClientDashboard() {
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')

  const currentUser = useRemotableStore((s) => s.currentUser)
  const tickets = useRemotableStore((s) => s.tickets)
  const setTickets = useRemotableStore((s) => s.setTickets)
  const selectTicket = useRemotableStore((s) => s.selectTicket)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)

  useEffect(() => {
    async function fetchTickets() {
      if (!currentUser) return
      setLoading(true)
      try {
        const res = await fetch(
          `/api/tickets?role=user&userId=${currentUser.id}`,
        )
        const data = await res.json()
        if (data.success) {
          setTickets(data.tickets)
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchTickets()
  }, [currentUser, setTickets])

  const filteredTickets =
    activeFilter === 'all'
      ? tickets
      : tickets.filter((t) => t.status === activeFilter)

  const totalCount = tickets.length
  const pendingCount = tickets.filter((t) => t.status === 'pending').length
  const inProgressCount = tickets.filter((t) => t.status === 'in_progress').length
  const resolvedCount = tickets.filter((t) => t.status === 'resolved').length

  const handleTicketClick = (ticket: Ticket) => {
    selectTicket(ticket)
    setCurrentView('ticket-detail')
  }

  const stats = [
    { label: 'Всего', value: totalCount, icon: TicketIcon, color: 'text-slate-300' },
    { label: 'Ожидает', value: pendingCount, icon: Clock, color: 'text-yellow-400' },
    { label: 'В работе', value: inProgressCount, icon: AlertCircle, color: 'text-blue-400' },
    { label: 'Решено', value: resolvedCount, icon: TicketIcon, color: 'text-emerald-400' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Мои заявки</h1>
        <Button
          onClick={() => setCurrentView('create-ticket')}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          size="sm"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Создать заявку
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeFilter === tab.key
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <TicketIcon className="mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">У вас пока нет заявок</p>
          <p className="mt-1 text-xs text-slate-600">
            Нажмите &laquo;Создать заявку&raquo;, чтобы получить помощь
          </p>
        </div>
      ) : (
        <div className="max-h-[calc(100vh-320px)] space-y-3 overflow-y-auto pr-1">
          {filteredTickets.map((ticket) => {
            const priority = priorityConfig[ticket.priority] || priorityConfig[3]
            const statusStyle = statusColors[ticket.status] || statusColors.pending
            return (
              <Card
                key={ticket.id}
                className="cursor-pointer border-slate-800 bg-slate-900 transition-colors hover:border-slate-700"
                onClick={() => handleTicketClick(ticket)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
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
                        {ticket.specialist && (
                          <span className="text-[11px] text-slate-500">
                            Специалист: {ticket.specialist.username}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {formatDate(ticket.createdAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}