'use client'

import { Monitor, Minus, Square, X } from 'lucide-react'
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

export function Titlebar() {
  const connectionStatus = useRemotableStore((s) => s.connectionStatus)
  const config = statusConfig[connectionStatus]

  const handleMinimize = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.minimize) {
      window.electronAPI.minimize()
    }
  }

  const handleMaximize = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.maximize) {
      window.electronAPI.maximize()
    }
  }

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.close) {
      window.electronAPI.close()
    }
  }

  return (
    <div
      className="no-drag-mixin flex h-10 select-none items-center justify-between bg-background px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: App name */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
          <Monitor className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <span className="text-sm font-semibold text-foreground">Remotable</span>
      </div>

      {/* Center: Connection status */}
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
        <span className="text-xs text-muted-foreground">{config.label}</span>
      </div>

      {/* Right: Window controls */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="no-drag flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="no-drag flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="no-drag flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}