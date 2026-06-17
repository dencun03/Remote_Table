'use client'

import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SIGNALING_PORT = 3005

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export interface UseWebRTCClientReturn {
  localVideoRef: React.RefObject<HTMLVideoElement | null>
  hasScreenShareRequest: boolean
  specialistName: string | null
  approveScreenShare: () => Promise<void>
  denyScreenShare: () => void
  isSharing: boolean
  stopSharing: () => void
  connectionState: RTCPeerConnectionState | 'disconnected'
  peerDisconnected: boolean
  hasControlRequest: boolean
  respondControl: (approved: boolean) => void
}

export function useWebRTCClient(
  sessionId: string | undefined,
  clientId: string | undefined,
  clientName: string | undefined,
): UseWebRTCClientReturn {
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  const [hasScreenShareRequest, setHasScreenShareRequest] = useState(false)
  const [specialistName, setSpecialistName] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'disconnected'>('disconnected')
  const [peerDisconnected, setPeerDisconnected] = useState(false)
  const [hasControlRequest, setHasControlRequest] = useState(false)

  const doStopSharing = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (socketRef.current && sessionId) {
      socketRef.current.emit('screen-share-stopped', { sessionId })
    }
    setIsSharing(false)
    setConnectionState('disconnected')
  }

  const createPeerAndSendOffer = async () => {
    if (!sessionId || !socketRef.current) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
    } catch (err) {
      console.error('[WebRTC-Client] getDisplayMedia failed:', err)
      socketRef.current.emit('screen-share-denied', { sessionId })
      return
    }

    localStreamRef.current = stream

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream
    }

    stream.getVideoTracks()[0].onended = () => {
      console.log('[WebRTC-Client] Screen share stopped by system UI')
      doStopSharing()
    }

    if (pcRef.current) {
      pcRef.current.close()
    }
    const pc = new RTCPeerConnection(ICE_SERVERS)
    pcRef.current = pc

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream)
    })

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState)
      if (pc.connectionState === 'connected') {
        setIsSharing(true)
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setIsSharing(false)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          sessionId,
          candidate: event.candidate.toJSON(),
        })
      }
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      socketRef.current.emit('sdp-offer', {
        sessionId,
        sdp: offer,
      })
      console.log('[WebRTC-Client] Sent SDP offer')
    } catch (err) {
      console.error('[WebRTC-Client] Error creating offer:', err)
    }

    socketRef.current.on('sdp-answer', async (data: { sdp: RTCSessionDescriptionInit }) => {
      console.log('[WebRTC-Client] Received SDP answer')
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      } catch (err) {
        console.error('[WebRTC-Client] Error setting remote description:', err)
      }
    })

    socketRef.current.on('ice-candidate', (data: { candidate: RTCIceCandidateInit }) => {
      pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {})
    })
  }

  const approveScreenShare = async () => {
    if (!socketRef.current || !sessionId) return

    setHasScreenShareRequest(false)
    socketRef.current.emit('screen-share-approved', { sessionId })

    try {
      await fetch(`/api/sessions/${sessionId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
    } catch {
      // silent
    }

    await createPeerAndSendOffer()
  }

  const denyScreenShare = () => {
    if (!socketRef.current || !sessionId) return

    setHasScreenShareRequest(false)
    socketRef.current.emit('screen-share-denied', { sessionId })

    fetch(`/api/sessions/${sessionId}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deny' }),
    }).catch(() => {})
  }

  const stopSharing = doStopSharing

  const respondControl = (approved: boolean) => {
    if (!socketRef.current || !sessionId) return
    setHasControlRequest(false)
    socketRef.current.emit('control-response', { sessionId, approved })
  }

  useEffect(() => {
    if (!sessionId || !clientId) return

    const socket = io(`/?XTransformPort=${SIGNALING_PORT}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[WebRTC-Client] Connected to signaling')
      socket.emit('join-session', {
        sessionId,
        userId: clientId,
        username: clientName || 'Клиент',
        role: 'client',
      })
    })

    socket.on('screen-share-request', (data: { sessionId: string; specialistName: string }) => {
      console.log('[WebRTC-Client] Screen share request from', data.specialistName)
      setHasScreenShareRequest(true)
      setSpecialistName(data.specialistName)
    })

    socket.on('peer-disconnected', () => {
      console.log('[WebRTC-Client] Specialist disconnected')
      setPeerDisconnected(true)
      doStopSharing()
    })

    socket.on('session-ended', () => {
      console.log('[WebRTC-Client] Session ended by specialist')
      setPeerDisconnected(true)
      doStopSharing()
    })

    socket.on('control-request', () => {
      console.log('[WebRTC-Client] Control request from specialist')
      setHasControlRequest(true)
    })

    return () => {
      socket.disconnect()
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      socketRef.current = null
      localStreamRef.current = null
    }
  }, [sessionId, clientId, clientName])

  return {
    localVideoRef,
    hasScreenShareRequest,
    specialistName,
    approveScreenShare,
    denyScreenShare,
    isSharing,
    stopSharing,
    connectionState,
    peerDisconnected,
    hasControlRequest,
    respondControl,
  }
}