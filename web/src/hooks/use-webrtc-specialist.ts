'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SIGNALING_PORT = 3005

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export interface UseWebRTCSpecialistReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>
  connectionState: RTCPeerConnectionState | 'disconnected'
  screenApproved: boolean
  screenDenied: boolean
  isWaitingApproval: boolean
  peerDisconnected: boolean
  isReceivingStream: boolean
}

export interface UseWebRTCSpecialistOptions {
  onEvent?: (message: string) => void
}

export function useWebRTCSpecialist(
  sessionId: string | undefined,
  specialistId: string | undefined,
  specialistName: string | undefined,
  options?: UseWebRTCSpecialistOptions,
): UseWebRTCSpecialistReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<Socket | null>(null)

  const onEventRef = useRef(options?.onEvent)
  useEffect(() => {
    onEventRef.current = options?.onEvent
  })

  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'disconnected'>('disconnected')
  const [screenApproved, setScreenApproved] = useState(false)
  const [screenDenied, setScreenDenied] = useState(false)
  const [isWaitingApproval, setIsWaitingApproval] = useState(false)
  const [peerDisconnected, setPeerDisconnected] = useState(false)
  const [isReceivingStream, setIsReceivingStream] = useState(false)

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
    }

    const pc = new RTCPeerConnection(ICE_SERVERS)
    pcRef.current = pc

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState)
      if (pc.connectionState === 'connected') {
        setIsReceivingStream(true)
        onEventRef.current?.('Видеопоток получен')
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setIsReceivingStream(false)
      }
    }

    pc.ontrack = (event) => {
      const videoEl = videoRef.current
      if (videoEl && event.streams[0]) {
        videoEl.srcObject = event.streams[0]
        videoEl.play().catch(() => {})
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && sessionId) {
        socketRef.current.emit('ice-candidate', {
          sessionId,
          candidate: event.candidate.toJSON(),
        })
      }
    }

    return pc
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !specialistId) return

    const socket = io(`/?XTransformPort=${SIGNALING_PORT}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[WebRTC-Specialist] Connected to signaling')
      socket.emit('join-session', {
        sessionId,
        userId: specialistId,
        username: specialistName || 'Специалист',
        role: 'specialist',
      })
      setIsWaitingApproval(true)
      onEventRef.current?.('Ожидание разрешения от клиента...')
    })

    socket.on('screen-share-approved', () => {
      console.log('[WebRTC-Specialist] Client approved screen share')
      setScreenApproved(true)
      setIsWaitingApproval(false)
      onEventRef.current?.('Клиент разрешил передачу экрана')
      createPeerConnection()
    })

    socket.on('screen-share-denied', () => {
      console.log('[WebRTC-Specialist] Client denied screen share')
      setScreenDenied(true)
      setIsWaitingApproval(false)
      onEventRef.current?.('Клиент отклонил передачу экрана')
    })

    socket.on('sdp-offer', async (data: { sdp: RTCSessionDescriptionInit }) => {
      console.log('[WebRTC-Specialist] Received SDP offer')
      const pc = pcRef.current || createPeerConnection()

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        socket.emit('sdp-answer', {
          sessionId,
          sdp: answer,
        })
        console.log('[WebRTC-Specialist] Sent SDP answer')
      } catch (err) {
        console.error('[WebRTC-Specialist] Error handling SDP offer:', err)
      }
    })

    socket.on('ice-candidate', (data: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current
      if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {})
      }
    })

    socket.on('peer-disconnected', () => {
      console.log('[WebRTC-Specialist] Client disconnected')
      setPeerDisconnected(true)
      setIsReceivingStream(false)
      onEventRef.current?.('Клиент отключился')
    })

    socket.on('session-ended', () => {
      console.log('[WebRTC-Specialist] Session ended by peer')
      setPeerDisconnected(true)
      setIsReceivingStream(false)
      onEventRef.current?.('Сессия завершена клиентом')
    })

    return () => {
      socket.disconnect()
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      socketRef.current = null
    }
  }, [sessionId, specialistId, specialistName, createPeerConnection])

  return {
    videoRef,
    connectionState,
    screenApproved,
    screenDenied,
    isWaitingApproval,
    peerDisconnected,
    isReceivingStream,
  }
}