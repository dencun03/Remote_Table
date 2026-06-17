import { Server } from 'socket.io'

const PORT = 3004

const io = new Server(PORT, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

// sessionId -> { specialist: socketId, client: socketId }
const sessions = new Map<string, { specialist?: string; client?: string }>()

io.on('connection', (socket) => {
  socket.on('join-session', ({ sessionId, role }: { sessionId: string; role: string }) => {
    socket.join(`session:${sessionId}`)
    socket.data.sessionId = sessionId
    socket.data.role = role

    const s = sessions.get(sessionId) || {}
    if (role === 'specialist') s.specialist = socket.id
    if (role === 'user') s.client = socket.id
    sessions.set(sessionId, s)

    socket.to(`session:${sessionId}`).emit('peer-joined', { peerId: socket.id, role })
  })

  socket.on('webrtc-signal', ({ sessionId, signal }: { sessionId: string; signal: any }) => {
    const s = sessions.get(sessionId)
    if (!s) return
    const targetId = socket.data.role === 'specialist' ? s.client : s.specialist
    if (targetId) io.to(targetId).emit('webrtc-signal', { signal, from: socket.id })
  })

  socket.on('ice-candidate', ({ sessionId, candidate }: { sessionId: string; candidate: any }) => {
    const s = sessions.get(sessionId)
    if (!s) return
    const targetId = socket.data.role === 'specialist' ? s.client : s.specialist
    if (targetId) io.to(targetId).emit('ice-candidate', { candidate })
  })

  socket.on('remote-cursor', ({ sessionId, x, y }: { sessionId: string; x: number; y: number }) => {
    const s = sessions.get(sessionId)
    if (!s) return
    const targetId = socket.data.role === 'specialist' ? s.client : s.specialist
    if (targetId) io.to(targetId).emit('remote-cursor', { x, y })
  })

  socket.on('end-session', ({ sessionId }: { sessionId: string }) => {
    io.to(`session:${sessionId}`).emit('session-ended')
    sessions.delete(sessionId)
  })

  socket.on('disconnect', () => {
    const { sessionId, role } = socket.data
    if (sessionId) {
      socket.to(`session:${sessionId}`).emit('peer-left', { role })
      const s = sessions.get(sessionId)
      if (s) {
        if (role === 'specialist') delete s.specialist
        if (role === 'user') delete s.client
        if (!s.specialist && !s.client) sessions.delete(sessionId)
      }
    }
  })
})

console.log(`Signaling service on port ${PORT}`)