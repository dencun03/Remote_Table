'use client'

import {
  LayoutDashboard,
  Settings,
  Ticket,
  PlusCircle,
  ListTodo,
  MonitorPlay,
  Monitor,
  LogOut,
  ChevronLeft,
  Shield,
} from 'lucide-react'
import { useRemotableStore, type AppView } from '@/lib/store'

interface NavItem {
  icon: React.ElementType
  label: string
  view: AppView
  roles: Array<'user' | 'specialist' | 'admin'>
}

const navItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    label: 'Панель управления',
    view: 'client-dashboard',
    roles: ['user', 'specialist', 'admin'],
  },
  {
    icon: Ticket,
    label: 'Мои заявки',
    view: 'client-dashboard',
    roles: ['user'],
  },
  {
    icon: PlusCircle,
    label: 'Создать заявку',
    view: 'create-ticket',
    roles: ['user'],
  },
  {
    icon: ListTodo,
    label: 'Очередь заявок',
    view: 'specialist-dashboard',
    roles: ['specialist'],
  },
  {
    icon: MonitorPlay,
    label: 'Активная сессия',
    view: 'session',
    roles: ['specialist'],
  },
  {
    icon: Monitor,
    label: 'Удалённый доступ',
    view: 'client-session',
    roles: ['user'],
  },
  {
    icon: Shield,
    label: 'Администрирование',
    view: 'admin-panel',
    roles: ['admin'],
  },
  {
    icon: Settings,
    label: 'Настройки',
    view: 'settings',
    roles: ['user', 'specialist', 'admin'],
  },
]

const roleLabels: Record<string, string> = {
  user: 'Пользователь',
  specialist: 'Специалист',
  admin: 'Администратор',
}

export function Sidebar() {
  const sidebarOpen = useRemotableStore((s) => s.sidebarOpen)
  const toggleSidebar = useRemotableStore((s) => s.toggleSidebar)
  const currentUser = useRemotableStore((s) => s.currentUser)
  const currentView = useRemotableStore((s) => s.currentView)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const logout = useRemotableStore((s) => s.logout)

  const userRole = currentUser?.role ?? 'user'

  // Map the "Панель управления" view based on role
  const getTargetView = (item: NavItem): AppView => {
    if (item.label === 'Панель управления') {
      if (userRole === 'admin') return 'admin-panel'
      if (userRole === 'specialist') return 'specialist-dashboard'
      return 'client-dashboard'
    }
    if (item.label === 'Мои заявки') return 'client-dashboard'
    if (item.label === 'Удалённый доступ') return 'client-session'
    return item.view
  }

  const filteredItems = navItems.filter((item) =>
    item.roles.includes(userRole as 'user' | 'specialist' | 'admin'),
  )

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <aside
      className={`flex h-full flex-col border-r bg-sidebar transition-all duration-300 ease-in-out ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}
    >
      {/* Toggle button */}
      <div className="flex h-10 items-center justify-end px-3">
        <button
          onClick={toggleSidebar}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft
            className={`h-4 w-4 transition-transform duration-300 ${
              !sidebarOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2">
        {filteredItems.map((item) => {
          const Icon = item.icon
          const targetView = getTargetView(item)
          const isActive =
            currentView === targetView ||
            (item.label === 'Создать заявку' && currentView === 'ticket-detail' && false) ||
            (item.label === 'Мои заявки' && (currentView === 'client-dashboard' || currentView === 'ticket-detail'))

          return (
            <button
              key={item.label}
              onClick={() => setCurrentView(targetView)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${
                  isActive ? 'text-emerald-600 dark:text-emerald-400' : ''
                }`}
              />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* User section */}
      <div className="border-t p-3">
        <div className={`flex items-center gap-3 ${!sidebarOpen ? 'justify-center' : ''}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            {currentUser ? getInitials(currentUser.username) : '??'}
          </div>
          {sidebarOpen && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {currentUser?.username ?? 'Гость'}
              </p>
              <span className="inline-block rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {roleLabels[userRole] ?? userRole}
              </span>
            </div>
          )}
          {sidebarOpen && (
            <button
              onClick={logout}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
              title="Выйти"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}