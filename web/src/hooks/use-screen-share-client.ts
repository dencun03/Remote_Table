'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Socket } from 'socket.io-client'

/**
 * Hook for the CLIENT side — captures screen and streams via WebRTC.
 *
 * Usage:
 *   const [socket, setSocket] = useState<Socket | null>(null)
 *   // setSocket when connected...
 *   const { startSharing, stopSharing, isSharing, error } = useScreenShareClient(socket, sessionId, userId)
 */
export function useScreenShareClient(
  socket: Socket | null,
  sessionId: string | null,
  userId?: string,
) {
  const [isSharing, setIsSharing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  // Cleanup
  const cleanup = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    setIsSharing(false)
    setIsConnecting(false)
  }, [])

  // Cleanup when sessionId changes or socket disconnects
  useEffect(() => {
    return () => {
      if (socket && sessionId) {
        socket.emit('screen-share-stopped', { sessionId, userId })
      }
      cleanup()
    }
  }, [sessionId, socket, userId, cleanup])

  // Listen for stop from specialist side
  useEffect(() => {
    if (!socket) return
    const onStop = () => {
      cleanup()
    }
    socket.on('screen-share-stopped', onStop)
    return () => {
      socket.off('screen-share-stopped', onStop)
    }
  }, [socket, cleanup])

  const startSharing = useCallback(async () => {
    if (!socket || !sessionId) {
      setError('Нет подключения или идентификатора сессии')
      return
    }

    setError(null)
    setIsConnecting(true)

    try {
      // 1. Capture screen
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: false,
      })
      localStreamRef.current = stream

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        socket.emit('screen-share-stopped', { sessionId, userId })
        cleanup()
      })

      // 2. Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ],
      })
      pcRef.current = pc

      // Add tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream)
      })

      // 3. Create offer
      const offer = await pc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
      })
      await pc.setLocalDescription(offer)

      // 4. Send offer via signaling
      socket.emit('screen-share-offer', {
        sessionId,
        sdp: pc.localDescription,
        userId,
      })

      // 5. Listen for answer
      const handleAnswer = (data: { sdp: RTCSessionDescriptionInit }) => {
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        socket.off('screen-share-answer', handleAnswer)
      }
      socket.on('screen-share-answer', handleAnswer)

      // 6. Send ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('screen-share-ice-candidate', {
            sessionId,
            candidate: event.candidate.toJSON(),
            userId,
          })
        }
      }

      // 7. Handle connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setIsSharing(true)
          setIsConnecting(false)
        } else if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected'
        ) {
          setError('Соединение потеряно')
          cleanup()
        }
      }

      setIsSharing(true)
      setIsConnecting(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка захвата экрана'
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError('Доступ к экрану отклонён')
      } else {
        setError(msg)
      }
      setIsConnecting(false)
      cleanup()
    }
  }, [socket, sessionId, userId, cleanup])

  const stopSharing = useCallback(() => {
    if (socket && sessionId) {
      socket.emit('screen-share-stopped', { sessionId, userId })
    }
    cleanup()
  }, [socket, sessionId, userId, cleanup])

  return {
    startSharing,
    stopSharing,
    isSharing,
    isConnecting,
    error,
  }
}
