'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Info, CheckCircle, AlertTriangle, XCircle, X, Trash2 } from 'lucide-react'
import { useRemotableStore, type AppNotification } from '@/lib/store'

const typeConfig: Record<
  AppNotification['type'],
  { icon: React.ElementType; color: string }
> = {
  info: { icon: Info, color: 'text-blue-400' },
  success: { icon: CheckCircle, color: 'text-emerald-400' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400' },
  error: { icon: XCircle, color: 'text-red-400' },
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'только что'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  return `${days} дн. назад`
}

export function NotificationPanel() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const notifications = useRemotableStore((s) => s.notifications)
  const removeNotification = useRemotableStore((s) => s.removeNotification)
  const clearNotifications = useRemotableStore((s) => s.clearNotifications)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // Auto-remove after 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      notifications.forEach((n) => {
        if (now - n.timestamp > 10_000) {
          removeNotification(n.id)
        }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [notifications, removeNotification])

  const unreadCount = notifications.length

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-slate-700 bg-[#0d1117] shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
            <span className="text-sm font-medium text-slate-200">Уведомления</span>
            {notifications.length > 0 && (
              <button
                onClick={clearNotifications}
                className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
              >
                <Trash2 className="h-3 w-3" />
                Очистить все
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                <Bell className="mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm">Нет уведомлений</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const config = typeConfig[notification.type]
                const Icon = config.icon
                return (
                  <div
                    key={notification.id}
                    className="group flex items-start gap-3 border-b border-slate-800/50 px-4 py-3 transition-colors last:border-0 hover:bg-slate-800/30"
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.color}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200">
                        {notification.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {formatRelativeTime(notification.timestamp)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeNotification(notification.id)
                      }}
                      className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition-all hover:text-slate-300 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}