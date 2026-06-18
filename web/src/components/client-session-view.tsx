'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  MonitorPlay,
  Send,
  Shield,
  Clock,
  Wifi,
  WifiOff,
  Ticket,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  MessageSquare,
  PhoneOff,
  MonitorX,
  MonitorUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useRemotableStore } from '@/lib/store'
import { useScreenShareClient } from '@/hooks/use-screen-share-client'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveSession {
  id: string
  ticketId: string
  ticketTitle: string
  specialistUserId: string
  specialistName: string
  clientUserId?: string
  clientName?: string
  status: string
  startedAt: string
  role: 'client' | 'specialist'
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

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClientSessionView() {
  const currentUser = useRemotableStore((s) => s.currentUser)
  const setCurrentView = useRemotableStore((s) => s.setCurrentView)
  const addNotification = useRemotableStore((s) => s.addNotification)
  const selectTicket = useRemotableStore((s) => s.selectTicket)

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [duration, setDuration] = useState(0)
  const [connected, setConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // Screen share request state
  const [showShareRequest, setShowShareRequest] = useState(false)
  const [shareRequestCountdown, setShareRequestCountdown] = useState(30)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch active session ──
  const fetchActiveSession = useCallback(async () => {
    if (!currentUser?.id) return
    try {
      const res = await fetch(`/api/sessions/active?userId=${currentUser.id}`)
      const data = await res.json()
      if (data.success && data.sessions.length > 0) {
        const clientSession = data.sessions.find(
          (s: ActiveSession) => s.role === 'client'
        )
        if (clientSession) {
          setSession(clientSession)
        }
      }
    } catch {
      // silent
    }
  }, [currentUser])

  // ── Load session on mount ──
  useEffect(() => {
    async function init() {
      setLoading(true)
      await fetchActiveSession()
      setLoading(false)
    }
    init()
  }, [fetchActiveSession])

  // When session is found, load messages
  useEffect(() => {
    const ticketId = session?.ticketId
    if (!ticketId) return
    let cancelled = false
    async function load() {
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
    }
    load()
    return () => { cancelled = true }
  }, [session?.ticketId, currentUser])

  // Connect to Socket.IO for real-time chat + WebRTC signaling
  useEffect(() => {
    if (!session?.ticketId) return

    const socketIo = io('/?XTransformPort=3004', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socketIo.on('connect', () => {
      setConnected(true)
      setSocket(socketIo)
      socketIo.emit('join-ticket', {
        ticketId: session.ticketId,
        userId: currentUser?.id,
        username: currentUser?.username,
      })
      if (session.id) {
        socketIo.emit('join-session', {
          sessionId: session.id,
          userId: currentUser?.id,
          role: 'client',
          username: currentUser?.username,
        })
      }
    })

    socketIo.on('disconnect', () => {
      setConnected(false)
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
        isOwn: String(msg.senderId) === currentUser?.id,
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

    // ── Specialist requests screen share ──
    socketIo.on('screen-share-requested', () => {
      setShowShareRequest(true)
      setShareRequestCountdown(30)
      addNotification({
        type: 'info',
        title: 'Запрос доступа к экрану',
        message: 'Специалист запрашивает доступ к вашему экрану',
      })

      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(() => {
        setShareRequestCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            setShowShareRequest(false)
            socketIo.emit('screen-share-response', {
              sessionId: session.id,
              accepted: false,
              userId: currentUser?.id,
            })
            return 0
          }
          return prev - 1
        })
      }, 1000)
    })

    // Specialist cancelled the request
    socketIo.on('screen-share-request-cancelled', () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setShowShareRequest(false)
    })

    socketRef.current = socketIo

    return () => {
      if (session.ticketId) {
        socketIo.emit('leave-ticket', { ticketId: session.ticketId })
      }
      if (session.id) {
        socketIo.emit('leave-session', { sessionId: session.id })
      }
      socketIo.disconnect()
      socketRef.current = null
      setConnected(false)
      setSocket(null)
    }
  }, [session?.ticketId, session?.id, currentUser, addNotification])

  // ── Duration timer ──
  useEffect(() => {
    if (!session?.startedAt) return
    const startTime = new Date(session.startedAt).getTime()
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [session?.startedAt])

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Polling fallback when socket is not connected ──
  useEffect(() => {
    if (!session?.ticketId || connected) return

    const ticketId = session.ticketId
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
  }, [session?.ticketId, connected, currentUser])

  // ── Screen sharing (client) ──
  const { startSharing, stopSharing, isSharing, isConnecting, error: shareError } = useScreenShareClient(
    socket,
    session?.id ?? null,
  )

  // ── Handle share accept/reject (called from dialog buttons) ──
  const handleShareAccept = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setShowShareRequest(false)
    const sock = socketRef.current
    if (sock && session?.id) {
      sock.emit('screen-share-response', {
        sessionId: session.id,
        accepted: true,
        userId: currentUser?.id,
      })
    }
    startSharing()
  }

  const handleShareReject = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setShowShareRequest(false)
    const sock = socketRef.current
    if (sock && session?.id) {
      sock.emit('screen-share-response', {
        sessionId: session.id,
        accepted: false,
        userId: currentUser?.id,
      })
    }
  }

  // ── Send message ──
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentUser || !session?.ticketId || sending) return

    const text = newMessage.trim()
    setNewMessage('')
    setSending(true)

    try {
      const res = await fetch(`/api/tickets/${session.ticketId}/messages`, {
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
            ticketId: session.ticketId,
            message: {
              id: String(data.message.id),
              senderId: currentUser.id,
              senderName: currentUser.username,
              senderRole: 'user',
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
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // ── End session ──
  const handleEndSession = () => {
    stopSharing()
    if (session?.id) {
      fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ended',
          endedAt: new Date().toISOString(),
          durationSeconds: duration,
        }),
      }).catch(() => {})
    }
    addNotification({
      type: 'info',
      title: 'Сессия завершена',
      message: 'Вы завершили сеанс удалённого доступа',
    })
    useRemotableStore.getState().setSession(null)
    setCurrentView('client-dashboard')
  }

  // ── Go to ticket ──
  const handleGoToTicket = () => {
    if (session?.ticketId) {
      fetch(`/api/tickets/${session.ticketId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            selectTicket(data.ticket)
            setCurrentView('ticket-detail')
          }
        })
        .catch(() => {})
    } else {
      setCurrentView('client-dashboard')
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-sm text-muted-foreground">Загрузка сеанса...</p>
        </div>
      </div>
    )
  }

  // ── No active session ──
  if (!session) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <MonitorPlay className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <h2 className="text-lg font-medium text-foreground/80">Нет активного сеанса</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground/70">
            В данный момент нет активного сеанса удалённого доступа.
            Когда специалист начнёт сеанс, информация появится здесь.
          </p>
          <Button
            onClick={() => setCurrentView('client-dashboard')}
            variant="outline"
            className="mt-6 border-input text-foreground/80 hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться к заявкам
          </Button>
        </div>
      </div>
    )
  }

  // ── Active session view ──
  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* Header: session info */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Specialist info */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-400">
                {session.specialistName
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {session.specialistName}
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] text-emerald-400"
                  >
                    Специалист
                  </Badge>
                  {isSharing ? (
                    <span className="flex items-center gap-1 text-[10px] text-red-400">
                      <MonitorUp className="h-3 w-3" />
                      Трансляция
                    </span>
                  ) : connected ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Wifi className="h-3 w-3" /> Онлайн
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <WifiOff className="h-3 w-3" /> Ожидание
                    </span>
                  )}
                </div>
              </div>
            </div>

            <Separator orientation="vertical" className="h-8 bg-input" />

            {/* Ticket info */}
            <div className="hidden items-center gap-2 sm:flex">
              <Ticket className="h-4 w-4 text-muted-foreground/70" />
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                {session.ticketTitle}
              </span>
            </div>
          </div>

          {/* Right side: duration + controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <Clock className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-mono text-xs text-emerald-400">
                {formatDuration(duration)}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={handleGoToTicket}
            >
              <Ticket className="mr-1.5 h-3.5 w-3.5" />
              Заявка
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={handleEndSession}
            >
              <PhoneOff className="mr-1.5 h-3.5 w-3.5" />
              Завершить
            </Button>
          </div>
        </div>
      </div>

      {/* Main content: info cards + chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: session info */}
        <div className="hidden w-72 shrink-0 flex-col border-r border-border lg:flex">
          {/* Session details */}
          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Информация о сеансе
              </p>
            </div>

            {/* Status */}
            <Card className="border-border bg-muted/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Статус</span>
                  {isSharing ? (
                    <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/20 bg-red-500/10">
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                      Трансляция
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Активен
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Specialist card */}
            <Card className="border-border bg-muted/50">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20">
                    <Shield className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {session.specialistName}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">Специалист поддержки</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Screen share status */}
            {isSharing && (
              <Card className="border-border bg-red-500/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                    </span>
                    <span className="text-xs text-red-400 font-medium">Трансляция экрана активна</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={stopSharing}
                  >
                    <MonitorX className="mr-2 h-3.5 w-3.5" />
                    Остановить трансляцию
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Security info */}
            <Card className="border-border bg-muted/50">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-foreground/80">Зашифрованное соединение</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs text-foreground/80">Управление требует разрешения</span>
                </div>
              </CardContent>
            </Card>

            {/* Start time */}
            <div className="flex items-center gap-2 px-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-xs text-muted-foreground/70">
                Начат: {formatDate(session.startedAt)}
              </span>
            </div>
          </div>

          {/* Notice */}
          <div className="mt-auto border-t border-border p-4">
            {isSharing ? (
              <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3">
                <div className="flex items-start gap-2">
                  <MonitorUp className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Специалист видит ваш экран в реальном времени.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/10 p-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Ожидание запроса от специалиста. Когда специалист запросит доступ к экрану, вы увидите уведомление.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: chat */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground/70" />
            <span className="text-sm font-medium text-foreground/80">Чат со специалистом</span>
            {!connected && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-yellow-500">
                <WifiOff className="h-3 w-3" />
                Переподключение...
              </span>
            )}
            {connected && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-500">
                <Wifi className="h-3 w-3" />
                Подключено
              </span>
            )}
          </div>

          {/* Messages area */}
          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-3 min-h-full">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center py-12 text-muted-foreground/40">
                  <MessageSquare className="mb-2 h-8 w-8" />
                  <p className="text-xs">Пока нет сообщений</p>
                  <p className="mt-1 text-[10px] text-foreground">
                    Напишите сообщение специалисту
                  </p>
                </div>
              )}

              {messages.map((msg) => {
                const isOwn = msg.isOwn
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
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
                    <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] text-muted-foreground/70">
                          {msg.senderName}
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          isOwn
                            ? 'rounded-br-md bg-emerald-500/20 text-foreground'
                            : 'rounded-bl-md bg-muted text-foreground/80'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="shrink-0 border-t border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Написать сообщение..."
                disabled={sending}
                className="flex-1 text-sm focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/50"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sending}
                size="icon"
                className="h-9 w-9 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialog: Specialist requests screen share */}
      <Dialog open={showShareRequest} onOpenChange={(open) => {
        if (!open) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setShowShareRequest(false)
          handleShareReject()
        }
      }}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <MonitorUp className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-center text-foreground">
              Запрос доступа к экрану
            </DialogTitle>
            <DialogDescription className="text-center text-muted-foreground">
              Специалист {session.specialistName} запрашивает доступ к вашему экрану
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-sm text-foreground/80">
                Автоотклонение через {shareRequestCountdown} сек.
              </span>
            </div>
          </div>
          {shareError && (
            <div className="mx-auto max-w-sm rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
              <p className="text-xs text-red-400">{shareError}</p>
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              onClick={handleShareReject}
              variant="outline"
              className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              Отклонить
            </Button>
            <Button
              onClick={handleShareAccept}
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <MonitorUp className="mr-2 h-4 w-4" />
              Разрешить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}