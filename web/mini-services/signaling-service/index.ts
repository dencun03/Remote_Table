import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 120000,
  pingInterval: 25000,
})

// Session rooms: sessionId -> { specialist: socketId | null, client: socketId | null }
const sessionRooms = new Map<string, { specialist: string | null; client: string | null }>()

function getSessionRoom(sessionId: string) {
  if (!sessionRooms.has(sessionId)) {
    sessionRooms.set(sessionId, { specialist: null, client: null })
  }
  return sessionRooms.get(sessionId)!
}

io.on('connection', (socket) => {
  console.log(`[Signaling] Connected: ${socket.id}`)

  // ── Join a session room ──
  socket.on('join-session', (data: { sessionId: string; userId: string; username: string; role: 'specialist' | 'client' }) => {
    const { sessionId, userId, username, role } = data

    socket.join(`session:${sessionId}`)
    socket.data = { sessionId, userId, username, role }

    const room = getSessionRoom(sessionId)
    room[role] = socket.id

    console.log(`[Signaling] ${username} (${role}) joined session:${sessionId}`)

    // Notify others in the room
    socket.to(`session:${sessionId}`).emit('peer-joined', {
      role,
      userId,
      username,
      sessionId,
    })

    // If both peers are in the room, notify both
    if (room.specialist && room.client) {
      io.to(`session:${sessionId}`).emit('session-ready', { sessionId })
    }

    // If specialist joins and client is already waiting, send the request
    if (role === 'specialist' && room.client) {
      io.to(room.client).emit('screen-share-request', {
        sessionId,
        specialistId: userId,
        specialistName: username,
      })
    }
  })

  // ── Client approves screen share ──
  socket.on('screen-share-approved', (data: { sessionId: string }) => {
    const { sessionId } = data
    console.log(`[Signaling] Screen share approved for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('screen-share-approved', {
      sessionId,
    })
  })

  // ── Client denies screen share ──
  socket.on('screen-share-denied', (data: { sessionId: string }) => {
    const { sessionId } = data
    console.log(`[Signaling] Screen share denied for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('screen-share-denied', {
      sessionId,
    })
  })

  // ── SDP Offer (from client to specialist) ──
  socket.on('sdp-offer', (data: { sessionId: string; sdp: RTCSessionDescriptionInit }) => {
    console.log(`[Signaling] SDP offer for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('sdp-offer', {
      sdp: data.sdp,
    })
  })

  // ── SDP Answer (from specialist to client) ──
  socket.on('sdp-answer', (data: { sessionId: string; sdp: RTCSessionDescriptionInit }) => {
    console.log(`[Signaling] SDP answer for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('sdp-answer', {
      sdp: data.sdp,
    })
  })

  // ── ICE Candidate (bidirectional) ──
  socket.on('ice-candidate', (data: { sessionId: string; candidate: RTCIceCandidateInit }) => {
    socket.to(`session:${sessionId}`).emit('ice-candidate', {
      candidate: data.candidate,
    })
  })

  // ── Screen share stopped ──
  socket.on('screen-share-stopped', (data: { sessionId: string }) => {
    console.log(`[Signaling] Screen share stopped for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('screen-share-stopped', {
      sessionId: data.sessionId,
    })
  })

  // ── Session ended ──
  socket.on('session-ended', (data: { sessionId: string }) => {
    console.log(`[Signaling] Session ended: ${data.sessionId}`)
    socket.to(`session:${sessionId}`).emit('session-ended', {
      sessionId: data.sessionId,
    })
    sessionRooms.delete(data.sessionId)
  })

  // ── Control request (specialist → client) ──
  socket.on('control-request', (data: { sessionId: string }) => {
    console.log(`[Signaling] Control request for session:${sessionId}`)
    socket.to(`session:${sessionId}`).emit('control-request', {
      sessionId: data.sessionId,
    })
  })

  // ── Control response (client → specialist) ──
  socket.on('control-response', (data: { sessionId: string; approved: boolean }) => {
    console.log(`[Signaling] Control response for session:${sessionId}: ${data.approved}`)
    socket.to(`session:${sessionId}`).emit('control-response', {
      approved: data.approved,
    })
  })

  socket.on('disconnect', () => {
    const { sessionId, role, username } = socket.data || {}
    if (sessionId) {
      console.log(`[Signaling] ${username} (${role}) disconnected from session:${sessionId}`)
      socket.to(`session:${sessionId}`).emit('peer-disconnected', {
        role,
        username,
        sessionId,
      })

      const room = sessionRooms.get(sessionId)
      if (room) {
        if (role === 'specialist') room.specialist = null
        if (role === 'client') room.client = null
        if (!room.specialist && !room.client) {
          sessionRooms.delete(sessionId)
        }
      }
    } else {
      console.log(`[Signaling] Disconnected: ${socket.id}`)
    }
  })

  socket.on('error', (error) => {
    console.error(`[Signaling] Socket error (${socket.id}):`, error)
  })
})

const PORT = 3005
httpServer.listen(PORT, () => {
  console.log(`[Signaling] WebRTC signaling service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[Signaling] Shutting down...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('[Signaling] Shutting down...')
  httpServer.close(() => process.exit(0))
})