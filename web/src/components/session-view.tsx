'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
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
  Send,
  Loader2,
  MessageSquare,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useRemotableStore } from '@/lib/store'
import { useScreenShareSpecialist } from '@/hooks/use-screen-share-specialist'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string
  message: string
  timestamp: number
}

interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  senderRole: string
  text: string
  createdAt: string
  isOwn?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

type SideTab = 'log' | 'chat'

export function SessionView() {
  const [duration, setDuration] = useState(0)
  const [sidePanelOpen, setSidePanelOpen] = useState(true)
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'medium' | 'poor' | 'none'>('none')
  const [controlRequested, setControlRequested] = useState(false)
  const [showPermission, setShowPermission] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [log, setLog] = useState<LogEntry[]>([])
  const [sideTab, setSideTab] = useState<SideTab>('chat')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [chatConnected, setChatConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)

  const currentUser = useRemotableStore((s) => s.currentUser)
  const currentSession = useRemotableStore((s) => s.currentSession)
  const selectedTicket = useRemotableStore((s) => s.selectedTicket)
  const endSession = useRemotableStore((s) => s.endSession)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)

  const hasSession = !!currentSession
  const ticketId = currentSession?.ticketId ?? selectedTicket?.id
  const sessionId = currentSession?.id

  const addLogEntry = useCallback((message: string) => {
    setLog((prev) => [
      ...prev,
      { id: crypto.randomUUID(), message, timestamp: Date.now() },
    ])
  }, [])

  // ── WebRTC screen share (specialist — viewer) ──
  const { isViewing, connectionState: webrtcState, error: webrtcError } = useScreenShareSpecialist(
    socket,
    sessionId ?? null,
    remoteVideoRef,
    {
      onConnected: () => addLogEntry('Трансляция экрана подключена'),
      onDisconnected: () => addLogEntry('Трансляция экрана отключена'),
    },
  )

  // ── Log WebRTC events (handled via socket events, not webrtcState) ──

  // ── Simulated connection quality (fallback if WebRTC not connected) ──
  useEffect(() => {
    if (!hasSession || isViewing) return
    const timer = setTimeout(() => {
      setConnectionQuality('good')
      addLogEntry('Соединение установлено')
    }, 2000)
    return () => clearTimeout(timer)
  }, [hasSession, isViewing, addLogEntry])

  // ── Session duration timer ──
  useEffect(() => {
    if (!hasSession) return
    const startTime = currentSession?.startedAt
      ? new Date(currentSession.startedAt as string).getTime()
      : Date.now()
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [hasSession, currentSession?.startedAt])

  // ── Auto-scroll log ──
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  // ── Poll session status — detect if the other side ended it ──
  const sessionEndedByOtherRef = useRef(false)
  useEffect(() => {
    if (!currentSession?.id) return
    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled || sessionEndedByOtherRef.current) return
      try {
        const res = await fetch(`/api/sessions/active?userId=${currentUser?.id}`)
        if (cancelled) return
        const data = await res.json()
        if (cancelled) return
        const stillActive = data.success && data.sessions?.length > 0
          && data.sessions.some((s: Record<string, unknown>) => String(s.id) === String(currentSession.id))
        if (!stillActive) {
          sessionEndedByOtherRef.current = true
          addNotification({
            type: 'warning',
            title: 'Сессия завершена',
            message: 'Сессия была завершена другой стороной',
          })
          endSession()
          setCurrentView('specialist-dashboard')
        }
      } catch { /* silent */ }
    }, 5_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [currentSession?.id, currentUser?.id, addNotification, endSession, setCurrentView])

  // ── Auto-scroll chat ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Socket.IO chat connection + WebRTC signaling ──
  useEffect(() => {
    if (!ticketId || !currentUser) return

    const socketIo = io('/?XTransformPort=3004', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socketIo.on('connect', () => {
      setChatConnected(true)
      setSocket(socketIo)
      socketIo.emit('join-ticket', {
        ticketId,
        userId: currentUser.id,
        username: currentUser.username,
      })
      // Join session room for WebRTC signaling
      if (sessionId) {
        socketIo.emit('join-session', {
          sessionId,
          userId: currentUser.id,
          role: 'specialist',
          username: currentUser.username,
        })
      }
    })

    socketIo.on('disconnect', () => {
      setChatConnected(false)
      setSocket(null)
    })

    socketIo.on('new-message', (msg: Record<string, unknown>) => {
      const newMsg: ChatMessage = {
        id: String(msg.id),
        senderId: String(msg.senderId),
        senderName: String(msg.senderName),
        senderRole: String(msg.senderRole),
        text: String(msg.text),
        createdAt: String(msg.createdAt || msg.timestamp),
        isOwn: String(msg.senderId) === currentUser.id,
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev
        return [...prev, newMsg]
      })
    })

    socketIo.on('user-joined', (data: { username: string }) => {
      addNotification({
        type: 'info',
        title: 'Пользователь подключился',
        message: `${data.username} присоединился к чату`,
      })
    })

    // WebRTC: client started sharing
    socketIo.on('screen-share-offer', () => {
      addLogEntry('Получен запрос трансляции экрана...')
    })

    // WebRTC: client stopped sharing
    socketIo.on('screen-share-stopped', () => {
      addLogEntry('Трансляция экрана остановлена клиентом')
      setConnectionQuality('good')
    })

    // Screen share request response from client
    socketIo.on('screen-share-response', (data: { accepted: boolean }) => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setShowPermission(false)
      if (data.accepted) {
        setControlRequested(false)
        addLogEntry('Клиент разрешил доступ к экрану')
      } else {
        setControlRequested(false)
        addLogEntry('Клиент отклонил запрос доступа к экрану')
      }
    })

    socketRef.current = socketIo

    return () => {
      if (ticketId) {
        socketIo.emit('leave-ticket', { ticketId })
      }
      if (sessionId) {
        socketIo.emit('leave-session', { sessionId })
      }
      socketIo.disconnect()
      socketRef.current = null
      setChatConnected(false)
    }
  }, [ticketId, sessionId, currentUser, addNotification, addLogEntry])

  // ── Load existing messages ──
  useEffect(() => {
    if (!ticketId) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/messages`)
        if (cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.success && data.messages) {
          const mapped: ChatMessage[] = data.messages.map((m: Record<string, unknown>) => ({
            id: String(m.id),
            senderId: String(m.senderId),
            senderName: String((m.sender as Record<string, Record<string, unknown>> | null)?.username || 'Неизвестный'),
            senderRole: String((m.sender as Record<string, Record<string, Record<string, unknown>>> | null)?.role?.name || ''),
            text: String(m.content),
            createdAt: String(m.sentAt),
            isOwn: String(m.senderId) === currentUser?.id,
          }))
          setMessages(mapped)
        }
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [ticketId, currentUser])

  // ── Polling fallback when socket is not connected ──
  useEffect(() => {
    if (!ticketId || chatConnected) return

    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/tickets/${ticketId}/messages`)
        if (cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.success && data.messages) {
          const mapped: ChatMessage[] = data.messages.map((m: Record<string, unknown>) => ({
            id: String(m.id),
            senderId: String(m.senderId),
            senderName: String((m.sender as Record<string, Record<string, unknown>> | null)?.username || 'Неизвестный'),
            senderRole: String((m.sender as Record<string, Record<string, Record<string, unknown>>> | null)?.role?.name || ''),
            text: String(m.content),
            createdAt: String(m.sentAt),
            isOwn: String(m.senderId) === currentUser?.id,
          }))
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id))
            const fresh = mapped.filter((m) => !existingIds.has(m.id))
            if (fresh.length === 0) return prev
            return [...prev, ...fresh]
          })
        }
      } catch { /* silent */ }
    }, 10_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [ticketId, chatConnected, currentUser])

  // ── Send message ──
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentUser || !ticketId || sending) return

    const text = newMessage.trim()
    setNewMessage('')
    setSending(true)

    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUser.id,
          text,
        }),
      })
      const data = await res.json()

      if (data.success && data.message) {
        const savedMsg: ChatMessage = {
          id: String(data.message.id),
          senderId: String(data.message.senderId),
          senderName: String((data.message.sender as Record<string, Record<string, unknown>> | null)?.username || currentUser.username),
          senderRole: String((data.message.sender as Record<string, Record<string, Record<string, unknown>>> | null)?.role?.name || ''),
          text: String(data.message.content),
          createdAt: String(data.message.sentAt),
          isOwn: true,
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === savedMsg.id)) return prev
          return [...prev, savedMsg]
        })

        if (socketRef.current?.connected) {
          socketRef.current.emit('chat-message', {
            ticketId,
            message: {
              id: String(data.message.id),
              senderId: currentUser.id,
              senderName: currentUser.username,
              senderRole: 'specialist',
              text,
              createdAt: String(data.message.sentAt),
            },
          })
        }
      }
    } catch {
      setNewMessage(text)
    }
    setSending(false)
    chatInputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // ── End session ──
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
    if (!socketRef.current?.connected || !sessionId) return

    setControlRequested(true)
    setShowPermission(true)
    setCountdown(30)
    addLogEntry('Запрос доступа к экрану отправлен')

    socketRef.current.emit('request-screen-share', {
      sessionId,
      userId: currentUser?.id,
      username: currentUser?.username,
    })

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          if (socketRef.current?.connected) {
            socketRef.current.emit('cancel-screen-share-request', { sessionId })
          }
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

  // ── Fullscreen toggle ──
  const toggleFullscreen = useCallback(() => {
    const container = fullscreenContainerRef.current
    if (!container) return
    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ── Нет активной сессии ──
  if (!hasSession) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground/70" />
            <span className="text-sm text-muted-foreground/70">Нет активной сессии</span>
          </div>
          <button
            onClick={handleGoToTickets}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground/80"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            К заявкам
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MonitorPlay className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <h2 className="text-lg font-medium text-muted-foreground">Нет активного сеанса</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground/40">
              Примите заявку и нажмите «Начать сеанс» в детали заявки,
              чтобы запустить удалённый доступ к рабочему столу пользователя.
            </p>
            <Button
              onClick={handleGoToTickets}
              variant="outline"
              className="mt-6 border-input text-foreground/80 hover:bg-accent hover:text-foreground"
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
    <div ref={fullscreenContainerRef} className="relative flex h-[calc(100vh-5rem)] flex-col overflow-hidden">
      {/* Верхняя панель */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground">{clientName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="font-mono text-sm text-emerald-400">
              {formatDuration(duration)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <QualityIcon className={`h-3.5 w-3.5 ${quality.color}`} />
            <span className={`text-xs ${quality.color}`}>{quality.label}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {chatConnected ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                <Wifi className="h-3 w-3" /> Чат
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-yellow-500">
                <WifiOff className="h-3 w-3" /> Чат
              </span>
            )}
          </div>
          {isViewing && (
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Трансляция
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isViewing && (
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={isFullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            onClick={() => setSidePanelOpen(!sidePanelOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        {/* Удалённый рабочий стол */}
        <div className="relative flex flex-1 items-center justify-center bg-black p-0 overflow-hidden">
          {isViewing ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-contain"
            />
          ) : webrtcState === 'connecting' ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
              <p className="text-sm text-muted-foreground">Подключение к экрану клиента...</p>
            </div>
          ) : webrtcError ? (
            <div className="flex flex-col items-center gap-3">
              <WifiOff className="h-10 w-10 text-red-400/60" />
              <p className="text-sm text-red-400">{webrtcError}</p>
              <p className="text-xs text-muted-foreground/60">Убедитесь, что клиент начал трансляцию экрана</p>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/30 mb-4">
                <Monitor className="h-10 w-10 text-muted-foreground/30" />
              </div>
              <p className="text-lg text-muted-foreground/60">Ожидание трансляции экрана</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground/40">
                Когда клиент нажмёт «Поделиться экраном», его рабочий стол появится здесь.
              </p>
            </div>
          )}
        </div>

        {/* Боковая панель */}
        {sidePanelOpen && (
          <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col">
            {/* Инфо о клиенте */}
            <Card className="m-3 mb-2 border-border bg-card">
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
                    <p className="text-sm font-medium text-foreground">{clientName}</p>
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

            {/* Screen share status */}
            <div className="px-3 pb-2">
              <Card className={`border-border ${isViewing ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-muted/50'}`}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Monitor className={`h-4 w-4 ${isViewing ? 'text-emerald-400' : 'text-muted-foreground/60'}`} />
                    <span className="text-xs text-foreground/80">
                      {isViewing ? 'Экран клиента' : 'Ожидание экрана'}
                    </span>
                  </div>
                  {isViewing && (
                    <p className="mt-1.5 text-[10px] text-emerald-400/80">
                      Трансляция экрана активна
                    </p>
                  )}
                  {!isViewing && webrtcState !== 'connecting' && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                      Ожидание от клиента
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

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
                    : 'border-input text-foreground/80 hover:bg-accent hover:text-foreground'
                }`}
                onClick={handleRequestControl}
                disabled={controlRequested}
              >
                <MousePointer2 className="mr-2 h-4 w-4" />
                {controlRequested ? 'Запрос отправлен' : 'Запрос управления'}
              </Button>
            </div>

            {/* Вкладки: Журнал / Чат */}
            <div className="flex border-t border-border">
              <button
                onClick={() => setSideTab('log')}
                className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  sideTab === 'log'
                    ? 'border-b-2 border-emerald-500 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ChevronRight className="h-3 w-3" />
                Журнал
              </button>
              <button
                onClick={() => setSideTab('chat')}
                className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  sideTab === 'chat'
                    ? 'border-b-2 border-emerald-500 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                Чат
              </button>
            </div>

            {/* Журнал */}
            {sideTab === 'log' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {log.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground/40">
                    <span className="text-xs">Нет записей</span>
                  </div>
                ) : (
                  log.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2">
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <div className="min-w-0">
                        <p className="text-xs text-foreground/80">{entry.message}</p>
                        <p className="text-[10px] text-muted-foreground/40">
                          {formatTime(entry.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            )}

            {/* Чат */}
            {sideTab === 'chat' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40">
                      <MessageSquare className="mb-2 h-6 w-6" />
                      <p className="text-xs">Пока нет сообщений</p>
                      <p className="mt-0.5 text-[10px] text-foreground/40">
                        Напишите сообщение клиенту
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isOwn = msg.isOwn
                      return (
                        <div
                          key={msg.id}
                          className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          {/* Avatar */}
                          <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                              isOwn
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-blue-500/20 text-blue-400'
                            }`}
                          >
                            {msg.senderName
                              .split(' ')
                              .map((w) => w[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </div>

                          {/* Bubble */}
                          <div className={`max-w-[85%] ${isOwn ? 'items-end' : 'items-start'}`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] text-muted-foreground/70">
                                {msg.senderName}
                              </span>
                              <span className="text-[10px] text-muted-foreground/40">
                                {formatChatTime(msg.createdAt)}
                              </span>
                            </div>
                            <div
                              className={`rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                                isOwn
                                  ? 'rounded-br-sm bg-emerald-500/20 text-foreground'
                                  : 'rounded-bl-sm bg-muted text-foreground/80'
                              }`}
                            >
                              {msg.text}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="shrink-0 border-t border-border p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      ref={chatInputRef}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Написать..."
                      disabled={sending}
                      className="flex-1 h-8 text-xs focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/50"
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sending}
                      size="icon"
                      className="h-8 w-8 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Диалог запроса доступа к экрану */}
      <Dialog open={showPermission} onOpenChange={(open) => {
        if (!open) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          if (socketRef.current?.connected && sessionId) {
            socketRef.current.emit('cancel-screen-share-request', { sessionId })
          }
          setShowPermission(false)
          setControlRequested(false)
        }
      }}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Monitor className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-center text-foreground">
              Запрос доступа к экрану
            </DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              Ожидание ответа от клиента
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-sm text-foreground/80">
                Автоотклонение через {countdown} сек.
              </span>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <Button
              onClick={() => {
                if (countdownRef.current) clearInterval(countdownRef.current)
                if (socketRef.current?.connected && sessionId) {
                  socketRef.current.emit('cancel-screen-share-request', { sessionId })
                }
                setShowPermission(false)
                setControlRequested(false)
                addLogEntry('Запрос отменён')
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