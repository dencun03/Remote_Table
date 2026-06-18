'use client'

import { useEffect, useRef, useState } from 'react'
import { MonitorPlay, User } from 'lucide-react'
import { useRemotableStore, type Ticket } from '@/lib/store'
import { Titlebar } from '@/components/titlebar'
import { Sidebar } from '@/components/sidebar'
import { LoginView } from '@/components/login-view'
import { RegisterView } from '@/components/register-view'
import { ClientDashboard } from '@/components/client-dashboard'
import { CreateTicketView } from '@/components/create-ticket-view'
import { TicketDetailView } from '@/components/ticket-detail-view'
import { SpecialistDashboard } from '@/components/specialist-dashboard'
import { AdminPanel } from '@/components/admin-panel'
import { SessionView } from '@/components/session-view'
import { ClientSessionView } from '@/components/client-session-view'
import { SettingsView } from '@/components/settings-view'
import { NotificationPanel } from '@/components/notification-panel'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** Глобальный мониторинг активных сессий для клиента */
function useClientSessionMonitor() {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)

  const hadActiveSession = useRef(false)

  useEffect(() => {
    if (currentUser?.role !== 'user') return

    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/sessions/active?userId=${currentUser.id}`)
        if (cancelled) return
        const data = await res.json()
        if (cancelled) return

        const hasActive = data.success && data.sessions?.length > 0
          && data.sessions.some((s: Record<string, unknown>) => s.role === 'client')

        if (hasActive) {
          hadActiveSession.current = true
        } else if (hadActiveSession.current) {
          hadActiveSession.current = false
          addNotification({
            type: 'warning',
            title: 'Сессия завершена',
            message: 'Специалист завершил сеанс удалённого доступа',
          })
          const view = useRemotableStore.getState().currentView
          if (view === 'client-session') {
            setCurrentView('client-dashboard')
          }
        }
      } catch { /* silent */ }
    }, 5_000)

    return () => { cancelled = true; clearInterval(interval) }
  }, [currentUser?.id, currentUser?.role, setCurrentView, addNotification])
}

// ─── Ticket Accepted Monitor ──────────────────────────────────────────────────

interface TicketAcceptedInfo {
  ticketId: string
  ticketTitle: string
  specialistName: string
}

/**
 * Мониторинг принятия заявок специалистом.
 *
 * Опрашивает /api/tickets каждые 5 секунд. Когда заявка переходит
 * из статуса 'pending' в 'in_progress' с назначенным специалистом,
 * показывает модалку с предложением перейти к сеансу.
 */
function useTicketAcceptedMonitor() {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)
  const setTickets = useRemotableStore((s) => s.setTickets)

  const [pendingInvite, setPendingInvite] = useState<TicketAcceptedInfo | null>(null)
  const seenTicketsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (currentUser?.role !== 'user') return

    let cancelled = false

    const checkTickets = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/tickets?role=user&userId=${currentUser.id}`)
        if (cancelled) return
        const data = await res.json()
        if (cancelled || !data.success) return

        const tickets = data.tickets as Ticket[]

        // Обновляем стор, чтобы клиентский дашборд тоже видел изменения
        setTickets(tickets)

        for (const ticket of tickets) {
          const prevStatus = seenTicketsRef.current.get(ticket.id)
          const currStatus = ticket.status

          // Детектируем переход pending → in_progress с назначенным специалистом
          if (
            prevStatus &&
            prevStatus === 'pending' &&
            currStatus === 'in_progress' &&
            ticket.specialist?.username
          ) {
            const view = useRemotableStore.getState().currentView
            // Не показываем модалку если уже в сеансе
            if (view !== 'client-session' && view !== 'session' && !pendingInvite) {
              setPendingInvite({
                ticketId: ticket.id,
                ticketTitle: ticket.title,
                specialistName: ticket.specialist.username,
              })
            }
          }

          seenTicketsRef.current.set(ticket.id, currStatus)
        }
      } catch { /* silent */ }
    }

    checkTickets()
    const interval = setInterval(checkTickets, 5_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [currentUser?.id, currentUser?.role, setCurrentView, addNotification, setTickets, pendingInvite])

  const acceptInvite = () => {
    setPendingInvite(null)
    setCurrentView('client-session')
  }

  const dismissInvite = () => {
    if (pendingInvite) {
      addNotification({
        type: 'info',
        title: 'Заявка принята',
        message: `Специалист ${pendingInvite.specialistName} принял вашу заявку «${pendingInvite.ticketTitle}». Вы можете перейти к сеансу позже из списка заявок.`,
      })
    }
    setPendingInvite(null)
  }

  return { pendingInvite, acceptInvite, dismissInvite }
}

// ─── App Shell ─────────────────────────────────────────────────────────────────

function AppShell({ children }: { children: React.ReactNode }) {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const currentView = useRemotableStore((s) => s.currentView)

  if (currentView === 'session') {
    return (
      <div className="flex h-screen flex-col bg-background">
        <Titlebar />
        <SessionView />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-12 items-center justify-between border-b bg-card px-6">
            <div />
            {currentUser && <NotificationPanel />}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const currentView = useRemotableStore((s) => s.currentView)
  const isAuthenticated = useRemotableStore((s) => s.isAuthenticated)

  useClientSessionMonitor()
  const { pendingInvite, acceptInvite, dismissInvite } = useTicketAcceptedMonitor()

  if (!isAuthenticated) {
    switch (currentView) {
      case 'register':
        return <RegisterView />
      case 'login':
      default:
        return <LoginView />
    }
  }

  return (
    <>
      <AppShell>
        {currentView === 'client-dashboard' && <ClientDashboard />}
        {currentView === 'create-ticket' && <CreateTicketView />}
        {currentView === 'ticket-detail' && <TicketDetailView />}
        {currentView === 'specialist-dashboard' && <SpecialistDashboard />}
        {currentView === 'admin-panel' && <AdminPanel />}
        {currentView === 'client-session' && <ClientSessionView />}
        {currentView === 'settings' && <SettingsView />}
      </AppShell>

      {/* Модалка: специалист принял заявку */}
      <Dialog
        open={!!pendingInvite}
        onOpenChange={(open) => {
          if (!open) dismissInvite()
        }}
      >
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <MonitorPlay className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-center text-foreground">
              Ваша заявка принята
            </DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              Специалист{' '}
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <User className="h-3 w-3" />
                {pendingInvite?.specialistName}
              </span>{' '}
              принял вашу заявку
              {pendingInvite?.ticketTitle && (
                <>
                  {' '}
                  «<span className="text-foreground">{pendingInvite.ticketTitle}</span>»
                </>
              )}
              . Перейти к сеансу технической поддержки?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button
              onClick={dismissInvite}
              variant="outline"
              className="flex-1 border-input text-foreground/80 hover:bg-accent hover:text-foreground"
            >
              Позже
            </Button>
            <Button
              onClick={acceptInvite}
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <MonitorPlay className="mr-2 h-4 w-4" />
              Перейти к сеансу
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
