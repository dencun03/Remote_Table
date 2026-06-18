'use client'

import { useEffect, useRef } from 'react'
import { useRemotableStore } from '@/lib/store'
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

export default function Home() {
  const currentView = useRemotableStore((s) => s.currentView)
  const isAuthenticated = useRemotableStore((s) => s.isAuthenticated)

  useClientSessionMonitor()

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
    <AppShell>
      {currentView === 'client-dashboard' && <ClientDashboard />}
      {currentView === 'create-ticket' && <CreateTicketView />}
      {currentView === 'ticket-detail' && <TicketDetailView />}
      {currentView === 'specialist-dashboard' && <SpecialistDashboard />}
      {currentView === 'admin-panel' && <AdminPanel />}
      {currentView === 'client-session' && <ClientSessionView />}
      {currentView === 'settings' && <SettingsView />}
    </AppShell>
  )
}