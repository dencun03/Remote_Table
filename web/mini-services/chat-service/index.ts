import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Track which users are in which ticket rooms
const ticketRooms = new Map<string, Set<string>>()
// Track which users are in which session rooms
const sessionRooms = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  console.log(`[Chat] Connected: ${socket.id}`)

  // ─── Ticket Chat ───────────────────────────────────────────────────────

  socket.on('join-ticket', (data: { ticketId: string; userId: string; username: string }) => {
    const { ticketId, userId, username } = data

    socket.join(`ticket:${ticketId}`)
    socket.data = { ...socket.data, ticketId, userId, username }

    if (!ticketRooms.has(ticketId)) {
      ticketRooms.set(ticketId, new Set())
    }
    ticketRooms.get(ticketId)!.add(socket.id)

    // Notify others in the room
    socket.to(`ticket:${ticketId}`).emit('user-joined', {
      userId,
      username,
      timestamp: new Date().toISOString(),
    })

    console.log(`[Chat] ${username} joined ticket:${ticketId}`)
  })

  socket.on('chat-message', (data: { ticketId: string; message: { id: string; senderId: string; senderName: string; senderRole: string; text: string; createdAt: string } }) => {
    const { ticketId, message } = data

    io.to(`ticket:${ticketId}`).emit('new-message', {
      ...message,
      timestamp: message.createdAt,
    })

    console.log(`[Chat] Message in ticket:${ticketId} from ${message.senderName}`)
  })

  socket.on('typing', (data: { ticketId: string; username: string }) => {
    socket.to(`ticket:${data.ticketId}`).emit('user-typing', {
      username: data.username,
      timestamp: new Date().toISOString(),
    })
  })

  socket.on('leave-ticket', (data: { ticketId: string }) => {
    const { ticketId } = data
    socket.leave(`ticket:${ticketId}`)
    const room = ticketRooms.get(ticketId)
    if (room) {
      room.delete(socket.id)
      if (room.size === 0) ticketRooms.delete(ticketId)
    }
  })

  // ─── Session Rooms (for WebRTC signaling) ──────────────────────────────

  socket.on('join-session', (data: { sessionId: string; userId: string; role: string; username: string }) => {
    const { sessionId, userId, role, username } = data

    socket.join(`session:${sessionId}`)
    socket.data = { ...socket.data, sessionId, role }

    if (!sessionRooms.has(sessionId)) {
      sessionRooms.set(sessionId, new Set())
    }
    sessionRooms.get(sessionId)!.add(socket.id)

    console.log(`[Chat] ${username} (${role}) joined session:${sessionId}`)

    // Notify others in the session room
    socket.to(`session:${sessionId}`).emit('peer-joined-session', {
      userId,
      username,
      role,
      sessionId,
    })
  })

  socket.on('leave-session', (data: { sessionId: string }) => {
    const { sessionId } = data
    socket.leave(`session:${sessionId}`)
    const room = sessionRooms.get(sessionId)
    if (room) {
      room.delete(socket.id)
      if (room.size === 0) sessionRooms.delete(sessionId)
    }
  })

  // ─── Screen Share Request (legacy WebRTC — kept for backward compat) ───

  // Specialist requests screen access from client
  socket.on('request-screen-share', (data: { sessionId: string; userId: string; username: string }) => {
    console.log(`[WebRTC] Screen share request for session:${data.sessionId} from ${data.username}`)
    socket.to(`session:${data.sessionId}`).emit('screen-share-requested', {
      sessionId: data.sessionId,
      userId: data.userId,
      username: data.username,
    })
  })

  // Client responds to screen share request
  socket.on('screen-share-response', (data: { sessionId: string; accepted: boolean; userId: string }) => {
    console.log(`[WebRTC] Screen share response for session:${data.sessionId} — ${data.accepted ? 'accepted' : 'rejected'}`)
    socket.to(`session:${data.sessionId}`).emit('screen-share-response', {
      sessionId: data.sessionId,
      accepted: data.accepted,
      userId: data.userId,
    })
  })

  // Specialist cancels screen share request
  socket.on('cancel-screen-share-request', (data: { sessionId: string }) => {
    socket.to(`session:${data.sessionId}`).emit('screen-share-request-cancelled', {
      sessionId: data.sessionId,
    })
  })

  // ─── Remote Control (Python server_1.py / client_1.py) ────────────────

  // Specialist requests remote control — sends IP to client
  socket.on('control-request', (data: { sessionId: string; specialistIP: string; specialistName?: string }) => {
    console.log(`[Control] Request for session:${data.sessionId} from ${data.specialistName} (IP: ${data.specialistIP})`)
    socket.to(`session:${data.sessionId}`).emit('control-request', {
      sessionId: data.sessionId,
      specialistIP: data.specialistIP,
      specialistName: data.specialistName,
    })
  })

  // Client responds to control request
  socket.on('control-response', (data: { sessionId: string; accepted: boolean; userId: string }) => {
    console.log(`[Control] Response for session:${data.sessionId} — ${data.accepted ? 'accepted' : 'rejected'}`)
    socket.to(`session:${data.sessionId}`).emit('control-response', {
      sessionId: data.sessionId,
      accepted: data.accepted,
      userId: data.userId,
    })
  })

  // Specialist cancels control request
  socket.on('control-cancel', (data: { sessionId: string }) => {
    console.log(`[Control] Cancel for session:${data.sessionId}`)
    socket.to(`session:${data.sessionId}`).emit('control-cancel', {
      sessionId: data.sessionId,
    })
  })

  // Specialist stops control
  socket.on('control-stopped', (data: { sessionId: string }) => {
    console.log(`[Control] Stopped for session:${data.sessionId}`)
    socket.to(`session:${data.sessionId}`).emit('control-stopped', {
      sessionId: data.sessionId,
    })
  })

  // ─── WebRTC Signaling ──────────────────────────────────────────────────

  socket.on('screen-share-offer', (data: { sessionId: string; sdp: RTCSessionDescriptionInit; userId: string }) => {
    console.log(`[WebRTC] Screen share offer for session:${data.sessionId}`)
    // Relay to everyone else in the session room
    socket.to(`session:${data.sessionId}`).emit('screen-share-offer', {
      sessionId: data.sessionId,
      sdp: data.sdp,
      userId: data.userId,
    })
  })

  socket.on('screen-share-answer', (data: { sessionId: string; sdp: RTCSessionDescriptionInit; userId: string }) => {
    console.log(`[WebRTC] Screen share answer for session:${data.sessionId}`)
    socket.to(`session:${data.sessionId}`).emit('screen-share-answer', {
      sessionId: data.sessionId,
      sdp: data.sdp,
      userId: data.userId,
    })
  })

  socket.on('screen-share-ice-candidate', (data: { sessionId: string; candidate: RTCIceCandidateInit; userId: string }) => {
    // Relay ICE candidate to the other peer
    socket.to(`session:${data.sessionId}`).emit('screen-share-ice-candidate', {
      sessionId: data.sessionId,
      candidate: data.candidate,
      userId: data.userId,
    })
  })

  socket.on('screen-share-stopped', (data: { sessionId: string; userId: string }) => {
    console.log(`[WebRTC] Screen share stopped for session:${data.sessionId}`)
    socket.to(`session:${data.sessionId}`).emit('screen-share-stopped', {
      sessionId: data.sessionId,
      userId: data.userId,
    })
  })

  // ─── Disconnect ────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const { ticketId, userId, username, sessionId } = socket.data || {}

    // Leave ticket room
    if (ticketId) {
      socket.to(`ticket:${ticketId}`).emit('user-left', {
        userId,
        username,
        timestamp: new Date().toISOString(),
      })
      const room = ticketRooms.get(ticketId)
      if (room) {
        room.delete(socket.id)
        if (room.size === 0) ticketRooms.delete(ticketId)
      }
    }

    // Leave session room
    if (sessionId) {
      socket.to(`session:${sessionId}`).emit('peer-left-session', {
        userId,
        username,
        sessionId,
      })
      const room = sessionRooms.get(sessionId)
      if (room) {
        room.delete(socket.id)
        if (room.size === 0) sessionRooms.delete(sessionId)
      }
    }

    console.log(`[Chat] Disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`[Chat] Socket error (${socket.id}):`, error)
  })
})

const PORT = 3004
httpServer.listen(PORT, () => {
  console.log(`[Chat] WebSocket chat + WebRTC signaling service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[Chat] Shutting down...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('[Chat] Shutting down...')
  httpServer.close(() => process.exit(0))
})