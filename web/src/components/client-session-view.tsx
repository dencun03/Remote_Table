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
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useRemotableStore } from '@/lib/store'

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
  const socketRef = useRef<Socket | null>(null)

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
          senderName: (m.sender as Record<string, unknown>)?.username || 'Неизвестный',
          senderRole: (m.sender as Record<string, unknown>)?.role
            ? ((m.sender as Record<string, Record<string, unknown>>).role?.name as string) || ''
            : '',
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

  // Connect to Socket.IO for real-time chat
  useEffect(() => {
    if (!session?.ticketId) return

    const socketIo = io('/?XTransformPort=3004', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socketIo.on('connect', () => {
      console.log('[ClientSession] Socket connected')
      setConnected(true)
      socketIo.emit('join-ticket', {
        ticketId: session.ticketId,
        userId: currentUser?.id,
        username: currentUser?.username,
      })
    })

    socketIo.on('disconnect', () => {
      console.log('[ClientSession] Socket disconnected')
      setConnected(false)
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

    socketRef.current = socketIo

    return () => {
      if (session.ticketId) {
        socketIo.emit('leave-ticket', { ticketId: session.ticketId })
      }
      socketIo.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [session?.ticketId, currentUser, addNotification])

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

  // ── Send message ──
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentUser || !session?.ticketId || sending) return

    const text = newMessage.trim()
    setNewMessage('')
    setSending(true)

    try {
      // Save via REST API
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

        // Add to local state immediately
        setMessages((prev) => {
          if (prev.some((m) => m.id === savedMsg.id)) return prev
          return [...prev, savedMsg]
        })

        // Broadcast via Socket.IO
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
      // Revert message on error
      setNewMessage(text)
    }
    setSending(false)
    inputRef.current?.focus()
  }

  // ── Handle keypress ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // ── Go to ticket ──
  const handleGoToTicket = () => {
    if (session?.ticketId) {
      // Load the ticket and navigate
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
          <p className="text-sm text-slate-400">Загрузка сеанса...</p>
        </div>
      </div>
    )
  }

  // ── No active session ──
  if (!session) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
            <MonitorPlay className="h-8 w-8 text-slate-600" />
          </div>
          <h2 className="text-lg font-medium text-slate-300">Нет активного сеанса</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            В данный момент нет активного сеанса удалённого доступа.
            Когда специалист начнёт сеанс, информация появится здесь.
          </p>
          <Button
            onClick={() => setCurrentView('client-dashboard')}
            variant="outline"
            className="mt-6 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
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
    <div className="flex h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {/* Header: session info */}
      <div className="shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-3">
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
                <p className="text-sm font-medium text-white">
                  {session.specialistName}
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] text-emerald-400"
                  >
                    Специалист
                  </Badge>
                  {connected ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <Wifi className="h-3 w-3" /> Онлайн
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <WifiOff className="h-3 w-3" /> Ожидание
                    </span>
                  )}
                </div>
              </div>
            </div>

            <Separator orientation="vertical" className="h-8 bg-slate-700" />

            {/* Ticket info */}
            <div className="hidden items-center gap-2 sm:flex">
              <Ticket className="h-4 w-4 text-slate-500" />
              <span className="text-xs text-slate-400 truncate max-w-[200px]">
                {session.ticketTitle}
              </span>
            </div>
          </div>

          {/* Right side: duration + controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1">
              <Clock className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-mono text-xs text-emerald-400">
                {formatDuration(duration)}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              onClick={handleGoToTicket}
            >
              <Ticket className="mr-1.5 h-3.5 w-3.5" />
              Заявка
            </Button>
          </div>
        </div>
      </div>

      {/* Main content: info cards + chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: session info */}
        <div className="hidden w-72 shrink-0 flex-col border-r border-slate-800 lg:flex">
          {/* Session details */}
          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Информация о сеансе
              </p>
            </div>

            {/* Status */}
            <Card className="border-slate-800 bg-slate-800/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Статус</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-emerald-400 border-emerald-500/20 bg-emerald-500/10"
                  >
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Активен
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Specialist card */}
            <Card className="border-slate-800 bg-slate-800/50">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20">
                    <Shield className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {session.specialistName}
                    </p>
                    <p className="text-[10px] text-slate-500">Специалист поддержки</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Security info */}
            <Card className="border-slate-800 bg-slate-800/50">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-slate-300">Зашифрованное соединение</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs text-slate-300">Управление требует разрешения</span>
                </div>
              </CardContent>
            </Card>

            {/* Start time */}
            <div className="flex items-center gap-2 px-1">
              <Clock className="h-3.5 w-3.5 text-slate-600" />
              <span className="text-xs text-slate-500">
                Начат: {formatDate(session.startedAt)}
              </span>
            </div>
          </div>

          {/* Permission notice */}
          <div className="mt-auto border-t border-slate-800 p-4">
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/10 p-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Специалист видит ваш экран. Для удалённого управления мышью и клавиатурой потребуется ваше разрешение.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel: chat */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
            <MessageSquare className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-300">Чат со специалистом</span>
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
                <div className="flex h-full flex-col items-center justify-center py-12 text-slate-600">
                  <MessageSquare className="mb-2 h-8 w-8" />
                  <p className="text-xs">Пока нет сообщений</p>
                  <p className="mt-1 text-[10px] text-slate-700">
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
                    {/* Avatar */}
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

                    {/* Bubble */}
                    <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] text-slate-500">
                          {msg.senderName}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                          isOwn
                            ? 'rounded-br-md bg-emerald-600/20 text-slate-200'
                            : 'rounded-bl-md bg-slate-800 text-slate-300'
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
          <div className="shrink-0 border-t border-slate-800 bg-[#0d1117] p-3">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Написать сообщение..."
                disabled={sending}
                className="flex-1 border-slate-700 bg-slate-800/50 text-sm text-slate-200 placeholder:text-slate-600 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/50"
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
    </div>
  )
}