'use client'

import { useRemotableStore, type ConnectionStatus } from '@/lib/store'

const statusConfig: Record<ConnectionStatus, { label: string; dotClass: string }> = {
  disconnected: {
    label: 'Отключено',
    dotClass: 'bg-gray-400',
  },
  connecting: {
    label: 'Подключение...',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  connected: {
    label: 'Подключено',
    dotClass: 'bg-emerald-500',
  },
  active: {
    label: 'Сессия активна',
    dotClass: 'bg-emerald-400 animate-pulse',
  },
}

export function ConnectionStatusBadge() {
  const connectionStatus = useRemotableStore((s) => s.connectionStatus)
  const config = statusConfig[connectionStatus]

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`}
      />
      <span className="text-foreground/80">{config.label}</span>
    </span>
  )
}