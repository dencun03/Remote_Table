'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Monitor,
  PhoneOff,
  MousePointer2,
  User,
  Wifi,
  WifiOff,
  PanelRightClose,
  PanelRightOpen,
  ChevronRight,
  Shield,
  Clock,
  MonitorPlay,
  ArrowLeft,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useRemotableStore } from '@/lib/store'

interface LogEntry {
  id: string
  message: string
  timestamp: number
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function SessionView() {
  const [duration, setDuration] = useState(0)
  const [sidePanelOpen, setSidePanelOpen] = useState(true)
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'medium' | 'poor' | 'none'>('none')
  const [controlRequested, setControlRequested] = useState(false)
  const [showPermission, setShowPermission] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [log, setLog] = useState<LogEntry[]>([])

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const currentUser = useRemotableStore((s) => s.currentUser)
  const currentSession = useRemotableStore((s) => s.currentSession)
  const selectedTicket = useRemotableStore((s) => s.selectedTicket)
  const endSession = useRemotableStore((s) => s.endSession)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)

  const hasSession = !!currentSession

  const addLogEntry = useCallback((message: string) => {
    setLog((prev) => [
      ...prev,
      { id: crypto.randomUUID(), message, timestamp: Date.now() },
    ])
  }, [])

  // Simulated connection quality
  useEffect(() => {
    if (!hasSession) return
    const timer = setTimeout(() => {
      setConnectionQuality('good')
      addLogEntry('Соединение установлено')
    }, 2000)
    return () => clearTimeout(timer)
  }, [hasSession, addLogEntry])

  // Таймер длительности сессии
  useEffect(() => {
    if (!hasSession) return
    const startTime = currentSession?.startedAt
      ? new Date(currentSession.startedAt).getTime()
      : Date.now()
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [hasSession, currentSession?.startedAt])

  // Авто-скролл журнала
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const handleEndSession = () => {
    if (currentSession?.id) {
      fetch(`/api/sessions/${currentSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ended',
          endedAt: new Date().toISOString(),
          durationSeconds: duration,
        }),
      }).catch(() => {})
    }
    endSession()
    setCurrentView('specialist-dashboard')
    addNotification({
      type: 'info',
      title: 'Сессия завершена',
      message: `Сессия завершена. Длительность: ${formatDuration(duration)}`,
    })
  }

  const handleRequestControl = () => {
    setControlRequested(true)
    setShowPermission(true)
    setCountdown(30)
    addLogEntry('Запрос удалённого управления отправлен')

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setShowPermission(false)
          setControlRequested(false)
          addLogEntry('Запрос отклонён по таймауту')
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleGoToTickets = () => {
    setCurrentView('specialist-dashboard')
  }

  // ── Нет активной сессии ──
  if (!hasSession) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1117] px-4 py-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-slate-500" />
            <span className="text-sm text-slate-500">Нет активной сессии</span>
          </div>
          <button
            onClick={handleGoToTickets}
            className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            К заявкам
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
              <MonitorPlay className="h-8 w-8 text-slate-600" />
            </div>
            <h2 className="text-lg font-medium text-slate-400">Нет активного сеанса</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-600">
              Примите заявку и нажмите «Начать сеанс» в детали заявки,
              чтобы запустить удалённый доступ к рабочему столу пользователя.
            </p>
            <Button
              onClick={handleGoToTickets}
              variant="outline"
              className="mt-6 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Перейти к заявкам
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Есть активная сессия ──
  const clientName = currentSession.clientUserId
    ? `Клиент #${currentSession.clientUserId}`
    : currentUser?.username ?? 'Клиент'

  const qualityConfig = {
    good: { icon: Wifi, label: 'Хорошее', color: 'text-emerald-400' },
    medium: { icon: Wifi, label: 'Среднее', color: 'text-yellow-400' },
    poor: { icon: Wifi, label: 'Плохое', color: 'text-orange-400' },
    none: { icon: WifiOff, label: 'Нет', color: 'text-red-400' },
  }
  const quality = qualityConfig[connectionQuality]
  const QualityIcon = quality.icon

  return (
    <div className="relative flex h-[calc(100vh-5rem)] flex-col overflow-hidden">
      {/* Верхняя панель */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#0d1117] px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-200">{clientName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-mono text-sm text-emerald-400">
              {formatDuration(duration)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <QualityIcon className={`h-3.5 w-3.5 ${quality.color}`} />
            <span className={`text-xs ${quality.color}`}>{quality.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidePanelOpen(!sidePanelOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title={sidePanelOpen ? 'Скрыть панель' : 'Показать панель'}
          >
            {sidePanelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Основная область */}
      <div className="flex flex-1 overflow-hidden">
        {/* Удалённый рабочий стол — заглушка */}
        <div className="flex flex-1 items-center justify-center bg-[#0a0f1a] p-6">
          <div className="flex h-full w-full max-w-4xl flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-muted/30">
            <Monitor className="mb-4 h-16 w-16 text-slate-600" />
            <p className="text-lg text-slate-500">Удалённый рабочий стол</p>
            <p className="mt-1 text-sm text-slate-600">Экран клиента появится здесь</p>
          </div>
        </div>

        {/* Боковая панель */}
        {sidePanelOpen && (
          <div className="w-72 shrink-0 border-l border-slate-800 bg-[#0d1117] flex flex-col">
            {/* Инфо о клиенте */}
            <Card className="m-3 border-slate-800 bg-slate-900">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-400">
                    {clientName
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{clientName}</p>
                    <Badge
                      variant="outline"
                      className="mt-0.5 text-[10px] text-emerald-400"
                    >
                      Пользователь
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Действия */}
            <div className="px-3 pb-3 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={handleEndSession}
              >
                <PhoneOff className="mr-2 h-4 w-4" />
                Завершить сессию
              </Button>
              <Button
                variant={controlRequested ? 'default' : 'outline'}
                className={`w-full justify-start ${
                  controlRequested
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
                onClick={handleRequestControl}
                disabled={controlRequested}
              >
                <MousePointer2 className="mr-2 h-4 w-4" />
                {controlRequested ? 'Запрос отправлен' : 'Запрос управления'}
              </Button>
            </div>

            {/* Журнал действий */}
            <div className="flex items-center gap-1.5 border-t border-slate-800 px-3 pt-3">
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-400">Журнал</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-3">
              {log.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-slate-600">
                  <span className="text-xs">Нет записей</span>
                </div>
              ) : (
                log.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300">{entry.message}</p>
                      <p className="text-[10px] text-slate-600">
                        {formatTime(entry.timestamp)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Диалог запроса управления */}
      <Dialog open={showPermission} onOpenChange={(open) => {
        if (!open) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setShowPermission(false)
          setControlRequested(false)
        }
      }}>
        <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Shield className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-center text-white">
              Запрос удалённого управления
            </DialogTitle>
            <DialogDescription className="text-center text-slate-400">
              Ожидание ответа от клиента
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-sm text-slate-300">
                Автоотклонение через {countdown} сек.
              </span>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <Button
              onClick={() => {
                if (countdownRef.current) clearInterval(countdownRef.current)
                setShowPermission(false)
                setControlRequested(false)
              }}
              variant="outline"
              className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              Отменить запрос
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}