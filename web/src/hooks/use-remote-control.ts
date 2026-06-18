'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Хук удалённого управления экраном (сторона специалиста).
 *
 * Запускает server_1.py через Electron IPC, отображает MJPEG-стрим,
 * отправляет команды мыши/клавиатуры через HTTP POST.
 */

const HTTP_PORT = 8080
const MJPEG_URL = `http://localhost:${HTTP_PORT}/stream`
const STATUS_URL = `http://localhost:${HTTP_PORT}/status`

export interface RemoteControlState {
  isActive: boolean
  isStarting: boolean
  clientConnected: boolean
  error: string | null
  streamUrl: string | null
  resolution: { width: number; height: number } | null
}

export function useRemoteControl() {
  const [isActive, setIsActive] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [clientConnected, setClientConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Запуск сервера управления */
  const startControl = useCallback(async (): Promise<boolean> => {
    setError(null)
    setIsStarting(true)

    try {
      const api = window.electronAPI
      if (!api?.control?.startServer) {
        throw new Error('Удалённое управление доступно только в десктоп-приложении (Electron)')
      }

      const result = await api.control.startServer()
      if (!result.success) {
        throw new Error(result.message || 'Не удалось запустить сервер управления')
      }

      setStreamUrl(`${MJPEG_URL}?t=${Date.now()}`)
      setIsActive(true)

      // Опрос статуса подключения клиента
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(STATUS_URL)
          if (!res.ok) return
          const data = await res.json()
          setClientConnected(data.connected)
          if (data.resolution) {
            setResolution(data.resolution)
          }
        } catch {
          // Сервер ещё не готов
        }
      }, 1500)

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка запуска')
      return false
    } finally {
      setIsStarting(false)
    }
  }, [])

  /** Остановка сервера управления */
  const stopControl = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    try {
      await window.electronAPI?.control?.stopServer()
    } catch {
      // silent
    }

    setIsActive(false)
    setClientConnected(false)
    setStreamUrl(null)
    setResolution(null)
  }, [])

  /** Отправка команды мыши */
  const sendMouseCommand = useCallback(
    async (cmd: {
      x: number
      y: number
      click?: 'left' | 'right'
      drag?: boolean
    }) => {
      if (!isActive || !clientConnected) return
      try {
        await fetch(`http://localhost:${HTTP_PORT}/mouse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'mouse', ...cmd }),
        })
      } catch {
        // silent
      }
    },
    [isActive, clientConnected],
  )

  /** Отправка команды клавиатуры */
  const sendKeyCommand = useCallback(
    async (key: string) => {
      if (!isActive || !clientConnected) return
      try {
        await fetch(`http://localhost:${HTTP_PORT}/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'key', key }),
        })
      } catch {
        // silent
      }
    },
    [isActive, clientConnected],
  )

  /** Получение локального IP (для передачи клиенту) */
  const getLocalIP = useCallback(async (): Promise<string> => {
    try {
      const result = await window.electronAPI?.control?.getLocalIP()
      return result?.ip || '127.0.0.1'
    } catch {
      return '127.0.0.1'
    }
  }, [])

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
      }
    }
  }, [])

  return {
    isActive,
    isStarting,
    clientConnected,
    error,
    streamUrl,
    resolution,
    startControl,
    stopControl,
    sendMouseCommand,
    sendKeyCommand,
    getLocalIP,
  }
}
