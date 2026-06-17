'use client'

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

function AppShell({ children }: { children: React.ReactNode }) {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const currentView = useRemotableStore((s) => s.currentView)

  // Session view has its own layout (no sidebar)
  if (currentView === 'session') {
    return (
      <div className="flex h-screen flex-col bg-[#0a0f1a]">
        <Titlebar />
        <SessionView />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-[#0a0f1a]">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Content header bar */}
          <div className="flex h-12 items-center justify-between border-b border-slate-800 bg-[#0f1520] px-6">
            <div />
            {currentUser && <NotificationPanel />}
          </div>
          {/* Scrollable content area */}
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

  // Unauthenticated views — full-screen without shell
  if (!isAuthenticated) {
    switch (currentView) {
      case 'register':
        return <RegisterView />
      case 'login':
      default:
        return <LoginView />
    }
  }

  // Authenticated views — with app shell
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