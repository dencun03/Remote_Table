'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { Socket } from 'socket.io-client'

/**
 * Hook for the SPECIALIST side — receives and displays remote screen stream.
 *
 * Usage:
 *   const videoRef = useRef<HTMLVideoElement>(null)
 *   const [socket, setSocket] = useState<Socket | null>(null)
 *   const { isViewing, connectionState } = useScreenShareSpecialist(socket, sessionId, videoRef)
 */
export function useScreenShareSpecialist(
  socket: Socket | null,
  sessionId: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options?: { onConnected?: () => void; onDisconnected?: () => void },
) {
  const [connectionState, setConnectionState] = useState<string>('disconnected')
  const [error, setError] = useState<string | null>(null)

  const isViewing = useMemo(() => connectionState === 'connected', [connectionState])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const onConnectedRef = useRef(options?.onConnected)
  const onDisconnectedRef = useRef(options?.onDisconnected)

  useEffect(() => {
    onConnectedRef.current = options?.onConnected
    onDisconnectedRef.current = options?.onDisconnected
  }, [options?.onConnected, options?.onDisconnected])

  // Close peer connection (no state changes)
  const closePeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    pendingCandidatesRef.current = []
  }, [])

  // Clear video element (no state changes)
  const clearVideo = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [videoRef])

  // Listen for stop from client
  useEffect(() => {
    if (!socket) return
    const onStop = () => {
      closePeerConnection()
      clearVideo()
      setConnectionState('disconnected')
      setError(null)
      onDisconnectedRef.current?.()
    }
    socket.on('screen-share-stopped', onStop)
    return () => {
      socket.off('screen-share-stopped', onStop)
    }
  }, [socket, closePeerConnection, clearVideo])

  // Main WebRTC effect
  useEffect(() => {
    if (!socket || !sessionId) return

    const handleOffer = async (data: {
      sessionId: string
      sdp: RTCSessionDescriptionInit
      userId: string
    }) => {
      if (data.sessionId !== sessionId) return

      closePeerConnection()

      setError(null)
      setConnectionState('connecting')

      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        })
        pcRef.current = pc

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))

        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        socket.emit('screen-share-answer', {
          sessionId: data.sessionId,
          sdp: pc.localDescription,
        })

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('screen-share-ice-candidate', {
              sessionId: data.sessionId,
              candidate: event.candidate.toJSON(),
            })
          }
        }

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0]
            videoRef.current.play().catch(() => {})
          }
        }

        pc.onconnectionstatechange = () => {
          setConnectionState(pc.connectionState)
          if (pc.connectionState === 'connected') {
            onConnectedRef.current?.()
          } else if (
            pc.connectionState === 'failed' ||
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'closed'
          ) {
            onDisconnectedRef.current?.()
            if (pc.connectionState === 'failed') {
              setError('Ошибка соединения с экраном клиента')
            }
          }
        }

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'failed') {
            setError('Не удалось установить ICE-соединение')
          }
        }

        // Apply pending ICE candidates
        for (const candidate of pendingCandidatesRef.current) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
        }
        pendingCandidatesRef.current = []
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка приёма экрана'
        setError(msg)
        setConnectionState('failed')
      }
    }

    const handleIceCandidate = (data: {
      sessionId: string
      candidate: RTCIceCandidateInit
    }) => {
      if (data.sessionId !== sessionId) return
      if (pcRef.current && pcRef.current.remoteDescription) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {})
      } else {
        pendingCandidatesRef.current.push(data.candidate)
      }
    }

    socket.on('screen-share-offer', handleOffer)
    socket.on('screen-share-ice-candidate', handleIceCandidate)

    return () => {
      socket.off('screen-share-offer', handleOffer)
      socket.off('screen-share-ice-candidate', handleIceCandidate)
      closePeerConnection()
      clearVideo()
      setConnectionState('disconnected')
      setError(null)
    }
  }, [socket, sessionId, videoRef, closePeerConnection, clearVideo])

  return {
    isViewing,
    connectionState,
    error,
  }
}